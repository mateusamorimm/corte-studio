import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

function limitador({ janelaMin, max, mensagem, chave }) {
  return rateLimit({
    windowMs: janelaMin * 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test" && !process.env.TESTAR_RATE_LIMIT,
    keyGenerator: chave,
    handler: (_req, res) =>
      res.status(429).json({ erro: { codigo: "MUITAS_TENTATIVAS", mensagem: mensagem } }),
  });
}

const ipEmail = (req) => `${req.ip}|${String(req.body?.email ?? "").trim().toLowerCase()}`;

export const limiteLogin = limitador({
  janelaMin: 15,
  max: 10,
  chave: ipEmail,
  mensagem: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
});

export const limiteCadastro = limitador({
  janelaMin: 60,
  max: 10,
  mensagem: "Muitos cadastros a partir desta conexão. Tente novamente mais tarde.",
});

const porUsuario = (req) => `u${req.usuario?.id_usuario ?? req.ip}`;

export const limiteUpload = limitador({
  janelaMin: 15,
  max: 30,
  chave: porUsuario,
  mensagem: "Muitos envios de imagem em pouco tempo. Aguarde alguns minutos.",
});

export const limiteAgendamento = limitador({
  janelaMin: 60,
  max: 20,
  chave: porUsuario,
  mensagem: "Muitas tentativas de agendamento. Aguarde um pouco e tente novamente.",
});

export const limiteAvaliacao = limitador({
  janelaMin: 60,
  max: 20,
  chave: porUsuario,
  mensagem: "Muitas avaliações em pouco tempo. Tente novamente mais tarde.",
});

export const limiteSenha = limitador({
  janelaMin: 15,
  max: 5,
  chave: porUsuario,
  mensagem: "Muitas tentativas de troca de senha. Aguarde alguns minutos.",
});

export const limiteRecuperacao = limitador({
  janelaMin: 15,
  max: 5,
  chave: ipEmail,
  mensagem: "Muitas solicitações. Aguarde alguns minutos antes de tentar de novo.",
});
