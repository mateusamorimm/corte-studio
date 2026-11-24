// Fidelidade: extrato de pontos (nunca editado); saldo = soma dos lançamentos.
// Pontos entram quando um atendimento ou pedido é concluído (na mesma transação) e saem em resgates.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
import { registrarLog } from "./logService.js";

export const travarPontos = (tx, idUsuario) => tx.$executeRaw`SELECT pg_advisory_xact_lock(1002, ${idUsuario}::int)`;

export async function saldo(idUsuario, cliente = prisma) {
  const r = await cliente.movimentoPontos.aggregate({ where: { id_usuario: idUsuario }, _sum: { pontos: true } });
  return r._sum.pontos ?? 0;
}

export function pontosPorValor(valor, cfg) {
  const taxa = Number(cfg.pontos_por_real);
  if (taxa <= 0 || Number(valor) <= 0) return 0;
  return Math.max(cfg.pontos_minimos_evento, Math.round(Number(valor) * taxa));
}

export function nivel(acumulado, cfg) {
  if (acumulado >= cfg.nivel_ouro) return "Ouro";
  return acumulado >= cfg.nivel_prata ? "Prata" : "Bronze";
}

// Um crédito por conclusão: só é chamado depois que o UPDATE condicional de status afetou a linha.
export async function creditar(tx, { idUsuario, origem, idOrigem, valor, motivo }) {
  const pontos = pontosPorValor(valor, await obterConfig(tx));
  if (!pontos) return 0;
  const ja = await tx.movimentoPontos.aggregate({ where: { origem, id_origem: idOrigem }, _sum: { pontos: true } });
  if ((ja._sum.pontos ?? 0) !== 0) return 0;
  await tx.movimentoPontos.create({ data: { id_usuario: idUsuario, pontos, origem, id_origem: idOrigem, motivo } });
  return pontos;
}

// Zera o que aquela origem movimentou (conclusão desfeita ou resgate de pedido cancelado).
export async function estornar(tx, { origem, idOrigem, motivo }) {
  const linhas = await tx.movimentoPontos.groupBy({ by: ["id_usuario"], where: { origem, id_origem: idOrigem }, _sum: { pontos: true } });
  for (const l of linhas) {
    if (l._sum.pontos) {
      await tx.movimentoPontos.create({ data: { id_usuario: l.id_usuario, pontos: -l._sum.pontos, origem, id_origem: idOrigem, motivo } });
    }
  }
}

// Melhor recompensa ativa que o saldo alcança (maior desconto; empate: a que custa menos).
export async function melhorRecompensa(idUsuario, cliente = prisma) {
  const pontos = await saldo(idUsuario, cliente);
  return cliente.recompensa.findFirst({
    where: { ativo: true, pontos_minimos: { lte: pontos } },
    orderBy: [{ desconto_percentual: "desc" }, { pontos_minimos: "asc" }],
  });
}

export function calcularDesconto(subtotal, recompensa) {
  if (!recompensa) return new Prisma.Decimal(0);
  return new Prisma.Decimal(subtotal).mul(recompensa.desconto_percentual).div(100).toDecimalPlaces(2);
}

export async function situacao(idUsuario, { extrato = true } = {}) {
  const [cfg, pontos, ganhos, recompensas, ativa, movimentos] = await Promise.all([
    obterConfig(),
    saldo(idUsuario),
    prisma.movimentoPontos.aggregate({ where: { id_usuario: idUsuario, origem: { not: "RESGATE" } }, _sum: { pontos: true } }),
    prisma.recompensa.findMany({ where: { ativo: true }, orderBy: { pontos_minimos: "asc" } }),
    melhorRecompensa(idUsuario),
    extrato ? prisma.movimentoPontos.findMany({ where: { id_usuario: idUsuario }, orderBy: { id_movimento: "desc" }, take: 50 }) : [],
  ]);
  const acumulado = Math.max(0, ganhos._sum.pontos ?? 0);
  return {
    pontos,
    acumulado,
    nivel: nivel(acumulado, cfg),
    niveis: { prata: cfg.nivel_prata, ouro: cfg.nivel_ouro },
    pontos_por_real: Number(cfg.pontos_por_real),
    pontos_minimos_evento: cfg.pontos_minimos_evento,
    desconto_ativo: ativa,
    proxima: recompensas.find((r) => r.pontos_minimos > pontos) ?? null,
    recompensas,
    extrato: movimentos.map(({ id_autor, ...m }) => m),
  };
}

export async function ajustar({ idUsuario, pontos, motivo, autor }) {
  const cliente = await prisma.usuario.findFirst({
    where: { id_usuario: idUsuario, tipo_perfil: "CLIENTE", visitante: false },
    select: { id_usuario: true },
  });
  if (!cliente) throw notFound("Cliente não encontrado.");
  return prisma.$transaction(async (tx) => {
    await travarPontos(tx, idUsuario);
    const atual = await saldo(idUsuario, tx);
    if (atual + pontos < 0) throw conflict(`O cliente tem ${atual} ponto(s): não é possível retirar ${-pontos}.`);
    await tx.movimentoPontos.create({ data: { id_usuario: idUsuario, pontos, origem: "AJUSTE", motivo, id_autor: autor.id_usuario } });
    await registrarLog("fidelidade.ajuste", { autor, entidade: "usuario", id: idUsuario, detalhes: { pontos, motivo } }, tx);
    return atual + pontos;
  });
}

export async function pontosDosClientes(busca) {
  const clientes = await prisma.usuario.findMany({
    where: {
      tipo_perfil: "CLIENTE",
      visitante: false,
      ativo: true,
      ...(busca ? { OR: [{ nome_completo: { contains: busca, mode: "insensitive" } }, { email: { contains: busca.toLowerCase() } }] } : {}),
    },
    select: { id_usuario: true, nome_completo: true, email: true, avatar_url: true },
    orderBy: { nome_completo: "asc" },
    take: 300,
  });
  const ids = clientes.map((c) => c.id_usuario);
  const [cfg, saldos, ganhos, recompensas] = await Promise.all([
    obterConfig(),
    prisma.movimentoPontos.groupBy({ by: ["id_usuario"], where: { id_usuario: { in: ids } }, _sum: { pontos: true } }),
    prisma.movimentoPontos.groupBy({ by: ["id_usuario"], where: { id_usuario: { in: ids }, origem: { not: "RESGATE" } }, _sum: { pontos: true } }),
    prisma.recompensa.findMany({ where: { ativo: true }, orderBy: { desconto_percentual: "desc" } }),
  ]);
  const soma = (lista, id) => lista.find((s) => s.id_usuario === id)?._sum.pontos ?? 0;
  return clientes
    .map((c) => {
      const pontos = soma(saldos, c.id_usuario);
      return {
        ...c,
        pontos,
        nivel: nivel(Math.max(0, soma(ganhos, c.id_usuario)), cfg),
        desconto_percentual: recompensas.find((r) => r.pontos_minimos <= pontos)?.desconto_percentual ?? 0,
      };
    })
    .sort((a, b) => b.pontos - a.pontos);
}
