// Copia para o Cloudinary as imagens guardadas na tabela "imagem" (Neon) e troca as referências
// /api/imagens/<uuid> pelas URLs do Cloudinary. Não apaga nada: a tabela "imagem" fica intacta e o
// endereço antigo continua funcionando.
//
// Uso:
//   node --env-file=.env scripts/migrar-imagens-cloudinary.mjs            → só simula (padrão)
//   node --env-file=.env scripts/migrar-imagens-cloudinary.mjs --executar → envia e atualiza (só com autorização)
import { prisma } from "../src/lib/prisma.js";
import { env, cloudinaryConfigurado } from "../src/config/env.js";
import { enviarDoServidor } from "../src/lib/cloudinary.js";

const executar = process.argv.includes("--executar");
const destinoBanco = new URL(process.env.DATABASE_URL).host.split(".")[0];

// Colunas que podem apontar para /api/imagens/<uuid>
const REFERENCIAS = [
  { tabela: "usuario", coluna: "avatar_url", chave: "id_usuario", finalidade: "AVATAR" },
  { tabela: "usuario", coluna: "capa_url", chave: "id_usuario", finalidade: "CAPA" },
  { tabela: "corte_enviado", coluna: "imagem_url", chave: "id_corte_enviado", finalidade: "REFERENCIA" },
  { tabela: "produto", coluna: "imagem_url", chave: "id_produto", finalidade: "PRODUTO" },
  { tabela: "servico", coluna: "imagem_url", chave: "id_servico", finalidade: "SERVICO" },
  { tabela: "corte_galeria", coluna: "imagem_url", chave: "id_corte", finalidade: "GALERIA" },
  { tabela: "configuracao_salao", coluna: "hero_imagem_url", chave: "id", finalidade: "SALAO" },
];

async function main() {
  console.log(`Banco: ${destinoBanco} | Pasta no Cloudinary: ${env.CLOUDINARY_PASTA} | Modo: ${executar ? "EXECUTAR" : "simulação"}`);
  if (executar && !cloudinaryConfigurado) throw new Error("Cloudinary não configurado no .env");

  // Quais imagens estão em uso e por quem
  const usos = new Map(); // uuid → [{tabela, coluna, chave, valorChave, finalidade}]
  for (const r of REFERENCIAS) {
    const linhas = await prisma.$queryRawUnsafe(
      `SELECT "${r.chave}" AS chave, "${r.coluna}" AS url FROM "${r.tabela}" WHERE "${r.coluna}" LIKE '/api/imagens/%'`
    );
    for (const l of linhas) {
      const uuid = l.url.slice("/api/imagens/".length);
      if (!usos.has(uuid)) usos.set(uuid, []);
      usos.get(uuid).push({ ...r, valorChave: l.chave });
    }
  }
  console.log(`Imagens referenciadas: ${usos.size}`);
  if (!usos.size) return;

  let migradas = 0;
  for (const [uuid, refs] of usos) {
    const img = await prisma.imagem.findUnique({ where: { id_imagem: uuid } });
    if (!img) {
      console.log(`  ! ${uuid}: não existe na tabela imagem (referência quebrada), ignorada`);
      continue;
    }
    const dono = img.id_usuario ?? 0;
    const finalidade = refs[0].finalidade;
    const pasta = `${env.CLOUDINARY_PASTA}/${finalidade.toLowerCase()}/u${dono}`;
    console.log(`  - ${uuid} (${img.mime}, ${img.tamanho} bytes) → ${pasta} | usada em ${refs.map((r) => `${r.tabela}.${r.coluna}`).join(", ")}`);
    if (!executar) continue;

    const enviado = await enviarDoServidor({ dados: Buffer.from(img.dados), mime: img.mime, pasta, tags: [env.CLOUDINARY_PASTA, "migrado"] });
    await prisma.$transaction(async (tx) => {
      await tx.midia.create({
        data: {
          id_usuario: img.id_usuario,
          finalidade,
          tipo: "IMAGEM",
          public_id: enviado.public_id,
          resource_type: "image",
          formato: enviado.format,
          url: enviado.secure_url,
          bytes: enviado.bytes,
          largura: enviado.width || null,
          altura: enviado.height || null,
        },
      });
      for (const r of refs) {
        await tx.$executeRawUnsafe(
          `UPDATE "${r.tabela}" SET "${r.coluna}" = $1 WHERE "${r.chave}" = $2 AND "${r.coluna}" = $3`,
          enviado.secure_url,
          r.valorChave,
          `/api/imagens/${uuid}`
        );
      }
    });
    migradas++;
  }
  console.log(executar ? `Migradas: ${migradas}` : "Simulação concluída: nada foi enviado nem alterado.");
}

main()
  .catch((e) => {
    console.error("✖", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
