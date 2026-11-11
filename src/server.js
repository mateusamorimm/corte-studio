import { env } from "./config/env.js";
import { criarApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const app = criarApp();

const server = app.listen(env.PORT, () => {
  console.log(`Studio Corte rodando em ${env.APP_URL} (porta ${env.PORT}, ${env.NODE_ENV})`);
});

async function encerrar(sinal) {
  console.log(`\n${sinal} recebido, encerrando...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => encerrar("SIGINT"));
process.on("SIGTERM", () => encerrar("SIGTERM"));
