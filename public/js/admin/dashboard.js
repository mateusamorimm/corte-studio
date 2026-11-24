import { get, post } from "../api.js";
import { $, html, moeda, hora, dataCurta, dataHora, nomesServicos, tempoRelativo, badgeStatus, STATUS_AGENDAMENTO, toast } from "../ui.js";
import { iniciarPainel } from "./comum.js";

const usuario = await iniciarPainel(["ADMIN", "RECEPCIONISTA"]);
const admin = usuario.tipo_perfil === "ADMIN";

// Atalhos e ponto da recepção
$("#atalhos").innerHTML = [
  ["agendamentos.html", "📅", "Agenda"],
  ["pedidos.html", "📦", "Pedidos e reservas"],
  ["clientes.html", "👥", "Clientes"],
  ...(admin ? [["posts.html", "📰", "Moderar feed"], ["comentarios.html", "💬", "Avaliações"], ["fidelidade.html", "🎁", "Fidelidade"]] : []),
]
  .map(([href, ico, nome]) => html`<a class="atalho" href="${href}"><span class="ico" aria-hidden="true">${ico}</span>${nome}</a>`)
  .join("");

async function montarPonto() {
  const { pontos } = await get("/admin/meu-ponto");
  const aberto = pontos[0]?.tipo === "ENTRADA";
  $("#pontoCard").hidden = false;
  $("#pontoCard").innerHTML = html`
    <h3>Meu ponto</h3>
    <p class="text-muted" style="font-size:0.9rem;margin-bottom:12px">${pontos[0] ? `Último registro: ${aberto ? "entrada" : "saída"} em ${dataHora(pontos[0].em)}` : "Nenhum registro ainda."}</p>
    <button type="button" class="btn btn-primary btn-sm" id="btnPonto">${aberto ? "Registrar SAÍDA" : "Registrar ENTRADA"}</button>`.toString();
  $("#btnPonto").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await post("/admin/meu-ponto", { tipo: aberto ? "SAIDA" : "ENTRADA" });
      toast("Ponto registrado.", "sucesso");
      await montarPonto();
    } catch (err) {
      toast(err.message, "erro");
    }
  });
}
if (!admin) montarPonto().catch((err) => toast(err.message, "erro"));

$("#formBusca").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#buscaAgendamento").value.trim();
  location.href = `agendamentos.html${q ? `?busca=${encodeURIComponent(q)}` : ""}`;
});

const ICONES = { favorito: "❤️", avaliacao: "⭐", agendamento: "📅", pedido: "🛍️", cadastro: "👤" };
function textoAtividade(a) {
  switch (a.tipo) {
    case "favorito":
      return html`<strong>${a.quem}</strong> curtiu o corte <span class="text-accent">${a.alvo}</span>`;
    case "avaliacao":
      return html`<strong>${a.quem}</strong> avaliou ${a.alvo} com ${a.nota}★${a.profissional ? ` — ${a.profissional}` : ""}`;
    case "agendamento":
      return html`<strong>${a.quem}</strong> agendou ${a.alvo} p/ ${dataCurta(a.inicio)} às ${hora(a.inicio)}`;
    case "pedido":
      return html`<strong>${a.quem}</strong> fez um pedido de ${a.itens} item(ns) — ${moeda(a.valor)}`;
    default:
      return html`<strong>${a.quem}</strong> criou uma conta`;
  }
}

function render(d) {
  const m = d.metricas;
  const [ano, mes, dia] = d.hoje.split("-");
  $("#badgeHoje").textContent = `Hoje · ${dia}/${mes}`;
  void ano;

  $("#mClientes").textContent = m.total_clientes.toLocaleString("pt-BR");
  $("#mClientesDelta").textContent = `▲ +${m.novos_clientes_mes} novo${m.novos_clientes_mes === 1 ? "" : "s"} este mês`;
  $("#mHoje").textContent = String(m.atendimentos_hoje);
  $("#mHojeDelta").textContent = `▲ ${m.confirmados_hoje} confirmado${m.confirmados_hoje === 1 ? "" : "s"}`;
  $("#mFaturamento").closest(".metric-card").hidden = m.faturamento_mes === null; // recepção não vê faturamento
  $("#mFaturamento").textContent = moeda(m.faturamento_mes);
  const v = m.variacao_faturamento === null ? null : Number(m.variacao_faturamento);
  $("#mFaturamentoDelta").textContent = v === null ? "Sem base no mês anterior" : `${v >= 0 ? "▲ +" : "▼ "}${v.toLocaleString("pt-BR")}% vs mês anterior`;
  if (v !== null && v < 0) $("#mFaturamentoDelta").style.color = "var(--accent)";
  $("#mAvaliacao").textContent = m.avaliacao_media ? `${Number(m.avaliacao_media).toFixed(1).replace(".", ",")} ★` : "—";
  $("#mAvaliacaoDelta").textContent = m.total_avaliacoes ? `Baseado em ${m.total_avaliacoes} avaliaç${m.total_avaliacoes === 1 ? "ão" : "ões"}` : "Nenhuma avaliação ainda";

  $("#agendamentosBody").innerHTML = d.proximos.length
    ? d.proximos
        .map(
          (a) => html`
      <tr>
        <td style="color:var(--accent);font-weight:600;">${hora(a.data_hora_inicio)}</td>
        <td>${a.cliente.nome_completo}</td>
        <td>${nomesServicos(a)}</td>
        <td>${a.barbeiro.nome_completo}</td>
        <td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="5" class="estado-vazio">Nenhum atendimento marcado para hoje.</td></tr>`.toString();

  $("#atividadeList").innerHTML = d.atividade.length
    ? d.atividade
        .map(
          (a) => html`
      <div class="atividade-item">
        <span>${ICONES[a.tipo]}</span>
        <div>
          <div>${textoAtividade(a)}</div>
          <div class="time">${tempoRelativo(a.quando)}</div>
        </div>
      </div>`
        )
        .join("")
    : html`<p class="estado-vazio">Nenhuma atividade ainda.</p>`.toString();

  const max = Math.max(1, ...d.populares.map((p) => p.quantidade));
  $("#popularesList").innerHTML = d.populares.length
    ? d.populares
        .map(
          (p, i) => html`
      <div class="popular-item">
        <span style="width:140px;">${i + 1}. ${p.nome_servico}</span>
        <div class="popular-bar"><span style="width:${Math.round((p.quantidade / max) * 100)}%"></span></div>
        <span style="width:70px;text-align:right;color:var(--text-muted);font-size:0.8rem;">${p.quantidade} atend.</span>
      </div>`
        )
        .join("")
    : html`<p class="estado-vazio">Sem atendimentos registrados ainda.</p>`.toString();

  if (d.solicitacoes_senha.length) {
    $("#avisosCard").style.display = "block";
    $("#avisosList").innerHTML = d.solicitacoes_senha
      .map(
        (s) => html`
      <div class="atividade-item">
        <span>🔑</span>
        <div>
          <div>Solicitação de <strong>${s.nome}</strong> <span class="text-muted">(${s.email})</span></div>
          <div class="time">${tempoRelativo(s.data)} · ${s.usado ? "link utilizado ou substituído" : "link enviado por e-mail"}</div>
        </div>
      </div>`
      )
      .join("");
  }

  // Notificações
  const n = d.notificacoes;
  const avisos = [
    ["📅", "agendamentos.html?status=PENDENTE", n.agendamentos_pendentes, "agendamento(s) aguardando confirmação"],
    ["🛍️", "pedidos.html?status=PENDENTE", n.pedidos_pendentes, "pedido(s) para separar"],
    ["🎟️", "pedidos.html?aba=visitantes", n.reservas_visitante, "reserva(s) de visitantes"],
    ["⭐", "comentarios.html?status=PENDENTE", n.avaliacoes_pendentes, "avaliação(ões) para aprovar"],
    ["📰", "posts.html?filtro=PENDENTE", n.posts_pendentes, "publicação(ões) para aprovar"],
    ["💬", "comentarios.html?aba=feed&status=PENDENTE", n.comentarios_pendentes, "comentário(s) para aprovar"],
    ["⚑", "posts.html?filtro=DENUNCIADO", n.denuncias, "denúncia(s) aberta(s)"],
  ].filter((a) => a[2] !== undefined);
  const total = avisos.reduce((t, a) => t + a[2], 0);
  const btn = $("#btnNotif");
  if (total) {
    const c = document.createElement("span");
    c.className = "notif-contador";
    c.textContent = total > 99 ? "99+" : String(total);
    btn.appendChild(c);
    btn.setAttribute("aria-label", `Notificações: ${total} pendente(s)`);
  }
  $("#painelNotif").innerHTML = html`
    <h3 style="margin-bottom:12px;">Pendências</h3>
    ${avisos.map(([ico, href, qtd, texto]) => html`<div class="atividade-item"><span aria-hidden="true">${ico}</span><div><a href="${href}">${qtd} ${texto}</a></div></div>`)}`.toString();
}

$("#btnNotif").addEventListener("click", (e) => {
  e.stopPropagation();
  const painel = $("#painelNotif");
  painel.hidden = !painel.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!painel.hidden));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".notif-wrap")) $("#painelNotif").hidden = true;
});

try {
  render(await get("/admin/dashboard"));
} catch (err) {
  toast(`Não foi possível carregar o painel: ${err.message}`, "erro", 8000);
}
