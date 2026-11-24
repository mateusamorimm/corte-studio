// Regras da agenda: horários livres, criação, remarcação, status, cancelamento, avaliação e bloqueios.
// Toda escrita que afeta a agenda de um profissional roda numa transação que começa com
// pg_advisory_xact_lock(1001, id_barbeiro) e revalida tudo depois do lock (ver docs/ARQUITETURA.md).
// As restrições EXCLUDE do banco são a última barreira contra sobreposição.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
import { abrirReservaDoCliente, sincronizarReserva } from "./codigoService.js";
import { creditar, estornar } from "./fidelidadeService.js";
import { registrarLog } from "./logService.js";
import {
  dataLocal,
  diaDaSemana,
  localParaUtc,
  partesLocais,
  somarDias,
  timeParaMinutos,
} from "../lib/tempo.js";

export const STATUS_ATIVOS = ["PENDENTE", "CONFIRMADO", "CONCLUIDO"]; // os mesmos do EXCLUDE no banco
const PERFIS_PROFISSIONAL = ["BARBEIRO", "ADMIN"];
const MAX_AGENDAMENTOS_FUTUROS_CLIENTE = 5;
const MIN = 60 * 1000;
export const MAX_PESSOAS = 4;
export const OPCOES_TX = { timeout: 20000, maxWait: 10000 };

const travarProfissional = (tx, idBarbeiro) => tx.$executeRaw`SELECT pg_advisory_xact_lock(1001, ${idBarbeiro}::int)`;

const sobrepoe = (inicio, fim) => ({ data_hora_inicio: { lt: fim }, data_hora_fim: { gt: inicio } });

// Campos devolvidos nas listagens de agendamento.
export const INCLUDE_AGENDAMENTO = {
  cliente: { select: { id_usuario: true, nome_completo: true, telefone: true, email: true, avatar_url: true } },
  barbeiro: { select: { id_usuario: true, nome_completo: true, avatar_url: true } },
  servico: { select: { id_servico: true, nome_servico: true, icone: true, duracao_minutos: true } },
  avaliacao: { select: { nota: true, comentario: true, visivel: true, status_moderacao: true, data_avaliacao: true } },
  servicos: {
    orderBy: { ordem: "asc" },
    select: { preco_registrado: true, duracao_minutos: true, servico: { select: { id_servico: true, nome_servico: true, icone: true } } },
  },
  cortes: { select: { corte: { select: { id_corte: true, nome_corte: true, imagem_url: true } } } },
  reserva: { select: { id_reserva: true, codigo: true, visitante: true, status: true } },
};

// Serviços ativos na ordem pedida (sem repetir).
async function servicosAtivos(cliente, ids) {
  const unicos = [...new Set(ids)];
  if (!unicos.length) throw badRequest("Escolha pelo menos um serviço.");
  const lista = await cliente.servico.findMany({ where: { id_servico: { in: unicos }, ativo: true } });
  if (lista.length !== unicos.length) throw notFound("Serviço não encontrado ou indisponível.");
  return unicos.map((id) => lista.find((s) => s.id_servico === id));
}

const duracaoTotal = (servicos) => servicos.reduce((t, s) => t + s.duracao_minutos, 0);
const precoTotal = (servicos) => servicos.reduce((t, s) => t.add(s.preco), new Prisma.Decimal(0));
const linhasServico = (servicos) =>
  servicos.map((s, ordem) => ({ id_servico: s.id_servico, preco_registrado: s.preco, duracao_minutos: s.duracao_minutos, ordem }));

// Profissionais ativos que realizam TODOS os serviços (com as disponibilidades).
function profissionaisDosServicos(ids, idBarbeiro = null) {
  return prisma.usuario.findMany({
    where: {
      ativo: true,
      tipo_perfil: { in: PERFIS_PROFISSIONAL },
      AND: ids.map((id_servico) => ({ servicos_oferecidos: { some: { id_servico } } })),
      ...(idBarbeiro ? { id_usuario: idBarbeiro } : {}),
    },
    select: { id_usuario: true, nome_completo: true, avatar_url: true, disponibilidades: true },
    orderBy: { nome_completo: "asc" },
  });
}

// Lista os horários livres de um dia para um ou mais serviços (opcionalmente de um profissional).
// Várias pessoas: com profissional escolhido, em sequência com ele; sem escolha, ao mesmo tempo com profissionais diferentes.
export async function horariosDisponiveis({ servicos: idsServicos, data, id_barbeiro = null, pessoas = 1, porEquipe = false, ignorarId = null }) {
  const cfg = await obterConfig();
  const tz = cfg.fuso_horario;
  const agora = new Date();
  const hoje = dataLocal(agora, tz);
  if (data < hoje) return { data, horarios: [] };
  if (!porEquipe && data > somarDias(hoje, cfg.janela_agendamento_dias)) {
    return { data, horarios: [], aviso: `Agendamentos abertos até ${cfg.janela_agendamento_dias} dias à frente.` };
  }

  const servicos = await servicosAtivos(prisma, idsServicos);
  const duracaoPessoa = duracaoTotal(servicos);
  const duracao = id_barbeiro ? duracaoPessoa * pessoas : duracaoPessoa;
  const profissionais = await profissionaisDosServicos(servicos.map((x) => x.id_servico), id_barbeiro);
  if (!profissionais.length) return { data, horarios: [] };

  const ids = profissionais.map((p) => p.id_usuario);
  const inicioDia = localParaUtc(data, 0, tz);
  const fimDia = localParaUtc(somarDias(data, 1), 0, tz);
  const [bloqueios, ocupados] = await Promise.all([
    prisma.bloqueioAgenda.findMany({ where: { id_barbeiro: { in: ids }, ...sobrepoe(inicioDia, fimDia) } }),
    prisma.agendamento.findMany({
      where: {
        id_barbeiro: { in: ids },
        status: { in: STATUS_ATIVOS },
        ...(ignorarId ? { id_agendamento: { not: ignorarId } } : {}),
        ...sobrepoe(inicioDia, fimDia),
      },
      select: { id_barbeiro: true, data_hora_inicio: true, data_hora_fim: true },
    }),
  ]);

  const limiteMinimo = porEquipe ? agora : new Date(agora.getTime() + cfg.antecedencia_minima_minutos * MIN);
  const dia = diaDaSemana(data);
  const porHorario = new Map();

  for (const p of profissionais) {
    const janelas = p.disponibilidades.filter((d) => d.dia_semana === dia);
    for (const j of janelas) {
      const ini = timeParaMinutos(j.hora_inicio);
      const fim = timeParaMinutos(j.hora_fim);
      for (let t = ini; t + duracao <= fim; t += cfg.intervalo_slots_minutos) {
        const comeco = localParaUtc(data, t, tz);
        const termino = new Date(comeco.getTime() + duracao * MIN);
        if (comeco < limiteMinimo) continue;
        const conflita = (x) => x.id_barbeiro === p.id_usuario && x.data_hora_inicio < termino && x.data_hora_fim > comeco;
        if (bloqueios.some(conflita) || ocupados.some(conflita)) continue;
        const chave = comeco.toISOString();
        if (!porHorario.has(chave)) porHorario.set(chave, { inicio: chave, fim: termino.toISOString(), profissionais: [] });
        porHorario.get(chave).profissionais.push({ id_usuario: p.id_usuario, nome_completo: p.nome_completo });
      }
    }
  }

  const horarios = [...porHorario.values()]
    .filter((h) => id_barbeiro || h.profissionais.length >= pessoas)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { data, duracao_minutos: duracaoPessoa, preco_total: precoTotal(servicos).toFixed(2), horarios };
}

// Revalida um horário dentro da transação (depois do lock do profissional).
async function validarHorario(tx, { idBarbeiro, servicos, inicio, fim, ignorarId = null, cfg, porEquipe, idCliente = null, ignorarReserva = null }) {
  const tz = cfg.fuso_horario;
  const agora = new Date();

  const prof = await tx.usuario.findFirst({
    where: { id_usuario: idBarbeiro, ativo: true, tipo_perfil: { in: PERFIS_PROFISSIONAL } },
    select: {
      nome_completo: true,
      servicos_oferecidos: { where: { id_servico: { in: servicos.map((x) => x.id_servico) } }, select: { id_servico: true } },
      disponibilidades: true,
    },
  });
  if (!prof) throw notFound("Profissional não encontrado.");
  const naoFaz = servicos.find((x) => !prof.servicos_oferecidos.some((o) => o.id_servico === x.id_servico));
  if (naoFaz) throw conflict(`${prof.nome_completo} não realiza o serviço "${naoFaz.nome_servico}".`);

  if (inicio <= agora) throw badRequest("Escolha um horário no futuro.");
  if (!porEquipe) {
    if (inicio < new Date(agora.getTime() + cfg.antecedencia_minima_minutos * MIN)) {
      throw badRequest(`Agende com pelo menos ${cfg.antecedencia_minima_minutos} minutos de antecedência.`);
    }
    if (dataLocal(inicio, tz) > somarDias(dataLocal(agora, tz), cfg.janela_agendamento_dias)) {
      throw badRequest(`Agendamentos abertos até ${cfg.janela_agendamento_dias} dias à frente.`);
    }
  }

  // Dentro do expediente do profissional (no mesmo dia, horário local)
  const p = partesLocais(inicio, tz);
  const minIni = p.hora * 60 + p.minuto;
  const minFim = minIni + Math.round((fim - inicio) / MIN);
  const noExpediente = prof.disponibilidades.some(
    (d) => d.dia_semana === p.diaSemana && timeParaMinutos(d.hora_inicio) <= minIni && minFim <= timeParaMinutos(d.hora_fim)
  );
  if (!noExpediente) throw conflict("Horário fora do expediente do profissional.", { motivo: "EXPEDIENTE" });

  const bloqueio = await tx.bloqueioAgenda.findFirst({ where: { id_barbeiro: idBarbeiro, ...sobrepoe(inicio, fim) } });
  if (bloqueio) throw conflict("O profissional não atende nesse período.", { motivo: "BLOQUEIO" });

  const ocupado = await tx.agendamento.findFirst({
    where: {
      id_barbeiro: idBarbeiro,
      status: { in: STATUS_ATIVOS },
      ...(ignorarId ? { id_agendamento: { not: ignorarId } } : {}),
      ...sobrepoe(inicio, fim),
    },
    select: { id_agendamento: true },
  });
  if (ocupado) throw new AppError(409, "Conflito de horário: o período já está ocupado.", "CONFLITO_HORARIO");

  if (idCliente) {
    const doCliente = await tx.agendamento.findFirst({
      where: {
        id_cliente: idCliente,
        status: { in: ["PENDENTE", "CONFIRMADO"] },
        ...(ignorarId ? { id_agendamento: { not: ignorarId } } : {}),
        ...(ignorarReserva ? { OR: [{ id_reserva: null }, { id_reserva: { not: ignorarReserva } }] } : {}),
        ...sobrepoe(inicio, fim),
      },
      select: { id_agendamento: true },
    });
    if (doCliente) throw conflict("O cliente já tem outro horário marcado nesse período.");
  }
}

async function clienteAtivo(idCliente) {
  const c = await prisma.usuario.findFirst({ where: { id_usuario: idCliente, ativo: true }, select: { id_usuario: true } });
  if (!c) throw notFound("Cliente não encontrado ou desativado.");
}

async function cortesAtivos(ids) {
  const unicos = [...new Set(ids ?? [])];
  if (!unicos.length) return [];
  const n = await prisma.corteGaleria.count({ where: { id_corte: { in: unicos }, ativo: true } });
  if (n !== unicos.length) throw badRequest("Algum dos cortes escolhidos não está mais disponível.");
  return unicos;
}

// Reúne o que não precisa de trava: serviços, cortes e profissionais candidatos.
export async function prepararAgendamento({ servicos: ids, id_barbeiro = null, inicio, cortes = [], pessoas = 1, porEquipe = false }) {
  const cfg = await obterConfig();
  const [servicos, idsCortes] = await Promise.all([servicosAtivos(prisma, ids), cortesAtivos(cortes)]);
  if (pessoas > MAX_PESSOAS) throw badRequest(`No máximo ${MAX_PESSOAS} pessoas por reserva.`);
  let candidatos = [id_barbeiro];
  if (!id_barbeiro) {
    const livres = await horariosDisponiveis({ servicos: ids, data: dataLocal(inicio, cfg.fuso_horario), pessoas, porEquipe });
    const slot = livres.horarios.find((h) => new Date(h.inicio).getTime() === inicio.getTime());
    candidatos = slot ? slot.profissionais.map((p) => p.id_usuario) : [];
    if (candidatos.length < pessoas) throw new AppError(409, "Esse horário não está mais disponível. Escolha outro.", "CONFLITO_HORARIO");
  }
  return { cfg, servicos, cortes: idsCortes, candidatos, id_barbeiro, inicio, pessoas, porEquipe };
}

// Grava os atendimentos dentro da transação recebida (tudo ou nada).
export async function agendarNaTransacao(tx, prep, { id_cliente, id_reserva, observacao = null, status = "PENDENTE" }) {
  const { cfg, servicos, cortes, candidatos, id_barbeiro, inicio, pessoas, porEquipe } = prep;
  for (const b of [...candidatos].sort((x, y) => x - y)) await travarProfissional(tx, b); // ordem fixa evita deadlock
  const duracao = duracaoTotal(servicos) * MIN;
  const disponiveis = [...candidatos];
  const criados = [];

  for (let i = 0; i < pessoas; i++) {
    const comeco = id_barbeiro ? new Date(inicio.getTime() + i * duracao) : inicio;
    const fim = new Date(comeco.getTime() + duracao);
    let escolhido = null;
    let ultimoErro = null;
    for (const idBarbeiro of id_barbeiro ? [id_barbeiro] : [...disponiveis]) {
      try {
        await validarHorario(tx, { idBarbeiro, servicos, inicio: comeco, fim, cfg, porEquipe, idCliente: id_cliente, ignorarReserva: id_reserva });
        escolhido = idBarbeiro;
        break;
      } catch (err) {
        ultimoErro = err;
        if (id_barbeiro || !(err instanceof AppError) || err.status !== 409) throw err;
      }
    }
    if (!escolhido) throw ultimoErro ?? new AppError(409, "Esse horário não está mais disponível. Escolha outro.", "CONFLITO_HORARIO");
    if (!id_barbeiro) disponiveis.splice(disponiveis.indexOf(escolhido), 1);
    criados.push(
      await tx.agendamento.create({
        data: {
          id_cliente,
          id_barbeiro: escolhido,
          id_servico: servicos[0].id_servico,
          data_hora_inicio: comeco,
          data_hora_fim: fim,
          preco_registrado: precoTotal(servicos),
          status,
          observacao_cliente: observacao,
          id_reserva,
          servicos: { create: linhasServico(servicos) },
          cortes: { create: cortes.map((id_corte) => ({ id_corte })) },
        },
        include: INCLUDE_AGENDAMENTO,
      })
    );
  }
  return criados;
}

// Cria um ou mais atendimentos (vários serviços, várias pessoas) com um código de reserva.
export async function criarAgendamentos({ id_cliente, servicos, id_barbeiro = null, inicio, observacao = null, cortes = [], pessoas = 1, porEquipe = false, status = "PENDENTE" }) {
  await clienteAtivo(id_cliente);
  if (!porEquipe) {
    const futuros = await prisma.agendamento.count({
      where: { id_cliente, status: { in: ["PENDENTE", "CONFIRMADO"] }, data_hora_inicio: { gt: new Date() } },
    });
    if (futuros >= MAX_AGENDAMENTOS_FUTUROS_CLIENTE) {
      throw conflict(`Você já tem ${futuros} horários marcados. Conclua ou cancele um antes de agendar outro.`);
    }
  }
  const prep = await prepararAgendamento({ servicos, id_barbeiro, inicio, cortes, pessoas, porEquipe });
  return prisma.$transaction(async (tx) => {
    const reserva = await abrirReservaDoCliente(tx, id_cliente, observacao);
    const agendamentos = await agendarNaTransacao(tx, prep, { id_cliente, id_reserva: reserva.id_reserva, observacao, status });
    return { reserva, agendamentos };
  }, OPCOES_TX);
}

async function carregar(id, ator) {
  const ag = await prisma.agendamento.findUnique({ where: { id_agendamento: id } });
  if (!ag) throw notFound("Agendamento não encontrado.");
  if (ator.tipo_perfil === "BARBEIRO" && ag.id_barbeiro !== ator.id_usuario) throw forbidden();
  return ag;
}

const TRANSICOES = {
  PENDENTE: ["CONFIRMADO", "CANCELADO"],
  CONFIRMADO: ["PENDENTE", "CONCLUIDO", "NAO_COMPARECEU", "CANCELADO"],
  CONCLUIDO: ["CONFIRMADO"],
  NAO_COMPARECEU: ["CONFIRMADO"],
  CANCELADO: ["PENDENTE", "CONFIRMADO"],
};

// Alteração de status pela equipe (admin ou o próprio profissional).
export async function alterarStatus({ id, status, motivo = null, ator }) {
  const atual = await carregar(id, ator);
  if (atual.status === status) return prisma.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
  if (!TRANSICOES[atual.status].includes(status)) {
    throw conflict(`Não é possível mudar de ${atual.status} para ${status}.`);
  }
  if (["CONCLUIDO", "NAO_COMPARECEU"].includes(status) && atual.data_hora_inicio > new Date()) {
    throw conflict("Só é possível concluir ou marcar falta depois do horário do atendimento.");
  }

  const voltaParaAgenda = !STATUS_ATIVOS.includes(atual.status) && STATUS_ATIVOS.includes(status);
  return prisma.$transaction(async (tx) => {
    await travarProfissional(tx, atual.id_barbeiro);
    if (voltaParaAgenda) {
      if (atual.status === "CANCELADO" && atual.data_hora_inicio <= new Date()) {
        throw conflict("Não é possível reativar um agendamento que já passou.");
      }
      const bloqueio = await tx.bloqueioAgenda.findFirst({
        where: { id_barbeiro: atual.id_barbeiro, ...sobrepoe(atual.data_hora_inicio, atual.data_hora_fim) },
      });
      if (bloqueio) throw conflict("O profissional tem um bloqueio nesse período.");
      const ocupado = await tx.agendamento.findFirst({
        where: {
          id_barbeiro: atual.id_barbeiro,
          id_agendamento: { not: id },
          status: { in: STATUS_ATIVOS },
          ...sobrepoe(atual.data_hora_inicio, atual.data_hora_fim),
        },
      });
      if (ocupado) throw new AppError(409, "Conflito de horário: o período já está ocupado.", "CONFLITO_HORARIO");
    }
    // Atualização condicional: se outro usuário mudou o status nesse meio-tempo, nada é gravado.
    const { count } = await tx.agendamento.updateMany({
      where: { id_agendamento: id, status: atual.status },
      data: {
        status,
        cancelado_em: status === "CANCELADO" ? new Date() : null,
        motivo_cancelamento: status === "CANCELADO" ? motivo : null,
        falta_automatica: false,
        ...(status === "CONCLUIDO" && !atual.chegou_em ? { chegou_em: new Date() } : {}),
      },
    });
    if (count !== 1) throw new AppError(409, "O agendamento foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
    if (status === "CONCLUIDO") {
      await creditar(tx, {
        idUsuario: atual.id_cliente,
        origem: "ATENDIMENTO",
        idOrigem: id,
        valor: atual.preco_registrado,
        motivo: `Atendimento concluído nº ${id}`,
      });
    } else if (atual.status === "CONCLUIDO") {
      await estornar(tx, { origem: "ATENDIMENTO", idOrigem: id, motivo: `Conclusão do atendimento nº ${id} desfeita` });
    }
    await sincronizarReserva(tx, atual.id_reserva, { motivo: status === "CANCELADO" ? motivo : null });
    await registrarLog("agendamento.status", { autor: ator, entidade: "agendamento", id, detalhes: { de: atual.status, para: status, motivo } }, tx);
    return tx.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
  }, OPCOES_TX);
}

// Check-in no balcão: registra a chegada (evita a falta automática) e confirma o horário.
export async function registrarChegada(id, ator) {
  const atual = await carregar(id, ator);
  if (!["PENDENTE", "CONFIRMADO"].includes(atual.status)) throw conflict("Só atendimentos pendentes ou confirmados recebem chegada.");
  await prisma.agendamento.updateMany({
    where: { id_agendamento: id, status: atual.status },
    data: { chegou_em: atual.chegou_em ?? new Date(), status: "CONFIRMADO" },
  });
  await registrarLog("agendamento.chegada", { autor: ator, entidade: "agendamento", id });
  return prisma.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
}

// Remarcação pela equipe: novo horário, profissional e/ou serviços.
export async function remarcar({ id, id_servico = null, servicos: ids = null, id_barbeiro, inicio, ator }) {
  const atual = await carregar(id, ator);
  if (!["PENDENTE", "CONFIRMADO"].includes(atual.status)) {
    throw conflict("Só agendamentos pendentes ou confirmados podem ser remarcados.");
  }
  if (ator.tipo_perfil === "BARBEIRO" && id_barbeiro !== ator.id_usuario) {
    throw forbidden("Você só pode remarcar para a sua própria agenda.");
  }
  const cfg = await obterConfig();
  const linhas = await prisma.agendamentoServico.findMany({ where: { id_agendamento: id }, orderBy: { ordem: "asc" } });
  const atuais = linhas.length ? linhas.map((l) => l.id_servico) : [atual.id_servico];
  // Só o serviço principal informado e igual ao atual: mantém a lista completa.
  const pedidos = ids?.length ? ids : id_servico && id_servico !== atual.id_servico ? [id_servico] : atuais;
  const mesmos = pedidos.length === atuais.length && pedidos.every((x) => atuais.includes(x));
  const servicos = await servicosAtivos(prisma, pedidos);
  const fim = new Date(inicio.getTime() + duracaoTotal(servicos) * MIN);

  return prisma.$transaction(async (tx) => {
    for (const b of [...new Set([atual.id_barbeiro, id_barbeiro])].sort((a, b) => a - b)) await travarProfissional(tx, b);
    await validarHorario(tx, { idBarbeiro: id_barbeiro, servicos, inicio, fim, ignorarId: id, cfg, porEquipe: true, idCliente: atual.id_cliente, ignorarReserva: atual.id_reserva });
    const { count } = await tx.agendamento.updateMany({
      where: { id_agendamento: id, status: atual.status },
      data: {
        id_barbeiro,
        id_servico: servicos[0].id_servico,
        data_hora_inicio: inicio,
        data_hora_fim: fim,
        preco_registrado: mesmos ? atual.preco_registrado : precoTotal(servicos),
      },
    });
    if (count !== 1) throw new AppError(409, "O agendamento foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
    if (!mesmos || !linhas.length) {
      await tx.agendamentoServico.deleteMany({ where: { id_agendamento: id } });
      await tx.agendamentoServico.createMany({ data: linhasServico(servicos).map((l) => ({ ...l, id_agendamento: id })) });
    }
    await registrarLog("agendamento.remarcacao", { autor: ator, entidade: "agendamento", id, detalhes: { de: atual.data_hora_inicio, para: inicio } }, tx);
    return tx.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
  }, OPCOES_TX);
}

// Cancelamento pelo próprio cliente, respeitando a antecedência mínima configurada.
export async function cancelarPeloCliente(id, idCliente, motivo = null) {
  const cfg = await obterConfig();
  const ag = await prisma.agendamento.findFirst({ where: { id_agendamento: id, id_cliente: idCliente } });
  if (!ag) throw notFound("Agendamento não encontrado.");
  if (!["PENDENTE", "CONFIRMADO"].includes(ag.status)) throw conflict("Este agendamento não pode mais ser cancelado.");
  const limite = new Date(ag.data_hora_inicio.getTime() - cfg.antecedencia_cancelamento_hrs * 60 * MIN);
  if (new Date() > limite) {
    throw conflict(`Cancelamentos online só até ${cfg.antecedencia_cancelamento_hrs}h antes. Fale com o salão.`);
  }
  const { count } = await prisma.agendamento.updateMany({
    where: { id_agendamento: id, id_cliente: idCliente, status: { in: ["PENDENTE", "CONFIRMADO"] } },
    data: { status: "CANCELADO", cancelado_em: new Date(), motivo_cancelamento: motivo ?? "Cancelado pelo cliente" },
  });
  if (count !== 1) throw conflict("Este agendamento não pode mais ser cancelado.");
  await sincronizarReserva(prisma, ag.id_reserva, { motivo: motivo ?? "Cancelado pelo cliente" });
  return prisma.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
}

// ───────── Bloqueios (folgas, férias, compromissos) ─────────

export async function criarBloqueio({ id_barbeiro, inicio, fim, motivo, ator }) {
  if (ator.tipo_perfil === "BARBEIRO" && id_barbeiro !== ator.id_usuario) throw forbidden();
  if (fim <= inicio) throw badRequest("O fim do bloqueio deve ser depois do início.");
  const prof = await prisma.usuario.findFirst({
    where: { id_usuario: id_barbeiro, tipo_perfil: { in: PERFIS_PROFISSIONAL } },
    select: { id_usuario: true },
  });
  if (!prof) throw notFound("Profissional não encontrado.");

  return prisma.$transaction(async (tx) => {
    await travarProfissional(tx, id_barbeiro);
    const conflitos = await tx.agendamento.findMany({
      where: { id_barbeiro, status: { in: ["PENDENTE", "CONFIRMADO"] }, ...sobrepoe(inicio, fim) },
      include: { cliente: { select: { nome_completo: true } }, servico: { select: { nome_servico: true } } },
      orderBy: { data_hora_inicio: "asc" },
    });
    if (conflitos.length) {
      throw new AppError(
        409,
        `Há ${conflitos.length} agendamento(s) nesse período. Cancele ou remarque antes de bloquear.`,
        "CONFLITO_AGENDAMENTOS",
        conflitos.map((c) => ({
          id_agendamento: c.id_agendamento,
          inicio: c.data_hora_inicio,
          cliente: c.cliente.nome_completo,
          servico: c.servico.nome_servico,
        }))
      );
    }
    const outro = await tx.bloqueioAgenda.findFirst({ where: { id_barbeiro, ...sobrepoe(inicio, fim) } });
    if (outro) throw conflict("Já existe um bloqueio que cobre parte desse período.");
    return tx.bloqueioAgenda.create({ data: { id_barbeiro, data_hora_inicio: inicio, data_hora_fim: fim, motivo } });
  });
}

export async function removerBloqueio(id, ator) {
  const b = await prisma.bloqueioAgenda.findUnique({ where: { id_bloqueio: id } });
  if (!b) throw notFound("Bloqueio não encontrado.");
  if (ator.tipo_perfil === "BARBEIRO" && b.id_barbeiro !== ator.id_usuario) throw forbidden();
  await prisma.bloqueioAgenda.delete({ where: { id_bloqueio: id } });
}

// Confere o expediente antes de gravar qualquer coisa (fim > início, sem sobreposição no mesmo dia).
export function validarJanelas(janelas) {
  const porDia = new Map();
  for (const j of janelas) {
    if (j.fim <= j.inicio) throw badRequest("Em cada expediente, o fim deve ser depois do início.");
    const lista = porDia.get(j.dia_semana) ?? [];
    if (lista.some((o) => j.inicio < o.fim && j.fim > o.inicio)) {
      throw badRequest("Há expedientes sobrepostos no mesmo dia da semana.");
    }
    lista.push(j);
    porDia.set(j.dia_semana, lista);
  }
}

// Substitui o expediente semanal de um profissional.
export async function salvarDisponibilidade(idBarbeiro, janelas) {
  validarJanelas(janelas);
  await prisma.$transaction(async (tx) => {
    await travarProfissional(tx, idBarbeiro);
    await tx.disponibilidadeBarbeiro.deleteMany({ where: { id_barbeiro: idBarbeiro } });
    if (janelas.length) {
      await tx.disponibilidadeBarbeiro.createMany({
        data: janelas.map((j) => ({
          id_barbeiro: idBarbeiro,
          dia_semana: j.dia_semana,
          hora_inicio: new Date(Date.UTC(1970, 0, 1, 0, j.inicio)),
          hora_fim: new Date(Date.UTC(1970, 0, 1, 0, j.fim)),
        })),
      });
    }
  });
}
