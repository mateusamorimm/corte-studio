// Agendamento (modal do colega) usado na home, no catálogo e nos perfis: vários serviços, cortes de
// referência e várias pessoas. Com conta, o horário vai para o perfil; sem conta, vira uma reserva com
// código para apresentar no salão. Horários livres sempre calculados pelo servidor.
import { get, post } from "./api.js";
import { $, $$, html, urlSegura, moeda, telefoneFormatado, abrirModal, alertaForm, comCarregamento, hojeIso, hora, dataCurta } from "./ui.js";
import { precoServico } from "./cartoes.js";
import { regras, mascaraTelefone } from "./validacao.js";
import { carrinhoVisitante, esvaziarCarrinhoVisitante } from "./carrinho.js";

const RASCUNHO = "sc_rascunho_agendamento"; // seleção do formulário, só nesta aba, até o login

let dlg, form, usuario, config;
let servicos = [];
let cortes = [];
let pronto = null;

const MOLDE = `
  <div class="modal-body">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
      <h3 class="modal-title" id="agendarModalTitulo" style="margin:0">Marcar horário</h3>
      <button type="button" class="btn btn-ghost btn-sm" data-fechar aria-label="Fechar">Fechar ✕</button>
    </div>
    <form id="formAgendamento" novalidate>
      <div id="agAlerta" class="form-alert" hidden></div>
      <p class="text-muted" id="agConta" style="font-size:0.85rem;margin-bottom:12px"></p>
      <div id="agDadosCliente">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="agNome">Nome completo</label>
            <input type="text" class="form-input" id="agNome" name="nome" maxlength="120" autocomplete="name">
          </div>
          <div class="form-group">
            <label class="form-label" for="agTel">WhatsApp / Telefone</label>
            <input type="tel" class="form-input" id="agTel" name="telefone" autocomplete="tel" inputmode="numeric">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="agEmail">E-mail</label>
          <input type="email" class="form-input" id="agEmail" name="email" maxlength="160" autocomplete="email">
        </div>
      </div>
      <div class="form-group">
        <span class="form-label" id="agServicosRotulo">Serviços desejados * <small class="text-muted">(pode marcar mais de um)</small></span>
        <div id="agServicos" class="ag-check-list" role="group" aria-labelledby="agServicosRotulo"></div>
      </div>
      <details class="form-group" id="agCortesBloco" hidden>
        <summary class="form-label">Cortes de referência <small class="text-muted">(opcional)</small> <span id="agCortesQtd" class="text-muted"></span></summary>
        <div id="agCortes" class="ag-check-list" role="group" aria-label="Cortes de referência"></div>
      </details>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="agPessoas">Quantidade de pessoas</label>
          <select class="form-select" id="agPessoas" name="pessoas">
            <option value="1">1 pessoa</option><option value="2">2 pessoas</option><option value="3">3 pessoas</option><option value="4">4 pessoas</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="agProfissional">Profissional</label>
          <select class="form-select" id="agProfissional" name="id_barbeiro"><option value="">Qualquer profissional disponível</option></select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="agData">Data do atendimento *</label>
          <input type="date" class="form-input" id="agData" name="data" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="agHorario">Horário disponível *</label>
          <select class="form-select" id="agHorario" name="inicio" required disabled><option value="">Escolha serviço e data</option></select>
        </div>
      </div>
      <p class="ag-resumo" id="agResumo" aria-live="polite" hidden></p>
      <label class="check-item" id="agCarrinhoBloco" style="margin-bottom:16px" hidden><input type="checkbox" id="agCarrinho" checked> <span></span></label>
      <div class="form-group">
        <label class="form-label" for="agMsg">Observações (opcional)</label>
        <textarea class="form-textarea" id="agMsg" name="observacao" maxlength="500" placeholder="Algum detalhe para o profissional…"></textarea>
      </div>
      <label class="check-item" id="agLgpdBloco" style="margin-bottom:16px;align-items:flex-start">
        <input type="checkbox" id="agLgpd" name="consentimento">
        <span style="font-size:0.85rem">Autorizo o salão a usar estes dados só para esta reserva, conforme a <a href="privacidade.html" target="_blank" style="color:var(--accent)">política de privacidade</a>.</span>
      </label>
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%" id="agEnviar">Solicitar agendamento</button>
      <p class="text-muted" style="margin-top:12px;text-align:center;font-size:0.85rem" id="agRodape"></p>
    </form>
    <div id="agSucesso" hidden></div>
  </div>`;

const marcados = (id) => $$(`#${id} input:checked`, dlg).map((i) => Number(i.value));
const nomesServicos = (ids) => ids.map((id) => servicos.find((s) => s.id_servico === id)?.nome_servico).filter(Boolean);

function montar() {
  dlg = document.createElement("dialog");
  dlg.className = "modal modal-lg";
  dlg.id = "modalAgendar";
  dlg.setAttribute("aria-labelledby", "agendarModalTitulo");
  dlg.innerHTML = MOLDE;
  document.body.appendChild(dlg);
  form = $("#formAgendamento", dlg);
  mascaraTelefone(form.telefone);

  $("#agServicos", dlg).addEventListener("change", async () => {
    await carregarProfissionais();
    carregarHorarios();
  });
  $("#agCortes", dlg).addEventListener("change", atualizarCortes);
  for (const id of ["agPessoas", "agProfissional", "agData"]) $(`#${id}`, dlg).addEventListener("change", () => carregarHorarios());
  form.addEventListener("submit", enviar);
  dlg.addEventListener("click", (e) => {
    if (e.target.closest("#agNovo")) reiniciar();
    const entrar = e.target.closest("[data-entrar]");
    if (entrar) {
      e.preventDefault();
      guardarRascunho();
      location.href = entrar.href;
    }
  });
}

function atualizarCortes() {
  const n = marcados("agCortes").length;
  $("#agCortesQtd", dlg).textContent = n ? `· ${n} escolhido(s)` : "";
}

async function preparar() {
  if (!dlg) montar();
  pronto ??= Promise.all([get("/servicos"), get("/galeria"), config ? { config } : get("/config")]).then(([s, g, c]) => {
    servicos = s.servicos;
    cortes = g.cortes;
    config = c.config;
    $("#agServicos", dlg).innerHTML = servicos.length
      ? servicos
          .map(
            (x) => html`<label><input type="checkbox" value="${x.id_servico}"> <span>${x.icone ?? "✂️"} ${x.nome_servico}<small class="text-muted"> · ${precoServico(x)} · ${x.duracao_minutos} min</small></span></label>`
          )
          .join("")
      : html`<p class="text-muted">Nenhum serviço disponível no momento.</p>`.toString();
    $("#agCortesBloco", dlg).hidden = !cortes.length;
    $("#agCortes", dlg).innerHTML = cortes
      .map((c) => html`<label><input type="checkbox" value="${c.id_corte}"> <img src="${urlSegura(c.imagem_url)}" alt="" loading="lazy" data-fallback="corte"> <span>${c.nome_corte}</span></label>`)
      .join("");
    const data = $("#agData", dlg);
    data.min = hojeIso();
    const max = new Date(`${data.min}T12:00:00`);
    max.setDate(max.getDate() + (config?.janela_agendamento_dias ?? 30));
    data.max = max.toLocaleDateString("en-CA");
    montarIdentificacao();
  });
  try {
    await pronto;
  } catch (err) {
    pronto = null;
    alertaForm($("#agAlerta", dlg), err.message);
  }
}

function montarIdentificacao() {
  const voltar = encodeURIComponent(`${location.pathname}${location.search}#agendar`);
  for (const [campo, valor] of [["nome", usuario?.nome_completo], ["telefone", telefoneFormatado(usuario?.telefone ?? "")], ["email", usuario?.email]]) {
    form[campo].readOnly = Boolean(usuario);
    if (usuario) form[campo].value = valor ?? "";
  }
  $("#agLgpdBloco", dlg).hidden = Boolean(usuario);
  $("#agConta", dlg).hidden = Boolean(usuario);
  $("#agConta", dlg).innerHTML = html`Sem conta, você recebe um código para apresentar no salão. <a href="login.html?voltar=${voltar}" data-entrar style="color:var(--accent)">Entre</a> ou <a href="cadastro.html?voltar=${voltar}" data-entrar style="color:var(--accent)">crie sua conta</a> para acumular pontos e acompanhar tudo.`.toString();
  $("#agEnviar", dlg).textContent = usuario ? "Solicitar agendamento" : "Reservar horário";
  $("#agRodape", dlg).innerHTML = usuario
    ? html`Acompanhe e cancele seus horários em <a href="perfil.html#agendamentos" style="color:var(--accent);">Meu perfil</a>.`.toString()
    : html`Já tem um código? <a href="reserva.html" style="color:var(--accent);">Consulte sua reserva</a>.`.toString();
}

function atualizarCarrinho() {
  const itens = usuario ? [] : carrinhoVisitante();
  const bloco = $("#agCarrinhoBloco", dlg);
  bloco.hidden = !itens.length;
  if (itens.length) $("span", bloco).textContent = `Incluir na reserva os ${itens.reduce((t, i) => t + i.quantidade, 0)} produto(s) do carrinho (retirada no dia do atendimento)`;
}

async function carregarProfissionais() {
  const sel = $("#agProfissional", dlg);
  const atual = sel.value;
  const ids = marcados("agServicos");
  try {
    const { profissionais } = await get(`/profissionais${ids.length ? `?servicos=${ids.join(",")}` : ""}`);
    sel.innerHTML = html`<option value="">Qualquer profissional disponível</option>${profissionais.map((p) => html`<option value="${p.id_usuario}">${p.nome_completo}</option>`)}`.toString();
    if (profissionais.some((p) => String(p.id_usuario) === atual)) sel.value = atual;
    if (ids.length > 1 && !profissionais.length) alertaForm($("#agAlerta", dlg), "Nenhum profissional faz todos esses serviços juntos. Marque em horários separados.", "info");
    else alertaForm($("#agAlerta", dlg), null);
  } catch {
    /* mantém a lista anterior */
  }
}

let pedidoHorarios = 0;
async function carregarHorarios(manter = null) {
  const id = ++pedidoHorarios;
  const sel = $("#agHorario", dlg);
  const resumo = $("#agResumo", dlg);
  const ids = marcados("agServicos");
  const data = $("#agData", dlg).value;
  const pessoas = Number($("#agPessoas", dlg).value);
  sel.disabled = true;
  resumo.hidden = true;
  if (!ids.length || !data) {
    sel.innerHTML = '<option value="">Escolha serviço e data</option>';
    return;
  }
  sel.innerHTML = '<option value="">Buscando horários...</option>';
  try {
    const prof = $("#agProfissional", dlg).value;
    const q = new URLSearchParams({ servicos: ids.join(","), data, profissional: prof, pessoas: String(pessoas) });
    const r = await get(`/agenda/horarios?${q}`);
    if (id !== pedidoHorarios) return; // resposta antiga
    if (r.duracao_minutos) {
      resumo.hidden = false;
      resumo.textContent = `${r.duracao_minutos} min${pessoas > 1 ? ` por pessoa${prof ? " (em sequência)" : " (ao mesmo tempo, com profissionais diferentes)"}` : ""} · total ${moeda(Number(r.preco_total) * pessoas)}`;
    }
    if (!r.horarios.length) {
      sel.innerHTML = html`<option value="">${r.aviso ?? "Sem horários livres nesse dia"}</option>`.toString();
      return;
    }
    sel.innerHTML = html`<option value="">Selecione...</option>${r.horarios.map(
      (h) => html`<option value="${h.inicio}">${hora(h.inicio)}${prof ? "" : ` · ${h.profissionais.length} profissional(is)`}</option>`
    )}`.toString();
    sel.disabled = false;
    if (manter && r.horarios.some((h) => h.inicio === manter)) sel.value = manter;
  } catch (err) {
    if (id === pedidoHorarios) sel.innerHTML = html`<option value="">${err.message}</option>`.toString();
  }
}

const estado = () => ({
  servicos: marcados("agServicos"),
  cortes: marcados("agCortes"),
  pessoas: $("#agPessoas", dlg).value,
  id_barbeiro: $("#agProfissional", dlg).value,
  data: $("#agData", dlg).value,
  inicio: $("#agHorario", dlg).value,
  observacao: $("#agMsg", dlg).value,
});

function guardarRascunho() {
  try {
    sessionStorage.setItem(RASCUNHO, JSON.stringify(estado()));
  } catch {
    /* armazenamento indisponível: segue sem rascunho */
  }
}

async function aplicar(r) {
  const marcar = (id, lista) => $$(`#${id} input`, dlg).forEach((i) => (i.checked = (lista ?? []).map(String).includes(i.value)));
  if (r.servicos) marcar("agServicos", r.servicos);
  if (r.cortes) {
    marcar("agCortes", r.cortes);
    if (r.cortes.length) $("#agCortesBloco", dlg).open = true;
    atualizarCortes();
  }
  if (r.pessoas) $("#agPessoas", dlg).value = r.pessoas;
  await carregarProfissionais();
  if (r.id_barbeiro) $("#agProfissional", dlg).value = String(r.id_barbeiro);
  if (r.data && r.data >= $("#agData", dlg).min) $("#agData", dlg).value = r.data;
  if (r.observacao) $("#agMsg", dlg).value = r.observacao;
  await carregarHorarios(r.inicio);
}

async function enviar(e) {
  e.preventDefault();
  const alerta = $("#agAlerta", dlg);
  const erro = (msg) => {
    alertaForm(alerta, msg);
    alerta.scrollIntoView({ block: "nearest" });
  };
  alertaForm(alerta, null);
  const s = estado();
  if (!usuario) {
    const e1 = regras.nome(form.nome.value) ?? regras.telefone(form.telefone.value) ?? regras.email(form.email.value);
    if (e1) return erro(e1);
  }
  if (!s.servicos.length) return erro("Marque pelo menos um serviço.");
  if (!s.data) return erro("Escolha a data.");
  if (!s.inicio) return erro("Escolha um horário livre.");
  if (!usuario && !$("#agLgpd", dlg).checked) return erro("Autorize o uso dos seus dados para fazer a reserva.");

  const agendamento = {
    servicos: s.servicos,
    cortes: s.cortes,
    pessoas: Number(s.pessoas),
    id_barbeiro: s.id_barbeiro ? Number(s.id_barbeiro) : null,
    inicio: s.inicio,
  };
  await comCarregamento($("#agEnviar", dlg), async () => {
    try {
      if (usuario) {
        const r = await post("/me/agendamentos", { ...agendamento, observacao: s.observacao });
        sucesso({ codigo: r.codigo, agendamentos: r.agendamentos.map((a) => ({ inicio: a.data_hora_inicio, profissional: a.barbeiro.nome_completo })), nomes: nomesServicos(s.servicos) });
      } else {
        const comProdutos = !$("#agCarrinhoBloco", dlg).hidden && $("#agCarrinho", dlg).checked;
        const { reserva } = await post("/reservas", {
          nome: form.nome.value,
          telefone: form.telefone.value,
          email: form.email.value,
          consentimento: true,
          observacao: s.observacao,
          agendamento,
          itens: comProdutos ? carrinhoVisitante() : [],
        });
        if (comProdutos) esvaziarCarrinhoVisitante();
        sucesso({ codigo: reserva.codigo, agendamentos: reserva.agendamentos, nomes: nomesServicos(s.servicos), visitante: true });
      }
    } catch (err) {
      erro(err.message);
      if (err.status === 409) carregarHorarios();
    }
  }, "Enviando...");
}

function sucesso({ codigo, agendamentos, nomes, visitante = false }) {
  $("#agSucesso", dlg).innerHTML = html`
    <div class="form-alert form-alert-sucesso" style="text-align:center">
      ✅ <strong>Solicitação enviada!</strong><br>
      ${nomes.join(" + ")}${agendamentos.map((a) => html`<br>${dataCurta(a.inicio)} às ${hora(a.inicio)} com ${a.profissional}`)}
      <div class="codigo-reserva" aria-label="Código da reserva">${codigo}</div>
      <span>${visitante ? `Guarde este código e apresente no salão. Há tolerância de ${config?.tolerancia_falta_minutos ?? 20} minutos.` : "O salão recebeu seu pedido e vai confirmar o horário em breve."}</span>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px">
        ${visitante
          ? html`<a href="reserva.html?codigo=${codigo}" class="btn btn-outline btn-sm">Ver minha reserva</a>`
          : html`<a href="perfil.html#agendamentos" class="btn btn-outline btn-sm">Ver meus agendamentos</a>`}
        <button type="button" class="btn btn-ghost btn-sm" id="agNovo">Marcar outro horário</button>
      </div>
    </div>`.toString();
  form.hidden = true;
  $("#agSucesso", dlg).hidden = false;
  window.dispatchEvent(new CustomEvent("agendamento:criado"));
}

function reiniciar() {
  form.reset();
  montarIdentificacao();
  atualizarCortes();
  atualizarCarrinho();
  carregarHorarios();
  $("#agSucesso", dlg).hidden = true;
  form.hidden = false;
}

// Chame uma vez por página, com o usuário da sessão (ou null) e a configuração do salão.
export function iniciarAgendamento(dados) {
  usuario = dados.usuario;
  config = dados.config;
  document.addEventListener("click", (e) => {
    const gatilho = e.target.closest("[data-abrir-agendamento]");
    if (!gatilho) return;
    e.preventDefault();
    abrirAgendamento();
  });
}

// selecao: { servicos: [ids], cortes: [ids], id_barbeiro }
export async function abrirAgendamento(selecao = null) {
  if (!dlg) montar();
  if (!dlg.open) abrirModal(dlg);
  await preparar();
  if (!$("#agSucesso", dlg).hidden) reiniciar();
  atualizarCarrinho();
  if (selecao) await aplicar(selecao);
  else if (!$("#agProfissional", dlg).dataset.ok) await carregarProfissionais();
  $("#agProfissional", dlg).dataset.ok = "1";
}

// Voltou do login com uma escolha em andamento?
export async function retomarRascunho() {
  let r = null;
  try {
    r = JSON.parse(sessionStorage.getItem(RASCUNHO) || "null");
    sessionStorage.removeItem(RASCUNHO);
  } catch {
    return false;
  }
  if (!r || !usuario) return false;
  await abrirAgendamento(r);
  return true;
}
