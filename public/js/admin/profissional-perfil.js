// Ficha do profissional (o próprio ou, para o administrador, qualquer um).
import { get, put } from "../api.js";
import { $, html, raw, moeda, avatar, dataHora, telefoneFormatado, badgeStatus, STATUS_AGENDAMENTO, abrirModal, toast, alertaForm, comCarregamento, mostrarErrosCampos, mesAno } from "../ui.js";
import { chipsRedes } from "../social.js";
import { rotuloArea } from "../cartoes.js";
import { iniciarPainel } from "./comum.js";

const usuario = await iniciarPainel(["ADMIN", "BARBEIRO"]);
const area = $("#ficha");
const form = $("#formPerfil");
const id = usuario.tipo_perfil === "BARBEIRO" ? usuario.id_usuario : new URLSearchParams(location.search).get("id") ?? usuario.id_usuario;
let p = null;
const linha = (rotulo, valor) => html`<div class="stat-row"><span>${rotulo}</span><span>${valor ?? "—"}</span></div>`;

async function carregar() {
  try {
    const r = await get(`/admin/profissionais/${encodeURIComponent(id)}`);
    p = r.profissional;
    const pp = p.perfil_profissional;
    const e = r.estatisticas;
    area.innerHTML = html`
      <div class="ficha-topo">${avatar(p, "avatar avatar-lg")}
        <div style="flex:1;min-width:200px"><h2 style="font-size:1.3rem">${p.nome_completo}</h2><p class="text-muted">${rotuloArea(pp?.area)} · na equipe desde ${mesAno(p.data_cadastro)}</p>
        ${p.redes_sociais.length ? html`<div class="social-row">${chipsRedes(p.redes_sociais)}</div>` : ""}</div>
        <div class="table-actions"><a class="btn btn-outline btn-sm" href="${`../perfil-publico.html?id=${p.id_usuario}`}">Ver no site</a><button type="button" class="btn btn-primary btn-sm" id="btnEditar">Editar perfil</button></div></div>
      <div class="ficha">
        <div class="admin-card"><h3>Contato</h3>${linha("E-mail", p.email)}${linha("Telefone", p.telefone ? telefoneFormatado(p.telefone) : null)}${p.bio ? html`<p class="text-secondary" style="margin-top:10px;font-size:0.9rem">${p.bio}</p>` : ""}</div>
        <div class="admin-card"><h3>Trabalho</h3>
          ${linha("Atendimentos", String(e.atendimentos))}${linha("Faltas de clientes", String(e.faltas))}${linha("Avaliação", e.avaliacoes ? `★ ${Number(e.media).toFixed(1).replace(".", ",")} (${e.avaliacoes})` : null)}${linha("Experiência", pp?.anos_experiencia != null ? `${pp.anos_experiencia} ano(s)` : null)}${linha("No site", (pp?.visivel_no_site ?? true) ? "Visível" : "Oculto")}
          <p class="text-muted" style="font-size:0.85rem;margin-top:8px">${p.servicos_oferecidos.map((s) => s.nome_servico).join(", ") || "Nenhum serviço vinculado"}</p>
        </div>
        <div class="admin-card"><h3>Especialidades e certificações</h3>
          ${pp?.especialidades.length ? html`<div class="corte-meta" style="margin-bottom:10px">${pp.especialidades.map((x) => html`<span class="badge">${x}</span>`)}</div>` : ""}
          <p class="text-secondary" style="font-size:0.9rem;white-space:pre-line">${pp?.certificacoes ?? "Nenhuma certificação informada."}</p></div>
      </div>
      <div class="admin-card"><h3>Últimos agendamentos</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Status</th><th>Valor</th></tr></thead><tbody>
        ${r.ultimos.length ? r.ultimos.map((a) => html`<tr><td>${dataHora(a.data_hora_inicio)}</td><td>${a.cliente.nome_completo}</td><td>${a.servico.nome_servico}</td><td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td><td>${moeda(a.preco_registrado)}</td></tr>`) : raw('<tr><td colspan="5" class="estado-vazio">Nenhum atendimento.</td></tr>')}
      </tbody></table></div></div>`.toString();
    $("#btnEditar").addEventListener("click", abrir);
  } catch (err) {
    area.innerHTML = html`<p class="estado-vazio">${err.message}</p>`.toString();
  }
}

function abrir() {
  const pp = p.perfil_profissional;
  form.area.value = pp?.area ?? "BARBEARIA";
  form.anos_experiencia.value = pp?.anos_experiencia ?? "";
  form.especialidades.value = (pp?.especialidades ?? []).join(", ");
  form.certificacoes.value = pp?.certificacoes ?? "";
  form.bio.value = p.bio ?? "";
  if (form.visivel_no_site) form.visivel_no_site.checked = pp?.visivel_no_site ?? true;
  alertaForm($("#alertaPerfil"), null);
  abrirModal($("#modalPerfil"));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      await put(`/admin/profissionais/${p.id_usuario}`, {
        area: form.area.value,
        anos_experiencia: form.anos_experiencia.value,
        especialidades: form.especialidades.value.split(",").map((x) => x.trim()).filter(Boolean),
        certificacoes: form.certificacoes.value,
        bio: form.bio.value,
        visivel_no_site: form.visivel_no_site ? form.visivel_no_site.checked : true,
      });
      $("#modalPerfil").close();
      toast("Perfil atualizado.", "sucesso");
      await carregar();
    } catch (err) {
      alertaForm($("#alertaPerfil"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});

carregar();
