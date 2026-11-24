// Auditoria: gravada só pelo servidor; o painel apenas lê.
import { prisma } from "../lib/prisma.js";

const SENSIVEIS = /senha|token|hash|segredo|cpf|^rg$|ctps|pis|cnh|emergencia/i;

function limpar(detalhes) {
  if (!detalhes) return undefined;
  return Object.fromEntries(Object.entries(detalhes).filter(([k, v]) => !SENSIVEIS.test(k) && v !== undefined));
}

// Dentro de uma transação (cliente informado) grava junto ou não grava; fora dela, nunca derruba a ação.
export async function registrarLog(acao, { autor = null, entidade = null, id = null, detalhes = null } = {}, cliente = null) {
  const data = {
    acao,
    id_autor: autor && typeof autor === "object" ? autor.id_usuario : autor,
    entidade,
    id_entidade: id,
    detalhes: limpar(detalhes),
  };
  if (cliente) return cliente.logAuditoria.create({ data });
  try {
    await prisma.logAuditoria.create({ data });
  } catch (err) {
    console.error("[log] Falha ao registrar auditoria:", err.message);
  }
}

export async function listarLogs({ acao, busca, pagina, limite }) {
  const where = {
    ...(acao ? { acao: { startsWith: acao } } : {}),
    ...(busca
      ? { autor: { OR: [{ nome_completo: { contains: busca, mode: "insensitive" } }, { email: { contains: busca.toLowerCase() } }] } }
      : {}),
  };
  const [logs, total, acoes] = await Promise.all([
    prisma.logAuditoria.findMany({
      where,
      orderBy: { id_log: "desc" },
      skip: (pagina - 1) * limite,
      take: limite,
      include: { autor: { select: { nome_completo: true, email: true, tipo_perfil: true } } },
    }),
    prisma.logAuditoria.count({ where }),
    prisma.logAuditoria.groupBy({ by: ["acao"], orderBy: { acao: "asc" } }),
  ]);
  return { logs, total, paginas: Math.max(1, Math.ceil(total / limite)), acoes: acoes.map((a) => a.acao) };
}
