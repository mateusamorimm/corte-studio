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

// Valida caminho de retorno (?voltar=) para evitar redirecionamento a outros sites.
export function caminhoInterno(caminho, padrao = "/") {
  if (typeof caminho !== "string" || !caminho.startsWith("/") || caminho.startsWith("//") || caminho.includes("\\")) {
    return padrao;
  }
  return caminho;
}
