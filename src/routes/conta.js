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
} from "../validators/dominio.js";
import { criarAgendamento, cancelarPeloCliente, avaliar, INCLUDE_AGENDAMENTO } from "../services/agendaService.js";
import {
  listarCarrinho,
  adicionarAoCarrinho,
  definirQuantidade,
  removerDoCarrinho,
  finalizarPedido,
  cancelarPedido,
  INCLUDE_PEDIDO,
} from "../services/lojaService.js";
import { hashSenha } from "../services/authService.js";
import { criarSessao } from "../lib/sessao.js";
import { emitirCsrf } from "../middlewares/csrf.js";

const router = Router();
router.use(exigirLogin);

const meuId = (req) => req.usuario.id_usuario;

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
  res.json({ mensagem: "Senha alterada com sucesso." });
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
  const agendamento = await criarAgendamento({
    id_cliente: meuId(req),
    id_servico: b.id_servico,
    id_barbeiro: b.id_barbeiro ?? null,
    inicio: b.inicio,
    observacao: b.observacao ?? null,
  });
  res.status(201).json({ agendamento });
});

router.post("/agendamentos/:id/cancelar", validar({ params: idParam, body: cancelarClienteSchema }), async (req, res) => {
  res.json({ agendamento: await cancelarPeloCliente(req.valid.params.id, meuId(req), req.valid.body.motivo ?? null) });
});

router.post("/agendamentos/:id/avaliacao", limiteAvaliacao, validar({ params: idParam, body: avaliacaoSchema }), async (req, res) => {
  const avaliacao = await avaliar(req.valid.params.id, meuId(req), {
    nota: req.valid.body.nota,
    comentario: req.valid.body.comentario ?? null,
  });
  res.status(201).json({ avaliacao });
});

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
  res.status(201).json({ pedido: await finalizarPedido(meuId(req), req.valid.body.observacao ?? null) });
});

router.post("/pedidos/:id/cancelar", validar({ params: idParam }), async (req, res) => {
  res.json({ pedido: await cancelarPedido(req.valid.params.id, { idCliente: meuId(req) }) });
});

// ───────── Favoritos e cortes enviados ─────────

router.get("/favoritos", async (req, res) => {
  const [favoritos, enviados] = await Promise.all([
    prisma.favorito.findMany({
      where: { id_cliente: meuId(req), corte: { ativo: true } },
      include: { corte: { select: { id_corte: true, nome_corte: true, imagem_url: true } } },
      orderBy: { data_favorito: "desc" },
    }),
    prisma.corteEnviado.findMany({ where: { id_cliente: meuId(req) }, orderBy: { data_envio: "desc" } }),
  ]);
  res.json({ favoritos, enviados });
});

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
