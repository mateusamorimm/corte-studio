// Reservas sem conta (visitante), consulta pelo código e conclusão no balcão.
// O visitante recebe um cadastro provisório (visitante = true, sem e-mail de acesso e sem senha) que
// só vira conta no salão, por convite enviado ao e-mail — ninguém da equipe define senha de cliente.
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
import { abrirReserva, RE_CODIGO, sincronizarReserva } from "./codigoService.js";
import { agendarNaTransacao, alterarStatus, INCLUDE_AGENDAMENTO, OPCOES_TX, prepararAgendamento, registrarChegada } from "./agendaService.js";
import { avancarPedido, cancelarPedido, criarPedidoTx, INCLUDE_PEDIDO, itensParaPedido, prazoRetirada } from "./lojaService.js";
import { registrarLog } from "./logService.js";
import { localParaUtc } from "../lib/tempo.js";

import { VERSAO_CONSENTIMENTO } from "./authService.js";
const MAX_ATIVAS_POR_TELEFONE = 3;

export const INCLUDE_RESERVA = {
  cliente: { select: { id_usuario: true, nome_completo: true, telefone: true, email: true, visitante: true } },
  agendamentos: { include: INCLUDE_AGENDAMENTO, orderBy: { data_hora_inicio: "asc" } },
  pedido: { include: INCLUDE_PEDIDO },
};

export async function criarReservaVisitante(d) {
  if (!d.agendamento && !d.itens?.length) throw badRequest("Escolha um horário ou pelo menos um produto.");
  const cfg = await obterConfig();
  const ativas = await prisma.reserva.count({ where: { telefone: d.telefone, visitante: true, status: "ATIVA" } });
  if (ativas >= MAX_ATIVAS_POR_TELEFONE) {
    throw conflict(`Já existem ${ativas} reservas abertas com este telefone. Conclua ou cancele uma antes de fazer outra.`);
  }
  const [prep, itens] = await Promise.all([
    d.agendamento ? prepararAgendamento(d.agendamento) : null,
    d.itens?.length ? itensParaPedido(d.itens) : null,
  ]);
  const desejada = d.data_retirada ? localParaUtc(d.data_retirada, 23 * 60 + 59, cfg.fuso_horario) : d.agendamento?.inicio ?? new Date();
  if (itens && desejada.getTime() > Date.now() + 60 * 24 * 3600 * 1000) throw badRequest("Escolha uma data de retirada dentro de 60 dias.");
  if (itens && desejada.getTime() < Date.now() - 24 * 3600 * 1000) throw badRequest("A data de retirada não pode estar no passado.");

  const agora = new Date();
  return prisma.$transaction(async (tx) => {
    // Trava por telefone: duas reservas simultâneas não passam juntas do limite.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1004, hashtext(${d.telefone}))`;
    const aindaAtivas = await tx.reserva.count({ where: { telefone: d.telefone, visitante: true, status: "ATIVA" } });
    if (aindaAtivas >= MAX_ATIVAS_POR_TELEFONE) throw conflict("Já existem reservas demais abertas com este telefone.");
    const provisorio = await tx.usuario.create({
      data: {
        nome_completo: d.nome,
        telefone: d.telefone,
        tipo_perfil: "CLIENTE",
        visitante: true,
        consentimento_lgpd_em: agora,
        consentimento_versao: VERSAO_CONSENTIMENTO,
      },
      select: { id_usuario: true },
    });
    const reserva = await abrirReserva(tx, {
      id_cliente: provisorio.id_usuario,
      visitante: true,
      nome: d.nome,
      telefone: d.telefone,
      email: d.email,
      observacao: d.observacao ?? null,
      consentimento_lgpd_em: agora,
      consentimento_versao: VERSAO_CONSENTIMENTO,
    });
    if (prep) {
      await agendarNaTransacao(tx, prep, {
        id_cliente: provisorio.id_usuario,
        id_reserva: reserva.id_reserva,
        observacao: d.observacao ?? null,
        status: "PENDENTE",
      });
    }
    if (itens) {
      await criarPedidoTx(tx, {
        id_cliente: provisorio.id_usuario,
        itens,
        id_reserva: reserva.id_reserva,
        observacao: d.observacao ?? null,
        forma_pagamento: d.forma_pagamento ?? null,
        prazo_retirada: prazoRetirada(cfg, desejada),
      });
    }
    return tx.reserva.findUnique({ where: { id_reserva: reserva.id_reserva }, include: INCLUDE_RESERVA });
  }, OPCOES_TX);
}

// O que o visitante vê com código + telefone (sem dados internos).
export function reservaPublica(r) {
  return {
    codigo: r.codigo,
    status: r.status,
    nome: r.nome,
    motivo: r.motivo,
    criada_em: r.criada_em,
    agendamentos: r.agendamentos.map((a) => ({
      inicio: a.data_hora_inicio,
      fim: a.data_hora_fim,
      status: a.status,
      profissional: a.barbeiro.nome_completo,
      servicos: a.servicos.length ? a.servicos.map((s) => s.servico.nome_servico) : [a.servico.nome_servico],
      preco: a.preco_registrado,
    })),
    pedido: r.pedido && {
      status: r.pedido.status,
      prazo_retirada: r.pedido.prazo_retirada,
      total: r.pedido.valor_total,
      itens: r.pedido.itens.map((i) => ({ nome: i.nome_produto_registrado, quantidade: i.quantidade, preco: i.preco_unitario })),
    },
  };
}

// Código + telefone precisam bater: só o código não revela nada.
async function localizarPublica(codigo, telefone) {
  const r = RE_CODIGO.test(codigo) ? await prisma.reserva.findUnique({ where: { codigo }, include: INCLUDE_RESERVA }) : null;
  if (!r || r.telefone !== telefone) throw notFound("Reserva não encontrada. Confira o código e o telefone informados.");
  return r;
}

export async function consultarReserva(codigo, telefone) {
  return reservaPublica(await localizarPublica(codigo, telefone));
}

export async function cancelarReservaPublica(codigo, telefone) {
  const r = await localizarPublica(codigo, telefone);
  if (r.status !== "ATIVA") throw conflict("Esta reserva já foi encerrada.");
  const cfg = await obterConfig();
  const limite = Date.now() + cfg.antecedencia_cancelamento_hrs * 3600 * 1000;
  if (r.agendamentos.some((a) => ["PENDENTE", "CONFIRMADO"].includes(a.status) && a.data_hora_inicio.getTime() < limite)) {
    throw conflict(`Cancelamentos online só até ${cfg.antecedencia_cancelamento_hrs}h antes. Fale com o salão.`);
  }
  if (r.pedido && r.pedido.status === "PRONTO_PARA_RETIRADA") throw conflict("O pedido já está separado. Fale com o salão para cancelar.");
  await prisma.$transaction(async (tx) => {
    await tx.agendamento.updateMany({
      where: { id_reserva: r.id_reserva, status: { in: ["PENDENTE", "CONFIRMADO"] } },
      data: { status: "CANCELADO", cancelado_em: new Date(), motivo_cancelamento: "Cancelado pelo cliente" },
    });
    await sincronizarReserva(tx, r.id_reserva, { motivo: "Cancelada pelo cliente" });
  });
  if (r.pedido?.status === "PENDENTE") await cancelarPedido(r.pedido.id_pedido, { motivo: "Cancelado pelo cliente" });
  return consultarReserva(codigo, telefone);
}

// ───────── Balcão ─────────

export async function listarReservas({ busca, status, visitante }) {
  const codigo = busca?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digitos = busca?.replace(/\D/g, "") ?? "";
  return prisma.reserva.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(visitante === undefined ? {} : { visitante }),
      ...(busca
        ? {
            OR: [
              ...(codigo && codigo.length <= 6 ? [{ codigo: { startsWith: codigo } }] : []),
              { nome: { contains: busca, mode: "insensitive" } },
              ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }] : []),
            ],
          }
        : {}),
    },
    include: INCLUDE_RESERVA,
    orderBy: { criada_em: "desc" },
    take: 200,
  });
}

async function porId(id) {
  const r = await prisma.reserva.findUnique({ where: { id_reserva: id }, include: INCLUDE_RESERVA });
  if (!r) throw notFound("Reserva não encontrada.");
  return r;
}

export async function chegadaReserva(id, ator) {
  const r = await porId(id);
  const abertos = r.agendamentos.filter((a) => ["PENDENTE", "CONFIRMADO"].includes(a.status));
  if (!abertos.length) throw conflict("Esta reserva não tem atendimento em aberto.");
  for (const a of abertos) await registrarChegada(a.id_agendamento, ator);
  return porId(id);
}

// Conclui o que dá para concluir agora: entrega o pedido e fecha os atendimentos que já começaram.
export async function concluirReserva(id, ator) {
  const r = await porId(id);
  const agora = new Date();
  const abertos = r.agendamentos.filter((a) => ["PENDENTE", "CONFIRMADO"].includes(a.status));
  const prontos = abertos.filter((a) => a.data_hora_inicio <= agora);
  const pedidoAberto = r.pedido && ["PENDENTE", "PRONTO_PARA_RETIRADA"].includes(r.pedido.status);
  if (!prontos.length && !pedidoAberto) {
    throw conflict(abertos.length ? "O atendimento desta reserva ainda não começou." : "Esta reserva já foi encerrada.");
  }
  for (const a of prontos) {
    if (a.status === "PENDENTE") await registrarChegada(a.id_agendamento, ator);
    await alterarStatus({ id: a.id_agendamento, status: "CONCLUIDO", ator });
  }
  if (pedidoAberto) await avancarPedido(r.pedido.id_pedido, "CONCLUIDO", ator);
  return porId(id);
}

export async function cancelarReserva(id, motivo, ator) {
  const r = await porId(id);
  if (r.status !== "ATIVA") throw conflict("Esta reserva já foi encerrada.");
  for (const a of r.agendamentos.filter((x) => ["PENDENTE", "CONFIRMADO"].includes(x.status))) {
    await alterarStatus({ id: a.id_agendamento, status: "CANCELADO", motivo: motivo ?? "Reserva cancelada pelo salão", ator });
  }
  if (r.pedido && ["PENDENTE", "PRONTO_PARA_RETIRADA"].includes(r.pedido.status)) {
    await cancelarPedido(r.pedido.id_pedido, { motivo: motivo ?? "Reserva cancelada pelo salão", ator });
  }
  return porId(id);
}

// Transforma o cadastro provisório em cliente. Se o e-mail já é de uma conta de cliente, o histórico
// passa para ela (confirmado no balcão) e o provisório é desativado.
export async function cadastrarVisitante(id, dados, ator) {
  const r = await porId(id);
  if (!r.cliente.visitante) throw conflict("Esta reserva já está vinculada a um cliente cadastrado.");
  const provisorio = r.cliente.id_usuario;
  const existente = dados.email
    ? await prisma.usuario.findUnique({ where: { email: dados.email }, select: { id_usuario: true, tipo_perfil: true, ativo: true, nome_completo: true } })
    : null;
  if (existente && existente.tipo_perfil !== "CLIENTE") throw conflict("Este e-mail pertence a um membro da equipe.", [{ campo: "email", mensagem: "E-mail da equipe." }]);
  if (existente && !existente.ativo) throw conflict("Este e-mail é de uma conta desativada. Reative-a em Clientes.");
  if (existente && !dados.vincular) {
    throw conflict(`Já existe uma conta com este e-mail (${existente.nome_completo}). Confirme com o cliente e marque "vincular à conta existente".`, { campo: "vincular" });
  }
  if (dados.cpf) {
    const dono = await prisma.usuario.findUnique({ where: { cpf: dados.cpf }, select: { id_usuario: true } });
    if (dono && dono.id_usuario !== provisorio && dono.id_usuario !== existente?.id_usuario) {
      throw conflict("Este CPF já está cadastrado.", [{ campo: "cpf", mensagem: "CPF já cadastrado." }]);
    }
  }
  const idCliente = await prisma.$transaction(async (tx) => {
    if (existente) {
      const troca = { where: { id_cliente: provisorio }, data: { id_cliente: existente.id_usuario } };
      await tx.agendamento.updateMany(troca);
      await tx.pedido.updateMany(troca);
      await tx.reserva.updateMany({ where: { id_cliente: provisorio }, data: { id_cliente: existente.id_usuario, visitante: false } });
      await tx.movimentoPontos.updateMany({ where: { id_usuario: provisorio }, data: { id_usuario: existente.id_usuario } });
      await tx.usuario.update({ where: { id_usuario: provisorio }, data: { ativo: false } });
    } else {
      await tx.usuario.update({
        where: { id_usuario: provisorio },
        data: {
          visitante: false,
          nome_completo: dados.nome_completo,
          telefone: dados.telefone,
          email: dados.email ?? null,
          cpf: dados.cpf ?? null,
          endereco: dados.endereco ?? null,
          data_nascimento: dados.data_nascimento ?? null,
        },
      });
      await tx.reserva.updateMany({ where: { id_cliente: provisorio }, data: { visitante: false } });
    }
    const destino = existente?.id_usuario ?? provisorio;
    await registrarLog("reserva.cadastro", { autor: ator, entidade: "reserva", id, detalhes: { cliente: destino, vinculada: Boolean(existente) } }, tx);
    return destino;
  }, OPCOES_TX);
  const reserva = await porId(id);
  return { reserva, cliente: reserva.cliente, novo: !existente, id_cliente: idCliente };
}
