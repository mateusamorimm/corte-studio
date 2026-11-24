// Mídia no Cloudinary: assinatura de envio, confirmação e exclusão (usuário logado).
import { Router } from "express";
import { z } from "zod";
import { exigirLogin } from "../middlewares/auth.js";
import { validar } from "../middlewares/validate.js";
import { limiteUpload } from "../middlewares/rateLimit.js";
import { idParam } from "../validators/comum.js";
import { cloudinaryConfigurado } from "../config/env.js";
import { FINALIDADES, TIPOS, gerarAssinatura, confirmarEnvio, excluirMidia } from "../services/midiaService.js";

const router = Router();
router.use(exigirLogin);

const finalidade = z.enum(Object.keys(FINALIDADES), { error: "Finalidade de mídia inválida." });
const tipo = z.enum(Object.keys(TIPOS), { error: "Tipo de arquivo inválido." }).default("IMAGEM");

// O navegador descobre se envia para o Cloudinary ou para o armazenamento local
router.get("/config", (_req, res) => {
  res.json({ cloudinary: cloudinaryConfigurado });
});

router.post("/assinatura", limiteUpload, validar({ body: z.object({ finalidade, tipo }) }), (req, res) => {
  res.json(gerarAssinatura(req.usuario, req.valid.body));
});

router.post(
  "/confirmar",
  validar({ body: z.object({ finalidade, tipo, public_id: z.string().trim().min(1).max(255).regex(/^[\w\-/.]+$/, "Arquivo inválido.") }) }),
  async (req, res) => {
    const m = await confirmarEnvio(req.usuario, req.valid.body);
    res.status(201).json({ id_midia: m.id_midia, url: m.url, tipo: m.tipo, largura: m.largura, altura: m.altura });
  }
);

router.delete("/:id", validar({ params: idParam }), async (req, res) => {
  await excluirMidia(req.usuario, req.valid.params.id);
  res.json({ ok: true });
});

export default router;
