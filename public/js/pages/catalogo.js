// Catálogo: serviços, cortes, profissionais e produtos numa página só, com filtro por tipo, área e busca.
import { get } from "../api.js";
import { $, $$, html, toast, comCarregamento } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { adicionarAoCarrinho } from "../carrinho.js";
import { cartaoCorte, cartaoServico, cartaoProduto, cartaoProfissional, aplicarPlaceholders, alternarFavorito } from "../cartoes.js";
import { iniciarAgendamento, abrirAgendamento, retomarRascunho } from "../agendamento.js";
import { abrirCorte } from "../corteModal.js";

const TIPOS = ["todos", "servicos", "cortes", "profissionais", "produtos"];
const AREAS = ["BARBEARIA", "CABELEIREIRO"];
const params = new URLSearchParams(location.search);
let usuario = null;
let dados = { servicos: [], cortes: [], profissionais: [], produtos: [] };
let medias = { SERVICO: {}, CORTE: {}, PRODUTO: {} };
let tipo = TIPOS.includes(params.get("tipo")) ? params.get("tipo") : "todos";
let area = AREAS.includes(params.get("area")) ? params.get("area") : "";
let so3d = false;
let busca = "";

const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const combina = (...campos) => !busca || campos.some((c) => normalizar(c).includes(busca));

const daArea = (x) => !area || x.area === area || x.area === "AMBOS";

function grupo(titulo, classeGrade, itens, cartao, vazio) {
  return html`
    <section style="margin-bottom:48px;" aria-label="${titulo}">
      ${tipo === "todos" ? html`<h2 style="font-size:1.25rem;margin-bottom:16px;">${titulo} <span class="text-muted" style="font-size:0.9rem;font-weight:400;">(${itens.length})</span></h2>` : ""}
      ${itens.length ? html`<div class="${classeGrade}">${itens.map(cartao)}</div>` : html`<p class="estado-vazio">${vazio}</p>`}
    </section>`;
}

function render() {
  const servicos = dados.servicos.filter((s) => daArea(s) && combina(s.nome_servico, s.descricao));
  const cortes = dados.cortes.filter((c) => daArea(c) && (!so3d || c.modelo_3d_url) && combina(c.nome_corte, c.descricao, c.autor?.nome));
  const profissionais = dados.profissionais.filter((p) => daArea(p) && combina(p.nome_completo, p.bio, ...p.especialidades));
  const produtos = dados.produtos.filter((p) => combina(p.nome_produto, p.descricao, p.categoria));

  $("#qtdTodos").textContent = String(servicos.length + cortes.length + profissionais.length + produtos.length);
  $("#qtdServicos").textContent = String(servicos.length);
  $("#qtdCortes").textContent = String(cortes.length);
  $("#qtdProfissionais").textContent = String(profissionais.length);
  $("#qtdProdutos").textContent = String(produtos.length);
  const marcar = (c, ativo) => { c.setAttribute("aria-pressed", String(ativo)); c.classList.toggle("active", ativo); };
  $$(".filtro-tipo .chip").forEach((c) => marcar(c, c.dataset.tipo === tipo));
  $$(".filtro-area .chip").forEach((c) => marcar(c, c.dataset.area === area));
  $("#filtro3d").hidden = !dados.cortes.some((c) => c.modelo_3d_url); // só existe se algum profissional adicionou 3D

  const vazio = busca ? "Nada encontrado com essa busca." : "Nada cadastrado por enquanto.";
  const partes = [];
  if (tipo === "todos" || tipo === "servicos") partes.push(grupo("Serviços", "servicos-grid", servicos, (s) => cartaoServico(s, { media: medias.SERVICO[s.id_servico] }), vazio));
  if (tipo === "todos" || tipo === "cortes") partes.push(grupo("Cortes", "cortes-grid", cortes, (c) => cartaoCorte(c, medias.CORTE[c.id_corte]), vazio));
  if (tipo === "profissionais" || (tipo === "todos" && profissionais.length)) partes.push(grupo("Profissionais", "prof-grid", profissionais, cartaoProfissional, vazio));
  if (tipo === "todos" || tipo === "produtos") partes.push(grupo("Produtos", "produtos-grid", produtos, (p) => cartaoProduto(p, medias.PRODUTO[p.id_produto]), vazio));
  $("#catalogo").innerHTML = partes.join("");
  aplicarPlaceholders($("#catalogo"));
}

function guardarFiltro(nome, valor) {
  const url = new URL(location.href);
  if (valor) url.searchParams.set(nome, valor);
  else url.searchParams.delete(nome);
  history.replaceState(null, "", url);
  render();
}
$(".filtro-tipo").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  tipo = chip.dataset.tipo;
  guardarFiltro("tipo", tipo === "todos" ? "" : tipo);
});
$(".filtro-area").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  area = chip.dataset.area;
  guardarFiltro("area", area);
});
$("#so3d").addEventListener("change", (e) => {
  so3d = e.target.checked;
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
  const agendar = e.target.closest("[data-agendar-servico]");
  const verCorte = e.target.closest("[data-corte]");
  if (produto) {
    await comCarregamento(produto, async () => {
      try {
        await adicionarAoCarrinho(produto.dataset.produto);
      } catch (err) {
        toast(err.message, "erro");
      }
    }, "Adicionando...");
  } else if (fav) {
    alternarFavorito(fav, { usuario, listas: { corte: dados.cortes, servico: dados.servicos, produto: dados.produtos }, depois: render });
  } else if (agendar) {
    abrirAgendamento({ servicos: [Number(agendar.dataset.agendarServico)] });
  } else if (verCorte) {
    const c = dados.cortes.find((x) => String(x.id_corte) === verCorte.dataset.corte);
    abrirCorte(c, { media: medias.CORTE[c.id_corte], quero: (x) => abrirAgendamento({ cortes: [x.id_corte] }) });
  }
});

const [vitrine, srv, gal, prd, prof, med] = await Promise.allSettled([
  iniciarVitrine(),
  get("/servicos"),
  get("/galeria"),
  get("/produtos"),
  get("/profissionais"),
  get("/avaliacoes/medias"),
]);
if (vitrine.status === "fulfilled") ({ usuario } = vitrine.value);
iniciarAgendamento(vitrine.status === "fulfilled" ? vitrine.value : { usuario: null, config: null });
if (med.status === "fulfilled") medias = med.value.medias;
dados = {
  servicos: srv.status === "fulfilled" ? srv.value.servicos : [],
  cortes: gal.status === "fulfilled" ? gal.value.cortes : [],
  profissionais: prof.status === "fulfilled" ? prof.value.profissionais : [],
  produtos: prd.status === "fulfilled" ? prd.value.produtos : [],
};
if ([srv, gal, prd].some((r) => r.status === "rejected")) toast("Parte do catálogo não pôde ser carregada. Atualize a página.", "aviso");
render();
// Link direto para um corte (?corte=ID)
const corteDireto = dados.cortes.find((c) => String(c.id_corte) === params.get("corte"));
if (corteDireto) abrirCorte(corteDireto, { media: medias.CORTE[corteDireto.id_corte], quero: (x) => abrirAgendamento({ cortes: [x.id_corte] }) });
else retomarRascunho();
