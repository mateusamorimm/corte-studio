import { z } from "zod";
import { email, senha, nome, telefone, cpf, dataNascimento, opcional } from "./comum.js";

export const cadastroSchema = z.object({
  nome_completo: nome,
  email,
  senha,
  telefone,
  cpf: opcional(cpf),
  data_nascimento: opcional(dataNascimento),
});

export const loginSchema = z.object({
  email,
  senha: z.string({ error: "Informe a senha." }).min(1, "Informe a senha.").max(200),
});

export const recuperarSchema = z.object({ email });

export const redefinirSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link de redefinição inválido."),
  senha,
});
