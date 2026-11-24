// Feed da comunidade (/api/feed). Leitura pública; publicar, curtir, comentar e denunciar exigem login.
import { Router } from "express";
import { exigirLogin } from "../middlewares/auth.js";
import { validar } from "../middlewares/validate.js";
import { limiteComentario, limiteCurtida, limiteDenuncia, limitePost } from "../middlewares/rateLimit.js";
import { idParam } from "../validators/comum.js";
import { comentarioSchema, denunciaSchema, feedQuery, postSchema } from "../validators/dominio.js";
import {
  comentar,
  criarPost,
  curtir,
  denunciar,
  excluirComentario,
  excluirPost,
  listarComentarios,
  listarFeed,
} from "../services/feedService.js";

const router = Router();

router.get("/", validar({ query: feedQuery }), async (req, res) => {
  res.json(await listarFeed({ leitor: req.usuario, ...req.valid.query }));
});

router.post("/", exigirLogin, limitePost, validar({ body: postSchema }), async (req, res) => {
  const post = await criarPost(req.usuario, req.valid.body);
  res.status(201).json({ post, aviso: post.status === "PENDENTE" ? "Sua publicação foi enviada e aparecerá depois da aprovação do salão." : null });
});

router.delete("/:id", exigirLogin, validar({ params: idParam }), async (req, res) => {
  await excluirPost(req.valid.params.id, req.usuario);
  res.json({ ok: true });
});

router.put("/:id/curtida", exigirLogin, limiteCurtida, validar({ params: idParam }), async (req, res) => {
  res.json(await curtir(req.valid.params.id, req.usuario, true));
});
router.delete("/:id/curtida", exigirLogin, limiteCurtida, validar({ params: idParam }), async (req, res) => {
  res.json(await curtir(req.valid.params.id, req.usuario, false));
});

router.get("/:id/comentarios", validar({ params: idParam }), async (req, res) => {
  res.json({ comentarios: await listarComentarios(req.valid.params.id, req.usuario) });
});
router.post("/:id/comentarios", exigirLogin, limiteComentario, validar({ params: idParam, body: comentarioSchema }), async (req, res) => {
  const comentario = await comentar(req.valid.params.id, req.usuario, req.valid.body.texto);
  res.status(201).json({ comentario, aviso: comentario.status === "PENDENTE" ? "Seu comentário aparecerá depois da aprovação do salão." : null });
});
router.delete("/comentarios/:id", exigirLogin, validar({ params: idParam }), async (req, res) => {
  await excluirComentario(req.valid.params.id, req.usuario);
  res.json({ ok: true });
});

const MENSAGEM_DENUNCIA = "Denúncia registrada. A equipe do salão vai analisar.";
router.post("/:id/denuncia", exigirLogin, limiteDenuncia, validar({ params: idParam, body: denunciaSchema }), async (req, res) => {
  await denunciar(req.usuario, { id_post: req.valid.params.id, motivo: req.valid.body.motivo });
  res.status(201).json({ mensagem: MENSAGEM_DENUNCIA });
});
router.post("/comentarios/:id/denuncia", exigirLogin, limiteDenuncia, validar({ params: idParam, body: denunciaSchema }), async (req, res) => {
  await denunciar(req.usuario, { id_comentario: req.valid.params.id, motivo: req.valid.body.motivo });
  res.status(201).json({ mensagem: MENSAGEM_DENUNCIA });
});

export default router;
