// Schemas zod das rotas de agenda, loja, perfil e administração.
import { z } from "zod";
import {
  id,
  nome,
  email,
  emailOpcional,
  senha,
  cpf,
  opcional,
  dataNascimento,
  telefone,
  telefoneOpcional,
  whatsappOpcional,
  textoOpcional,
  textoObrigatorio,
  urlImagem,
  urlImagemOpcional,
  urlOpcional,
  usuarioRede,
  dinheiro,
  inteiro,
  dataIso,
  horaTexto,
  instante,
  booleano,
} from "./comum.js";

// ───────── Agenda ─────────

export const horariosQuery = z.object({
  servico: id,
  data: dataIso,
  profissional: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  ignorar: z.preprocess((v) => (v === "" ? undefined : v), id.optional()), // remarcação (só equipe)
});

export const novoAgendamentoSchema = z.object({
  id_servico: id,
  id_barbeiro: z.preprocess((v) => (v === "" || v === 0 ? null : v), id.nullable().optional()),
  inicio: instante,
  observacao: textoOpcional(500, "Observação"),
});

export const agendamentoEquipeSchema = novoAgendamentoSchema.extend({
  id_cliente: id,
  status: z.enum(["PENDENTE", "CONFIRMADO"]).default("CONFIRMADO"),
});

export const statusAgendamentoSchema = z.object({
  status: z.enum(["PENDENTE", "CONFIRMADO", "CONCLUIDO", "CANCELADO", "NAO_COMPARECEU"], { error: "Status inválido." }),
  motivo: textoOpcional(200, "Motivo"),
});

export const remarcarSchema = z.object({ id_servico: id, id_barbeiro: id, inicio: instante });

export const cancelarClienteSchema = z.object({ motivo: textoOpcional(200, "Motivo") });

export const avaliacaoSchema = z.object({
  nota: inteiro(1, 5, "Nota"),
  comentario: textoOpcional(1000, "Comentário"),
});

export const listaAgendamentosQuery = z.object({
  data: z.preprocess((v) => (v === "" ? undefined : v), dataIso.optional()),
  ate: z.preprocess((v) => (v === "" ? undefined : v), dataIso.optional()),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PENDENTE", "CONFIRMADO", "CONCLUIDO", "CANCELADO", "NAO_COMPARECEU"]).optional()),
  profissional: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  busca: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional()),
});

export const bloqueioSchema = z.object({
  id_barbeiro: id,
  inicio: instante,
  fim: instante,
  motivo: textoOpcional(200, "Motivo"),
});

const janelaSchema = z
  .object({ dia_semana: inteiro(0, 6, "Dia da semana"), inicio: horaTexto, fim: horaTexto })
  .transform((j) => {
    const min = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    return { dia_semana: j.dia_semana, inicio: min(j.inicio), fim: min(j.fim) };
  });

// ───────── Loja ─────────

export const itemCarrinhoSchema = z.object({ id_produto: id, quantidade: inteiro(1, 99, "Quantidade").default(1) });
export const quantidadeSchema = z.object({ quantidade: inteiro(1, 99, "Quantidade") });
export const finalizarPedidoSchema = z.object({ observacao: textoOpcional(500, "Observação") });
export const statusPedidoSchema = z.object({
  status: z.enum(["PENDENTE", "PRONTO_PARA_RETIRADA", "CONCLUIDO", "CANCELADO"], { error: "Status inválido." }),
});
export const listaPedidosQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PENDENTE", "PRONTO_PARA_RETIRADA", "CONCLUIDO", "CANCELADO"]).optional()),
  busca: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional()),
});

// ───────── Perfil do usuário logado ─────────

export const perfilSchema = z.object({
  nome_completo: nome,
  telefone: telefoneOpcional,
  data_nascimento: opcional(dataNascimento),
  cpf: opcional(cpf),
  endereco: textoOpcional(200, "Endereço"),
  bio: textoOpcional(300, "Bio"),
  instagram: usuarioRede,
  tiktok: usuarioRede,
  whatsapp: whatsappOpcional,
});

export const imagemPerfilSchema = z.object({ url: urlImagemOpcional });

export const trocarSenhaSchema = z.object({
  senha_atual: z.string({ error: "Informe a senha atual." }).min(1, "Informe a senha atual.").max(200),
  nova_senha: senha,
});

export const corteEnviadoSchema = z.object({ nome: textoObrigatorio(100, "o nome do corte"), imagem_url: urlImagem });

// ───────── Administração ─────────

export const buscaQuery = z.object({
  busca: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional()),
  inativos: z.preprocess((v) => v === "1" || v === "true", z.boolean()).optional(),
});

export const clienteAdminSchema = z.object({
  nome_completo: nome,
  email: emailOpcional,
  telefone,
  cpf: opcional(cpf),
  data_nascimento: opcional(dataNascimento),
  enviar_convite: booleano.optional().default(false),
});

export const equipeSchema = z.object({
  nome_completo: nome,
  email,
  telefone: telefoneOpcional,
  tipo_perfil: z.enum(["BARBEIRO", "ADMIN"], { error: "Perfil inválido." }),
  avatar_url: urlImagemOpcional,
  servicos: z.array(id).max(100).default([]),
  disponibilidade: z.array(janelaSchema).max(50).default([]),
});

export const servicoSchema = z.object({
  nome_servico: textoObrigatorio(100, "o nome do serviço"),
  descricao: textoOpcional(500, "Descrição"),
  icone: textoOpcional(16, "Ícone"),
  preco: dinheiro,
  preco_a_partir_de: booleano.default(false),
  duracao_minutos: inteiro(5, 480, "Duração"),
  imagem_url: urlImagemOpcional,
  ordem_exibicao: inteiro(0, 9999, "Ordem").default(0),
  ativo: booleano.default(true),
});

export const produtoSchema = z.object({
  nome_produto: textoObrigatorio(120, "o nome do produto"),
  descricao: textoOpcional(500, "Descrição"),
  categoria: textoOpcional(60, "Categoria"),
  preco: dinheiro,
  quantidade_estoque: inteiro(0, 99999, "Estoque"),
  imagem_url: urlImagemOpcional,
  ativo: booleano.default(true),
});

export const corteGaleriaSchema = z.object({
  nome_corte: textoObrigatorio(100, "o nome do corte"),
  imagem_url: urlImagem,
  ordem_exibicao: inteiro(0, 9999, "Ordem").default(0),
  ativo: booleano.default(true),
});

export const visibilidadeSchema = z.object({ visivel: booleano });

export const configSchema = z.object({
  nome_salao: textoObrigatorio(100, "o nome do salão"),
  endereco: textoOpcional(200, "Endereço"),
  telefone: telefoneOpcional,
  whatsapp: whatsappOpcional,
  email_contato: emailOpcional,
  horario_funcionamento_texto: textoOpcional(120, "Horário de funcionamento"),
  url_mapa: urlOpcional,
  instagram_url: urlOpcional,
  tiktok_url: urlOpcional,
  hero_titulo: textoOpcional(160, "Título"),
  hero_subtitulo: textoOpcional(400, "Subtítulo"),
  hero_imagem_url: urlImagemOpcional,
  intervalo_slots_minutos: inteiro(5, 120, "Intervalo entre horários"),
  antecedencia_minima_minutos: inteiro(0, 10080, "Antecedência mínima"),
  antecedencia_cancelamento_hrs: inteiro(0, 168, "Antecedência para cancelar"),
  janela_agendamento_dias: inteiro(1, 365, "Janela de agendamento"),
});
