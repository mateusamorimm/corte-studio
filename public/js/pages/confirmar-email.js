import { post } from "../api.js";
import { $, alertaForm, comCarregamento } from "../ui.js";

// O token vem no fragmento (#) e sai da barra de endereço logo em seguida
const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
history.replaceState(null, "", location.pathname);
const botao = $("#btnConfirmar");
const alerta = $("#alerta");
if (!token) {
  botao.hidden = true;
  alertaForm(alerta, "Link inválido. Peça a troca de e-mail novamente no seu perfil.");
}
botao.addEventListener("click", () =>
  comCarregamento(botao, async () => {
    try {
      alertaForm(alerta, (await post("/auth/confirmar-email", { token })).mensagem, "sucesso");
      botao.hidden = true;
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Confirmando...")
);
