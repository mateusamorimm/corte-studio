// Testes da integração com o Cloudinary (assinatura, confirmação, permissões e exclusão).
// A API do Cloudinary é simulada: nenhum arquivo real é enviado ou cobrado.
// Rodam com TEST_DATABASE_URL (branch de teste do Neon) e removem só o que criaram.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { MOTIVO_SKIP, prepararAmbienteTeste, Navegador, sufixo, DOMINIO_TESTE } from "./helpers.js";

const SEGREDO = "segredo-de-teste-do-cloudinary";
const SENHA = "Teste1234";

// Credenciais falsas ANTES de qualquer import do código (a configuração é lida uma vez, no import).
// Assim os testes nunca usam a conta real do Cloudinary, mesmo com o .env preenchido.
process.env.CLOUDINARY_CLOUD_NAME = "nuvemteste";
process.env.CLOUDINARY_API_KEY = "123456789012345";
process.env.CLOUDINARY_API_SECRET = SEGREDO;
process.env.CLOUDINARY_PASTA = "studio-corte-teste";

test("assinatura segue o algoritmo do Cloudinary (exemplo da documentação)", async () => {
  process.env.DATABASE_URL ||= "postgresql://x:x@127.0.0.1:1/x";
  process.env.DIRECT_URL ||= process.env.DATABASE_URL;
  process.env.SESSION_SECRET ||= "segredo-apenas-para-testes-automatizados-0123456789";
  const { assinar } = await import("../src/lib/cloudinary.js");
  const params = { eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 };
  assert.equal(assinar(params, "abcd"), "bfd09f95f331f558cbd1320e67aa8d488770583e");
});

describe("mídia no Cloudinary", { skip: MOTIVO_SKIP, concurrency: false }, () => {
  let server, base, prisma, transporte;
  const s = sufixo();
  const email = (n) => `${n}.m${s}@${DOMINIO_TESTE}`;
  let cliente, outro, admin, idCliente;
  const recursos = new Map(); // public_id → resposta simulada da Admin API
  const destruidos = [];

  async function entrar(e) {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/login", { email: e, senha: SENHA });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return nav;
  }

  before(async () => {
    prepararAmbienteTeste();
    process.env.CLOUDINARY_CLOUD_NAME = "nuvemteste";
    process.env.CLOUDINARY_API_KEY = "123456789012345";
    process.env.CLOUDINARY_API_SECRET = SEGREDO;
    process.env.CLOUDINARY_PASTA = "studio-corte-teste";
    ({ prisma } = await import("../src/lib/prisma.js"));
    ({ transporte } = await import("../src/lib/cloudinary.js"));
    // Admin API simulada
    transporte.fetch = async (url, opcoes = {}) => {
      const u = String(url);
      if (u.includes("/destroy")) {
        destruidos.push(Object.fromEntries(opcoes.body).public_id);
        return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
      }
      const m = u.match(/\/resources\/(image|video|raw)\/upload\/(.+)$/);
      const publicId = decodeURIComponent(m[2]);
      const r = recursos.get(publicId);
      return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response("{}", { status: 404 });
    };
    const { criarApp } = await import("../src/app.js");
    server = criarApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;

    const hash = await bcrypt.hash(SENHA, 4);
    const c = await prisma.usuario.create({ data: { nome_completo: "Cliente Mídia", email: email("cliente"), senha_hash: hash } });
    idCliente = c.id_usuario;
    await prisma.usuario.create({ data: { nome_completo: "Outro Cliente", email: email("outro"), senha_hash: hash } });
    await prisma.usuario.create({ data: { nome_completo: "Admin Mídia", email: email("admin"), senha_hash: hash, tipo_perfil: "ADMIN" } });
    cliente = await entrar(email("cliente"));
    outro = await entrar(email("outro"));
    admin = await entrar(email("admin"));
  });

  after(async () => {
    const ids = (await prisma.usuario.findMany({ where: { email: { endsWith: `.m${s}@${DOMINIO_TESTE}` } }, select: { id_usuario: true } })).map((u) => u.id_usuario);
    await prisma.midia.deleteMany({ where: { id_usuario: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id_usuario: { in: ids } } });
    await prisma.$disconnect();
    server.close();
  });

  const recurso = (publicId, extra = {}) => ({
    public_id: publicId,
    format: "jpg",
    bytes: 52341,
    width: 800,
    height: 600,
    secure_url: `https://res.cloudinary.com/nuvemteste/image/upload/v1/${publicId}.jpg`,
    ...extra,
  });

  test("assinatura exige login e respeita o perfil", async () => {
    assert.equal((await new Navegador(base).post("/api/midia/assinatura", { finalidade: "AVATAR" })).status, 401);
    assert.equal((await cliente.post("/api/midia/assinatura", { finalidade: "PRODUTO" })).status, 403);
    assert.equal((await cliente.post("/api/midia/assinatura", { finalidade: "AVATAR", tipo: "VIDEO" })).status, 400);
    assert.equal((await admin.post("/api/midia/assinatura", { finalidade: "PRODUTO" })).status, 200);
  });

  test("assinatura vem com pasta do usuário, formatos e assinatura válida", async () => {
    const r = await cliente.post("/api/midia/assinatura", { finalidade: "AVATAR" });
    assert.equal(r.status, 200);
    const a = r.json;
    assert.equal(a.folder, `studio-corte-teste/avatar/u${idCliente}`);
    assert.equal(a.allowed_formats, "jpg,jpeg,png,webp");
    assert.equal(a.url_envio, "https://api.cloudinary.com/v1_1/nuvemteste/image/upload");
    assert.equal(JSON.stringify(a).includes(SEGREDO), false, "o segredo nunca vai para o navegador");
    const baseAss = ["allowed_formats", "folder", "tags", "timestamp"].map((k) => `${k}=${a[k]}`).join("&");
    assert.equal(a.signature, crypto.createHash("sha1").update(baseAss + SEGREDO).digest("hex"));
  });

  test("confirmação recusa arquivo de outra pasta", async () => {
    const r = await cliente.post("/api/midia/confirmar", { finalidade: "AVATAR", public_id: `studio-corte-teste/avatar/u999999/x` });
    assert.equal(r.status, 403);
  });

  test("arquivo com formato não permitido é apagado do Cloudinary", async () => {
    const pid = `studio-corte-teste/avatar/u${idCliente}/gif${s}`;
    recursos.set(pid, recurso(pid, { format: "gif" }));
    const r = await cliente.post("/api/midia/confirmar", { finalidade: "AVATAR", public_id: pid });
    assert.equal(r.status, 400);
    assert.ok(destruidos.includes(pid));
    assert.equal(await prisma.midia.count({ where: { public_id: pid } }), 0);
  });

  test("arquivo grande demais é apagado do Cloudinary", async () => {
    const pid = `studio-corte-teste/avatar/u${idCliente}/grande${s}`;
    recursos.set(pid, recurso(pid, { bytes: 11 * 1024 * 1024 }));
    const r = await cliente.post("/api/midia/confirmar", { finalidade: "AVATAR", public_id: pid });
    assert.equal(r.status, 400);
    assert.ok(destruidos.includes(pid));
  });

  let urlAvatar, idMidia;
  test("envio válido é registrado e vira foto do perfil", async () => {
    const pid = `studio-corte-teste/avatar/u${idCliente}/foto${s}`;
    recursos.set(pid, recurso(pid));
    const r = await cliente.post("/api/midia/confirmar", { finalidade: "AVATAR", public_id: pid });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    urlAvatar = r.json.url;
    idMidia = r.json.id_midia;
    assert.match(urlAvatar, /^https:\/\/res\.cloudinary\.com\//);
    const again = await cliente.post("/api/midia/confirmar", { finalidade: "AVATAR", public_id: pid });
    assert.equal(again.json.id_midia, idMidia, "confirmar de novo não duplica");

    const p = await cliente.put("/api/me/avatar", { url: urlAvatar });
    assert.equal(p.status, 200);
    assert.equal(p.json.usuario.avatar_url, urlAvatar);
  });

  test("ninguém usa a mídia de outra pessoa nem URL externa como foto", async () => {
    assert.equal((await outro.put("/api/me/avatar", { url: urlAvatar })).status, 400);
    assert.equal((await outro.put("/api/me/capa", { url: "https://rastreador.example.com/pixel.png" })).status, 400);
    assert.equal((await outro.post("/api/me/cortes-enviados", { nome: "X", imagem_url: urlAvatar })).status, 400);
  });

  test("só o dono (ou admin) apaga; apagar limpa a foto do perfil", async () => {
    assert.equal((await outro.del(`/api/midia/${idMidia}`)).status, 403);
    const r = await cliente.del(`/api/midia/${idMidia}`);
    assert.equal(r.status, 200);
    assert.ok(destruidos.some((p) => p.endsWith(`foto${s}`)));
    const u = await prisma.usuario.findUnique({ where: { id_usuario: idCliente } });
    assert.equal(u.avatar_url, null);
  });
});
