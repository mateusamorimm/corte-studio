// Todas as avaliações públicas: resumo (média e distribuição), filtro por nota e paginação.
import { get } from "../api.js";
import { $, $$, html, estrelas, avatar, tempoRelativo, comCarregamento, toast } from "../ui.js";

// Cartão detalhado (layout da página de comentários do colega)
const cartao = (a) => html`
  <article class="comentario-detail">
    <div class="header-row">
      ${avatar({ nome_completo: a.cliente, avatar_url: a.avatar_url })}
      <div>
        <div style="font-weight:600">${a.cliente}</div>
        <div class="text-muted" style="font-size:0.8rem">${tempoRelativo(a.data_avaliacao)}</div>
      </div>
    </div>
    <div><span class="alvo-badge">Serviço: ${a.servico}</span> <span class="alvo-badge">Profissional: ${a.profissional}</span></div>
    <div class="stars-gold" aria-label="Nota ${a.nota} de 5">${estrelas(a.nota)}</div>
    <p>${a.comentario || "Avaliou o atendimento."}</p>
  </article>`;
import { iniciarVitrine } from "../vitrine.js";

const POR_PAGINA = 12;
let nota = "";
let pagina = 1;
let paginas = 1;

function renderResumo(r) {
  if (!r.total) return;
  $("#resumo").hidden = false;
  const media = Number(r.media);
  $("#media").textContent = media.toFixed(1).replace(".", ",");
  $("#mediaEstrelas").textContent = estrelas(Math.round(media));
  $("#totalAvaliacoes").textContent = `${r.total} ${r.total === 1 ? "avaliação" : "avaliações"}`;
  $("#distribuicao").innerHTML = [5, 4, 3, 2, 1]
    .map((n) => {
      const qtd = r.distribuicao[n] ?? 0;
      const pct = r.total ? Math.round((qtd / r.total) * 100) : 0;
      return html`
        <div class="dist-linha">
          <span>${n} ★</span>
          <div class="dist-barra" role="img" aria-label="${qtd} avaliações com ${n} estrelas"><span style="width:${pct}%"></span></div>
          <span class="n">${qtd}</span>
        </div>`;
    })
    .join("");
}

async function carregar({ acrescentar = false } = {}) {
  const lista = $("#lista");
  const q = new URLSearchParams({ limite: String(POR_PAGINA), pagina: String(pagina) });
  if (nota) q.set("nota", nota);
  const r = await get(`/avaliacoes?${q}`);
  paginas = r.paginas;
  if (pagina === 1) renderResumo(r);
  const cartoes = r.avaliacoes.map(cartao).join("");
  if (acrescentar) lista.insertAdjacentHTML("beforeend", cartoes);
  else {
    lista.innerHTML =
      cartoes ||
      html`<p class="estado-vazio">${
        r.total ? "Nenhuma avaliação com essa nota." : "Ainda não há avaliações. Depois do seu atendimento, avalie pelo seu perfil."
      }</p>`.toString();
  }
  $("#btnMais").hidden = pagina >= paginas;
}

$(".filter-bar").addEventListener("click", async (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  nota = chip.dataset.nota;
  pagina = 1;
  $$(".filter-bar .chip").forEach((c) => { c.setAttribute("aria-pressed", String(c === chip)); c.classList.toggle("active", c === chip); });
  try {
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

$("#btnMais").addEventListener("click", (e) =>
  comCarregamento(e.currentTarget, async () => {
    pagina += 1;
    try {
      await carregar({ acrescentar: true });
    } catch (err) {
      pagina -= 1;
      toast(err.message, "erro");
    }
  }, "Carregando...")
);

iniciarVitrine();
try {
  await carregar();
} catch {
  $("#lista").innerHTML = html`<p class="estado-vazio">Não foi possível carregar as avaliações.</p>`.toString();
}
