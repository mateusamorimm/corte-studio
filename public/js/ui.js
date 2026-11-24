// Utilitários de interface compartilhados por todas as páginas.

// ───────── HTML seguro (proteção contra XSS) ─────────
// Use sempre: el.innerHTML = html`<p>${valorDoBanco}</p>`;
// Todo valor interpolado é escapado. Para inserir HTML já seguro, use outro html`` ou raw().
class HtmlSeguro {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
export const escapeHtml = (v) => String(v ?? "").replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

function converter(v) {
  if (v instanceof HtmlSeguro) return v.s;
  if (Array.isArray(v)) return v.map(converter).join("");
  if (v === null || v === undefined || v === false) return "";
  return escapeHtml(v);
}

export function html(partes, ...valores) {
  return new HtmlSeguro(partes.reduce((acc, parte, i) => acc + parte + (i < valores.length ? converter(valores[i]) : ""), ""));
}

export const raw = (s) => new HtmlSeguro(String(s));

// Aceita apenas URLs http(s) ou caminhos locais em src/href vindos do banco.
export function urlSegura(url, padrao = "") {
  if (!url) return padrao;
  try {
    const u = new URL(url, location.origin);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : padrao;
  } catch {
    return padrao;
  }
}

// ───────── Seletores ─────────
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// ───────── Formatação ─────────
export const FUSO = "America/Sao_Paulo";
const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const moeda = (v) => fmtMoeda.format(Number(v ?? 0));
export const dataCurta = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO });
export const hora = (d) => new Date(d).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
export const dataHora = (d) => `${dataCurta(d)} às ${hora(d)}`;
// Datas sem horário (DATE) chegam como meia-noite UTC: formatar em UTC evita "voltar um dia".
export const dataSemFuso = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" });

export function iniciais(nome = "") {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

export function telefoneFormatado(t) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? "";
}

// Avatar: imagem se houver URL válida; senão, círculo com as iniciais.
export function avatar(usuario, classe = "avatar") {
  const url = urlSegura(usuario?.avatar_url);
  if (url) return html`<img class="${classe}" src="${url}" alt="" loading="lazy">`;
  return html`<span class="${classe} avatar-iniciais" aria-hidden="true">${iniciais(usuario?.nome_completo)}</span>`;
}

// ───────── Feedback ─────────
let containerToasts;
export function toast(mensagem, tipo = "info", duracaoMs = 4500) {
  if (!containerToasts) {
    containerToasts = document.createElement("div");
    containerToasts.className = "toast-container";
    containerToasts.setAttribute("role", "status");
    containerToasts.setAttribute("aria-live", "polite");
    document.body.appendChild(containerToasts);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.textContent = mensagem;
  containerToasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visivel"));
  setTimeout(() => {
    el.classList.remove("visivel");
    setTimeout(() => el.remove(), 300);
  }, duracaoMs);
}

// Caixa de mensagem dentro de um formulário (erro/sucesso), substitui alert().
export function alertaForm(el, mensagem, tipo = "erro") {
  if (!el) return;
  if (!mensagem) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.className = `form-alert form-alert-${tipo}`;
  el.textContent = mensagem;
  el.setAttribute("role", tipo === "erro" ? "alert" : "status");
}

export function limparErrosCampos(form) {
  $$(".is-invalid", form).forEach((i) => {
    i.classList.remove("is-invalid");
    i.removeAttribute("aria-invalid");
  });
  $$(".field-error", form).forEach((e) => e.remove());
}

// erros: [{ campo, mensagem }] — vindos da API (detalhes) ou da validação local.
export function mostrarErrosCampos(form, erros = []) {
  limparErrosCampos(form);
  let primeiro = null;
  for (const { campo, mensagem } of erros) {
    const input = form.elements.namedItem(campo);
    if (!input || !(input instanceof HTMLElement)) continue;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    if (!input.parentElement.querySelector(`.field-error[data-campo="${campo}"]`)) {
      const msg = document.createElement("small");
      msg.className = "field-error";
      msg.dataset.campo = campo;
      msg.textContent = mensagem;
      (input.closest(".input-with-icon") ?? input).insertAdjacentElement("afterend", msg);
    }
    primeiro ??= input;
  }
  primeiro?.focus();
  return erros.length > 0;
}

// Desabilita o botão e mostra indicador de carregamento enquanto a promessa roda.
export async function comCarregamento(botao, fn, textoCarregando = "Aguarde...") {
  if (!botao || botao.disabled) return;
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.setAttribute("aria-busy", "true");
  botao.innerHTML = html`<span class="spinner" aria-hidden="true"></span> ${textoCarregando}`.toString();
  try {
    return await fn();
  } finally {
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
    botao.innerHTML = original;
  }
}

// Diálogo de confirmação acessível (substitui confirm()).
export function confirmar(mensagem, { titulo = "Confirmar", confirmar: rotulo = "Confirmar", perigo = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal modal-sm";
    dlg.innerHTML = html`
      <form method="dialog" class="modal-body">
        <h3 class="modal-title">${titulo}</h3>
        <p class="text-secondary">${mensagem}</p>
        <div class="modal-actions">
          <button value="nao" class="btn btn-outline btn-sm">Cancelar</button>
          <button value="sim" class="btn ${perigo ? "btn-danger" : "btn-primary"} btn-sm">${rotulo}</button>
        </div>
      </form>`.toString();
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "sim");
      dlg.remove();
    });
    dlg.showModal();
  });
}

// ───────── Imagens ─────────
// Imagem quebrada → placeholder (substitui o antigo onerror="..." inline, bloqueado pela CSP).
export const PLACEHOLDER = {
  corte: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#1a1a24"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="22" text-anchor="middle" dominant-baseline="middle">Corte</text></svg>'),
  produto: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#1a1a24"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="22" text-anchor="middle" dominant-baseline="middle">Produto</text></svg>'),
};
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.dataset.fallback && !img.dataset.falhou) {
      img.dataset.falhou = "1";
      img.src = PLACEHOLDER[img.dataset.fallback] ?? PLACEHOLDER.corte;
    }
  },
  true
);

const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/webp"];
// Abre o seletor de arquivo e devolve o File escolhido (ou null).
export function escolherImagem() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = TIPOS_IMAGEM.join(",");
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
export function validarArquivoImagem(arquivo) {
  if (!TIPOS_IMAGEM.includes(arquivo.type)) return "Formato não suportado. Envie JPG, PNG ou WebP.";
  // Fotos grandes são reduzidas no navegador antes do envio (api.js → comprimirImagem)
  if (arquivo.size > 20 * 1024 * 1024) return "Imagem muito grande. Escolha uma foto de até 20 MB.";
  return null;
}

// ───────── Exibição de dados ─────────
export const estrelas = (n) => "★".repeat(n) + "☆".repeat(5 - n);

export const STATUS_AGENDAMENTO = {
  PENDENTE: { rotulo: "PENDENTE", classe: "badge-pending" },
  CONFIRMADO: { rotulo: "CONFIRMADO", classe: "badge-success" },
  CONCLUIDO: { rotulo: "CONCLUÍDO", classe: "badge-info" },
  CANCELADO: { rotulo: "CANCELADO", classe: "badge-accent" },
  NAO_COMPARECEU: { rotulo: "NÃO COMPARECEU", classe: "badge-warning" },
};
export const STATUS_PEDIDO = {
  PENDENTE: { rotulo: "PENDENTE", classe: "badge-pending" },
  PRONTO_PARA_RETIRADA: { rotulo: "PRONTO P/ RETIRADA", classe: "badge-warning" },
  CONCLUIDO: { rotulo: "CONCLUÍDO", classe: "badge-success" },
  CANCELADO: { rotulo: "CANCELADO", classe: "badge-accent" },
};
export const STATUS_RESERVA = {
  ATIVA: { rotulo: "ATIVA", classe: "badge-info" },
  CONCLUIDA: { rotulo: "CONCLUÍDA", classe: "badge-success" },
  CANCELADA: { rotulo: "CANCELADA", classe: "badge-accent" },
  EXPIRADA: { rotulo: "EXPIRADA", classe: "badge-warning" },
};
// "Corte + Barba": todos os serviços de um agendamento
export const nomesServicos = (a) => (a.servicos?.length ? a.servicos.map((s) => s.servico.nome_servico).join(" + ") : a.servico.nome_servico);
export const badgeStatus = (mapa, status) => {
  const s = mapa[status] ?? { rotulo: status, classe: "badge-info" };
  return html`<span class="badge ${s.classe}">${s.rotulo}</span>`;
};

// Cartão de avaliação pública (home e página de avaliações)
export function cartaoAvaliacao(a) {
  return html`
    <article class="comentario-card">
      <div class="comentario-header">
        ${avatar({ nome_completo: a.cliente, avatar_url: a.avatar_url })}
        <div>
          <div class="name">${a.cliente}</div>
          <div class="meta">${a.servico} · ${tempoRelativo(a.data_avaliacao)}</div>
        </div>
      </div>
      <div class="stars" aria-label="Nota ${a.nota} de 5">${estrelas(a.nota)}</div>
      <p>${a.comentario || "Avaliou o atendimento."}</p>
    </article>`;
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function tempoRelativo(d) {
  const seg = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seg);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(seg / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seg / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seg / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(seg / (86400 * 30)), "month");
  return rtf.format(Math.round(seg / (86400 * 365)), "year");
}
export const mesAno = (d) => {
  const s = new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO, month: "short", year: "numeric" }).replace(".", "").replace(" de ", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// Data local de hoje (fuso do salão) no formato AAAA-MM-DD
export const hojeIso = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO });
// Valor de <input type=datetime-local> (horário do salão) → ISO com fuso
export function localParaIso(valor) {
  // O salão usa America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
  return new Date(`${valor}:00-03:00`).toISOString();
}
export function isoParaLocalInput(d) {
  const p = new Date(d).toLocaleString("sv-SE", { timeZone: FUSO }); // "AAAA-MM-DD HH:MM:SS"
  return p.slice(0, 16).replace(" ", "T");
}

// Abre um <dialog> já presente na página; fecha com Esc, botão [data-fechar] ou clique fora.
export function abrirModal(dlg) {
  if (!dlg.dataset.preparado) {
    dlg.dataset.preparado = "1";
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-fechar]")) dlg.close();
    });
  }
  dlg.showModal();
}

// Liga o botão de sair (data-sair) a qualquer página.
export function ligarSair(fn) {
  $$("[data-sair]").forEach((b) => b.addEventListener("click", fn));
}

// Valida caminho de retorno (?voltar=) para evitar redirecionamento a outros sites.
export function caminhoInterno(caminho, padrao = "/") {
  if (typeof caminho !== "string" || !caminho.startsWith("/") || caminho.startsWith("//") || caminho.includes("\\")) {
    return padrao;
  }
  return caminho;
}
