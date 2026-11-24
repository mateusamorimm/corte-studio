// Cartões de corte, serviço e produto no layout do colega (home e catálogo).
// Todo valor vindo do banco passa pelo html`` (escape) e por urlSegura.
import { html, raw, urlSegura, moeda, toast, avatar } from "./ui.js";
import { put, del } from "./api.js";

export const precoServico = (s) => `${s.preco_a_partir_de ? "A partir de " : ""}${moeda(s.preco)}`;

export const AREAS = { BARBEARIA: "Barbearia", CABELEIREIRO: "Cabeleireiro", AMBOS: "Barbearia e cabeleireiro" };
export const rotuloArea = (a) => AREAS[a] ?? "Barbearia";

const notaMedia = (m) =>
  m ? html`<span class="badge" title="${m.total} avaliação(ões)">★ ${Number(m.media).toFixed(1).replace(".", ",")}</span>` : "";

// tipo: "corte" | "servico" | "produto"
const coracao = (tipo, id, nome, ativo) => html`
  <button type="button" class="heart" data-favorito="${id}" data-favorito-tipo="${tipo}" aria-pressed="${ativo ? "true" : "false"}"
    aria-label="${ativo ? "Remover dos favoritos" : "Salvar nos favoritos"}: ${nome}">${ativo ? "❤️" : "🤍"}</button>`;

export const cartaoCorte = (c, media = null) => html`
  <article class="corte-card">
    <button type="button" class="corte-abrir" data-corte="${c.id_corte}" aria-label="Ver detalhes: ${c.nome_corte}">
      <img src="${urlSegura(c.imagem_url)}" alt="${c.nome_corte}" loading="lazy" data-fallback="corte">
    </button>
    ${coracao("corte", c.id_corte, c.nome_corte, c.favorito)}
    ${c.modelo_3d_url ? html`<span class="selo-3d" aria-label="Tem modelo 3D">3D</span>` : ""}
    <div class="info">
      <h3>${c.nome_corte}</h3>
      <div class="corte-meta">${c.area ? html`<span class="badge">${rotuloArea(c.area)}</span>` : ""} ${notaMedia(media)}</div>
    </div>
  </article>`;

// acao: "agendar" (botão que abre o agendamento na própria página) ou "link" (vai para a home)
export const cartaoServico = (s, { acao = "agendar", media = null } = {}) => html`
  <article class="servico-card com-favorito">
    ${coracao("servico", s.id_servico, s.nome_servico, s.favorito)}
    <div class="icon" aria-hidden="true">${s.icone || "✂️"}</div>
    <div class="meta">
      <span class="badge">${s.duracao_minutos} min</span>
      ${s.area && s.area !== "BARBEARIA" ? html`<span class="badge">${rotuloArea(s.area)}</span>` : ""}
      ${s.preco_a_partir_de ? html`<span class="badge">Valor a partir de</span>` : ""}
      ${notaMedia(media)}
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

export const cartaoProduto = (p, media = null) => {
  const disponivel = p.quantidade_estoque > 0;
  return html`
  <article class="produto-card com-favorito">
    ${coracao("produto", p.id_produto, p.nome_produto, p.favorito)}
    <img src="${urlSegura(p.imagem_url, "")}" alt="${p.nome_produto}" loading="lazy" data-fallback="produto">
    <div class="info">
      <h3>${p.nome_produto}</h3>
      <div class="preco">${moeda(p.preco)} ${notaMedia(media)}</div>
      <div class="estoque">${disponivel ? `${p.quantidade_estoque} em estoque` : "Esgotado"}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-produto="${p.id_produto}" ${raw(disponivel ? "" : "disabled")}>${disponivel ? "Adicionar" : "Indisponível"}</button>
      </div>
    </div>
  </article>`;
};

export const cartaoProfissional = (p) => html`
  <a class="prof-card" href="${`perfil-publico.html?id=${p.id_usuario}`}">
    ${avatar(p, "avatar avatar-lg")}
    <div>
      <h3>${p.nome_completo}</h3>
      <div class="corte-meta"><span class="badge">${rotuloArea(p.area)}</span> ${p.avaliacao?.total ? notaMedia(p.avaliacao) : ""}</div>
      <p>${p.especialidades.length ? p.especialidades.slice(0, 3).join(" · ") : (p.bio ?? "")}</p>
    </div>
  </a>`;

const ROTAS_FAVORITO = { corte: "/me/favoritos", servico: "/me/favoritos/servicos", produto: "/me/favoritos/produtos" };
const NOME_FAVORITO = { corte: "Corte", servico: "Serviço", produto: "Produto" };
const CHAVE = { corte: "id_corte", servico: "id_servico", produto: "id_produto" };

// Alterna o favorito do cartão clicado. listas: { corte: [...], servico: [...], produto: [...] }
export async function alternarFavorito(btn, { usuario, listas, depois }) {
  if (!usuario) {
    location.href = `login.html?voltar=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    return;
  }
  const tipo = btn.dataset.favoritoTipo;
  const item = listas[tipo]?.find((x) => String(x[CHAVE[tipo]]) === btn.dataset.favorito);
  if (!item) return;
  btn.disabled = true;
  try {
    const rota = `${ROTAS_FAVORITO[tipo]}/${item[CHAVE[tipo]]}`;
    if (item.favorito) await del(rota);
    else await put(rota);
    item.favorito = !item.favorito;
    toast(item.favorito ? `${NOME_FAVORITO[tipo]} salvo nos seus favoritos.` : `${NOME_FAVORITO[tipo]} removido dos favoritos.`, "sucesso");
    depois();
  } catch (err) {
    btn.disabled = false;
    toast(err.message, "erro");
  }
}

// Imagens sem URL: dispara o placeholder (listener global em ui.js)
export function aplicarPlaceholders(raiz) {
  raiz.querySelectorAll('img[src=""]').forEach((img) => img.dispatchEvent(new Event("error")));
}
