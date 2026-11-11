-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TipoPerfil" AS ENUM ('CLIENTE', 'BARBEIRO', 'ADMIN');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('PENDENTE', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('PENDENTE', 'PRONTO_PARA_RETIRADA', 'CONCLUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "usuario" (
    "id_usuario" SERIAL NOT NULL,
    "nome_completo" VARCHAR(120) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "cpf" CHAR(11),
    "telefone" VARCHAR(20),
    "data_nascimento" DATE,
    "senha_hash" VARCHAR(255),
    "tipo_perfil" "TipoPerfil" NOT NULL DEFAULT 'CLIENTE',
    "avatar_url" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_cadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "token_redefinicao_senha" (
    "id_token" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "usado_em" TIMESTAMPTZ(3),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_redefinicao_senha_pkey" PRIMARY KEY ("id_token")
);

-- CreateTable
CREATE TABLE "servico" (
    "id_servico" SERIAL NOT NULL,
    "nome_servico" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(500),
    "icone" VARCHAR(16),
    "preco" DECIMAL(10,2) NOT NULL,
    "preco_a_partir_de" BOOLEAN NOT NULL DEFAULT false,
    "duracao_minutos" INTEGER NOT NULL,
    "imagem_url" VARCHAR(500),
    "ordem_exibicao" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_cadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "servico_pkey" PRIMARY KEY ("id_servico")
);

-- CreateTable
CREATE TABLE "barbeiro_servico" (
    "id_barbeiro" INTEGER NOT NULL,
    "id_servico" INTEGER NOT NULL,

    CONSTRAINT "barbeiro_servico_pkey" PRIMARY KEY ("id_barbeiro","id_servico")
);

-- CreateTable
CREATE TABLE "disponibilidade_barbeiro" (
    "id_disponibilidade" SERIAL NOT NULL,
    "id_barbeiro" INTEGER NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fim" TIME(0) NOT NULL,

    CONSTRAINT "disponibilidade_barbeiro_pkey" PRIMARY KEY ("id_disponibilidade")
);

-- CreateTable
CREATE TABLE "bloqueio_agenda" (
    "id_bloqueio" SERIAL NOT NULL,
    "id_barbeiro" INTEGER NOT NULL,
    "data_hora_inicio" TIMESTAMPTZ(3) NOT NULL,
    "data_hora_fim" TIMESTAMPTZ(3) NOT NULL,
    "motivo" VARCHAR(200),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueio_agenda_pkey" PRIMARY KEY ("id_bloqueio")
);

-- CreateTable
CREATE TABLE "agendamento" (
    "id_agendamento" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_barbeiro" INTEGER NOT NULL,
    "id_servico" INTEGER NOT NULL,
    "data_hora_inicio" TIMESTAMPTZ(3) NOT NULL,
    "data_hora_fim" TIMESTAMPTZ(3) NOT NULL,
    "preco_registrado" DECIMAL(10,2) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'PENDENTE',
    "observacao_cliente" VARCHAR(500),
    "cancelado_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(200),
    "data_criacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agendamento_pkey" PRIMARY KEY ("id_agendamento")
);

-- CreateTable
CREATE TABLE "avaliacao" (
    "id_avaliacao" SERIAL NOT NULL,
    "id_agendamento" INTEGER NOT NULL,
    "nota" SMALLINT NOT NULL,
    "comentario" VARCHAR(1000),
    "visivel" BOOLEAN NOT NULL DEFAULT true,
    "data_avaliacao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacao_pkey" PRIMARY KEY ("id_avaliacao")
);

-- CreateTable
CREATE TABLE "corte_galeria" (
    "id_corte" SERIAL NOT NULL,
    "nome_corte" VARCHAR(100) NOT NULL,
    "imagem_url" VARCHAR(500) NOT NULL,
    "ordem_exibicao" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_cadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corte_galeria_pkey" PRIMARY KEY ("id_corte")
);

-- CreateTable
CREATE TABLE "favorito" (
    "id_favorito" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_corte" INTEGER NOT NULL,
    "data_favorito" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorito_pkey" PRIMARY KEY ("id_favorito")
);

-- CreateTable
CREATE TABLE "produto" (
    "id_produto" SERIAL NOT NULL,
    "nome_produto" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "categoria" VARCHAR(60),
    "preco" DECIMAL(10,2) NOT NULL,
    "quantidade_estoque" INTEGER NOT NULL DEFAULT 0,
    "imagem_url" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_cadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id_produto")
);

-- CreateTable
CREATE TABLE "item_carrinho" (
    "id_item_carrinho" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_produto" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "data_adicao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_carrinho_pkey" PRIMARY KEY ("id_item_carrinho")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id_pedido" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'PENDENTE',
    "observacao" VARCHAR(500),
    "cancelado_em" TIMESTAMPTZ(3),
    "data_pedido" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id_pedido")
);

-- CreateTable
CREATE TABLE "item_pedido" (
    "id_item" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_produto" INTEGER NOT NULL,
    "nome_produto_registrado" VARCHAR(120) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "item_pedido_pkey" PRIMARY KEY ("id_item")
);

-- CreateTable
CREATE TABLE "configuracao_salao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nome_salao" VARCHAR(100) NOT NULL DEFAULT 'Studio Corte',
    "endereco" VARCHAR(200),
    "telefone" VARCHAR(20),
    "whatsapp" VARCHAR(20),
    "email_contato" VARCHAR(160),
    "horario_funcionamento_texto" VARCHAR(120),
    "url_mapa" VARCHAR(500),
    "instagram_url" VARCHAR(300),
    "tiktok_url" VARCHAR(300),
    "hero_titulo" VARCHAR(160),
    "hero_subtitulo" VARCHAR(400),
    "hero_imagem_url" VARCHAR(500),
    "fuso_horario" VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo',
    "intervalo_slots_minutos" INTEGER NOT NULL DEFAULT 15,
    "antecedencia_minima_minutos" INTEGER NOT NULL DEFAULT 60,
    "antecedencia_cancelamento_hrs" INTEGER NOT NULL DEFAULT 2,
    "janela_agendamento_dias" INTEGER NOT NULL DEFAULT 30,
    "data_atualizacao" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "configuracao_salao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cpf_key" ON "usuario"("cpf");

-- CreateIndex
CREATE INDEX "usuario_tipo_perfil_ativo_idx" ON "usuario"("tipo_perfil", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "token_redefinicao_senha_token_hash_key" ON "token_redefinicao_senha"("token_hash");

-- CreateIndex
CREATE INDEX "token_redefinicao_senha_id_usuario_idx" ON "token_redefinicao_senha"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "servico_nome_servico_key" ON "servico"("nome_servico");

-- CreateIndex
CREATE INDEX "servico_ativo_ordem_exibicao_idx" ON "servico"("ativo", "ordem_exibicao");

-- CreateIndex
CREATE INDEX "barbeiro_servico_id_servico_idx" ON "barbeiro_servico"("id_servico");

-- CreateIndex
CREATE INDEX "disponibilidade_barbeiro_id_barbeiro_dia_semana_idx" ON "disponibilidade_barbeiro"("id_barbeiro", "dia_semana");

-- CreateIndex
CREATE INDEX "bloqueio_agenda_id_barbeiro_data_hora_inicio_idx" ON "bloqueio_agenda"("id_barbeiro", "data_hora_inicio");

-- CreateIndex
CREATE INDEX "agendamento_id_barbeiro_data_hora_inicio_idx" ON "agendamento"("id_barbeiro", "data_hora_inicio");

-- CreateIndex
CREATE INDEX "agendamento_id_cliente_data_hora_inicio_idx" ON "agendamento"("id_cliente", "data_hora_inicio");

-- CreateIndex
CREATE INDEX "agendamento_status_data_hora_inicio_idx" ON "agendamento"("status", "data_hora_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacao_id_agendamento_key" ON "avaliacao"("id_agendamento");

-- CreateIndex
CREATE INDEX "avaliacao_visivel_data_avaliacao_idx" ON "avaliacao"("visivel", "data_avaliacao");

-- CreateIndex
CREATE INDEX "corte_galeria_ativo_ordem_exibicao_idx" ON "corte_galeria"("ativo", "ordem_exibicao");

-- CreateIndex
CREATE INDEX "favorito_id_corte_idx" ON "favorito"("id_corte");

-- CreateIndex
CREATE UNIQUE INDEX "favorito_id_cliente_id_corte_key" ON "favorito"("id_cliente", "id_corte");

-- CreateIndex
CREATE INDEX "produto_ativo_categoria_idx" ON "produto"("ativo", "categoria");

-- CreateIndex
CREATE UNIQUE INDEX "item_carrinho_id_cliente_id_produto_key" ON "item_carrinho"("id_cliente", "id_produto");

-- CreateIndex
CREATE INDEX "pedido_id_cliente_data_pedido_idx" ON "pedido"("id_cliente", "data_pedido");

-- CreateIndex
CREATE INDEX "pedido_status_data_pedido_idx" ON "pedido"("status", "data_pedido");

-- CreateIndex
CREATE INDEX "item_pedido_id_produto_idx" ON "item_pedido"("id_produto");

-- CreateIndex
CREATE UNIQUE INDEX "item_pedido_id_pedido_id_produto_key" ON "item_pedido"("id_pedido", "id_produto");

-- AddForeignKey
ALTER TABLE "token_redefinicao_senha" ADD CONSTRAINT "token_redefinicao_senha_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbeiro_servico" ADD CONSTRAINT "barbeiro_servico_id_barbeiro_fkey" FOREIGN KEY ("id_barbeiro") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbeiro_servico" ADD CONSTRAINT "barbeiro_servico_id_servico_fkey" FOREIGN KEY ("id_servico") REFERENCES "servico"("id_servico") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidade_barbeiro" ADD CONSTRAINT "disponibilidade_barbeiro_id_barbeiro_fkey" FOREIGN KEY ("id_barbeiro") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueio_agenda" ADD CONSTRAINT "bloqueio_agenda_id_barbeiro_fkey" FOREIGN KEY ("id_barbeiro") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_id_barbeiro_fkey" FOREIGN KEY ("id_barbeiro") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_id_servico_fkey" FOREIGN KEY ("id_servico") REFERENCES "servico"("id_servico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_id_agendamento_fkey" FOREIGN KEY ("id_agendamento") REFERENCES "agendamento"("id_agendamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito" ADD CONSTRAINT "favorito_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorito" ADD CONSTRAINT "favorito_id_corte_fkey" FOREIGN KEY ("id_corte") REFERENCES "corte_galeria"("id_corte") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrinho" ADD CONSTRAINT "item_carrinho_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrinho" ADD CONSTRAINT "item_carrinho_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════
-- Restrições adicionais (não expressáveis no schema.prisma)
-- ═════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Agenda: um barbeiro nunca tem dois agendamentos ativos sobrepostos.
-- Última barreira contra condições de corrida (a aplicação também serializa
-- as escritas por barbeiro com pg_advisory_xact_lock).
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_sem_conflito"
  EXCLUDE USING gist (
    "id_barbeiro" WITH =,
    tstzrange("data_hora_inicio", "data_hora_fim", '[)') WITH &&
  ) WHERE ("status" IN ('PENDENTE', 'CONFIRMADO', 'CONCLUIDO'));

-- Bloqueios do mesmo barbeiro não se sobrepõem.
ALTER TABLE "bloqueio_agenda" ADD CONSTRAINT "bloqueio_sem_sobreposicao"
  EXCLUDE USING gist (
    "id_barbeiro" WITH =,
    tstzrange("data_hora_inicio", "data_hora_fim", '[)') WITH &&
  );

ALTER TABLE "agendamento"
  ADD CONSTRAINT "agendamento_intervalo_valido" CHECK ("data_hora_fim" > "data_hora_inicio"),
  ADD CONSTRAINT "agendamento_preco_nao_negativo" CHECK ("preco_registrado" >= 0),
  ADD CONSTRAINT "agendamento_cancelamento_coerente"
    CHECK (("status" = 'CANCELADO') = ("cancelado_em" IS NOT NULL));

ALTER TABLE "bloqueio_agenda"
  ADD CONSTRAINT "bloqueio_intervalo_valido" CHECK ("data_hora_fim" > "data_hora_inicio");

ALTER TABLE "disponibilidade_barbeiro"
  ADD CONSTRAINT "disponibilidade_dia_valido" CHECK ("dia_semana" BETWEEN 0 AND 6),
  ADD CONSTRAINT "disponibilidade_intervalo_valido" CHECK ("hora_fim" > "hora_inicio");

ALTER TABLE "servico"
  ADD CONSTRAINT "servico_preco_nao_negativo" CHECK ("preco" >= 0),
  ADD CONSTRAINT "servico_duracao_valida" CHECK ("duracao_minutos" BETWEEN 5 AND 480);

ALTER TABLE "produto"
  ADD CONSTRAINT "produto_preco_nao_negativo" CHECK ("preco" >= 0),
  ADD CONSTRAINT "produto_estoque_nao_negativo" CHECK ("quantidade_estoque" >= 0);

ALTER TABLE "item_carrinho"
  ADD CONSTRAINT "item_carrinho_quantidade_valida" CHECK ("quantidade" BETWEEN 1 AND 99);

ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_total_nao_negativo" CHECK ("valor_total" >= 0),
  ADD CONSTRAINT "pedido_cancelamento_coerente"
    CHECK (("status" = 'CANCELADO') = ("cancelado_em" IS NOT NULL));

ALTER TABLE "item_pedido"
  ADD CONSTRAINT "item_pedido_quantidade_positiva" CHECK ("quantidade" > 0),
  ADD CONSTRAINT "item_pedido_preco_nao_negativo" CHECK ("preco_unitario" >= 0);

ALTER TABLE "avaliacao"
  ADD CONSTRAINT "avaliacao_nota_valida" CHECK ("nota" BETWEEN 1 AND 5);

ALTER TABLE "usuario"
  ADD CONSTRAINT "usuario_email_minusculo" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "usuario_cpf_formato" CHECK ("cpf" ~ '^[0-9]{11}$');

ALTER TABLE "configuracao_salao"
  ADD CONSTRAINT "configuracao_linha_unica" CHECK ("id" = 1),
  ADD CONSTRAINT "configuracao_intervalo_valido" CHECK ("intervalo_slots_minutos" BETWEEN 5 AND 120),
  ADD CONSTRAINT "configuracao_antecedencias_validas"
    CHECK ("antecedencia_minima_minutos" >= 0 AND "antecedencia_cancelamento_hrs" >= 0),
  ADD CONSTRAINT "configuracao_janela_valida" CHECK ("janela_agendamento_dias" BETWEEN 1 AND 365);
