import { z } from "zod";
import { email, senha, nome, telefone, cpf, dataNascimento, opcional, nomeUsuario } from "./comum.js";

export const cadastroSchema = z.object({
  nome_completo: nome,
  email,
  senha,
  telefone,
  cpf: opcional(cpf),
  data_nascimento: opcional(dataNascimento),
  usuario: nomeUsuario,
  consentimento: z.literal(true, { error: "Aceite a política de privacidade para criar a conta." }),
});

// Aceita e-mail ou nome de usuário no mesmo campo.
export const loginSchema = z.object({
  email: z
    .string({ error: "Informe o e-mail ou usuário." })
    .trim()
    .toLowerCase()
    .min(1, "Informe o e-mail ou usuário.")
    .max(160, "E-mail muito longo.")
    .refine((s) => (s.includes("@") ? z.email().safeParse(s).success : /^[a-z0-9][a-z0-9._]{2,29}$/.test(s)), "E-mail ou usuário inválido."),
  senha: z.string({ error: "Informe a senha." }).min(1, "Informe a senha.").max(200),
});

export const recuperarSchema = z.object({ email });

export const redefinirSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link de redefinição inválido."),
  senha,
});
