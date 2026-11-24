// Avaliações verificadas: só quem teve um atendimento ou pedido concluído avalia, e só o que fez parte dele.
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
import { nomePublico } from "../lib/nomes.js";
import { registrarLog } from "./logService.js";

export const VISIVEL = { visivel: true, status_moderacao: "APROVADO" };

const COLUNA = { SERVICO: "id_servico", CORTE: "id_corte", PRODUTO: "id_produto", PROFISSIONAL: "id_profissional" };

export const INCLUDE_AVALIACAO = {
  notas: {
    include: {
      servico: { select: { id_servico: true, nome_servico: true } },
      corte: { select: { id_corte: true, nome_corte: true } },
      produto: { select: { id_produto: true, nome_produto: true } },
      profissional: { select: { id_usuario: true, nome_completo: true } },
    },
    orderBy: { id_nota: "asc" },
  },
  agendamento: {
    select: {
      id_agendamento: true,
      data_hora_inicio: true,
      servico: { select: { nome_servico: true } },
      barbeiro: { select: { id_usuario: true, nome_completo: true } },
      cliente: { select: { id_usuario: true, nome_completo: true, avatar_url: true, perfil_publico: true } },
    },
  },
  pedido: {
    select: {
      id_pedido: true,
      data_pedido: true,
      itens: { select: { nome_produto_registrado: true } },
      cliente: { select: { id_usuario: true, nome_completo: true, avatar_url: true, perfil_publico: true } },
    },
  },
};

const rotuloNota = (n) =>
  n.servico?.nome_servico ?? n.corte?.nome_corte ?? n.produto?.nome_produto ?? n.profissional?.nome_completo ?? "Estabelecimento";

const formatarNotas = (notas) =>
  notas.map((n) => ({
    alvo: n.alvo,
    id: n.id_servico ?? n.id_corte ?? n.id_produto ?? n.id_profissional ?? null,
    nome: rotuloNota(n),
    nota: n.nota,
  }));

export function avaliacaoPublica(a) {
  const cliente = a.agendamento?.cliente ?? a.pedido.cliente;
  return {
    id_avaliacao: a.id_avaliacao,
    nota: a.nota,
    comentario: a.comentario,
    data_avaliacao: a.data_avaliacao,
    servico: a.agendamento?.servico.nome_servico ?? a.pedido.itens.map((i) => i.nome_produto_registrado).join(", "),
    profissional: a.agendamento?.barbeiro.nome_completo ?? null,
    tipo: a.agendamento ? "ATENDIMENTO" : "COMPRA",
    cliente: nomePublico(cliente.nome_completo),
    id_cliente: cliente.perfil_publico ? cliente.id_usuario : null,
    avatar_url: cliente.avatar_url,
    notas: formatarNotas(a.notas),
  };
}

export const avaliacaoPainel = (a) => ({
  id_avaliacao: a.id_avaliacao,
  nota: a.nota,
  comentario: a.comentario,
  data_avaliacao: a.data_avaliacao,
  visivel: a.visivel,
  status_moderacao: a.status_moderacao,
  tipo: a.agendamento ? "ATENDIMENTO" : "COMPRA",
  cliente: (a.agendamento?.cliente ?? a.pedido.cliente).nome_completo,
  referencia: a.agendamento?.servico.nome_servico ?? `Pedido nº ${a.pedido.id_pedido}`,
  profissional: a.agendamento?.barbeiro.nome_completo ?? null,
  notas: formatarNotas(a.notas),
});

// O que pode ser avaliado em um atendimento ou pedido do cliente.
export async function alvosAvaliaveis({ idCliente, id_agendamento = null, id_pedido = null }) {
  if (id_agendamento) {
    const ag = await prisma.agendamento.findFirst({
      where: { id_agendamento, id_cliente: idCliente },
      include: {
        servico: { select: { id_servico: true, nome_servico: true } },
        barbeiro: { select: { id_usuario: true, nome_completo: true } },
        servicos: { include: { servico: { select: { id_servico: true, nome_servico: true } } }, orderBy: { ordem: "asc" } },
        cortes: { include: { corte: { select: { id_corte: true, nome_corte: true } } } },
        avaliacao: { select: { id_avaliacao: true } },
      },
    });
    if (!ag) throw notFound("Agendamento não encontrado.");
    const servicos = ag.servicos.length ? ag.servicos.map((s) => s.servico) : [ag.servico];
    return {
      concluido: ag.status === "CONCLUIDO",
      avaliado: Boolean(ag.avaliacao),
      alvos: [
        { alvo: "SALAO", id: null, nome: "Estabelecimento" },
        ...servicos.map((s) => ({ alvo: "SERVICO", id: s.id_servico, nome: s.nome_servico })),
        ...ag.cortes.map(({ corte }) => ({ alvo: "CORTE", id: corte.id_corte, nome: corte.nome_corte })),
        { alvo: "PROFISSIONAL", id: ag.barbeiro.id_usuario, nome: ag.barbeiro.nome_completo },
      ],
    };
  }
  const p = await prisma.pedido.findFirst({
    where: { id_pedido, id_cliente: idCliente },
    include: { itens: true, avaliacao: { select: { id_avaliacao: true } } },
  });
  if (!p) throw notFound("Pedido não encontrado.");
  return {
    concluido: p.status === "CONCLUIDO",
    avaliado: Boolean(p.avaliacao),
    alvos: [
      { alvo: "SALAO", id: null, nome: "Estabelecimento" },
      ...p.itens.map((i) => ({ alvo: "PRODUTO", id: i.id_produto, nome: i.nome_produto_registrado })),
    ],
  };
}

export async function avaliar({ idCliente, id_agendamento = null, id_pedido = null, nota = null, notas = [], comentario = null }) {
  const { concluido, avaliado, alvos } = await alvosAvaliaveis({ idCliente, id_agendamento, id_pedido });
  if (!concluido) throw conflict(id_agendamento ? "Só é possível avaliar atendimentos concluídos." : "Só é possível avaliar pedidos concluídos.");
  if (avaliado) throw conflict(id_agendamento ? "Este atendimento já foi avaliado." : "Este pedido já foi avaliado.");
  const unicos = new Map();
  for (const n of notas) {
    if (!alvos.some((a) => a.alvo === n.alvo && a.id === (n.alvo === "SALAO" ? null : n.id))) {
      throw badRequest("Só é possível avaliar o que fez parte deste atendimento ou pedido.");
    }
    unicos.set(`${n.alvo}:${n.id ?? ""}`, n);
  }
  const lista = [...unicos.values()];
  const geral = nota ?? (lista.length ? Math.round(lista.reduce((t, n) => t + n.nota, 0) / lista.length) : null);
  if (!geral) throw badRequest("Dê pelo menos uma nota.", [{ campo: "nota", mensagem: "Dê pelo menos uma nota." }]);
  const cfg = await obterConfig();
  return prisma.avaliacao.create({
    // UNIQUE em id_agendamento/id_pedido cobre a corrida entre dois envios
    data: {
      id_agendamento,
      id_pedido,
      nota: geral,
      comentario,
      status_moderacao: cfg.avaliacao_requer_aprovacao ? "PENDENTE" : "APROVADO",
      notas: { create: lista.map((n) => ({ alvo: n.alvo, nota: n.nota, ...(COLUNA[n.alvo] ? { [COLUNA[n.alvo]]: n.id } : {}) })) },
    },
    include: { notas: true },
  });
}

export async function listarPublicas({ limite, pagina, nota, alvo }) {
  const filtroNota = nota ? { nota: nota <= 3 ? { lte: 3 } : nota } : {};
  const filtroAlvo = !alvo ? {} : alvo === "MULTI" ? { id_avaliacao: { in: await idsMulti() } } : { notas: { some: { alvo } } };
  const where = { ...VISIVEL, ...filtroNota, ...filtroAlvo };
  const [avaliacoes, resumo, filtradas, distribuicao] = await Promise.all([
    prisma.avaliacao.findMany({
      where,
      orderBy: { data_avaliacao: "desc" },
      skip: (pagina - 1) * limite,
      take: limite,
      include: INCLUDE_AVALIACAO,
    }),
    prisma.avaliacao.aggregate({ where: VISIVEL, _avg: { nota: true }, _count: true }),
    prisma.avaliacao.count({ where }),
    prisma.avaliacao.groupBy({ by: ["nota"], where: VISIVEL, _count: true }),
  ]);
  return {
    avaliacoes: avaliacoes.map(avaliacaoPublica),
    total: resumo._count,
    media: resumo._avg.nota,
    total_filtrado: filtradas,
    paginas: Math.max(1, Math.ceil(filtradas / limite)),
    distribuicao: Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, distribuicao.find((d) => d.nota === n)?._count ?? 0])),
  };
}

async function idsMulti() {
  const g = await prisma.avaliacaoNota.groupBy({ by: ["id_avaliacao"], _count: true, having: { id_avaliacao: { _count: { gt: 1 } } } });
  return g.map((x) => x.id_avaliacao);
}

// Média pública por alvo: { "SERVICO": { 3: { media, total } }, ... }
export async function mediasPorAlvo() {
  const linhas = await prisma.avaliacaoNota.groupBy({
    by: ["alvo", "id_servico", "id_corte", "id_produto", "id_profissional"],
    where: { avaliacao: VISIVEL },
    _avg: { nota: true },
    _count: true,
  });
  const saida = { SALAO: null, SERVICO: {}, CORTE: {}, PRODUTO: {}, PROFISSIONAL: {} };
  for (const l of linhas) {
    const valor = { media: l._avg.nota, total: l._count };
    if (l.alvo === "SALAO") saida.SALAO = valor;
    else saida[l.alvo][l[COLUNA[l.alvo]]] = valor;
  }
  return saida;
}

export async function moderarAvaliacao(id, dados, ator) {
  const avaliacao = await prisma.avaliacao.update({ where: { id_avaliacao: id }, data: dados });
  await registrarLog("avaliacao.moderacao", { autor: ator, entidade: "avaliacao", id, detalhes: dados });
  return avaliacao;
}
