import { prisma } from "../lib/prisma.js";

// Configuração do salão (linha única, id = 1). Se ainda não existir, usa os padrões do schema.
const PADRAO = {
  id: 1,
  nome_salao: "Studio Corte",
  endereco: null,
  telefone: null,
  whatsapp: null,
  email_contato: null,
  horario_funcionamento_texto: null,
  url_mapa: null,
  instagram_url: null,
  tiktok_url: null,
  hero_titulo: null,
  hero_subtitulo: null,
  hero_imagem_url: null,
  fuso_horario: "America/Sao_Paulo",
  intervalo_slots_minutos: 15,
  antecedencia_minima_minutos: 60,
  antecedencia_cancelamento_hrs: 2,
  janela_agendamento_dias: 30,
};

export async function obterConfig(cliente = prisma) {
  return (await cliente.configuracaoSalao.findUnique({ where: { id: 1 } })) ?? { ...PADRAO };
}

// Campos que qualquer visitante pode ver (home, rodapé, mapa, agendamento).
export function configPublica(c) {
  return {
    nome_salao: c.nome_salao,
    endereco: c.endereco,
    telefone: c.telefone,
    whatsapp: c.whatsapp,
    email_contato: c.email_contato,
    horario_funcionamento_texto: c.horario_funcionamento_texto,
    url_mapa: c.url_mapa,
    instagram_url: c.instagram_url,
    tiktok_url: c.tiktok_url,
    hero_titulo: c.hero_titulo,
    hero_subtitulo: c.hero_subtitulo,
    hero_imagem_url: c.hero_imagem_url,
    fuso_horario: c.fuso_horario,
    intervalo_slots_minutos: c.intervalo_slots_minutos,
    antecedencia_minima_minutos: c.antecedencia_minima_minutos,
    antecedencia_cancelamento_hrs: c.antecedencia_cancelamento_hrs,
    janela_agendamento_dias: c.janela_agendamento_dias,
  };
}

export async function salvarConfig(dados) {
  return prisma.configuracaoSalao.upsert({
    where: { id: 1 },
    create: { id: 1, ...dados },
    update: dados,
  });
}
