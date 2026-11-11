// Utilitários dos testes de integração.
// Os testes que gravam dados só rodam com TEST_DATABASE_URL (uma branch de teste do Neon),
// nunca no banco principal.
export const TEST_DB = process.env.TEST_DATABASE_URL;
export const MOTIVO_SKIP = !TEST_DB
  ? "TEST_DATABASE_URL não definida (crie uma branch de teste no Neon)"
  : TEST_DB === process.env.DATABASE_URL
    ? "TEST_DATABASE_URL é igual à DATABASE_URL — recusado para proteger o banco principal"
    : false;

export function prepararAmbienteTeste() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = TEST_DB;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || TEST_DB;
  process.env.SESSION_SECRET ||= "segredo-apenas-para-testes-automatizados-0123456789";
  process.env.APP_URL = "http://localhost:3999";
}

// Cliente HTTP com "pote de cookies", como um navegador.
export class Navegador {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }
  guardar(res) {
    for (const linha of res.headers.getSetCookie()) {
      const [par, ...attrs] = linha.split(";");
      const i = par.indexOf("=");
      const nome = par.slice(0, i);
      const valor = par.slice(i + 1);
      const expirado = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || valor === "";
      if (expirado) this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }
  }
  cabecalhoCookie() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(metodo, caminho, corpo) {
    if (!this.cookies.has("sc_csrf") && metodo !== "GET") {
      this.guardar(await fetch(`${this.base}/api/csrf`, { headers: { cookie: this.cabecalhoCookie() } }));
    }
    const headers = { cookie: this.cabecalhoCookie(), origin: this.base };
    if (metodo !== "GET") headers["x-csrf-token"] = decodeURIComponent(this.cookies.get("sc_csrf") ?? "");
    if (corpo !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    this.guardar(res);
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* não-JSON */
    }
    return { status: res.status, json };
  }
  get(c) {
    return this.req("GET", c);
  }
  post(c, b = {}) {
    return this.req("POST", c, b);
  }
  put(c, b = {}) {
    return this.req("PUT", c, b);
  }
  patch(c, b = {}) {
    return this.req("PATCH", c, b);
  }
  del(c) {
    return this.req("DELETE", c);
  }
}

export const sufixo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const DOMINIO_TESTE = "teste.invalid"; // domínio reservado: nunca entrega e-mail real
