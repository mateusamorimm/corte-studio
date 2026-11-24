// Convite de acesso: a pessoa define a própria senha pelo link enviado ao e-mail.
import { badRequest } from "../lib/errors.js";
import { solicitarRedefinicao } from "./authService.js";

export async function enviarConvite(usuario) {
  if (!usuario.email) throw badRequest("Cadastre um e-mail para enviar o convite.");
  await solicitarRedefinicao(usuario.email, { assunto: "Seu acesso ao Studio Corte", motivo: "convite" });
}

// Cadastro já gravado: uma falha no envio do e-mail não desfaz o cadastro, vira aviso.
export async function convidar(usuario) {
  try {
    await enviarConvite(usuario);
    return null;
  } catch (err) {
    console.error("[email] Falha ao enviar convite:", err.message);
    return "Cadastro salvo, mas o e-mail com o link de acesso não pôde ser enviado. Tente reenviar o convite.";
  }
}
