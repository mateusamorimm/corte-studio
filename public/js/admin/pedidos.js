import { get, patch } from "../api.js";
import { $, html, moeda, toast, confirmar, comCarregamento, dataHora, telefoneFormatado, badgeStatus, STATUS_PEDIDO } from "../ui.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN"]);

const filtros = $("#filtros");
const params = new URLSearchParams(location.search);
if (params.get("status")) filtros.status.value = params.get("status");
let pedidos = [];
let temporizador;

async function carregar() {
  const q = new URLSearchParams();
  if (filtros.status.value) q.set("status", filtros.status.value);
  if (filtros.busca.value.trim()) q.set("busca", filtros.busca.value.trim());
  try {
    ({ pedidos } = await get(`/admin/pedidos?${q}`));
    render();
  } catch (err) {
    $("#pedidosBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

const ACOES = {
  PENDENTE: [["PRONTO_PARA_RETIRADA", "📦 Pronto p/ retirada"], ["CONCLUIDO", "✔ Retirado e pago"], ["CANCELADO", "✖ Cancelar"]],
  PRONTO_PARA_RETIRADA: [["CONCLUIDO", "✔ Retirado e pago"], ["PENDENTE", "↩ Voltar"], ["CANCELADO", "✖ Cancelar"]],
};

function render() {
  $("#pedidosBody").innerHTML = pedidos.length
    ? pedidos
        .map(
          (p) => html`
      <tr class="${p.status === "CANCELADO" ? "inativo" : ""}">
        <td>#${p.id_pedido}</td>
        <td style="white-space:nowrap;">${dataHora(p.data_pedido)}</td>
        <td>${p.cliente.nome_completo}${p.cliente.telefone ? html`<br><small class="text-muted">${telefoneFormatado(p.cliente.telefone)}</small>` : ""}</td>
        <td>${p.itens.map((i) => html`<div>${i.quantidade}x ${i.nome_produto_registrado} <span class="text-muted">(${moeda(i.preco_unitario)})</span></div>`)}
          ${p.observacao ? html`<small class="text-muted">💬 ${p.observacao}</small>` : ""}</td>
        <td style="font-weight:600;">${moeda(p.valor_total)}</td>
        <td>${badgeStatus(STATUS_PEDIDO, p.status)}</td>
        <td><div class="admin-acoes">${(ACOES[p.status] ?? []).map(
          ([s, rotulo]) => html`<button class="btn btn-ghost btn-sm" ${s === "CANCELADO" ? html`style="color:var(--accent)"` : ""} data-status="${s}" data-id="${p.id_pedido}">${rotulo}</button>`
        )}</div></td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="7" class="estado-vazio">Nenhum pedido encontrado.</td></tr>`.toString();
}

$("#pedidosBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-status]");
  if (!b) return;
  const status = b.dataset.status;
  if (status === "CANCELADO" && !(await confirmar("Cancelar este pedido? Os itens voltam para o estoque.", { titulo: "Cancelar pedido", confirmar: "Cancelar pedido", perigo: true }))) return;
  await comCarregamento(b, async () => {
    try {
      const { pedido } = await patch(`/admin/pedidos/${b.dataset.id}/status`, { status });
      pedidos = pedidos.map((p) => (p.id_pedido === pedido.id_pedido ? pedido : p));
      render();
      toast(`Pedido #${pedido.id_pedido}: ${STATUS_PEDIDO[pedido.status].rotulo.toLowerCase()}.`, "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "...");
});

filtros.addEventListener("submit", (e) => e.preventDefault());
filtros.addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});

carregar();
