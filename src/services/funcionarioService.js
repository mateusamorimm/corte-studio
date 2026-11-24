// Recepcionistas: acesso, contrato, documentos cifrados (só ADMIN) e registro de ponto.
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { cifrar, decifrar } from "../lib/cifra.js";
import { registrarLog } from "./logService.js";

const DOCUMENTOS = ["cpf", "rg", "ctps", "pis", "cnh", "emergencia"];

const SELECT = {
  id_usuario: true,
  nome_completo: true,
  email: true,
  usuario: true,
  telefone: true,
  whatsapp: true,
  avatar_url: true,
  ativo: true,
  senha_hash: true,
  data_cadastro: true,
  funcionario: true,
  redes_sociais: { orderBy: { ordem: "asc" } },
};

// Nas listas o documento aparece mascarado; só a ficha individual (auditada) traz o valor completo.
const mascarar = (v) => (v ? `${"•".repeat(Math.max(0, v.length - 2))}${v.slice(-2)}` : null);

function formatar(u, { completo = false } = {}) {
  const { senha_hash, funcionario, ...resto } = u;
  const f = funcionario ?? { vinculo: "CLT", status_contrato: "ATIVO" };
  const saida = { ...resto, tem_acesso: Boolean(senha_hash), funcionario: {} };
  for (const [k, v] of Object.entries(f)) {
    if (k === "id_usuario") continue;
    if (!k.endsWith("_cifrado")) saida.funcionario[k] = v;
    else {
      const claro = decifrar(v);
      const nome = k.replace("_cifrado", "");
      if (completo) saida.funcionario[nome] = claro;
      else if (nome === "cpf") saida.funcionario.cpf = mascarar(claro);
    }
  }
  return saida;
}

export async function listarRecepcionistas() {
  const lista = await prisma.usuario.findMany({
    where: { tipo_perfil: "RECEPCIONISTA" },
    select: { ...SELECT, pontos_registrados: { orderBy: { id_ponto: "desc" }, take: 1 } },
    orderBy: [{ ativo: "desc" }, { nome_completo: "asc" }],
  });
  return lista.map(({ pontos_registrados, ...u }) => ({ ...formatar(u), ultimo_ponto: pontos_registrados[0] ?? null }));
}

export async function obterRecepcionista(id, { completo = false } = {}) {
  const u = await prisma.usuario.findFirst({ where: { id_usuario: id, tipo_perfil: "RECEPCIONISTA" }, select: SELECT });
  if (!u) throw notFound("Recepcionista não encontrado(a).");
  return formatar(u, { completo });
}

function dadosFuncionario(d) {
  const saida = {
    vinculo: d.vinculo,
    status_contrato: d.status_contrato,
    data_entrada: d.data_entrada ?? null,
    data_saida: d.data_saida ?? null,
    motivo_saida: d.motivo_saida ?? null,
    endereco: d.endereco ?? null,
    cidade: d.cidade ?? null,
    uf: d.uf ?? null,
    cep: d.cep ?? null,
    observacoes: d.observacoes ?? null,
  };
  for (const doc of DOCUMENTOS) if (d[doc] !== undefined) saida[`${doc}_cifrado`] = cifrar(d[doc]);
  return saida;
}

const dadosUsuario = (d) => ({
  nome_completo: d.nome_completo,
  email: d.email,
  usuario: d.usuario ?? null,
  telefone: d.telefone ?? null,
  whatsapp: d.whatsapp ?? null,
  avatar_url: d.avatar_url ?? null,
});

export async function criarRecepcionista(d, ator) {
  const funcionario = dadosFuncionario(d); // cifra antes de abrir a transação (falha cedo se faltar a chave)
  const u = await prisma.$transaction(async (tx) => {
    const novo = await tx.usuario.create({
      data: { ...dadosUsuario(d), tipo_perfil: "RECEPCIONISTA", funcionario: { create: funcionario } },
      select: { id_usuario: true },
    });
    await registrarLog("recepcionista.criacao", { autor: ator, entidade: "usuario", id: novo.id_usuario, detalhes: { nome: d.nome_completo } }, tx);
    return novo;
  });
  return obterRecepcionista(u.id_usuario);
}

export async function salvarRecepcionista(id, d, ator) {
  await obterRecepcionista(id);
  const funcionario = dadosFuncionario(d);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id_usuario: id }, data: dadosUsuario(d) });
    await tx.funcionario.upsert({ where: { id_usuario: id }, create: { id_usuario: id, ...funcionario }, update: funcionario });
    await registrarLog("recepcionista.edicao", { autor: ator, entidade: "usuario", id }, tx);
  });
  return obterRecepcionista(id);
}

export async function definirAtivo(id, ativo, ator) {
  await obterRecepcionista(id);
  await prisma.usuario.update({ where: { id_usuario: id }, data: { ativo } });
  await registrarLog(ativo ? "recepcionista.reativacao" : "recepcionista.desativacao", { autor: ator, entidade: "usuario", id });
  return obterRecepcionista(id);
}

// Desligamento: encerra o contrato e o acesso; o histórico fica.
export async function desligar(id, { data_saida, motivo }, ator) {
  const atual = await obterRecepcionista(id);
  const entrada = atual.funcionario.data_entrada;
  if (entrada && data_saida < entrada) throw conflict("A data de saída não pode ser antes da entrada.");
  await prisma.$transaction(async (tx) => {
    const dados = { status_contrato: "DESLIGADO", data_saida, motivo_saida: motivo ?? null };
    await tx.funcionario.upsert({ where: { id_usuario: id }, create: { id_usuario: id, ...dados }, update: dados });
    await tx.usuario.update({ where: { id_usuario: id }, data: { ativo: false } });
    await registrarLog("recepcionista.desligamento", { autor: ator, entidade: "usuario", id, detalhes: { data_saida, motivo } }, tx);
  });
  return obterRecepcionista(id);
}

// ───────── Ponto ─────────

export const listarPonto = (id, limite = 60) =>
  prisma.registroPonto.findMany({ where: { id_usuario: id }, orderBy: { id_ponto: "desc" }, take: limite, select: { id_ponto: true, tipo: true, em: true, observacao: true } });

// A hora é sempre a do servidor e entradas/saídas se alternam.
export async function registrarPonto(id, { tipo, observacao = null }, ator) {
  const alvo = await prisma.usuario.findFirst({ where: { id_usuario: id, tipo_perfil: "RECEPCIONISTA", ativo: true }, select: { id_usuario: true } });
  if (!alvo) throw notFound("Recepcionista não encontrado(a) ou sem acesso ativo.");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1005, ${id}::int)`;
    const ultimo = await tx.registroPonto.findFirst({ where: { id_usuario: id }, orderBy: { id_ponto: "desc" } });
    const esperado = ultimo?.tipo === "ENTRADA" ? "SAIDA" : "ENTRADA";
    if (tipo !== esperado) throw conflict(esperado === "ENTRADA" ? "Registre a entrada primeiro." : "Já há uma entrada aberta. Registre a saída.");
    const ponto = await tx.registroPonto.create({ data: { id_usuario: id, tipo, observacao, id_autor: ator.id_usuario } });
    await registrarLog("ponto.registro", { autor: ator, entidade: "usuario", id, detalhes: { tipo } }, tx);
    return ponto;
  });
}
