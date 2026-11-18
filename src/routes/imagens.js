// Upload e entrega de imagens guardadas no próprio banco (Neon).
// - Só JPEG, PNG e WebP, identificados pelo conteúdo (assinatura do arquivo), nunca pelo nome ou cabeçalho.
// - SVG/GIF/HTML são recusados; a resposta sai com nosniff e CSP "sandbox" para não executar nada.
import crypto from "node:crypto";
import express, { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { exigirLogin } from "../middlewares/auth.js";
import { limiteUpload } from "../middlewares/rateLimit.js";

const router = Router();
export const TAMANHO_MAXIMO = 3 * 1024 * 1024;

function detectarTipo(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

router.post(
  "/",
  exigirLogin,
  limiteUpload,
  express.raw({ type: () => true, limit: TAMANHO_MAXIMO }),
  async (req, res) => {
    const dados = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!dados.length) throw new AppError(400, "Selecione uma imagem.", "IMAGEM_VAZIA");
    const mime = detectarTipo(dados);
    if (!mime) throw new AppError(415, "Formato não suportado. Envie JPG, PNG ou WebP.", "FORMATO_INVALIDO");

    const id = crypto.randomUUID();
    await prisma.imagem.create({
      data: { id_imagem: id, id_usuario: req.usuario.id_usuario, mime, tamanho: dados.length, dados },
    });
    res.status(201).json({ url: `/api/imagens/${id}` });
  }
);

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw notFound("Imagem não encontrada.");
  const img = await prisma.imagem.findUnique({ where: { id_imagem: id }, select: { mime: true, dados: true } });
  if (!img) throw notFound("Imagem não encontrada.");
  res.set({
    "Content-Type": img.mime,
    "Content-Length": String(img.dados.length),
    "Cache-Control": "public, max-age=31536000, immutable", // o conteúdo de um id nunca muda
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(Buffer.from(img.dados));
});

export default router;
