// Cliente mínimo do Cloudinary (sem SDK): assinatura de envio, consulta e exclusão de arquivos.
// O segredo da API nunca sai do servidor; o navegador recebe só a assinatura de uso único.
import crypto from "node:crypto";
import { env, cloudinaryConfigurado } from "../config/env.js";
import { AppError } from "./errors.js";

const BASE = "https://api.cloudinary.com/v1_1";

// Permite trocar o fetch nos testes automatizados
export const transporte = { fetch: (...args) => globalThis.fetch(...args) };

function exigirConfigurado() {
  if (!cloudinaryConfigurado) {
    throw new AppError(503, "Envio de mídia indisponível: Cloudinary não configurado.", "MIDIA_INDISPONIVEL");
  }
}

// Assinatura do Cloudinary: parâmetros em ordem alfabética "k=v&k2=v2" + segredo, SHA-1 em hex.
export function assinar(params, segredo = env.CLOUDINARY_API_SECRET) {
  const base = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(base + segredo).digest("hex");
}

const autorizacao = () => "Basic " + Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString("base64");
const caminhoPublicId = (publicId) => publicId.split("/").map(encodeURIComponent).join("/");

export function urlEnvio(resourceType) {
  return `${BASE}/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
}

// Parâmetros assinados para o navegador enviar direto ao Cloudinary.
export function parametrosEnvio({ pasta, formatos, tags }) {
  exigirConfigurado();
  const params = {
    folder: pasta,
    allowed_formats: formatos.join(","),
    tags: tags.join(","),
    timestamp: Math.floor(Date.now() / 1000),
  };
  return { ...params, api_key: env.CLOUDINARY_API_KEY, signature: assinar(params), cloud_name: env.CLOUDINARY_CLOUD_NAME };
}

// Dados reais do arquivo no Cloudinary (o servidor nunca confia no que o navegador informa).
export async function obterRecurso(resourceType, publicId) {
  exigirConfigurado();
  const res = await transporte.fetch(
    `${BASE}/${env.CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload/${caminhoPublicId(publicId)}`,
    { headers: { Authorization: autorizacao() } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new AppError(502, "Não foi possível conferir o arquivo no Cloudinary. Tente novamente.", "MIDIA_FALHA");
  return res.json();
}

export async function destruir(resourceType, publicId) {
  exigirConfigurado();
  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: "true" };
  const corpo = new URLSearchParams({ ...params, api_key: env.CLOUDINARY_API_KEY, signature: assinar(params) });
  const res = await transporte.fetch(`${BASE}/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`, { method: "POST", body: corpo });
  if (!res.ok) throw new AppError(502, "Não foi possível remover o arquivo do Cloudinary.", "MIDIA_FALHA");
  return res.json();
}

// Envio feito pelo próprio servidor (script de migração das imagens antigas).
export async function enviarDoServidor({ dados, mime, pasta, tags }) {
  exigirConfigurado();
  const params = { folder: pasta, tags: tags.join(","), timestamp: Math.floor(Date.now() / 1000) };
  const corpo = new FormData();
  corpo.append("file", new Blob([dados], { type: mime }));
  for (const [k, v] of Object.entries(params)) corpo.append(k, String(v));
  corpo.append("api_key", env.CLOUDINARY_API_KEY);
  corpo.append("signature", assinar(params));
  const res = await transporte.fetch(urlEnvio("image"), { method: "POST", body: corpo });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Cloudinary respondeu ${res.status}`);
  return json;
}
