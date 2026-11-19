// Leitura e validação das variáveis de ambiente.
// Nenhum valor sensível tem padrão no código: sem .env válido o servidor não sobe.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string({ error: "não definida" }).min(1, "não definida"),
  DIRECT_URL: z.string({ error: "não definida" }).min(1, "não definida"),
  SESSION_SECRET: z.string({ error: "não definida" }).min(32, "SESSION_SECRET precisa de pelo menos 32 caracteres"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Cloudinary (fotos, vídeos e modelos 3D). Sem as três credenciais, o envio usa o armazenamento local.
  CLOUDINARY_CLOUD_NAME: z.string().regex(/^[a-z0-9_-]+$/i, "CLOUDINARY_CLOUD_NAME inválido").optional(),
  CLOUDINARY_API_KEY: z.string().regex(/^\d+$/, "CLOUDINARY_API_KEY inválida").optional(),
  CLOUDINARY_API_SECRET: z.string().min(10).optional(),
  // Pasta raiz no Cloudinary (separa produção de testes na mesma conta)
  CLOUDINARY_PASTA: z.string().regex(/^[a-z0-9_-]+$/i, "CLOUDINARY_PASTA inválida").default("studio-corte"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n✖ Configuração inválida. Verifique o arquivo .env (veja .env.example):");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const smtpConfigurado = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
export const cloudinaryConfigurado = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
