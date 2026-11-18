import { get, patch } from "../api.js";
import { $, toast, alertaForm, comCarregamento, mostrarErrosCampos, limparErrosCampos, telefoneFormatado } from "../ui.js";
import { regras, mascaraTelefone } from "../validacao.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN"]);

const salao = $("#formSalao");
const agenda = $("#formAgenda");
mascaraTelefone(salao.telefone);
mascaraTelefone(salao.whatsapp);

function preencher(c) {
  salao.nome_salao.value = c.nome_salao ?? "";
  salao.endereco.value = c.endereco ?? "";
  salao.telefone.value = c.telefone ? telefoneFormatado(c.telefone) : "";
  salao.whatsapp.value = c.whatsapp ? telefoneFormatado(c.whatsapp.replace(/^55/, "")) : "";
  salao.email_contato.value = c.email_contato ?? "";
  salao.horario_funcionamento_texto.value = c.horario_funcionamento_texto ?? "";
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

try {
  preencher((await get("/admin/config")).config);
} catch (err) {
  toast(err.message, "erro");
}
