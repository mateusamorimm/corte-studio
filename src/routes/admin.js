// Painel administrativo (/api/admin).
// ADMIN acessa tudo. BARBEIRO acessa a própria agenda (agendamentos e bloqueios) e os cortes que publicou.
// RECEPCIONISTA acessa dashboard (sem faturamento), agenda, pedidos, reservas e clientes.
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
  criarAgendamentos,
  registrarChegada,
  alterarStatus,
  remarcar,
  criarBloqueio,
  removerBloqueio,
  salvarDisponibilidade,
  validarJanelas,
} from "../services/agendaService.js";
import { avancarPedido, INCLUDE_PEDIDO } from "../services/lojaService.js";
import { usuarioLivre } from "../services/authService.js";
import { convidar as conviteSeguro, enviarConvite } from "../services/conviteService.js";
import { INCLUDE_AVALIACAO, avaliacaoPainel, moderarAvaliacao } from "../services/avaliacaoService.js";
import { situacao } from "../services/fidelidadeService.js";
import { favoritosDe } from "../services/perfilService.js";
import { registrarLog } from "../services/logService.js";
import { urlPertenceAoUsuario } from "../services/midiaService.js";
import gestaoRoutes from "./gestao.js";
import { dataLocal, inicioDoMes, localParaUtc, minutosParaTexto, somarDias, timeParaMinutos } from "../lib/tempo.js";

const router = Router();
const soAdmin = exigirPerfil("ADMIN");
const balcao = exigirPerfil("ADMIN", "RECEPCIONISTA");
const quemCorta = exigirPerfil("ADMIN", "BARBEIRO");
router.use(exigirPerfil("ADMIN", "BARBEIRO", "RECEPCIONISTA"));
router.use(gestaoRoutes);

const ehBarbeiro = (req) => req.usuario.tipo_perfil === "BARBEIRO";
const ehRecepcao = (req) => req.usuario.tipo_perfil === "RECEPCIONISTA";
const ativoSchema = z.object({ ativo: z.boolean({ error: "Informe se está ativo." }) });

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

router.get("/dashboard", balcao, async (req, res) => {
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
    reservasVisitante,
    avaliacoesPendentes,
    postsPendentes,
    comentariosPendentes,
    denuncias,
  ] = await Promise.all([
    prisma.usuario.count({ where: { tipo_perfil: "CLIENTE", ativo: true, visitante: false } }),
    prisma.usuario.count({ where: { tipo_perfil: "CLIENTE", visitante: false, data_cadastro: { gte: inicioMes } } }),
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
    prisma.agendamentoServico.groupBy({
      by: ["id_servico"],
      where: { agendamento: { status: { in: STATUS_ATIVOS } } },
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
    prisma.reserva.count({ where: { visitante: true, status: "ATIVA" } }),
    prisma.avaliacao.count({ where: { status_moderacao: "PENDENTE" } }),
    prisma.post.count({ where: { status_moderacao: "PENDENTE" } }),
    prisma.postComentario.count({ where: { status_moderacao: "PENDENTE" } }),
    prisma.denuncia.count({ where: { resolvida_em: null } }),
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
      include: INCLUDE_AVALIACAO,
    }),
    prisma.agendamento.findMany({ orderBy: { data_criacao: "desc" }, take: 6, include: INCLUDE_AGENDAMENTO }),
    prisma.pedido.findMany({
      orderBy: { data_pedido: "desc" },
      take: 6,
      include: { cliente: { select: { nome_completo: true } }, itens: { select: { quantidade: true } } },
    }),
    prisma.usuario.findMany({
      where: { tipo_perfil: "CLIENTE", visitante: false },
      orderBy: { data_cadastro: "desc" },
      take: 6,
      select: { nome_completo: true, data_cadastro: true },
    }),
  ]);
  const atividade = [
    ...favs.map((f) => ({ tipo: "favorito", quando: f.data_favorito, quem: f.cliente.nome_completo, alvo: f.corte.nome_corte })),
    ...avals.map(avaliacaoPainel).map((a) => ({
      tipo: "avaliacao",
      quando: a.data_avaliacao,
      quem: a.cliente,
      alvo: a.referencia,
      profissional: a.profissional,
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

  const admin = req.usuario.tipo_perfil === "ADMIN"; // recepção não vê faturamento nem pedidos de senha
  const variacao = fatAnterior.isZero() ? null : fatMes.sub(fatAnterior).div(fatAnterior).mul(100).toFixed(1);

  res.json({
    hoje,
    metricas: {
      total_clientes: totalClientes,
      novos_clientes_mes: novosClientes,
      atendimentos_hoje: atendimentosHoje,
      confirmados_hoje: confirmadosHoje,
      faturamento_mes: admin ? fatMes.toFixed(2) : null,
      variacao_faturamento: admin ? variacao : null,
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
    solicitacoes_senha: (admin ? tokens : []).map((t) => ({
      nome: t.usuario.nome_completo,
      email: t.usuario.email,
      data: t.data_criacao,
      usado: Boolean(t.usado_em),
    })),
    notificacoes: {
      agendamentos_pendentes: pendentesAgenda,
      pedidos_pendentes: pendentesPedidos,
      reservas_visitante: reservasVisitante,
      ...(admin
        ? { avaliacoes_pendentes: avaliacoesPendentes, posts_pendentes: postsPendentes, comentarios_pendentes: comentariosPendentes, denuncias }
        : {}),
    },
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
    where: { tipo_perfil: "CLIENTE", ativo: true, visitante: false, ...filtroBusca(req.valid.query.busca) },
    select: { id_usuario: true, nome_completo: true, telefone: true, email: true },
    orderBy: { nome_completo: "asc" },
    take: 20,
  });
  res.json({ clientes });
});

router.get("/clientes", balcao, validar({ query: buscaQuery }), async (req, res) => {
  const { busca, inativos } = req.valid.query;
  const clientes = await prisma.usuario.findMany({
    where: { tipo_perfil: "CLIENTE", visitante: false, ...(inativos ? {} : { ativo: true }), ...filtroBusca(busca) },
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

router.post("/clientes", balcao, validar({ body: clienteAdminSchema }), async (req, res) => {
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
  await registrarLog("cliente.criacao", { autor: req.usuario, entidade: "usuario", id: cliente.id_usuario });
  const aviso = enviar_convite && cliente.email ? await conviteSeguro(cliente) : null;
  res.status(201).json({ cliente, aviso });
});

async function clienteDoPainel(id) {
  const c = await prisma.usuario.findFirst({ where: { id_usuario: id, tipo_perfil: "CLIENTE" }, select: CAMPOS_USUARIO_PUBLICO });
  if (!c) throw notFound("Cliente não encontrado.");
  return c;
}

router.get("/clientes/:id", balcao, validar({ params: idParam }), async (req, res) => {
  const cliente = await clienteDoPainel(req.valid.params.id);
  const [fidelidade, favoritos, redes, concluidos, faltas, agendamentos, pedidos] = await Promise.all([
    situacao(cliente.id_usuario),
    favoritosDe(cliente.id_usuario),
    prisma.redeSocialUsuario.findMany({ where: { id_usuario: cliente.id_usuario }, orderBy: { ordem: "asc" }, select: { rede: true, rotulo: true, url: true } }),
    prisma.agendamento.aggregate({ where: { id_cliente: cliente.id_usuario, status: "CONCLUIDO" }, _count: true, _sum: { preco_registrado: true }, _max: { data_hora_inicio: true } }),
    prisma.agendamento.count({ where: { id_cliente: cliente.id_usuario, status: "NAO_COMPARECEU" } }),
    prisma.agendamento.findMany({
      where: { id_cliente: cliente.id_usuario },
      include: INCLUDE_AGENDAMENTO,
      orderBy: { data_hora_inicio: "desc" },
      take: 50,
    }),
    prisma.pedido.findMany({ where: { id_cliente: cliente.id_usuario }, include: INCLUDE_PEDIDO, orderBy: { data_pedido: "desc" }, take: 50 }),
  ]);
  const compras = pedidos.filter((p) => p.status === "CONCLUIDO").reduce((t, p) => t.add(p.valor_total), new Prisma.Decimal(0));
  res.json({
    cliente,
    agendamentos,
    pedidos,
    fidelidade,
    favoritos,
    redes,
    estatisticas: {
      visitas: concluidos._count,
      faltas,
      ultima_visita: concluidos._max.data_hora_inicio,
      total_gasto: compras.add(concluidos._sum.preco_registrado ?? 0).toFixed(2),
      compras: pedidos.filter((p) => p.status === "CONCLUIDO").length,
    },
  });
});

router.put("/clientes/:id", balcao, validar({ params: idParam, body: clienteAdminSchema }), async (req, res) => {
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
  await registrarLog("cliente.edicao", { autor: req.usuario, entidade: "usuario", id: cliente.id_usuario });
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
  await registrarLog(req.valid.body.ativo ? "cliente.reativacao" : "cliente.desativacao", { autor: req.usuario, entidade: "usuario", id: cliente.id_usuario });
  res.json({ cliente });
});

router.post("/clientes/:id/convite", balcao, validar({ params: idParam }), async (req, res) => {
  await enviarConvite(await clienteDoPainel(req.valid.params.id));
  res.json({ mensagem: "Link de acesso enviado para o e-mail do cliente." });
});

// ═════════ EQUIPE (profissionais e administradores) ═════════

const SELECT_EQUIPE = {
  ...CAMPOS_USUARIO_PUBLICO,
  senha_hash: true,
  servicos_oferecidos: { select: { id_servico: true } },
  disponibilidades: { orderBy: [{ dia_semana: "asc" }, { hora_inicio: "asc" }] },
  perfil_profissional: true,
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
  // A recepção precisa dos nomes, serviços e horários para agendar — não dos dados pessoais da equipe.
  const reduzir = ({ id_usuario, nome_completo, avatar_url, tipo_perfil, ativo, servicos, disponibilidade, perfil_profissional }) => ({
    id_usuario, nome_completo, avatar_url, tipo_perfil, ativo, servicos, disponibilidade, perfil_profissional,
  });
  const lista = membros.map(formatarMembro);
  res.json({ equipe: ehRecepcao(req) ? lista.filter((m) => m.ativo).map(reduzir) : lista });
});

const dadosPerfil = ({ bio, ...perfil }) => perfil;

async function servicosExistem(ids) {
  if (!ids.length) return;
  const n = await prisma.servico.count({ where: { id_servico: { in: ids } } });
  if (n !== new Set(ids).size) throw badRequest("Algum dos serviços selecionados não existe.");
}

router.post("/equipe", soAdmin, validar({ body: equipeSchema }), async (req, res) => {
  const d = req.valid.body;
  validarJanelas(d.disponibilidade);
  await emailLivre(d.email);
  if (d.usuario) await usuarioLivre(d.usuario);
  await servicosExistem(d.servicos);
  const membro = await prisma.usuario.create({
    data: {
      nome_completo: d.nome_completo,
      email: d.email,
      telefone: d.telefone ?? null,
      tipo_perfil: d.tipo_perfil,
      avatar_url: d.avatar_url ?? null,
      usuario: d.usuario ?? null,
      ...(d.perfil ? { bio: d.perfil.bio ?? null, perfil_profissional: { create: dadosPerfil(d.perfil) } } : {}),
      servicos_oferecidos: { create: [...new Set(d.servicos)].map((id_servico) => ({ id_servico })) },
    },
    select: { id_usuario: true, email: true },
  });
  await salvarDisponibilidade(membro.id_usuario, d.disponibilidade);
  await registrarLog("equipe.criacao", { autor: req.usuario, entidade: "usuario", id: membro.id_usuario, detalhes: { perfil: d.tipo_perfil } });
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
  if (d.usuario) await usuarioLivre(d.usuario, atual.id_usuario);
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
        ...(d.usuario === undefined ? {} : { usuario: d.usuario }),
        ...(d.perfil?.bio === undefined ? {} : { bio: d.perfil.bio }),
      },
    }),
    ...(d.perfil
      ? [prisma.perfilProfissional.upsert({ where: { id_usuario: atual.id_usuario }, create: { id_usuario: atual.id_usuario, ...dadosPerfil(d.perfil) }, update: dadosPerfil(d.perfil) })]
      : []),
    prisma.barbeiroServico.deleteMany({ where: { id_barbeiro: atual.id_usuario } }),
    prisma.barbeiroServico.createMany({
      data: [...new Set(d.servicos)].map((id_servico) => ({ id_barbeiro: atual.id_usuario, id_servico })),
    }),
  ]);
  await salvarDisponibilidade(atual.id_usuario, d.disponibilidade);
  await registrarLog("equipe.edicao", { autor: req.usuario, entidade: "usuario", id: atual.id_usuario, detalhes: { perfil: d.tipo_perfil } });
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
  await registrarLog(req.valid.body.ativo ? "equipe.reativacao" : "equipe.desativacao", { autor: req.usuario, entidade: "usuario", id: atual.id_usuario });
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

router.post("/bloqueios", quemCorta, validar({ body: bloqueioSchema }), async (req, res) => {
  const b = req.valid.body;
  const bloqueio = await criarBloqueio({ id_barbeiro: b.id_barbeiro, inicio: b.inicio, fim: b.fim, motivo: b.motivo ?? null, ator: req.usuario });
  res.status(201).json({ bloqueio });
});

router.delete("/bloqueios/:id", quemCorta, validar({ params: idParam }), async (req, res) => {
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
      ...(/^[A-Za-z0-9]{6}$/.test(q.busca) ? [{ reserva: { codigo: q.busca.toUpperCase() } }] : []),
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
  const { reserva, agendamentos } = await criarAgendamentos({
    id_cliente: b.id_cliente,
    servicos: b.servicos,
    id_barbeiro: idBarbeiro,
    inicio: b.inicio,
    pessoas: b.pessoas,
    cortes: b.cortes,
    observacao: b.observacao ?? null,
    porEquipe: true,
    status: b.status,
  });
  await registrarLog("agendamento.criacao", { autor: req.usuario, entidade: "agendamento", id: agendamentos[0].id_agendamento, detalhes: { codigo: reserva.codigo } });
  res.status(201).json({ agendamento: agendamentos[0], agendamentos, codigo: reserva.codigo });
});

router.post("/agendamentos/:id/chegada", validar({ params: idParam }), async (req, res) => {
  res.json({ agendamento: await registrarChegada(req.valid.params.id, req.usuario) });
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
    include: { _count: { select: { itens_agenda: true, barbeiros: true } } },
  });
  res.json({ servicos });
});

router.post("/servicos", soAdmin, validar({ body: servicoSchema }), async (req, res) => {
  const servico = await prisma.servico.create({ data: req.valid.body });
  await registrarLog("servico.criacao", { autor: req.usuario, entidade: "servico", id: servico.id_servico });
  res.status(201).json({ servico });
});

router.put("/servicos/:id", soAdmin, validar({ params: idParam, body: servicoSchema }), async (req, res) => {
  const servico = await prisma.servico.update({ where: { id_servico: req.valid.params.id }, data: req.valid.body });
  await registrarLog("servico.edicao", { autor: req.usuario, entidade: "servico", id: servico.id_servico });
  res.json({ servico });
});

// Remoção lógica: preserva o histórico de agendamentos.
router.delete("/servicos/:id", soAdmin, validar({ params: idParam }), async (req, res) => {
  const futuros = await prisma.agendamento.count({
    where: {
      OR: [{ id_servico: req.valid.params.id }, { servicos: { some: { id_servico: req.valid.params.id } } }],
      status: { in: ["PENDENTE", "CONFIRMADO"] },
      data_hora_inicio: { gt: new Date() },
    },
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
  const produto = await prisma.produto.create({ data: req.valid.body });
  await registrarLog("produto.criacao", { autor: req.usuario, entidade: "produto", id: produto.id_produto });
  res.status(201).json({ produto });
});

router.put("/produtos/:id", soAdmin, validar({ params: idParam, body: produtoSchema }), async (req, res) => {
  const produto = await prisma.produto.update({ where: { id_produto: req.valid.params.id }, data: req.valid.body });
  await registrarLog("produto.edicao", { autor: req.usuario, entidade: "produto", id: produto.id_produto, detalhes: { estoque: produto.quantidade_estoque } });
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

router.get("/pedidos", balcao, validar({ query: listaPedidosQuery }), async (req, res) => {
  const { status, busca, visitante } = req.valid.query;
  const pedidos = await prisma.pedido.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(visitante === undefined ? {} : visitante ? { reserva: { visitante: true } } : { OR: [{ id_reserva: null }, { reserva: { visitante: false } }] }),
      ...(busca ? { AND: [{ OR: [{ cliente: filtroBusca(busca) }, { reserva: { codigo: busca.toUpperCase().slice(0, 6) } }] }] } : {}),
    },
    include: INCLUDE_PEDIDO,
    orderBy: { data_pedido: "desc" },
    take: 300,
  });
  res.json({ pedidos });
});

router.patch("/pedidos/:id/status", balcao, validar({ params: idParam, body: statusPedidoSchema }), async (req, res) => {
  res.json({ pedido: await avancarPedido(req.valid.params.id, req.valid.body.status, req.usuario) });
});

// ═════════ GALERIA ═════════

// Profissional vê e edita só os cortes que publicou; o administrador, todos.
const INCLUDE_CORTE = { _count: { select: { favoritos: true } }, autor: { select: { id_usuario: true, nome_completo: true } } };

router.get("/galeria", quemCorta, async (req, res) => {
  const cortes = await prisma.corteGaleria.findMany({
    where: ehBarbeiro(req) ? { id_autor: req.usuario.id_usuario } : {},
    orderBy: [{ ativo: "desc" }, { ordem_exibicao: "asc" }, { id_corte: "asc" }],
    include: INCLUDE_CORTE,
  });
  res.json({ cortes });
});

async function corteEditavel(req) {
  const corte = await prisma.corteGaleria.findUnique({ where: { id_corte: req.valid.params.id } });
  if (!corte) throw notFound("Corte não encontrado.");
  if (ehBarbeiro(req) && corte.id_autor !== req.usuario.id_usuario) throw forbidden("Você só pode alterar os cortes que publicou.");
  return corte;
}

// Profissional só usa arquivos enviados por ele; o 3D é sempre opcional.
async function conferirMidiaCorte(req, atual = null) {
  if (!ehBarbeiro(req)) return;
  const d = req.valid.body;
  for (const campo of ["imagem_url", "modelo_3d_url"]) {
    if (!d[campo] || d[campo] === atual?.[campo] || d[campo].startsWith("https://sketchfab.com/")) continue;
    if (!(await urlPertenceAoUsuario(d[campo], req.usuario.id_usuario))) throw badRequest("Use um arquivo enviado por você pelo botão de envio.");
  }
}

router.post("/galeria", quemCorta, validar({ body: corteGaleriaSchema }), async (req, res) => {
  await conferirMidiaCorte(req);
  const corte = await prisma.corteGaleria.create({ data: { ...req.valid.body, id_autor: ehBarbeiro(req) ? req.usuario.id_usuario : null }, include: INCLUDE_CORTE });
  await registrarLog("corte.criacao", { autor: req.usuario, entidade: "corte_galeria", id: corte.id_corte });
  res.status(201).json({ corte });
});

router.put("/galeria/:id", quemCorta, validar({ params: idParam, body: corteGaleriaSchema }), async (req, res) => {
  const atual = await corteEditavel(req);
  await conferirMidiaCorte(req, atual);
  const corte = await prisma.corteGaleria.update({ where: { id_corte: atual.id_corte }, data: req.valid.body, include: INCLUDE_CORTE });
  await registrarLog("corte.edicao", { autor: req.usuario, entidade: "corte_galeria", id: corte.id_corte });
  res.json({ corte });
});

router.delete("/galeria/:id", quemCorta, validar({ params: idParam }), async (req, res) => {
  const atual = await corteEditavel(req);
  const corte = await prisma.corteGaleria.update({ where: { id_corte: atual.id_corte }, data: { ativo: false }, include: INCLUDE_CORTE });
  await registrarLog("corte.ocultacao", { autor: req.usuario, entidade: "corte_galeria", id: corte.id_corte });
  res.json({ corte });
});

// ═════════ AVALIAÇÕES (moderação) ═════════

const avaliacoesAdminQuery = z.object({ status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PENDENTE", "APROVADO", "REJEITADO"]).optional()) });
router.get("/avaliacoes", soAdmin, validar({ query: avaliacoesAdminQuery }), async (req, res) => {
  const avaliacoes = await prisma.avaliacao.findMany({
    where: req.valid.query.status ? { status_moderacao: req.valid.query.status } : {},
    orderBy: { data_avaliacao: "desc" },
    take: 300,
    include: INCLUDE_AVALIACAO,
  });
  res.json({ avaliacoes: avaliacoes.map(avaliacaoPainel) });
});

router.patch("/avaliacoes/:id", soAdmin, validar({ params: idParam, body: visibilidadeSchema }), async (req, res) => {
  const { visivel, status_moderacao } = req.valid.body;
  const dados = { ...(visivel === undefined ? {} : { visivel }), ...(status_moderacao ? { status_moderacao } : {}) };
  res.json({ avaliacao: await moderarAvaliacao(req.valid.params.id, dados, req.usuario) });
});

// ═════════ CONFIGURAÇÕES ═════════

router.get("/config", soAdmin, async (_req, res) => {
  res.json({ config: await obterConfig() });
});

router.patch("/config", soAdmin, validar({ body: configSchema.partial() }), async (req, res) => {
  const dados = Object.fromEntries(Object.entries(req.valid.body).filter(([, v]) => v !== undefined));
  if (!Object.keys(dados).length) throw badRequest("Nada para salvar.");
  const atual = await obterConfig();
  if ((dados.nivel_ouro ?? atual.nivel_ouro) <= (dados.nivel_prata ?? atual.nivel_prata)) {
    throw badRequest("O nível Ouro deve exigir mais pontos que o Prata.", [{ campo: "nivel_ouro", mensagem: "Deve ser maior que o Prata." }]);
  }
  const config = await salvarConfig(dados);
  await registrarLog("config.edicao", { autor: req.usuario, entidade: "configuracao_salao", id: 1, detalhes: { campos: Object.keys(dados) } });
  res.json({ config });
});

export default router;
