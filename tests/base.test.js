// Testes do módulo base (não precisam de banco): segurança, CSRF, estáticos e erros.
// Usa um banco inexistente de propósito para verificar o comportamento sem conexão.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://teste:teste@127.0.0.1:1/inexistente?connect_timeout=2";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = "segredo-apenas-para-testes-automatizados-0123456789";
process.env.APP_URL = "http://localhost:3999";

const { criarApp } = await import("../src/app.js");

let server;
let base;

before(async () => {
  server = criarApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function cookieDe(res, nome) {
  const linha = res.headers.getSetCookie().find((c) => c.startsWith(`${nome}=`));
  return linha ? decodeURIComponent(linha.split(";")[0].slice(nome.length + 1)) : null;
}

test("serve o frontend estático com cabeçalhos de segurança", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Studio/);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("não expõe arquivos do servidor", async () => {
  for (const caminho of ["/.env.example", "/package.json", "/src/app.js", "/prisma/schema.prisma"]) {
    const res = await fetch(`${base}${caminho}`);
    assert.equal(res.status, 404, caminho);
  }
});

test("health informa banco indisponível sem vazar detalhes", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 503);
  const corpo = await res.json();
  assert.deepEqual(corpo, { api: "ok", banco: "indisponivel" });
});

test("GET na API emite cookie CSRF não-httpOnly e SameSite=Strict", async () => {
  const res = await fetch(`${base}/api/csrf`);
  const { csrfToken } = await res.json();
  assert.ok(csrfToken);
  const linha = res.headers.getSetCookie().find((c) => c.startsWith("sc_csrf="));
  assert.match(linha, /SameSite=Strict/i);
  assert.doesNotMatch(linha, /HttpOnly/i);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("POST sem token CSRF é bloqueado", async () => {
  const res = await fetch(`${base}/api/qualquer`, { method: "POST" });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).erro.codigo, "CSRF_INVALIDO");
});

test("POST com token no cabeçalho diferente do cookie é bloqueado", async () => {
  const r1 = await fetch(`${base}/api/csrf`);
  const token = cookieDe(r1, "sc_csrf");
  const res = await fetch(`${base}/api/qualquer`, {
    method: "POST",
    headers: { cookie: `sc_csrf=${token}`, "x-csrf-token": token + "x" },
  });
  assert.equal(res.status, 403);
});

test("token forjado (assinatura inválida) é bloqueado", async () => {
  const forjado = "abc.def";
  const res = await fetch(`${base}/api/qualquer`, {
    method: "POST",
    headers: { cookie: `sc_csrf=${forjado}`, "x-csrf-token": forjado },
  });
  assert.equal(res.status, 403);
});

test("POST de outra origem é bloqueado mesmo com token válido", async () => {
  const r1 = await fetch(`${base}/api/csrf`);
  const token = cookieDe(r1, "sc_csrf");
  const res = await fetch(`${base}/api/qualquer`, {
    method: "POST",
    headers: { cookie: `sc_csrf=${token}`, "x-csrf-token": token, origin: "https://site-malicioso.com" },
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).erro.codigo, "CSRF_ORIGEM");
});

test("POST com token válido e mesma origem passa pela proteção", async () => {
  const r1 = await fetch(`${base}/api/csrf`);
  const token = cookieDe(r1, "sc_csrf");
  const res = await fetch(`${base}/api/qualquer`, {
    method: "POST",
    headers: { cookie: `sc_csrf=${token}`, "x-csrf-token": token, origin: base, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).erro.codigo, "ROTA_INEXISTENTE");
});

test("JSON malformado retorna 400 padronizado", async () => {
  const r1 = await fetch(`${base}/api/csrf`);
  const token = cookieDe(r1, "sc_csrf");
  const res = await fetch(`${base}/api/qualquer`, {
    method: "POST",
    headers: { cookie: `sc_csrf=${token}`, "x-csrf-token": token, "content-type": "application/json" },
    body: "{quebrado",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).erro.codigo, "JSON_INVALIDO");
});

test("cookie de sessão inválido é ignorado e removido", async () => {
  const res = await fetch(`${base}/api/csrf`, { headers: { cookie: "sc_sessao=token.falso.qualquer" } });
  assert.equal(res.status, 200);
  const limpa = res.headers.getSetCookie().find((c) => c.startsWith("sc_sessao="));
  assert.match(limpa, /Expires=Thu, 01 Jan 1970/);
});
