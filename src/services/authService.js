import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { enviarEmail } from "../lib/mailer.js";
import { AppError, conflict } from "../lib/errors.js";
import { CAMPOS_USUARIO_PUBLICO } from "../middlewares/auth.js";

const CUSTO_BCRYPT = 12;
const VALIDADE_TOKEN_MIN = 60;
// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar contas.
const HASH_FICTICIO = bcrypt.hashSync("senha-ficticia-para-tempo-constante", CUSTO_BCRYPT);

const credenciaisInvalidas = () => new AppError(401, "E-mail ou senha inválidos.", "CREDENCIAIS_INVALIDAS");

export const VERSAO_CONSENTIMENTO = "2026-11";

export const hashSenha = (senha) => bcrypt.hash(senha, CUSTO_BCRYPT);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function cadastrarCliente(dados) {
  const existente = await prisma.usuario.findUnique({ where: { email: dados.email }, select: { id_usuario: true } });
  if (existente) throw conflict("Já existe uma conta com este e-mail.", { campo: "email" });
  if (dados.cpf) {
    const cpfUsado = await prisma.usuario.findUnique({ where: { cpf: dados.cpf }, select: { id_usuario: true } });
    if (cpfUsado) throw conflict("Este CPF já está cadastrado.", { campo: "cpf" });
  }
  if (dados.usuario) await usuarioLivre(dados.usuario);
  // A restrição UNIQUE do banco cobre a corrida entre dois cadastros simultâneos (P2002 → 409).
  return prisma.usuario.create({
    data: {
      nome_completo: dados.nome_completo,
      email: dados.email,
      telefone: dados.telefone,
      cpf: dados.cpf ?? null,
      data_nascimento: dados.data_nascimento ?? null,
      usuario: dados.usuario ?? null,
      consentimento_lgpd_em: new Date(),
      consentimento_versao: VERSAO_CONSENTIMENTO,
      senha_hash: await hashSenha(dados.senha),
      tipo_perfil: "CLIENTE",
    },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
  });
}

export async function usuarioLivre(usuario, ignorarId = null) {
  const outro = await prisma.usuario.findFirst({
    where: { usuario, ...(ignorarId ? { id_usuario: { not: ignorarId } } : {}) },
    select: { id_usuario: true },
  });
  if (outro) throw conflict("Este nome de usuário já está em uso.", [{ campo: "usuario", mensagem: "Este nome de usuário já está em uso." }]);
}

// Identificador: e-mail ou nome de usuário.
export async function autenticar(identificador, senha) {
  const usuario = await prisma.usuario.findUnique({
    where: identificador.includes("@") ? { email: identificador } : { usuario: identificador },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
  });
  const confere = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FICTICIO);
  if (!usuario || !usuario.senha_hash || !confere) throw credenciaisInvalidas();
  if (!usuario.ativo) throw new AppError(403, "Esta conta está desativada. Fale com o salão.", "CONTA_INATIVA");
  return usuario;
}

// Sempre responde da mesma forma, exista ou não a conta.
export async function solicitarRedefinicao(email, { assunto = "Redefinição de senha — Studio Corte", motivo = "redefinir" } = {}) {
  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { id_usuario: true, nome_completo: true, ativo: true },
  });
  if (!usuario || !usuario.ativo) {
    await bcrypt.hash("equalizar-tempo", 4);
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url"); // 43 caracteres
  await prisma.$transaction([
    // Invalida links anteriores ainda não usados
    prisma.tokenRedefinicaoSenha.updateMany({
      where: { id_usuario: usuario.id_usuario, usado_em: null },
      data: { usado_em: new Date() },
    }),
    prisma.tokenRedefinicaoSenha.create({
      data: {
        id_usuario: usuario.id_usuario,
        token_hash: sha256(token),
        expira_em: new Date(Date.now() + VALIDADE_TOKEN_MIN * 60 * 1000),
      },
    }),
  ]);

  // O token vai no fragmento (#): não é enviado ao servidor em logs/Referer ao abrir a página.
  const link = `${env.APP_URL}/redefinir-senha.html#token=${token}`;
  const primeiroNome = usuario.nome_completo.split(" ")[0];
  const acao = motivo === "convite" ? "criar sua senha de acesso" : "redefinir sua senha";
  await enviarEmail({
    para: email,
    assunto,
    texto: `Olá, ${primeiroNome}!\n\nPara ${acao} no Studio Corte, acesse o link abaixo (válido por ${VALIDADE_TOKEN_MIN} minutos):\n${link}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
  });
}

export async function redefinirSenha(token, novaSenha) {
  const tokenHash = sha256(token);
  const novoHash = await hashSenha(novaSenha);

  return prisma.$transaction(async (tx) => {
    const registro = await tx.tokenRedefinicaoSenha.findUnique({
      where: { token_hash: tokenHash },
      include: { usuario: { select: { ativo: true } } },
    });
    const invalido = new AppError(400, "Este link é inválido ou expirou. Solicite um novo.", "TOKEN_INVALIDO");
    if (!registro || registro.usado_em || registro.expira_em < new Date() || !registro.usuario.ativo) throw invalido;

    // Consumo atômico: só um uso concorrente consegue marcar o token.
    const { count } = await tx.tokenRedefinicaoSenha.updateMany({
      where: { id_token: registro.id_token, usado_em: null },
      data: { usado_em: new Date() },
    });
    if (count !== 1) throw invalido;

    await tx.usuario.update({ where: { id_usuario: registro.id_usuario }, data: { senha_hash: novoHash } });
    await tx.tokenRedefinicaoSenha.updateMany({
      where: { id_usuario: registro.id_usuario, usado_em: null },
      data: { usado_em: new Date() },
    });
    return registro.id_usuario;
  });
}

// Troca de e-mail: só vale depois que o novo endereço confirma o link.
export async function solicitarTrocaEmail(usuario, novoEmail, senhaAtual) {
  const atual = await prisma.usuario.findUnique({ where: { id_usuario: usuario.id_usuario }, select: { senha_hash: true } });
  if (!atual?.senha_hash || !(await bcrypt.compare(senhaAtual, atual.senha_hash))) {
    throw new AppError(400, "A senha atual está incorreta.", "SENHA_ATUAL_INCORRETA", [{ campo: "senha_atual", mensagem: "A senha atual está incorreta." }]);
  }
  if (novoEmail === usuario.email) throw conflict("Este já é o seu e-mail.");
  const ocupado = await prisma.usuario.findUnique({ where: { email: novoEmail }, select: { id_usuario: true } });
  // Mesma resposta com ou sem conta existente: o aviso só vai para o dono do endereço.
  if (ocupado) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.trocaEmail.updateMany({ where: { id_usuario: usuario.id_usuario, usado_em: null }, data: { usado_em: new Date() } }),
    prisma.trocaEmail.create({
      data: { id_usuario: usuario.id_usuario, novo_email: novoEmail, token_hash: sha256(token), expira_em: new Date(Date.now() + VALIDADE_TOKEN_MIN * 60 * 1000) },
    }),
  ]);
  await enviarEmail({
    para: novoEmail,
    assunto: "Confirme o seu novo e-mail — Studio Corte",
    texto: `Olá, ${usuario.nome_completo.split(" ")[0]}!\n\nPara confirmar este endereço na sua conta do Studio Corte, acesse (válido por ${VALIDADE_TOKEN_MIN} minutos):\n${env.APP_URL}/confirmar-email.html#token=${token}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
  });
}

export async function confirmarTrocaEmail(token) {
  const invalido = new AppError(400, "Este link é inválido ou expirou. Solicite a troca de novo.", "TOKEN_INVALIDO");
  return prisma.$transaction(async (tx) => {
    const t = await tx.trocaEmail.findUnique({ where: { token_hash: sha256(token) }, include: { usuario: { select: { ativo: true } } } });
    if (!t || t.usado_em || t.expira_em < new Date() || !t.usuario.ativo) throw invalido;
    const { count } = await tx.trocaEmail.updateMany({ where: { id_troca: t.id_troca, usado_em: null }, data: { usado_em: new Date() } });
    if (count !== 1) throw invalido;
    await tx.usuario.update({ where: { id_usuario: t.id_usuario }, data: { email: t.novo_email } });
    await tx.logAuditoria.create({ data: { id_autor: t.id_usuario, acao: "conta.email", entidade: "usuario", id_entidade: t.id_usuario } });
    return t.id_usuario;
  });
}
