// Cliente HTTP da API do Studio Corte.
// - Envia cookies da mesma origem e o token CSRF (cabeçalho X-CSRF-Token) em toda alteração.
// - Se o token expirou, busca um novo e repete a requisição uma única vez.
// - Erros viram ApiError com mensagem pronta para exibir ao usuário.

export class ApiError extends Error {
  constructor(status, erro = {}) {
    super(erro.mensagem || "Não foi possível concluir a operação.");
    this.status = status;
    this.codigo = erro.codigo || "ERRO";
    this.detalhes = erro.detalhes;
  }
}

function lerCookie(nome) {
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${nome}=`));
  return par ? decodeURIComponent(par.slice(nome.length + 1)) : null;
}

async function renovarCsrf() {
  await fetch("/api/csrf", { credentials: "same-origin" });
}

export async function api(metodo, caminho, corpo, tentativa = 0) {
  const seguro = metodo === "GET";
  if (!seguro && !lerCookie("sc_csrf")) await renovarCsrf();

  const headers = { Accept: "application/json" };
  if (!seguro) headers["X-CSRF-Token"] = lerCookie("sc_csrf") || "";
  if (corpo !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`/api${caminho}`, {
      method: metodo,
      headers,
      credentials: "same-origin",
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ApiError(0, { codigo: "SEM_CONEXAO", mensagem: "Sem conexão com o servidor. Verifique sua internet." });
  }

  let dados = null;
  try {
    dados = await res.json();
  } catch {
    /* resposta sem corpo JSON */
  }

  if (res.ok) return dados;

  if (res.status === 403 && dados?.erro?.codigo === "CSRF_INVALIDO" && tentativa === 0) {
    return api(metodo, caminho, corpo, 1); // o servidor já enviou um token novo no cookie
  }
  throw new ApiError(res.status, dados?.erro);
}

// Reduz a imagem no navegador antes do envio (lado maior ≤ ladoMax, WebP ou JPEG).
// Se não ficar menor que o original, envia o original. O servidor valida de novo.
export const LIMITE_ENVIO = 3 * 1024 * 1024;
export async function comprimirImagem(arquivo, { ladoMax = 1600, qualidade = 0.82 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    return arquivo; // formato que o navegador não decodifica: o servidor decide
  }
  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  if (escala === 1 && arquivo.size <= 400 * 1024) {
    bitmap.close?.();
    return arquivo;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  const paraBlob = (tipo) => new Promise((ok) => canvas.toBlob(ok, tipo, qualidade));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await paraBlob("image/webp");
  if (!blob || blob.type !== "image/webp") {
    // Sem WebP: JPEG não tem transparência, então pinta o fundo de branco
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    blob = await paraBlob("image/jpeg");
  }
  bitmap.close?.();
  return blob && blob.size < arquivo.size ? blob : arquivo;
}

// Envia um arquivo de imagem (corpo binário) e devolve a URL gravada no servidor.
export async function enviarImagem(original, tentativa = 0) {
  const arquivo = tentativa === 0 ? await comprimirImagem(original) : original;
  if (arquivo.size > LIMITE_ENVIO) throw new ApiError(413, { mensagem: "Imagem muito grande mesmo após reduzir. Escolha outra (até 3 MB)." });
  if (!lerCookie("sc_csrf")) await renovarCsrf();
  let res;
  try {
    res = await fetch("/api/imagens", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": arquivo.type || "application/octet-stream", "X-CSRF-Token": lerCookie("sc_csrf") || "" },
      credentials: "same-origin",
      body: arquivo,
    });
  } catch {
    throw new ApiError(0, { codigo: "SEM_CONEXAO", mensagem: "Sem conexão com o servidor. Verifique sua internet." });
  }
  let dados = null;
  try {
    dados = await res.json();
  } catch {
    /* sem corpo */
  }
  if (res.ok) return dados.url;
  if (res.status === 403 && dados?.erro?.codigo === "CSRF_INVALIDO" && tentativa === 0) return enviarImagem(arquivo, 1);
  if (res.status === 413) throw new ApiError(413, { mensagem: "Imagem muito grande. O limite é 3 MB." });
  throw new ApiError(res.status, dados?.erro);
}

export const get = (c) => api("GET", c);
export const post = (c, b = {}) => api("POST", c, b);
export const put = (c, b = {}) => api("PUT", c, b);
export const patch = (c, b = {}) => api("PATCH", c, b);
export const del = (c) => api("DELETE", c);
