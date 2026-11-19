// Contatos oficiais do salão (balão flutuante + coluna do rodapé), a partir da configuração do banco.
// Só gera links de esquemas conhecidos (https, tel, mailto, wa.me); textos sempre escapados.
import { $, html, raw, urlSegura, telefoneFormatado } from "./ui.js";

const ICONE_CHAT = raw(
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.8.48 3.48 1.32 4.94L2 22l5.2-1.28A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.56 0-3.02-.42-4.28-1.14l-.3-.18-3.16.78.8-3.08-.2-.32A7.94 7.94 0 014 12c0-4.42 3.58-8 8-8s8 3.58 8 8-3.58 8-8 8z"/></svg>'
);

const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");

// Lista de canais públicos a partir da configuração do salão.
export function contatosOficiais(c) {
  const lista = [];
  const wa = soDigitos(c.whatsapp);
  if (wa) lista.push({ ico: "💬", rotulo: "WhatsApp", valor: telefoneFormatado(wa.replace(/^55/, "")), url: `https://wa.me/${wa}` });
  const tel = soDigitos(c.telefone);
  if (tel) lista.push({ ico: "📞", rotulo: "Telefone", valor: telefoneFormatado(tel), url: `tel:+55${tel.replace(/^55/, "")}` });
  const insta = urlSegura(c.instagram_url);
  if (insta) lista.push({ ico: "📷", rotulo: "Instagram", valor: insta.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url: insta });
  const tiktok = urlSegura(c.tiktok_url);
  if (tiktok) lista.push({ ico: "🎵", rotulo: "TikTok", valor: tiktok.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url: tiktok });
  if (c.email_contato && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email_contato)) {
    lista.push({ ico: "✉️", rotulo: "E-mail", valor: c.email_contato, url: `mailto:${c.email_contato}` });
  }
  return lista;
}

const externo = (url) => /^https:/.test(url);

// Balão flutuante: um canal → link direto; vários → abre a lista.
export function montarBalaoContatos(config) {
  document.querySelectorAll(".chat-float:not(.contact-fab .chat-float), .contact-fab").forEach((el) => el.remove());
  const lista = contatosOficiais(config);
  if (!lista.length) return;

  const fab = document.createElement("div");
  fab.className = "contact-fab";
  if (lista.length === 1) {
    const c = lista[0];
    fab.innerHTML = html`<a class="chat-float" href="${c.url}" ${externo(c.url) ? raw('target="_blank" rel="noopener"') : ""} aria-label="${c.rotulo}: ${c.valor}">${ICONE_CHAT}</a>`.toString();
  } else {
    fab.innerHTML = html`
      <div class="contact-fab-panel" id="contactFabPanel" hidden>
        <p class="contact-fab-title">Fale com o salão</p>
        ${lista.map(
          (c) => html`<a class="contato-oficial-item" href="${c.url}" ${externo(c.url) ? raw('target="_blank" rel="noopener"') : ""}>
            <span class="ico" aria-hidden="true">${c.ico}</span><span>${c.rotulo}<small>${c.valor}</small></span></a>`
        )}
      </div>
      <button type="button" class="chat-float" aria-expanded="false" aria-controls="contactFabPanel" aria-label="Contatos do salão">${ICONE_CHAT}</button>`.toString();
    const painel = $("#contactFabPanel", fab);
    const botao = $("button", fab);
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      painel.hidden = !painel.hidden;
      botao.setAttribute("aria-expanded", String(!painel.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!fab.contains(e.target)) {
        painel.hidden = true;
        botao.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !painel.hidden) {
        painel.hidden = true;
        botao.setAttribute("aria-expanded", "false");
        botao.focus();
      }
    });
  }
  document.body.appendChild(fab);
}

// Rodapé em grade: nome, texto e coluna de contatos.
export function montarRodape(config) {
  const nome = $("#rodapeNome");
  if (nome) nome.textContent = config.nome_salao;
  const ano = $("#anoAtual");
  if (ano) ano.textContent = String(new Date().getFullYear());
  const col = $("#rodapeContatos");
  if (col) {
    const lista = contatosOficiais(config);
    col.innerHTML = lista.length
      ? lista
          .map((c) => html`<a href="${c.url}" ${externo(c.url) ? raw('target="_blank" rel="noopener"') : ""}>${c.ico} ${c.valor}</a>`)
          .join("")
      : html`<span class="text-muted">Em breve.</span>`.toString();
  }
  const end = $("#rodapeEndereco");
  if (end) {
    end.textContent = config.endereco ?? "";
    end.hidden = !config.endereco;
  }
}

// Links do Google Maps: abrir o local e iniciar rota até o salão.
export function linksMapa(config) {
  const destino = (config.endereco || "").trim();
  const embed = config.url_mapa && /^https:\/\/(www\.)?google\.com\/maps\/embed/.test(config.url_mapa) ? config.url_mapa : null;
  const busca = destino ? encodeURIComponent(destino) : null;
  return {
    embed: embed || (busca ? `https://maps.google.com/maps?q=${busca}&output=embed` : null),
    abrir: (!embed && urlSegura(config.url_mapa)) || (busca ? `https://www.google.com/maps/search/?api=1&query=${busca}` : null),
    rota: busca ? `https://www.google.com/maps/dir/?api=1&destination=${busca}` : null,
  };
}
