import { get, post, put, patch } from "../api.js";
import {
  $,
  html,
  moeda,
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
  badgeStatus,
  STATUS_AGENDAMENTO,
  STATUS_PEDIDO, abrirModal, nomesServicos } from "../ui.js";
import { regras, validarForm, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { iniciarPainel } from "./comum.js";

const eu = await iniciarPainel(["ADMIN", "RECEPCIONISTA"]);

const form = $("#clienteForm");
const caixa = $("#formCliente");
mascaraTelefone(form.telefone);
mascaraCpf(form.cpf);
form.data_nascimento.max = new Date().toISOString().slice(0, 10);

let clientes = [];
let temporizador;

async function carregar() {
  const q = new URLSearchParams();
  const busca = $("#buscaCliente").value.trim();
  if (busca) q.set("busca", busca);
  if ($("#mostrarInativos").checked) q.set("inativos", "1");
  try {
    ({ clientes } = await get(`/admin/clientes?${q}`));
    render();
  } catch (err) {
    $("#clientesBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function render() {
  $("#clientesBody").innerHTML = clientes.length
    ? clientes
        .map(
          (c) => html`
        <tr class="${c.ativo ? "" : "inativo"}">
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              ${avatar(c)}
              <span>${c.nome_completo}${c.ativo ? "" : html` <span class="badge badge-accent">DESATIVADO</span>`}</span>
            </div>
          </td>
          <td>${c.email || "—"}</td>
          <td>${c.telefone ? telefoneFormatado(c.telefone) : "—"}</td>
          <td>${c.visitas}</td>
          <td>${moeda(c.total_gasto)}</td>
          <td>${c.ultima_visita ? dataCurta(c.ultima_visita) : "—"}</td>
          <td>
            <div class="admin-acoes">
              <a class="btn btn-ghost btn-sm" href="${`cliente-perfil.html?id=${c.id_usuario}`}">Perfil</a>
              <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${c.id_usuario}">Editar</button>
              <button class="btn btn-ghost btn-sm" data-acao="historico" data-id="${c.id_usuario}">Histórico</button>
              ${c.email && c.ativo
                ? html`<button class="btn btn-ghost btn-sm" data-acao="convite" data-id="${c.id_usuario}" title="Enviar link para criar/redefinir a senha">${c.tem_acesso ? "Redefinir senha" : "Enviar acesso"}</button>`
                : ""}
              ${eu.tipo_perfil === "ADMIN" ? html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${c.ativo ? "desativar" : "reativar"}" data-id="${c.id_usuario}">${c.ativo ? "Excluir" : "Reativar"}</button>` : ""}
            </div>
          </td>
        </tr>`
        )
        .join("")
    : html`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Nenhum cliente encontrado.</td></tr>`.toString();
}

function abrirFormulario(c = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaCliente"), null);
  $("#formTitle").textContent = c ? "Editar Cliente" : "Novo Cliente";
  $("#cliId").value = c?.id_usuario ?? "";
  if (c) {
    form.nome_completo.value = c.nome_completo;
    form.email.value = c.email ?? "";
    form.telefone.value = telefoneFormatado(c.telefone ?? "");
    form.cpf.value = c.cpf ? c.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "";
    form.data_nascimento.value = c.data_nascimento ? c.data_nascimento.slice(0, 10) : "";
    $("#cliVisitas").value = String(c.visitas);
    $("#cliGasto").value = moeda(c.total_gasto);
    $("#cliUltima").value = c.ultima_visita ? dataCurta(c.ultima_visita) : "—";
  }
  $("#grupoConvite").hidden = Boolean(c?.tem_acesso);
  $("#estatisticasCliente").hidden = !c;
  abrirModal(caixa);
  form.nome_completo.focus({ preventScroll: true });
}

$("#btnNovoCliente").addEventListener("click", () => abrirFormulario());
$("#btnCancelar").addEventListener("click", () => caixa.close());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaCliente");
  alertaForm(alerta, null);
  const erros = validarForm(form, {
    nome_completo: regras.nome,
    email: (v) => (!v.trim() ? null : regras.email(v)),
    telefone: regras.telefone,
    cpf: regras.cpfOpcional,
    data_nascimento: regras.dataPassadaOpcional,
  });
  if (form.enviar_convite.checked && !form.email.value.trim()) erros.push({ campo: "email", mensagem: "Informe o e-mail para enviar o acesso." });
  if (mostrarErrosCampos(form, erros)) return;

  const id = $("#cliId").value;
  const dados = {
    nome_completo: form.nome_completo.value,
    email: form.email.value,
    telefone: form.telefone.value,
    cpf: form.cpf.value,
    data_nascimento: form.data_nascimento.value,
    enviar_convite: form.enviar_convite.checked,
  };
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const r = id ? await put(`/admin/clientes/${id}`, dados) : await post("/admin/clientes", dados);
      caixa.close();
      toast(id ? "Cliente atualizado." : "Cliente cadastrado.", "sucesso");
      if (r.aviso) toast(r.aviso, "aviso", 8000);
      else if (dados.enviar_convite) toast("Link de acesso enviado para o e-mail do cliente.", "sucesso");
      await carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
      else if (err.detalhes?.campo) mostrarErrosCampos(form, [{ campo: err.detalhes.campo, mensagem: err.message }]);
    }
  }, "Salvando...");
});

async function mostrarHistorico(c) {
  const caixaH = $("#historicoCliente");
  $("#historicoTitulo").textContent = `Histórico — ${c.nome_completo}`;
  $("#historicoBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">Carregando...</td></tr>`.toString();
  abrirModal(caixaH);
  try {
    const { agendamentos, pedidos } = await get(`/admin/clientes/${c.id_usuario}`);
    const linhas = [
      ...agendamentos.map((a) => ({
        data: a.data_hora_inicio,
        conteudo: html`
          <td>${dataCurta(a.data_hora_inicio)} <span class="text-muted">${hora(a.data_hora_inicio)}</span></td>
          <td>✂️ ${nomesServicos(a)}</td>
          <td>${a.barbeiro.nome_completo}</td>
          <td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td>
          <td>${moeda(a.preco_registrado)}</td>`,
      })),
      ...pedidos.map((p) => ({
        data: p.data_pedido,
        conteudo: html`
          <td>${dataCurta(p.data_pedido)}</td>
          <td>🛍️ ${p.itens.map((i) => `${i.quantidade}x ${i.nome_produto_registrado}`).join(", ")}</td>
          <td>—</td>
          <td>${badgeStatus(STATUS_PEDIDO, p.status)}</td>
          <td>${moeda(p.valor_total)}</td>`,
      })),
    ].sort((a, b) => new Date(b.data) - new Date(a.data));
    $("#historicoBody").innerHTML = linhas.length
      ? linhas.map((l) => html`<tr>${l.conteudo}</tr>`).join("")
      : html`<tr><td colspan="5" class="estado-vazio">Sem atendimentos ou compras.</td></tr>`.toString();
  } catch (err) {
    $("#historicoBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#clientesBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const c = clientes.find((x) => String(x.id_usuario) === b.dataset.id);
  try {
    switch (b.dataset.acao) {
      case "editar":
        return abrirFormulario(c);
      case "historico":
        return mostrarHistorico(c);
      case "convite":
        await comCarregamento(b, async () => {
          const r = await post(`/admin/clientes/${c.id_usuario}/convite`, {});
          toast(r.mensagem, "sucesso");
        }, "Enviando...");
        return;
      case "desativar":
        if (
          !(await confirmar(
            `Excluir ${c.nome_completo}? O cadastro é desativado (não acessa mais o site), mas o histórico de atendimentos e compras é preservado. Você pode reativar depois em "Mostrar desativados".`,
            { titulo: "Excluir cliente", confirmar: "Excluir", perigo: true }
          ))
        )
          return;
        await patch(`/admin/clientes/${c.id_usuario}/ativo`, { ativo: false });
        toast("Cliente desativado.", "sucesso");
        return carregar();
      case "reativar":
        await patch(`/admin/clientes/${c.id_usuario}/ativo`, { ativo: true });
        toast("Cliente reativado.", "sucesso");
        return carregar();
    }
  } catch (err) {
    toast(err.message, "erro");
  }
});

$("#buscaCliente").addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});
$("#mostrarInativos").addEventListener("change", carregar);

carregar();
