// Cartões de corte, serviço e produto no layout do colega (home e catálogo).
// Todo valor vindo do banco passa pelo html`` (escape) e por urlSegura.
import { html, raw, urlSegura, moeda } from "./ui.js";

export const precoServico = (s) => `${s.preco_a_partir_de ? "A partir de " : ""}${moeda(s.preco)}`;

export const cartaoCorte = (c) => html`
  <article class="corte-card">
    <img src="${urlSegura(c.imagem_url)}" alt="${c.nome_corte}" loading="lazy" data-fallback="corte">
    <button type="button" class="heart" data-favorito="${c.id_corte}" aria-pressed="${c.favorito ? "true" : "false"}"
      aria-label="${c.favorito ? "Remover dos favoritos" : "Salvar nos favoritos"}: ${c.nome_corte}">${c.favorito ? "❤️" : "🤍"}</button>
    <div class="info">
      <h3>${c.nome_corte}</h3>
    </div>
  </article>`;

// acao: "agendar" (botão que abre o agendamento na própria página) ou "link" (vai para a home)
export const cartaoServico = (s, { acao = "agendar" } = {}) => html`
  <article class="servico-card">
    <div class="icon" aria-hidden="true">${s.icone || "✂️"}</div>
    <div class="meta">
      <span class="badge">${s.duracao_minutos} min</span>
      ${s.preco_a_partir_de ? html`<span class="badge">Valor a partir de</span>` : ""}
    </div>
    <h3>${s.nome_servico}</h3>
    <p>${s.descricao ?? ""}</p>
    <div class="preco">${precoServico(s)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${acao === "agendar"
        ? html`<button type="button" class="btn btn-primary btn-sm" data-agendar-servico="${s.id_servico}">Agendar</button>`
        : html`<a class="btn btn-primary btn-sm" href="${`index.html?servico=${s.id_servico}#agendar`}">Agendar</a>`}
    </div>
  </article>`;

export const cartaoProduto = (p) => {
  const disponivel = p.quantidade_estoque > 0;
  return html`
  <article class="produto-card">
    <img src="${urlSegura(p.imagem_url, "")}" alt="${p.nome_produto}" loading="lazy" data-fallback="produto">
    <div class="info">
      <h3>${p.nome_produto}</h3>
      <div class="preco">${moeda(p.preco)}</div>
      <div class="estoque">${disponivel ? `${p.quantidade_estoque} em estoque` : "Esgotado"}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-produto="${p.id_produto}" ${raw(disponivel ? "" : "disabled")}>${disponivel ? "Adicionar" : "Indisponível"}</button>
      </div>
    </div>
  </article>`;
};

// Imagens sem URL: dispara o placeholder (listener global em ui.js)
export function aplicarPlaceholders(raiz) {
  raiz.querySelectorAll('img[src=""]').forEach((img) => img.dispatchEvent(new Event("error")));
}
