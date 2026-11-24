// Reserva = código de balcão que reúne os atendimentos e/ou o pedido feitos numa mesma ação.
import crypto from "node:crypto";

// Sem I, O, 0 e 1: ninguém confunde ao ditar o código no balcão.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RE_CODIGO = /^[A-HJ-NP-Z2-9]{6}$/;

export const gerarCodigo = () => Array.from({ length: 6 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join("");

export async function abrirReserva(tx, dados) {
  for (let i = 0; i < 5; i++) {
    const codigo = gerarCodigo();
    if (await tx.reserva.findUnique({ where: { codigo }, select: { id_reserva: true } })) continue;
    return tx.reserva.create({ data: { ...dados, codigo } });
  }
  throw new Error("Não foi possível gerar o código da reserva.");
}

// Reserva de quem tem conta: nome e contato vêm do cadastro.
export async function abrirReservaDoCliente(tx, idCliente, observacao = null) {
  const u = await tx.usuario.findUnique({
    where: { id_usuario: idCliente },
    select: { nome_completo: true, telefone: true, email: true, visitante: true },
  });
  return abrirReserva(tx, {
    id_cliente: idCliente,
    visitante: u.visitante,
    nome: u.nome_completo,
    telefone: u.telefone,
    email: u.email,
    observacao,
  });
}

// Mantém a situação da reserva de acordo com os atendimentos e o pedido que ela contém.
export async function sincronizarReserva(tx, idReserva, { expirada = false, motivo = null } = {}) {
  if (!idReserva) return;
  const [ags, pedido] = await Promise.all([
    tx.agendamento.findMany({ where: { id_reserva: idReserva }, select: { status: true } }),
    tx.pedido.findUnique({ where: { id_reserva: idReserva }, select: { status: true } }),
  ]);
  const status = [...ags.map((a) => a.status), ...(pedido ? [pedido.status] : [])];
  const aberta = status.some((s) => ["PENDENTE", "CONFIRMADO", "PRONTO_PARA_RETIRADA"].includes(s));
  if (aberta || !status.length) {
    await tx.reserva.updateMany({
      where: { id_reserva: idReserva, status: { not: "ATIVA" } },
      data: { status: "ATIVA", encerrada_em: null, motivo: null },
    });
    return;
  }
  const novo = status.includes("CONCLUIDO") ? "CONCLUIDA" : expirada || status.includes("NAO_COMPARECEU") ? "EXPIRADA" : "CANCELADA";
  await tx.reserva.updateMany({
    where: { id_reserva: idReserva, status: { not: novo } },
    data: { status: novo, encerrada_em: new Date(), ...(motivo ? { motivo } : {}) },
  });
}
