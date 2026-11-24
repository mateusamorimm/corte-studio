// Redes sociais: redes conhecidas, detecção por link e montagem do endereço (ícones locais, sem rastreadores).
import { html, raw } from "./ui.js";

export const REDES = [
  { id: "instagram", nome: "Instagram", base: "https://instagram.com/", dica: "usuario", ico: "📷", dominios: ["instagram.com"] },
  { id: "facebook", nome: "Facebook", base: "https://facebook.com/", dica: "usuario.ou.pagina", ico: "📘", dominios: ["facebook.com", "fb.com"] },
  { id: "youtube", nome: "YouTube", base: "https://youtube.com/@", dica: "canal", ico: "▶️", dominios: ["youtube.com", "youtu.be"] },
  { id: "tiktok", nome: "TikTok", base: "https://www.tiktok.com/@", dica: "usuario", ico: "🎵", dominios: ["tiktok.com"] },
  { id: "x", nome: "X (Twitter)", base: "https://x.com/", dica: "usuario", ico: "✖️", dominios: ["x.com", "twitter.com"] },
  { id: "linkedin", nome: "LinkedIn", base: "https://linkedin.com/in/", dica: "usuario", ico: "💼", dominios: ["linkedin.com"] },
  { id: "whatsapp", nome: "WhatsApp", base: "https://wa.me/", dica: "5511999990000", ico: "💬", dominios: ["wa.me", "api.whatsapp.com", "whatsapp.com"] },
  { id: "telegram", nome: "Telegram", base: "https://t.me/", dica: "usuario", ico: "✈️", dominios: ["t.me", "telegram.me"] },
  { id: "email", nome: "E-mail", base: "mailto:", dica: "seu@email.com", ico: "✉️", dominios: [] },
  { id: "telefone", nome: "Telefone", base: "tel:+", dica: "5511999990000", ico: "📞", dominios: [] },
  { id: "pinterest", nome: "Pinterest", base: "https://pinterest.com/", dica: "usuario", ico: "📌", dominios: ["pinterest.com"] },
  { id: "threads", nome: "Threads", base: "https://www.threads.net/@", dica: "usuario", ico: "🧵", dominios: ["threads.net", "threads.com"] },
  { id: "kwai", nome: "Kwai", base: "https://www.kwai.com/@", dica: "usuario", ico: "🎬", dominios: ["kwai.com"] },
  { id: "custom", nome: "Outro", base: "", dica: "usuario", ico: "🔗", dominios: [] },
];

export const redePorId = (id) => REDES.find((r) => r.id === id) ?? REDES.at(-1);

const soEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Link colado → { rede, rotulo, url } (ou null se não for um endereço válido)
export function detectarRede(link) {
  let s = String(link ?? "").trim();
  if (!s) return null;
  if (/^mailto:/i.test(s) || soEmail.test(s)) {
    const email = s.replace(/^mailto:/i, "").toLowerCase();
    return soEmail.test(email) ? { rede: "email", rotulo: "E-mail", url: `mailto:${email}` } : null;
  }
  if (/^tel:/i.test(s) || /^\+?[\d\s()-]{10,20}$/.test(s)) {
    const d = s.replace(/\D/g, "");
    return d.length >= 10 ? { rede: "telefone", rotulo: "Telefone", url: `tel:+${d.length <= 11 ? `55${d}` : d}` } : null;
  }
  s = s.replace(/^http:\/\//i, "https://");
  if (!/^https:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes(".")) return null;
    const rede = REDES.find((r) => r.dominios.some((d) => host === d || host.endsWith(`.${d}`)));
    return { rede: rede?.id ?? "custom", rotulo: rede?.nome ?? host, url: u.href };
  } catch {
    return null;
  }
}

// Rede escolhida + usuário → { rede, rotulo, url }
export function montarRede(id, usuario, dominio = "") {
  const r = redePorId(id);
  const nome = String(usuario ?? "").trim().replace(/^@/, "");
  if (!nome) return null;
  if (r.id === "email") return soEmail.test(nome) ? { rede: "email", rotulo: r.nome, url: `mailto:${nome.toLowerCase()}` } : null;
  if (r.id === "whatsapp" || r.id === "telefone") {
    const d = nome.replace(/\D/g, "");
    if (d.length < 10) return null;
    return { rede: r.id, rotulo: r.nome, url: `${r.base}${d.length <= 11 ? `55${d}` : d}` };
  }
  if (r.id === "custom") {
    const dom = String(dominio).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!/^[\w-]+(\.[\w-]+)+$/.test(dom)) return null;
    return { rede: "custom", rotulo: dom.replace(/^www\./, ""), url: `https://${dom}/${encodeURIComponent(nome)}` };
  }
  return { rede: r.id, rotulo: r.nome, url: `${r.base}${encodeURIComponent(nome)}` };
}

// Só esquemas conhecidos viram link
export const linkSeguro = (url) => (/^(https:\/\/|mailto:|tel:)/i.test(String(url ?? "")) ? url : "");

export function chipsRedes(redes) {
  return redes
    .filter((r) => linkSeguro(r.url))
    .map(
      (r) => html`<a class="social-chip" href="${r.url}" ${/^https:/i.test(r.url) ? raw('target="_blank" rel="noopener nofollow"') : ""}><span aria-hidden="true">${redePorId(r.rede).ico}</span> ${r.rotulo}</a>`
    );
}
