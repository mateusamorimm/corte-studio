// Painel administrativo (/api/admin).
// ADMIN acessa tudo. BARBEIRO acessa apenas a própria agenda (agendamentos e bloqueios).
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { conflict, forbidden, notFound, badRequest } from "../lib/errors.js";
import { exigirPerfil, CAMPOS_USUARIO_PUBLICO } from "../middlewares/auth.js";
import { validar } from "../middlewares/validate.js";
import { idParam } from "../validators/comum.js";
import {
  buscaQuery,
  clienteAdminSchema,
  equipeSchema,
  servicoSchema,
  produtoSchema,
  corteGaleriaSchema,
  visibilidadeSchema,
  configSchema,
  listaAgendamentosQuery,
  agendamentoEquipeSchema,
  statusAgendamentoSchema,
  remarcarSchema,
  bloqueioSchema,
  listaPedidosQuery,
  statusPedidoSchema,
} from "../validators/dominio.js";
import { z } from "zod";
import { obterConfig, salvarConfig } from "../services/configService.js";
import {
  INCLUDE_AGENDAMENTO,
  STATUS_ATIVOS,
  criarAgendamento,
  alterarStatus,
  remarcar,
  criarBloqueio,
  removerBloqueio,
  salvarDisponibilidade,
  validarJanelas,
} from "../services/agendaService.js";
import { avancarPedido, INCLUDE_PEDIDO } from "../services/lojaService.js";
import { solicitarRedefinicao } from "../services/authService.js";
import { dataLocal, inicioDoMes, localParaUtc, minutosParaTexto, somarDias, timeParaMinutos } from "../lib/tempo.js";

const router = Router();
const equipe = exigirPerfil("ADMIN", "BARBEIRO");
const soAdmin = exigirPerfil("ADMIN");
router.use(equipe);

const ehBarbeiro = (req) => req.usuario.tipo_perfil === "BARBEIRO";
const ativoSchema = z.object({ ativo: z.boolean({ error: "Informe se está ativo." }) });

async function enviarConvite(usuario) {
  if (!usuario.email) throw badRequest("Cadastre um e-mail para enviar o convite.");
  await solicitarRedefinicao(usuario.email, { assunto: "Seu acesso ao Studio Corte", motivo: "convite" });
}

// Cadastro já gravado: uma falha no envio do e-mail não desfaz o cadastro, vira aviso.
async function conviteSeguro(usuario) {
  try {
    await enviarConvite(usuario);
    return null;
  } catch (err) {
    console.error("[email] Falha ao enviar convite:", err.message);
    return "Cadastro salvo, mas o e-mail com o link de acesso não pôde ser enviado. Tente reenviar o convite.";
  }
}

async function emailLivre(email, ignorarId = null) {
  if (!email) return;
  const outro = await prisma.usuario.findFirst({
    where: { email, ...(ignorarId ? { id_usuario: { not: ignorarId } } : {}) },
    select: { id_usuario: true },
  });
  if (outro) throw conflict("Já existe uma conta com este e-mail.", [{ campo: "email", mensagem: "E-mail já cadastrado." }]);
}

async function cpfLivre(cpf, ignorarId = null) {
  if (!cpf) return;
  const outro = await prisma.usuario.findFirst({
    where: { cpf, ...(ignorarId ? { id_usuario: { not: ignorarId } } : {}) },
    select: { id_usuario: true },
  });
  if (outro) throw conflict("Este CPF já está cadastrado.", [{ campo: "cpf", mensagem: "CPF já cadastrado." }]);
}

// ═════════ DASHBOARD ═════════

router.get("/dashboard", soAdmin, async (_req, res) => {
  const cfg = await obterConfig();
  const tz = cfg.fuso_horario;
  const agora = new Date();
  const hoje = dataLocal(agora, tz);
  const inicioHoje = localParaUtc(hoje, 0, tz);
  const fimHoje = localParaUtc(somarDias(hoje, 1), 0, tz);
  const inicioMes = inicioDoMes(agora, tz);
  const inicioMesAnterior = inicioDoMes(agora, tz, -1);
  const doDia = { data_hora_inicio: { gte: inicioHoje, lt: fimHoje } };

  const faturamento = async (de, ate) => {
    const [s, p] = await Promise.all([
      prisma.agendamento.aggregate({
        where: { status: "CONCLUIDO", data_hora_inicio: { gte: de, lt: ate } },
        _sum: { preco_registrado: true },
      }),
      prisma.pedido.aggregate({ where: { status: "CONCLUIDO", data_pedido: { gte: de, lt: ate } }, _sum: { valor_total: true } }),
    ]);
    return new Prisma.Decimal(s._sum.preco_registrado ?? 0).add(p._sum.valor_total ?? 0);
  };

  const [
    totalClientes,
    novosClientes,
    atendimentosHoje,
    confirmadosHoje,
    fatMes,
    fatAnterior,
    notas,
    proximos,
    populares,
    tokens,
    pendentesAgenda,
    pendentesPedidos,
  ] = await Promise.all([
    prisma.usuario.count({ where: { tipo_perfil: "CLIENTE", ativo: true } }),
    prisma.usuario.count({ where: { tipo_perfil: "CLIENTE", data_cadastro: { gte: inicioMes } } }),
    prisma.agendamento.count({ where: { ...doDia, status: { in: STATUS_ATIVOS } } }),
    prisma.agendamento.count({ where: { ...doDia, status: { in: ["CONFIRMADO", "CONCLUIDO"] } } }),
    faturamento(inicioMes, fimHoje),
    faturamento(inicioMesAnterior, inicioMes),
    prisma.avaliacao.aggregate({ _avg: { nota: true }, _count: true }),
    prisma.agendamento.findMany({
      where: { ...doDia, status: { not: "CANCELADO" } },
      include: INCLUDE_AGENDAMENTO,
      orderBy: { data_hora_inicio: "asc" },
      take: 30,
    }),
    prisma.agendamento.groupBy({
      by: ["id_servico"],
      where: { status: { in: STATUS_ATIVOS } },
      _count: true,
      orderBy: { _count: { id_servico: "desc" } },
      take: 4,
    }),
    prisma.tokenRedefinicaoSenha.findMany({
      where: { data_criacao: { gte: new Date(agora.getTime() - 7 * 24 * 3600 * 1000) } },
      include: { usuario: { select: { nome_completo: true, email: true } } },
      orderBy: { data_criacao: "desc" },
      take: 5,
    }),
    prisma.agendamento.count({ where: { status: "PENDENTE", data_hora_inicio: { gt: agora } } }),
    prisma.pedido.count({ where: { status: "PENDENTE" } }),
  ]);

  const nomesServicos = await prisma.servico.findMany({
    where: { id_servico: { in: populares.map((p) => p.id_servico) } },
    select: { id_servico: true, nome_servico: true },
  });

  // Atividade recente: junta os eventos mais novos de cada tipo.
  const [favs, avals, ags, peds, cads] = await Promise.all([
    prisma.favorito.findMany({
      orderBy: { data_favorito: "desc" },
      take: 6,
      include: { cliente: { select: { nome_completo: true } }, corte: { select: { nome_corte: true } } },
    }),
    prisma.avaliacao.findMany({
      orderBy: { data_avaliacao: "desc" },
      take: 6,
      include: {
        agendamento: {
          select: {
            cliente: { select: { nome_completo: true } },
            barbeiro: { select: { nome_completo: true } },
            servico: { select: { nome_servico: true } },
          },
        },
      },
    }),
    prisma.agendamento.findMany({ orderBy: { data_criacao: "desc" }, take: 6, include: INCLUDE_AGENDAMENTO }),
    prisma.pedido.findMany({
      orderBy: { data_pedido: "desc" },
      take: 6,
      include: { cliente: { select: { nome_completo: true } }, itens: { select: { quantidade: true } } },
    }),
    prisma.usuario.findMany({
      where: { tipo_perfil: "CLIENTE" },
      orderBy: { data_cadastro: "desc" },
      take: 6,
      select: { nome_completo: true, data_cadastro: true },
    }),
  ]);
  const atividade = [
    ...favs.map((f) => ({ tipo: "favorito", quando: f.data_favorito, quem: f.cliente.nome_completo, alvo: f.corte.nome_corte })),
    ...avals.map((a) => ({
      tipo: "avaliacao",
      quando: a.data_avaliacao,
      quem: a.agendamento.cliente.nome_completo,
      alvo: a.agendamento.servico.nome_servico,
      profissional: a.agendamento.barbeiro.nome_completo,
      nota: a.nota,
    })),
    ...ags.map((a) => ({
      tipo: "agendamento",
      quando: a.data_criacao,
      quem: a.cliente.nome_completo,
      alvo: a.servico.nome_servico,
      inicio: a.data_hora_inicio,
    })),
    ...peds.map((p) => ({
      tipo: "pedido",
      quando: p.data_pedido,
      quem: p.cliente.nome_completo,
      itens: p.itens.reduce((s, i) => s + i.quantidade, 0),
      valor: p.valor_total,
    })),
    ...cads.map((c) => ({ tipo: "cadastro", quando: c.data_cadastro, quem: c.nome_completo })),
  ]
    .sort((a, b) => b.quando - a.quando)
    .slice(0, 8);

  const variacao = fatAnterior.isZero() ? null : fatMes.sub(fatAnterior).div(fatAnterior).mul(100).toFixed(1);

  res.json({
    hoje,
    metricas: {
      total_clientes: totalClientes,
      novos_clientes_mes: novosClientes,
      atendimentos_hoje: atendimentosHoje,
      confirmados_hoje: confirmadosHoje,
      faturamento_mes: fatMes.toFixed(2),
      variacao_faturamento: variacao,
      avaliacao_media: notas._avg.nota,
      total_avaliacoes: notas._count,
    },
    proximos,
    populares: populares.map((p) => ({
      id_servico: p.id_servico,
      nome_servico: nomesServicos.find((s) => s.id_servico === p.id_servico)?.nome_servico ?? "—",
      quantidade: p._count,
    })),
    atividade,
    solicitacoes_senha: tokens.map((t) => ({
      nome: t.usuario.nome_completo,
      email: t.usuario.email,
      data: t.data_criacao,
      usado: Boolean(t.usado_em),
    })),
    notificacoes: { agendamentos_pendentes: pendentesAgenda, pedidos_pendentes: pendentesPedidos },
  });
});

// ═════════ CLIENTES ═════════

function filtroBusca(busca) {
  if (!busca) return {};
  const digitos = busca.replace(/\D/g, "");
  return {
    OR: [
      { nome_completo: { contains: busca, mode: "insensitive" } },
      { email: { contains: busca.toLowerCase() } },
      ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }, { cpf: { contains: digitos } }] : []),
    ],
  };
}

// Opções para o select de cliente (equipe agenda pelo telefone/balcão)
router.get("/clientes/opcoes", validar({ query: buscaQuery }), async (req, res) => {
  const clientes = await prisma.usuario.findMany({
    where: { tipo_perfil: "CLIENTE", ativo: true, ...filtroBusca(req.valid.query.busca) },
    select: { id_usuario: true, nome_completo: true, telefone: true, email: true },
    orderBy: { nome_completo: "asc" },
    take: 20,
  });
  res.json({ clientes });
});

router.get("/clientes", soAdmin, validar({ query: buscaQuery }), async (req, res) => {
  const { busca, inativos } = req.valid.query;
  const clientes = await prisma.usuario.findMany({
    where: { tipo_perfil: "CLIENTE", ...(inativos ? {} : { ativo: true }), ...filtroBusca(busca) },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
    orderBy: { nome_completo: "asc" },
    take: 500,
  });
  const ids = clientes.map((c) => c.id_usuario);
  const [visitas, compras] = await Promise.all([
    prisma.agendamento.groupBy({
      by: ["id_cliente"],
      where: { id_cliente: { in: ids }, status: "CONCLUIDO" },
      _count: true,
      _sum: { preco_registrado: true },
      _max: { data_hora_inicio: true },
    }),
    prisma.pedido.groupBy({ by: ["id_cliente"], where: { id_cliente: { in: ids }, status: "CONCLUIDO" }, _sum: { valor_total: true } }),
  ]);
  res.json({
    clientes: clientes.map(({ senha_hash, ...c }) => {
      const v = visitas.find((x) => x.id_cliente === c.id_usuario);
      const p = compras.find((x) => x.id_cliente === c.id_usuario);
      return {
        ...c,
        tem_acesso: Boolean(senha_hash),
        visitas: v?._count ?? 0,
        total_gasto: new Prisma.Decimal(v?._sum.preco_registrado ?? 0).add(p?._sum.valor_total ?? 0).toFixed(2),
        ultima_visita: v?._max.data_hora_inicio ?? null,
      };
    }),
  });
});

router.post("/clientes", soAdmin, validar({ body: clienteAdminSchema }), async (req, res) => {
  const { enviar_convite, ...dados } = req.valid.body;
  await emailLivre(dados.email);
  await cpfLivre(dados.cpf);
  const cliente = await prisma.usuario.create({
    data: {
      nome_completo: dados.nome_completo,
      email: dados.email ?? null,
      telefone: dados.telefone,
      cpf: dados.cpf ?? null,
      data_nascimento: dados.data_nascimento ?? null,
      tipo_perfil: "CLIENTE",
    },
    select: CAMPOS_USUARIO_PUBLICO,
  });
  const aviso = enviar_convite && cliente.email ? await conviteSeguro(cliente) : null;
  res.status(201).json({ cliente, aviso });
});

async function clienteDoPainel(id) {
  const c = await prisma.usuario.findFirst({ where: { id_usuario: id, tipo_perfil: "CLIENTE" }, select: CAMPOS_USUARIO_PUBLICO });
  if (!c) throw notFound("Cliente não encontrado.");
  return c;
}

router.get("/clientes/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  const cliente = await clienteDoPainel(req.valid.params.id);
  const [agendamentos, pedidos] = await Promise.all([
    prisma.agendamento.findMany({
      where: { id_cliente: cliente.id_usuario },
      include: INCLUDE_AGENDAMENTO,
      orderBy: { data_hora_inicio: "desc" },
      take: 50,
    }),
    prisma.pedido.findMany({ where: { id_cliente: cliente.id_usuario }, include: INCLUDE_PEDIDO, orderBy: { data_pedido: "desc" }, take: 50 }),
  ]);
  res.json({ cliente, agendamentos, pedidos });
});

router.put("/clientes/:id", soAdmin, validar({ params: idParam, body: clienteAdminSchema }), async (req, res) => {
  const atual = await clienteDoPainel(req.valid.params.id);
  const { enviar_convite, ...dados } = req.valid.body;
  if (atual.email && !dados.email) throw badRequest("O e-mail de acesso de um cliente não pode ser apagado.");
  await emailLivre(dados.email, atual.id_usuario);
  await cpfLivre(dados.cpf, atual.id_usuario);
  const cliente = await prisma.usuario.update({
    where: { id_usuario: atual.id_usuario },
    data: {
      nome_completo: dados.nome_completo,
      email: dados.email ?? null,
      telefone: dados.telefone,
      cpf: dados.cpf ?? null,
      data_nascimento: dados.data_nascimento ?? null,
    },
    select: CAMPOS_USUARIO_PUBLICO,
  });
  const aviso = enviar_convite && cliente.email ? await conviteSeguro(cliente) : null;
  res.json({ cliente, aviso });
});

router.patch("/clientes/:id/ativo", soAdmin, validar({ params: idParam, body: ativoSchema }), async (req, res) => {
  const atual = await clienteDoPainel(req.valid.params.id);
  const cliente = await prisma.usuario.update({
    where: { id_usuario: atual.id_usuario },
    data: { ativo: req.valid.body.ativo },
    select: CAMPOS_USUARIO_PUBLICO,
  });
  res.json({ cliente });
});

router.post("/clientes/:id/convite", soAdmin, validar({ params: idParam }), async (req, res) => {
  await enviarConvite(await clienteDoPainel(req.valid.params.id));
  res.json({ mensagem: "Link de acesso enviado para o e-mail do cliente." });
});

// ═════════ EQUIPE (profissionais e administradores) ═════════

const SELECT_EQUIPE = {
  ...CAMPOS_USUARIO_PUBLICO,
  senha_hash: true,
  servicos_oferecidos: { select: { id_servico: true } },
  disponibilidades: { orderBy: [{ dia_semana: "asc" }, { hora_inicio: "asc" }] },
};

const formatarMembro = ({ senha_hash, servicos_oferecidos, disponibilidades, ...m }) => ({
  ...m,
  tem_acesso: Boolean(senha_hash),
  servicos: servicos_oferecidos.map((s) => s.id_servico),
  disponibilidade: disponibilidades.map((d) => ({
    dia_semana: d.dia_semana,
    inicio: minutosParaTexto(timeParaMinutos(d.hora_inicio)),
    fim: minutosParaTexto(timeParaMinutos(d.hora_fim)),
  })),
});

router.get("/equipe", async (req, res) => {
  const membros = await prisma.usuario.findMany({
    where: { tipo_perfil: { in: ["BARBEIRO", "ADMIN"] }, ...(ehBarbeiro(req) ? { id_usuario: req.usuario.id_usuario } : {}) },
    select: SELECT_EQUIPE,
    orderBy: [{ ativo: "desc" }, { nome_completo: "asc" }],
  });
  res.json({ equipe: membros.map(formatarMembro) });
});

async function servicosExistem(ids) {
  if (!ids.length) return;
  const n = await prisma.servico.count({ where: { id_servico: { in: ids } } });
  if (n !== new Set(ids).size) throw badRequest("Algum dos serviços selecionados não existe.");
}

router.post("/equipe", soAdmin, validar({ body: equipeSchema }), async (req, res) => {
  const d = req.valid.body;
  validarJanelas(d.disponibilidade);
  await emailLivre(d.email);
  await servicosExistem(d.servicos);
  const membro = await prisma.usuario.create({
    data: {
      nome_completo: d.nome_completo,
      email: d.email,
      telefone: d.telefone ?? null,
      tipo_perfil: d.tipo_perfil,
      avatar_url: d.avatar_url ?? null,
      servicos_oferecidos: { create: [...new Set(d.servicos)].map((id_servico) => ({ id_servico })) },
    },
    select: { id_usuario: true, email: true },
  });
  await salvarDisponibilidade(membro.id_usuario, d.disponibilidade);
  const aviso = await conviteSeguro(membro);
  const criado = await prisma.usuario.findUnique({ where: { id_usuario: membro.id_usuario }, select: SELECT_EQUIPE });
  res.status(201).json({ membro: formatarMembro(criado), aviso });
});

async function membroDaEquipe(id) {
  const m = await prisma.usuario.findFirst({
    where: { id_usuario: id, tipo_perfil: { in: ["BARBEIRO", "ADMIN"] } },
    select: { id_usuario: true, tipo_perfil: true, ativo: true, email: true },
  });
  if (!m) throw notFound("Membro da equipe não encontrado.");
  return m;
}

async function garantirOutroAdmin(idSaindo) {
  const outros = await prisma.usuario.count({
    where: { tipo_perfil: "ADMIN", ativo: true, id_usuario: { not: idSaindo } },
  });
  if (!outros) throw conflict("O sistema precisa de pelo menos um administrador ativo.");
}

router.put("/equipe/:id", soAdmin, validar({ params: idParam, body: equipeSchema }), async (req, res) => {
  const atual = await membroDaEquipe(req.valid.params.id);
  const d = req.valid.body;
  if (atual.tipo_perfil === "ADMIN" && d.tipo_perfil !== "ADMIN") {
    if (atual.id_usuario === req.usuario.id_usuario) throw conflict("Você não pode remover o seu próprio acesso de administrador.");
    await garantirOutroAdmin(atual.id_usuario);
  }
  validarJanelas(d.disponibilidade);
  await emailLivre(d.email, atual.id_usuario);
  await servicosExistem(d.servicos);
  await prisma.$transaction([
    prisma.usuario.update({
      where: { id_usuario: atual.id_usuario },
      data: {
        nome_completo: d.nome_completo,
        email: d.email,
        telefone: d.telefone ?? null,
        tipo_perfil: d.tipo_perfil,
        avatar_url: d.avatar_url ?? null,
      },
    }),
    prisma.barbeiroServico.deleteMany({ where: { id_barbeiro: atual.id_usuario } }),
    prisma.barbeiroServico.createMany({
      data: [...new Set(d.servicos)].map((id_servico) => ({ id_barbeiro: atual.id_usuario, id_servico })),
    }),
  ]);
  await salvarDisponibilidade(atual.id_usuario, d.disponibilidade);
  const membro = await prisma.usuario.findUnique({ where: { id_usuario: atual.id_usuario }, select: SELECT_EQUIPE });
  res.json({ membro: formatarMembro(membro) });
});

router.patch("/equipe/:id/ativo", soAdmin, validar({ params: idParam, body: ativoSchema }), async (req, res) => {
  const atual = await membroDaEquipe(req.valid.params.id);
  if (!req.valid.body.ativo) {
    if (atual.id_usuario === req.usuario.id_usuario) throw conflict("Você não pode desativar a sua própria conta.");
    if (atual.tipo_perfil === "ADMIN") await garantirOutroAdmin(atual.id_usuario);
    const futuros = await prisma.agendamento.count({
      where: { id_barbeiro: atual.id_usuario, status: { in: ["PENDENTE", "CONFIRMADO"] }, data_hora_inicio: { gt: new Date() } },
    });
    if (futuros) throw conflict(`Este profissional tem ${futuros} agendamento(s) futuro(s). Remarque ou cancele antes de desativar.`);
  }
  await prisma.usuario.update({ where: { id_usuario: atual.id_usuario }, data: { ativo: req.valid.body.ativo } });
  const membro = await prisma.usuario.findUnique({ where: { id_usuario: atual.id_usuario }, select: SELECT_EQUIPE });
  res.json({ membro: formatarMembro(membro) });
});

router.post("/equipe/:id/convite", soAdmin, validar({ params: idParam }), async (req, res) => {
  await enviarConvite(await membroDaEquipe(req.valid.params.id));
  res.json({ mensagem: "Link de acesso enviado por e-mail." });
});

// ═════════ BLOQUEIOS DE AGENDA ═════════

router.get("/bloqueios", validar({ query: z.object({ profissional: z.coerce.number().int().positive().optional() }) }), async (req, res) => {
  const idBarbeiro = ehBarbeiro(req) ? req.usuario.id_usuario : req.valid.query.profissional;
  const bloqueios = await prisma.bloqueioAgenda.findMany({
    where: { data_hora_fim: { gt: new Date() }, ...(idBarbeiro ? { id_barbeiro: idBarbeiro } : {}) },
    include: { barbeiro: { select: { id_usuario: true, nome_completo: true } } },
    orderBy: { data_hora_inicio: "asc" },
    take: 200,
  });
  res.json({ bloqueios });
});

router.post("/bloqueios", validar({ body: bloqueioSchema }), async (req, res) => {
  const b = req.valid.body;
  const bloqueio = await criarBloqueio({ id_barbeiro: b.id_barbeiro, inicio: b.inicio, fim: b.fim, motivo: b.motivo ?? null, ator: req.usuario });
  res.status(201).json({ bloqueio });
});

router.delete("/bloqueios/:id", validar({ params: idParam }), async (req, res) => {
  await removerBloqueio(req.valid.params.id, req.usuario);
  res.json({ ok: true });
});

// ═════════ AGENDAMENTOS ═════════

router.get("/agendamentos", validar({ query: listaAgendamentosQuery }), async (req, res) => {
  const q = req.valid.query;
  const cfg = await obterConfig();
  const tz = cfg.fuso_horario;
  const where = {};
  if (q.data) {
    where.data_hora_inicio = {
      gte: localParaUtc(q.data, 0, tz),
      lt: localParaUtc(somarDias(q.ate && q.ate >= q.data ? q.ate : q.data, 1), 0, tz),
    };
  }
  if (q.status) where.status = q.status;
  if (ehBarbeiro(req)) where.id_barbeiro = req.usuario.id_usuario;
  else if (q.profissional) where.id_barbeiro = q.profissional;
  if (q.busca) {
    where.OR = [
      { cliente: { nome_completo: { contains: q.busca, mode: "insensitive" } } },
      { servico: { nome_servico: { contains: q.busca, mode: "insensitive" } } },
      { barbeiro: { nome_completo: { contains: q.busca, mode: "insensitive" } } },
      ...(q.busca.replace(/\D/g, "").length >= 3 ? [{ cliente: { telefone: { contains: q.busca.replace(/\D/g, "") } } }] : []),
    ];
  }
  const agendamentos = await prisma.agendamento.findMany({
    where,
    include: INCLUDE_AGENDAMENTO,
    orderBy: { data_hora_inicio: q.data ? "asc" : "desc" },
    take: 300,
  });
  res.json({ agendamentos });
});

router.post("/agendamentos", validar({ body: agendamentoEquipeSchema }), async (req, res) => {
  const b = req.valid.body;
  const idBarbeiro = ehBarbeiro(req) ? req.usuario.id_usuario : b.id_barbeiro ?? null;
  if (ehBarbeiro(req) && b.id_barbeiro && b.id_barbeiro !== req.usuario.id_usuario) throw forbidden();
  const agendamento = await criarAgendamento({
    id_cliente: b.id_cliente,
    id_servico: b.id_servico,
    id_barbeiro: idBarbeiro,
    inicio: b.inicio,
    observacao: b.observacao ?? null,
    porEquipe: true,
    status: b.status,
  });
  res.status(201).json({ agendamento });
});

router.patch("/agendamentos/:id/status", validar({ params: idParam, body: statusAgendamentoSchema }), async (req, res) => {
  const agendamento = await alterarStatus({
    id: req.valid.params.id,
    status: req.valid.body.status,
    motivo: req.valid.body.motivo ?? null,
    ator: req.usuario,
  });
  res.json({ agendamento });
});

router.put("/agendamentos/:id", validar({ params: idParam, body: remarcarSchema }), async (req, res) => {
  const agendamento = await remarcar({ id: req.valid.params.id, ...req.valid.body, ator: req.usuario });
  res.json({ agendamento });
});

// ═════════ SERVIÇOS ═════════

router.get("/servicos", async (_req, res) => {
  const servicos = await prisma.servico.findMany({
    orderBy: [{ ativo: "desc" }, { ordem_exibicao: "asc" }, { nome_servico: "asc" }],
    include: { _count: { select: { agendamentos: true, barbeiros: true } } },
  });
  res.json({ servicos });
});

router.post("/servicos", soAdmin, validar({ body: servicoSchema }), async (req, res) => {
  res.status(201).json({ servico: await prisma.servico.create({ data: req.valid.body }) });
});

router.put("/servicos/:id", soAdmin, validar({ params: idParam, body: servicoSchema }), async (req, res) => {
  res.json({ servico: await prisma.servico.update({ where: { id_servico: req.valid.params.id }, data: req.valid.body }) });
});

// Remoção lógica: preserva o histórico de agendamentos.
router.delete("/servicos/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  const futuros = await prisma.agendamento.count({
    where: { id_servico: req.valid.params.id, status: { in: ["PENDENTE", "CONFIRMADO"] }, data_hora_inicio: { gt: new Date() } },
  });
  if (futuros) throw conflict(`Há ${futuros} agendamento(s) futuro(s) deste serviço. Conclua ou cancele antes de desativá-lo.`);
  res.json({ servico: await prisma.servico.update({ where: { id_servico: req.valid.params.id }, data: { ativo: false } }) });
});

// ═════════ PRODUTOS ═════════

router.get("/produtos", soAdmin, async (_req, res) => {
  const produtos = await prisma.produto.findMany({ orderBy: [{ ativo: "desc" }, { nome_produto: "asc" }] });
  res.json({ produtos });
});

router.post("/produtos", soAdmin, validar({ body: produtoSchema }), async (req, res) => {
  res.status(201).json({ produto: await prisma.produto.create({ data: req.valid.body }) });
});

router.put("/produtos/:id", soAdmin, validar({ params: idParam, body: produtoSchema }), async (req, res) => {
  const produto = await prisma.produto.update({ where: { id_produto: req.valid.params.id }, data: req.valid.body });
  if (!produto.ativo) await prisma.itemCarrinho.deleteMany({ where: { id_produto: produto.id_produto } });
  res.json({ produto });
});

router.delete("/produtos/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  const [produto] = await prisma.$transaction([
    prisma.produto.update({ where: { id_produto: req.valid.params.id }, data: { ativo: false } }),
    prisma.itemCarrinho.deleteMany({ where: { id_produto: req.valid.params.id } }),
  ]);
  res.json({ produto });
});

// ═════════ PEDIDOS ═════════

router.get("/pedidos", soAdmin, validar({ query: listaPedidosQuery }), async (req, res) => {
  const { status, busca } = req.valid.query;
  const pedidos = await prisma.pedido.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(busca ? { cliente: filtroBusca(busca) } : {}),
    },
    include: INCLUDE_PEDIDO,
    orderBy: { data_pedido: "desc" },
    take: 300,
  });
  res.json({ pedidos });
});

router.patch("/pedidos/:id/status", soAdmin, validar({ params: idParam, body: statusPedidoSchema }), async (req, res) => {
  res.json({ pedido: await avancarPedido(req.valid.params.id, req.valid.body.status) });
});

// ═════════ GALERIA ═════════

router.get("/galeria", soAdmin, async (_req, res) => {
  const cortes = await prisma.corteGaleria.findMany({
    orderBy: [{ ativo: "desc" }, { ordem_exibicao: "asc" }, { id_corte: "asc" }],
    include: { _count: { select: { favoritos: true } } },
  });
  res.json({ cortes });
});

router.post("/galeria", soAdmin, validar({ body: corteGaleriaSchema }), async (req, res) => {
  res.status(201).json({ corte: await prisma.corteGaleria.create({ data: req.valid.body }) });
});

router.put("/galeria/:id", soAdmin, validar({ params: idParam, body: corteGaleriaSchema }), async (req, res) => {
  res.json({ corte: await prisma.corteGaleria.update({ where: { id_corte: req.valid.params.id }, data: req.valid.body }) });
});

router.delete("/galeria/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  res.json({ corte: await prisma.corteGaleria.update({ where: { id_corte: req.valid.params.id }, data: { ativo: false } }) });
});

// ═════════ AVALIAÇÕES (moderação) ═════════

router.get("/avaliacoes", soAdmin, async (_req, res) => {
  const avaliacoes = await prisma.avaliacao.findMany({
    orderBy: { data_avaliacao: "desc" },
    take: 300,
    include: {
      agendamento: {
        select: {
          data_hora_inicio: true,
          cliente: { select: { nome_completo: true } },
          barbeiro: { select: { nome_completo: true } },
          servico: { select: { nome_servico: true } },
        },
      },
    },
  });
  res.json({ avaliacoes });
});

router.patch("/avaliacoes/:id", soAdmin, validar({ params: idParam, body: visibilidadeSchema }), async (req, res) => {
  res.json({
    avaliacao: await prisma.avaliacao.update({ where: { id_avaliacao: req.valid.params.id }, data: { visivel: req.valid.body.visivel } }),
  });
});

// ═════════ CONFIGURAÇÕES ═════════

router.get("/config", soAdmin, async (_req, res) => {
  res.json({ config: await obterConfig() });
});

router.patch("/config", soAdmin, validar({ body: configSchema.partial() }), async (req, res) => {
  const dados = Object.fromEntries(Object.entries(req.valid.body).filter(([, v]) => v !== undefined));
  if (!Object.keys(dados).length) throw badRequest("Nada para salvar.");
  res.json({ config: await salvarConfig(dados) });
});

export default router;
