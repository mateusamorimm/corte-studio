// Validadores reutilizáveis (backend). O frontend aplica as mesmas regras em public/js/validacao.js.
import { z } from "zod";

export const email = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .max(160, "E-mail muito longo.")
  .pipe(z.email("E-mail inválido."));

// bcrypt considera no máximo 72 bytes
export const senha = z
  .string({ error: "Informe a senha." })
  .min(8, "A senha deve ter no mínimo 8 caracteres.")
  .refine((s) => Buffer.byteLength(s, "utf8") <= 72, "A senha deve ter no máximo 72 caracteres.")
  .refine((s) => /[A-Za-zÀ-ÿ]/.test(s) && /\d/.test(s), "A senha deve conter letras e números.");

export const nome = z
  .string({ error: "Informe o nome." })
  .trim()
  .min(3, "O nome deve ter pelo menos 3 caracteres.")
  .max(120, "Nome muito longo.");

const soDigitos = (s) => s.replace(/\D/g, "");

export const telefone = z
  .string()
  .trim()
  .transform(soDigitos)
  .refine((s) => s.length === 10 || s.length === 11, "Telefone inválido. Use DDD + número.");

export function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[t])) return false;
  }
  return true;
}

export const cpf = z
  .string()
  .trim()
  .transform(soDigitos)
  .refine(cpfValido, "CPF inválido.");

// "AAAA-MM-DD" → Date (UTC meia-noite), no passado e com idade plausível.
export const dataNascimento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida.")
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Data de nascimento inválida.")
  .refine((d) => d < new Date() && d.getUTCFullYear() >= 1900, "Data de nascimento inválida.");

// Campo opcional: "" ou ausente → undefined; null explícito → null (para limpar).
export const opcional = (schema) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.nullable().optional());

export const idParam = z.object({ id: z.coerce.number().int().positive("ID inválido.") });
