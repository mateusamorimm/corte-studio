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

// Aceita com ou sem +55: "+55 (11) 98765-4321" → "11987654321"
export const telefone = z
  .string()
  .trim()
  .transform(soDigitos)
  .transform((s) => ((s.length === 12 || s.length === 13) && s.startsWith("55") ? s.slice(2) : s))
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

export const id = z.coerce.number({ error: "ID inválido." }).int("ID inválido.").positive("ID inválido.");

// Texto livre opcional: "" ou só espaços → null.
export const textoOpcional = (max, rotulo = "Texto") =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v === undefined ? undefined : v),
    z.string().trim().max(max, `${rotulo}: máximo de ${max} caracteres.`).nullable().optional()
  );

export const textoObrigatorio = (max, rotulo) =>
  z
    .string({ error: `Informe ${rotulo}.` })
    .trim()
    .min(1, `Informe ${rotulo}.`)
    .max(max, `${rotulo[0].toUpperCase()}${rotulo.slice(1)}: máximo de ${max} caracteres.`);

// Imagem: enviada ao próprio sistema (/api/imagens/<uuid>) ou URL https externa.
const RE_IMAGEM_LOCAL = /^\/api\/imagens\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const urlImagem = z
  .string()
  .trim()
  .max(500, "URL da imagem muito longa.")
  .refine((s) => {
    if (RE_IMAGEM_LOCAL.test(s)) return true;
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Imagem inválida. Envie um arquivo ou informe uma URL http(s).");
export const urlImagemOpcional = z.preprocess((v) => (v === "" ? null : v), urlImagem.nullable().optional());

export const urlOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(500, "URL muito longa.")
    .refine((s) => {
      try {
        return new URL(s).protocol === "https:";
      } catch {
        return false;
      }
    }, "Informe uma URL que comece com https://")
    .nullable()
    .optional()
);

// Valor em reais: aceita 45, "45", "45.9", "45,90" → "45.90"
export const dinheiro = z
  .union([z.number(), z.string()], { error: "Informe o valor." })
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((s) => /^\d{1,7}(\.\d{1,2})?$/.test(s), "Valor inválido. Use até 2 casas decimais.")
  .transform((s) => Number(s).toFixed(2))
  .refine((s) => Number(s) <= 999999.99, "Valor muito alto.");

export const inteiro = (min, max, rotulo = "Valor") =>
  z.coerce
    .number({ error: `${rotulo} inválido.` })
    .int(`${rotulo} deve ser um número inteiro.`)
    .min(min, `${rotulo}: mínimo ${min}.`)
    .max(max, `${rotulo}: máximo ${max}.`);

export const dataIso = z
  .string({ error: "Informe a data." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Data inválida.");

export const horaTexto = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).");

export const instante = z
  .string({ error: "Informe o horário." })
  .refine((s) => !Number.isNaN(Date.parse(s)), "Horário inválido.")
  .transform((s) => new Date(s));

export const booleano = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

// Usuário de rede social: "@fulano", "fulano" ou URL do perfil → "fulano"
export const usuarioRede = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    let s = v.trim();
    if (!s) return null;
    s = s.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\/@?/i, "").replace(/^@/, "").replace(/\/.*$/, "");
    return s;
  },
  z
    .string()
    .regex(/^[A-Za-z0-9._]{1,60}$/, "Usuário inválido (use letras, números, ponto ou _).")
    .nullable()
    .optional()
);

export const telefoneOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.replace(/\D/g, "") === "" ? null : v),
  telefone.nullable().optional()
);

// WhatsApp: DDD + número, com ou sem 55 → só dígitos com 55 na frente.
export const whatsappOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.replace(/\D/g, "") === "" ? null : v),
  z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .transform((s) => (s.length === 10 || s.length === 11 ? `55${s}` : s))
    .refine((s) => /^55\d{10,11}$/.test(s), "WhatsApp inválido. Use DDD + número.")
    .nullable()
    .optional()
);

export const emailOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  email.nullable().optional()
);

// Nome de login: 3 a 30 caracteres, letras minúsculas, números, ponto ou _.
export const nomeUsuario = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/^@/, "") || null : v),
  z
    .string()
    .regex(/^[a-z0-9][a-z0-9._]{2,29}$/, "Nome de usuário: 3 a 30 letras, números, ponto ou _.")
    .nullable()
    .optional()
);

// Link clicável seguro: https, e-mail ou telefone.
export const urlContato = z
  .string({ error: "Informe o link." })
  .trim()
  .max(300, "Link muito longo.")
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" ? Boolean(u.hostname.includes(".")) : /^(mailto:[^@\s]+@[^@\s]+|tel:\+?[0-9]{8,15})$/.test(s);
    } catch {
      return false;
    }
  }, "Link inválido. Use um endereço https://, e-mail ou telefone.");

export const area = z.enum(["BARBEARIA", "CABELEIREIRO", "AMBOS"], { error: "Área inválida." });

// Modelo 3D opcional: arquivo .glb no nosso Cloudinary ou link do Sketchfab (vira o endereço de incorporação).
export const modelo3d = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (!s) return null;
    const id = s.match(/^https:\/\/(?:www\.)?sketchfab\.com\/(?:3d-models\/(?:[\w-]*-)?|models\/)([0-9a-f]{32})(?:[/?#].*)?$/i)?.[1];
    return id ? `https://sketchfab.com/models/${id.toLowerCase()}/embed` : s;
  },
  z
    .string()
    .max(500)
    .refine(
      (s) => /^https:\/\/res\.cloudinary\.com\/[\w-]+\/raw\/upload\/.+\.glb$/i.test(s) || /^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/.test(s),
      "Envie um arquivo .glb ou cole o link de um modelo do Sketchfab."
    )
    .nullable()
    .optional()
);

const vazio = (v) => (v === "" ? undefined : v);
export const opcionalQuery = (schema) => z.preprocess(vazio, schema.optional());
