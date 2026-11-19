// Catálogo: serviços, cortes e produtos numa página só, com filtro por tipo e busca.
import { get, put, del } from "../api.js";
import { $, $$, html, toast, comCarregamento } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { adicionarAoCarrinho } from "../carrinho.js";
import { cartaoCorte, cartaoServico, cartaoProduto, aplicarPlaceholders } from "../cartoes.js";

const TIPOS = ["todos", "servicos", "cortes", "produtos"];
let usuario = null;
let dados = { servicos: [], cortes: [], produtos: [] };
let tipo = TIPOS.includes(new URLSearchParams(location.search).get("tipo")) ? new URLSearchParams(location.search).get("tipo") : "todos";
let busca = "";

const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const combina = (...campos) => !busca || campos.some((c) => normalizar(c).includes(busca));

const cartaoServicoLink = (s) => cartaoServico(s, { acao: "link" });

function grupo(titulo, classeGrade, itens, cartao, vazio) {
  return html`
    <section style="margin-bottom:48px;" aria-label="${titulo}">
      ${tipo === "todos" ? html`<h2 style="font-size:1.25rem;margin-bottom:16px;">${titulo} <span class="text-muted" style="font-size:0.9rem;font-weight:400;">(${itens.length})</span></h2>` : ""}
      ${itens.length ? html`<div class="${classeGrade}">${itens.map(cartao)}</div>` : html`<p class="estado-vazio">${vazio}</p>`}
    </section>`;
}

function render() {
  const servicos = dados.servicos.filter((s) => combina(s.nome_servico, s.descricao));
  const cortes = dados.cortes.filter((c) => combina(c.nome_corte));
  const produtos = dados.produtos.filter((p) => combina(p.nome_produto, p.descricao, p.categoria));

  $("#qtdTodos").textContent = String(servicos.length + cortes.length + produtos.length);
  $("#qtdServicos").textContent = String(servicos.length);
  $("#qtdCortes").textContent = String(cortes.length);
  $("#qtdProdutos").textContent = String(produtos.length);
  $$(".filter-bar .chip").forEach((c) => { c.setAttribute("aria-pressed", String(c.dataset.tipo === tipo)); c.classList.toggle("active", c.dataset.tipo === tipo); });

  const vazio = busca ? "Nada encontrado com essa busca." : "Nada cadastrado por enquanto.";
  const partes = [];
  if (tipo === "todos" || tipo === "servicos") partes.push(grupo("Serviços", "servicos-grid", servicos, cartaoServicoLink, vazio));
  if (tipo === "todos" || tipo === "cortes") partes.push(grupo("Cortes", "cortes-grid", cortes, cartaoCorte, vazio));
  if (tipo === "todos" || tipo === "produtos") partes.push(grupo("Produtos", "produtos-grid", produtos, cartaoProduto, vazio));
  $("#catalogo").innerHTML = partes.join("");
  aplicarPlaceholders($("#catalogo"));
}

$(".filter-bar").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  tipo = chip.dataset.tipo;
  const url = new URL(location.href);
  if (tipo === "todos") url.searchParams.delete("tipo");
  else url.searchParams.set("tipo", tipo);
  history.replaceState(null, "", url);
  render();
});

let temporizador;
$("#buscaCatalogo").addEventListener("input", (e) => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    busca = normalizar(e.target.value.trim());
    render();
  }, 150);
});

$("#catalogo").addEventListener("click", async (e) => {
  const produto = e.target.closest("[data-produto]");
  const fav = e.target.closest("[data-favorito]");
  if (produto) {
    await comCarregamento(produto, async () => {
      try {
        await adicionarAoCarrinho(produto.dataset.produto);
      } catch (err) {
        toast(err.message, "erro");
      }
    }, "Adicionando...");
  } else if (fav) {
    if (!usuario) {
      toast("Entre na sua conta para salvar cortes favoritos.", "info");
      location.href = `login.html?voltar=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    const corte = dados.cortes.find((c) => String(c.id_corte) === fav.dataset.favorito);
    fav.disabled = true;
    try {
      if (corte.favorito) await del(`/me/favoritos/${corte.id_corte}`);
      else await put(`/me/favoritos/${corte.id_corte}`);
      corte.favorito = !corte.favorito;
      render();
      toast(corte.favorito ? "Corte salvo nos seus favoritos." : "Corte removido dos favoritos.", "sucesso");
    } catch (err) {
      fav.disabled = false;
      toast(err.message, "erro");
    }
  }
});

const [vitrine, srv, gal, prd] = await Promise.allSettled([iniciarVitrine(), get("/servicos"), get("/galeria"), get("/produtos")]);
if (vitrine.status === "fulfilled") usuario = vitrine.value.usuario;
dados = {
  servicos: srv.status === "fulfilled" ? srv.value.servicos : [],
  cortes: gal.status === "fulfilled" ? gal.value.cortes : [],
  produtos: prd.status === "fulfilled" ? prd.value.produtos : [],
};
if ([srv, gal, prd].some((r) => r.status === "rejected")) toast("Parte do catálogo não pôde ser carregada. Atualize a página.", "aviso");
render();
