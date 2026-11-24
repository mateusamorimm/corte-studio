// Galeria de cortes: administradores editam todos; cada profissional, os que publicou. O 3D é opcional.
import { get, post, put, del, enviarMidia } from "../api.js";
import { $, html, urlSegura, abrirModal, toast, alertaForm, comCarregamento, confirmar, mostrarErrosCampos, limparErrosCampos } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";
import { rotuloArea } from "../cartoes.js";

const usuario = await iniciarPainel(["ADMIN", "BARBEIRO"]);
const form = $("#formCorte");
const imagem = campoImagem({ input: $("#gImagem"), botao: $("#btnCorteImg"), previa: $("#gPrevia"), finalidade: "GALERIA" });
let cortes = [];

async function carregar() {
  try {
    ({ cortes } = await get("/admin/galeria"));
    $("#galeriaBody").innerHTML = cortes.length
      ? cortes
          .map(
            (c) => html`
        <tr class="${c.ativo ? "" : "inativo"}">
          <td><img class="thumb" src="${urlSegura(c.imagem_url)}" alt="" loading="lazy" data-fallback="corte"></td>
          <td>${c.nome_corte}${c.ativo ? "" : html` <span class="badge badge-accent">OCULTO</span>`}${c.autor ? html`<br><small>por ${c.autor.nome_completo}</small>` : ""}</td>
          <td>${rotuloArea(c.area)}</td>
          <td>${c.modelo_3d_url ? "🧊 Sim" : "Só foto"}</td>
          <td>❤️ ${c._count.favoritos}</td>
          <td><div class="table-actions">
            <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${c.id_corte}">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${c.ativo ? "ocultar" : "mostrar"}" data-id="${c.id_corte}">${c.ativo ? "Excluir" : "Reexibir"}</button>
          </div></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="6" class="estado-vazio">${usuario.tipo_perfil === "BARBEIRO" ? "Você ainda não publicou cortes." : "Nenhum corte na galeria."}</td></tr>`.toString();
  } catch (err) {
    $("#galeriaBody").innerHTML = html`<tr><td colspan="6" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

const CAMPOS = ["nome_corte", "area", "imagem_url", "descricao", "duracao_ref_minutos", "preco_ref", "ordem_exibicao", "modelo_3d_url"];
const dados = (c) => ({ ...Object.fromEntries(CAMPOS.map((k) => [k, c[k] ?? ""])), ordem_exibicao: c.ordem_exibicao ?? 0, ativo: c.ativo });

function abrir(c = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaCorte"), null);
  $("#tituloCorte").textContent = c ? "Editar corte" : "Novo corte";
  $("#gId").value = c?.id_corte ?? "";
  if (c) for (const k of CAMPOS) form[k].value = c[k] ?? "";
  form.ordem_exibicao.value = c?.ordem_exibicao ?? cortes.length + 1;
  form.ativo.checked = c?.ativo ?? true;
  $("#bloco3d").open = Boolean(c?.modelo_3d_url);
  imagem.atualizar();
  abrirModal($("#modalCorte"));
}
$("#btnNovoCorte").addEventListener("click", () => abrir());

// ───────── 3D opcional ─────────
function escolherGlb() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".glb,model/gltf-binary";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
$("#btn3d").addEventListener("click", async (e) => {
  const botao = e.currentTarget;
  const arquivo = await escolherGlb();
  if (!arquivo) return;
  if (!/\.glb$/i.test(arquivo.name)) return toast("Escolha um arquivo .glb.", "erro");
  if (arquivo.size > 10 * 1024 * 1024) return toast("O modelo 3D pode ter até 10 MB.", "erro");
  await comCarregamento(botao, async () => {
    try {
      form.modelo_3d_url.value = (await enviarMidia(arquivo, { finalidade: "CORTE_3D", tipo: "MODELO_3D" })).url;
      toast("Modelo 3D enviado. Salve o corte para publicar.", "sucesso");
    } catch (err) {
      toast(err.message, "erro");
    }
  }, "Enviando...");
});
$("#btnSem3d").addEventListener("click", () => (form.modelo_3d_url.value = ""));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaCorte");
  alertaForm(alerta, null);
  const erros = [];
  if (!form.nome_corte.value.trim()) erros.push({ campo: "nome_corte", mensagem: "Informe o nome." });
  if (!form.imagem_url.value.trim()) erros.push({ campo: "imagem_url", mensagem: "Envie a foto do corte." });
  if (mostrarErrosCampos(form, erros)) return;
  const id = $("#gId").value;
  const corpo = { ...Object.fromEntries(CAMPOS.map((k) => [k, form[k].value.trim()])), ativo: form.ativo.checked };
  corpo.ordem_exibicao ||= 0;
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      if (id) await put(`/admin/galeria/${id}`, corpo);
      else await post("/admin/galeria", corpo);
      $("#modalCorte").close();
      toast("Galeria atualizada.", "sucesso");
      carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) {
        if (err.detalhes.some((d) => d.campo === "modelo_3d_url")) $("#bloco3d").open = true;
        mostrarErrosCampos(form, err.detalhes);
      }
    }
  }, "Salvando...");
});

$("#galeriaBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const c = cortes.find((x) => String(x.id_corte) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return abrir(c);
    if (b.dataset.acao === "ocultar") {
      if (!(await confirmar(`Excluir "${c.nome_corte}" da galeria? Ele deixa de aparecer no site e nos favoritos dos clientes. Você pode reexibir depois.`, { titulo: "Excluir da galeria", confirmar: "Excluir", perigo: true }))) return;
      await del(`/admin/galeria/${c.id_corte}`);
    } else await put(`/admin/galeria/${c.id_corte}`, { ...dados(c), ativo: true });
    toast("Galeria atualizada.", "sucesso");
    carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

carregar();
