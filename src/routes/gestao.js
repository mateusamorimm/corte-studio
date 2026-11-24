// Painel: reservas de balcão, recepção, fidelidade, moderação, contatos oficiais e auditoria.
// Montado em /api/admin depois do controle de acesso da equipe (ver routes/admin.js).
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { exigirPerfil } from "../middlewares/auth.js";
import { validar } from "../middlewares/validate.js";
import { booleano, idParam } from "../validators/comum.js";
import { z } from "zod";
import {
  ajustePontosSchema,
  cadastroVisitanteSchema,
  cancelarClienteSchema,
  contatoSchema,
  desligamentoSchema,
  buscaQuery,
  listaReservasQuery,
  logsQuery,
  moderacaoQuery,
  moderacaoSchema,
  perfilProfissionalSchema,
  pontoSchema,
  recepcionistaSchema,
  recompensaSchema,
} from "../validators/dominio.js";
import { cadastrarVisitante, cancelarReserva, chegadaReserva, concluirReserva, INCLUDE_RESERVA, listarReservas } from "../services/reservaService.js";
import * as rh from "../services/funcionarioService.js";
import { ajustar, pontosDosClientes } from "../services/fidelidadeService.js";
import { comentariosModeracao, excluirComentario, excluirPost, moderar, postsModeracao } from "../services/feedService.js";
import { listarLogs, registrarLog } from "../services/logService.js";
import { mediaDoProfissional } from "../services/perfilService.js";
import { convidar } from "../services/conviteService.js";
import { usuarioLivre } from "../services/authService.js";

const router = Router();
const soAdmin = exigirPerfil("ADMIN");
const balcao = exigirPerfil("ADMIN", "RECEPCIONISTA");
const ativoSchema = z.object({ ativo: booleano });

// ═════════ RESERVAS (balcão) ═════════

router.get("/reservas", balcao, validar({ query: listaReservasQuery }), async (req, res) => {
  res.json({ reservas: await listarReservas(req.valid.query) });
});

router.get("/reservas/codigo/:codigo", balcao, async (req, res) => {
  const reserva = await prisma.reserva.findUnique({ where: { codigo: String(req.params.codigo).toUpperCase().slice(0, 6) }, include: INCLUDE_RESERVA });
  if (!reserva) throw notFound("Nenhuma reserva com este código.");
  res.json({ reserva });
});

router.post("/reservas/:id/chegada", balcao, validar({ params: idParam }), async (req, res) => {
  res.json({ reserva: await chegadaReserva(req.valid.params.id, req.usuario) });
});

router.post("/reservas/:id/concluir", balcao, validar({ params: idParam }), async (req, res) => {
  res.json({ reserva: await concluirReserva(req.valid.params.id, req.usuario) });
});

router.post("/reservas/:id/cancelar", balcao, validar({ params: idParam, body: cancelarClienteSchema }), async (req, res) => {
  res.json({ reserva: await cancelarReserva(req.valid.params.id, req.valid.body.motivo ?? null, req.usuario) });
});

// "Concluir + cadastrar": o cliente define a própria senha pelo link enviado ao e-mail.
router.post("/reservas/:id/cadastrar", balcao, validar({ params: idParam, body: cadastroVisitanteSchema }), async (req, res) => {
  const { concluir, ...dados } = req.valid.body;
  const r = await cadastrarVisitante(req.valid.params.id, dados, req.usuario);
  let reserva = r.reserva;
  let aviso = r.novo && r.cliente.email ? await convidar(r.cliente) : null;
  if (concluir) {
    try {
      reserva = await concluirReserva(req.valid.params.id, req.usuario);
    } catch (err) {
      if (err.status !== 409) throw err;
      aviso = [aviso, `Cadastro feito, mas a reserva não foi concluída: ${err.message}`].filter(Boolean).join(" ");
    }
  }
  res.json({ reserva, novo: r.novo, aviso });
});

// ═════════ RECEPCIONISTAS ═════════

async function loginLivre(d, ignorarId = null) {
  const outro = await prisma.usuario.findFirst({ where: { email: d.email, ...(ignorarId ? { id_usuario: { not: ignorarId } } : {}) }, select: { id_usuario: true } });
  if (outro) throw conflict("Já existe uma conta com este e-mail.", [{ campo: "email", mensagem: "E-mail já cadastrado." }]);
  if (d.usuario) await usuarioLivre(d.usuario, ignorarId);
}

router.get("/recepcionistas", soAdmin, async (_req, res) => {
  res.json({ recepcionistas: await rh.listarRecepcionistas() });
});

// Ficha completa (documentos abertos): cada consulta fica registrada na auditoria.
router.get("/recepcionistas/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  const recepcionista = await rh.obterRecepcionista(req.valid.params.id, { completo: true });
  await registrarLog("recepcionista.consulta_ficha", { autor: req.usuario, entidade: "usuario", id: req.valid.params.id });
  res.json({ recepcionista, pontos: await rh.listarPonto(req.valid.params.id) });
});

router.post("/recepcionistas", soAdmin, validar({ body: recepcionistaSchema }), async (req, res) => {
  await loginLivre(req.valid.body);
  const recepcionista = await rh.criarRecepcionista(req.valid.body, req.usuario);
  res.status(201).json({ recepcionista, aviso: await convidar(recepcionista) });
});

router.put("/recepcionistas/:id", soAdmin, validar({ params: idParam, body: recepcionistaSchema }), async (req, res) => {
  await loginLivre(req.valid.body, req.valid.params.id);
  res.json({ recepcionista: await rh.salvarRecepcionista(req.valid.params.id, req.valid.body, req.usuario) });
});

router.patch("/recepcionistas/:id/ativo", soAdmin, validar({ params: idParam, body: ativoSchema }), async (req, res) => {
  res.json({ recepcionista: await rh.definirAtivo(req.valid.params.id, req.valid.body.ativo, req.usuario) });
});

router.post("/recepcionistas/:id/convite", soAdmin, validar({ params: idParam }), async (req, res) => {
  const r = await rh.obterRecepcionista(req.valid.params.id);
  if (!r.ativo) throw conflict("Reative o acesso antes de enviar o convite.");
  const aviso = await convidar(r);
  res.json({ mensagem: aviso ?? "Link de acesso enviado por e-mail." });
});

router.post("/recepcionistas/:id/desligamento", soAdmin, validar({ params: idParam, body: desligamentoSchema }), async (req, res) => {
  res.json({ recepcionista: await rh.desligar(req.valid.params.id, req.valid.body, req.usuario) });
});

router.get("/recepcionistas/:id/ponto", soAdmin, validar({ params: idParam }), async (req, res) => {
  res.json({ pontos: await rh.listarPonto(req.valid.params.id) });
});

router.post("/recepcionistas/:id/ponto", soAdmin, validar({ params: idParam, body: pontoSchema }), async (req, res) => {
  res.status(201).json({ ponto: await rh.registrarPonto(req.valid.params.id, req.valid.body, req.usuario) });
});

// O próprio ponto
router.get("/meu-ponto", exigirPerfil("RECEPCIONISTA"), async (req, res) => {
  res.json({ pontos: await rh.listarPonto(req.usuario.id_usuario, 20) });
});
router.post("/meu-ponto", exigirPerfil("RECEPCIONISTA"), validar({ body: pontoSchema }), async (req, res) => {
  res.status(201).json({ ponto: await rh.registrarPonto(req.usuario.id_usuario, req.valid.body, req.usuario) });
});

// ═════════ PERFIL PROFISSIONAL ═════════

async function profissional(id) {
  const u = await prisma.usuario.findFirst({
    where: { id_usuario: id, tipo_perfil: { in: ["BARBEIRO", "ADMIN"] } },
    select: {
      id_usuario: true,
      nome_completo: true,
      email: true,
      telefone: true,
      whatsapp: true,
      avatar_url: true,
      bio: true,
      ativo: true,
      tipo_perfil: true,
      data_cadastro: true,
      perfil_profissional: true,
      servicos_oferecidos: { select: { servico: { select: { id_servico: true, nome_servico: true, icone: true } } } },
      redes_sociais: { orderBy: { ordem: "asc" } },
    },
  });
  if (!u) throw notFound("Profissional não encontrado.");
  return u;
}

const proprioOuAdmin = (req, _res, next) =>
  req.usuario.tipo_perfil === "ADMIN" || req.usuario.id_usuario === req.valid.params.id ? next() : next(notFound("Profissional não encontrado."));

router.get("/profissionais/:id", exigirPerfil("ADMIN", "BARBEIRO"), validar({ params: idParam }), proprioOuAdmin, async (req, res) => {
  const p = await profissional(req.valid.params.id);
  const [avaliacao, atendimentos, faltas, ultimos] = await Promise.all([
    mediaDoProfissional(p.id_usuario),
    prisma.agendamento.count({ where: { id_barbeiro: p.id_usuario, status: "CONCLUIDO" } }),
    prisma.agendamento.count({ where: { id_barbeiro: p.id_usuario, status: "NAO_COMPARECEU" } }),
    prisma.agendamento.findMany({
      where: { id_barbeiro: p.id_usuario },
      orderBy: { data_hora_inicio: "desc" },
      take: 10,
      select: {
        id_agendamento: true,
        data_hora_inicio: true,
        status: true,
        preco_registrado: true,
        cliente: { select: { nome_completo: true } },
        servico: { select: { nome_servico: true } },
      },
    }),
  ]);
  res.json({
    profissional: { ...p, servicos_oferecidos: p.servicos_oferecidos.map((s) => s.servico) },
    estatisticas: { atendimentos, faltas, media: avaliacao.media, avaliacoes: avaliacao.total },
    ultimos,
  });
});

router.put("/profissionais/:id", exigirPerfil("ADMIN", "BARBEIRO"), validar({ params: idParam, body: perfilProfissionalSchema }), proprioOuAdmin, async (req, res) => {
  const id = req.valid.params.id;
  await profissional(id);
  const { bio, ...perfil } = req.valid.body;
  // Só o administrador decide quem aparece no site.
  if (req.usuario.tipo_perfil !== "ADMIN") delete perfil.visivel_no_site;
  await prisma.$transaction([
    prisma.perfilProfissional.upsert({ where: { id_usuario: id }, create: { id_usuario: id, ...perfil }, update: perfil }),
    ...(bio === undefined ? [] : [prisma.usuario.update({ where: { id_usuario: id }, data: { bio } })]),
  ]);
  await registrarLog("profissional.perfil", { autor: req.usuario, entidade: "usuario", id });
  res.json({ profissional: await profissional(id) });
});

// ═════════ FIDELIDADE ═════════

router.get("/fidelidade", soAdmin, validar({ query: buscaQuery }), async (req, res) => {
  const [recompensas, clientes] = await Promise.all([
    prisma.recompensa.findMany({ orderBy: { pontos_minimos: "asc" } }),
    pontosDosClientes(req.valid.query.busca),
  ]);
  res.json({ recompensas, clientes });
});

router.post("/fidelidade/recompensas", soAdmin, validar({ body: recompensaSchema }), async (req, res) => {
  const recompensa = await prisma.recompensa.create({ data: req.valid.body });
  await registrarLog("recompensa.criacao", { autor: req.usuario, entidade: "recompensa", id: recompensa.id_recompensa, detalhes: req.valid.body });
  res.status(201).json({ recompensa });
});

router.put("/fidelidade/recompensas/:id", soAdmin, validar({ params: idParam, body: recompensaSchema }), async (req, res) => {
  const recompensa = await prisma.recompensa.update({ where: { id_recompensa: req.valid.params.id }, data: req.valid.body });
  await registrarLog("recompensa.edicao", { autor: req.usuario, entidade: "recompensa", id: recompensa.id_recompensa, detalhes: req.valid.body });
  res.json({ recompensa });
});

router.post("/fidelidade/clientes/:id/ajuste", soAdmin, validar({ params: idParam, body: ajustePontosSchema }), async (req, res) => {
  res.json({ pontos: await ajustar({ idUsuario: req.valid.params.id, ...req.valid.body, autor: req.usuario }) });
});

// ═════════ MODERAÇÃO DO FEED ═════════

router.get("/posts", soAdmin, validar({ query: moderacaoQuery }), async (req, res) => {
  res.json({ posts: await postsModeracao(req.valid.query) });
});
router.patch("/posts/:id", soAdmin, validar({ params: idParam, body: moderacaoSchema }), async (req, res) => {
  await moderar("post", req.valid.params.id, req.valid.body.status, req.usuario);
  res.json({ ok: true });
});
router.delete("/posts/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  await excluirPost(req.valid.params.id, req.usuario);
  res.json({ ok: true });
});
router.get("/comentarios", soAdmin, validar({ query: moderacaoQuery }), async (req, res) => {
  res.json({ comentarios: await comentariosModeracao(req.valid.query) });
});
router.patch("/comentarios/:id", soAdmin, validar({ params: idParam, body: moderacaoSchema }), async (req, res) => {
  await moderar("comentario", req.valid.params.id, req.valid.body.status, req.usuario);
  res.json({ ok: true });
});
router.delete("/comentarios/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  await excluirComentario(req.valid.params.id, req.usuario);
  res.json({ ok: true });
});

// ═════════ CONTATOS OFICIAIS ═════════

router.get("/contatos", soAdmin, async (_req, res) => {
  res.json({ contatos: await prisma.contatoOficial.findMany({ orderBy: [{ ordem: "asc" }, { id_contato: "asc" }] }) });
});
router.post("/contatos", soAdmin, validar({ body: contatoSchema }), async (req, res) => {
  const contato = await prisma.contatoOficial.create({ data: req.valid.body });
  await registrarLog("contato.criacao", { autor: req.usuario, entidade: "contato_oficial", id: contato.id_contato });
  res.status(201).json({ contato });
});
router.put("/contatos/:id", soAdmin, validar({ params: idParam, body: contatoSchema }), async (req, res) => {
  const contato = await prisma.contatoOficial.update({ where: { id_contato: req.valid.params.id }, data: req.valid.body });
  await registrarLog("contato.edicao", { autor: req.usuario, entidade: "contato_oficial", id: contato.id_contato });
  res.json({ contato });
});
router.delete("/contatos/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  await prisma.contatoOficial.delete({ where: { id_contato: req.valid.params.id } });
  await registrarLog("contato.exclusao", { autor: req.usuario, entidade: "contato_oficial", id: req.valid.params.id });
  res.json({ ok: true });
});

// ═════════ AUDITORIA (somente leitura) ═════════

router.get("/logs", soAdmin, validar({ query: logsQuery }), async (req, res) => {
  res.json(await listarLogs(req.valid.query));
});

export default router;
