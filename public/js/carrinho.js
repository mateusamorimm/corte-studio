// Carrinho em gaveta (botão no cabeçalho + painel lateral), comum às páginas públicas.
// Os dados vêm sempre da API (/api/me/carrinho); nada é guardado no navegador.
// Eventos emitidos em window: "carrinho:atualizado" (detail = carrinho) e "pedido:criado" (detail = pedido).
import { get, post, patch, del } from "./api.js";
import { $, html, raw, moeda, urlSegura, toast, comCarregamento, confirmar } from "./ui.js";

let usuario = null;
let carrinho = { itens: [], total: "0" };
let drawer, overlay, badge, botao;

const ICONE_CARRINHO = raw(
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>'
);
const ICONE_LIXEIRA = raw(
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>'
);

const quantidadeTotal = () => carrinho.itens.reduce((s, i) => s + (i.produto.ativo ? i.quantidade : 0), 0);

function atualizarBadge() {
  if (!badge) return;
  const n = quantidadeTotal();
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.dataset.count = String(n);
  botao.setAttribute("aria-label", n ? `Abrir carrinho: ${n} ${n === 1 ? "item" : "itens"}` : "Abrir carrinho");
}

function definirCarrinho(novo) {
  carrinho = novo;
  atualizarBadge();
  renderizar();
  window.dispatchEvent(new CustomEvent("carrinho:atualizado", { detail: carrinho }));
}

function renderizar() {
  if (!drawer) return;
  const corpo = $(".cart-body", drawer);
  const rodape = $(".cart-footer", drawer);
  const voltar = encodeURIComponent(location.pathname + location.search + location.hash);

  if (!usuario) {
    corpo.innerHTML = html`<div class="cart-empty">
        <p>Entre na sua conta para montar seu carrinho e reservar produtos para retirada no salão.</p>
        <a class="btn btn-primary btn-sm" href="login.html?voltar=${voltar}">Entrar na conta</a>
      </div>`.toString();
    rodape.hidden = true;
    return;
  }
  if (!carrinho.itens.length) {
    corpo.innerHTML = html`<div class="cart-empty">
        <p>Seu carrinho está vazio.</p>
        <a class="btn btn-outline btn-sm" href="catalogo.html?tipo=produtos">Ver produtos</a>
      </div>`.toString();
    rodape.hidden = true;
    return;
  }

  corpo.innerHTML = carrinho.itens
    .map((i) => {
      const p = i.produto;
      const max = Math.min(99, p.quantidade_estoque);
      return html`
      <div class="cart-item">
        <img src="${urlSegura(p.imagem_url, "")}" alt="" loading="lazy" data-fallback="produto">
        <div class="cart-item-info">
          <h4>${p.nome_produto}</h4>
          ${p.ativo
            ? html`<div class="price">${moeda(p.preco)} · subtotal ${moeda(Number(p.preco) * i.quantidade)}</div>`
            : html`<div class="aviso">Produto indisponível. Remova do carrinho.</div>`}
        </div>
        <div class="cart-item-actions">
          <button type="button" class="btn-remove" data-remover="${p.id_produto}" aria-label="Remover ${p.nome_produto} do carrinho">${ICONE_LIXEIRA}</button>
          ${p.ativo
            ? html`<div class="qty-control">
                <button type="button" data-qtd="${p.id_produto}" data-delta="-1" aria-label="Diminuir quantidade de ${p.nome_produto}" ${raw(i.quantidade <= 1 ? "disabled" : "")}>−</button>
                <span aria-live="polite">${i.quantidade}</span>
                <button type="button" data-qtd="${p.id_produto}" data-delta="1" aria-label="Aumentar quantidade de ${p.nome_produto}" ${raw(i.quantidade >= max ? "disabled" : "")}>+</button>
              </div>`
            : ""}
        </div>
      </div>`;
    })
    .join("");
  corpo.querySelectorAll('img[src=""]').forEach((img) => img.dispatchEvent(new Event("error")));

  rodape.hidden = false;
  $(".cart-total-valor", drawer).textContent = moeda(carrinho.total);
}

export function abrirCarrinho() {
  if (!drawer) return;
  drawer.classList.add("open");
  overlay.classList.add("open");
  document.body.classList.add("cart-open");
  drawer.removeAttribute("aria-hidden");
  botao?.setAttribute("aria-expanded", "true");
  $(".cart-fechar", drawer).focus();
}

export function fecharCarrinho() {
  if (!drawer) return;
  drawer.classList.remove("open");
  overlay.classList.remove("open");
  document.body.classList.remove("cart-open");
  drawer.setAttribute("aria-hidden", "true");
  botao?.setAttribute("aria-expanded", "false");
}

// Adiciona um produto (usado pela home e pelo catálogo). Sem login, leva para entrar.
export async function adicionarAoCarrinho(idProduto, { abrir = true } = {}) {
  if (!usuario) {
    toast("Entre na sua conta para adicionar produtos ao carrinho.", "info");
    location.href = `login.html?voltar=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    return;
  }
  definirCarrinho(await post("/me/carrinho", { id_produto: Number(idProduto), quantidade: 1 }));
  toast("Produto adicionado ao carrinho.", "sucesso");
  if (abrir) abrirCarrinho();
}

// Recarrega do servidor (ex.: o perfil alterou o carrinho pela própria seção).
export async function recarregarCarrinho() {
  if (!usuario) return;
  try {
    definirCarrinho(await get("/me/carrinho"));
  } catch {
    /* mantém o estado atual */
  }
}

async function aoClicar(e) {
  const qtd = e.target.closest("[data-qtd]");
  const rem = e.target.closest("[data-remover]");
  const fin = e.target.closest(".cart-finalizar");
  try {
    if (qtd) {
      const item = carrinho.itens.find((i) => String(i.produto.id_produto) === qtd.dataset.qtd);
      qtd.disabled = true;
      definirCarrinho(await patch(`/me/carrinho/${qtd.dataset.qtd}`, { quantidade: item.quantidade + Number(qtd.dataset.delta) }));
    } else if (rem) {
      rem.disabled = true;
      definirCarrinho(await del(`/me/carrinho/${rem.dataset.remover}`));
    } else if (fin) {
      const ok = await confirmar(`Confirmar pedido de ${moeda(carrinho.total)}? Pagamento e retirada no salão.`, {
        titulo: "Finalizar compra",
        confirmar: "Confirmar pedido",
      });
      if (!ok) return;
      await comCarregamento(fin, async () => {
        const { pedido } = await post("/me/pedidos", {});
        definirCarrinho({ itens: [], total: "0" });
        window.dispatchEvent(new CustomEvent("pedido:criado", { detail: pedido }));
        fecharCarrinho();
        toast(`Pedido #${pedido.id_pedido} realizado! Acompanhe em Meu Perfil.`, "sucesso", 6000);
      }, "Finalizando...");
    }
  } catch (err) {
    toast(err.message, "erro");
    await recarregarCarrinho();
  }
}

// Monta o botão no cabeçalho e a gaveta. Chame uma vez por página, com o usuário da sessão (ou null).
export async function iniciarCarrinho(usuarioSessao) {
  usuario = usuarioSessao;
  const acoes = $(".header .nav-actions");
  if (!acoes || $("#cartBtn")) return;

  botao = document.createElement("button");
  botao.type = "button";
  botao.id = "cartBtn";
  botao.className = "cart-btn";
  botao.setAttribute("aria-controls", "cartDrawer");
  botao.setAttribute("aria-expanded", "false");
  botao.innerHTML = html`${ICONE_CARRINHO}<span class="cart-badge" data-count="0">0</span>`.toString();
  acoes.prepend(botao);
  badge = $(".cart-badge", botao);

  overlay = document.createElement("div");
  overlay.className = "cart-overlay";
  drawer = document.createElement("aside");
  drawer.className = "cart-drawer";
  drawer.id = "cartDrawer";
  drawer.setAttribute("aria-label", "Carrinho");
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = html`
    <div class="cart-header">
      <h2>🛍️ Carrinho</h2>
      <button type="button" class="btn btn-ghost btn-icon cart-fechar" aria-label="Fechar carrinho">✕</button>
    </div>
    <div class="cart-body"></div>
    <div class="cart-footer" hidden>
      <div class="cart-total"><span>Total</span><span class="cart-total-valor">R$ 0,00</span></div>
      <small class="form-hint">Pagamento e retirada no salão. Os itens ficam reservados para você.</small>
      <button type="button" class="btn btn-primary cart-finalizar">Finalizar compra</button>
    </div>`.toString();
  document.body.append(overlay, drawer);

  botao.addEventListener("click", abrirCarrinho);
  overlay.addEventListener("click", fecharCarrinho);
  $(".cart-fechar", drawer).addEventListener("click", fecharCarrinho);
  drawer.addEventListener("click", aoClicar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) fecharCarrinho();
  });

  renderizar();
  await recarregarCarrinho();
}
