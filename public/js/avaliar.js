// Avaliação por critério (layout do colega): escolha o que avaliar e dê estrelas para cada item.
// O servidor só aceita o que fez parte do atendimento ou da compra concluída.
import { get, post } from "./api.js";
import { $, html, raw, abrirModal, alertaForm, comCarregamento, toast } from "./ui.js";

const GRUPOS = { SALAO: "Estabelecimento", SERVICO: "Serviços", CORTE: "Cortes", PRODUTO: "Produtos", PROFISSIONAL: "Profissionais" };
let dlg, base, id, alvos, notas, depois;

const chave = (a) => `${a.alvo}:${a.id ?? ""}`;

function montar() {
  dlg = document.createElement("dialog");
  dlg.className = "modal modal-lg";
  dlg.setAttribute("aria-labelledby", "avTitulo");
  dlg.innerHTML = `
    <form class="modal-body" novalidate>
      <h3 class="modal-title" id="avTitulo">Avaliar</h3>
      <p class="text-secondary" id="avResumo" style="font-size:0.9rem;margin-bottom:16px"></p>
      <div id="avAlerta" class="form-alert" hidden></div>
      <div class="form-group"><span class="form-label">O que você quer avaliar?</span><div class="av-pick-list" id="avPick"></div></div>
      <div class="form-group"><span class="form-label">Sua nota</span><div class="av-stars-list" id="avStars"></div></div>
      <div class="form-group">
        <label class="form-label" for="avComentario">Comentário (opcional)</label>
        <textarea class="form-textarea" id="avComentario" rows="3" maxlength="1000" placeholder="Conte como foi"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-fechar>Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm">Enviar avaliação</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  $("#avPick", dlg).addEventListener("change", (e) => {
    const k = e.target.value;
    if (e.target.checked) notas.set(k, notas.get(k) ?? 5);
    else notas.delete(k);
    desenharEstrelas();
  });
  $("#avStars", dlg).addEventListener("click", (e) => {
    const b = e.target.closest("[data-nota]");
    if (!b) return;
    const k = b.closest("[data-chave]").dataset.chave;
    notas.set(k, Number(b.dataset.nota));
    desenharEstrelas();
    $(`[data-chave="${CSS.escape(k)}"] [data-nota="${b.dataset.nota}"]`, dlg)?.focus();
  });
  $("form", dlg).addEventListener("submit", enviar);
}

function desenharEstrelas() {
  const escolhidos = alvos.filter((a) => notas.has(chave(a)));
  $("#avStars", dlg).innerHTML = escolhidos.length
    ? escolhidos
        .map((a) => {
          const n = notas.get(chave(a));
          return html`<div class="av-star-row" data-chave="${chave(a)}">
            <div class="lab">${a.nome}<small>${GRUPOS[a.alvo]}</small></div>
            <div class="av-stars-btn" role="group" aria-label="Nota para ${a.nome}">${[1, 2, 3, 4, 5].map(
              (x) => html`<button type="button" data-nota="${x}" class="${x <= n ? "on" : ""}" aria-label="${x} estrela${x > 1 ? "s" : ""}" aria-pressed="${x === n ? "true" : "false"}">★</button>`
            )}</div>
          </div>`;
        })
        .join("")
    : html`<p class="text-muted" style="font-size:0.85rem">Marque acima pelo menos um item.</p>`.toString();
}

async function enviar(e) {
  e.preventDefault();
  const alerta = $("#avAlerta", dlg);
  alertaForm(alerta, null);
  const lista = alvos.filter((a) => notas.has(chave(a))).map((a) => ({ alvo: a.alvo, id: a.id, nota: notas.get(chave(a)) }));
  if (!lista.length) return alertaForm(alerta, "Marque pelo menos um item para avaliar.");
  await comCarregamento($("[type=submit]", dlg), async () => {
    try {
      const r = await post(`/me/${base}/${id}/avaliacao`, { notas: lista, comentario: $("#avComentario", dlg).value });
      dlg.close();
      toast(r.aviso ?? "Obrigado pela avaliação!", "sucesso", 6000);
      depois?.(r.avaliacao);
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Enviando...");
}

// tipo: "agendamentos" | "pedidos"
export async function abrirAvaliacao(tipo, idAlvo, { resumo, aoEnviar }) {
  if (!dlg) montar();
  base = tipo;
  id = idAlvo;
  depois = aoEnviar;
  try {
    ({ alvos } = await get(`/me/${base}/${id}/avaliacao`));
  } catch (err) {
    return toast(err.message, "erro");
  }
  notas = new Map(alvos.map((a) => [chave(a), 5]));
  $("form", dlg).reset();
  alertaForm($("#avAlerta", dlg), null);
  $("#avResumo", dlg).textContent = resumo;
  $("#avPick", dlg).innerHTML = Object.entries(GRUPOS)
    .map(([alvo, titulo]) => {
      const itens = alvos.filter((a) => a.alvo === alvo);
      if (!itens.length) return "";
      return html`<div class="av-pick-group"><h4>${titulo}</h4>${itens.map(
        (a) => html`<label class="av-pick-item"><input type="checkbox" value="${chave(a)}" ${raw("checked")}> ${a.nome}</label>`
      )}</div>`;
    })
    .join("");
  desenharEstrelas();
  abrirModal(dlg);
}
