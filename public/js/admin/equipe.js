import { get, post, put, patch } from "../api.js";
import {
  $,
  $$,
  html,
  avatar,
  toast,
  alertaForm,
  comCarregamento,
  confirmar,
  mostrarErrosCampos,
  limparErrosCampos,
  telefoneFormatado, abrirModal } from "../ui.js";
import { regras, validarForm, mascaraTelefone } from "../validacao.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";

const eu = await iniciarPainel(["ADMIN"]);

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const form = $("#equipeForm");
const caixa = $("#formEquipe");
const foto = campoImagem({ input: $("#eqFoto"), botao: $("#btnFoto"), previa: $("#eqPrevia"), finalidade: "EQUIPE" });
mascaraTelefone(form.telefone);

let equipe = [];
let servicos = [];

async function carregar() {
  try {
    const [e, s] = await Promise.all([get("/admin/equipe"), get("/admin/servicos")]);
    equipe = e.equipe;
    servicos = s.servicos.filter((x) => x.ativo);
    render();
  } catch (err) {
    $("#equipeBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function resumoSemana(disp) {
  if (!disp.length) return html`<span class="text-muted">Sem expediente</span>`;
  const porDia = new Map();
  for (const d of disp) porDia.set(d.dia_semana, [...(porDia.get(d.dia_semana) ?? []), `${d.inicio}–${d.fim}`]);
  // Agrupa dias seguidos com o mesmo horário: "Seg–Sáb 09:00–12:00, 13:00–19:00"
  const grupos = [];
  for (const [dia, faixas] of [...porDia.entries()].sort((a, b) => a[0] - b[0])) {
    const texto = faixas.join(", ");
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.texto === texto && ultimo.fim === dia - 1) ultimo.fim = dia;
    else grupos.push({ inicio: dia, fim: dia, texto });
  }
  return grupos.map(
    (g) => html`<div><strong>${CURTO[g.inicio]}${g.fim !== g.inicio ? `–${CURTO[g.fim]}` : ""}</strong> ${g.texto}</div>`
  );
}

function render() {
  $("#equipeBody").innerHTML = equipe.length
    ? equipe
        .map((m) => {
          const nomes = servicos.filter((s) => m.servicos.includes(s.id_servico)).map((s) => s.nome_servico);
          return html`
        <tr class="${m.ativo ? "" : "inativo"}">
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              ${avatar(m)}
              <span>${m.nome_completo}${m.id_usuario === eu.id_usuario ? " (você)" : ""}<br><small class="text-muted">${m.email}${m.telefone ? ` · ${telefoneFormatado(m.telefone)}` : ""}</small>
              ${m.ativo ? "" : html`<br><span class="badge badge-accent">DESATIVADO</span>`}${m.tem_acesso ? "" : html`<br><span class="badge badge-warning">AGUARDANDO SENHA</span>`}</span>
            </div>
          </td>
          <td>${m.tipo_perfil === "ADMIN" ? "Administrador" : "Profissional"}</td>
          <td style="max-width:240px;">${nomes.length ? nomes.join(", ") : html`<span class="text-muted">Nenhum (não aparece no agendamento)</span>`}</td>
          <td style="font-size:0.85rem;">${resumoSemana(m.disponibilidade)}</td>
          <td>
            <div class="admin-acoes">
              <a class="btn btn-ghost btn-sm" href="${`profissional-perfil.html?id=${m.id_usuario}`}">Perfil</a>
              <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${m.id_usuario}">Editar</button>
              ${m.ativo ? html`<button class="btn btn-ghost btn-sm" data-acao="convite" data-id="${m.id_usuario}">${m.tem_acesso ? "Redefinir senha" : "Reenviar convite"}</button>` : ""}
              ${m.id_usuario === eu.id_usuario
                ? ""
                : html`<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${m.ativo ? "desativar" : "reativar"}" data-id="${m.id_usuario}">${m.ativo ? "Desativar" : "Reativar"}</button>`}
            </div>
          </td>
        </tr>`;
        })
        .join("")
    : html`<tr><td colspan="5" class="estado-vazio">Nenhum profissional cadastrado.</td></tr>`.toString();
}

// ───────── Semana ─────────
function linhaIntervalo(inicio = "09:00", fim = "18:00") {
  return html`
    <div class="semana-intervalo">
      <input type="time" class="form-input" value="${inicio}" data-campo="inicio" aria-label="Início" step="300">
      <span class="text-muted">às</span>
      <input type="time" class="form-input" value="${fim}" data-campo="fim" aria-label="Fim" step="300">
      <button type="button" class="btn btn-ghost btn-sm" data-remover-intervalo aria-label="Remover intervalo">✕</button>
    </div>`;
}

function montarSemana(disp = []) {
  $("#eqSemana").innerHTML = DIAS.map(
    (nome, dia) => html`
    <div class="semana-linha" data-dia="${dia}">
      <strong style="padding-top:8px;">${nome}</strong>
      <div class="semana-intervalos">
        ${disp.filter((d) => d.dia_semana === dia).map((d) => linhaIntervalo(d.inicio, d.fim))}
        <button type="button" class="btn btn-ghost btn-sm" style="align-self:flex-start;" data-add-intervalo>+ intervalo</button>
      </div>
    </div>`
  ).join("");
}

$("#eqSemana").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add-intervalo]");
  const rem = e.target.closest("[data-remover-intervalo]");
  if (add) {
    const anteriores = add.parentElement.querySelectorAll(".semana-intervalo");
    const ultimoFim = anteriores.length ? anteriores[anteriores.length - 1].querySelector('[data-campo="fim"]').value : null;
    add.insertAdjacentHTML("beforebegin", linhaIntervalo(ultimoFim ?? "09:00", ultimoFim ? "20:00" : "18:00").toString());
  } else if (rem) rem.closest(".semana-intervalo").remove();
});

function lerSemana() {
  return $$(".semana-linha").flatMap((linha) =>
    $$(".semana-intervalo", linha).map((i) => ({
      dia_semana: Number(linha.dataset.dia),
      inicio: i.querySelector('[data-campo="inicio"]').value,
      fim: i.querySelector('[data-campo="fim"]').value,
    }))
  );
}

// ───────── Formulário ─────────
function abrir(m = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaEquipe"), null);
  $("#formTitle").textContent = m ? "Editar Profissional" : "Novo Profissional";
  $("#eqId").value = m?.id_usuario ?? "";
  $("#dicaConvite").hidden = Boolean(m);
  form.nome_completo.value = m?.nome_completo ?? "";
  form.email.value = m?.email ?? "";
  form.telefone.value = m?.telefone ? telefoneFormatado(m.telefone) : "";
  form.tipo_perfil.value = m?.tipo_perfil ?? "BARBEIRO";
  form.avatar_url.value = m?.avatar_url ?? "";
  foto.atualizar();
  const pp = m?.perfil_profissional;
  form.usuario.value = m?.usuario ?? "";
  form.area.value = pp?.area ?? "BARBEARIA";
  form.especialidades.value = (pp?.especialidades ?? []).join(", ");
  form.anos_experiencia.value = pp?.anos_experiencia ?? "";
  form.certificacoes.value = pp?.certificacoes ?? "";
  form.bio.value = m?.bio ?? "";
  form.visivel_no_site.checked = pp?.visivel_no_site ?? true;
  $("#eqServicos").innerHTML = servicos.length
    ? servicos
        .map(
          (s) => html`<label class="check-item"><input type="checkbox" value="${s.id_servico}" ${m?.servicos.includes(s.id_servico) ? "checked" : ""}> ${s.icone ?? ""} ${s.nome_servico}</label>`
        )
        .join("")
    : html`<span class="text-muted">Cadastre serviços primeiro.</span>`.toString();
  montarSemana(m?.disponibilidade ?? []);
  abrirModal(caixa);
}

$("#btnNovo").addEventListener("click", () => abrir());
$("#btnCancelar").addEventListener("click", () => caixa.close());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaEquipe");
  alertaForm(alerta, null);
  const erros = validarForm(form, {
    nome_completo: regras.nome,
    email: regras.email,
    telefone: (v) => (!v.trim() ? null : regras.telefone(v)),
  });
  if (mostrarErrosCampos(form, erros)) return;
  const disponibilidade = lerSemana();
  const invalido = disponibilidade.find((d) => !d.inicio || !d.fim || d.fim <= d.inicio);
  if (invalido) return alertaForm(alerta, `${DIAS[invalido.dia_semana]}: o fim do intervalo deve ser depois do início.`);

  const id = $("#eqId").value;
  const dados = {
    nome_completo: form.nome_completo.value,
    email: form.email.value,
    telefone: form.telefone.value,
    tipo_perfil: form.tipo_perfil.value,
    avatar_url: form.avatar_url.value.trim(),
    servicos: $$("#eqServicos input:checked").map((i) => Number(i.value)),
    disponibilidade,
    usuario: form.usuario.value,
    perfil: {
      area: form.area.value,
      especialidades: form.especialidades.value.split(",").map((x) => x.trim()).filter(Boolean),
      anos_experiencia: form.anos_experiencia.value,
      certificacoes: form.certificacoes.value,
      bio: form.bio.value,
      visivel_no_site: form.visivel_no_site.checked,
    },
  };
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const r = id ? await put(`/admin/equipe/${id}`, dados) : await post("/admin/equipe", dados);
      caixa.close();
      toast(id ? "Profissional atualizado." : "Profissional cadastrado. O convite foi enviado por e-mail.", "sucesso", 6000);
      if (r.aviso) toast(r.aviso, "aviso", 8000);
      await carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});

$("#equipeBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const m = equipe.find((x) => String(x.id_usuario) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return abrir(m);
    if (b.dataset.acao === "convite") {
      await comCarregamento(b, async () => toast((await post(`/admin/equipe/${m.id_usuario}/convite`, {})).mensagem, "sucesso"), "Enviando...");
      return;
    }
    const ativo = b.dataset.acao === "reativar";
    if (!ativo && !(await confirmar(`Desativar ${m.nome_completo}? A pessoa perde o acesso e sai do agendamento; o histórico é mantido.`, { titulo: "Desativar profissional", confirmar: "Desativar", perigo: true }))) return;
    await patch(`/admin/equipe/${m.id_usuario}/ativo`, { ativo });
    toast(ativo ? "Profissional reativado." : "Profissional desativado.", "sucesso");
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

carregar();
