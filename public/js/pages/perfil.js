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
  nomesServicos,
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
  dataHora,
  badgeStatus,
  STATUS_AGENDAMENTO,
  STATUS_PEDIDO,
  abrirModal,
  ligarSair,
  escolherImagem,
  validarArquivoImagem,
} from "../ui.js";
import { regras, validarForm, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { exigirLogin, sair, destinoPorPerfil } from "../sessao.js";
import { iniciarCarrinho, adicionarAoCarrinho } from "../carrinho.js";
import { precoServico } from "../cartoes.js";
import { abrirAvaliacao } from "../avaliar.js";
import { cartaoPost, ligarPosts, montarCompositor } from "../posts.js";
import { REDES, redePorId, detectarRede, montarRede, chipsRedes } from "../social.js";

let usuario = await exigirLogin();
ligarSair(sair);
if (usuario.tipo_perfil !== "CLIENTE") {
  const link = $("#linkPainel");
  link.hidden = false;
  link.href = destinoPorPerfil(usuario).slice(1);
}
$("#mobileToggle")?.addEventListener("click", (e) => {
  const aberto = $("#mainNav").classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", String(aberto));
});

let resumo = null;
let agendamentos = [];
let pedidos = [];
let favoritos = { favoritos: [], servicos: [], produtos: [], enviados: [] };
let redes = [];
let fidelidade = null;

// ───────── Abas ─────────
const ABAS = ["feed", "favoritos", "agendamentos", "historico", "fidelidade", "redes", "conta", "privacidade", "dados"];
function abrirAba(nome, { rolar = false } = {}) {
  if (!ABAS.includes(nome)) nome = "agendamentos";
  $$(".perfil-tab").forEach((t) => {
    const ativa = t.dataset.tab === nome;
    t.classList.toggle("active", ativa);
    t.setAttribute("aria-selected", String(ativa));
  });
  $$(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${nome}`));
  if (location.hash !== `#${nome}`) history.replaceState(null, "", `#${nome}`);
  if (nome === "feed") carregarPosts();
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

  $("#linkPerfilPublico").href = `perfil-publico.html?id=${u.id_usuario}`;
  $("#statPrivacidade").textContent = u.perfil_publico
    ? "Seu perfil é público, com os dados que você escolheu mostrar."
    : "Seu perfil é privado. Só você e o salão veem os seus dados.";
}

function renderRedes() {
  const linha = $("#socialPublicRow");
  linha.innerHTML = chipsRedes(redes).join("");
  linha.hidden = !redes.length;
  $("#listaRedes").innerHTML = redes.length
    ? redes
        .map(
          (r) => html`<div class="hist-item"><span>${redePorId(r.rede).ico} <strong>${r.rotulo}</strong><br><small class="text-muted">${r.url.replace(/^(https:\/\/|mailto:|tel:)/, "")}</small></span>
          <span style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost btn-sm" data-rede-publica="${r.id_rede}">${r.publico ? "👁️ Pública" : "🔒 Só eu"}</button>
            <button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent)" data-rede-remover="${r.id_rede}">Remover</button>
          </span></div>`
        )
        .join("")
    : html`<p class="text-muted" style="font-size:0.9rem">Nenhuma rede cadastrada.</p>`.toString();
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
          <div class="data"><a href="${`index.html?corte=${f.corte.id_corte}#agendar`}" style="color:var(--accent)">Quero este corte</a></div>
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

function renderFavoritosExtras() {
  $("#favServicos").innerHTML = favoritos.servicos.length
    ? favoritos.servicos
        .map(
          (s) => html`<div class="hist-item"><span>${s.icone ?? "✂️"} <strong>${s.nome_servico}</strong><br><small class="text-muted">${precoServico(s)} · ${s.duracao_minutos} min</small></span>
          <span style="display:flex;gap:6px"><a class="btn btn-primary btn-sm" href="${`index.html?servico=${s.id_servico}#agendar`}">Agendar</a><button type="button" class="btn btn-ghost btn-sm" data-fav-servico="${s.id_servico}" aria-label="Remover ${s.nome_servico} dos favoritos">❤️</button></span></div>`
        )
        .join("")
    : html`<p class="text-muted" style="font-size:0.9rem">Nenhum serviço favorito. Toque no 🤍 no <a href="catalogo.html?tipo=servicos" style="color:var(--accent)">catálogo</a>.</p>`.toString();
  $("#favProdutos").innerHTML = favoritos.produtos.length
    ? favoritos.produtos
        .map(
          (p) => html`<div class="hist-item"><span>🧴 <strong>${p.nome_produto}</strong><br><small class="text-muted">${moeda(p.preco)}${p.quantidade_estoque ? "" : " · esgotado"}</small></span>
          <span style="display:flex;gap:6px"><button type="button" class="btn btn-primary btn-sm" data-comprar="${p.id_produto}" ${raw(p.quantidade_estoque ? "" : "disabled")}>Adicionar</button><button type="button" class="btn btn-ghost btn-sm" data-fav-produto="${p.id_produto}" aria-label="Remover ${p.nome_produto} dos favoritos">❤️</button></span></div>`
        )
        .join("")
    : html`<p class="text-muted" style="font-size:0.9rem">Nenhum produto favorito ainda.</p>`.toString();
}
$("#tab-favoritos").addEventListener("click", async (e) => {
  const srv = e.target.closest("[data-fav-servico]");
  const prd = e.target.closest("[data-fav-produto]");
  const comprar = e.target.closest("[data-comprar]");
  try {
    if (srv) {
      await del(`/me/favoritos/servicos/${srv.dataset.favServico}`);
      favoritos.servicos = favoritos.servicos.filter((s) => String(s.id_servico) !== srv.dataset.favServico);
    } else if (prd) {
      await del(`/me/favoritos/produtos/${prd.dataset.favProduto}`);
      favoritos.produtos = favoritos.produtos.filter((p) => String(p.id_produto) !== prd.dataset.favProduto);
    } else if (comprar) return await adicionarAoCarrinho(comprar.dataset.comprar);
    else return;
    renderFavoritosExtras();
    toast("Removido dos favoritos.", "sucesso");
  } catch (err) {
    toast(err.message, "erro");
  }
});

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
      if (a.avaliacao) acao = html`<span class="stars" title="${a.avaliacao.comentario ?? ""}">${estrelas(a.avaliacao.nota)}</span>${a.avaliacao.status_moderacao === "PENDENTE" ? html`<br><small class="text-muted">em aprovação</small>` : ""}`;
      else if (a.status === "CONCLUIDO") acao = html`<button class="btn btn-outline btn-sm" data-avaliar="${a.id_agendamento}">Avaliar</button>`;
      else if (["PENDENTE", "CONFIRMADO"].includes(a.status) && futuro(a)) {
        acao = html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-cancelar="${a.id_agendamento}">Cancelar</button>`;
      }
      return html`
        <tr>
          <td>${dataCurta(a.data_hora_inicio)} <span class="text-muted">${hora(a.data_hora_inicio)}</span></td>
          <td>${nomesServicos(a)}${a.cortes?.length ? html`<br><small class="text-muted">Ref.: ${a.cortes.map((c) => c.corte.nome_corte).join(", ")}</small>` : ""}${a.reserva ? html`<br><small class="codigo-tag">${a.reserva.codigo}</small>` : ""}</td>
          <td><a href="${`perfil-publico.html?id=${a.barbeiro.id_usuario}`}">${a.barbeiro.nome_completo}</a></td>
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
    const ok = await confirmar(`Cancelar ${nomesServicos(a)} em ${dataCurta(a.data_hora_inicio)} às ${hora(a.data_hora_inicio)}?`, {
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
    const a = agendamentos.find((x) => String(x.id_agendamento) === avaliar.dataset.avaliar);
    abrirAvaliacao("agendamentos", a.id_agendamento, {
      resumo: `${nomesServicos(a)} com ${a.barbeiro.nome_completo} em ${dataCurta(a.data_hora_inicio)}`,
      aoEnviar(av) {
        a.avaliacao = av;
        renderAgendamentos();
      },
    });
  }
});

// ───────── Histórico de compras ─────────
function renderPedidos() {
  const corpo = $("#historicoCompras");
  if (!pedidos.length) {
    corpo.innerHTML = html`<tr><td colspan="6" class="estado-vazio">Nenhuma compra ainda.</td></tr>`.toString();
    return;
  }
  corpo.innerHTML = pedidos
    .map(
      (p) => html`
      <tr>
        <td><span class="codigo-tag">${p.reserva?.codigo ?? `#${p.id_pedido}`}</span></td>
        <td>${dataCurta(p.data_pedido)}${["PENDENTE", "PRONTO_PARA_RETIRADA"].includes(p.status) && p.prazo_retirada ? html`<br><small class="text-muted">retirar até ${dataCurta(p.prazo_retirada)}</small>` : ""}</td>
        <td>${p.itens.map((i, idx) => html`${idx ? raw("<br>") : ""}${i.nome_produto_registrado}`)}</td>
        <td>${p.itens.map((i, idx) => html`${idx ? raw("<br>") : ""}${i.quantidade}x`)}</td>
        <td>${moeda(p.valor_total)}${Number(p.valor_desconto) > 0 ? html`<br><small class="text-muted">desconto ${moeda(p.valor_desconto)}</small>` : ""}</td>
        <td>
          ${badgeStatus(STATUS_PEDIDO, p.status)}
          ${p.motivo_cancelamento ? html`<br><small class="text-muted">${p.motivo_cancelamento}</small>` : ""}
          ${p.avaliacao ? html`<br><span class="stars">${estrelas(p.avaliacao.nota)}</span>` : p.status === "CONCLUIDO" ? html`<button class="btn btn-outline btn-sm" data-avaliar-pedido="${p.id_pedido}">Avaliar</button>` : ""}
          ${p.status === "PENDENTE" ? html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-cancelar-pedido="${p.id_pedido}">Cancelar</button>` : ""}
        </td>
      </tr>`
    )
    .join("");
}

$("#historicoCompras").addEventListener("click", async (e) => {
  const av = e.target.closest("[data-avaliar-pedido]");
  if (av) {
    const p = pedidos.find((x) => String(x.id_pedido) === av.dataset.avaliarPedido);
    return abrirAvaliacao("pedidos", p.id_pedido, {
      resumo: `Compra de ${dataCurta(p.data_pedido)}: ${p.itens.map((i) => i.nome_produto_registrado).join(", ")}`,
      aoEnviar(nova) {
        p.avaliacao = nova;
        renderPedidos();
      },
    });
  }
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

// ───────── Fidelidade ─────────
function renderFidelidade() {
  if (!fidelidade) return;
  const f = fidelidade;
  $("#statNivel").textContent = f.nivel;
  $("#statPontos").textContent = String(f.pontos);
  $("#statDesconto").textContent = f.desconto_ativo ? `${f.desconto_ativo.desconto_percentual}%` : "—";
  const alvo = f.nivel === "Bronze" ? f.niveis.prata : f.niveis.ouro;
  const base = f.nivel === "Bronze" ? 0 : f.niveis.prata;
  const pct = f.nivel === "Ouro" ? 100 : Math.min(100, Math.round(((f.acumulado - base) / (alvo - base)) * 100));
  $("#fidelidadeBox").innerHTML = html`
    <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="text-muted">Seu nível</span><div class="fid-nivel">${{ Bronze: "🥉", Prata: "🥈", Ouro: "🥇" }[f.nivel]} ${f.nivel}</div></div>
      <div><span class="text-muted">Pontos disponíveis</span><div class="fid-nivel">${f.pontos}</div></div>
    </div>
    <div class="fid-barra" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso até o próximo nível"><span style="width:${pct}%"></span></div>
    <p class="text-muted" style="font-size:0.85rem">${f.nivel === "Ouro" ? "Você está no nível mais alto." : `Faltam ${Math.max(0, alvo - f.acumulado)} pontos acumulados para o nível ${f.nivel === "Bronze" ? "Prata" : "Ouro"}.`} Bronze até ${f.niveis.prata - 1}, Prata até ${f.niveis.ouro - 1}, Ouro a partir de ${f.niveis.ouro}.</p>
    <p class="text-secondary" style="font-size:0.9rem;margin-top:12px">Você ganha ${f.pontos_por_real.toLocaleString("pt-BR")} ponto por real em atendimentos e compras concluídos (mínimo de ${f.pontos_minimos_evento} por evento).${f.desconto_ativo ? ` Seu desconto de ${f.desconto_ativo.desconto_percentual}% entra automaticamente no próximo pedido de produtos.` : ""}</p>
    <div class="fid-faixas">${f.recompensas.map(
      (r) => html`<div class="fid-faixa${r.pontos_minimos <= f.pontos ? " ok" : ""}"><span><strong>${r.nome}</strong> · ${r.desconto_percentual}%</span><span class="text-muted">${r.pontos_minimos} pontos${r.consome_pontos ? "" : " (não gasta)"}</span></div>`
    )}</div>`.toString();
  $("#extratoPontos").innerHTML = f.extrato.length
    ? f.extrato
        .map((m) => html`<tr><td>${dataHora(m.data)}</td><td>${m.motivo}</td><td class="${m.pontos > 0 ? "pontos-mais" : "pontos-menos"}">${m.pontos > 0 ? "+" : ""}${m.pontos}</td></tr>`)
        .join("")
    : html`<tr><td colspan="3" class="estado-vazio">Seus pontos aparecem aqui depois do primeiro atendimento ou compra concluída.</td></tr>`.toString();
}

// ───────── Minhas publicações ─────────
const posts = [];
let proximoPost = null;
let postsCarregados = false;
const listaPosts = $("#meusPosts");
const semPosts = () => {
  if (!posts.length) listaPosts.innerHTML = html`<p class="estado-vazio">Você ainda não publicou nada.</p>`.toString();
};
ligarPosts(listaPosts, { posts, usuario, aoExcluir: semPosts });
montarCompositor($("#compositor"), {
  aoPublicar(p) {
    $(".estado-vazio", listaPosts)?.remove();
    posts.unshift(p);
    listaPosts.insertAdjacentHTML("afterbegin", cartaoPost(p, usuario).toString());
  },
});
async function carregarPosts({ mais = false } = {}) {
  if (postsCarregados && !mais) return;
  postsCarregados = true;
  try {
    const r = await get(`/me/posts${mais && proximoPost ? `?cursor=${proximoPost}` : ""}`);
    posts.push(...r.posts);
    listaPosts.insertAdjacentHTML("beforeend", r.posts.map((p) => cartaoPost(p, usuario)).join(""));
    proximoPost = r.proximo;
    $("#btnMaisPosts").hidden = !proximoPost;
    semPosts();
  } catch (err) {
    postsCarregados = false;
    toast(err.message, "erro");
  }
}
$("#btnMaisPosts").addEventListener("click", (e) => comCarregamento(e.currentTarget, () => carregarPosts({ mais: true }), "Carregando..."));

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

// ───────── Dados pessoais (o PUT grava o perfil inteiro) ─────────
const formPerfil = $("#formPerfil");
const formRedes = $("#formRedes");
const formPrivacidade = $("#formPrivacidade");
const CAMPOS_PRIVACIDADE = ["perfil_publico", "mostrar_bio", "mostrar_estatisticas", "mostrar_favoritos", "mostrar_email", "mostrar_telefone", "mostrar_nascimento"];
mascaraTelefone(formPerfil.telefone);
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
  $("#pEmail").value = u.email ?? "";
  $("#pUsuario").value = u.usuario ?? "";
  for (const campo of CAMPOS_PRIVACIDADE) formPrivacidade.elements[campo].checked = Boolean(u[campo]);
}

// Monta o perfil completo (os campos não exibidos vêm do usuário atual)
const dadosPerfil = () => ({
  nome_completo: formPerfil.nome_completo.value,
  telefone: formPerfil.telefone.value,
  data_nascimento: formPerfil.data_nascimento.value,
  cpf: formPerfil.cpf.value,
  endereco: formPerfil.endereco.value,
  bio: formPerfil.bio.value,
  instagram: usuario.instagram,
  tiktok: usuario.tiktok,
  whatsapp: usuario.whatsapp,
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

// ───────── Redes sociais ─────────
$("#rRede").innerHTML = REDES.map((r) => html`<option value="${r.id}">${r.ico} ${r.nome}</option>`).join("");
function alternarModoRede() {
  const modo = formRedes.modo.value;
  $$("[data-modo]", formRedes).forEach((el) => (el.hidden = el.dataset.modo !== modo));
  $("#rDominioBloco").hidden = modo !== "usuario" || formRedes.rede.value !== "custom";
  formRedes.nomeUsuario.placeholder = redePorId(formRedes.rede.value).dica;
}
formRedes.modo.addEventListener("change", alternarModoRede);
formRedes.rede.addEventListener("change", alternarModoRede);
formRedes.link.addEventListener("input", () => {
  const r = detectarRede(formRedes.link.value);
  $("#rDetectada").textContent = r ? `${redePorId(r.rede).ico} ${r.rotulo}` : "";
});
alternarModoRede();

formRedes.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaRedes");
  alertaForm(alerta, null);
  const rede =
    formRedes.modo.value === "link" ? detectarRede(formRedes.link.value) : montarRede(formRedes.rede.value, formRedes.nomeUsuario.value, formRedes.dominio.value);
  if (!rede) return alertaForm(alerta, formRedes.modo.value === "link" ? "Cole um link, e-mail ou telefone válido." : "Confira o usuário informado.");
  await comCarregamento(formRedes.querySelector("[type=submit]"), async () => {
    try {
      ({ redes } = await post("/me/redes", { ...rede, publico: formRedes.publico.checked }));
      formRedes.reset();
      $("#rDetectada").textContent = "";
      alternarModoRede();
      renderRedes();
      toast("Rede adicionada.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Adicionando...");
});
$("#listaRedes").addEventListener("click", async (e) => {
  const pub = e.target.closest("[data-rede-publica]");
  const rem = e.target.closest("[data-rede-remover]");
  try {
    if (pub) {
      const r = redes.find((x) => String(x.id_rede) === pub.dataset.redePublica);
      ({ redes } = await put(`/me/redes/${r.id_rede}`, { rede: r.rede, rotulo: r.rotulo, url: r.url, publico: !r.publico }));
    } else if (rem) {
      if (!(await confirmar("Remover esta rede do seu perfil?", { titulo: "Remover rede", confirmar: "Remover", perigo: true }))) return;
      ({ redes } = await del(`/me/redes/${rem.dataset.redeRemover}`));
    } else return;
    renderRedes();
  } catch (err) {
    toast(err.message, "erro");
  }
});

// ───────── Privacidade ─────────
formPrivacidade.addEventListener("submit", async (e) => {
  e.preventDefault();
  await comCarregamento(formPrivacidade.querySelector("[type=submit]"), async () => {
    try {
      ({ usuario } = await put("/me/privacidade", Object.fromEntries(CAMPOS_PRIVACIDADE.map((c) => [c, formPrivacidade.elements[c].checked]))));
      renderPerfil();
      toast("Privacidade salva.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Salvando...");
});

// ───────── Nome de usuário e e-mail ─────────
const formUsuario = $("#formUsuario");
formUsuario.addEventListener("submit", async (e) => {
  e.preventDefault();
  limparErrosCampos(formUsuario);
  await comCarregamento(formUsuario.querySelector("[type=submit]"), async () => {
    try {
      ({ usuario } = await put("/me/usuario", { usuario: formUsuario.usuario.value }));
      alertaForm($("#alertaUsuario"), usuario.usuario ? `Agora você também entra com “${usuario.usuario}”.` : "Nome de usuário removido.", "sucesso");
      preencherFormularios();
    } catch (err) {
      alertaForm($("#alertaUsuario"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(formUsuario, err.detalhes);
    }
  }, "Salvando...");
});
const formEmail = $("#formEmail");
formEmail.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erros = validarForm(formEmail, { novo_email: regras.email, senha_atual: (v) => (v ? null : "Informe a senha atual.") });
  if (mostrarErrosCampos(formEmail, erros)) return;
  await comCarregamento(formEmail.querySelector("[type=submit]"), async () => {
    try {
      const r = await post("/me/email", { novo_email: formEmail.novo_email.value, senha_atual: formEmail.senha_atual.value });
      formEmail.reset();
      preencherFormularios();
      alertaForm($("#alertaEmail"), r.mensagem, "sucesso");
    } catch (err) {
      alertaForm($("#alertaEmail"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(formEmail, err.detalhes);
    }
  }, "Enviando...");
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
const [r, ag, pe, fa, re, fi] = await Promise.allSettled([
  get("/me/resumo"),
  get("/me/agendamentos"),
  get("/me/pedidos"),
  get("/me/favoritos"),
  get("/me/redes"),
  get("/me/fidelidade"),
]);
if (re.status === "fulfilled") ({ redes } = re.value);
if (fi.status === "fulfilled") ({ fidelidade } = fi.value);
if (r.status === "fulfilled") ({ usuario, resumo } = r.value);
if (ag.status === "fulfilled") agendamentos = ag.value.agendamentos;
if (pe.status === "fulfilled") pedidos = pe.value.pedidos;
if (fa.status === "fulfilled") favoritos = fa.value;
renderPerfil();
renderEstatisticas();
renderFavoritos();
renderFavoritosExtras();
renderRedes();
renderFidelidade();
renderAgendamentos();
renderPedidos();
if ([r, ag, pe, fa, re, fi].some((x) => x.status === "rejected")) toast("Parte dos dados não pôde ser carregada. Atualize a página.", "aviso");
