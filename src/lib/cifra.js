// Cifra de documentos sensíveis (CPF, RG, CTPS… de funcionários): AES-256-GCM com chave do ambiente.
// Formato gravado: v1:<iv>:<tag>:<texto cifrado>, tudo em base64url.
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

function chave() {
  if (!env.CHAVE_DADOS) {
    throw new AppError(503, "O servidor ainda não tem a chave de proteção dos documentos (CHAVE_DADOS). Fale com o responsável técnico.", "CHAVE_AUSENTE");
  }
  return Buffer.from(env.CHAVE_DADOS, "hex");
}

export function cifrar(texto) {
  if (texto === null || texto === undefined || texto === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dados.toString("base64url")].join(":");
}

export function decifrar(valor) {
  if (!valor) return null;
  const [versao, iv, tag, dados] = valor.split(":");
  if (versao !== "v1") throw new Error("Formato de cifra desconhecido.");
  const d = crypto.createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
}
