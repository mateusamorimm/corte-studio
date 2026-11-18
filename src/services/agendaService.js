// Regras da agenda: horários livres, criação, remarcação, status, cancelamento, avaliação e bloqueios.
// Toda escrita que afeta a agenda de um profissional roda numa transação que começa com
// pg_advisory_xact_lock(1001, id_barbeiro) e revalida tudo depois do lock (ver docs/ARQUITETURA.md).
// As restrições EXCLUDE do banco são a última barreira contra sobreposição.
import { prisma } from "../lib/prisma.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { obterConfig } from "./configService.js";
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

const travarProfissional = (tx, idBarbeiro) => tx.$executeRaw`SELECT pg_advisory_xact_lock(1001, ${idBarbeiro}::int)`;

const sobrepoe = (inicio, fim) => ({ data_hora_inicio: { lt: fim }, data_hora_fim: { gt: inicio } });

// Campos devolvidos nas listagens de agendamento.
export const INCLUDE_AGENDAMENTO = {
  cliente: { select: { id_usuario: true, nome_completo: true, telefone: true, email: true, avatar_url: true } },
  barbeiro: { select: { id_usuario: true, nome_completo: true, avatar_url: true } },
  servico: { select: { id_servico: true, nome_servico: true, icone: true, duracao_minutos: true } },
  avaliacao: { select: { nota: true, comentario: true, visivel: true, data_avaliacao: true } },
};

async function servicoAtivo(cliente, idServico) {
  const servico = await cliente.servico.findFirst({ where: { id_servico: idServico, ativo: true } });
  if (!servico) throw notFound("Serviço não encontrado ou indisponível.");
  return servico;
}

// Profissionais ativos que realizam o serviço (com as disponibilidades).
export function profissionaisDoServico(idServico, cliente = prisma, idBarbeiro = null) {
  return cliente.usuario.findMany({
    where: {
      ativo: true,
      tipo_perfil: { in: PERFIS_PROFISSIONAL },
      servicos_oferecidos: { some: { id_servico: idServico } },
      ...(idBarbeiro ? { id_usuario: idBarbeiro } : {}),
    },
    select: { id_usuario: true, nome_completo: true, avatar_url: true, disponibilidades: true },
    orderBy: { nome_completo: "asc" },
  });
}

// Lista os horários livres de um dia para um serviço (opcionalmente de um profissional).
export async function horariosDisponiveis({ id_servico, data, id_barbeiro = null, porEquipe = false, ignorarId = null }) {
  const cfg = await obterConfig();
  const tz = cfg.fuso_horario;
  const agora = new Date();
  const hoje = dataLocal(agora, tz);
  if (data < hoje) return { data, horarios: [] };
  if (!porEquipe && data > somarDias(hoje, cfg.janela_agendamento_dias)) {
    return { data, horarios: [], aviso: `Agendamentos abertos até ${cfg.janela_agendamento_dias} dias à frente.` };
  }

  const servico = await servicoAtivo(prisma, id_servico);
  const duracao = servico.duracao_minutos;
  const profissionais = await profissionaisDoServico(id_servico, prisma, id_barbeiro);
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

  const horarios = [...porHorario.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { data, duracao_minutos: duracao, horarios };
}

// Revalida um horário dentro da transação (depois do lock do profissional).
async function validarHorario(tx, { idBarbeiro, servico, inicio, fim, ignorarId = null, cfg, porEquipe, idCliente = null }) {
  const tz = cfg.fuso_horario;
  const agora = new Date();

  const prof = await tx.usuario.findFirst({
    where: { id_usuario: idBarbeiro, ativo: true, tipo_perfil: { in: PERFIS_PROFISSIONAL } },
    select: {
      nome_completo: true,
      servicos_oferecidos: { where: { id_servico: servico.id_servico }, select: { id_servico: true } },
      disponibilidades: true,
    },
  });
  if (!prof) throw notFound("Profissional não encontrado.");
  if (!prof.servicos_oferecidos.length) throw conflict(`${prof.nome_completo} não realiza o serviço "${servico.nome_servico}".`);

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

// Cria um agendamento. Sem profissional escolhido, usa o primeiro livre no horário.
export async function criarAgendamento({ id_cliente, id_servico, id_barbeiro = null, inicio, observacao = null, porEquipe = false, status = "PENDENTE" }) {
  const cfg = await obterConfig();
  const servico = await servicoAtivo(prisma, id_servico);
  const fim = new Date(inicio.getTime() + servico.duracao_minutos * MIN);
  await clienteAtivo(id_cliente);

  if (!porEquipe) {
    const futuros = await prisma.agendamento.count({
      where: { id_cliente, status: { in: ["PENDENTE", "CONFIRMADO"] }, data_hora_inicio: { gt: new Date() } },
    });
    if (futuros >= MAX_AGENDAMENTOS_FUTUROS_CLIENTE) {
      throw conflict(`Você já tem ${futuros} horários marcados. Conclua ou cancele um antes de agendar outro.`);
    }
  }

  let candidatos;
  if (id_barbeiro) candidatos = [id_barbeiro];
  else {
    const livres = await horariosDisponiveis({ id_servico, data: dataLocal(inicio, cfg.fuso_horario), porEquipe });
    const slot = livres.horarios.find((h) => new Date(h.inicio).getTime() === inicio.getTime());
    candidatos = slot ? slot.profissionais.map((p) => p.id_usuario) : [];
    if (!candidatos.length) throw new AppError(409, "Esse horário não está mais disponível. Escolha outro.", "CONFLITO_HORARIO");
  }

  let ultimoErro;
  for (const idBarbeiro of candidatos) {
    try {
      return await prisma.$transaction(async (tx) => {
        await travarProfissional(tx, idBarbeiro);
        await validarHorario(tx, { idBarbeiro, servico, inicio, fim, cfg, porEquipe, idCliente: id_cliente });
        return tx.agendamento.create({
          data: {
            id_cliente,
            id_barbeiro: idBarbeiro,
            id_servico,
            data_hora_inicio: inicio,
            data_hora_fim: fim,
            preco_registrado: servico.preco,
            status,
            observacao_cliente: observacao,
          },
          include: INCLUDE_AGENDAMENTO,
        });
      });
    } catch (err) {
      ultimoErro = err;
      if (id_barbeiro || !(err instanceof AppError) || err.status !== 409) throw err;
    }
  }
  throw ultimoErro;
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
      },
    });
    if (count !== 1) throw new AppError(409, "O agendamento foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
    return tx.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
  });
}

// Remarcação pela equipe: novo horário, profissional e/ou serviço.
export async function remarcar({ id, id_servico, id_barbeiro, inicio, ator }) {
  const atual = await carregar(id, ator);
  if (!["PENDENTE", "CONFIRMADO"].includes(atual.status)) {
    throw conflict("Só agendamentos pendentes ou confirmados podem ser remarcados.");
  }
  if (ator.tipo_perfil === "BARBEIRO" && id_barbeiro !== ator.id_usuario) {
    throw forbidden("Você só pode remarcar para a sua própria agenda.");
  }
  const cfg = await obterConfig();
  const servico = await servicoAtivo(prisma, id_servico);
  const fim = new Date(inicio.getTime() + servico.duracao_minutos * MIN);

  return prisma.$transaction(async (tx) => {
    for (const b of [...new Set([atual.id_barbeiro, id_barbeiro])].sort((a, b) => a - b)) await travarProfissional(tx, b);
    await validarHorario(tx, { idBarbeiro: id_barbeiro, servico, inicio, fim, ignorarId: id, cfg, porEquipe: true, idCliente: atual.id_cliente });
    const { count } = await tx.agendamento.updateMany({
      where: { id_agendamento: id, status: atual.status },
      data: {
        id_barbeiro,
        id_servico,
        data_hora_inicio: inicio,
        data_hora_fim: fim,
        preco_registrado: id_servico === atual.id_servico ? atual.preco_registrado : servico.preco,
      },
    });
    if (count !== 1) throw new AppError(409, "O agendamento foi alterado por outra pessoa. Atualize a página.", "CONCORRENCIA");
    return tx.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
  });
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
  return prisma.agendamento.findUnique({ where: { id_agendamento: id }, include: INCLUDE_AGENDAMENTO });
}

export async function avaliar(id, idCliente, { nota, comentario }) {
  const ag = await prisma.agendamento.findFirst({
    where: { id_agendamento: id, id_cliente: idCliente },
    select: { status: true, avaliacao: { select: { id_avaliacao: true } } },
  });
  if (!ag) throw notFound("Agendamento não encontrado.");
  if (ag.status !== "CONCLUIDO") throw conflict("Só é possível avaliar atendimentos concluídos.");
  if (ag.avaliacao) throw conflict("Este atendimento já foi avaliado.");
  return prisma.avaliacao.create({ data: { id_agendamento: id, nota, comentario } }); // UNIQUE cobre a corrida
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
