import { get, post, put, del } from "../api.js";
import { $, html, moeda, toast, alertaForm, comCarregamento, confirmar, mostrarErrosCampos, limparErrosCampos, abrirModal } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { rotuloArea } from "../cartoes.js";

await iniciarPainel(["ADMIN"]);

const form = $("#servicoForm");
const caixa = $("#formServico");
let servicos = [];

async function carregar() {
  try {
    ({ servicos } = await get("/admin/servicos"));
    render();
  } catch (err) {
    $("#servicosBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function render() {
  $("#servicosBody").innerHTML = servicos.length
    ? servicos
        .map(
          (s) => html`
      <tr class="${s.ativo ? "" : "inativo"}">
        <td>${s.icone || "✂️"} ${s.nome_servico}${s.ativo ? "" : html` <span class="badge badge-accent">INATIVO</span>`} <span class="badge">${rotuloArea(s.area)}</span>
          ${s._count.barbeiros ? "" : html`<br><small class="text-muted">⚠ Nenhum profissional atende este serviço</small>`}</td>
        <td style="max-width:320px;">${s.descricao ?? ""}</td>
        <td style="color:var(--accent);font-weight:600;">${s.preco_a_partir_de ? "A partir de " : ""}${moeda(s.preco)}</td>
        <td>${s.duracao_minutos} min</td>
        <td>
          <div class="admin-acoes">
            <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${s.id_servico}">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${s.ativo ? "desativar" : "reativar"}" data-id="${s.id_servico}">${s.ativo ? "Desativar" : "Reativar"}</button>
          </div>
        </td>
      </tr>`
        )
        .join("")
    : html`<tr><td colspan="5" class="estado-vazio">Nenhum serviço cadastrado.</td></tr>`.toString();
}

function abrir(s = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaServico"), null);
  $("#formTitle").textContent = s ? "Editar Serviço" : "Novo Serviço";
  $("#srvId").value = s?.id_servico ?? "";
  if (s) {
    form.nome_servico.value = s.nome_servico;
    form.icone.value = s.icone ?? "";
    form.descricao.value = s.descricao ?? "";
    form.preco.value = Number(s.preco).toFixed(2);
    form.duracao_minutos.value = s.duracao_minutos;
    form.area.value = s.area;
    form.ordem_exibicao.value = s.ordem_exibicao;
    form.preco_a_partir_de.checked = s.preco_a_partir_de;
    form.ativo.checked = s.ativo;
  } else {
    form.duracao_minutos.value = 30;
    form.ordem_exibicao.value = servicos.length + 1;
  }
  abrirModal(caixa);
}

const dadosDoForm = (s = {}) => ({
  nome_servico: form.nome_servico.value,
  icone: form.icone.value,
  descricao: form.descricao.value,
  preco: form.preco.value,
  duracao_minutos: form.duracao_minutos.value,
  area: form.area.value,
  ordem_exibicao: form.ordem_exibicao.value || 0,
  preco_a_partir_de: form.preco_a_partir_de.checked,
  ativo: form.ativo.checked,
  imagem_url: s.imagem_url ?? null,
});

$("#btnNovoServico").addEventListener("click", () => abrir());
$("#btnCancelar").addEventListener("click", () => caixa.close());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaServico");
  alertaForm(alerta, null);
  const erros = [];
  if (!form.nome_servico.value.trim()) erros.push({ campo: "nome_servico", mensagem: "Informe o nome." });
  if (form.preco.value === "" || Number(form.preco.value) < 0) erros.push({ campo: "preco", mensagem: "Informe um preço válido." });
  const d = Number(form.duracao_minutos.value);
  if (!Number.isInteger(d) || d < 5 || d > 480) erros.push({ campo: "duracao_minutos", mensagem: "Entre 5 e 480 minutos." });
  if (mostrarErrosCampos(form, erros)) return;
  const id = $("#srvId").value;
  const atual = servicos.find((s) => String(s.id_servico) === id);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      if (id) await put(`/admin/servicos/${id}`, dadosDoForm(atual));
      else await post("/admin/servicos", dadosDoForm());
      caixa.close();
      toast(id ? "Serviço atualizado." : "Serviço criado. Lembre-se de vinculá-lo aos profissionais em Equipe.", "sucesso", 6000);
      await carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});

$("#servicosBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const s = servicos.find((x) => String(x.id_servico) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return abrir(s);
    if (b.dataset.acao === "desativar") {
      if (!(await confirmar(`Desativar "${s.nome_servico}"? Ele deixa de aparecer no site e no agendamento; o histórico é mantido.`, { titulo: "Desativar serviço", confirmar: "Desativar", perigo: true }))) return;
      await del(`/admin/servicos/${s.id_servico}`);
      toast("Serviço desativado.", "sucesso");
    } else {
      await put(`/admin/servicos/${s.id_servico}`, { ...s, preco: s.preco, ativo: true });
      toast("Serviço reativado.", "sucesso");
    }
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

carregar();
