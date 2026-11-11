// Configuração do Prisma CLI.
// Carrega o .env local (se existir) — as credenciais do Neon NUNCA vão para o código.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: usa as variáveis já definidas no ambiente */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
});
