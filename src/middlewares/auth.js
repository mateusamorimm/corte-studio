import { prisma } from "../lib/prisma.js";
import { COOKIE_SESSAO, lerSessao, versaoSenha, encerrarSessao } from "../lib/sessao.js";
import { unauthorized, forbidden } from "../lib/errors.js";

// Campos do usuário disponíveis em req.usuario (nunca inclui senha_hash).
export const CAMPOS_USUARIO_PUBLICO = {
  id_usuario: true,
  nome_completo: true,
  email: true,
  cpf: true,
  telefone: true,
  data_nascimento: true,
  tipo_perfil: true,
  avatar_url: true,
  capa_url: true,
  usuario: true,
  visitante: true,
  perfil_publico: true,
  mostrar_email: true,
  mostrar_telefone: true,
  mostrar_nascimento: true,
  mostrar_bio: true,
  mostrar_estatisticas: true,
  mostrar_favoritos: true,
  bio: true,
  endereco: true,
  instagram: true,
  tiktok: true,
  whatsapp: true,
  ativo: true,
  data_cadastro: true,
};

// Lê o cookie de sessão e, se válido, carrega o usuário do banco.
// Perfil e status "ativo" são relidos a cada requisição: desativar ou
// rebaixar um usuário vale imediatamente.
export async function carregarSessao(req, res, next) {
  req.usuario = null;
  req.sessaoId = "anon";
  const token = req.cookies?.[COOKIE_SESSAO];
  if (!token) return next();

  const payload = lerSessao(token);
  if (!payload) {
    encerrarSessao(res);
    return next();
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id_usuario: Number(payload.sub) },
    select: { ...CAMPOS_USUARIO_PUBLICO, senha_hash: true },
  });

  if (!usuario || !usuario.ativo || versaoSenha(usuario.senha_hash) !== payload.sv) {
    encerrarSessao(res);
    return next();
  }

  const { senha_hash, ...publico } = usuario;
  req.usuario = publico;
  req.sessaoId = payload.sid;
  next();
}

export function exigirLogin(req, _res, next) {
  if (!req.usuario) return next(unauthorized());
  next();
}

// Uso: exigirPerfil("ADMIN") ou exigirPerfil("ADMIN", "BARBEIRO")
export function exigirPerfil(...perfis) {
  return (req, _res, next) => {
    if (!req.usuario) return next(unauthorized());
    if (!perfis.includes(req.usuario.tipo_perfil)) return next(forbidden());
    next();
  };
}
