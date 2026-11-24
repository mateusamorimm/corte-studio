// Pedidos de clientes cadastrados e reservas de visitantes (localizadas pelo código).
import { get, patch, post } from "../api.js";
import {
  $,
  html,
  moeda,
  toast,
  confirmar,
  comCarregamento,
  dataCurta,
  dataHora,
  hora,
  telefoneFormatado,
  badgeStatus,
  STATUS_PEDIDO,
  STATUS_AGENDAMENTO,
  STATUS_RESERVA,
  nomesServicos,
  abrirModal,
  alertaForm,
  mostrarErrosCampos,
  limparErrosCampos,
} from "../ui.js";
import { regras, validarForm, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { iniciarPainel, ligarAbas, trocarAba } from "./comum.js";

await iniciarPainel(["ADMIN", "RECEPCIONISTA"]);

const params = new URLSearchParams(location.search);

// ───────── Clientes cadastrados ─────────
const filtros = $("#filtros");
if (params.get("status")) filtros.status.value = params.get("status");
let pedidos = [];
let temporizador;

async function carregar() {
  const q = new URLSearchParams({ visitante: "false" });
  if (filtros.status.value) q.set("status", filtros.status.value);
  if (filtros.busca.value.trim()) q.set("busca", filtros.busca.value.trim());
  try {
    ({ pedidos } = await get(`/admin/pedidos?${q}`));
    render();
  } catch (err) {
    $("#pedidosBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

const ACOES = {
  PENDENTE: [["PRONTO_PARA_RETIRADA", "📦 Pronto p/ retirada"], ["CONCLUIDO", "✔ Retirado e pago"], ["CANCELADO", "✖ Cancelar"]],
  PRONTO_PARA_RETIRADA: [["CONCLUIDO", "✔ Retirado e pago"], ["PENDENTE", "↩ Voltar"], ["CANCELADO", "✖ Cancelar"]],
};
const FORMAS = { PIX: "Pix", CARTAO: "cartão", DINHEIRO: "dinheiro" };

const itensPedido = (p) => html`${p.itens.map((i) => html`<div>${i.quantidade}x ${i.nome_produto_registrado} <span class="text-muted">(${moeda(i.preco_unitario)})</span></div>`)}
  ${p.forma_pagamento ? html`<small class="text-muted">Pretende pagar com ${FORMAS[p.forma_pagamento] ?? p.forma_pagamento}</small>` : ""}
  ${p.observacao ? html`<div><small class="text-muted">💬 ${p.observacao}</small></div>` : ""}`;

const totalPedido = (p) => html`<strong>${moeda(p.valor_total)}</strong>${Number(p.valor_desconto) > 0 ? html`<br><small class="text-muted">${p.recompensa?.nome ?? "Desconto"}: −${moeda(p.valor_desconto)}</small>` : ""}`;

const botoesPedido = (p) =>
  (ACOES[p.status] ?? []).map(
    ([s, rotulo]) => html`<button class="btn btn-ghost btn-sm" ${s === "CANCELADO" ? html`style="color:var(--accent)"` : ""} data-status="${s}" data-id="${p.id_pedido}">${rotulo}</button>`
  );

function render() {
  $("#pedidosBody").innerHTML = pedidos.length
    ? pedidos
        .map(
          (p) => html`
      <tr class="${p.status === "CANCELADO" ? "inativo" : ""}">
        <td><span class="codigo-tag">${p.reserva?.codigo ?? `#${p.id_pedido}`}</span></td>
        <td style="white-space:nowrap;">${dataHora(p.data_pedido)}${p.prazo_retirada && ACOES[p.status] ? html`<br><small class="text-muted">retirar até ${dataCurta(p.prazo_retirada)}</small>` : ""}</td>
        <td><a href="${`cliente-perfil.html?id=${p.cliente.id_usuario}`}">${p.cliente.nome_completo}</a>${p.cliente.telefone ? html`<br><small class="text-muted">${telefoneFormatado(p.cliente.telefone)}</small>` : ""}</td>
        <td>${itensPedido(p)}</td>
        <td>${totalPedido(p)}</td>
        <td>${badgeStatus(STATUS_PEDIDO, p.status)}${p.motivo_cancelamento ? html`<br><small class="text-muted">${p.motivo_cancelamento}</small>` : ""}</td>
        <td><div class="admin-acoes table-actions">${botoesPedido(p)}</div></td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="7" class="estado-vazio">Nenhum pedido encontrado.</td></tr>`.toString();
}

async function mudarStatus(b, depois) {
  const status = b.dataset.status;
  if (status === "CANCELADO" && !(await confirmar("Cancelar este pedido? Os itens voltam para o estoque e os pontos usados são devolvidos.", { titulo: "Cancelar pedido", confirmar: "Cancelar pedido", perigo: true }))) return;
  await comCarregamento(b, async () => {
    try {
      const { pedido } = await patch(`/admin/pedidos/${b.dataset.id}/status`, { status });
      toast(`Pedido ${pedido.reserva?.codigo ?? `#${pedido.id_pedido}`}: ${STATUS_PEDIDO[pedido.status].rotulo.toLowerCase()}.`, "sucesso");
      await depois(pedido);
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "...");
}
$("#pedidosBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-status]");
  if (b)
    mudarStatus(b, (pedido) => {
      pedidos = pedidos.map((p) => (p.id_pedido === pedido.id_pedido ? pedido : p));
      render();
    });
});
filtros.addEventListener("submit", (e) => e.preventDefault());
filtros.addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});

// ───────── Visitantes ─────────
const filtrosReserva = $("#filtrosReserva");
let reservas = [];
let aberta = null;

async function carregarReservas() {
  const q = new URLSearchParams({ visitante: "true" });
  if (filtrosReserva.status.value) q.set("status", filtrosReserva.status.value);
  if (filtrosReserva.busca.value.trim()) q.set("busca", filtrosReserva.busca.value.trim());
  try {
    ({ reservas } = await get(`/admin/reservas?${q}`));
    renderReservas();
  } catch (err) {
    $("#reservasBody").innerHTML = html`<tr><td colspan="6" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

const resumoReserva = (r) => html`
  ${r.agendamentos.map((a) => html`<div>📅 ${dataCurta(a.data_hora_inicio)} ${hora(a.data_hora_inicio)} — ${nomesServicos(a)} <span class="text-muted">(${a.barbeiro.nome_completo.split(" ")[0]})</span></div>`)}
  ${r.pedido ? html`<div>🛍️ ${r.pedido.itens.map((i) => `${i.quantidade}x ${i.nome_produto_registrado}`).join(", ")} — ${moeda(r.pedido.valor_total)}</div>` : ""}`;

function renderReservas() {
  $("#reservasBody").innerHTML = reservas.length
    ? reservas
        .map(
          (r) => html`
      <tr class="${r.status === "ATIVA" ? "" : "inativo"}">
        <td><span class="codigo-tag">${r.codigo}</span></td>
        <td style="white-space:nowrap">${dataHora(r.criada_em)}</td>
        <td>${r.nome}${r.telefone ? html`<br><small class="text-muted">${telefoneFormatado(r.telefone)}</small>` : ""}</td>
        <td>${resumoReserva(r)}</td>
        <td>${badgeStatus(STATUS_RESERVA, r.status)}${r.motivo ? html`<br><small class="text-muted">${r.motivo}</small>` : ""}</td>
        <td><button class="btn btn-ghost btn-sm" data-abrir="${r.id_reserva}">Abrir</button></td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="6" class="estado-vazio">Nenhuma reserva encontrada.</td></tr>`.toString();
}

function mostrarReserva(r) {
  aberta = r;
  const ativa = r.status === "ATIVA";
  const pendentes = r.agendamentos.filter((a) => ["PENDENTE", "CONFIRMADO"].includes(a.status));
  $("#reservaConteudo").innerHTML = html`
    <h3 class="modal-title" id="tituloReserva">Reserva <span class="codigo-tag">${r.codigo}</span> ${badgeStatus(STATUS_RESERVA, r.status)}</h3>
    <div id="alertaReserva" class="form-alert" hidden></div>
    <div class="hist-item"><span>👤 <strong>${r.nome}</strong> ${r.cliente.visitante ? html`<span class="badge badge-warning">VISITANTE</span>` : html`<a href="${`cliente-perfil.html?id=${r.cliente.id_usuario}`}">ver cliente</a>`}<br><small class="text-muted">${[r.telefone ? telefoneFormatado(r.telefone) : null, r.email].filter(Boolean).join(" · ")}</small></span></div>
    ${r.agendamentos.map(
      (a) => html`<div class="hist-item"><span>📅 ${dataHora(a.data_hora_inicio)} — ${nomesServicos(a)}<br><small class="text-muted">${a.barbeiro.nome_completo}${a.chegou_em ? ` · chegou às ${hora(a.chegou_em)}` : ""}${a.cortes.length ? ` · ref.: ${a.cortes.map((c) => c.corte.nome_corte).join(", ")}` : ""}</small></span><span>${badgeStatus(STATUS_AGENDAMENTO, a.status)} ${moeda(a.preco_registrado)}</span></div>`
    )}
    ${r.pedido ? html`<div class="hist-item"><span>${itensPedido(r.pedido)}<small class="text-muted">Retirar até ${dataCurta(r.pedido.prazo_retirada)}</small></span><span>${badgeStatus(STATUS_PEDIDO, r.pedido.status)} ${totalPedido(r.pedido)}</span></div>` : ""}
    ${r.observacao ? html`<p class="text-muted" style="margin-top:8px">💬 ${r.observacao}</p>` : ""}
    <div class="modal-actions">
      ${ativa && pendentes.some((a) => !a.chegou_em) ? html`<button type="button" class="btn btn-outline btn-sm" data-acao="chegada">🙋 Registrar chegada</button>` : ""}
      ${ativa && r.pedido?.status === "PENDENTE" ? html`<button type="button" class="btn btn-outline btn-sm" data-status="PRONTO_PARA_RETIRADA" data-id="${r.pedido.id_pedido}">📦 Pronto p/ retirada</button>` : ""}
      ${ativa ? html`<button type="button" class="btn btn-primary btn-sm" data-acao="concluir">✔ Concluir</button>` : ""}
      ${r.cliente.visitante ? html`<button type="button" class="btn btn-outline btn-sm" data-acao="cadastrar">${ativa ? "Concluir + cadastrar" : "Cadastrar cliente"}</button>` : ""}
      ${ativa ? html`<button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="cancelar">✖ Cancelar</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-fechar>Fechar</button>
    </div>`.toString();
  const dlg = $("#modalReserva");
  if (!dlg.open) abrirModal(dlg);
}

async function atualizarReserva(r) {
  mostrarReserva(r);
  await Promise.all([carregarReservas(), carregar()]);
}

$("#reservasBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-abrir]");
  if (b) mostrarReserva(reservas.find((r) => String(r.id_reserva) === b.dataset.abrir));
});

$("#modalReserva").addEventListener("click", async (e) => {
  const st = e.target.closest("[data-status]");
  const b = e.target.closest("[data-acao]");
  if (st) return mudarStatus(st, async () => atualizarReserva((await get(`/admin/reservas/codigo/${aberta.codigo}`)).reserva));
  if (!b) return;
  if (b.dataset.acao === "cadastrar") return abrirCadastro();
  if (b.dataset.acao === "cancelar" && !(await confirmar("Cancelar a reserva inteira? Horários e produtos voltam a ficar disponíveis.", { titulo: "Cancelar reserva", confirmar: "Cancelar reserva", perigo: true }))) return;
  await comCarregamento(b, async () => {
    try {
      const { reserva } = await post(`/admin/reservas/${aberta.id_reserva}/${b.dataset.acao}`, {});
      toast({ chegada: "Chegada registrada.", concluir: "Reserva concluída.", cancelar: "Reserva cancelada." }[b.dataset.acao], "sucesso");
      await atualizarReserva(reserva);
    } catch (err) {
      alertaForm($("#alertaReserva"), err.message);
    }
  }, "...");
});

filtrosReserva.addEventListener("submit", (e) => e.preventDefault());
filtrosReserva.addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregarReservas, 300);
});

$("#buscaCodigo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codigo = e.currentTarget.codigo.value.trim().toUpperCase();
  if (codigo.length !== 6) return toast("O código tem 6 letras e números.", "aviso");
  try {
    mostrarReserva((await get(`/admin/reservas/codigo/${encodeURIComponent(codigo)}`)).reserva);
  } catch (err) {
    toast(err.message, "erro");
  }
});

// ───────── Concluir + cadastrar ─────────
const fc = $("#formCadastrar");
mascaraTelefone(fc.telefone);
mascaraCpf(fc.cpf);
function abrirCadastro() {
  fc.reset();
  limparErrosCampos(fc);
  alertaForm($("#alertaCadastrar"), null);
  $("#blocoVincular").hidden = true;
  fc.nome_completo.value = aberta.nome;
  fc.telefone.value = telefoneFormatado(aberta.telefone ?? "");
  fc.email.value = aberta.email ?? "";
  const ativa = aberta.status === "ATIVA";
  fc.concluir.checked = ativa;
  fc.concluir.closest("label").hidden = !ativa;
  abrirModal($("#modalCadastrar"));
}
fc.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erros = validarForm(fc, {
    nome_completo: regras.nome,
    telefone: regras.telefone,
    email: (v) => (!v.trim() ? null : regras.email(v)),
    cpf: regras.cpfOpcional,
    data_nascimento: regras.dataPassadaOpcional,
  });
  if (mostrarErrosCampos(fc, erros)) return;
  await comCarregamento(fc.querySelector("[type=submit]"), async () => {
    try {
      const r = await post(`/admin/reservas/${aberta.id_reserva}/cadastrar`, {
        nome_completo: fc.nome_completo.value,
        telefone: fc.telefone.value,
        email: fc.email.value,
        cpf: fc.cpf.value,
        data_nascimento: fc.data_nascimento.value,
        endereco: fc.endereco.value,
        vincular: fc.vincular.checked,
        concluir: fc.concluir.checked,
      });
      $("#modalCadastrar").close();
      toast(r.novo ? "Cliente cadastrado." : "Reserva vinculada à conta do cliente.", "sucesso");
      if (r.aviso) toast(r.aviso, "aviso", 9000);
      await atualizarReserva(r.reserva);
    } catch (err) {
      alertaForm($("#alertaCadastrar"), err.message);
      if (err.detalhes?.campo === "vincular") $("#blocoVincular").hidden = false;
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(fc, err.detalhes);
    }
  }, "Salvando...");
});

ligarAbas();
if (params.get("aba") === "visitantes") trocarAba("visitantes");
carregar();
carregarReservas();
