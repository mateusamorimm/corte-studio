// Página inicial: conteúdo vindo do banco (configuração, galeria, serviços, produtos, avaliações)
// e agendamento real com horários livres calculados pelo servidor.
import { get } from "../api.js";
import { $, html, urlSegura, telefoneFormatado, cartaoAvaliacao, toast, comCarregamento } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { adicionarAoCarrinho } from "../carrinho.js";
import { linksMapa } from "../contatos.js";
import { cartaoCorte, cartaoServico, cartaoProduto, cartaoProfissional, aplicarPlaceholders, alternarFavorito } from "../cartoes.js";
import { iniciarAgendamento, abrirAgendamento, retomarRascunho } from "../agendamento.js";
import { abrirCorte } from "../corteModal.js";

const TITULO_PADRAO = "Seu próximo corte, pensado antes de sentar na cadeira.";
let usuario = null;
let config = null;

// ───────── Configuração do salão ─────────
function textoInfo(id, valor) {
  const el = $(id);
  if (!el) return;
  el.hidden = !valor;
  el.querySelector("[data-valor]").textContent = valor ?? "";
}

function linkExterno(el, url) {
  const seguro = urlSegura(url);
  if (!el) return;
  el.hidden = !seguro;
  if (seguro) el.href = seguro;
}

function montarConfig() {
  const c = config;
  document.title = `${c.nome_salao} — Cortes com precisão • Agende com confiança`;

  // Hero: *palavra* no título vira destaque. O título padrão mantém o desenho original.
  const titulo = (c.hero_titulo || "").trim();
  if (titulo && titulo !== TITULO_PADRAO) {
    const partes = titulo.split(/\*([^*]+)\*/);
    $("#heroTitulo").innerHTML = partes
      .map((p, i) => (i % 2 ? html`<span class="highlight">${p}</span>` : html`${p}`))
      .join("");
  }
  if (c.hero_subtitulo) $("#heroSubtitulo").textContent = c.hero_subtitulo;
  const imgHero = urlSegura(c.hero_imagem_url);
  if (imgHero) $("#heroImagem").innerHTML = html`<img src="${imgHero}" alt="${c.nome_salao}" data-fallback="corte">`.toString();

  // Onde estamos
  textoInfo("#infoEndereco", c.endereco);
  textoInfo("#infoHorario", c.horario_funcionamento_texto);
  textoInfo("#infoTelefone", c.telefone ? telefoneFormatado(c.telefone) : null);
  const wa = c.whatsapp ? c.whatsapp.replace(/\D/g, "") : null;
  textoInfo("#infoWhatsapp", wa ? telefoneFormatado(wa.replace(/^55/, "")) : null);

  const mapa = linksMapa(c);
  linkExterno($("#btnMapa"), mapa.abrir);
  linkExterno($("#btnRota"), mapa.rota);
  if (mapa.embed) {
    $("#mapa").innerHTML = html`<iframe class="is-visible" src="${mapa.embed}" title="Mapa: ${c.endereco ?? c.nome_salao}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`.toString();
    $("#mapa").classList.add("has-map");
  }
}

// ───────── Galeria ─────────
let cortes = [];
function renderCortes() {
  const grid = $("#cortesGrid");
  if (!cortes.length) {
    grid.innerHTML = html`<p class="estado-vazio" style="grid-column:1/-1;">Em breve, novos cortes na galeria.</p>`.toString();
    return;
  }
  grid.innerHTML = cortes.slice(0, 8).map((c) => cartaoCorte(c)).join("");
}

const listas = () => ({ corte: cortes, servico: servicos, produto: produtos });
$("#cortesGrid").addEventListener("click", (e) => {
  const fav = e.target.closest("[data-favorito]");
  const abrir = e.target.closest("[data-corte]");
  if (fav) return alternarFavorito(fav, { usuario, listas: listas(), depois: renderCortes });
  if (abrir) {
    const corte = cortes.find((c) => String(c.id_corte) === abrir.dataset.corte);
    abrirCorte(corte, { quero: (c) => abrirAgendamento({ cortes: [c.id_corte] }) });
  }
});

// ───────── Serviços ─────────
let servicos = [];
function renderServicos() {
  const grid = $("#servicosGrid");
  grid.innerHTML = servicos.length
    ? servicos.slice(0, 6).map((sv) => cartaoServico(sv)).join("")
    : html`<p class="estado-vazio" style="grid-column:1/-1;">Serviços em atualização.</p>`.toString();
}

// "Agendar" num serviço: abre o agendamento com ele escolhido
$("#servicosGrid").addEventListener("click", (e) => {
  const fav = e.target.closest("[data-favorito]");
  if (fav) return alternarFavorito(fav, { usuario, listas: listas(), depois: renderServicos });
  const btn = e.target.closest("[data-agendar-servico]");
  if (btn) abrirAgendamento({ servicos: [Number(btn.dataset.agendarServico)] });
});

// ───────── Produtos ─────────
let produtos = [];
function renderProdutos() {
  const secao = $("#produtos");
  if (!produtos.length) {
    secao.hidden = true;
    return;
  }
  secao.hidden = false;
  $("#produtosGrid").innerHTML = produtos.slice(0, 8).map((p) => cartaoProduto(p)).join("");
  aplicarPlaceholders($("#produtosGrid"));
}

$("#produtosGrid").addEventListener("click", async (e) => {
  const fav = e.target.closest("[data-favorito]");
  if (fav) return alternarFavorito(fav, { usuario, listas: listas(), depois: renderProdutos });
  const btn = e.target.closest("[data-produto]");
  if (!btn) return;
  await comCarregamento(btn, async () => {
    try {
      await adicionarAoCarrinho(btn.dataset.produto);
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Adicionando...");
});

// ───────── Avaliações (as 3 mais recentes; todas em comentarios.html) ─────────
async function carregarAvaliacoes() {
  const grid = $("#comentariosGrid");
  try {
    const { avaliacoes, total } = await get("/avaliacoes?limite=3");
    const botao = $("#btnVerTodosComentarios");
    botao.hidden = total <= 3;
    botao.textContent = `Ver todos os comentários (${total})`;
    grid.innerHTML = avaliacoes.length
      ? avaliacoes.map(cartaoAvaliacao).join("")
      : html`<p class="estado-vazio" style="grid-column:1/-1;">Ainda não há avaliações. Depois do seu atendimento, avalie pelo seu perfil.</p>`.toString();
  } catch {
    grid.innerHTML = html`<p class="estado-vazio" style="grid-column:1/-1;">Não foi possível carregar as avaliações.</p>`.toString();
  }
}

// ───────── Profissionais ─────────
async function carregarProfissionais() {
  try {
    const { profissionais } = await get("/profissionais");
    $("#equipe").hidden = !profissionais.length;
    $("#equipeGrid").innerHTML = profissionais.map(cartaoProfissional).join("");
  } catch {
    $("#equipe").hidden = true;
  }
}

// ───────── Inicialização ─────────
(async () => {
  const [vitrine, gal, srv, prd] = await Promise.allSettled([iniciarVitrine(), get("/galeria"), get("/servicos"), get("/produtos")]);
  if (vitrine.status === "fulfilled") ({ usuario, config } = vitrine.value);
  if (config) montarConfig();

  cortes = gal.status === "fulfilled" ? gal.value.cortes : [];
  renderCortes();
  servicos = srv.status === "fulfilled" ? srv.value.servicos : [];
  renderServicos();
  produtos = prd.status === "fulfilled" ? prd.value.produtos : [];
  renderProdutos();
  carregarAvaliacoes();

  carregarProfissionais();

  iniciarAgendamento({ usuario, config });
  const params = new URLSearchParams(location.search);
  if ([gal, srv, prd].some((r) => r.status === "rejected")) {
    toast("Parte do conteúdo não pôde ser carregada. Atualize a página.", "aviso");
  }
  // Rolagem para a âncora depois que o conteúdo dinâmico foi montado
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  // Vindo do catálogo ou de um perfil (?servico=, ?corte=, ?profissional=): abre o agendamento já preenchido
  const id = (nome) => (/^\d+$/.test(params.get(nome) ?? "") ? Number(params.get(nome)) : null);
  const selecao = {
    ...(id("servico") ? { servicos: [id("servico")] } : {}),
    ...(id("corte") ? { cortes: [id("corte")] } : {}),
    ...(id("profissional") ? { id_barbeiro: id("profissional") } : {}),
  };
  if (Object.keys(selecao).length) abrirAgendamento(selecao);
  else retomarRascunho();
})();
