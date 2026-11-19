// Perfil do usuário (layout do colega: banner, abas e resumo lateral) — dados sempre da API.
import { get, post, put, del, enviarImagem } from "../api.js";
import {
  $,
  $$,
  html,
  raw,
  urlSegura,
  moeda,
  estrelas,
  avatar,
  toast,
  alertaForm,
  comCarregamento,
  confirmar,
  mostrarErrosCampos,
  limparErrosCampos,
  dataCurta,
  hora,
  telefoneFormatado,
  mesAno,
  badgeStatus,
  STATUS_AGENDAMENTO,
  STATUS_PEDIDO,
  abrirModal,
  ligarSair,
  escolherImagem,
  validarArquivoImagem,
} from "../ui.js";
import { regras, validarForm, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { exigirLogin, sair } from "../sessao.js";
import { iniciarCarrinho } from "../carrinho.js";

let usuario = await exigirLogin();
ligarSair(sair);
if (usuario.tipo_perfil !== "CLIENTE") {
  const link = $("#linkPainel");
  link.hidden = false;
  link.href = usuario.tipo_perfil === "ADMIN" ? "admin/index.html" : "admin/agendamentos.html";
}
$("#mobileToggle")?.addEventListener("click", (e) => {
  const aberto = $("#mainNav").classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", String(aberto));
});

let resumo = null;
let agendamentos = [];
let pedidos = [];
let favoritos = { favoritos: [], enviados: [] };

// ───────── Abas ─────────
const ABAS = ["agendamentos", "favoritos", "historico", "redes", "conta", "dados"];
function abrirAba(nome, { rolar = false } = {}) {
  if (!ABAS.includes(nome)) nome = "agendamentos";
  $$(".perfil-tab").forEach((t) => {
    const ativa = t.dataset.tab === nome;
    t.classList.toggle("active", ativa);
    t.setAttribute("aria-selected", String(ativa));
  });
  $$(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${nome}`));
  if (location.hash !== `#${nome}`) history.replaceState(null, "", `#${nome}`);
  if (rolar) $(".perfil-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
}
$(".perfil-tabs").addEventListener("click", (e) => {
  const aba = e.target.closest("[data-tab]");
  if (aba) abrirAba(aba.dataset.tab);
});
document.addEventListener("click", (e) => {
  const ir = e.target.closest("[data-ir-aba]");
  if (ir) abrirAba(ir.dataset.irAba, { rolar: true });
});
window.addEventListener("hashchange", () => abrirAba(location.hash.slice(1)));

// ───────── Cabeçalho do perfil ─────────
function renderPerfil() {
  const u = usuario;
  const capa = urlSegura(u.capa_url);
  $("#perfilBanner").querySelector("img")?.remove();
  if (capa) $("#perfilBanner").insertAdjacentHTML("afterbegin", html`<img src="${capa}" alt="">`.toString());

  const foto = avatar(u, "perfil-avatar").toString().replace("<img ", '<img id="userAvatar" ').replace("<span ", '<span id="userAvatar" ');
  $("#userAvatar").outerHTML = foto;
  $("#btnRemoverFoto").hidden = !u.avatar_url;

  $("#userNome").textContent = u.nome_completo;
  $("#userMeta").textContent = [u.email, `Cliente desde ${mesAno(u.data_cadastro)}`].filter(Boolean).join(" · ");
  $("#userBio").textContent = u.bio ?? "";
  $("#userBio").hidden = !u.bio;

  const redes = [];
  if (u.instagram) redes.push(html`<a class="social-chip" href="${`https://instagram.com/${u.instagram}`}" target="_blank" rel="noopener">📷 @${u.instagram}</a>`);
  if (u.tiktok) redes.push(html`<a class="social-chip" href="${`https://www.tiktok.com/@${u.tiktok}`}" target="_blank" rel="noopener">🎵 @${u.tiktok}</a>`);
  if (u.whatsapp) redes.push(html`<a class="social-chip" href="${`https://wa.me/${u.whatsapp}`}" target="_blank" rel="noopener">💬 ${telefoneFormatado(u.whatsapp.replace(/^55/, ""))}</a>`);
  $("#socialPublicRow").innerHTML = redes.join("");
  $("#socialPublicRow").hidden = !redes.length;
}

function renderEstatisticas() {
  if (!resumo) return;
  const primeiro = (n) => (n ? n.split(" ")[0] : "—");
  $("#statVisitas").textContent = String(resumo.visitas);
  $("#statFavorito").textContent = resumo.servico_favorito ?? "—";
  $("#statProfissional").textContent = primeiro(resumo.profissional_favorito);
  $("#statMembro").textContent = mesAno(resumo.membro_desde);
  $("#statGasto").textContent = moeda(resumo.total_gasto);
}

// ───────── Favoritos ─────────
function renderFavoritos() {
  const grid = $("#favoritosGrid");
  const cards = [
    ...favoritos.favoritos.map(
      (f) => html`
      <article class="favorito-card">
        <img src="${urlSegura(f.corte.imagem_url)}" alt="${f.corte.nome_corte}" loading="lazy" data-fallback="corte">
        <button type="button" class="heart" data-desfavoritar="${f.corte.id_corte}" aria-label="Remover ${f.corte.nome_corte} dos favoritos">❤️</button>
        <div class="info">
          <strong>${f.corte.nome_corte}</strong>
          <div class="data">Salvo em: ${dataCurta(f.data_favorito)}</div>
        </div>
      </article>`
    ),
    ...favoritos.enviados.map(
      (c) => html`
      <article class="favorito-card">
        <img src="${urlSegura(c.imagem_url)}" alt="${c.nome}" loading="lazy" data-fallback="corte">
        <button type="button" class="heart" data-remover-enviado="${c.id_corte_enviado}" aria-label="Remover a imagem ${c.nome}">❤️</button>
        <div class="info">
          <strong>${c.nome}</strong>
          <div class="data">Enviado em: ${dataCurta(c.data_envio)}</div>
        </div>
      </article>`
    ),
  ];
  grid.innerHTML = cards.length
    ? cards.join("")
    : html`<p class="estado-vazio" style="grid-column:1/-1;">Nenhum corte favorito ainda. Toque no 🤍 na <a href="index.html#cortes" style="color:var(--accent);">galeria</a> ou envie uma imagem de referência.</p>`.toString();
}

$("#favoritosGrid").addEventListener("click", async (e) => {
  const fav = e.target.closest("[data-desfavoritar]");
  const env = e.target.closest("[data-remover-enviado]");
  if (fav) {
    fav.disabled = true;
    try {
      await del(`/me/favoritos/${fav.dataset.desfavoritar}`);
      favoritos.favoritos = favoritos.favoritos.filter((f) => String(f.corte.id_corte) !== fav.dataset.desfavoritar);
      renderFavoritos();
      toast("Corte removido dos favoritos.", "sucesso");
    } catch (err) {
      fav.disabled = false;
      toast(err.message, "erro");
    }
  } else if (env) {
    if (!(await confirmar("Remover esta imagem dos seus favoritos?", { titulo: "Remover imagem", confirmar: "Remover", perigo: true }))) return;
    try {
      await del(`/me/cortes-enviados/${env.dataset.removerEnviado}`);
      favoritos.enviados = favoritos.enviados.filter((c) => String(c.id_corte_enviado) !== env.dataset.removerEnviado);
      renderFavoritos();
      toast("Imagem removida.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }
});

// Enviar imagem de corte
const formCorte = $("#formCorte");
$("#btnEnviarCorte").addEventListener("click", () => {
  formCorte.reset();
  alertaForm($("#alertaCorte"), null);
  abrirModal($("#modalCorte"));
});
formCorte.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaCorte");
  alertaForm(alerta, null);
  const nome = formCorte.nome.value.trim();
  const arquivo = formCorte.arquivo.files[0];
  if (!nome) return alertaForm(alerta, "Dê um nome para o corte.");
  if (!arquivo) return alertaForm(alerta, "Selecione uma imagem.");
  const erroArq = validarArquivoImagem(arquivo);
  if (erroArq) return alertaForm(alerta, erroArq);
  await comCarregamento(formCorte.querySelector("[type=submit]"), async () => {
    try {
      const url = await enviarImagem(arquivo, { finalidade: "REFERENCIA" });
      const { corte } = await post("/me/cortes-enviados", { nome, imagem_url: url });
      favoritos.enviados.unshift(corte);
      renderFavoritos();
      $("#modalCorte").close();
      abrirAba("favoritos");
      toast("Imagem enviada! O profissional poderá vê-la no seu atendimento.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Enviando...");
});

// ───────── Agendamentos ─────────
const futuro = (a) => new Date(a.data_hora_inicio) > new Date();
function renderAgendamentos() {
  const corpo = $("#historicoServicos");
  if (!agendamentos.length) {
    corpo.innerHTML = html`<tr><td colspan="6" class="estado-vazio">Você ainda não tem agendamentos. <a href="index.html#agendar" style="color:var(--accent);">Marque seu horário</a>.</td></tr>`.toString();
    return;
  }
  corpo.innerHTML = agendamentos
    .map((a) => {
      let acao = html`<span class="text-muted">—</span>`;
      if (a.avaliacao) acao = html`<span class="stars" title="${a.avaliacao.comentario ?? ""}">${estrelas(a.avaliacao.nota)}</span>`;
      else if (a.status === "CONCLUIDO") acao = html`<button class="btn btn-outline btn-sm" data-avaliar="${a.id_agendamento}">Avaliar</button>`;
      else if (["PENDENTE", "CONFIRMADO"].includes(a.status) && futuro(a)) {
        acao = html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-cancelar="${a.id_agendamento}">Cancelar</button>`;
      }
      return html`
        <tr>
          <td>${dataCurta(a.data_hora_inicio)} <span class="text-muted">${hora(a.data_hora_inicio)}</span></td>
          <td>${a.servico.nome_servico}</td>
          <td>${a.barbeiro.nome_completo}</td>
          <td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td>
          <td>${acao}</td>
          <td>${moeda(a.preco_registrado)}</td>
        </tr>`;
    })
    .join("");
}

$("#historicoServicos").addEventListener("click", async (e) => {
  const cancelar = e.target.closest("[data-cancelar]");
  const avaliar = e.target.closest("[data-avaliar]");
  if (cancelar) {
    const a = agendamentos.find((x) => String(x.id_agendamento) === cancelar.dataset.cancelar);
    const ok = await confirmar(`Cancelar ${a.servico.nome_servico} em ${dataCurta(a.data_hora_inicio)} às ${hora(a.data_hora_inicio)}?`, {
      titulo: "Cancelar agendamento",
      confirmar: "Cancelar horário",
      perigo: true,
    });
    if (!ok) return;
    try {
      const { agendamento } = await post(`/me/agendamentos/${a.id_agendamento}/cancelar`, {});
      agendamentos = agendamentos.map((x) => (x.id_agendamento === agendamento.id_agendamento ? agendamento : x));
      renderAgendamentos();
      toast("Agendamento cancelado.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  } else if (avaliar) {
    abrirAvaliacao(Number(avaliar.dataset.avaliar));
  }
});

// Avaliação
let notaEscolhida = 5;
let avaliando = null;
const seletor = $("#seletorNota");
function desenharNota() {
  seletor.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        html`<button type="button" role="radio" aria-checked="${n === notaEscolhida ? "true" : "false"}" aria-label="${n} estrela${n > 1 ? "s" : ""}" data-nota="${n}">${n <= notaEscolhida ? "★" : "☆"}</button>`
    )
    .join("");
}
seletor.addEventListener("click", (e) => {
  const b = e.target.closest("[data-nota]");
  if (!b) return;
  notaEscolhida = Number(b.dataset.nota);
  desenharNota();
});
function abrirAvaliacao(id) {
  avaliando = agendamentos.find((a) => a.id_agendamento === id);
  notaEscolhida = 5;
  desenharNota();
  $("#formAvaliar").reset();
  alertaForm($("#alertaAvaliar"), null);
  $("#avaliarResumo").textContent = `${avaliando.servico.nome_servico} com ${avaliando.barbeiro.nome_completo} em ${dataCurta(avaliando.data_hora_inicio)}`;
  abrirModal($("#modalAvaliar"));
}
$("#formAvaliar").addEventListener("submit", async (e) => {
  e.preventDefault();
  await comCarregamento(e.submitter ?? $("#formAvaliar [type=submit]"), async () => {
    try {
      const { avaliacao } = await post(`/me/agendamentos/${avaliando.id_agendamento}/avaliacao`, {
        nota: notaEscolhida,
        comentario: $("#aComentario").value,
      });
      avaliando.avaliacao = avaliacao;
      renderAgendamentos();
      $("#modalAvaliar").close();
      toast("Obrigado pela avaliação!", "sucesso");
    } catch (err) {
      alertaForm($("#alertaAvaliar"), err.message);
    }
  }, "Enviando...");
});

// ───────── Histórico de compras ─────────
function renderPedidos() {
  const corpo = $("#historicoCompras");
  if (!pedidos.length) {
    corpo.innerHTML = html`<tr><td colspan="5" class="estado-vazio">Nenhuma compra ainda.</td></tr>`.toString();
    return;
  }
  corpo.innerHTML = pedidos
    .map(
      (p) => html`
      <tr>
        <td>${dataCurta(p.data_pedido)}</td>
        <td>${p.itens.map((i, idx) => html`${idx ? raw("<br>") : ""}${i.nome_produto_registrado}`)}</td>
        <td>${p.itens.map((i, idx) => html`${idx ? raw("<br>") : ""}${i.quantidade}x`)}</td>
        <td>${moeda(p.valor_total)}</td>
        <td>
          ${badgeStatus(STATUS_PEDIDO, p.status)}
          ${p.status === "PENDENTE" ? html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-cancelar-pedido="${p.id_pedido}">Cancelar</button>` : ""}
        </td>
      </tr>`
    )
    .join("");
}

$("#historicoCompras").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancelar-pedido]");
  if (!b) return;
  if (!(await confirmar("Cancelar este pedido? Os itens voltam para o estoque do salão.", { titulo: "Cancelar pedido", confirmar: "Cancelar pedido", perigo: true }))) return;
  try {
    const { pedido } = await post(`/me/pedidos/${b.dataset.cancelarPedido}/cancelar`, {});
    pedidos = pedidos.map((p) => (p.id_pedido === pedido.id_pedido ? pedido : p));
    renderPedidos();
    toast("Pedido cancelado.", "sucesso");
  } catch (err) {
    toast(err.message, "erro");
  }
});

// Pedido feito pela gaveta do carrinho aparece no histórico
window.addEventListener("pedido:criado", (e) => {
  if (!pedidos.some((p) => p.id_pedido === e.detail.id_pedido)) pedidos.unshift(e.detail);
  renderPedidos();
});

// ───────── Foto e banner ─────────
async function trocarImagem(rota, botao) {
  const arquivo = await escolherImagem();
  if (!arquivo) return;
  const erro = validarArquivoImagem(arquivo);
  if (erro) return toast(erro, "erro");
  await comCarregamento(botao, async () => {
    try {
      const url = await enviarImagem(arquivo, { finalidade: rota === "/me/capa" ? "CAPA" : "AVATAR" });
      ({ usuario } = await put(rota, { url }));
      renderPerfil();
      toast("Imagem atualizada.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Enviando...");
}
$("#btnCapa").addEventListener("click", (e) => trocarImagem("/me/capa", e.currentTarget));
$("#btnFoto").addEventListener("click", (e) => trocarImagem("/me/avatar", e.currentTarget));
$("#btnRemoverFoto").addEventListener("click", async () => {
  try {
    ({ usuario } = await put("/me/avatar", { url: null }));
    renderPerfil();
    toast("Foto removida.", "sucesso");
  } catch (err) {
    toast(err.message, "erro");
  }
});

// ───────── Dados pessoais e redes (o PUT grava o perfil inteiro) ─────────
const formPerfil = $("#formPerfil");
const formRedes = $("#formRedes");
mascaraTelefone(formPerfil.telefone);
mascaraTelefone(formRedes.whatsapp);
mascaraCpf(formPerfil.cpf);
formPerfil.data_nascimento.max = new Date().toISOString().slice(0, 10);

function preencherFormularios() {
  const u = usuario;
  formPerfil.nome_completo.value = u.nome_completo;
  formPerfil.telefone.value = telefoneFormatado(u.telefone ?? "");
  formPerfil.data_nascimento.value = u.data_nascimento ? u.data_nascimento.slice(0, 10) : "";
  formPerfil.cpf.value = u.cpf ? u.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "";
  formPerfil.endereco.value = u.endereco ?? "";
  formPerfil.bio.value = u.bio ?? "";
  formRedes.instagram.value = u.instagram ? `@${u.instagram}` : "";
  formRedes.tiktok.value = u.tiktok ? `@${u.tiktok}` : "";
  formRedes.whatsapp.value = u.whatsapp ? telefoneFormatado(u.whatsapp.replace(/^55/, "")) : "";
  $("#pEmail").value = u.email ?? "";
}

// Monta o perfil completo a partir dos dois formulários (os campos não exibidos vêm do usuário atual)
const dadosPerfil = () => ({
  nome_completo: formPerfil.nome_completo.value,
  telefone: formPerfil.telefone.value,
  data_nascimento: formPerfil.data_nascimento.value,
  cpf: formPerfil.cpf.value,
  endereco: formPerfil.endereco.value,
  bio: formPerfil.bio.value,
  instagram: formRedes.instagram.value,
  tiktok: formRedes.tiktok.value,
  whatsapp: formRedes.whatsapp.value,
});

async function salvarPerfil(form, alerta, mensagem) {
  alertaForm(alerta, null);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      ({ usuario } = await put("/me/perfil", dadosPerfil()));
      renderPerfil();
      preencherFormularios();
      toast(mensagem, "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) {
        mostrarErrosCampos(formPerfil, err.detalhes);
        mostrarErrosCampos(formRedes, err.detalhes);
      } else if (err.detalhes?.campo) mostrarErrosCampos(formPerfil, [{ campo: err.detalhes.campo, mensagem: err.message }]);
    }
  }, "Salvando...");
}

formPerfil.addEventListener("submit", (e) => {
  e.preventDefault();
  const erros = validarForm(formPerfil, {
    nome_completo: regras.nome,
    telefone: (v) => (!v.trim() ? null : regras.telefone(v)),
    cpf: regras.cpfOpcional,
    data_nascimento: regras.dataPassadaOpcional,
  });
  if (mostrarErrosCampos(formPerfil, erros)) return;
  salvarPerfil(formPerfil, $("#alertaPerfil"), "Dados atualizados.");
});

formRedes.addEventListener("submit", (e) => {
  e.preventDefault();
  limparErrosCampos(formRedes);
  const erros = validarForm(formRedes, {
    whatsapp: (v) => (!v.trim() ? null : regras.telefone(v) ? "Informe o WhatsApp com DDD." : null),
  });
  if (mostrarErrosCampos(formRedes, erros)) return;
  salvarPerfil(formRedes, $("#alertaRedes"), "Redes sociais salvas.");
});

// ───────── Conta / senha ─────────
const formSenha = $("#formSenha");
formSenha.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erros = validarForm(formSenha, {
    senha_atual: (v) => (v ? null : "Informe a senha atual."),
    nova_senha: regras.senha,
    confirmar: (v, f) => (v === f.nova_senha.value ? null : "As senhas não conferem."),
  });
  if (mostrarErrosCampos(formSenha, erros)) return;
  await comCarregamento(formSenha.querySelector("[type=submit]"), async () => {
    try {
      await put("/me/senha", { senha_atual: formSenha.senha_atual.value, nova_senha: formSenha.nova_senha.value });
      formSenha.reset();
      preencherFormularios();
      alertaForm($("#alertaSenha"), "Senha alterada. As outras sessões abertas foram encerradas.", "sucesso");
    } catch (err) {
      alertaForm($("#alertaSenha"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(formSenha, err.detalhes);
    }
  }, "Alterando...");
});

// ───────── Carga inicial ─────────
renderPerfil();
preencherFormularios();
abrirAba(location.hash.slice(1));
iniciarCarrinho(usuario);
const [r, ag, pe, fa] = await Promise.allSettled([get("/me/resumo"), get("/me/agendamentos"), get("/me/pedidos"), get("/me/favoritos")]);
if (r.status === "fulfilled") ({ usuario, resumo } = r.value);
if (ag.status === "fulfilled") agendamentos = ag.value.agendamentos;
if (pe.status === "fulfilled") pedidos = pe.value.pedidos;
if (fa.status === "fulfilled") favoritos = fa.value;
renderPerfil();
renderEstatisticas();
renderFavoritos();
renderAgendamentos();
renderPedidos();
if ([r, ag, pe, fa].some((x) => x.status === "rejected")) toast("Parte dos dados não pôde ser carregada. Atualize a página.", "aviso");
