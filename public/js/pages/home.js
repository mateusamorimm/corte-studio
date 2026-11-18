// Página inicial: conteúdo vindo do banco (configuração, galeria, serviços, produtos, avaliações)
// e agendamento real com horários livres calculados pelo servidor.
import { get, post, put, del } from "../api.js";
import {
  $,
  html,
  raw,
  urlSegura,
  moeda,
  estrelas,
  tempoRelativo,
  telefoneFormatado,
  avatar,
  toast,
  alertaForm,
  comCarregamento,
  hojeIso,
  hora,
  dataCurta,
} from "../ui.js";
import { obterUsuario } from "../sessao.js";

const TITULO_PADRAO = "Seu próximo corte, pensado antes de sentar na cadeira.";
const RASCUNHO = "sc_rascunho_agendamento"; // seleção do formulário guardada só nesta aba, até o login

let usuario = null;
let config = null;

// ───────── Cabeçalho e menu ─────────
const toggle = $("#mobileToggle");
const nav = $("#mainNav");
toggle?.addEventListener("click", () => nav.classList.toggle("open"));
nav?.addEventListener("click", (e) => e.target.closest("a") && nav.classList.remove("open"));

function montarCabecalho() {
  const btnLogin = $("#btnLogin");
  if (!usuario || !btnLogin) return;
  btnLogin.textContent = usuario.nome_completo.split(" ")[0];
  btnLogin.href = usuario.tipo_perfil === "CLIENTE" ? "perfil.html" : "perfil.html";
  if (usuario.tipo_perfil !== "CLIENTE") {
    const painel = document.createElement("a");
    painel.href = usuario.tipo_perfil === "ADMIN" ? "admin/index.html" : "admin/agendamentos.html";
    painel.className = "btn btn-outline btn-sm";
    painel.textContent = "Painel";
    btnLogin.parentNode.insertBefore(painel, btnLogin);
  }
}

function irParaLogin() {
  location.href = `login.html?voltar=${encodeURIComponent("/index.html#agendar")}`;
}

// ───────── Configuração do salão ─────────
function textoInfo(id, valor) {
  const el = $(id);
  if (!el) return;
  el.hidden = !valor;
  el.querySelector("span").textContent = valor ?? "";
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
  $("#nomeSalaoRodape").textContent = c.nome_salao;
  $("#anoAtual").textContent = String(new Date().getFullYear());

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

  const embed = c.url_mapa && /^https:\/\/(www\.)?google\.com\/maps\/embed/.test(c.url_mapa) ? c.url_mapa : null;
  const busca = c.endereco ? encodeURIComponent(c.endereco) : null;
  const linkMapa = embed ? (busca ? `https://www.google.com/maps/search/?api=1&query=${busca}` : null) : c.url_mapa || (busca ? `https://www.google.com/maps/search/?api=1&query=${busca}` : null);
  linkExterno($("#btnMapa"), linkMapa);
  const src = embed || (busca ? `https://maps.google.com/maps?q=${busca}&output=embed` : null);
  if (src) {
    $("#mapa").innerHTML = html`<iframe src="${src}" title="Mapa: ${c.endereco ?? c.nome_salao}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="width:100%;height:100%;border:0;border-radius:inherit;"></iframe>`.toString();
    $("#mapa").style.padding = "0";
    $("#mapa").style.overflow = "hidden";
  }

  // Redes e WhatsApp
  linkExterno($("#linkInstagram"), c.instagram_url);
  linkExterno($("#linkTiktok"), c.tiktok_url);
  const linkWa = wa ? `https://wa.me/${wa}` : null;
  linkExterno($("#linkWhatsapp"), linkWa);
  linkExterno($("#chatFloat"), linkWa);
}

// ───────── Galeria ─────────
let cortes = [];
function renderCortes() {
  const grid = $("#cortesGrid");
  if (!cortes.length) {
    grid.innerHTML = html`<p class="estado-vazio" style="grid-column:1/-1;">Em breve, novos cortes na galeria.</p>`.toString();
    return;
  }
  grid.innerHTML = cortes
    .map(
      (c) => html`
      <article class="corte-card">
        <img src="${urlSegura(c.imagem_url)}" alt="${c.nome_corte}" loading="lazy" data-fallback="corte">
        <button type="button" class="heart ${c.favorito ? "ativo" : ""}" data-favorito="${c.id_corte}"
          aria-pressed="${c.favorito ? "true" : "false"}" aria-label="${c.favorito ? "Remover dos favoritos" : "Salvar nos favoritos"}: ${c.nome_corte}">${c.favorito ? "❤️" : "🤍"}</button>
        <div class="info"><h3>${c.nome_corte}</h3></div>
      </article>`
    )
    .join("");
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
const precoServico = (s) => `${s.preco_a_partir_de ? "A partir de " : ""}${moeda(s.preco)}`;
function renderServicos() {
  const grid = $("#servicosGrid");
  grid.innerHTML = servicos.length
    ? servicos
        .map(
          (s) => html`
      <article class="servico-card">
        <div class="icon">${s.icone || "✂️"}</div>
        <h3>${s.nome_servico}</h3>
        <p>${s.descricao ?? ""}</p>
        <div class="preco">${precoServico(s)}</div>
      </article>`
        )
        .join("")
    : html`<p class="estado-vazio" style="grid-column:1/-1;">Serviços em atualização.</p>`.toString();
}

// ───────── Produtos ─────────
let produtos = [];
function renderProdutos() {
  const secao = $("#produtos");
  if (!produtos.length) {
    secao.style.display = "none";
    return;
  }
  secao.style.display = "block";
  $("#produtosGrid").innerHTML = produtos
    .map((p) => {
      const esgotado = p.quantidade_estoque < 1;
      return html`
      <article class="produto-card">
        <img src="${urlSegura(p.imagem_url, "")}" alt="${p.nome_produto}" loading="lazy" data-fallback="produto">
        <div class="info">
          <h3>${p.nome_produto}</h3>
          <div class="preco">${moeda(p.preco)}</div>
          <button class="btn btn-primary btn-sm" data-produto="${p.id_produto}" ${raw(esgotado ? "disabled" : "")}>${esgotado ? "Esgotado" : "Adicionar"}</button>
        </div>
      </article>`;
    })
    .join("");
  // Produto sem imagem: mostra o placeholder direto
  $("#produtosGrid")
    .querySelectorAll('img[src=""]')
    .forEach((img) => img.dispatchEvent(new Event("error")));
}

$("#produtosGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-produto]");
  if (!btn) return;
  if (!usuario) {
    toast("Faça login para adicionar produtos ao carrinho.", "info");
    location.href = `login.html?voltar=${encodeURIComponent("/index.html#produtos")}`;
    return;
  }
  await comCarregamento(btn, async () => {
    try {
      const carrinho = await post("/me/carrinho", { id_produto: Number(btn.dataset.produto), quantidade: 1 });
      const qtd = carrinho.itens.reduce((s, i) => s + i.quantidade, 0);
      toast(`Produto adicionado ao carrinho (${qtd} ${qtd === 1 ? "item" : "itens"}). Finalize no seu perfil.`, "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Adicionando...");
});

// ───────── Avaliações ─────────
async function carregarAvaliacoes(limite) {
  const grid = $("#comentariosGrid");
  try {
    const { avaliacoes, total } = await get(`/avaliacoes?limite=${limite}`);
    $("#btnVerTodosComentarios").hidden = total <= 3;
    grid.innerHTML = avaliacoes.length
      ? avaliacoes
          .map(
            (a) => html`
        <article class="comentario-card">
          <div class="comentario-header">
            ${avatar({ nome_completo: a.cliente, avatar_url: a.avatar_url })}
            <div>
              <div class="name">${a.cliente}</div>
              <div class="meta">${a.servico} · ${tempoRelativo(a.data_avaliacao)}</div>
            </div>
          </div>
          <div class="stars" aria-label="Nota ${a.nota} de 5">${estrelas(a.nota)}</div>
          <p>${a.comentario || "Avaliou o atendimento."}</p>
        </article>`
          )
          .join("")
      : html`<p class="estado-vazio" style="grid-column:1/-1;">Ainda não há avaliações. Depois do seu atendimento, avalie pelo seu perfil.</p>`.toString();
  } catch {
    grid.innerHTML = html`<p class="estado-vazio" style="grid-column:1/-1;">Não foi possível carregar as avaliações.</p>`.toString();
  }
}

let todosComentarios = false;
$("#btnVerTodosComentarios").addEventListener("click", async (e) => {
  todosComentarios = !todosComentarios;
  await comCarregamento(e.currentTarget, () => carregarAvaliacoes(todosComentarios ? 50 : 3), "Carregando...");
  e.currentTarget.textContent = todosComentarios ? "Ver menos" : "Ver todos os comentários";
});

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
    return;
  }
  if (!r) return;
  if (r.id_servico && servicos.some((s) => String(s.id_servico) === r.id_servico)) selServico.value = r.id_servico;
  await carregarProfissionais();
  if (r.id_barbeiro) selProf.value = r.id_barbeiro;
  if (r.data && r.data >= inpData.min) inpData.value = r.data;
  if (r.observacao) $("#agMsg").value = r.observacao;
  await carregarHorarios(r.inicio);
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
    $("#agRodape").innerHTML = html`Acompanhe e cancele seus horários em <a href="perfil.html#agendamentos" style="color:var(--accent);">Meu Perfil</a>.`.toString();
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
      form.style.display = "none";
      $("#agSucesso").style.display = "block";
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
  $("#agSucesso").style.display = "none";
  form.style.display = "";
});

// ───────── Inicialização ─────────
(async () => {
  const [u, cfg, gal, srv, prd] = await Promise.allSettled([
    obterUsuario(),
    get("/config"),
    get("/galeria"),
    get("/servicos"),
    get("/produtos"),
  ]);
  usuario = u.status === "fulfilled" ? u.value : null;
  montarCabecalho();

  if (cfg.status === "fulfilled") {
    config = cfg.value.config;
    montarConfig();
  }
  cortes = gal.status === "fulfilled" ? gal.value.cortes : [];
  renderCortes();
  servicos = srv.status === "fulfilled" ? srv.value.servicos : [];
  renderServicos();
  produtos = prd.status === "fulfilled" ? prd.value.produtos : [];
  renderProdutos();
  carregarAvaliacoes(3);

  preencherServicos();
  montarFormularioAgendamento();
  await carregarProfissionais();
  if (usuario) await restaurarRascunho();
  if ([cfg, gal, srv, prd].some((r) => r.status === "rejected")) {
    toast("Parte do conteúdo não pôde ser carregada. Atualize a página.", "aviso");
  }
  // Rolagem para a âncora depois que o conteúdo dinâmico foi montado
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
