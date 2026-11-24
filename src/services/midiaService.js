// Regras de mídia (Cloudinary): quem pode enviar o quê, formatos, tamanho e pasta de cada usuário.
// Fluxo: assinatura → navegador envia direto ao Cloudinary → confirmação (o servidor consulta o
// Cloudinary, valida pasta/formato/tamanho e registra na tabela midia; o que não passa é apagado).
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parametrosEnvio, urlEnvio, obterRecurso, destruir } from "../lib/cloudinary.js";

const MB = 1024 * 1024;

export const TIPOS = {
  IMAGEM: { resourceType: "image", formatos: ["jpg", "jpeg", "png", "webp"], limite: 10 * MB },
  VIDEO: { resourceType: "video", formatos: ["mp4", "webm", "mov"], limite: 60 * MB },
  MODELO_3D: { resourceType: "raw", formatos: ["glb"], limite: 10 * MB },
};

const TODOS = ["CLIENTE", "BARBEIRO", "RECEPCIONISTA", "ADMIN"];
const QUEM_CORTA = ["BARBEIRO", "ADMIN"]; // foto do corte e, se quiser, o modelo 3D
export const FINALIDADES = {
  AVATAR: { tipos: ["IMAGEM"], perfis: TODOS },
  CAPA: { tipos: ["IMAGEM"], perfis: TODOS },
  REFERENCIA: { tipos: ["IMAGEM"], perfis: TODOS },
  POST: { tipos: ["IMAGEM", "VIDEO"], perfis: TODOS },
  PRODUTO: { tipos: ["IMAGEM"], perfis: ["ADMIN"] },
  SERVICO: { tipos: ["IMAGEM"], perfis: ["ADMIN"] },
  GALERIA: { tipos: ["IMAGEM"], perfis: QUEM_CORTA },
  SALAO: { tipos: ["IMAGEM"], perfis: ["ADMIN"] },
  EQUIPE: { tipos: ["IMAGEM"], perfis: ["ADMIN"] },
  CORTE_3D: { tipos: ["MODELO_3D"], perfis: QUEM_CORTA },
};

// Pasta exclusiva por finalidade e usuário: studio-corte/avatar/u12
export const pastaDo = (finalidade, idUsuario) => `${env.CLOUDINARY_PASTA}/${finalidade.toLowerCase()}/u${idUsuario}`;

function regra(usuario, finalidade, tipo) {
  const f = FINALIDADES[finalidade];
  if (!f) throw badRequest("Finalidade de mídia inválida.");
  if (!f.perfis.includes(usuario.tipo_perfil)) throw forbidden("Você não pode enviar este tipo de mídia.");
  if (!f.tipos.includes(tipo)) throw badRequest("Tipo de arquivo não permitido para este envio.");
  return TIPOS[tipo];
}

export function gerarAssinatura(usuario, { finalidade, tipo }) {
  const t = regra(usuario, finalidade, tipo);
  const params = parametrosEnvio({
    pasta: pastaDo(finalidade, usuario.id_usuario),
    formatos: t.formatos,
    tags: [env.CLOUDINARY_PASTA, finalidade.toLowerCase()],
  });
  return { ...params, url_envio: urlEnvio(t.resourceType), resource_type: t.resourceType, limite_bytes: t.limite };
}

const extensao = (publicId) => (publicId.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

export async function confirmarEnvio(usuario, { finalidade, tipo, public_id }) {
  const t = regra(usuario, finalidade, tipo);
  const pasta = pastaDo(finalidade, usuario.id_usuario);
  if (!public_id.startsWith(`${pasta}/`)) throw forbidden("Este arquivo não pertence ao seu envio.");

  const ja = await prisma.midia.findUnique({ where: { public_id } });
  if (ja) {
    if (ja.id_usuario !== usuario.id_usuario) throw forbidden();
    return ja;
  }

  const recurso = await obterRecurso(t.resourceType, public_id);
  if (!recurso) throw notFound("Arquivo não encontrado no Cloudinary. Envie novamente.");

  const formato = String(recurso.format || extensao(recurso.public_id)).toLowerCase();
  const problema = !t.formatos.includes(formato)
    ? "Formato de arquivo não permitido."
    : !(recurso.bytes > 0) || recurso.bytes > t.limite
      ? `Arquivo muito grande. O limite é ${Math.round(t.limite / MB)} MB.`
      : !String(recurso.secure_url).startsWith("https://res.cloudinary.com/")
        ? "Endereço do arquivo inválido."
        : null;
  if (problema) {
    await destruir(t.resourceType, public_id).catch(() => {});
    throw new AppError(400, problema, "MIDIA_INVALIDA");
  }

  return prisma.midia.create({
    data: {
      id_usuario: usuario.id_usuario,
      finalidade,
      tipo,
      public_id,
      resource_type: t.resourceType,
      formato,
      url: recurso.secure_url,
      bytes: recurso.bytes,
      largura: recurso.width || null,
      altura: recurso.height || null,
      duracao_seg: recurso.duration ? Number(recurso.duration).toFixed(2) : null,
    },
  });
}

// Remove do Cloudinary e do banco. Dono ou ADMIN. Limpa foto/banner do usuário que apontavam para ela.
export async function excluirMidia(usuario, idMidia) {
  const m = await prisma.midia.findUnique({ where: { id_midia: idMidia } });
  if (!m) throw notFound("Mídia não encontrada.");
  if (m.id_usuario !== usuario.id_usuario && usuario.tipo_perfil !== "ADMIN") throw forbidden();
  if (await prisma.postMidia.findUnique({ where: { id_midia: m.id_midia } })) {
    throw conflict("Este arquivo está em uma publicação. Exclua a publicação para removê-lo.");
  }
  await destruir(m.resource_type, m.public_id);
  await prisma.$transaction([
    prisma.usuario.updateMany({ where: { avatar_url: m.url }, data: { avatar_url: null } }),
    prisma.usuario.updateMany({ where: { capa_url: m.url }, data: { capa_url: null } }),
    prisma.corteGaleria.updateMany({ where: { modelo_3d_url: m.url }, data: { modelo_3d_url: null } }),
    prisma.midia.delete({ where: { id_midia: m.id_midia } }),
  ]);
}

// A URL é do próprio usuário? (mídia registrada no Cloudinary ou imagem antiga enviada por ele)
export async function urlPertenceAoUsuario(url, idUsuario) {
  if (!url) return true;
  const legado = url.match(/^\/api\/imagens\/([0-9a-f-]{36})$/);
  if (legado) {
    const img = await prisma.imagem.findUnique({ where: { id_imagem: legado[1] }, select: { id_usuario: true } });
    return img?.id_usuario === idUsuario;
  }
  const m = await prisma.midia.findUnique({ where: { url }, select: { id_usuario: true } });
  return m?.id_usuario === idUsuario;
}
