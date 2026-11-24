// Consulta e cancelamento de reserva com código + telefone.
import { post } from "../api.js";
import { $, html, moeda, dataCurta, hora, badgeStatus, STATUS_AGENDAMENTO, STATUS_PEDIDO, STATUS_RESERVA, alertaForm, comCarregamento, confirmar, toast } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { mascaraTelefone, regras } from "../validacao.js";

iniciarVitrine();
const form = $("#formReserva");
const alerta = $("#alerta");
mascaraTelefone(form.telefone);
form.codigo.value = (new URLSearchParams(location.search).get("codigo") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
form.codigo.addEventListener("input", () => (form.codigo.value = form.codigo.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));

const credenciais = () => ({ codigo: form.codigo.value, telefone: form.telefone.value });

function mostrar(r) {
  $("#resultado").innerHTML = html`
    <div class="card" style="padding:24px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <h2 style="font-size:1.1rem">Reserva ${r.codigo}</h2>${badgeStatus(STATUS_RESERVA, r.status)}
      </div>
      <p class="text-muted" style="font-size:0.9rem;margin:4px 0 12px">Em nome de ${r.nome}${r.motivo ? ` · ${r.motivo}` : ""}</p>
      ${r.agendamentos.map(
        (a) => html`<div class="hist-item"><span><strong>${dataCurta(a.inicio)} às ${hora(a.inicio)}</strong><br><small class="text-muted">${a.servicos.join(" + ")} com ${a.profissional}</small></span><span>${badgeStatus(STATUS_AGENDAMENTO, a.status)} ${moeda(a.preco)}</span></div>`
      )}
      ${r.pedido
        ? html`${r.pedido.itens.map((i) => html`<div class="hist-item"><span>${i.quantidade}× ${i.nome}</span><span>${moeda(Number(i.preco) * i.quantidade)}</span></div>`)}
          <div class="hist-item"><span><strong>Total dos produtos</strong><br><small class="text-muted">Retirar até ${dataCurta(r.pedido.prazo_retirada)}</small></span><span>${badgeStatus(STATUS_PEDIDO, r.pedido.status)} <strong>${moeda(r.pedido.total)}</strong></span></div>`
        : ""}
      ${r.status === "ATIVA" ? html`<div class="modal-actions"><button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent)" id="btnCancelar">Cancelar reserva</button></div>` : ""}
    </div>`.toString();
  $("#btnCancelar")?.addEventListener("click", async (e) => {
    const botao = e.currentTarget;
    if (!(await confirmar("Cancelar esta reserva? Horários e produtos voltam a ficar disponíveis para outras pessoas.", { titulo: "Cancelar reserva", confirmar: "Cancelar reserva", perigo: true }))) return;
    await comCarregamento(botao, async () => {
      try {
        mostrar((await post("/reservas/cancelar", credenciais())).reserva);
        toast("Reserva cancelada.", "sucesso");
      } catch (err) {
        toast(err.message, "erro");
      }
    }, "Cancelando...");
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm(alerta, null);
  if (form.codigo.value.length !== 6) return alertaForm(alerta, "O código tem 6 letras e números.");
  const m = regras.telefone(form.telefone.value);
  if (m) return alertaForm(alerta, m);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      mostrar((await post("/reservas/consulta", credenciais())).reserva);
    } catch (err) {
      $("#resultado").innerHTML = "";
      alertaForm(alerta, err.message);
    }
  }, "Consultando...");
});
