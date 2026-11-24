// Reservas sem conta (/api/reservas): criar, consultar e cancelar com código + telefone.
import { Router } from "express";
import { validar } from "../middlewares/validate.js";
import { limiteConsultaReserva, limiteReserva } from "../middlewares/rateLimit.js";
import { consultaReservaSchema, reservaVisitanteSchema } from "../validators/dominio.js";
import { cancelarReservaPublica, consultarReserva, criarReservaVisitante, reservaPublica } from "../services/reservaService.js";

const router = Router();

router.post("/", limiteReserva, validar({ body: reservaVisitanteSchema }), async (req, res) => {
  res.status(201).json({ reserva: reservaPublica(await criarReservaVisitante(req.valid.body)) });
});

// POST (e não GET) para o telefone não aparecer em endereços, históricos e logs.
router.post("/consulta", limiteConsultaReserva, validar({ body: consultaReservaSchema }), async (req, res) => {
  res.json({ reserva: await consultarReserva(req.valid.body.codigo, req.valid.body.telefone) });
});

router.post("/cancelar", limiteConsultaReserva, validar({ body: consultaReservaSchema }), async (req, res) => {
  res.json({ reserva: await cancelarReservaPublica(req.valid.body.codigo, req.valid.body.telefone) });
});

export default router;
