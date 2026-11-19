-- Studio Corte — migration ADITIVA: registro de mídia no Cloudinary (fotos, vídeos e modelos 3D).
-- Só cria tipos, uma tabela e índices. Não altera nem remove dados existentes.

-- CreateEnum
CREATE TYPE "FinalidadeMidia" AS ENUM ('AVATAR', 'CAPA', 'REFERENCIA', 'POST', 'PRODUTO', 'SERVICO', 'GALERIA', 'CORTE_3D', 'SALAO', 'EQUIPE');

-- CreateEnum
CREATE TYPE "TipoMidia" AS ENUM ('IMAGEM', 'VIDEO', 'MODELO_3D');

-- CreateTable
CREATE TABLE "midia" (
    "id_midia" SERIAL NOT NULL,
    "id_usuario" INTEGER,
    "finalidade" "FinalidadeMidia" NOT NULL,
    "tipo" "TipoMidia" NOT NULL,
    "public_id" VARCHAR(255) NOT NULL,
    "resource_type" VARCHAR(10) NOT NULL,
    "formato" VARCHAR(10) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "largura" INTEGER,
    "altura" INTEGER,
    "duracao_seg" DECIMAL(8,2),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "midia_pkey" PRIMARY KEY ("id_midia")
);

-- CreateIndex
CREATE UNIQUE INDEX "midia_public_id_key" ON "midia"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "midia_url_key" ON "midia"("url");

-- CreateIndex
CREATE INDEX "midia_id_usuario_finalidade_idx" ON "midia"("id_usuario", "finalidade");

-- AddForeignKey
ALTER TABLE "midia" ADD CONSTRAINT "midia_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Regras que o Prisma não expressa ─────────────
ALTER TABLE "midia"
  ADD CONSTRAINT "midia_resource_type_valido" CHECK ("resource_type" IN ('image', 'video', 'raw')),
  ADD CONSTRAINT "midia_bytes_validos" CHECK ("bytes" > 0 AND "bytes" <= 104857600),
  ADD CONSTRAINT "midia_url_cloudinary" CHECK ("url" LIKE 'https://res.cloudinary.com/%'),
  ADD CONSTRAINT "midia_dimensoes_validas" CHECK (("largura" IS NULL OR "largura" > 0) AND ("altura" IS NULL OR "altura" > 0));
