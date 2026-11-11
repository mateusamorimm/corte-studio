import { test } from "node:test";
import assert from "node:assert/strict";
import { cpfValido } from "../src/validators/comum.js";

process.env.DATABASE_URL ||= "postgresql://x:x@127.0.0.1:1/x";
process.env.DIRECT_URL ||= process.env.DATABASE_URL;
process.env.SESSION_SECRET ||= "segredo-apenas-para-testes-automatizados-0123456789";
const { cadastroSchema, redefinirSchema } = await import("../src/validators/auth.js");

test("CPF: dígitos verificadores", () => {
  assert.equal(cpfValido("52998224725"), true);
  assert.equal(cpfValido("52998224724"), false);
  assert.equal(cpfValido("11111111111"), false);
  assert.equal(cpfValido("123"), false);
});

test("cadastro: normaliza e-mail, telefone e CPF; campos opcionais vazios", () => {
  const r = cadastroSchema.parse({ nome_completo: " Ana Souza ", email: " ANA@Exemplo.com ", senha: "abc12345", telefone: "(11) 3333-4444", cpf: "", data_nascimento: "" });
  assert.equal(r.email, "ana@exemplo.com");
  assert.equal(r.nome_completo, "Ana Souza");
  assert.equal(r.telefone, "1133334444");
  assert.equal(r.cpf, undefined);
  assert.equal(r.data_nascimento, undefined);
});

test("senha: exige 8+ caracteres com letras e números, máx. 72 bytes", () => {
  const base = { nome_completo: "Ana Souza", email: "a@b.com", telefone: "11999998888" };
  assert.throws(() => cadastroSchema.parse({ ...base, senha: "abcdefgh" }));
  assert.throws(() => cadastroSchema.parse({ ...base, senha: "12345678" }));
  assert.throws(() => cadastroSchema.parse({ ...base, senha: "a1" + "x".repeat(80) }));
  assert.doesNotThrow(() => cadastroSchema.parse({ ...base, senha: "senhaBoa1" }));
});

test("data de nascimento no futuro é recusada", () => {
  assert.throws(() => cadastroSchema.parse({ nome_completo: "Ana Souza", email: "a@b.com", senha: "abc12345", telefone: "11999998888", data_nascimento: "2999-01-01" }));
});

test("token de redefinição precisa ter o formato esperado", () => {
  assert.throws(() => redefinirSchema.parse({ token: "curto", senha: "abc12345" }));
  assert.doesNotThrow(() => redefinirSchema.parse({ token: "a".repeat(43), senha: "abc12345" }));
});
