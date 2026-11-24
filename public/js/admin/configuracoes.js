import { get, post, put, patch, del } from "../api.js";
import { $, html, toast, alertaForm, comCarregamento, confirmar, abrirModal, mostrarErrosCampos, limparErrosCampos, telefoneFormatado } from "../ui.js";
import { detectarRede, redePorId } from "../social.js";
import { regras, mascaraTelefone } from "../validacao.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN"]);

const salao = $("#formSalao");
const agenda = $("#formAgenda");
const reservas = $("#formReservas");
const CAIXAS = ["falta_automatica", "avaliacao_requer_aprovacao", "entrega_ativa"];
mascaraTelefone(salao.telefone);
mascaraTelefone(salao.whatsapp);

function preencher(c) {
  salao.nome_salao.value = c.nome_salao ?? "";
  salao.endereco.value = c.endereco ?? "";
  salao.telefone.value = c.telefone ? telefoneFormatado(c.telefone) : "";
  salao.whatsapp.value = c.whatsapp ? telefoneFormatado(c.whatsapp.replace(/^55/, "")) : "";
  salao.email_contato.value = c.email_contato ?? "";
  salao.horario_funcionamento_texto.value = c.horario_funcionamento_texto ?? "";
  salao.slogan.value = c.slogan ?? "";
  salao.sobre.value = c.sobre ?? "";
  for (const campo of ["prazo_retirada_dias", "tolerancia_falta_minutos", "aviso_entrega_on", "aviso_entrega_off"]) reservas[campo].value = c[campo] ?? "";
  for (const campo of CAIXAS) reservas[campo].checked = Boolean(c[campo]);
  agenda.intervalo_slots_minutos.value = c.intervalo_slots_minutos;
  agenda.janela_agendamento_dias.value = c.janela_agendamento_dias;
  agenda.antecedencia_minima_minutos.value = c.antecedencia_minima_minutos;
  agenda.antecedencia_cancelamento_hrs.value = c.antecedencia_cancelamento_hrs;
}

async function salvar(form, alerta, dados, mensagem) {
  limparErrosCampos(form);
  alertaForm(alerta, null);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const { config } = await patch("/admin/config", dados);
      preencher(config);
      toast(mensagem, "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
}

salao.addEventListener("submit", (e) => {
  e.preventDefault();
  const erros = [];
  if (!salao.nome_salao.value.trim()) erros.push({ campo: "nome_salao", mensagem: "Informe o nome do salão." });
  for (const campo of ["telefone", "whatsapp"]) {
    if (salao[campo].value.trim() && regras.telefone(salao[campo].value)) erros.push({ campo, mensagem: "Informe com DDD." });
  }
  if (salao.email_contato.value.trim() && regras.email(salao.email_contato.value)) erros.push({ campo: "email_contato", mensagem: "E-mail inválido." });
  if (mostrarErrosCampos(salao, erros)) return;
  salvar(
    salao,
    $("#alertaSalao"),
    {
      nome_salao: salao.nome_salao.value,
      slogan: salao.slogan.value,
      sobre: salao.sobre.value,
      endereco: salao.endereco.value,
      telefone: salao.telefone.value,
      whatsapp: salao.whatsapp.value,
      email_contato: salao.email_contato.value,
      horario_funcionamento_texto: salao.horario_funcionamento_texto.value,
    },
    "Dados do salão salvos."
  );
});

agenda.addEventListener("submit", (e) => {
  e.preventDefault();
  salvar(
    agenda,
    $("#alertaAgenda"),
    {
      intervalo_slots_minutos: agenda.intervalo_slots_minutos.value,
      janela_agendamento_dias: agenda.janela_agendamento_dias.value,
      antecedencia_minima_minutos: agenda.antecedencia_minima_minutos.value,
      antecedencia_cancelamento_hrs: agenda.antecedencia_cancelamento_hrs.value,
    },
    "Regras de agendamento salvas."
  );
});

reservas.addEventListener("submit", (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(["prazo_retirada_dias", "tolerancia_falta_minutos", "aviso_entrega_on", "aviso_entrega_off"].map((c) => [c, reservas[c].value]));
  for (const c of CAIXAS) dados[c] = reservas[c].checked;
  salvar(reservas, $("#alertaReservas"), dados, "Configurações salvas.");
});

// ───────── Contatos oficiais ─────────
const fc = $("#formContato");
let contatos = [];
let editando = null;
async function carregarContatos() {
  ({ contatos } = await get("/admin/contatos"));
  $("#contatosLista").innerHTML = contatos.length
    ? contatos
        .map(
          (c) => html`<div class="hist-item"><span>${redePorId(c.tipo).ico} <strong>${c.rotulo}</strong>${c.publico ? "" : html` <span class="badge">oculto</span>`}<br><small class="text-muted">${c.valor}</small></span>
          <span class="table-actions"><button type="button" class="btn btn-ghost btn-sm" data-editar="${c.id_contato}">Editar</button><button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent)" data-excluir="${c.id_contato}">Excluir</button></span></div>`
        )
        .join("")
    : html`<p class="text-muted">Nenhum contato extra.</p>`.toString();
}
function abrirContato(c = null) {
  editando = c;
  fc.reset();
  alertaForm($("#alertaContato"), null);
  $("#ctDetectado").textContent = "";
  if (c) for (const campo of ["url", "rotulo", "valor", "ordem"]) fc[campo].value = c[campo];
  fc.publico.checked = c?.publico ?? true;
  abrirModal($("#modalContato"));
}
$("#btnContato").addEventListener("click", () => abrirContato());
fc.url.addEventListener("change", () => {
  const r = detectarRede(fc.url.value);
  $("#ctDetectado").textContent = r ? `${redePorId(r.rede).ico} ${r.rotulo}` : "Endereço inválido";
  if (r && !fc.rotulo.value) fc.rotulo.value = r.rotulo;
  if (r && !fc.valor.value) fc.valor.value = r.url.replace(/^(https:\/\/(www\.)?|mailto:|tel:)/, "").replace(/\/$/, "");
});
fc.addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = detectarRede(fc.url.value);
  if (!r) return alertaForm($("#alertaContato"), "Informe um link, e-mail ou telefone válido.");
  const dados = { tipo: r.rede, url: r.url, rotulo: fc.rotulo.value, valor: fc.valor.value, ordem: fc.ordem.value || 0, publico: fc.publico.checked };
  await comCarregamento(fc.querySelector("[type=submit]"), async () => {
    try {
      if (editando) await put(`/admin/contatos/${editando.id_contato}`, dados);
      else await post("/admin/contatos", dados);
      $("#modalContato").close();
      toast("Contato salvo.", "sucesso");
      await carregarContatos();
    } catch (err) {
      alertaForm($("#alertaContato"), err.message);
    }
  }, "Salvando...");
});
$("#contatosLista").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-editar]");
  const ex = e.target.closest("[data-excluir]");
  if (ed) return abrirContato(contatos.find((c) => String(c.id_contato) === ed.dataset.editar));
  if (!ex || !(await confirmar("Excluir este contato do site?", { titulo: "Excluir contato", confirmar: "Excluir", perigo: true }))) return;
  try {
    await del(`/admin/contatos/${ex.dataset.excluir}`);
    await carregarContatos();
  } catch (err) {
    toast(err.message, "erro");
  }
});
carregarContatos().catch((err) => toast(err.message, "erro"));

try {
  preencher((await get("/admin/config")).config);
} catch (err) {
  toast(err.message, "erro");
}
