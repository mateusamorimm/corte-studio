// Sessão por JWT em cookie httpOnly.
// O token carrega um "sv" (versão da senha): ao trocar a senha, todas as
// sessões antigas deixam de valer.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env, isProd } from "../config/env.js";

export const COOKIE_SESSAO = "sc_sessao";

export function versaoSenha(senhaHash) {
  return crypto.createHash("sha256").update(senhaHash ?? "").digest("hex").slice(0, 16);
}

export function criarSessao(res, usuario) {
  const sid = crypto.randomBytes(16).toString("hex");
  const token = jwt.sign(
    { sub: String(usuario.id_usuario), sid, sv: versaoSenha(usuario.senha_hash) },
    env.SESSION_SECRET,
    { expiresIn: `${env.SESSION_DAYS}d`, algorithm: "HS256" }
  );
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  return sid;
}

export function encerrarSessao(res) {
  res.clearCookie(COOKIE_SESSAO, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" });
}

export function lerSessao(token) {
  try {
    return jwt.verify(token, env.SESSION_SECRET, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
}
