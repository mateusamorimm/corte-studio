// Página inicial: conteúdo vindo do banco (configuração, galeria, serviços, produtos, avaliações)
// e agendamento real com horários livres calculados pelo servidor.
import { get, post, put, del } from "../api.js";
import {
  $,
  html,
  raw,
  urlSegura,
  moeda,
  telefoneFormatado,
  cartaoAvaliacao,
  abrirModal,
  toast,
  alertaForm,
  comCarregamento,
  hojeIso,
  hora,
  dataCurta,
} from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { adicionarAoCarrinho } from "../carrinho.js";
import { linksMapa } from "../contatos.js";
import { cartaoCorte, cartaoServico, cartaoProduto, precoServico, aplicarPlaceholders } from "../cartoes.js";

// Modal de agendamento (layout do colega): botões com data-abrir-agendamento abrem o formulário
function abrirAgendamento() {
  const dlg = document.getElementById("modalAgendar");
  if (!dlg.open) abrirModal(dlg);
}
document.addEventListener("click", (e) => {
  const gatilho = e.target.closest("[data-abrir-agendamento]");
  if (!gatilho) return;
  e.preventDefault();
  abrirAgendamento();
});

const TITULO_PADRAO = "Seu próximo corte, pensado antes de sentar na cadeira.";
const RASCUNHO = "sc_rascunho_agendamento"; // seleção do formulário guardada só nesta aba, até o login

let usuario = null;
let config = null;

function irParaLogin() {
  location.href = `login.html?voltar=${encodeURIComponent("/index.html#agendar")}`;
}

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
  grid.innerHTML = cortes.slice(0, 8).map(cartaoCorte).join("");
}

$("#cortesGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-favorito]");
  if (!btn) return;
  if (!usuario) {
    toast("Entre na sua conta para salvar cortes favoritos.", "info");
    location.href = `login.html?voltar=${encodeURIComponent("/index.html#cortes")}`;
    return;
  }
  const id = Number(btn.dataset.favorito);
  const corte = cortes.find((c) => c.id_corte === id);
  btn.disabled = true;
  try {
    if (corte.favorito) await del(`/me/favoritos/${id}`);
    else await put(`/me/favoritos/${id}`);
    corte.favorito = !corte.favorito;
    renderCortes();
    toast(corte.favorito ? "Corte salvo nos seus favoritos." : "Corte removido dos favoritos.", "sucesso");
  } catch (err) {
    btn.disabled = false;
    toast(err.message, "erro");
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
$("#servicosGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-agendar-servico]");
  if (!btn) return;
  selServico.value = btn.dataset.agendarServico;
  abrirAgendamento();
  await carregarProfissionais();
  carregarHorarios();
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
  $("#produtosGrid").innerHTML = produtos.slice(0, 8).map(cartaoProduto).join("");
  aplicarPlaceholders($("#produtosGrid"));
}

$("#produtosGrid").addEventListener("click", async (e) => {
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

// ───────── Agendamento ─────────
const form = $("#formAgendamento");
const alerta = $("#agAlerta");
const selServico = $("#agServico");
const selProf = $("#agProfissional");
const inpData = $("#agData");
const selHorario = $("#agHorario");

function preencherServicos() {
  selServico.innerHTML = html`<option value="">Selecione...</option>${servicos.map(
    (s) => html`<option value="${s.id_servico}">${s.nome_servico} — ${precoServico(s)} · ${s.duracao_minutos} min</option>`
  )}`.toString();
}

async function carregarProfissionais() {
  const atual = selProf.value;
  const q = selServico.value ? `?servico=${selServico.value}` : "";
  try {
    const { profissionais } = await get(`/profissionais${q}`);
    selProf.innerHTML = html`<option value="">Qualquer profissional disponível</option>${profissionais.map(
      (p) => html`<option value="${p.id_usuario}">${p.nome_completo}</option>`
    )}`.toString();
    if (profissionais.some((p) => String(p.id_usuario) === atual)) selProf.value = atual;
  } catch {
    /* mantém a lista anterior */
  }
}

let pedidoHorarios = 0;
async function carregarHorarios(manter = null) {
  const id = ++pedidoHorarios;
  if (!selServico.value || !inpData.value) {
    selHorario.innerHTML = '<option value="">Escolha serviço e data</option>';
    selHorario.disabled = true;
    return;
  }
  selHorario.disabled = true;
  selHorario.innerHTML = '<option value="">Buscando horários...</option>';
  try {
    const q = new URLSearchParams({ servico: selServico.value, data: inpData.value, profissional: selProf.value });
    const r = await get(`/agenda/horarios?${q}`);
    if (id !== pedidoHorarios) return; // resposta antiga
    if (!r.horarios.length) {
      selHorario.innerHTML = html`<option value="">${r.aviso ?? "Sem horários livres nesse dia"}</option>`.toString();
      return;
    }
    selHorario.innerHTML = html`<option value="">Selecione...</option>${r.horarios.map(
      (h) => html`<option value="${h.inicio}">${hora(h.inicio)}${selProf.value ? "" : ` · ${h.profissionais.length} profissional(is)`}</option>`
    )}`.toString();
    selHorario.disabled = false;
    if (manter && r.horarios.some((h) => h.inicio === manter)) selHorario.value = manter;
  } catch (err) {
    if (id !== pedidoHorarios) return;
    selHorario.innerHTML = html`<option value="">${err.message}</option>`.toString();
  }
}

selServico.addEventListener("change", async () => {
  await carregarProfissionais();
  carregarHorarios();
});
selProf.addEventListener("change", () => carregarHorarios());
inpData.addEventListener("change", () => carregarHorarios());

function guardarRascunho() {
  try {
    sessionStorage.setItem(
      RASCUNHO,
      JSON.stringify({ id_servico: selServico.value, id_barbeiro: selProf.value, data: inpData.value, inicio: selHorario.value, observacao: $("#agMsg").value })
    );
  } catch {
    /* armazenamento indisponível: segue sem rascunho */
  }
}

async function restaurarRascunho() {
  let r = null;
  try {
    r = JSON.parse(sessionStorage.getItem(RASCUNHO) || "null");
    sessionStorage.removeItem(RASCUNHO);
  } catch {
    return false;
  }
  if (!r) return false;
  if (r.id_servico && servicos.some((s) => String(s.id_servico) === r.id_servico)) selServico.value = r.id_servico;
  await carregarProfissionais();
  if (r.id_barbeiro) selProf.value = r.id_barbeiro;
  if (r.data && r.data >= inpData.min) inpData.value = r.data;
  if (r.observacao) $("#agMsg").value = r.observacao;
  await carregarHorarios(r.inicio);
  return true;
}

function montarFormularioAgendamento() {
  inpData.min = hojeIso();
  const janela = config?.janela_agendamento_dias ?? 30;
  const max = new Date(`${inpData.min}T12:00:00`);
  max.setDate(max.getDate() + janela);
  inpData.max = max.toLocaleDateString("en-CA");

  if (usuario) {
    $("#agNome").value = usuario.nome_completo;
    $("#agTel").value = telefoneFormatado(usuario.telefone ?? "");
    $("#agEmail").value = usuario.email ?? "";
    $("#agRodape").innerHTML = html`Acompanhe e cancele seus horários em <a href="perfil.html#agendamentos" style="color:var(--accent);">Meu perfil</a>.`.toString();
  } else {
    $("#agDadosCliente").hidden = true;
    alertaForm(alerta, "Escolha o serviço e o horário. Para confirmar, entre ou crie sua conta — leva menos de 1 minuto.", "info");
    $("#agEnviar").textContent = "Entrar para agendar";
    $("#agRodape").innerHTML = html`Ainda não tem conta? <a href="cadastro.html?voltar=%2Findex.html%23agendar" style="color:var(--accent);">Cadastre-se</a> para agendar, salvar favoritos e histórico.`.toString();
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!usuario) {
    guardarRascunho();
    irParaLogin();
    return;
  }
  alertaForm(alerta, null);
  if (!selServico.value) return alertaForm(alerta, "Selecione o serviço desejado.");
  if (!inpData.value) return alertaForm(alerta, "Escolha a data.");
  if (!selHorario.value) return alertaForm(alerta, "Escolha um horário livre.");

  await comCarregamento($("#agEnviar"), async () => {
    try {
      const { agendamento } = await post("/me/agendamentos", {
        id_servico: Number(selServico.value),
        id_barbeiro: selProf.value ? Number(selProf.value) : null,
        inicio: selHorario.value,
        observacao: $("#agMsg").value,
      });
      $("#agSucessoTexto").textContent = `${agendamento.servico.nome_servico} com ${agendamento.barbeiro.nome_completo} em ${dataCurta(
        agendamento.data_hora_inicio
      )} às ${hora(agendamento.data_hora_inicio)}. O salão vai confirmar o horário em breve.`;
      form.hidden = true;
      $("#agSucesso").hidden = false;
    } catch (err) {
      alertaForm(alerta, err.message);
      if (err.status === 409) carregarHorarios();
    }
  }, "Enviando...");
});

$("#agNovo").addEventListener("click", () => {
  form.reset();
  montarFormularioAgendamento();
  carregarHorarios();
  $("#agSucesso").hidden = true;
  form.hidden = false;
});

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

  preencherServicos();
  montarFormularioAgendamento();
  // Vindo do catálogo (index.html?servico=ID#agendar): já deixa o serviço escolhido
  const servicoPedido = new URLSearchParams(location.search).get("servico");
  if (servicoPedido && servicos.some((s) => String(s.id_servico) === servicoPedido)) selServico.value = servicoPedido;
  await carregarProfissionais();
  const rascunhoRestaurado = usuario ? await restaurarRascunho() : false;
  if (servicoPedido) carregarHorarios();
  if ([gal, srv, prd].some((r) => r.status === "rejected")) {
    toast("Parte do conteúdo não pôde ser carregada. Atualize a página.", "aviso");
  }
  // Rolagem para a âncora depois que o conteúdo dinâmico foi montado
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  // Vindo do catálogo (?servico=) ou voltando do login com um rascunho: já abre o agendamento
  if (servicoPedido || (usuario && rascunhoRestaurado)) abrirAgendamento();
})();
