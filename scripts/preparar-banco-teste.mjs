// Aplica as migrations na branch de TESTE do Neon (TEST_DATABASE_URL / TEST_DIRECT_URL).
// Recusa-se a rodar se as URLs de teste coincidirem com as do banco principal.
import { spawnSync } from "node:child_process";

const { TEST_DATABASE_URL, TEST_DIRECT_URL, DATABASE_URL, DIRECT_URL } = process.env;
if (!TEST_DATABASE_URL || !TEST_DIRECT_URL) {
  console.error("✖ Defina TEST_DATABASE_URL e TEST_DIRECT_URL no .env (branch de teste do Neon).");
  process.exit(1);
}
if ([DATABASE_URL, DIRECT_URL].includes(TEST_DATABASE_URL) || [DATABASE_URL, DIRECT_URL].includes(TEST_DIRECT_URL)) {
  console.error("✖ As URLs de teste são iguais às do banco principal. Operação recusada.");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DIRECT_URL };
const mascarar = (s) => s.replace(/postgres(ql)?:\/\/\S+/g, "[url oculta]").replace(/ at "[^"]+"/g, "");
for (const args of [["prisma", "migrate", "deploy"], ["node", "prisma/seed.js"]]) {
  const cmd = args[0] === "prisma" ? "npx" : args.shift();
  const r = spawnSync(cmd, args, { env, encoding: "utf8", shell: process.platform === "win32" });
  console.log(mascarar(`${r.stdout}${r.stderr}`).split("\n").filter((l) => l.trim() && !/Update available|─|│|npm i|major/.test(l)).join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
}
