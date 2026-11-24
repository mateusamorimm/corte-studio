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
  nomeUsuario,
  urlContato,
  area,
  modelo3d,
  opcionalQuery,
} from "./comum.js";

// ───────── Agenda ─────────

// Um serviço (servico=3) ou vários (servicos=3,5)
const listaIds = z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(id).min(1, "Escolha pelo menos um serviço.").max(8));
const pessoas = inteiro(1, 4, "Pessoas").default(1);

export const horariosQuery = z
  .object({
  servico: opcionalQuery(id),
  servicos: opcionalQuery(listaIds),
  pessoas: z.preprocess((v) => (v === "" ? undefined : v), pessoas),
  data: dataIso,
  profissional: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  ignorar: z.preprocess((v) => (v === "" ? undefined : v), id.optional()), // remarcação (só equipe)
  })
  .refine((q) => q.servico || q.servicos, "Escolha pelo menos um serviço.")
  .transform(({ servico, servicos, ...q }) => ({ ...q, servicos: servicos ?? [servico] }));

// id_servico (um) ou servicos (vários) → sempre vira a lista servicos
const exigirServico = (d, ctx) => {
  if (!d.id_servico && !d.servicos?.length) ctx.addIssue({ code: "custom", path: ["servicos"], message: "Escolha pelo menos um serviço." });
};
const unificarServicos = ({ id_servico, servicos, ...d }) => ({ ...d, servicos: servicos?.length ? servicos : [id_servico] });

const agendamentoBase = z.object({
  id_servico: id.optional(),
  servicos: z.array(id).max(8, "No máximo 8 serviços por atendimento.").optional(),
  cortes: z.array(id).max(6, "No máximo 6 cortes de referência.").default([]),
  pessoas,
  id_barbeiro: z.preprocess((v) => (v === "" || v === 0 ? null : v), id.nullable().optional()),
  inicio: instante,
  observacao: textoOpcional(500, "Observação"),
});

export const novoAgendamentoSchema = agendamentoBase.superRefine(exigirServico).transform(unificarServicos);

export const agendamentoEquipeSchema = agendamentoBase
  .extend({ id_cliente: id, status: z.enum(["PENDENTE", "CONFIRMADO"]).default("CONFIRMADO") })
  .superRefine(exigirServico)
  .transform(unificarServicos);

// Reserva de visitante: só o contato mínimo; CPF e endereço, se precisar, no balcão.
export const reservaVisitanteSchema = z.object({
  nome,
  telefone,
  email,
  consentimento: z.literal(true, { error: "Aceite o uso dos seus dados para fazer a reserva." }),
  observacao: textoOpcional(500, "Observação"),
  forma_pagamento: z.enum(["PIX", "CARTAO", "DINHEIRO"]).nullable().optional(),
  agendamento: z
    .object({
      servicos: z.array(id).min(1, "Escolha pelo menos um serviço.").max(8),
      cortes: z.array(id).max(6).default([]),
      id_barbeiro: z.preprocess((v) => (v === "" || v === 0 ? null : v), id.nullable().optional()),
      inicio: instante,
      pessoas,
    })
    .nullable()
    .optional(),
  itens: z.array(z.object({ id_produto: id, quantidade: inteiro(1, 20, "Quantidade") })).max(20).default([]),
  data_retirada: z.preprocess((v) => (v === "" ? null : v), dataIso.nullable().optional()),
});

const codigoReserva = z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.string({ error: "Informe o código." }).regex(/^[A-Z0-9]{6}$/, "O código tem 6 letras e números."));
export const consultaReservaSchema = z.object({ codigo: codigoReserva, telefone });

export const listaReservasQuery = z.object({
  busca: opcionalQuery(z.string().trim().max(100)),
  status: opcionalQuery(z.enum(["ATIVA", "CONCLUIDA", "CANCELADA", "EXPIRADA"])),
  visitante: opcionalQuery(booleano),
});

export const cadastroVisitanteSchema = z.object({
  nome_completo: nome,
  telefone,
  email: emailOpcional,
  cpf: opcional(cpf),
  endereco: textoOpcional(200, "Endereço"),
  data_nascimento: opcional(dataNascimento),
  vincular: booleano.default(false),
  concluir: booleano.default(false),
});

export const statusAgendamentoSchema = z.object({
  status: z.enum(["PENDENTE", "CONFIRMADO", "CONCLUIDO", "CANCELADO", "NAO_COMPARECEU"], { error: "Status inválido." }),
  motivo: textoOpcional(200, "Motivo"),
});

export const remarcarSchema = z.object({ id_servico: id.optional(), servicos: z.array(id).max(8).optional(), id_barbeiro: id, inicio: instante });

export const cancelarClienteSchema = z.object({ motivo: textoOpcional(200, "Motivo") });

export const avaliacaoSchema = z.object({
  nota: inteiro(1, 5, "Nota").optional(),
  notas: z
    .array(z.object({ alvo: z.enum(["SALAO", "SERVICO", "CORTE", "PRODUTO", "PROFISSIONAL"]), id: id.nullable().optional().transform((v) => v ?? null), nota: inteiro(1, 5, "Nota") }))
    .max(20)
    .default([]),
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
export const finalizarPedidoSchema = z.object({
  observacao: textoOpcional(500, "Observação"),
  forma_pagamento: z.enum(["PIX", "CARTAO", "DINHEIRO"], { error: "Forma de pagamento inválida." }).nullable().optional(),
  usar_desconto: booleano.default(true),
});
export const statusPedidoSchema = z.object({
  status: z.enum(["PENDENTE", "PRONTO_PARA_RETIRADA", "CONCLUIDO", "CANCELADO"], { error: "Status inválido." }),
});
export const listaPedidosQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PENDENTE", "PRONTO_PARA_RETIRADA", "CONCLUIDO", "CANCELADO"]).optional()),
  busca: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional()),
  visitante: opcionalQuery(booleano),
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

export const privacidadeSchema = z.object({
  perfil_publico: booleano,
  mostrar_email: booleano,
  mostrar_telefone: booleano,
  mostrar_nascimento: booleano,
  mostrar_bio: booleano,
  mostrar_estatisticas: booleano,
  mostrar_favoritos: booleano,
});

export const redeSocialSchema = z.object({
  rede: textoObrigatorio(20, "a rede"),
  rotulo: textoObrigatorio(60, "o nome da rede"),
  url: urlContato,
  publico: booleano.default(true),
});

export const usuarioLoginSchema = z.object({ usuario: nomeUsuario });
const senhaAtual = z.string({ error: "Informe a senha atual." }).min(1, "Informe a senha atual.").max(200);
export const trocarEmailSchema = z.object({ novo_email: email, senha_atual: senhaAtual });
export const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link inválido.") });

// ───────── Feed ─────────

export const postSchema = z.object({
  texto: textoOpcional(1000, "Texto"),
  midias: z.array(id).max(6, "No máximo 6 arquivos por publicação.").default([]),
});
export const comentarioSchema = z.object({ texto: textoObrigatorio(500, "o comentário") });
export const denunciaSchema = z.object({ motivo: textoObrigatorio(300, "o motivo") });
export const feedQuery = z.object({
  cursor: opcionalQuery(id),
  limite: z.coerce.number().int().min(1).max(30).default(10),
  autor: opcionalQuery(id),
});
export const moderacaoSchema = z.object({ status: z.enum(["PENDENTE", "APROVADO", "REJEITADO"], { error: "Situação inválida." }) });
export const moderacaoQuery = z.object({
  filtro: opcionalQuery(z.enum(["PENDENTE", "APROVADO", "REJEITADO", "DENUNCIADO"])),
  busca: opcionalQuery(z.string().trim().max(100)),
});

// ───────── Fidelidade, equipe da recepção e contatos ─────────

export const recompensaSchema = z.object({
  nome: textoObrigatorio(80, "o nome"),
  pontos_minimos: inteiro(1, 1000000, "Pontos mínimos"),
  desconto_percentual: inteiro(1, 90, "Desconto"),
  consome_pontos: booleano.default(true),
  ativo: booleano.default(true),
});
export const ajustePontosSchema = z.object({
  pontos: inteiro(-100000, 100000, "Pontos").refine((n) => n !== 0, "Informe uma quantidade diferente de zero."),
  motivo: textoObrigatorio(160, "o motivo"),
});

const dataOpcional = z.preprocess((v) => (v === "" ? null : v), dataIso.transform((d) => new Date(`${d}T00:00:00Z`)).nullable().optional());
const doc = (max, rotulo) => textoOpcional(max, rotulo);
export const recepcionistaSchema = z.object({
  nome_completo: nome,
  email,
  usuario: nomeUsuario,
  telefone: telefoneOpcional,
  whatsapp: whatsappOpcional,
  avatar_url: urlImagemOpcional,
  vinculo: z.enum(["CLT", "FREELANCE", "ESTAGIO"], { error: "Vínculo inválido." }),
  status_contrato: z.enum(["ATIVO", "ESTAGIO", "DESLIGADO"], { error: "Situação inválida." }).default("ATIVO"),
  data_entrada: dataOpcional,
  data_saida: dataOpcional,
  motivo_saida: textoOpcional(200, "Motivo da saída"),
  cpf: opcional(cpf),
  rg: doc(30, "RG"),
  ctps: doc(40, "CTPS"),
  pis: doc(20, "PIS"),
  cnh: doc(20, "CNH"),
  emergencia: doc(160, "Contato de emergência"),
  endereco: textoOpcional(200, "Endereço"),
  cidade: textoOpcional(100, "Cidade"),
  uf: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v), z.string().regex(/^[A-Z]{2}$/, "UF inválida.").nullable().optional()),
  cep: z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") || null : v), z.string().regex(/^\d{8}$/, "CEP inválido.").nullable().optional()),
  observacoes: textoOpcional(1000, "Observações"),
});
export const desligamentoSchema = z.object({ data_saida: dataIso.transform((d) => new Date(`${d}T00:00:00Z`)), motivo: textoOpcional(200, "Motivo") });
export const pontoSchema = z.object({ tipo: z.enum(["ENTRADA", "SAIDA"], { error: "Tipo inválido." }), observacao: textoOpcional(200, "Observação") });

export const contatoSchema = z.object({
  tipo: textoObrigatorio(20, "o tipo"),
  rotulo: textoObrigatorio(60, "o nome"),
  valor: textoObrigatorio(120, "o texto exibido"),
  url: urlContato,
  publico: booleano.default(true),
  ordem: inteiro(0, 999, "Ordem").default(0),
});

export const perfilProfissionalSchema = z.object({
  area: area.default("BARBEARIA"),
  especialidades: z.array(z.string().trim().min(1).max(60, "Especialidade: máximo de 60 caracteres.")).max(12, "No máximo 12 especialidades.").default([]),
  anos_experiencia: z.preprocess((v) => (v === "" ? null : v), inteiro(0, 80, "Anos de experiência").nullable().optional()),
  certificacoes: textoOpcional(400, "Certificações"),
  visivel_no_site: booleano.default(true),
  bio: textoOpcional(300, "Bio"),
});

export const logsQuery = z.object({
  acao: opcionalQuery(z.string().trim().max(60)),
  busca: opcionalQuery(z.string().trim().max(100)),
  pagina: z.coerce.number().int().min(1).max(10000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
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
  usuario: nomeUsuario,
  perfil: perfilProfissionalSchema.optional(),
});

export const servicoSchema = z.object({
  nome_servico: textoObrigatorio(100, "o nome do serviço"),
  descricao: textoOpcional(500, "Descrição"),
  icone: textoOpcional(16, "Ícone"),
  preco: dinheiro,
  preco_a_partir_de: booleano.default(false),
  duracao_minutos: inteiro(5, 480, "Duração"),
  area: area.default("BARBEARIA"),
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
  descricao: textoOpcional(500, "Descrição"),
  area: area.default("BARBEARIA"),
  duracao_ref_minutos: z.preprocess((v) => (v === "" ? null : v), inteiro(5, 480, "Duração").nullable().optional()),
  preco_ref: z.preprocess((v) => (v === "" ? null : v), dinheiro.nullable().optional()),
  modelo_3d_url: modelo3d, // a foto é o padrão; o 3D só existe se o profissional adicionar
  imagem_url: urlImagem,
  ordem_exibicao: inteiro(0, 9999, "Ordem").default(0),
  ativo: booleano.default(true),
});

export const visibilidadeSchema = z
  .object({ visivel: booleano.optional(), status_moderacao: z.enum(["PENDENTE", "APROVADO", "REJEITADO"]).optional() })
  .refine((d) => d.visivel !== undefined || d.status_moderacao, "Nada para alterar.");

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
  slogan: textoOpcional(160, "Slogan"),
  sobre: textoOpcional(600, "Sobre"),
  entrega_ativa: booleano,
  aviso_entrega_off: textoOpcional(300, "Aviso"),
  aviso_entrega_on: textoOpcional(300, "Aviso"),
  prazo_retirada_dias: inteiro(1, 60, "Prazo de retirada"),
  tolerancia_falta_minutos: inteiro(5, 240, "Tolerância"),
  falta_automatica: booleano,
  pontos_por_real: dinheiro,
  pontos_minimos_evento: inteiro(0, 10000, "Pontos mínimos"),
  nivel_prata: inteiro(1, 1000000, "Nível Prata"),
  nivel_ouro: inteiro(2, 1000000, "Nível Ouro"),
  avaliacao_requer_aprovacao: booleano,
});
