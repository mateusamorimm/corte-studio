import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { emitirCsrf } from "../middlewares/csrf.js";
import authRoutes from "./auth.js";

const router = Router();

router.use("/auth", authRoutes);

// Saúde da API e do banco (sem expor detalhes da conexão).
router.get("/health", async (_req, res) => {
  let banco = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    banco = "indisponivel";
  }
  res.status(banco === "ok" ? 200 : 503).json({ api: "ok", banco });
});

// Entrega um token CSRF novo (também enviado no cookie sc_csrf).
router.get("/csrf", (req, res) => {
  res.json({ csrfToken: emitirCsrf(res, req.sessaoId) });
});

export default router;
