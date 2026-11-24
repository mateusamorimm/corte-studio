// Auditoria (somente leitura).
import { get } from "../api.js";
import { $, html, dataHora } from "../ui.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN"]);
const filtros = $("#filtros");
let pagina = 1;
let temporizador;

const detalhe = (l) => {
  const partes = Object.entries(l.detalhes ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  if (l.entidade) partes.unshift(`${l.entidade}${l.id_entidade ? ` nº ${l.id_entidade}` : ""}`);
  return partes.join(" · ") || "—";
};

async function carregar() {
  const q = new URLSearchParams({ pagina: String(pagina) });
  if (filtros.acao.value) q.set("acao", filtros.acao.value);
  if (filtros.busca.value.trim()) q.set("busca", filtros.busca.value.trim());
  try {
    const r = await get(`/admin/logs?${q}`);
    if (filtros.acao.options.length === 1) {
      filtros.acao.insertAdjacentHTML("beforeend", r.acoes.map((a) => html`<option value="${a}">${a}</option>`).join(""));
    }
    $("#logsBody").innerHTML = r.logs.length
      ? r.logs
          .map(
            (l) => html`<tr>
          <td style="white-space:nowrap">${dataHora(l.data)}</td>
          <td><span class="badge">${l.acao}</span></td>
          <td>${l.autor?.nome_completo ?? (l.acao.endsWith("automatica") ? "Sistema" : "—")}</td>
          <td>${l.autor?.email ?? "—"}</td>
          <td class="celula-texto"><small>${detalhe(l)}</small></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="5" class="estado-vazio">Nenhum registro.</td></tr>`.toString();
    $("#paginaInfo").textContent = `Página ${pagina} de ${r.paginas}`;
    $("#btnAnterior").disabled = pagina <= 1;
    $("#btnProxima").disabled = pagina >= r.paginas;
  } catch (err) {
    $("#logsBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}
$("#btnAnterior").addEventListener("click", () => {
  pagina -= 1;
  carregar();
});
$("#btnProxima").addEventListener("click", () => {
  pagina += 1;
  carregar();
});
filtros.addEventListener("submit", (e) => e.preventDefault());
filtros.addEventListener("input", () => {
  pagina = 1;
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});
carregar();
