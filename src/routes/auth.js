import { Router } from "express";
import { validar } from "../middlewares/validate.js";
import { limiteLogin, limiteCadastro, limiteRecuperacao } from "../middlewares/rateLimit.js";
import { tokenSchema } from "../validators/dominio.js";
import { registrarLog } from "../services/logService.js";
import { cadastroSchema, loginSchema, recuperarSchema, redefinirSchema } from "../validators/auth.js";
import { cadastrarCliente, autenticar, solicitarRedefinicao, redefinirSenha, confirmarTrocaEmail } from "../services/authService.js";
import { criarSessao, encerrarSessao } from "../lib/sessao.js";
import { emitirCsrf } from "../middlewares/csrf.js";

const router = Router();

// Só e-mails vão para o log: num campo livre a pessoa pode ter digitado a senha por engano.
const identificadorLog = (v) => (v.includes("@") ? v : "(nome de usuário)");

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
  await registrarLog("conta.cadastro", { autor: usuario, entidade: "usuario", id: usuario.id_usuario });
  res.status(201).json({ usuario: iniciarSessao(res, usuario) });
});

router.post("/login", limiteLogin, validar({ body: loginSchema }), async (req, res) => {
  let usuario;
  try {
    usuario = await autenticar(req.valid.body.email, req.valid.body.senha);
  } catch (err) {
    await registrarLog("login.falha", { detalhes: { identificador: identificadorLog(req.valid.body.email), motivo: err.code } });
    throw err;
  }
  await registrarLog("login.sucesso", { autor: usuario, entidade: "usuario", id: usuario.id_usuario });
  res.json({ usuario: iniciarSessao(res, usuario) });
});

router.post("/logout", (_req, res) => {
  encerrarSessao(res);
  emitirCsrf(res, "anon");
  res.json({ ok: true });
});

router.post("/recuperar-senha", limiteRecuperacao, validar({ body: recuperarSchema }), async (req, res) => {
  await solicitarRedefinicao(req.valid.body.email);
  await registrarLog("conta.recuperacao", { detalhes: { identificador: req.valid.body.email } });
  res.json({
    mensagem: "Se houver uma conta com este e-mail, você receberá um link para redefinir a senha em instantes.",
  });
});

router.post("/redefinir-senha", limiteRecuperacao, validar({ body: redefinirSchema }), async (req, res) => {
  const id = await redefinirSenha(req.valid.body.token, req.valid.body.senha);
  await registrarLog("conta.senha_redefinida", { autor: id, entidade: "usuario", id });
  encerrarSessao(res);
  emitirCsrf(res, "anon");
  res.json({ mensagem: "Senha alterada com sucesso. Entre com a nova senha." });
});

router.post("/confirmar-email", limiteRecuperacao, validar({ body: tokenSchema }), async (req, res) => {
  await confirmarTrocaEmail(req.valid.body.token);
  res.json({ mensagem: "E-mail confirmado. Use o novo endereço para entrar." });
});

export default router;
