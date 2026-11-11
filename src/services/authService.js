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

export const hashSenha = (senha) => bcrypt.hash(senha, CUSTO_BCRYPT);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function cadastrarCliente(dados) {
  const existente = await prisma.usuario.findUnique({ where: { email: dados.email }, select: { id_usuario: true } });
  if (existente) throw conflict("Já existe uma conta com este e-mail.", { campo: "email" });
  if (dados.cpf) {
    const cpfUsado = await prisma.usuario.findUnique({ where: { cpf: dados.cpf }, select: { id_usuario: true } });
    if (cpfUsado) throw conflict("Este CPF já está cadastrado.", { campo: "cpf" });
  }
  // A restrição UNIQUE do banco cobre a corrida entre dois cadastros simultâneos (P2002 → 409).
  return prisma.usuario.create({
    data: {
      nome_completo: dados.nome_completo,
      email: dados.email,
      telefone: dados.telefone,
      cpf: dados.cpf ?? null,
      data_nascimento: dados.data_nascimento ?? null,
      senha_hash: await hashSenha(dados.senha),
      tipo_perfil: "CLIENTE",
    },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
  });
}

export async function autenticar(email, senha) {
  const usuario = await prisma.usuario.findUnique({
    where: { email },
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

  await prisma.$transaction(async (tx) => {
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
  });
}
