// Peças comuns da moderação (posts, comentários e avaliações).
import { html } from "../ui.js";

export const SITUACAO = {
  PENDENTE: { rotulo: "AGUARDANDO", classe: "badge-pending" },
  APROVADO: { rotulo: "APROVADO", classe: "badge-success" },
  REJEITADO: { rotulo: "RECUSADO", classe: "badge-accent" },
};

export const denuncias = (lista) =>
  lista.length ? html`<div class="form-alert form-alert-erro" style="margin:6px 0 0">${lista.map((d) => html`<div>⚑ ${d.motivo} <small>— ${d.quem}</small></div>`)}</div>` : "";

// Botões de decisão conforme a situação atual
export const botoes = (item, id, { excluir = true } = {}) => html`<div class="table-actions">
  ${item.status !== "APROVADO" || item.denuncias?.length ? html`<button class="btn btn-ghost btn-sm" data-decidir="APROVADO" data-id="${id}">${item.status === "APROVADO" ? "Manter" : "Aprovar"}</button>` : ""}
  ${item.status !== "REJEITADO" ? html`<button class="btn btn-ghost btn-sm" data-decidir="REJEITADO" data-id="${id}">${item.status === "APROVADO" ? "Tirar do ar" : "Recusar"}</button>` : ""}
  ${excluir ? html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-excluir="${id}">Excluir</button>` : ""}
</div>`;
