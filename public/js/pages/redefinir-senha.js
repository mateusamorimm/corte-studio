import { post } from "../api.js";
import { $, alertaForm, mostrarErrosCampos, limparErrosCampos, comCarregamento } from "../ui.js";
import { regras, validarForm, alternarSenha } from "../validacao.js";

const form = $("#redefinirForm");
const alerta = $("#alerta");
alternarSenha();

// O token chega no fragmento (#token=...). Guardamos em memória e limpamos a URL.
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname);

if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
  alertaForm(alerta, "Link inválido ou incompleto. Solicite um novo link de redefinição.");
  form.hidden = true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm(alerta, null);
  limparErrosCampos(form);
  const erros = validarForm(form, {
    senha: regras.senha,
    confirmar: (v, f) => (v === f.senha.value ? null : "As senhas não conferem."),
  });
  if (mostrarErrosCampos(form, erros)) return;

  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      await post("/auth/redefinir-senha", { token, senha: form.senha.value });
      location.replace("login.html?senha=redefinida");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (err.codigo === "TOKEN_INVALIDO") form.hidden = true;
      else if (err.detalhes?.length) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});
