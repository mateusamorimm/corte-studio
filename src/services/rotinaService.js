// Rotinas de manutenção: faltas automáticas e pedidos com prazo de retirada vencido.
// São disparadas pelo próprio tráfego da API (no máximo uma vez por minuto), sem manter o banco
// acordado quando ninguém usa o sistema. A trava evita execuções simultâneas entre instâncias.
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { obterConfig } from "./configService.js";
import { sincronizarReserva } from "./codigoService.js";
import { cancelarPedido } from "./lojaService.js";
import { registrarLog } from "./logService.js";

const INTERVALO_MS = 60 * 1000;
let ultima = 0;

export async function executarRotinas(agora = new Date()) {
  const cfg = await obterConfig();
  const resultado = { faltas: 0, pedidos: 0 };

  // Visitante que não fez check-in: o horário é liberado depois da tolerância.
  if (cfg.falta_automatica) {
    const limite = new Date(agora.getTime() - cfg.tolerancia_falta_minutos * 60 * 1000);
    resultado.faltas = await prisma.$transaction(async (tx) => {
      const [{ ok }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(1003, 1) AS ok`;
      if (!ok) return 0;
      const faltas = await tx.agendamento.findMany({
        where: {
          status: { in: ["PENDENTE", "CONFIRMADO"] },
          chegou_em: null,
          data_hora_inicio: { lt: limite },
          reserva: { visitante: true },
        },
        select: { id_agendamento: true, id_reserva: true },
        take: 100,
      });
      for (const f of faltas) {
        await tx.agendamento.updateMany({
          where: { id_agendamento: f.id_agendamento, status: { in: ["PENDENTE", "CONFIRMADO"] }, chegou_em: null },
          data: { status: "NAO_COMPARECEU", falta_automatica: true },
        });
        await sincronizarReserva(tx, f.id_reserva, { expirada: true, motivo: "Não compareceu no horário" });
        await registrarLog("agendamento.falta_automatica", { entidade: "agendamento", id: f.id_agendamento }, tx);
      }
      return faltas.length;
    }, { timeout: 20000, maxWait: 10000 });
  }

  const vencidos = await prisma.pedido.findMany({
    where: { status: { in: ["PENDENTE", "PRONTO_PARA_RETIRADA"] }, prazo_retirada: { lt: agora } },
    select: { id_pedido: true },
    take: 100,
  });
  for (const p of vencidos) {
    try {
      await cancelarPedido(p.id_pedido, { motivo: "Prazo de retirada vencido", expirado: true });
      resultado.pedidos++;
    } catch (err) {
      if (err.status !== 409) throw err; // outro processo já encerrou
    }
  }
  return resultado;
}

// Middleware: não atrasa a resposta de ninguém.
export function rotinasPorTrafego(_req, _res, next) {
  next();
  if (env.NODE_ENV === "test" || Date.now() - ultima < INTERVALO_MS) return;
  ultima = Date.now();
  executarRotinas().catch((err) => console.error("[rotinas]", err.message));
}
