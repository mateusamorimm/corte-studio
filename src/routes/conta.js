// Área do usuário logado (/api/me): perfil, agendamentos, carrinho, pedidos e favoritos.
// Tudo é filtrado pelo id da sessão — nunca por um id vindo do navegador.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { exigirLogin, CAMPOS_USUARIO_PUBLICO } from "../middlewares/auth.js";
import { validar } from "../middlewares/validate.js";
import { limiteAgendamento, limiteAvaliacao, limiteSenha } from "../middlewares/rateLimit.js";
import { idParam } from "../validators/comum.js";
import {
  perfilSchema,
  imagemPerfilSchema,
  trocarSenhaSchema,
  novoAgendamentoSchema,
  cancelarClienteSchema,
  avaliacaoSchema,
  itemCarrinhoSchema,
  quantidadeSchema,
  finalizarPedidoSchema,
  corteEnviadoSchema,
  privacidadeSchema,
  redeSocialSchema,
  usuarioLoginSchema,
  trocarEmailSchema,
  feedQuery,
} from "../validators/dominio.js";
import { criarAgendamentos, cancelarPeloCliente, INCLUDE_AGENDAMENTO } from "../services/agendaService.js";
import { alvosAvaliaveis, avaliar } from "../services/avaliacaoService.js";
import { situacao } from "../services/fidelidadeService.js";
import { favoritosDe } from "../services/perfilService.js";
import { listarFeed } from "../services/feedService.js";
import { registrarLog } from "../services/logService.js";
import {
  listarCarrinho,
  adicionarAoCarrinho,
  definirQuantidade,
  removerDoCarrinho,
  finalizarPedido,
  resumoCheckout,
  cancelarPedido,
  INCLUDE_PEDIDO,
} from "../services/lojaService.js";
import { hashSenha, solicitarTrocaEmail, usuarioLivre } from "../services/authService.js";
import { urlPertenceAoUsuario } from "../services/midiaService.js";
import { criarSessao } from "../lib/sessao.js";
import { emitirCsrf } from "../middlewares/csrf.js";

const router = Router();
router.use(exigirLogin);

const meuId = (req) => req.usuario.id_usuario;

// Foto, banner e imagens de referência do cliente só podem ser arquivos enviados por ele
async function exigirMidiaPropria(url, idUsuario) {
  if (!(await urlPertenceAoUsuario(url, idUsuario))) {
    throw new AppError(400, "Use uma imagem enviada pelo botão de envio do site.", "MIDIA_ALHEIA");
  }
}

// ───────── Perfil ─────────

router.get("/resumo", async (req, res) => {
  const id = meuId(req);
  const concluidos = { id_cliente: id, status: "CONCLUIDO" };
  const [visitas, gastoServicos, gastoProdutos, porServico, porProfissional] = await Promise.all([
    prisma.agendamento.count({ where: concluidos }),
    prisma.agendamento.aggregate({ where: concluidos, _sum: { preco_registrado: true } }),
    prisma.pedido.aggregate({ where: { id_cliente: id, status: "CONCLUIDO" }, _sum: { valor_total: true } }),
    prisma.agendamento.groupBy({ by: ["id_servico"], where: concluidos, _count: true, orderBy: { _count: { id_servico: "desc" } }, take: 1 }),
    prisma.agendamento.groupBy({ by: ["id_barbeiro"], where: concluidos, _count: true, orderBy: { _count: { id_barbeiro: "desc" } }, take: 1 }),
  ]);
  const [servicoFav, profissionalFav] = await Promise.all([
    porServico[0] ? prisma.servico.findUnique({ where: { id_servico: porServico[0].id_servico }, select: { nome_servico: true } }) : null,
    porProfissional[0]
      ? prisma.usuario.findUnique({ where: { id_usuario: porProfissional[0].id_barbeiro }, select: { nome_completo: true } })
      : null,
  ]);
  const total = new Prisma.Decimal(gastoServicos._sum.preco_registrado ?? 0).add(gastoProdutos._sum.valor_total ?? 0);
  res.json({
    usuario: req.usuario,
    resumo: {
      visitas,
      servico_favorito: servicoFav?.nome_servico ?? null,
      profissional_favorito: profissionalFav?.nome_completo ?? null,
      membro_desde: req.usuario.data_cadastro,
      total_gasto: total.toFixed(2),
    },
  });
});

router.put("/perfil", validar({ body: perfilSchema }), async (req, res) => {
  const dados = req.valid.body;
  if (dados.cpf) {
    const outro = await prisma.usuario.findFirst({
      where: { cpf: dados.cpf, id_usuario: { not: meuId(req) } },
      select: { id_usuario: true },
    });
    if (outro) throw conflict("Este CPF já está cadastrado em outra conta.", { campo: "cpf" });
  }
  const usuario = await prisma.usuario.update({
    where: { id_usuario: meuId(req) },
    data: {
      nome_completo: dados.nome_completo,
      telefone: dados.telefone ?? null,
      data_nascimento: dados.data_nascimento ?? null,
      cpf: dados.cpf ?? null,
      endereco: dados.endereco ?? null,
      bio: dados.bio ?? null,
      instagram: dados.instagram ?? null,
      tiktok: dados.tiktok ?? null,
      whatsapp: dados.whatsapp ?? null,
    },
    select: CAMPOS_USUARIO_PUBLICO,
  });
  res.json({ usuario });
});

for (const [rota, campo] of [["/avatar", "avatar_url"], ["/capa", "capa_url"]]) {
  router.put(rota, validar({ body: imagemPerfilSchema }), async (req, res) => {
    await exigirMidiaPropria(req.valid.body.url, meuId(req));
    const usuario = await prisma.usuario.update({
      where: { id_usuario: meuId(req) },
      data: { [campo]: req.valid.body.url ?? null },
      select: CAMPOS_USUARIO_PUBLICO,
    });
    res.json({ usuario });
  });
}

router.put("/senha", limiteSenha, validar({ body: trocarSenhaSchema }), async (req, res) => {
  const { senha_atual, nova_senha } = req.valid.body;
  const atual = await prisma.usuario.findUnique({ where: { id_usuario: meuId(req) }, select: { senha_hash: true } });
  if (!atual?.senha_hash || !(await bcrypt.compare(senha_atual, atual.senha_hash))) {
    throw new AppError(400, "A senha atual está incorreta.", "SENHA_ATUAL_INCORRETA", [
      { campo: "senha_atual", mensagem: "A senha atual está incorreta." },
    ]);
  }
  const usuario = await prisma.usuario.update({
    where: { id_usuario: meuId(req) },
    data: { senha_hash: await hashSenha(nova_senha) },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
  });
  // A troca invalida as outras sessões; esta recebe um cookie novo.
  emitirCsrf(res, criarSessao(res, usuario));
  await registrarLog("conta.senha", { autor: req.usuario, entidade: "usuario", id: meuId(req) });
  res.json({ mensagem: "Senha alterada com sucesso." });
});

// Nome de login opcional (o e-mail continua valendo).
router.put("/usuario", limiteSenha, validar({ body: usuarioLoginSchema }), async (req, res) => {
  const login = req.valid.body.usuario ?? null;
  if (login) await usuarioLivre(login, meuId(req));
  const usuario = await prisma.usuario.update({ where: { id_usuario: meuId(req) }, data: { usuario: login }, select: CAMPOS_USUARIO_PUBLICO });
  await registrarLog("conta.usuario", { autor: req.usuario, entidade: "usuario", id: meuId(req) });
  res.json({ usuario });
});

// Troca de e-mail: confirmada por um link enviado ao novo endereço.
router.post("/email", limiteSenha, validar({ body: trocarEmailSchema }), async (req, res) => {
  await solicitarTrocaEmail(req.usuario, req.valid.body.novo_email, req.valid.body.senha_atual);
  res.json({ mensagem: "Enviamos um link de confirmação para o novo e-mail. A troca só vale depois de confirmada." });
});

router.put("/privacidade", validar({ body: privacidadeSchema }), async (req, res) => {
  const usuario = await prisma.usuario.update({ where: { id_usuario: meuId(req) }, data: req.valid.body, select: CAMPOS_USUARIO_PUBLICO });
  await registrarLog("conta.privacidade", { autor: req.usuario, entidade: "usuario", id: meuId(req), detalhes: req.valid.body });
  res.json({ usuario });
});

// ───────── Redes sociais ─────────

const minhasRedes = (req) =>
  prisma.redeSocialUsuario.findMany({ where: { id_usuario: meuId(req) }, orderBy: [{ ordem: "asc" }, { id_rede: "asc" }] });

router.get("/redes", async (req, res) => res.json({ redes: await minhasRedes(req) }));

router.post("/redes", validar({ body: redeSocialSchema }), async (req, res) => {
  const total = await prisma.redeSocialUsuario.count({ where: { id_usuario: meuId(req) } });
  if (total >= 30) throw conflict("Limite de 30 redes sociais no perfil.");
  const repetida = await prisma.redeSocialUsuario.findFirst({ where: { id_usuario: meuId(req), url: req.valid.body.url } });
  if (repetida) throw conflict("Esta rede já está no seu perfil.", [{ campo: "url", mensagem: "Esta rede já está no seu perfil." }]);
  await prisma.redeSocialUsuario.create({ data: { ...req.valid.body, id_usuario: meuId(req), ordem: total } });
  res.status(201).json({ redes: await minhasRedes(req) });
});

router.put("/redes/:id", validar({ params: idParam, body: redeSocialSchema }), async (req, res) => {
  const { count } = await prisma.redeSocialUsuario.updateMany({ where: { id_rede: req.valid.params.id, id_usuario: meuId(req) }, data: req.valid.body });
  if (!count) throw notFound("Rede social não encontrada.");
  res.json({ redes: await minhasRedes(req) });
});

router.delete("/redes/:id", validar({ params: idParam }), async (req, res) => {
  const { count } = await prisma.redeSocialUsuario.deleteMany({ where: { id_rede: req.valid.params.id, id_usuario: meuId(req) } });
  if (!count) throw notFound("Rede social não encontrada.");
  res.json({ redes: await minhasRedes(req) });
});

// ───────── Fidelidade e publicações ─────────

router.get("/fidelidade", async (req, res) => res.json({ fidelidade: await situacao(meuId(req)) }));

router.get("/posts", validar({ query: feedQuery }), async (req, res) => {
  res.json(await listarFeed({ leitor: req.usuario, soMeus: true, cursor: req.valid.query.cursor, limite: req.valid.query.limite }));
});

// ───────── Agendamentos ─────────

router.get("/agendamentos", async (req, res) => {
  const agendamentos = await prisma.agendamento.findMany({
    where: { id_cliente: meuId(req) },
    include: INCLUDE_AGENDAMENTO,
    orderBy: { data_hora_inicio: "desc" },
    take: 200,
  });
  res.json({ agendamentos });
});

router.post("/agendamentos", limiteAgendamento, validar({ body: novoAgendamentoSchema }), async (req, res) => {
  const b = req.valid.body;
  const { reserva, agendamentos } = await criarAgendamentos({
    id_cliente: meuId(req),
    servicos: b.servicos,
    id_barbeiro: b.id_barbeiro ?? null,
    inicio: b.inicio,
    pessoas: b.pessoas,
    cortes: b.cortes,
    observacao: b.observacao ?? null,
  });
  res.status(201).json({ agendamento: agendamentos[0], agendamentos, codigo: reserva.codigo });
});

router.post("/agendamentos/:id/cancelar", validar({ params: idParam, body: cancelarClienteSchema }), async (req, res) => {
  res.json({ agendamento: await cancelarPeloCliente(req.valid.params.id, meuId(req), req.valid.body.motivo ?? null) });
});

// Avaliação do atendimento ou da compra, com nota por critério.
for (const [base, chave] of [["agendamentos", "id_agendamento"], ["pedidos", "id_pedido"]]) {
  router.get(`/${base}/:id/avaliacao`, validar({ params: idParam }), async (req, res) => {
    res.json(await alvosAvaliaveis({ idCliente: meuId(req), [chave]: req.valid.params.id }));
  });
  router.post(`/${base}/:id/avaliacao`, limiteAvaliacao, validar({ params: idParam, body: avaliacaoSchema }), async (req, res) => {
    const { nota, notas, comentario } = req.valid.body;
    const avaliacao = await avaliar({ idCliente: meuId(req), [chave]: req.valid.params.id, nota, notas, comentario: comentario ?? null });
    res.status(201).json({
      avaliacao,
      aviso: avaliacao.status_moderacao === "PENDENTE" ? "Obrigado! Sua avaliação aparece no site depois da aprovação do salão." : null,
    });
  });
}

// ───────── Carrinho e pedidos ─────────

router.get("/carrinho", async (req, res) => res.json(await listarCarrinho(meuId(req))));

router.post("/carrinho", validar({ body: itemCarrinhoSchema }), async (req, res) => {
  res.json(await adicionarAoCarrinho(meuId(req), req.valid.body.id_produto, req.valid.body.quantidade));
});

router.patch("/carrinho/:id", validar({ params: idParam, body: quantidadeSchema }), async (req, res) => {
  res.json(await definirQuantidade(meuId(req), req.valid.params.id, req.valid.body.quantidade));
});

router.delete("/carrinho/:id", validar({ params: idParam }), async (req, res) => {
  res.json(await removerDoCarrinho(meuId(req), req.valid.params.id));
});

router.get("/checkout", async (req, res) => res.json(await resumoCheckout(meuId(req))));

router.get("/pedidos", async (req, res) => {
  const pedidos = await prisma.pedido.findMany({
    where: { id_cliente: meuId(req) },
    include: INCLUDE_PEDIDO,
    orderBy: { data_pedido: "desc" },
    take: 200,
  });
  res.json({ pedidos });
});

router.post("/pedidos", validar({ body: finalizarPedidoSchema }), async (req, res) => {
  res.status(201).json({ pedido: await finalizarPedido(meuId(req), req.valid.body) });
});

router.post("/pedidos/:id/cancelar", validar({ params: idParam }), async (req, res) => {
  res.json({ pedido: await cancelarPedido(req.valid.params.id, { idCliente: meuId(req), motivo: "Cancelado pelo cliente" }) });
});

// ───────── Favoritos e cortes enviados ─────────

router.get("/favoritos", async (req, res) => {
  const [meus, enviados] = await Promise.all([
    favoritosDe(meuId(req)),
    prisma.corteEnviado.findMany({ where: { id_cliente: meuId(req) }, orderBy: { data_envio: "desc" } }),
  ]);
  res.json({ favoritos: meus.cortes.map((corte) => ({ id_corte: corte.id_corte, corte })), servicos: meus.servicos, produtos: meus.produtos, enviados });
});

// Favoritos de serviços e produtos
for (const { rota, tabela, favorito, coluna, erro } of [
  { rota: "servicos", tabela: "servico", favorito: "favoritoServico", coluna: "id_servico", erro: "Serviço não encontrado." },
  { rota: "produtos", tabela: "produto", favorito: "favoritoProduto", coluna: "id_produto", erro: "Produto não encontrado." },
]) {
  router.put(`/favoritos/${rota}/:id`, validar({ params: idParam }), async (req, res) => {
    const item = await prisma[tabela].findFirst({ where: { [coluna]: req.valid.params.id, ativo: true }, select: { [coluna]: true } });
    if (!item) throw notFound(erro);
    const chave = { id_cliente: meuId(req), [coluna]: req.valid.params.id };
    await prisma[favorito].upsert({ where: { [`id_cliente_${coluna}`]: chave }, create: chave, update: {} });
    res.json({ favorito: true });
  });
  router.delete(`/favoritos/${rota}/:id`, validar({ params: idParam }), async (req, res) => {
    await prisma[favorito].deleteMany({ where: { id_cliente: meuId(req), [coluna]: req.valid.params.id } });
    res.json({ favorito: false });
  });
}

router.put("/favoritos/:id", validar({ params: idParam }), async (req, res) => {
  const corte = await prisma.corteGaleria.findFirst({ where: { id_corte: req.valid.params.id, ativo: true } });
  if (!corte) throw notFound("Corte não encontrado.");
  await prisma.favorito.upsert({
    where: { id_cliente_id_corte: { id_cliente: meuId(req), id_corte: corte.id_corte } },
    create: { id_cliente: meuId(req), id_corte: corte.id_corte },
    update: {},
  });
  res.json({ favorito: true });
});

router.delete("/favoritos/:id", validar({ params: idParam }), async (req, res) => {
  await prisma.favorito.deleteMany({ where: { id_cliente: meuId(req), id_corte: req.valid.params.id } });
  res.json({ favorito: false });
});

router.post("/cortes-enviados", validar({ body: corteEnviadoSchema }), async (req, res) => {
  await exigirMidiaPropria(req.valid.body.imagem_url, meuId(req));
  const total = await prisma.corteEnviado.count({ where: { id_cliente: meuId(req) } });
  if (total >= 30) throw conflict("Limite de 30 imagens enviadas. Remova alguma para enviar outra.");
  const corte = await prisma.corteEnviado.create({
    data: { id_cliente: meuId(req), nome: req.valid.body.nome, imagem_url: req.valid.body.imagem_url },
  });
  res.status(201).json({ corte });
});

router.delete("/cortes-enviados/:id", validar({ params: idParam }), async (req, res) => {
  const { count } = await prisma.corteEnviado.deleteMany({
    where: { id_corte_enviado: req.valid.params.id, id_cliente: meuId(req) },
  });
  if (!count) throw notFound("Imagem não encontrada.");
  res.json({ ok: true });
});

export default router;
