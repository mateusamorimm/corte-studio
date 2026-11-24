// Carrinho, pedidos e estoque (ver "Estoque e pedidos" em docs/ARQUITETURA.md).
// Pagamento e retirada acontecem no salão: o pedido reserva os itens e baixa o estoque.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
import { abrirReservaDoCliente, sincronizarReserva } from "./codigoService.js";
import { calcularDesconto, creditar, estornar, melhorRecompensa, travarPontos } from "./fidelidadeService.js";
import { registrarLog } from "./logService.js";

const MAX_POR_ITEM = 99;

export const INCLUDE_PEDIDO = {
  itens: { orderBy: { id_item: "asc" } },
  cliente: { select: { id_usuario: true, nome_completo: true, telefone: true, email: true, visitante: true } },
  recompensa: { select: { nome: true, desconto_percentual: true } },
  reserva: { select: { id_reserva: true, codigo: true, visitante: true, status: true, nome: true, telefone: true, email: true } },
  avaliacao: { select: { nota: true, comentario: true, status_moderacao: true, visivel: true } },
};

export async function listarCarrinho(idCliente) {
  const itens = await prisma.itemCarrinho.findMany({
    where: { id_cliente: idCliente },
    include: {
      produto: {
        select: { id_produto: true, nome_produto: true, preco: true, imagem_url: true, quantidade_estoque: true, ativo: true },
      },
    },
    orderBy: { data_adicao: "asc" },
  });
  const total = itens.reduce(
    (soma, i) => (i.produto.ativo ? soma.add(new Prisma.Decimal(i.produto.preco).mul(i.quantidade)) : soma),
    new Prisma.Decimal(0)
  );
  return { itens, total: total.toFixed(2) };
}

async function produtoDisponivel(idProduto) {
  const p = await prisma.produto.findFirst({ where: { id_produto: idProduto, ativo: true } });
  if (!p) throw notFound("Produto não encontrado ou indisponível.");
  return p;
}

// Adiciona (soma à quantidade existente).
export async function adicionarAoCarrinho(idCliente, idProduto, quantidade = 1) {
  const produto = await produtoDisponivel(idProduto);
  const existente = await prisma.itemCarrinho.findUnique({
    where: { id_cliente_id_produto: { id_cliente: idCliente, id_produto: idProduto } },
  });
  const nova = (existente?.quantidade ?? 0) + quantidade;
  if (nova > MAX_POR_ITEM) throw conflict(`Limite de ${MAX_POR_ITEM} unidades por produto.`);
  if (nova > produto.quantidade_estoque) {
    throw conflict(
      produto.quantidade_estoque === 0
        ? `"${produto.nome_produto}" está sem estoque no momento.`
        : `Só temos ${produto.quantidade_estoque} unidade(s) de "${produto.nome_produto}".`
    );
  }
  await prisma.itemCarrinho.upsert({
    where: { id_cliente_id_produto: { id_cliente: idCliente, id_produto: idProduto } },
    create: { id_cliente: idCliente, id_produto: idProduto, quantidade: nova },
    update: { quantidade: nova },
  });
  return listarCarrinho(idCliente);
}

export async function definirQuantidade(idCliente, idProduto, quantidade) {
  const produto = await produtoDisponivel(idProduto);
  if (quantidade > produto.quantidade_estoque) {
    throw conflict(`Só temos ${produto.quantidade_estoque} unidade(s) de "${produto.nome_produto}".`);
  }
  const { count } = await prisma.itemCarrinho.updateMany({
    where: { id_cliente: idCliente, id_produto: idProduto },
    data: { quantidade },
  });
  if (!count) throw notFound("Este produto não está no seu carrinho.");
  return listarCarrinho(idCliente);
}

export async function removerDoCarrinho(idCliente, idProduto) {
  await prisma.itemCarrinho.deleteMany({ where: { id_cliente: idCliente, id_produto: idProduto } });
  return listarCarrinho(idCliente);
}

// Baixa o estoque (UPDATE condicional) e grava o pedido. itens: [{ id_produto, quantidade, produto }]
export async function criarPedidoTx(tx, { id_cliente, itens, id_reserva, observacao = null, forma_pagamento = null, recompensa = null, prazo_retirada }) {
  let subtotal = new Prisma.Decimal(0);
  for (const item of [...itens].sort((a, b) => a.id_produto - b.id_produto)) { // ordem fixa evita deadlock
    const afetadas = await tx.$executeRaw`
      UPDATE produto
         SET quantidade_estoque = quantidade_estoque - ${item.quantidade}::int, data_atualizacao = now()
       WHERE id_produto = ${item.id_produto}::int AND ativo AND quantidade_estoque >= ${item.quantidade}::int`;
    if (afetadas !== 1) {
      throw new AppError(
        409,
        item.produto.ativo
          ? `Estoque insuficiente para "${item.produto.nome_produto}". Ajuste a quantidade no carrinho.`
          : `"${item.produto.nome_produto}" não está mais disponível. Remova-o do carrinho.`,
        "ESTOQUE_INSUFICIENTE",
        { id_produto: item.id_produto }
      );
    }
    subtotal = subtotal.add(new Prisma.Decimal(item.produto.preco).mul(item.quantidade));
  }
  const desconto = calcularDesconto(subtotal, recompensa);
  const pontos = recompensa?.consome_pontos ? recompensa.pontos_minimos : 0;
  const pedido = await tx.pedido.create({
    data: {
      id_cliente,
      id_reserva,
      subtotal,
      valor_desconto: desconto,
      valor_total: subtotal.sub(desconto),
      id_recompensa: recompensa?.id_recompensa ?? null,
      pontos_usados: pontos,
      observacao,
      forma_pagamento,
      prazo_retirada,
      itens: {
        create: itens.map((i) => ({
          id_produto: i.id_produto,
          nome_produto_registrado: i.produto.nome_produto,
          quantidade: i.quantidade,
          preco_unitario: i.produto.preco,
        })),
      },
    },
    include: INCLUDE_PEDIDO,
  });
  if (pontos) {
    await tx.movimentoPontos.create({
      data: { id_usuario: id_cliente, pontos: -pontos, origem: "RESGATE", id_origem: pedido.id_pedido, motivo: `${recompensa.nome} no pedido nº ${pedido.id_pedido}` },
    });
  }
  return pedido;
}

// Data-limite: o prazo conta a partir da data desejada (ou de hoje).
export function prazoRetirada(cfg, desde = new Date()) {
  return new Date(desde.getTime() + cfg.prazo_retirada_dias * 24 * 3600 * 1000);
}

// Resumo do checkout: itens, subtotal e o melhor desconto de fidelidade disponível.
export async function resumoCheckout(idCliente) {
  const [{ itens, total }, recompensa, cfg] = await Promise.all([listarCarrinho(idCliente), melhorRecompensa(idCliente), obterConfig()]);
  const desconto = calcularDesconto(total, recompensa);
  return {
    itens,
    subtotal: total,
    recompensa,
    desconto: desconto.toFixed(2),
    total: new Prisma.Decimal(total).sub(desconto).toFixed(2),
    prazo_retirada_dias: cfg.prazo_retirada_dias,
    aviso_entrega: (cfg.entrega_ativa ? cfg.aviso_entrega_on : cfg.aviso_entrega_off) ?? null,
  };
}

// Finaliza o carrinho: estoque, desconto de fidelidade, pedido e código de retirada, tudo na mesma transação.
export async function finalizarPedido(idCliente, { observacao = null, forma_pagamento = null, usar_desconto = true } = {}) {
  const cfg = await obterConfig();
  return prisma.$transaction(async (tx) => {
    await travarPontos(tx, idCliente);
    const itens = await tx.itemCarrinho.findMany({ where: { id_cliente: idCliente }, include: { produto: true }, orderBy: { id_produto: "asc" } });
    if (!itens.length) throw conflict("Seu carrinho está vazio.");
    const recompensa = usar_desconto ? await melhorRecompensa(idCliente, tx) : null;
    const reserva = await abrirReservaDoCliente(tx, idCliente, observacao);
    const pedido = await criarPedidoTx(tx, {
      id_cliente: idCliente,
      itens,
      id_reserva: reserva.id_reserva,
      observacao,
      forma_pagamento,
      recompensa,
      prazo_retirada: prazoRetirada(cfg),
    });
    await tx.itemCarrinho.deleteMany({ where: { id_cliente: idCliente } });
    return pedido;
  }, { timeout: 20000, maxWait: 10000 });
}

// Itens informados por um visitante (sem carrinho no servidor): confere produtos e quantidades.
export async function itensParaPedido(itens) {
  const porId = new Map();
  for (const i of itens) porId.set(i.id_produto, (porId.get(i.id_produto) ?? 0) + i.quantidade);
  const produtos = await prisma.produto.findMany({ where: { id_produto: { in: [...porId.keys()] }, ativo: true } });
  if (produtos.length !== porId.size) throw badRequest("Algum produto escolhido não está mais disponível.");
  return produtos.map((produto) => {
    const quantidade = porId.get(produto.id_produto);
    if (quantidade > MAX_POR_ITEM) throw conflict(`Limite de ${MAX_POR_ITEM} unidades por produto.`);
    return { id_produto: produto.id_produto, quantidade, produto };
  });
}

// Cancela e devolve o estoque — só se o próprio UPDATE de status afetar a linha (idempotente).
export async function cancelarPedido(idPedido, { idCliente = null, motivo = null, expirado = false, ator = null } = {}) {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findFirst({
      where: { id_pedido: idPedido, ...(idCliente ? { id_cliente: idCliente } : {}) },
      include: { itens: true },
    });
    if (!pedido) throw notFound("Pedido não encontrado.");
    const permitidos = idCliente ? ["PENDENTE"] : ["PENDENTE", "PRONTO_PARA_RETIRADA"];
    const afetadas = await tx.$executeRaw`
      UPDATE pedido SET status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = ${motivo}, data_atualizacao = now()
       WHERE id_pedido = ${idPedido}::int AND status::text = ANY(${permitidos}::text[])`;
    if (afetadas !== 1) {
      throw conflict(
        idCliente
          ? "Este pedido não pode mais ser cancelado pelo site. Fale com o salão."
          : "Só pedidos pendentes ou prontos para retirada podem ser cancelados."
      );
    }
    for (const item of pedido.itens) {
      await tx.$executeRaw`
        UPDATE produto SET quantidade_estoque = quantidade_estoque + ${item.quantidade}::int, data_atualizacao = now()
         WHERE id_produto = ${item.id_produto}::int`;
    }
    await estornar(tx, { origem: "RESGATE", idOrigem: idPedido, motivo: `Pedido nº ${idPedido} cancelado: pontos devolvidos` });
    await sincronizarReserva(tx, pedido.id_reserva, { expirada: expirado, motivo });
    await registrarLog("pedido.cancelado", { autor: ator ?? idCliente, entidade: "pedido", id: idPedido, detalhes: { motivo } }, tx);
    return tx.pedido.findUnique({ where: { id_pedido: idPedido }, include: INCLUDE_PEDIDO });
  }, { timeout: 20000, maxWait: 10000 });
}

const PROXIMO_STATUS = { PENDENTE: ["PRONTO_PARA_RETIRADA", "CONCLUIDO"], PRONTO_PARA_RETIRADA: ["CONCLUIDO", "PENDENTE"] };

export async function avancarPedido(idPedido, status, ator = null) {
  if (status === "CANCELADO") return cancelarPedido(idPedido, { ator, motivo: "Cancelado pelo salão" });
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findUnique({ where: { id_pedido: idPedido } });
    if (!pedido) throw notFound("Pedido não encontrado.");
    if (!(PROXIMO_STATUS[pedido.status] ?? []).includes(status)) {
      throw conflict(`Não é possível mudar o pedido de ${pedido.status} para ${status}.`);
    }
    const { count } = await tx.pedido.updateMany({ where: { id_pedido: idPedido, status: pedido.status }, data: { status } });
    if (count !== 1) throw new AppError(409, "O pedido foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
    if (status === "CONCLUIDO") {
      await creditar(tx, { idUsuario: pedido.id_cliente, origem: "PEDIDO", idOrigem: idPedido, valor: pedido.valor_total, motivo: `Pedido concluído nº ${idPedido}` });
    }
    await sincronizarReserva(tx, pedido.id_reserva);
    await registrarLog("pedido.status", { autor: ator, entidade: "pedido", id: idPedido, detalhes: { de: pedido.status, para: status } }, tx);
    return tx.pedido.findUnique({ where: { id_pedido: idPedido }, include: INCLUDE_PEDIDO });
  }, { timeout: 20000, maxWait: 10000 });
}
