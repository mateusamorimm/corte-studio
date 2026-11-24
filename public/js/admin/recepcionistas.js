// Recepcionistas: ficha completa (só ADMIN), acesso, ponto e desligamento.
import { get, post, put, patch } from "../api.js";
import {
  $,
  html,
  avatar,
  abrirModal,
  toast,
  alertaForm,
  comCarregamento,
  confirmar,
  mostrarErrosCampos,
  limparErrosCampos,
  dataSemFuso,
  dataHora,
  telefoneFormatado,
  hojeIso,
} from "../ui.js";
import { regras, validarForm, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";

await iniciarPainel(["ADMIN"]);
const form = $("#formRecep");
const fd = $("#formDesligar");
const foto = campoImagem({ input: $("#rcFoto"), botao: $("#btnRcFoto"), previa: $("#rcPrevia"), finalidade: "EQUIPE" });
mascaraTelefone(form.telefone);
mascaraTelefone(form.whatsapp);
mascaraCpf(form.cpf);
let lista = [];
let atual = null;

const VINCULO = { CLT: "CLT", FREELANCE: "Freelance", ESTAGIO: "Estágio" };
const FUNC = ["vinculo", "status_contrato", "motivo_saida", "cpf", "rg", "ctps", "pis", "cnh", "emergencia", "endereco", "cidade", "uf", "cep", "observacoes"];
const DATAS = ["data_entrada", "data_saida"];

async function carregar() {
  try {
    ({ recepcionistas: lista } = await get("/admin/recepcionistas"));
    $("#recepBody").innerHTML = lista.length
      ? lista
          .map((r) => {
            const f = r.funcionario;
            return html`
        <tr class="${r.ativo ? "" : "inativo"}">
          <td><div style="display:flex;gap:10px;align-items:center">${avatar(r)}<span>${r.nome_completo}<br><small>${r.email}${r.telefone ? ` · ${telefoneFormatado(r.telefone)}` : ""}</small></span></div></td>
          <td>${VINCULO[f.vinculo]}</td>
          <td>${f.cpf ?? "—"}</td>
          <td style="white-space:nowrap">${f.data_entrada ? dataSemFuso(f.data_entrada) : "—"}${f.data_saida ? html`<br>${dataSemFuso(f.data_saida)}` : ""}</td>
          <td>${r.ultimo_ponto ? html`${r.ultimo_ponto.tipo === "ENTRADA" ? "Entrada" : "Saída"}<br><small>${dataHora(r.ultimo_ponto.em)}</small>` : "—"}</td>
          <td>${f.status_contrato === "DESLIGADO" ? html`<span class="badge badge-accent">DESLIGADA</span>` : r.ativo ? html`<span class="badge badge-success">ATIVA</span>` : html`<span class="badge">SEM ACESSO</span>`}${r.tem_acesso ? "" : html`<br><small>aguardando senha</small>`}</td>
          <td><div class="table-actions">
            <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${r.id_usuario}">Ficha</button>
            <button class="btn btn-ghost btn-sm" data-acao="ponto" data-id="${r.id_usuario}">Ponto</button>
            ${r.ativo ? html`<button class="btn btn-ghost btn-sm" data-acao="convite" data-id="${r.id_usuario}">${r.tem_acesso ? "Redefinir senha" : "Reenviar convite"}</button>` : ""}
            <button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${r.ativo ? "desativar" : "reativar"}" data-id="${r.id_usuario}">${r.ativo ? "Desativar" : "Reativar"}</button>
          </div></td>
        </tr>`;
          })
          .join("")
      : html`<tr><td colspan="7" class="estado-vazio">Nenhuma recepcionista cadastrada.</td></tr>`.toString();
  } catch (err) {
    $("#recepBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

async function abrir(r = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaRecep"), null);
  $("#tituloRecep").textContent = r ? "Ficha da recepcionista" : "Nova recepcionista";
  $("#rcId").value = r?.id_usuario ?? "";
  $("#dicaConvite").hidden = Boolean(r);
  if (r) {
    const { recepcionista } = await get(`/admin/recepcionistas/${r.id_usuario}`);
    const f = recepcionista.funcionario;
    for (const c of ["nome_completo", "email", "usuario", "avatar_url"]) form[c].value = recepcionista[c] ?? "";
    form.telefone.value = telefoneFormatado(recepcionista.telefone ?? "");
    form.whatsapp.value = recepcionista.whatsapp ? telefoneFormatado(recepcionista.whatsapp.replace(/^55/, "")) : "";
    for (const c of FUNC) form[c].value = f[c] ?? "";
    for (const c of DATAS) form[c].value = f[c] ? f[c].slice(0, 10) : "";
    if (f.cpf) form.cpf.value = f.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    form.vinculo.value = f.vinculo;
    form.status_contrato.value = f.status_contrato;
  }
  foto.atualizar();
  abrirModal($("#modalRecep"));
}
$("#btnNovo").addEventListener("click", () => abrir());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm($("#alertaRecep"), null);
  const telOpc = (v) => (!v.trim() ? null : regras.telefone(v));
  const erros = validarForm(form, { nome_completo: regras.nome, email: regras.email, telefone: telOpc, whatsapp: telOpc, cpf: regras.cpfOpcional });
  if (mostrarErrosCampos(form, erros)) return;
  const id = $("#rcId").value;
  const dados = Object.fromEntries(["nome_completo", "email", "usuario", "telefone", "whatsapp", "avatar_url", ...FUNC, ...DATAS].map((c) => [c, form[c].value]));
  if (!dados.cpf) dados.cpf = null;
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const r = id ? await put(`/admin/recepcionistas/${id}`, dados) : await post("/admin/recepcionistas", dados);
      $("#modalRecep").close();
      toast(id ? "Ficha atualizada." : "Recepcionista cadastrada. O convite foi enviado por e-mail.", "sucesso", 6000);
      if (r.aviso) toast(r.aviso, "aviso", 8000);
      await carregar();
    } catch (err) {
      alertaForm($("#alertaRecep"), err.message);
      $("#alertaRecep").scrollIntoView({ block: "center" });
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});

// ───────── Ponto e desligamento ─────────
async function mostrarPonto(r) {
  atual = r;
  const { pontos } = await get(`/admin/recepcionistas/${r.id_usuario}/ponto`);
  const aberto = pontos[0]?.tipo === "ENTRADA";
  const desligada = r.funcionario.status_contrato === "DESLIGADO";
  $("#tituloPonto").textContent = `Ponto — ${r.nome_completo}`;
  fd.hidden = true;
  $("#acoesPonto").innerHTML = r.ativo
    ? html`<button type="button" class="btn btn-primary btn-sm" data-ponto="${aberto ? "SAIDA" : "ENTRADA"}">${aberto ? "Registrar SAÍDA" : "Registrar ENTRADA"}</button>
        ${desligada ? "" : html`<button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent)" data-desligar>Registrar desligamento</button>`}`.toString()
    : html`<p class="text-muted">${desligada ? "Contrato encerrado." : "Sem acesso ativo: reative para registrar o ponto."}</p>`.toString();
  $("#pontoBody").innerHTML = pontos.length
    ? pontos.map((p) => html`<tr><td>${dataHora(p.em)}</td><td>${p.tipo === "ENTRADA" ? "🟢 Entrada" : "🔴 Saída"}</td><td>${p.observacao ?? "—"}</td></tr>`).join("")
    : html`<tr><td colspan="3" class="estado-vazio">Nenhum registro.</td></tr>`.toString();
  if (!$("#modalPonto").open) abrirModal($("#modalPonto"));
}
$("#acoesPonto").addEventListener("click", async (e) => {
  const p = e.target.closest("[data-ponto]");
  if (e.target.closest("[data-desligar]")) {
    fd.hidden = !fd.hidden;
    fd.data_saida.value ||= hojeIso();
    return;
  }
  if (!p) return;
  await comCarregamento(p, async () => {
    try {
      await post(`/admin/recepcionistas/${atual.id_usuario}/ponto`, { tipo: p.dataset.ponto });
      await carregar();
      await mostrarPonto(lista.find((r) => r.id_usuario === atual.id_usuario));
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "...");
});
fd.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!(await confirmar(`Desligar ${atual.nome_completo}? O acesso é encerrado; a ficha e o ponto são mantidos.`, { titulo: "Desligamento", confirmar: "Desligar", perigo: true }))) return;
  try {
    await post(`/admin/recepcionistas/${atual.id_usuario}/desligamento`, { data_saida: fd.data_saida.value, motivo: fd.motivo.value });
    $("#modalPonto").close();
    toast("Desligamento registrado.", "sucesso");
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

$("#recepBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const r = lista.find((x) => String(x.id_usuario) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return await abrir(r);
    if (b.dataset.acao === "ponto") return await mostrarPonto(r);
    if (b.dataset.acao === "convite") return toast((await post(`/admin/recepcionistas/${r.id_usuario}/convite`, {})).mensagem, "sucesso");
    const ativo = b.dataset.acao === "reativar";
    if (!ativo && !(await confirmar(`Desativar o acesso de ${r.nome_completo}?`, { titulo: "Desativar acesso", confirmar: "Desativar", perigo: true }))) return;
    await patch(`/admin/recepcionistas/${r.id_usuario}/ativo`, { ativo });
    toast(ativo ? "Acesso reativado." : "Acesso desativado.", "sucesso");
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

carregar();
