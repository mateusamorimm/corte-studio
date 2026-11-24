// Perfis públicos (clientes que permitiram e profissionais visíveis no site), respeitando a privacidade.
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { nomePublico } from "../lib/nomes.js";
import { VISIVEL } from "./avaliacaoService.js";
import { listarFeed } from "./feedService.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const filtroProfissionalVisivel = {
  ativo: true,
  tipo_perfil: { in: ["BARBEIRO", "ADMIN"] },
  servicos_oferecidos: { some: {} },
  OR: [{ perfil_profissional: { is: null } }, { perfil_profissional: { visivel_no_site: true } }],
};

export async function mediaDoProfissional(id) {
  const r = await prisma.avaliacaoNota.aggregate({ where: { id_profissional: id, avaliacao: VISIVEL }, _avg: { nota: true }, _count: true });
  if (r._count) return { media: r._avg.nota, total: r._count };
  // Avaliações antigas não têm nota por critério: usa a nota geral dos atendimentos dele.
  const g = await prisma.avaliacao.aggregate({ where: { ...VISIVEL, agendamento: { id_barbeiro: id } }, _avg: { nota: true }, _count: true });
  return { media: g._avg.nota, total: g._count };
}

const redesPublicas = (id) =>
  prisma.redeSocialUsuario.findMany({
    where: { id_usuario: id, publico: true },
    orderBy: [{ ordem: "asc" }, { id_rede: "asc" }],
    select: { rede: true, rotulo: true, url: true },
  });

async function perfilProfissional(u, leitor) {
  const [redes, avaliacao, atendimentos, cortes, feed, servicos] = await Promise.all([
    redesPublicas(u.id_usuario),
    mediaDoProfissional(u.id_usuario),
    prisma.agendamento.count({ where: { id_barbeiro: u.id_usuario, status: "CONCLUIDO" } }),
    prisma.corteGaleria.findMany({
      where: { id_autor: u.id_usuario, ativo: true },
      orderBy: { id_corte: "desc" },
      take: 24,
      select: { id_corte: true, nome_corte: true, imagem_url: true, modelo_3d_url: true },
    }),
    listarFeed({ leitor, autor: u.id_usuario, limite: 20 }),
    prisma.barbeiroServico.findMany({
      where: { id_barbeiro: u.id_usuario, servico: { ativo: true } },
      select: { servico: { select: { id_servico: true, nome_servico: true, icone: true } } },
    }),
  ]);
  const p = u.perfil_profissional;
  return {
    tipo: "PROFISSIONAL",
    id_usuario: u.id_usuario,
    nome: u.nome_completo,
    avatar_url: u.avatar_url,
    capa_url: u.capa_url,
    bio: u.bio,
    area: p?.area ?? "BARBEARIA",
    especialidades: p?.especialidades ?? [],
    anos_experiencia: p?.anos_experiencia ?? null,
    certificacoes: p?.certificacoes ?? null,
    avaliacao,
    estatisticas: { atendimentos },
    servicos: servicos.map((s) => s.servico),
    cortes,
    redes,
    posts: feed.posts,
  };
}

export async function perfilPublico(id, leitor = null) {
  const u = await prisma.usuario.findFirst({ where: { id_usuario: id, ativo: true, visitante: false }, include: { perfil_profissional: true, servicos_oferecidos: { take: 1 } } });
  if (!u) throw notFound("Perfil não encontrado.");

  const ehProfissional =
    ["BARBEIRO", "ADMIN"].includes(u.tipo_perfil) && u.servicos_oferecidos.length > 0 && (u.perfil_profissional?.visivel_no_site ?? true);
  if (ehProfissional) return perfilProfissional(u, leitor);

  const dono = leitor?.id_usuario === u.id_usuario;
  const equipe = u.tipo_perfil !== "CLIENTE";
  const base = {
    tipo: equipe ? "EQUIPE" : "CLIENTE",
    id_usuario: u.id_usuario,
    nome: equipe ? u.nome_completo : nomePublico(u.nome_completo),
    avatar_url: u.avatar_url,
  };
  const feed = await listarFeed({ leitor, autor: u.id_usuario, limite: 20 });
  if (!u.perfil_publico && !dono) {
    if (!feed.posts.length) throw notFound("Este perfil é privado.");
    return { ...base, privado: true, posts: feed.posts };
  }

  const [redes, favoritos, estatisticas] = await Promise.all([
    redesPublicas(u.id_usuario),
    u.mostrar_favoritos ? favoritosDe(u.id_usuario) : null,
    u.mostrar_estatisticas && !equipe
      ? Promise.all([
          prisma.agendamento.count({ where: { id_cliente: u.id_usuario, status: "CONCLUIDO" } }),
          prisma.post.count({ where: { id_autor: u.id_usuario, status_moderacao: "APROVADO" } }),
        ]).then(([visitas, publicacoes]) => ({ visitas, publicacoes }))
      : null,
  ]);
  const nasc = u.data_nascimento;
  return {
    ...base,
    privado: false,
    previa: dono && !u.perfil_publico, // só o próprio dono vê, como prévia
    capa_url: u.capa_url,
    membro_desde: u.data_cadastro,
    bio: u.mostrar_bio ? u.bio : null,
    email: u.mostrar_email ? u.email : null,
    telefone: u.mostrar_telefone ? u.telefone : null,
    aniversario: u.mostrar_nascimento && nasc ? `${nasc.getUTCDate()} de ${MESES[nasc.getUTCMonth()]}` : null, // sem o ano
    estatisticas,
    favoritos,
    redes,
    posts: feed.posts,
  };
}

export async function favoritosDe(id) {
  const [cortes, servicos, produtos] = await Promise.all([
    prisma.favorito.findMany({
      where: { id_cliente: id, corte: { ativo: true } },
      include: { corte: { select: { id_corte: true, nome_corte: true, imagem_url: true } } },
      orderBy: { data_favorito: "desc" },
    }),
    prisma.favoritoServico.findMany({
      where: { id_cliente: id, servico: { ativo: true } },
      include: { servico: { select: { id_servico: true, nome_servico: true, icone: true, preco: true, preco_a_partir_de: true, duracao_minutos: true } } },
      orderBy: { data_favorito: "desc" },
    }),
    prisma.favoritoProduto.findMany({
      where: { id_cliente: id, produto: { ativo: true } },
      include: { produto: { select: { id_produto: true, nome_produto: true, imagem_url: true, preco: true, quantidade_estoque: true } } },
      orderBy: { data_favorito: "desc" },
    }),
  ]);
  return { cortes: cortes.map((f) => f.corte), servicos: servicos.map((f) => f.servico), produtos: produtos.map((f) => f.produto) };
}
