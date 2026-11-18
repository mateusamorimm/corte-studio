// Perfil do usuário: dados pessoais, redes, favoritos, histórico, carrinho e estatísticas — tudo do banco.
import { get, post, put, patch, del, enviarImagem } from "../api.js";
import {
  $,
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
  dataSemFuso,
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

const VISITAS_FIDELIDADE = 5;
let usuario = await exigirLogin();
ligarSair(sair);
if (usuario.tipo_perfil !== "CLIENTE") {
  const link = $("#linkPainel");
  link.hidden = false;
  link.href = usuario.tipo_perfil === "ADMIN" ? "admin/index.html" : "admin/agendamentos.html";
}

let resumo = null;
let agendamentos = [];
let pedidos = [];
let carrinho = { itens: [], total: "0" };
let favoritos = { favoritos: [], enviados: [] };

// ───────── Cabeçalho do perfil ─────────
function renderPerfil() {
  const u = usuario;
  const capa = urlSegura(u.capa_url);
  const hero = $("#perfilHero");
  if (capa) hero.style.setProperty("--capa", `url(${JSON.stringify(capa)})`);
  else hero.style.removeProperty("--capa");

  $("#userAvatar").outerHTML = avatar(u, "avatar avatar-lg").toString().replace("<img ", '<img id="userAvatar" ').replace("<span ", '<span id="userAvatar" ');
  const fiel = resumo && resumo.visitas >= VISITAS_FIDELIDADE;
  $("#userNome").innerHTML = html`${u.nome_completo} ${fiel ? html`<span class="badge badge-accent">FIDELIDADE</span>` : ""}`.toString();
  $("#userHandle").textContent = u.email ? `@${u.email.split("@")[0]}` : "";
  $("#userBio").textContent = u.bio ?? "";
  $("#userBio").hidden = !u.bio;

  $("#userEmail").textContent = u.email ?? "—";
  $("#userTel").textContent = u.telefone ? telefoneFormatado(u.telefone) : "—";
  $("#userNasc").textContent = u.data_nascimento ? dataSemFuso(u.data_nascimento) : "—";
  $("#userEnd").textContent = u.endereco ?? "—";

  const redes = [];
  if (u.instagram) redes.push(html`<div>📷 Instagram · <a href="${`https://instagram.com/${u.instagram}`}" target="_blank" rel="noopener">@${u.instagram}</a></div>`);
  if (u.tiktok) redes.push(html`<div>🎵 TikTok · <a href="${`https://www.tiktok.com/@${u.tiktok}`}" target="_blank" rel="noopener">@${u.tiktok}</a></div>`);
  if (u.whatsapp) redes.push(html`<div>💬 WhatsApp · <a href="${`https://wa.me/${u.whatsapp}`}" target="_blank" rel="noopener">${telefoneFormatado(u.whatsapp.replace(/^55/, ""))}</a></div>`);
  $("#redesLista").innerHTML = redes.length ? redes.join("") : html`<div class="text-muted">Nenhuma rede social adicionada.</div>`.toString();
}

function renderEstatisticas() {
  if (!resumo) return;
  const primeiro = (n) => (n ? n.split(" ")[0] : "—");
  $("#statVisitas").textContent = String(resumo.visitas);
  $("#statFavorito").textContent = resumo.servico_favorito ?? "—";
  $("#statProfissional").textContent = primeiro(resumo.profissional_favorito);
  $("#statMembro").textContent = mesAno(resumo.membro_desde);
  $("#statGasto").textContent = moeda(resumo.total_gasto).replace(",00", "");
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
      const url = await enviarImagem(arquivo);
      const { corte } = await post("/me/cortes-enviados", { nome, imagem_url: url });
      favoritos.enviados.unshift(corte);
      renderFavoritos();
      $("#modalCorte").close();
      toast("Imagem enviada! O profissional poderá vê-la no seu atendimento.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
    }
  }, "Enviando...");
});

// ───────── Histórico de serviços ─────────
const futuro = (a) => new Date(a.data_hora_inicio) > new Date();
function renderAgendamentos() {
  const corpo = $("#historicoServicos");
  if (!agendamentos.length) {
    corpo.innerHTML = html`<tr><td colspan="6" class="estado-vazio">Você ainda não tem agendamentos. <a href="index.html#agendar" style="color:var(--accent);">Marque seu horário</a>.</td></tr>`.toString();
    return;
  }
  corpo.innerHTML = agendamentos
    .map((a) => {
      let avaliacao = html`<span class="text-muted">—</span>`;
      if (a.avaliacao) avaliacao = html`<span class="stars" title="${a.avaliacao.comentario ?? ""}">${estrelas(a.avaliacao.nota)}</span>`;
      else if (a.status === "CONCLUIDO") avaliacao = html`<button class="btn btn-outline btn-sm" data-avaliar="${a.id_agendamento}">Avaliar</button>`;
      else if (["PENDENTE", "CONFIRMADO"].includes(a.status) && futuro(a)) {
        avaliacao = html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-cancelar="${a.id_agendamento}">Cancelar</button>`;
      }
      return html`
        <tr>
          <td>${dataCurta(a.data_hora_inicio)} <span class="text-muted">${hora(a.data_hora_inicio)}</span></td>
          <td>${a.servico.nome_servico}</td>
          <td>${a.barbeiro.nome_completo}</td>
          <td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td>
          <td>${avaliacao}</td>
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
        html`<button type="button" role="radio" aria-checked="${n === notaEscolhida ? "true" : "false"}" aria-label="${n} estrela${n > 1 ? "s" : ""}" data-nota="${n}" style="color:inherit;font-size:inherit;">${n <= notaEscolhida ? "★" : "☆"}</button>`
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

// ───────── Carrinho ─────────
function renderCarrinho() {
  const el = $("#carrinhoContent");
  if (!carrinho.itens.length) {
    el.innerHTML = html`<p class="text-muted">Seu carrinho está vazio. Adicione produtos na <a href="index.html#produtos" style="color:var(--accent);">página inicial</a>.</p>`.toString();
    return;
  }
  el.innerHTML =
    carrinho.itens
      .map((item) => {
        const p = item.produto;
        const indisponivel = !p.ativo;
        return html`
        <div class="carrinho-item">
          <div class="info">
            <strong>${p.nome_produto}</strong>
            <span class="text-muted">${indisponivel ? "Produto indisponível — remova do carrinho" : html`${item.quantidade}x · ${moeda(p.preco)}`}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;">
            ${indisponivel
              ? ""
              : html`<div style="display:flex;align-items:center;gap:4px;">
                  <button class="btn btn-ghost btn-sm" data-qtd="${p.id_produto}" data-delta="-1" aria-label="Diminuir quantidade de ${p.nome_produto}" ${raw(item.quantidade <= 1 ? "disabled" : "")}>−</button>
                  <span aria-live="polite" style="min-width:20px;text-align:center;">${item.quantidade}</span>
                  <button class="btn btn-ghost btn-sm" data-qtd="${p.id_produto}" data-delta="1" aria-label="Aumentar quantidade de ${p.nome_produto}" ${raw(item.quantidade >= Math.min(99, p.quantidade_estoque) ? "disabled" : "")}>+</button>
                </div>
                <span class="preco">${moeda(Number(p.preco) * item.quantidade)}</span>`}
            <button class="btn btn-ghost btn-sm" data-remover="${p.id_produto}">Remover</button>
          </div>
        </div>`;
      })
      .join("") +
    html`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:12px;flex-wrap:wrap;">
        <strong>Total: ${moeda(carrinho.total)}</strong>
        <button class="btn btn-primary" id="btnFinalizar">Finalizar compra</button>
      </div>
      <p class="form-hint" style="margin-top:8px;">Pagamento e retirada no salão. Os itens ficam reservados para você.</p>`;
}

$("#carrinhoContent").addEventListener("click", async (e) => {
  const qtd = e.target.closest("[data-qtd]");
  const rem = e.target.closest("[data-remover]");
  const fin = e.target.closest("#btnFinalizar");
  try {
    if (qtd) {
      const item = carrinho.itens.find((i) => String(i.produto.id_produto) === qtd.dataset.qtd);
      qtd.disabled = true;
      carrinho = await patch(`/me/carrinho/${qtd.dataset.qtd}`, { quantidade: item.quantidade + Number(qtd.dataset.delta) });
      renderCarrinho();
    } else if (rem) {
      rem.disabled = true;
      carrinho = await del(`/me/carrinho/${rem.dataset.remover}`);
      renderCarrinho();
    } else if (fin) {
      const ok = await confirmar(`Confirmar pedido de ${moeda(carrinho.total)}? Pagamento e retirada no salão.`, {
        titulo: "Finalizar compra",
        confirmar: "Confirmar pedido",
      });
      if (!ok) return;
      await comCarregamento(fin, async () => {
        const { pedido } = await post("/me/pedidos", {});
        pedidos.unshift(pedido);
        carrinho = { itens: [], total: "0" };
        renderCarrinho();
        renderPedidos();
        toast(`Pedido #${pedido.id_pedido} realizado! Avisaremos quando estiver pronto para retirada.`, "sucesso", 6000);
      }, "Finalizando...");
    }
  } catch (err) {
    toast(err.message, "erro");
    carrinho = await get("/me/carrinho").catch(() => carrinho);
    renderCarrinho();
  }
});

// ───────── Capa e foto ─────────
async function trocarImagem(rota, botao) {
  const arquivo = await escolherImagem();
  if (!arquivo) return;
  const erro = validarArquivoImagem(arquivo);
  if (erro) return toast(erro, "erro");
  await comCarregamento(botao, async () => {
    try {
      const url = await enviarImagem(arquivo);
      ({ usuario } = await put(rota, { url }));
      renderPerfil();
      prepararPreviaAvatar();
      toast("Imagem atualizada.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Enviando...");
}
$("#btnCapa").addEventListener("click", (e) => trocarImagem("/me/capa", e.currentTarget));

// ───────── Editar perfil ─────────
const formPerfil = $("#formPerfil");
mascaraTelefone(formPerfil.telefone);
mascaraTelefone(formPerfil.whatsapp);
mascaraCpf(formPerfil.cpf);
formPerfil.data_nascimento.max = new Date().toISOString().slice(0, 10);

function prepararPreviaAvatar() {
  $("#previaAvatar").innerHTML = avatar(usuario, "avatar avatar-lg").toString();
  $("#btnRemoverFoto").hidden = !usuario.avatar_url;
}

function abrirEdicao(focarRedes = false) {
  const u = usuario;
  limparErrosCampos(formPerfil);
  alertaForm($("#alertaPerfil"), null);
  formPerfil.nome_completo.value = u.nome_completo;
  formPerfil.telefone.value = telefoneFormatado(u.telefone ?? "");
  formPerfil.data_nascimento.value = u.data_nascimento ? u.data_nascimento.slice(0, 10) : "";
  formPerfil.cpf.value = u.cpf ? u.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "";
  $("#pEmail").value = u.email ?? "";
  formPerfil.endereco.value = u.endereco ?? "";
  formPerfil.bio.value = u.bio ?? "";
  formPerfil.instagram.value = u.instagram ? `@${u.instagram}` : "";
  formPerfil.tiktok.value = u.tiktok ? `@${u.tiktok}` : "";
  formPerfil.whatsapp.value = u.whatsapp ? telefoneFormatado(u.whatsapp.replace(/^55/, "")) : "";
  prepararPreviaAvatar();
  abrirModal($("#modalPerfil"));
  if (focarRedes) {
    $("#tituloRedes").scrollIntoView({ block: "start" });
    formPerfil.instagram.focus();
  }
}
$("#btnEditarPerfil").addEventListener("click", () => abrirEdicao());
$("#btnRedes").addEventListener("click", () => abrirEdicao(true));
$("#btnTrocarFoto").addEventListener("click", (e) => trocarImagem("/me/avatar", e.currentTarget));
$("#btnRemoverFoto").addEventListener("click", async () => {
  try {
    ({ usuario } = await put("/me/avatar", { url: null }));
    renderPerfil();
    prepararPreviaAvatar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

formPerfil.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaPerfil");
  alertaForm(alerta, null);
  const erros = validarForm(formPerfil, {
    nome_completo: regras.nome,
    telefone: (v) => (!v.trim() || !regras.telefone(v) ? null : regras.telefone(v)),
    cpf: regras.cpfOpcional,
    data_nascimento: regras.dataPassadaOpcional,
    whatsapp: (v) => (!v.trim() || !regras.telefone(v) ? null : "Informe o WhatsApp com DDD."),
  });
  if (mostrarErrosCampos(formPerfil, erros)) return;
  await comCarregamento(formPerfil.querySelector("[type=submit]"), async () => {
    try {
      ({ usuario } = await put("/me/perfil", {
        nome_completo: formPerfil.nome_completo.value,
        telefone: formPerfil.telefone.value,
        data_nascimento: formPerfil.data_nascimento.value,
        cpf: formPerfil.cpf.value,
        endereco: formPerfil.endereco.value,
        bio: formPerfil.bio.value,
        instagram: formPerfil.instagram.value,
        tiktok: formPerfil.tiktok.value,
        whatsapp: formPerfil.whatsapp.value,
      }));
      renderPerfil();
      $("#modalPerfil").close();
      toast("Perfil atualizado.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(formPerfil, err.detalhes);
      else if (err.detalhes?.campo) mostrarErrosCampos(formPerfil, [{ campo: err.detalhes.campo, mensagem: err.message }]);
    }
  }, "Salvando...");
});

// ───────── Alterar senha ─────────
const formSenha = $("#formSenha");
$("#btnAbrirSenha").addEventListener("click", () => {
  formSenha.reset();
  limparErrosCampos(formSenha);
  alertaForm($("#alertaSenha"), null);
  abrirModal($("#modalSenha"));
});
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
      $("#modalSenha").close();
      toast("Senha alterada. As outras sessões abertas foram encerradas.", "sucesso", 6000);
    } catch (err) {
      alertaForm($("#alertaSenha"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(formSenha, err.detalhes);
    }
  }, "Alterando...");
});

// ───────── Carga inicial ─────────
renderPerfil();
const [r, ag, pe, ca, fa] = await Promise.allSettled([
  get("/me/resumo"),
  get("/me/agendamentos"),
  get("/me/pedidos"),
  get("/me/carrinho"),
  get("/me/favoritos"),
]);
if (r.status === "fulfilled") ({ usuario, resumo } = r.value);
if (ag.status === "fulfilled") agendamentos = ag.value.agendamentos;
if (pe.status === "fulfilled") pedidos = pe.value.pedidos;
if (ca.status === "fulfilled") carrinho = ca.value;
if (fa.status === "fulfilled") favoritos = fa.value;
renderPerfil();
renderEstatisticas();
renderFavoritos();
renderAgendamentos();
renderPedidos();
renderCarrinho();
if ([r, ag, pe, ca, fa].some((x) => x.status === "rejected")) toast("Parte dos dados não pôde ser carregada. Atualize a página.", "aviso");
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
