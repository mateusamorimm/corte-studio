-- Studio Corte — migration ADITIVA: perfil completo, imagens enviadas e clientes de balcão.
-- Não remove nem altera dados existentes: só adiciona colunas opcionais, tabelas novas e regras.

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "bio" VARCHAR(300),
ADD COLUMN     "capa_url" VARCHAR(500),
ADD COLUMN     "endereco" VARCHAR(200),
ADD COLUMN     "instagram" VARCHAR(60),
ADD COLUMN     "tiktok" VARCHAR(60),
ADD COLUMN     "whatsapp" VARCHAR(20),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "corte_enviado" (
    "id_corte_enviado" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "imagem_url" VARCHAR(500) NOT NULL,
    "data_envio" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corte_enviado_pkey" PRIMARY KEY ("id_corte_enviado")
);

-- CreateTable
CREATE TABLE "imagem" (
    "id_imagem" UUID NOT NULL,
    "id_usuario" INTEGER,
    "mime" VARCHAR(20) NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "dados" BYTEA NOT NULL,
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagem_pkey" PRIMARY KEY ("id_imagem")
);

-- CreateIndex
CREATE INDEX "corte_enviado_id_cliente_data_envio_idx" ON "corte_enviado"("id_cliente", "data_envio");

-- CreateIndex
CREATE INDEX "imagem_id_usuario_idx" ON "imagem"("id_usuario");

-- AddForeignKey
ALTER TABLE "corte_enviado" ADD CONSTRAINT "corte_enviado_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagem" ADD CONSTRAINT "imagem_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Regras que o Prisma não expressa ─────────────

-- Só clientes de balcão podem ficar sem e-mail; equipe sempre tem acesso por e-mail.
ALTER TABLE "usuario"
  ADD CONSTRAINT "usuario_email_obrigatorio_equipe" CHECK ("tipo_perfil" = 'CLIENTE' OR "email" IS NOT NULL),
  ADD CONSTRAINT "usuario_whatsapp_formato" CHECK ("whatsapp" ~ '^[0-9]{10,13}$');

ALTER TABLE "imagem"
  ADD CONSTRAINT "imagem_mime_permitido" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "imagem_tamanho_valido" CHECK ("tamanho" BETWEEN 1 AND 3145728 AND octet_length("dados") = "tamanho");
