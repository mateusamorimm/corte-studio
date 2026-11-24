// Feed da comunidade: publicações (texto, fotos e vídeos), curtidas, comentários e denúncias.
// Publica na hora: equipe, clientes com atendimento/compra concluídos ou que já tiveram algo aprovado.
// Conta nova: fica pendente até a moderação aprovar a primeira publicação.
import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { nomePublico } from "../lib/nomes.js";
import { destruir } from "../lib/cloudinary.js";
import { registrarLog } from "./logService.js";

const MAX_MIDIAS = 6;
const SELECT_AUTOR = { id_usuario: true, nome_completo: true, avatar_url: true, tipo_perfil: true, perfil_publico: true };
const EQUIPE = ["ADMIN", "BARBEIRO", "RECEPCIONISTA"];
const ehEquipe = (u) => EQUIPE.includes(u?.tipo_perfil);

export const autorPublico = (u) => ({
  id_usuario: u.id_usuario,
  nome: ehEquipe(u) ? u.nome_completo : nomePublico(u.nome_completo),
  avatar_url: u.avatar_url,
  equipe: ehEquipe(u),
});

export async function contaConfiavel(usuario) {
  if (ehEquipe(usuario)) return true;
  const id = usuario.id_usuario;
  const [ag, ped, post, com] = await Promise.all([
    prisma.agendamento.count({ where: { id_cliente: id, status: "CONCLUIDO" } }),
    prisma.pedido.count({ where: { id_cliente: id, status: "CONCLUIDO" } }),
    prisma.post.count({ where: { id_autor: id, status_moderacao: "APROVADO" } }),
    prisma.postComentario.count({ where: { id_autor: id, status_moderacao: "APROVADO" } }),
  ]);
  return ag + ped + post + com > 0;
}

const includePost = (idLeitor) => ({
  autor: { select: SELECT_AUTOR },
  midias: { orderBy: { ordem: "asc" }, include: { midia: { select: { url: true, tipo: true, largura: true, altura: true } } } },
  _count: { select: { curtidas: true, comentarios: { where: { status_moderacao: "APROVADO" } } } },
  curtidas: { where: { id_usuario: idLeitor ?? 0 }, select: { id_usuario: true } },
});

const postPublico = (p, leitor) => ({
  id_post: p.id_post,
  texto: p.texto,
  data_criacao: p.data_criacao,
  status: p.status_moderacao,
  autor: autorPublico(p.autor),
  midias: p.midias.map((m) => m.midia),
  curtidas: p._count.curtidas,
  comentarios: p._count.comentarios,
  curtiu: p.curtidas.length > 0,
  meu: p.autor.id_usuario === leitor?.id_usuario,
});

// Público vê aprovados; o autor também vê os próprios (pendentes ou recusados).
const visivelPara = (leitor) => ({
  OR: [{ status_moderacao: "APROVADO", autor: { ativo: true } }, ...(leitor ? [{ id_autor: leitor.id_usuario }] : [])],
});

export async function listarFeed({ leitor = null, cursor = null, limite = 10, autor = null, soMeus = false }) {
  const posts = await prisma.post.findMany({
    where: {
      ...(soMeus ? { id_autor: leitor.id_usuario } : visivelPara(leitor)),
      ...(autor ? { id_autor: autor } : {}),
      ...(cursor ? { id_post: { lt: cursor } } : {}),
    },
    include: includePost(leitor?.id_usuario),
    orderBy: { id_post: "desc" },
    take: limite + 1,
  });
  const pagina = posts.slice(0, limite);
  return { posts: pagina.map((p) => postPublico(p, leitor)), proximo: posts.length > limite ? pagina.at(-1).id_post : null };
}

async function postVisivel(id, leitor) {
  const p = await prisma.post.findFirst({ where: { id_post: id, ...visivelPara(leitor) }, include: includePost(leitor?.id_usuario) });
  if (!p) throw notFound("Publicação não encontrada.");
  return p;
}

export async function criarPost(usuario, { texto, midias }) {
  const ids = [...new Set(midias)];
  if (!texto && !ids.length) throw badRequest("Escreva algo ou envie uma foto ou vídeo.");
  if (ids.length > MAX_MIDIAS) throw badRequest(`No máximo ${MAX_MIDIAS} arquivos por publicação.`);
  if (ids.length) {
    const validas = await prisma.midia.count({ where: { id_midia: { in: ids }, id_usuario: usuario.id_usuario, finalidade: "POST", post: { is: null } } });
    if (validas !== ids.length) throw badRequest("Use fotos e vídeos enviados por você para esta publicação.");
  }
  const aprovado = await contaConfiavel(usuario);
  const post = await prisma.post.create({
    data: {
      id_autor: usuario.id_usuario,
      texto: texto ?? "",
      status_moderacao: aprovado ? "APROVADO" : "PENDENTE",
      midias: { create: ids.map((id_midia, ordem) => ({ id_midia, ordem })) },
    },
    include: includePost(usuario.id_usuario),
  });
  return postPublico(post, usuario);
}

// Remove a publicação e os arquivos dela no Cloudinary.
export async function excluirPost(id, usuario) {
  const p = await prisma.post.findUnique({ where: { id_post: id }, include: { midias: { include: { midia: true } } } });
  if (!p) throw notFound("Publicação não encontrada.");
  if (p.id_autor !== usuario.id_usuario && usuario.tipo_perfil !== "ADMIN") throw forbidden();
  const arquivos = p.midias.map((m) => m.midia);
  await prisma.$transaction([
    prisma.post.delete({ where: { id_post: id } }), // curtidas, comentários e denúncias saem em cascata
    prisma.midia.deleteMany({ where: { id_midia: { in: arquivos.map((m) => m.id_midia) } } }),
  ]);
  for (const m of arquivos) {
    await destruir(m.resource_type, m.public_id).catch((err) => console.error("[midia] Falha ao apagar do Cloudinary:", err.message));
  }
  await registrarLog("post.excluido", { autor: usuario, entidade: "post", id, detalhes: { autor_post: p.id_autor } });
}

export async function curtir(id, usuario, valor) {
  const p = await postVisivel(id, usuario);
  if (p.status_moderacao !== "APROVADO") throw conflict("Esta publicação ainda não está no ar.");
  const chave = { id_post: id, id_usuario: usuario.id_usuario };
  if (valor) await prisma.postCurtida.upsert({ where: { id_post_id_usuario: chave }, create: chave, update: {} });
  else await prisma.postCurtida.deleteMany({ where: chave });
  return { curtiu: valor, curtidas: await prisma.postCurtida.count({ where: { id_post: id } }) };
}

const comentarioPublico = (c, leitor) => ({
  id_comentario: c.id_comentario,
  texto: c.texto,
  data_criacao: c.data_criacao,
  status: c.status_moderacao,
  autor: autorPublico(c.autor),
  meu: c.id_autor === leitor?.id_usuario,
});

export async function listarComentarios(idPost, leitor) {
  await postVisivel(idPost, leitor);
  const lista = await prisma.postComentario.findMany({
    where: {
      id_post: idPost,
      OR: [{ status_moderacao: "APROVADO", autor: { ativo: true } }, ...(leitor ? [{ id_autor: leitor.id_usuario }] : [])],
    },
    include: { autor: { select: SELECT_AUTOR } },
    orderBy: { id_comentario: "asc" },
    take: 200,
  });
  return lista.map((c) => comentarioPublico(c, leitor));
}

export async function comentar(idPost, usuario, texto) {
  const p = await postVisivel(idPost, usuario);
  if (p.status_moderacao !== "APROVADO") throw conflict("Esta publicação ainda não está no ar.");
  const aprovado = await contaConfiavel(usuario);
  const c = await prisma.postComentario.create({
    data: { id_post: idPost, id_autor: usuario.id_usuario, texto, status_moderacao: aprovado ? "APROVADO" : "PENDENTE" },
    include: { autor: { select: SELECT_AUTOR } },
  });
  return comentarioPublico(c, usuario);
}

// Quem apaga: o autor do comentário, o autor da publicação ou um administrador.
export async function excluirComentario(id, usuario) {
  const c = await prisma.postComentario.findUnique({ where: { id_comentario: id }, include: { post: { select: { id_autor: true } } } });
  if (!c) throw notFound("Comentário não encontrado.");
  if (![c.id_autor, c.post.id_autor].includes(usuario.id_usuario) && usuario.tipo_perfil !== "ADMIN") throw forbidden();
  await prisma.postComentario.delete({ where: { id_comentario: id } });
  if (c.id_autor !== usuario.id_usuario) await registrarLog("comentario.excluido", { autor: usuario, entidade: "comentario", id });
}

export async function denunciar(usuario, { id_post = null, id_comentario = null, motivo }) {
  if (id_post) {
    const p = await postVisivel(id_post, usuario);
    if (p.id_autor === usuario.id_usuario) throw conflict("Você não pode denunciar a sua própria publicação.");
  } else {
    const c = await prisma.postComentario.findFirst({ where: { id_comentario, status_moderacao: "APROVADO" } });
    if (!c) throw notFound("Comentário não encontrado.");
    if (c.id_autor === usuario.id_usuario) throw conflict("Você não pode denunciar o seu próprio comentário.");
  }
  const ja = await prisma.denuncia.findFirst({ where: { id_autor: usuario.id_usuario, id_post, id_comentario } });
  if (ja) return; // mesma resposta: a denúncia já está registrada
  await prisma.denuncia.create({ data: { id_autor: usuario.id_usuario, id_post, id_comentario, motivo } });
}

// ───────── Moderação (painel) ─────────

export async function postsModeracao({ filtro, busca }) {
  const posts = await prisma.post.findMany({
    where: {
      ...(filtro === "PENDENTE" || filtro === "REJEITADO" || filtro === "APROVADO" ? { status_moderacao: filtro } : {}),
      ...(filtro === "DENUNCIADO" ? { denuncias: { some: { resolvida_em: null } } } : {}),
      ...(busca ? { OR: [{ texto: { contains: busca, mode: "insensitive" } }, { autor: { nome_completo: { contains: busca, mode: "insensitive" } } }] } : {}),
    },
    include: { ...includePost(0), denuncias: { where: { resolvida_em: null }, include: { autor: { select: { nome_completo: true } } } } },
    orderBy: { id_post: "desc" },
    take: 200,
  });
  return posts.map((p) => ({
    ...postPublico(p, null),
    autor: { id_usuario: p.autor.id_usuario, nome: p.autor.nome_completo, avatar_url: p.autor.avatar_url, equipe: ehEquipe(p.autor) },
    denuncias: p.denuncias.map((d) => ({ id_denuncia: d.id_denuncia, motivo: d.motivo, quem: d.autor.nome_completo, data: d.data_criacao })),
  }));
}

export async function comentariosModeracao({ filtro }) {
  const lista = await prisma.postComentario.findMany({
    where: {
      ...(["PENDENTE", "REJEITADO", "APROVADO"].includes(filtro) ? { status_moderacao: filtro } : {}),
      ...(filtro === "DENUNCIADO" ? { denuncias: { some: { resolvida_em: null } } } : {}),
    },
    include: {
      autor: { select: SELECT_AUTOR },
      post: { select: { id_post: true, texto: true } },
      denuncias: { where: { resolvida_em: null }, include: { autor: { select: { nome_completo: true } } } },
    },
    orderBy: { id_comentario: "desc" },
    take: 200,
  });
  return lista.map((c) => ({
    ...comentarioPublico(c, null),
    autor: { id_usuario: c.autor.id_usuario, nome: c.autor.nome_completo, avatar_url: c.autor.avatar_url },
    post: c.post,
    denuncias: c.denuncias.map((d) => ({ id_denuncia: d.id_denuncia, motivo: d.motivo, quem: d.autor.nome_completo, data: d.data_criacao })),
  }));
}

// Decidir sobre o conteúdo também encerra as denúncias abertas sobre ele.
export async function moderar(entidade, id, status, ator) {
  const ehPost = entidade === "post";
  const alvo = ehPost ? { id_post: id } : { id_comentario: id };
  await prisma.$transaction(async (tx) => {
    if (ehPost) await tx.post.update({ where: alvo, data: { status_moderacao: status } });
    else await tx.postComentario.update({ where: alvo, data: { status_moderacao: status } });
    await tx.denuncia.updateMany({ where: { ...alvo, resolvida_em: null }, data: { resolvida_em: new Date() } });
    await registrarLog(`${entidade}.moderacao`, { autor: ator, entidade, id, detalhes: { status } }, tx);
  });
}
