import { post } from "../api.js";
import { $, alertaForm, mostrarErrosCampos, limparErrosCampos, comCarregamento } from "../ui.js";
import { regras, validarForm, alternarSenha } from "../validacao.js";
import { obterUsuario, destinoAposLogin } from "../sessao.js";

const form = $("#loginForm");
const alerta = $("#alerta");
alternarSenha();

// Preserva o destino (?voltar=) também no link de cadastro
const voltar = new URLSearchParams(location.search).get("voltar");
if (voltar) $("#linkCadastro").href = `cadastro.html?voltar=${encodeURIComponent(voltar)}`;

// Já logado? Vai direto para o destino.
obterUsuario().then((u) => {
  if (u) location.replace(destinoAposLogin(u));
});

const params = new URLSearchParams(location.search);
if (params.get("senha") === "redefinida") alertaForm(alerta, "Senha alterada com sucesso. Entre com a nova senha.", "sucesso");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm(alerta, null);
  limparErrosCampos(form);

  const erros = validarForm(form, {
    email: (v) => (!v.trim() ? "Informe o e-mail ou usuário." : v.includes("@") ? regras.email(v) : null),
    senha: (v) => (v ? null : "Informe a senha."),
  });
  if (mostrarErrosCampos(form, erros)) return;

  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const { usuario } = await post("/auth/login", { email: form.email.value, senha: form.senha.value });
      location.replace(destinoAposLogin(usuario));
    } catch (err) {
      form.senha.value = "";
      alertaForm(alerta, err.message);
      if (err.detalhes?.length) mostrarErrosCampos(form, err.detalhes);
      else form.senha.focus();
    }
  }, "Entrando...");
});
