// Carrinho, pedidos e estoque (ver "Estoque e pedidos" em docs/ARQUITETURA.md).
// Pagamento e retirada acontecem no salão: o pedido reserva os itens e baixa o estoque.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError, conflict, notFound } from "../lib/errors.js";

const MAX_POR_ITEM = 99;

export const INCLUDE_PEDIDO = {
  itens: { orderBy: { id_item: "asc" } },
  cliente: { select: { id_usuario: true, nome_completo: true, telefone: true, email: true } },
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

// Finaliza: baixa o estoque de forma atômica, grava pedido e itens e esvazia o carrinho.
export async function finalizarPedido(idCliente, observacao = null) {
  return prisma.$transaction(async (tx) => {
    const itens = await tx.itemCarrinho.findMany({
      where: { id_cliente: idCliente },
      include: { produto: true },
      orderBy: { id_produto: "asc" }, // ordem fixa evita deadlock entre pedidos simultâneos
    });
    if (!itens.length) throw conflict("Seu carrinho está vazio.");

    let total = new Prisma.Decimal(0);
    for (const item of itens) {
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
      total = total.add(new Prisma.Decimal(item.produto.preco).mul(item.quantidade));
    }

    const pedido = await tx.pedido.create({
      data: {
        id_cliente: idCliente,
        valor_total: total,
        observacao,
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
    await tx.itemCarrinho.deleteMany({ where: { id_cliente: idCliente } });
    return pedido;
  });
}

// Cancela e devolve o estoque — só se o próprio UPDATE de status afetar a linha (idempotente).
export async function cancelarPedido(idPedido, { idCliente = null } = {}) {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findFirst({
      where: { id_pedido: idPedido, ...(idCliente ? { id_cliente: idCliente } : {}) },
      include: { itens: true },
    });
    if (!pedido) throw notFound("Pedido não encontrado.");
    const permitidos = idCliente ? ["PENDENTE"] : ["PENDENTE", "PRONTO_PARA_RETIRADA"];
    const afetadas = await tx.$executeRaw`
      UPDATE pedido SET status = 'CANCELADO', cancelado_em = now(), data_atualizacao = now()
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
    return tx.pedido.findUnique({ where: { id_pedido: idPedido }, include: INCLUDE_PEDIDO });
  });
}

const PROXIMO_STATUS = { PENDENTE: ["PRONTO_PARA_RETIRADA", "CONCLUIDO"], PRONTO_PARA_RETIRADA: ["CONCLUIDO", "PENDENTE"] };

export async function avancarPedido(idPedido, status) {
  if (status === "CANCELADO") return cancelarPedido(idPedido);
  const pedido = await prisma.pedido.findUnique({ where: { id_pedido: idPedido } });
  if (!pedido) throw notFound("Pedido não encontrado.");
  if (!(PROXIMO_STATUS[pedido.status] ?? []).includes(status)) {
    throw conflict(`Não é possível mudar o pedido de ${pedido.status} para ${status}.`);
  }
  const { count } = await prisma.pedido.updateMany({ where: { id_pedido: idPedido, status: pedido.status }, data: { status } });
  if (count !== 1) throw new AppError(409, "O pedido foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
  return prisma.pedido.findUnique({ where: { id_pedido: idPedido }, include: INCLUDE_PEDIDO });
}
