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

export const get = (c) => api("GET", c);
export const post = (c, b = {}) => api("POST", c, b);
export const put = (c, b = {}) => api("PUT", c, b);
export const patch = (c, b = {}) => api("PATCH", c, b);
export const del = (c) => api("DELETE", c);
