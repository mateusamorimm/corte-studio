// Testes de integração da autenticação (exigem TEST_DATABASE_URL).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { MOTIVO_SKIP, prepararAmbienteTeste, Navegador, sufixo, DOMINIO_TESTE } from "./helpers.js";

describe("autenticação", { skip: MOTIVO_SKIP }, () => {
  let server, base, prisma, caixa;
  const emailCliente = `cliente.${sufixo()}@${DOMINIO_TESTE}`;
  const senha = "Teste1234";

  before(async () => {
    prepararAmbienteTeste();
    ({ prisma } = await import("../src/lib/prisma.js"));
    ({ caixaDeTeste: caixa } = await import("../src/lib/mailer.js"));
    const { criarApp } = await import("../src/app.js");
    server = criarApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    // Remove apenas o que este teste criou (domínio reservado de teste).
    await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${DOMINIO_TESTE}` } } });
    await prisma.$disconnect();
    server.close();
  });

  test("/me sem sessão retorna usuario null", async () => {
    const nav = new Navegador(base);
    const r = await nav.get("/api/auth/me");
    assert.equal(r.status, 200);
    assert.equal(r.json.usuario, null);
  });

  test("cadastro valida os dados no backend", async () => {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/cadastro", { nome_completo: "A", email: "x", senha: "123", telefone: "1", consentimento: true });
    assert.equal(r.status, 400);
    assert.ok(r.json.erro.detalhes.length >= 3);
  });

  test("cadastro recusa CPF inválido", async () => {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/cadastro", {
      nome_completo: "Cliente Teste", email: `cpf.${sufixo()}@${DOMINIO_TESTE}`, senha, telefone: "(11) 98888-7777", cpf: "111.111.111-11", consentimento: true,
    });
    assert.equal(r.status, 400);
    assert.match(r.json.erro.mensagem, /CPF/);
  });

  test("cadastro cria CLIENTE, normaliza dados e já autentica", async () => {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/cadastro", {
      nome_completo: "  Cliente Teste  ", email: emailCliente.toUpperCase(), senha, telefone: "(11) 98888-7777", cpf: "529.982.247-25", data_nascimento: "1995-04-20", consentimento: true,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.usuario.tipo_perfil, "CLIENTE");
    assert.equal(r.json.usuario.email, emailCliente);
    assert.equal(r.json.usuario.telefone, "11988887777");
    assert.equal(r.json.usuario.cpf, "52998224725");
    assert.equal(r.json.usuario.senha_hash, undefined);
    const me = await nav.get("/api/auth/me");
    assert.equal(me.json.usuario.email, emailCliente);
    const db = await prisma.usuario.findUnique({ where: { email: emailCliente } });
    assert.match(db.senha_hash, /^\$2b\$12\$/);
  });

  test("cadastro não aceita e-mail ou CPF repetido", async () => {
    const nav = new Navegador(base);
    const r1 = await nav.post("/api/auth/cadastro", { nome_completo: "Outro", email: emailCliente, senha, telefone: "11977776666", consentimento: true });
    assert.equal(r1.status, 409);
    const r2 = await nav.post("/api/auth/cadastro", {
      nome_completo: "Outro", email: `outro.${sufixo()}@${DOMINIO_TESTE}`, senha, telefone: "11977776666", cpf: "52998224725", consentimento: true,
    });
    assert.equal(r2.status, 409);
    assert.match(r2.json.erro.mensagem, /CPF/);
  });

  test("login com senha errada e com e-mail inexistente dão a mesma resposta", async () => {
    const nav = new Navegador(base);
    const a = await nav.post("/api/auth/login", { email: emailCliente, senha: "Errada123" });
    const b = await nav.post("/api/auth/login", { email: `ninguem@${DOMINIO_TESTE}`, senha: "Errada123" });
    assert.equal(a.status, 401);
    assert.deepEqual(a.json, b.json);
  });

  test("login correto cria sessão; logout encerra", async () => {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/login", { email: emailCliente, senha });
    assert.equal(r.status, 200);
    assert.ok(nav.cookies.has("sc_sessao"));
    assert.equal((await nav.get("/api/auth/me")).json.usuario.email, emailCliente);
    await nav.post("/api/auth/logout");
    assert.equal((await nav.get("/api/auth/me")).json.usuario, null);
  });

  test("token CSRF anterior ao login não vale para a sessão nova", async () => {
    const nav = new Navegador(base);
    await nav.get("/api/csrf");
    const tokenAnonimo = nav.cookies.get("sc_csrf");
    await nav.post("/api/auth/login", { email: emailCliente, senha });
    assert.notEqual(nav.cookies.get("sc_csrf"), tokenAnonimo);
    nav.cookies.set("sc_csrf", tokenAnonimo);
    const r = await nav.post("/api/auth/logout");
    assert.equal(r.status, 403);
  });

  test("conta desativada não entra e sessão ativa cai na hora", async () => {
    const nav = new Navegador(base);
    await nav.post("/api/auth/login", { email: emailCliente, senha });
    await prisma.usuario.update({ where: { email: emailCliente }, data: { ativo: false } });
    assert.equal((await nav.get("/api/auth/me")).json.usuario, null);
    const r = await new Navegador(base).post("/api/auth/login", { email: emailCliente, senha });
    assert.equal(r.status, 403);
    await prisma.usuario.update({ where: { email: emailCliente }, data: { ativo: true } });
  });

  test("recuperação: resposta igual para e-mail existente e inexistente", async () => {
    const nav = new Navegador(base);
    caixa.length = 0;
    const a = await nav.post("/api/auth/recuperar-senha", { email: emailCliente });
    const b = await nav.post("/api/auth/recuperar-senha", { email: `ninguem@${DOMINIO_TESTE}` });
    assert.equal(a.status, 200);
    assert.deepEqual(a.json, b.json);
    assert.equal(caixa.length, 1);
    assert.equal(caixa[0].para, emailCliente);
  });

  test("redefinição: token de uso único, invalida sessões antigas e links anteriores", async () => {
    const sessaoAntiga = new Navegador(base);
    await sessaoAntiga.post("/api/auth/login", { email: emailCliente, senha });

    caixa.length = 0;
    const nav = new Navegador(base);
    await nav.post("/api/auth/recuperar-senha", { email: emailCliente });
    const token1 = caixa[0].texto.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    await nav.post("/api/auth/recuperar-senha", { email: emailCliente });
    const token2 = caixa[1].texto.match(/#token=([A-Za-z0-9_-]{43})/)[1];

    // O primeiro link foi invalidado pelo segundo pedido
    assert.equal((await nav.post("/api/auth/redefinir-senha", { token: token1, senha: "NovaSenha99" })).status, 400);

    // Senha fraca é recusada
    assert.equal((await nav.post("/api/auth/redefinir-senha", { token: token2, senha: "fraca" })).status, 400);

    // Dois usos simultâneos: apenas um tem sucesso
    const [x, y] = await Promise.all([
      new Navegador(base).post("/api/auth/redefinir-senha", { token: token2, senha: "NovaSenha99" }),
      new Navegador(base).post("/api/auth/redefinir-senha", { token: token2, senha: "OutraSenha77" }),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 400]);
    const senhaFinal = x.status === 200 ? "NovaSenha99" : "OutraSenha77";

    assert.equal((await sessaoAntiga.get("/api/auth/me")).json.usuario, null, "sessão antiga deveria cair");
    assert.equal((await new Navegador(base).post("/api/auth/login", { email: emailCliente, senha })).status, 401);
    assert.equal((await new Navegador(base).post("/api/auth/login", { email: emailCliente, senha: senhaFinal })).status, 200);

    const salvos = await prisma.tokenRedefinicaoSenha.findMany({ where: { usuario: { email: emailCliente } } });
    assert.ok(salvos.every((t) => t.usado_em !== null && t.token_hash.length === 64));
    assert.ok(!salvos.some((t) => t.token_hash === token2), "token não pode ser salvo em texto puro");
  });

  test("token expirado é recusado", async () => {
    caixa.length = 0;
    const nav = new Navegador(base);
    await nav.post("/api/auth/recuperar-senha", { email: emailCliente });
    const token = caixa[0].texto.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    await prisma.tokenRedefinicaoSenha.updateMany({
      where: { usuario: { email: emailCliente }, usado_em: null },
      data: { expira_em: new Date(Date.now() - 1000) },
    });
    assert.equal((await nav.post("/api/auth/redefinir-senha", { token, senha: "Valida1234" })).status, 400);
  });
});
