// Proteção CSRF para autenticação por cookie.
//
// Três camadas:
//  1. Cookie de sessão com SameSite=Lax (navegadores não o enviam em POST de outros sites).
//  2. Verificação de Origin/Referer em toda requisição que altera dados.
//  3. Token "signed double-submit": cookie sc_csrf (legível pelo JS do próprio site)
//     + cabeçalho X-CSRF-Token idêntico. O token é assinado com HMAC e vinculado à
//     sessão atual, então um token de outra sessão (ou forjado) é rejeitado.
import crypto from "node:crypto";
import { env, isProd } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export const COOKIE_CSRF = "sc_csrf";
const HEADER_CSRF = "x-csrf-token";
const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

const chave = crypto.createHmac("sha256", env.SESSION_SECRET).update("csrf-v1").digest();

function assinar(sessaoId, aleatorio) {
  return crypto.createHmac("sha256", chave).update(`${sessaoId}.${aleatorio}`).digest("base64url");
}

function gerarToken(sessaoId) {
  const aleatorio = crypto.randomBytes(24).toString("base64url");
  return `${aleatorio}.${assinar(sessaoId, aleatorio)}`;
}

function tokenValido(token, sessaoId) {
  if (typeof token !== "string") return false;
  const [aleatorio, assinatura] = token.split(".");
  if (!aleatorio || !assinatura) return false;
  const esperado = Buffer.from(assinar(sessaoId, aleatorio));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

export function emitirCsrf(res, sessaoId) {
  const token = gerarToken(sessaoId);
  res.cookie(COOKIE_CSRF, token, {
    httpOnly: false, // o frontend precisa ler para enviar no cabeçalho
    secure: isProd,
    sameSite: "strict",
    path: "/",
  });
  return token;
}

function origemPermitida(req) {
  const origem = req.get("origin") || req.get("referer");
  if (!origem) return true; // clientes não-navegador: o token CSRF continua obrigatório
  try {
    const recebida = new URL(origem).origin;
    const permitidas = new Set([new URL(env.APP_URL).origin, `${req.protocol}://${req.get("host")}`]);
    return permitidas.has(recebida);
  } catch {
    return false;
  }
}

export function protecaoCsrf(req, res, next) {
  const tokenCookie = req.cookies?.[COOKIE_CSRF];

  if (METODOS_SEGUROS.has(req.method)) {
    // Garante que o navegador sempre tenha um token válido para a sessão atual.
    if (!tokenValido(tokenCookie, req.sessaoId)) emitirCsrf(res, req.sessaoId);
    return next();
  }

  if (!origemPermitida(req)) {
    return next(new AppError(403, "Origem da requisição não permitida.", "CSRF_ORIGEM"));
  }

  const tokenHeader = req.get(HEADER_CSRF);
  if (!tokenHeader || tokenHeader !== tokenCookie || !tokenValido(tokenHeader, req.sessaoId)) {
    // Emite um token novo para o frontend repetir a requisição.
    emitirCsrf(res, req.sessaoId);
    return next(new AppError(403, "Sessão de segurança expirada. Tente novamente.", "CSRF_INVALIDO"));
  }

  next();
}
