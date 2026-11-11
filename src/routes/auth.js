import { Router } from "express";
import { validar } from "../middlewares/validate.js";
import { limiteLogin, limiteCadastro, limiteRecuperacao } from "../middlewares/rateLimit.js";
import { cadastroSchema, loginSchema, recuperarSchema, redefinirSchema } from "../validators/auth.js";
import { cadastrarCliente, autenticar, solicitarRedefinicao, redefinirSenha } from "../services/authService.js";
import { criarSessao, encerrarSessao } from "../lib/sessao.js";
import { emitirCsrf } from "../middlewares/csrf.js";

const router = Router();

function iniciarSessao(res, usuario) {
  const sid = criarSessao(res, usuario);
  emitirCsrf(res, sid); // novo token CSRF vinculado à nova sessão
  const { senha_hash, ...publico } = usuario;
  return publico;
}

router.get("/me", (req, res) => {
  res.json({ usuario: req.usuario });
});

router.post("/cadastro", limiteCadastro, validar({ body: cadastroSchema }), async (req, res) => {
  const usuario = await cadastrarCliente(req.valid.body);
  res.status(201).json({ usuario: iniciarSessao(res, usuario) });
});

router.post("/login", limiteLogin, validar({ body: loginSchema }), async (req, res) => {
  const usuario = await autenticar(req.valid.body.email, req.valid.body.senha);
  res.json({ usuario: iniciarSessao(res, usuario) });
});

router.post("/logout", (_req, res) => {
  encerrarSessao(res);
  emitirCsrf(res, "anon");
  res.json({ ok: true });
});

router.post("/recuperar-senha", limiteRecuperacao, validar({ body: recuperarSchema }), async (req, res) => {
  await solicitarRedefinicao(req.valid.body.email);
  res.json({
    mensagem: "Se houver uma conta com este e-mail, você receberá um link para redefinir a senha em instantes.",
  });
});

router.post("/redefinir-senha", limiteRecuperacao, validar({ body: redefinirSchema }), async (req, res) => {
  await redefinirSenha(req.valid.body.token, req.valid.body.senha);
  encerrarSessao(res);
  emitirCsrf(res, "anon");
  res.json({ mensagem: "Senha alterada com sucesso. Entre com a nova senha." });
});

export default router;
