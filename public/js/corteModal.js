// Detalhe do corte: a foto é sempre o padrão. O 3D só aparece quando o profissional adicionou um modelo,
// e o visualizador (servido por nós) só é baixado quando a pessoa pede para ver.
import { $, html, raw, urlSegura, moeda, abrirModal, toast } from "./ui.js";
import { rotuloArea } from "./cartoes.js";

let dlg = null;
let corte = null;
let aoEscolher = null;

function montar() {
  dlg = document.createElement("dialog");
  dlg.className = "modal modal-lg";
  dlg.id = "modalCorteDetalhe";
  dlg.setAttribute("aria-labelledby", "corteDetalheTitulo");
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => ($("#corteVisual", dlg).innerHTML = "")); // descarrega o 3D
  dlg.addEventListener("click", (e) => {
    const modo = e.target.closest("[data-modo]");
    if (modo) mostrar(modo.dataset.modo);
    if (e.target.closest("[data-quero]")) {
      dlg.close();
      aoEscolher?.(corte);
    }
  });
}

let carregando = null;
function carregarVisualizador() {
  carregando ??= import("/vendor/model-viewer-4.1.0.min.js").catch((err) => {
    carregando = null;
    throw err;
  });
  return carregando;
}

async function mostrar(modo) {
  const area = $("#corteVisual", dlg);
  dlg.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modo)));
  if (modo === "foto") {
    area.innerHTML = html`<img src="${urlSegura(corte.imagem_url)}" alt="${corte.nome_corte}" data-fallback="corte">`.toString();
    return;
  }
  const url = corte.modelo_3d_url;
  if (/^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/.test(url)) {
    area.innerHTML = html`<iframe src="${`${url}?autostart=1&ui_theme=dark`}" title="Modelo 3D: ${corte.nome_corte}" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe>`.toString();
    return;
  }
  area.innerHTML = '<p class="estado-vazio">Carregando modelo 3D...</p>';
  try {
    await carregarVisualizador();
    if (!dlg.open) return;
    area.innerHTML = html`<model-viewer src="${urlSegura(url)}" alt="Modelo 3D: ${corte.nome_corte}" camera-controls auto-rotate shadow-intensity="1" touch-action="pan-y" poster="${urlSegura(corte.imagem_url)}"></model-viewer>`.toString();
    $("model-viewer", area).addEventListener("error", () => {
      toast("Não foi possível abrir o modelo 3D. Mostrando a foto.", "aviso");
      mostrar("foto");
    });
  } catch {
    toast("Não foi possível abrir o modelo 3D. Mostrando a foto.", "aviso");
    mostrar("foto");
  }
}

// quero(corte): chamado no botão "Quero este corte"
export function abrirCorte(c, { quero = null, media = null } = {}) {
  if (!dlg) montar();
  corte = c;
  aoEscolher = quero;
  const meta = [
    c.duracao_ref_minutos ? `${c.duracao_ref_minutos} min (ref.)` : null,
    c.preco_ref != null ? `A partir de ${moeda(c.preco_ref)}` : null,
  ].filter(Boolean);
  dlg.innerHTML = html`
    <div class="modal-body">
      <div class="corte-detalhe-topo">
        <h3 class="modal-title" id="corteDetalheTitulo">${c.nome_corte} <span class="badge">${rotuloArea(c.area)}</span></h3>
        <button type="button" class="btn btn-ghost btn-sm" data-fechar aria-label="Fechar">Fechar ✕</button>
      </div>
      <div class="corte-visual" id="corteVisual"></div>
      ${c.modelo_3d_url
        ? html`<div class="corte-modos" role="group" aria-label="Como ver o corte">
            <button type="button" class="btn btn-outline btn-sm" data-modo="foto" aria-pressed="true">Ver foto</button>
            <button type="button" class="btn btn-outline btn-sm" data-modo="3d" aria-pressed="false">🧊 Ver modelo 3D</button>
          </div>`
        : ""}
      ${c.descricao ? html`<p class="text-secondary" style="white-space:pre-line">${c.descricao}</p>` : ""}
      ${meta.length ? html`<p class="text-muted" style="font-size:0.9rem;margin-top:8px">${meta.join(" · ")}</p>` : ""}
      ${media ? html`<p style="margin-top:8px"><span class="stars">★</span> ${Number(media.media).toFixed(1).replace(".", ",")} <span class="text-muted">(${media.total})</span></p>` : ""}
      ${c.autor ? html`<p class="text-muted" style="font-size:0.85rem;margin-top:8px">Feito por <a href="${`perfil-publico.html?id=${c.autor.id_usuario}`}" style="color:var(--accent)">${c.autor.nome}</a></p>` : ""}
      <div class="modal-actions">
        ${quero ? html`<button type="button" class="btn btn-primary" data-quero>Quero este corte</button>` : raw("")}
      </div>
    </div>`.toString();
  mostrar("foto");
  abrirModal(dlg);
}
