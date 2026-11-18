// Agenda da equipe: lista, status, remarcação, agendamento de balcão e bloqueios.
// O profissional (BARBEIRO) vê e altera apenas a própria agenda — o servidor garante isso.
import { get, post, put, patch, del } from "../api.js";
import {
  $,
  html,
  moeda,
  toast,
  alertaForm,
  comCarregamento,
  confirmar,
  dataCurta,
  hora,
  dataHora,
  telefoneFormatado,
  badgeStatus,
  STATUS_AGENDAMENTO,
  abrirModal,
  hojeIso,
  localParaIso,
} from "../ui.js";
import { iniciarPainel } from "./comum.js";

const usuario = await iniciarPainel(["ADMIN", "BARBEIRO"]);
const ehAdmin = usuario.tipo_perfil === "ADMIN";

let agendamentos = [];
let servicos = [];
let equipe = [];
let atual = null;

const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ───────── Filtros ─────────
const filtros = $("#filtros");
const params = new URLSearchParams(location.search);
if (params.get("busca")) filtros.busca.value = params.get("busca");
if (params.get("status")) filtros.status.value = params.get("status");
if (!params.get("busca") && !params.get("status")) {
  filtros.data.value = hojeIso();
  filtros.ate.value = somarDias(hojeIso(), 30);
}

let temporizador;
filtros.addEventListener("input", (e) => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, e.target.name === "busca" ? 300 : 0);
});
filtros.addEventListener("submit", (e) => e.preventDefault());
$("#btnTodasDatas").addEventListener("click", () => {
  filtros.data.value = "";
  filtros.ate.value = "";
  carregar();
});

async function carregar() {
  const q = new URLSearchParams();
  for (const campo of ["data", "ate", "status", "busca"]) if (filtros[campo]?.value) q.set(campo, filtros[campo].value.trim());
  if (ehAdmin && filtros.profissional?.value) q.set("profissional", filtros.profissional.value);
  if (!q.get("data") && q.get("ate")) q.set("data", hojeIso());
  try {
    ({ agendamentos } = await get(`/admin/agendamentos?${q}`));
    render();
  } catch (err) {
    $("#body").innerHTML = html`<tr><td colspan="6" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function render() {
  $("#body").innerHTML = agendamentos.length
    ? agendamentos
        .map(
          (a) => html`
      <tr class="${a.status === "CANCELADO" ? "inativo" : ""}">
        <td style="color:var(--accent);font-weight:600;white-space:nowrap;">${dataCurta(a.data_hora_inicio)}<br>${hora(a.data_hora_inicio)}–${hora(a.data_hora_fim)}</td>
        <td>${a.cliente.nome_completo}${a.cliente.telefone ? html`<br><small class="text-muted">${telefoneFormatado(a.cliente.telefone)}</small>` : ""}</td>
        <td>${a.servico.nome_servico}${a.observacao_cliente ? html`<br><small class="text-muted" title="${a.observacao_cliente}">💬 ${a.observacao_cliente.slice(0, 40)}${a.observacao_cliente.length > 40 ? "…" : ""}</small>` : ""}</td>
        <td>${a.barbeiro.nome_completo}</td>
        <td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-alterar="${a.id_agendamento}">Alterar</button></td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="6" class="estado-vazio">Nenhum agendamento encontrado com esses filtros.</td></tr>`.toString();
}

$("#body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-alterar]");
  if (b) abrirAlteracao(Number(b.dataset.alterar));
});

// ───────── Seletores de serviço / profissional / horário ─────────
const opcoesServicos = (sel) =>
  (sel.innerHTML = html`<option value="">Selecione...</option>${servicos.map((s) => html`<option value="${s.id_servico}">${s.nome_servico} (${s.duracao_minutos} min)</option>`)}`.toString());

function opcoesProfissionais(sel, idServico, { qualquer = false } = {}) {
  const lista = equipe.filter((m) => m.ativo && (!idServico || m.servicos.includes(Number(idServico))));
  sel.innerHTML = html`${qualquer ? html`<option value="">Qualquer disponível</option>` : ""}${lista.map(
    (m) => html`<option value="${m.id_usuario}">${m.nome_completo}</option>`
  )}`.toString();
  if (!lista.length && !qualquer) sel.innerHTML = '<option value="">Nenhum profissional faz este serviço</option>';
}

async function opcoesHorarios(sel, { servico, data, profissional, ignorar, manter }) {
  if (!servico || !data) {
    sel.innerHTML = '<option value="">—</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = true;
  sel.innerHTML = '<option value="">Buscando...</option>';
  try {
    const q = new URLSearchParams({ servico, data });
    if (profissional) q.set("profissional", profissional);
    if (ignorar) q.set("ignorar", ignorar);
    const r = await get(`/agenda/horarios?${q}`);
    if (!r.horarios.length) {
      sel.innerHTML = html`<option value="">${r.aviso ?? "Sem horários livres"}</option>`.toString();
      return;
    }
    sel.innerHTML = html`<option value="">Selecione...</option>${r.horarios.map(
      (h) => html`<option value="${h.inicio}">${hora(h.inicio)}${profissional ? "" : ` · ${h.profissionais.map((p) => p.nome_completo.split(" ")[0]).join(", ")}`}</option>`
    )}`.toString();
    sel.disabled = false;
    if (manter && r.horarios.some((h) => h.inicio === manter)) sel.value = manter;
  } catch (err) {
    sel.innerHTML = html`<option value="">${err.message}</option>`.toString();
  }
}

// ───────── Alterar (status e remarcação) ─────────
const ACOES = {
  PENDENTE: [["CONFIRMADO", "✅ Confirmar", "btn-primary"], ["CANCELADO", "✖ Cancelar", "btn-outline"]],
  CONFIRMADO: [
    ["CONCLUIDO", "✔ Concluir atendimento", "btn-primary"],
    ["NAO_COMPARECEU", "🚫 Não compareceu", "btn-outline"],
    ["PENDENTE", "↩ Voltar para pendente", "btn-ghost"],
    ["CANCELADO", "✖ Cancelar", "btn-outline"],
  ],
  CONCLUIDO: [["CONFIRMADO", "↩ Desfazer conclusão", "btn-ghost"]],
  NAO_COMPARECEU: [["CONFIRMADO", "↩ Desfazer falta", "btn-ghost"]],
  CANCELADO: [["CONFIRMADO", "♻ Reativar (confirmado)", "btn-primary"], ["PENDENTE", "♻ Reativar (pendente)", "btn-outline"]],
};

function abrirAlteracao(id) {
  atual = agendamentos.find((a) => a.id_agendamento === id);
  const a = atual;
  alertaForm($("#alertaAlterar"), null);
  $("#grupoMotivo").hidden = true;
  $("#motivoCancel").value = "";
  $("#tituloAlterar").textContent = `Agendamento #${a.id_agendamento}`;
  $("#detalhesAg").innerHTML = html`
    <div>👤 <strong>${a.cliente.nome_completo}</strong>${a.cliente.telefone ? ` · ${telefoneFormatado(a.cliente.telefone)}` : ""}${a.cliente.email ? ` · ${a.cliente.email}` : ""}</div>
    <div>✂️ ${a.servico.nome_servico} com ${a.barbeiro.nome_completo} · ${moeda(a.preco_registrado)}</div>
    <div>🕐 ${dataHora(a.data_hora_inicio)} até ${hora(a.data_hora_fim)}</div>
    <div>Status: ${badgeStatus(STATUS_AGENDAMENTO, a.status)}</div>
    ${a.observacao_cliente ? html`<div>💬 ${a.observacao_cliente}</div>` : ""}
    ${a.motivo_cancelamento ? html`<div class="text-muted">Motivo do cancelamento: ${a.motivo_cancelamento}</div>` : ""}
    ${a.avaliacao ? html`<div>⭐ Avaliação: ${a.avaliacao.nota}/5${a.avaliacao.comentario ? ` — “${a.avaliacao.comentario}”` : ""}</div>` : ""}`.toString();

  const passou = new Date(a.data_hora_inicio) <= new Date();
  $("#acoesStatus").innerHTML = (ACOES[a.status] ?? [])
    .filter(([s]) => !(["CONCLUIDO", "NAO_COMPARECEU"].includes(s) && !passou))
    .map(([s, rotulo, classe]) => html`<button type="button" class="btn ${classe} btn-sm" data-status="${s}">${rotulo}</button>`)
    .join("");

  const podeRemarcar = ["PENDENTE", "CONFIRMADO"].includes(a.status);
  const fr = $("#formRemarcar");
  fr.hidden = !podeRemarcar;
  if (podeRemarcar) {
    opcoesServicos(fr.id_servico);
    fr.id_servico.value = a.servico.id_servico;
    opcoesProfissionais(fr.id_barbeiro, a.servico.id_servico);
    fr.id_barbeiro.value = a.barbeiro.id_usuario;
    fr.data.min = hojeIso();
    fr.data.value = new Date(a.data_hora_inicio).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    atualizarHorariosRemarcar(a.data_hora_inicio);
  }
  abrirModal($("#modalAlterar"));
}

const atualizarHorariosRemarcar = (manter = null) => {
  const fr = $("#formRemarcar");
  return opcoesHorarios(fr.inicio, {
    servico: fr.id_servico.value,
    data: fr.data.value,
    profissional: fr.id_barbeiro.value,
    ignorar: atual?.id_agendamento,
    manter: manter ? new Date(manter).toISOString() : null,
  });
};
$("#formRemarcar").id_servico.addEventListener("change", (e) => {
  opcoesProfissionais($("#formRemarcar").id_barbeiro, e.target.value);
  atualizarHorariosRemarcar();
});
$("#formRemarcar").id_barbeiro.addEventListener("change", () => atualizarHorariosRemarcar());
$("#formRemarcar").data.addEventListener("change", () => atualizarHorariosRemarcar());

function substituir(ag) {
  agendamentos = agendamentos.map((x) => (x.id_agendamento === ag.id_agendamento ? ag : x));
  render();
}

async function mudarStatus(status, motivo = null, botao) {
  try {
    await comCarregamento(botao, async () => {
      const { agendamento } = await patch(`/admin/agendamentos/${atual.id_agendamento}/status`, { status, motivo });
      substituir(agendamento);
      $("#modalAlterar").close();
      toast(`Agendamento ${STATUS_AGENDAMENTO[status].rotulo.toLowerCase()}.`, "sucesso");
    }, "Salvando...");
  } catch (err) {
    alertaForm($("#alertaAlterar"), err.message);
  }
}

$("#acoesStatus").addEventListener("click", (e) => {
  const b = e.target.closest("[data-status]");
  if (!b) return;
  if (b.dataset.status === "CANCELADO") {
    $("#grupoMotivo").hidden = false;
    $("#motivoCancel").focus();
    return;
  }
  mudarStatus(b.dataset.status, null, b);
});
$("#btnConfirmarCancel").addEventListener("click", (e) => mudarStatus("CANCELADO", $("#motivoCancel").value, e.currentTarget));

$("#formRemarcar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fr = e.currentTarget;
  if (!fr.inicio.value || !fr.id_barbeiro.value) return alertaForm($("#alertaAlterar"), "Escolha profissional, data e horário.");
  await comCarregamento(fr.querySelector("[type=submit]"), async () => {
    try {
      const { agendamento } = await put(`/admin/agendamentos/${atual.id_agendamento}`, {
        id_servico: Number(fr.id_servico.value),
        id_barbeiro: Number(fr.id_barbeiro.value),
        inicio: fr.inicio.value,
      });
      substituir(agendamento);
      $("#modalAlterar").close();
      toast("Agendamento remarcado.", "sucesso");
    } catch (err) {
      alertaForm($("#alertaAlterar"), err.message);
      atualizarHorariosRemarcar();
    }
  }, "Salvando...");
});

// ───────── Novo agendamento ─────────
const fn = $("#formNovo");
let buscaClienteTimer;
$("#nBuscaCliente").addEventListener("input", (e) => {
  clearTimeout(buscaClienteTimer);
  buscaClienteTimer = setTimeout(async () => {
    const termo = e.target.value.trim();
    if (termo.length < 2) return;
    try {
      const { clientes } = await get(`/admin/clientes/opcoes?busca=${encodeURIComponent(termo)}`);
      fn.id_cliente.innerHTML = clientes.length
        ? clientes.map((c) => html`<option value="${c.id_usuario}">${c.nome_completo}${c.telefone ? ` · ${telefoneFormatado(c.telefone)}` : ""}</option>`).join("")
        : '<option value="">Nenhum cliente encontrado</option>';
    } catch (err) {
      toast(err.message, "erro");
    }
  }, 300);
});

const atualizarHorariosNovo = () =>
  opcoesHorarios(fn.inicio, { servico: fn.id_servico.value, data: fn.data.value, profissional: fn.id_barbeiro.value });
fn.id_servico.addEventListener("change", () => {
  opcoesProfissionais(fn.id_barbeiro, fn.id_servico.value, { qualquer: ehAdmin });
  atualizarHorariosNovo();
});
fn.id_barbeiro.addEventListener("change", atualizarHorariosNovo);
fn.data.addEventListener("change", atualizarHorariosNovo);

$("#btnNovo").addEventListener("click", () => {
  fn.reset();
  alertaForm($("#alertaNovo"), null);
  fn.id_cliente.innerHTML = '<option value="">Busque o cliente acima</option>';
  opcoesServicos(fn.id_servico);
  opcoesProfissionais(fn.id_barbeiro, null, { qualquer: ehAdmin });
  fn.data.min = hojeIso();
  fn.data.value = hojeIso();
  atualizarHorariosNovo();
  abrirModal($("#modalNovo"));
});

fn.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaNovo");
  alertaForm(alerta, null);
  if (!fn.id_cliente.value) return alertaForm(alerta, "Selecione o cliente.");
  if (!fn.id_servico.value) return alertaForm(alerta, "Selecione o serviço.");
  if (!fn.inicio.value) return alertaForm(alerta, "Escolha um horário livre.");
  await comCarregamento(fn.querySelector("[type=submit]"), async () => {
    try {
      await post("/admin/agendamentos", {
        id_cliente: Number(fn.id_cliente.value),
        id_servico: Number(fn.id_servico.value),
        id_barbeiro: fn.id_barbeiro.value ? Number(fn.id_barbeiro.value) : null,
        inicio: fn.inicio.value,
        status: fn.status.value,
        observacao: fn.observacao.value,
      });
      $("#modalNovo").close();
      toast("Agendamento criado.", "sucesso");
      carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (err.status === 409) atualizarHorariosNovo();
    }
  }, "Agendando...");
});

// ───────── Bloqueios ─────────
async function carregarBloqueios() {
  try {
    const { bloqueios } = await get("/admin/bloqueios");
    $("#bloqueiosBody").innerHTML = bloqueios.length
      ? bloqueios
          .map(
            (b) => html`
        <tr>
          <td>${b.barbeiro.nome_completo}</td>
          <td>${dataHora(b.data_hora_inicio)}</td>
          <td>${dataHora(b.data_hora_fim)}</td>
          <td>${b.motivo ?? "—"}</td>
          <td><button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-remover-bloqueio="${b.id_bloqueio}">Remover</button></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="5" class="estado-vazio">Nenhum bloqueio futuro.</td></tr>`.toString();
  } catch (err) {
    $("#bloqueiosBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#bloqueiosBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-remover-bloqueio]");
  if (!b) return;
  if (!(await confirmar("Remover este bloqueio? O período volta a ficar disponível para agendamento.", { titulo: "Remover bloqueio", confirmar: "Remover" }))) return;
  try {
    await del(`/admin/bloqueios/${b.dataset.removerBloqueio}`);
    toast("Bloqueio removido.", "sucesso");
    carregarBloqueios();
  } catch (err) {
    toast(err.message, "erro");
  }
});

const fb = $("#formBloqueio");
$("#btnBloqueio").addEventListener("click", () => {
  fb.reset();
  alertaForm($("#alertaBloqueio"), null);
  opcoesProfissionais(fb.id_barbeiro, null);
  abrirModal($("#modalBloqueio"));
});
fb.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaBloqueio");
  alertaForm(alerta, null);
  if (!fb.id_barbeiro.value || !fb.inicio.value || !fb.fim.value) return alertaForm(alerta, "Preencha profissional, início e fim.");
  if (fb.fim.value <= fb.inicio.value) return alertaForm(alerta, "O fim deve ser depois do início.");
  await comCarregamento(fb.querySelector("[type=submit]"), async () => {
    try {
      await post("/admin/bloqueios", {
        id_barbeiro: Number(fb.id_barbeiro.value),
        inicio: localParaIso(fb.inicio.value),
        fim: localParaIso(fb.fim.value),
        motivo: fb.motivo.value,
      });
      $("#modalBloqueio").close();
      toast("Horário bloqueado.", "sucesso");
      carregarBloqueios();
    } catch (err) {
      let msg = err.message;
      if (Array.isArray(err.detalhes) && err.detalhes[0]?.cliente) {
        msg += " " + err.detalhes.map((c) => `${dataHora(c.inicio)} — ${c.cliente} (${c.servico})`).join("; ");
      }
      alertaForm(alerta, msg);
    }
  }, "Bloqueando...");
});

// ───────── Inicialização ─────────
try {
  const [s, eq] = await Promise.all([get("/servicos"), get("/admin/equipe")]);
  servicos = s.servicos;
  equipe = eq.equipe;
  if (ehAdmin) {
    filtros.profissional.innerHTML = html`<option value="">Todos</option>${equipe.map((m) => html`<option value="${m.id_usuario}">${m.nome_completo}</option>`)}`.toString();
  }
} catch (err) {
  toast(err.message, "erro");
}
carregar();
carregarBloqueios();
setInterval(() => {
  if (!document.querySelector("dialog[open]")) carregar();
}, 60000);
