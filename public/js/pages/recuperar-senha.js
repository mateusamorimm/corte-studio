import { post } from "../api.js";
import { $, alertaForm, mostrarErrosCampos, limparErrosCampos, comCarregamento } from "../ui.js";
import { regras, validarForm } from "../validacao.js";

const form = $("#recoveryForm");
const alerta = $("#alerta");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm(alerta, null);
  limparErrosCampos(form);
  if (mostrarErrosCampos(form, validarForm(form, { email: regras.email }))) return;

  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const { mensagem } = await post("/auth/recuperar-senha", { email: form.email.value });
      alertaForm(alerta, `${mensagem} Verifique também a caixa de spam.`, "sucesso");
      form.reset();
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Enviando...");
});
