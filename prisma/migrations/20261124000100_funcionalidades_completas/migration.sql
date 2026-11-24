-- Funcionalidades completas: catálogo/3D, perfis públicos, feed, avaliações por critério, fidelidade,
-- recepção, reservas e auditoria. Somente acrescenta estruturas; nenhum dado existente é apagado ou alterado.

-- CreateEnum
CREATE TYPE "AreaAtendimento" AS ENUM ('BARBEARIA', 'CABELEIREIRO', 'AMBOS');

-- CreateEnum
CREATE TYPE "StatusModeracao" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "AlvoAvaliacao" AS ENUM ('SALAO', 'SERVICO', 'CORTE', 'PRODUTO', 'PROFISSIONAL');

-- CreateEnum
CREATE TYPE "OrigemPontos" AS ENUM ('ATENDIMENTO', 'PEDIDO', 'RESGATE', 'AJUSTE');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "VinculoFuncionario" AS ENUM ('CLT', 'FREELANCE', 'ESTAGIO');

-- CreateEnum
CREATE TYPE "StatusContrato" AS ENUM ('ATIVO', 'ESTAGIO', 'DESLIGADO');

-- CreateEnum
CREATE TYPE "TipoPonto" AS ENUM ('ENTRADA', 'SAIDA');


-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "consentimento_lgpd_em" TIMESTAMPTZ(3),
ADD COLUMN     "consentimento_versao" VARCHAR(20),
ADD COLUMN     "mostrar_bio" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mostrar_email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mostrar_estatisticas" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mostrar_favoritos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mostrar_nascimento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mostrar_telefone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "perfil_publico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usuario" VARCHAR(30),
ADD COLUMN     "visitante" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "servico" ADD COLUMN     "area" "AreaAtendimento" NOT NULL DEFAULT 'BARBEARIA';

-- AlterTable
ALTER TABLE "agendamento" ADD COLUMN     "chegou_em" TIMESTAMPTZ(3),
ADD COLUMN     "falta_automatica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "id_reserva" INTEGER;

-- AlterTable
ALTER TABLE "avaliacao" ADD COLUMN     "id_pedido" INTEGER,
ADD COLUMN     "status_moderacao" "StatusModeracao" NOT NULL DEFAULT 'APROVADO',
ALTER COLUMN "id_agendamento" DROP NOT NULL;

-- AlterTable
ALTER TABLE "corte_galeria" ADD COLUMN     "area" "AreaAtendimento" NOT NULL DEFAULT 'BARBEARIA',
ADD COLUMN     "descricao" VARCHAR(500),
ADD COLUMN     "duracao_ref_minutos" INTEGER,
ADD COLUMN     "id_autor" INTEGER,
ADD COLUMN     "modelo_3d_url" VARCHAR(500),
ADD COLUMN     "preco_ref" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "forma_pagamento" VARCHAR(20),
ADD COLUMN     "id_recompensa" INTEGER,
ADD COLUMN     "id_reserva" INTEGER,
ADD COLUMN     "motivo_cancelamento" VARCHAR(200),
ADD COLUMN     "pontos_usados" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prazo_retirada" TIMESTAMPTZ(3),
ADD COLUMN     "subtotal" DECIMAL(10,2),
ADD COLUMN     "valor_desconto" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "configuracao_salao" ADD COLUMN     "avaliacao_requer_aprovacao" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "aviso_entrega_off" VARCHAR(300),
ADD COLUMN     "aviso_entrega_on" VARCHAR(300),
ADD COLUMN     "entrega_ativa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "falta_automatica" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nivel_ouro" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "nivel_prata" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "pontos_minimos_evento" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "pontos_por_real" DECIMAL(6,2) NOT NULL DEFAULT 0.10,
ADD COLUMN     "prazo_retirada_dias" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "slogan" VARCHAR(160),
ADD COLUMN     "sobre" VARCHAR(600),
ADD COLUMN     "tolerancia_falta_minutos" INTEGER NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "avaliacao_nota" (
    "id_nota" SERIAL NOT NULL,
    "id_avaliacao" INTEGER NOT NULL,
    "alvo" "AlvoAvaliacao" NOT NULL,
    "id_servico" INTEGER,
    "id_corte" INTEGER,
    "id_produto" INTEGER,
    "id_profissional" INTEGER,
    "nota" SMALLINT NOT NULL,

    CONSTRAINT "avaliacao_nota_pkey" PRIMARY KEY ("id_nota")
);

-- CreateTable
CREATE TABLE "agendamento_servico" (
    "id_agendamento" INTEGER NOT NULL,
    "id_servico" INTEGER NOT NULL,
    "preco_registrado" DECIMAL(10,2) NOT NULL,
    "duracao_minutos" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agendamento_servico_pkey" PRIMARY KEY ("id_agendamento","id_servico")
);

-- CreateTable
CREATE TABLE "agendamento_corte" (
    "id_agendamento" INTEGER NOT NULL,
    "id_corte" INTEGER NOT NULL,

    CONSTRAINT "agendamento_corte_pkey" PRIMARY KEY ("id_agendamento","id_corte")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id_reserva" SERIAL NOT NULL,
    "codigo" CHAR(6) NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "visitante" BOOLEAN NOT NULL DEFAULT false,
    "nome" VARCHAR(120) NOT NULL,
    "telefone" VARCHAR(20),
    "email" VARCHAR(160),
    "observacao" VARCHAR(500),
    "status" "StatusReserva" NOT NULL DEFAULT 'ATIVA',
    "motivo" VARCHAR(200),
    "consentimento_lgpd_em" TIMESTAMPTZ(3),
    "consentimento_versao" VARCHAR(20),
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerrada_em" TIMESTAMPTZ(3),

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id_reserva")
);

-- CreateTable
CREATE TABLE "perfil_profissional" (
    "id_usuario" INTEGER NOT NULL,
    "area" "AreaAtendimento" NOT NULL DEFAULT 'BARBEARIA',
    "especialidades" VARCHAR(60)[],
    "anos_experiencia" INTEGER,
    "certificacoes" VARCHAR(400),
    "visivel_no_site" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "perfil_profissional_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "funcionario" (
    "id_usuario" INTEGER NOT NULL,
    "vinculo" "VinculoFuncionario" NOT NULL DEFAULT 'CLT',
    "status_contrato" "StatusContrato" NOT NULL DEFAULT 'ATIVO',
    "data_entrada" DATE,
    "data_saida" DATE,
    "motivo_saida" VARCHAR(200),
    "cpf_cifrado" VARCHAR(300),
    "rg_cifrado" VARCHAR(300),
    "ctps_cifrado" VARCHAR(300),
    "pis_cifrado" VARCHAR(300),
    "cnh_cifrado" VARCHAR(300),
    "emergencia_cifrado" VARCHAR(500),
    "endereco" VARCHAR(200),
    "cidade" VARCHAR(100),
    "uf" CHAR(2),
    "cep" VARCHAR(9),
    "observacoes" VARCHAR(1000),

    CONSTRAINT "funcionario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "registro_ponto" (
    "id_ponto" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "tipo" "TipoPonto" NOT NULL,
    "em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" VARCHAR(200),
    "id_autor" INTEGER,

    CONSTRAINT "registro_ponto_pkey" PRIMARY KEY ("id_ponto")
);

-- CreateTable
CREATE TABLE "rede_social_usuario" (
    "id_rede" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "rede" VARCHAR(20) NOT NULL,
    "rotulo" VARCHAR(60) NOT NULL,
    "url" VARCHAR(300) NOT NULL,
    "publico" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rede_social_usuario_pkey" PRIMARY KEY ("id_rede")
);

-- CreateTable
CREATE TABLE "favorito_servico" (
    "id_cliente" INTEGER NOT NULL,
    "id_servico" INTEGER NOT NULL,
    "data_favorito" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorito_servico_pkey" PRIMARY KEY ("id_cliente","id_servico")
);

-- CreateTable
CREATE TABLE "favorito_produto" (
    "id_cliente" INTEGER NOT NULL,
    "id_produto" INTEGER NOT NULL,
    "data_favorito" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorito_produto_pkey" PRIMARY KEY ("id_cliente","id_produto")
);

-- CreateTable
CREATE TABLE "troca_email" (
    "id_troca" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "novo_email" VARCHAR(160) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "usado_em" TIMESTAMPTZ(3),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "troca_email_pkey" PRIMARY KEY ("id_troca")
);

-- CreateTable
CREATE TABLE "post" (
    "id_post" SERIAL NOT NULL,
    "id_autor" INTEGER NOT NULL,
    "texto" VARCHAR(1000) NOT NULL,
    "status_moderacao" "StatusModeracao" NOT NULL DEFAULT 'PENDENTE',
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_pkey" PRIMARY KEY ("id_post")
);

-- CreateTable
CREATE TABLE "post_midia" (
    "id_post" INTEGER NOT NULL,
    "id_midia" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_midia_pkey" PRIMARY KEY ("id_post","id_midia")
);

-- CreateTable
CREATE TABLE "post_curtida" (
    "id_post" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "data" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_curtida_pkey" PRIMARY KEY ("id_post","id_usuario")
);

-- CreateTable
CREATE TABLE "post_comentario" (
    "id_comentario" SERIAL NOT NULL,
    "id_post" INTEGER NOT NULL,
    "id_autor" INTEGER NOT NULL,
    "texto" VARCHAR(500) NOT NULL,
    "status_moderacao" "StatusModeracao" NOT NULL DEFAULT 'PENDENTE',
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comentario_pkey" PRIMARY KEY ("id_comentario")
);

-- CreateTable
CREATE TABLE "denuncia" (
    "id_denuncia" SERIAL NOT NULL,
    "id_autor" INTEGER NOT NULL,
    "id_post" INTEGER,
    "id_comentario" INTEGER,
    "motivo" VARCHAR(300) NOT NULL,
    "resolvida_em" TIMESTAMPTZ(3),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denuncia_pkey" PRIMARY KEY ("id_denuncia")
);

-- CreateTable
CREATE TABLE "recompensa" (
    "id_recompensa" SERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "pontos_minimos" INTEGER NOT NULL,
    "desconto_percentual" INTEGER NOT NULL,
    "consome_pontos" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recompensa_pkey" PRIMARY KEY ("id_recompensa")
);

-- CreateTable
CREATE TABLE "movimento_pontos" (
    "id_movimento" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "pontos" INTEGER NOT NULL,
    "origem" "OrigemPontos" NOT NULL,
    "id_origem" INTEGER,
    "motivo" VARCHAR(160) NOT NULL,
    "id_autor" INTEGER,
    "data" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimento_pontos_pkey" PRIMARY KEY ("id_movimento")
);

-- CreateTable
CREATE TABLE "contato_oficial" (
    "id_contato" SERIAL NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "rotulo" VARCHAR(60) NOT NULL,
    "valor" VARCHAR(120) NOT NULL,
    "url" VARCHAR(300) NOT NULL,
    "publico" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contato_oficial_pkey" PRIMARY KEY ("id_contato")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id_log" SERIAL NOT NULL,
    "id_autor" INTEGER,
    "acao" VARCHAR(60) NOT NULL,
    "entidade" VARCHAR(40),
    "id_entidade" INTEGER,
    "detalhes" JSONB,
    "data" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id_log")
);

-- CreateIndex
CREATE INDEX "avaliacao_nota_id_avaliacao_idx" ON "avaliacao_nota"("id_avaliacao");

-- CreateIndex
CREATE INDEX "avaliacao_nota_alvo_idx" ON "avaliacao_nota"("alvo");

-- CreateIndex
CREATE INDEX "avaliacao_nota_id_profissional_idx" ON "avaliacao_nota"("id_profissional");

-- CreateIndex
CREATE INDEX "agendamento_servico_id_servico_idx" ON "agendamento_servico"("id_servico");

-- CreateIndex
CREATE INDEX "agendamento_corte_id_corte_idx" ON "agendamento_corte"("id_corte");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_codigo_key" ON "reserva"("codigo");

-- CreateIndex
CREATE INDEX "reserva_id_cliente_idx" ON "reserva"("id_cliente");

-- CreateIndex
CREATE INDEX "reserva_status_criada_em_idx" ON "reserva"("status", "criada_em");

-- CreateIndex
CREATE INDEX "reserva_telefone_idx" ON "reserva"("telefone");

-- CreateIndex
CREATE INDEX "registro_ponto_id_usuario_em_idx" ON "registro_ponto"("id_usuario", "em");

-- CreateIndex
CREATE UNIQUE INDEX "rede_social_usuario_id_usuario_url_key" ON "rede_social_usuario"("id_usuario", "url");

-- CreateIndex
CREATE INDEX "favorito_servico_id_servico_idx" ON "favorito_servico"("id_servico");

-- CreateIndex
CREATE INDEX "favorito_produto_id_produto_idx" ON "favorito_produto"("id_produto");

-- CreateIndex
CREATE UNIQUE INDEX "troca_email_token_hash_key" ON "troca_email"("token_hash");

-- CreateIndex
CREATE INDEX "troca_email_id_usuario_idx" ON "troca_email"("id_usuario");

-- CreateIndex
CREATE INDEX "post_status_moderacao_data_criacao_idx" ON "post"("status_moderacao", "data_criacao");

-- CreateIndex
CREATE INDEX "post_id_autor_idx" ON "post"("id_autor");

-- CreateIndex
CREATE UNIQUE INDEX "post_midia_id_midia_key" ON "post_midia"("id_midia");

-- CreateIndex
CREATE INDEX "post_curtida_id_usuario_idx" ON "post_curtida"("id_usuario");

-- CreateIndex
CREATE INDEX "post_comentario_id_post_data_criacao_idx" ON "post_comentario"("id_post", "data_criacao");

-- CreateIndex
CREATE INDEX "post_comentario_id_autor_idx" ON "post_comentario"("id_autor");

-- CreateIndex
CREATE INDEX "denuncia_resolvida_em_idx" ON "denuncia"("resolvida_em");

-- CreateIndex
CREATE UNIQUE INDEX "denuncia_id_autor_id_post_key" ON "denuncia"("id_autor", "id_post");

-- CreateIndex
CREATE UNIQUE INDEX "denuncia_id_autor_id_comentario_key" ON "denuncia"("id_autor", "id_comentario");

-- CreateIndex
CREATE INDEX "movimento_pontos_id_usuario_data_idx" ON "movimento_pontos"("id_usuario", "data");

-- CreateIndex
CREATE INDEX "movimento_pontos_origem_id_origem_idx" ON "movimento_pontos"("origem", "id_origem");

-- CreateIndex
CREATE INDEX "contato_oficial_publico_ordem_idx" ON "contato_oficial"("publico", "ordem");

-- CreateIndex
CREATE INDEX "log_auditoria_data_idx" ON "log_auditoria"("data");

-- CreateIndex
CREATE INDEX "log_auditoria_acao_idx" ON "log_auditoria"("acao");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_usuario_key" ON "usuario"("usuario");

-- CreateIndex
CREATE INDEX "agendamento_id_reserva_idx" ON "agendamento"("id_reserva");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacao_id_pedido_key" ON "avaliacao"("id_pedido");

-- CreateIndex
CREATE INDEX "avaliacao_status_moderacao_idx" ON "avaliacao"("status_moderacao");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_id_reserva_key" ON "pedido"("id_reserva");

-- AddForeignKey
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_id_reserva_fkey" FOREIGN KEY ("id_reserva") REFERENCES "reserva"("id_reserva") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_nota" ADD CONSTRAINT "avaliacao_nota_id_avaliacao_fkey" FOREIGN KEY ("id_avaliacao") REFERENCES "avaliacao"("id_avaliacao") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_nota" ADD CONSTRAINT "avaliacao_nota_id_servico_fkey" FOREIGN KEY ("id_servico") REFERENCES "servico"("id_servico") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_nota" ADD CONSTRAINT "avaliacao_nota_id_corte_fkey" FOREIGN KEY ("id_corte") REFERENCES "corte_galeria"("id_corte") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_nota" ADD CONSTRAINT "avaliacao_nota_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao_nota" ADD CONSTRAINT "avaliacao_nota_id_profissional_fkey" FOREIGN KEY ("id_profissional") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento_servico" ADD CONSTRAINT "agendamento_servico_id_agendamento_fkey" FOREIGN KEY ("id_agendamento") REFERENCES "agendamento"("id_agendamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento_servico" ADD CONSTRAINT "agendamento_servico_id_servico_fkey" FOREIGN KEY ("id_servico") REFERENCES "servico"("id_servico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento_corte" ADD CONSTRAINT "agendamento_corte_id_agendamento_fkey" FOREIGN KEY ("id_agendamento") REFERENCES "agendamento"("id_agendamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento_corte" ADD CONSTRAINT "agendamento_corte_id_corte_fkey" FOREIGN KEY ("id_corte") REFERENCES "corte_galeria"("id_corte") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corte_galeria" ADD CONSTRAINT "corte_galeria_id_autor_fkey" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_recompensa_fkey" FOREIGN KEY ("id_recompensa") REFERENCES "recompensa"("id_recompensa") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_reserva_fkey" FOREIGN KEY ("id_reserva") REFERENCES "reserva"("id_reserva") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_profissional" ADD CONSTRAINT "perfil_profissional_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionario" ADD CONSTRAINT "funcionario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_ponto" ADD CONSTRAINT "registro_ponto_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rede_social_usuario" ADD CONSTRAINT "rede_social_usuario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito_servico" ADD CONSTRAINT "favorito_servico_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito_servico" ADD CONSTRAINT "favorito_servico_id_servico_fkey" FOREIGN KEY ("id_servico") REFERENCES "servico"("id_servico") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito_produto" ADD CONSTRAINT "favorito_produto_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito_produto" ADD CONSTRAINT "favorito_produto_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troca_email" ADD CONSTRAINT "troca_email_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_id_autor_fkey" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_midia" ADD CONSTRAINT "post_midia_id_post_fkey" FOREIGN KEY ("id_post") REFERENCES "post"("id_post") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_midia" ADD CONSTRAINT "post_midia_id_midia_fkey" FOREIGN KEY ("id_midia") REFERENCES "midia"("id_midia") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_curtida" ADD CONSTRAINT "post_curtida_id_post_fkey" FOREIGN KEY ("id_post") REFERENCES "post"("id_post") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_curtida" ADD CONSTRAINT "post_curtida_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comentario" ADD CONSTRAINT "post_comentario_id_post_fkey" FOREIGN KEY ("id_post") REFERENCES "post"("id_post") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comentario" ADD CONSTRAINT "post_comentario_id_autor_fkey" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncia" ADD CONSTRAINT "denuncia_id_autor_fkey" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncia" ADD CONSTRAINT "denuncia_id_post_fkey" FOREIGN KEY ("id_post") REFERENCES "post"("id_post") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncia" ADD CONSTRAINT "denuncia_id_comentario_fkey" FOREIGN KEY ("id_comentario") REFERENCES "post_comentario"("id_comentario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_pontos" ADD CONSTRAINT "movimento_pontos_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_id_autor_fkey" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────── Regras de integridade ─────────

ALTER TABLE "usuario"
  ADD CONSTRAINT "usuario_login_formato" CHECK ("usuario" ~ '^[a-z0-9][a-z0-9._]{2,29}$'),
  ADD CONSTRAINT "usuario_visitante_coerente" CHECK (NOT "visitante" OR ("senha_hash" IS NULL AND "tipo_perfil" = 'CLIENTE'));

ALTER TABLE "avaliacao"
  ADD CONSTRAINT "avaliacao_origem_unica" CHECK (num_nonnulls("id_agendamento", "id_pedido") = 1);

ALTER TABLE "avaliacao_nota"
  ADD CONSTRAINT "avaliacao_nota_faixa" CHECK ("nota" BETWEEN 1 AND 5),
  ADD CONSTRAINT "avaliacao_nota_alvo" CHECK (
    ("alvo" = 'SALAO' AND num_nonnulls("id_servico", "id_corte", "id_produto", "id_profissional") = 0)
    OR (num_nonnulls("id_servico", "id_corte", "id_produto", "id_profissional") = 1 AND (
      ("alvo" = 'SERVICO' AND "id_servico" IS NOT NULL)
      OR ("alvo" = 'CORTE' AND "id_corte" IS NOT NULL)
      OR ("alvo" = 'PRODUTO' AND "id_produto" IS NOT NULL)
      OR ("alvo" = 'PROFISSIONAL' AND "id_profissional" IS NOT NULL))));
CREATE UNIQUE INDEX "avaliacao_nota_alvo_unico" ON "avaliacao_nota"
  ("id_avaliacao", "alvo", COALESCE("id_servico", "id_corte", "id_produto", "id_profissional", 0));

ALTER TABLE "agendamento_servico"
  ADD CONSTRAINT "agendamento_servico_valores" CHECK ("preco_registrado" >= 0 AND "duracao_minutos" BETWEEN 5 AND 480);

ALTER TABLE "corte_galeria"
  ADD CONSTRAINT "corte_duracao_ref_valida" CHECK ("duracao_ref_minutos" BETWEEN 5 AND 480),
  ADD CONSTRAINT "corte_preco_ref_valido" CHECK ("preco_ref" >= 0),
  ADD CONSTRAINT "corte_modelo_3d_origem" CHECK ("modelo_3d_url" LIKE 'https://res.cloudinary.com/%' OR "modelo_3d_url" LIKE 'https://sketchfab.com/models/%');

ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_desconto_valido" CHECK ("valor_desconto" >= 0 AND ("subtotal" IS NULL OR "valor_desconto" <= "subtotal")),
  ADD CONSTRAINT "pedido_pontos_validos" CHECK ("pontos_usados" >= 0);

ALTER TABLE "reserva"
  ADD CONSTRAINT "reserva_codigo_formato" CHECK ("codigo" ~ '^[A-HJ-NP-Z2-9]{6}$'),
  ADD CONSTRAINT "reserva_email_minusculo" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "reserva_encerramento_coerente" CHECK (("status" = 'ATIVA') = ("encerrada_em" IS NULL));

ALTER TABLE "recompensa"
  ADD CONSTRAINT "recompensa_valida" CHECK ("pontos_minimos" > 0 AND "desconto_percentual" BETWEEN 1 AND 90);

ALTER TABLE "movimento_pontos"
  ADD CONSTRAINT "movimento_pontos_valido" CHECK ("pontos" <> 0);

ALTER TABLE "denuncia"
  ADD CONSTRAINT "denuncia_alvo_unico" CHECK (num_nonnulls("id_post", "id_comentario") = 1);

ALTER TABLE "rede_social_usuario"
  ADD CONSTRAINT "rede_social_url_segura" CHECK ("url" ~ '^(https://|mailto:|tel:)');
ALTER TABLE "contato_oficial"
  ADD CONSTRAINT "contato_url_segura" CHECK ("url" ~ '^(https://|mailto:|tel:)');

ALTER TABLE "perfil_profissional"
  ADD CONSTRAINT "perfil_profissional_experiencia" CHECK ("anos_experiencia" BETWEEN 0 AND 80);

ALTER TABLE "funcionario"
  ADD CONSTRAINT "funcionario_datas" CHECK ("data_saida" IS NULL OR "data_entrada" IS NULL OR "data_saida" >= "data_entrada");

ALTER TABLE "configuracao_salao"
  ADD CONSTRAINT "configuracao_prazos_validos" CHECK ("prazo_retirada_dias" BETWEEN 1 AND 60 AND "tolerancia_falta_minutos" BETWEEN 5 AND 240),
  ADD CONSTRAINT "configuracao_pontos_validos" CHECK ("pontos_por_real" >= 0 AND "pontos_minimos_evento" >= 0 AND "nivel_prata" > 0 AND "nivel_ouro" > "nivel_prata");

-- ───────── Dados iniciais e preenchimento (nada existente é alterado) ─────────

-- O serviço de cada agendamento já existente passa a constar também na lista de serviços.
INSERT INTO "agendamento_servico" ("id_agendamento", "id_servico", "preco_registrado", "duracao_minutos", "ordem")
SELECT a."id_agendamento", a."id_servico", a."preco_registrado",
       LEAST(480, GREATEST(5, round(extract(epoch FROM (a."data_hora_fim" - a."data_hora_inicio")) / 60)))::int, 0
FROM "agendamento" a;

-- Redes já informadas no perfil (as colunas originais continuam intactas).
INSERT INTO "rede_social_usuario" ("id_usuario", "rede", "rotulo", "url", "publico", "ordem")
SELECT "id_usuario", 'instagram', 'Instagram', 'https://instagram.com/' || "instagram", true, 0 FROM "usuario" WHERE "instagram" ~ '^[A-Za-z0-9._]+$'
UNION ALL
SELECT "id_usuario", 'tiktok', 'TikTok', 'https://www.tiktok.com/@' || "tiktok", true, 1 FROM "usuario" WHERE "tiktok" ~ '^[A-Za-z0-9._]+$'
UNION ALL
SELECT "id_usuario", 'whatsapp', 'WhatsApp', 'https://wa.me/' || "whatsapp", false, 2 FROM "usuario" WHERE "whatsapp" IS NOT NULL;

-- Faixas de desconto da versão do colega, editáveis no painel.
INSERT INTO "recompensa" ("nome", "pontos_minimos", "desconto_percentual", "consome_pontos")
VALUES ('Desconto de 5%', 1000, 5, true), ('Desconto de 10%', 2500, 10, true);
