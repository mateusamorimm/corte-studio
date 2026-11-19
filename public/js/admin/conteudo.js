import { get, post, put, patch, del } from "../api.js";
import { $, html, abrirModal, toast, alertaForm, comCarregamento, confirmar, mostrarErrosCampos, limparErrosCampos, urlSegura, dataCurta, estrelas } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";

await iniciarPainel(["ADMIN"]);

// ───────── Destaque e redes (configuração) ─────────
const fh = $("#formHero");
const fr = $("#formRedes");
const imgHero = campoImagem({ input: $("#hImagem"), botao: $("#btnHeroImg"), previa: $("#hPrevia"), finalidade: "SALAO" });

function preencher(c) {
  fh.hero_titulo.value = c.hero_titulo ?? "";
  fh.hero_subtitulo.value = c.hero_subtitulo ?? "";
  fh.hero_imagem_url.value = c.hero_imagem_url ?? "";
  imgHero.atualizar();
  fr.instagram_url.value = c.instagram_url ?? "";
  fr.tiktok_url.value = c.tiktok_url ?? "";
  fr.url_mapa.value = c.url_mapa ?? "";
}

async function salvarConfig(form, alerta, dados) {
  limparErrosCampos(form);
  alertaForm(alerta, null);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      preencher((await patch("/admin/config", dados)).config);
      toast("Conteúdo salvo. Já está no site.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
}

fh.addEventListener("submit", (e) => {
  e.preventDefault();
  salvarConfig(fh, $("#alertaHero"), {
    hero_titulo: fh.hero_titulo.value,
    hero_subtitulo: fh.hero_subtitulo.value,
    hero_imagem_url: fh.hero_imagem_url.value.trim(),
  });
});
fr.addEventListener("submit", (e) => {
  e.preventDefault();
  salvarConfig(fr, $("#alertaRedes"), {
    instagram_url: fr.instagram_url.value,
    tiktok_url: fr.tiktok_url.value,
    url_mapa: fr.url_mapa.value,
  });
});

// ───────── Galeria ─────────
const fc = $("#formCorte");
const imgCorte = campoImagem({ input: $("#gImagem"), botao: $("#btnCorteImg"), previa: $("#gPrevia"), finalidade: "GALERIA" });
let cortes = [];

async function carregarGaleria() {
  try {
    ({ cortes } = await get("/admin/galeria"));
    $("#galeriaBody").innerHTML = cortes.length
      ? cortes
          .map(
            (c) => html`
        <tr class="${c.ativo ? "" : "inativo"}">
          <td><img class="miniatura" src="${urlSegura(c.imagem_url)}" alt="" loading="lazy" data-fallback="corte"></td>
          <td>${c.nome_corte}${c.ativo ? "" : html` <span class="badge badge-accent">OCULTO</span>`}</td>
          <td>${c.ordem_exibicao}</td>
          <td>❤️ ${c._count.favoritos}</td>
          <td><div class="admin-acoes">
            <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${c.id_corte}">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${c.ativo ? "ocultar" : "mostrar"}" data-id="${c.id_corte}">${c.ativo ? "Excluir" : "Reexibir"}</button>
          </div></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="5" class="estado-vazio">Nenhum corte na galeria.</td></tr>`.toString();
  } catch (err) {
    $("#galeriaBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function abrirCorte(c = null) {
  fc.reset();
  limparErrosCampos(fc);
  alertaForm($("#alertaCorte"), null);
  $("#tituloCorte").textContent = c ? "Editar corte" : "Novo corte";
  $("#gId").value = c?.id_corte ?? "";
  fc.nome_corte.value = c?.nome_corte ?? "";
  fc.ordem_exibicao.value = c?.ordem_exibicao ?? cortes.length + 1;
  fc.imagem_url.value = c?.imagem_url ?? "";
  fc.ativo.checked = c?.ativo ?? true;
  imgCorte.atualizar();
  abrirModal($("#modalCorte"));
}

$("#btnNovoCorte").addEventListener("click", () => abrirCorte());
$("#btnCancelarCorte").addEventListener("click", () => $("#modalCorte").close());

fc.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaCorte");
  alertaForm(alerta, null);
  const erros = [];
  if (!fc.nome_corte.value.trim()) erros.push({ campo: "nome_corte", mensagem: "Informe o nome." });
  if (!fc.imagem_url.value.trim()) erros.push({ campo: "imagem_url", mensagem: "Envie ou informe a imagem." });
  if (mostrarErrosCampos(fc, erros)) return;
  const id = $("#gId").value;
  const dados = {
    nome_corte: fc.nome_corte.value,
    imagem_url: fc.imagem_url.value.trim(),
    ordem_exibicao: fc.ordem_exibicao.value || 0,
    ativo: fc.ativo.checked,
  };
  await comCarregamento(fc.querySelector("[type=submit]"), async () => {
    try {
      if (id) await put(`/admin/galeria/${id}`, dados);
      else await post("/admin/galeria", dados);
      $("#modalCorte").close();
      toast("Galeria atualizada.", "sucesso");
      carregarGaleria();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(fc, err.detalhes);
    }
  }, "Salvando...");
});

$("#galeriaBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const c = cortes.find((x) => String(x.id_corte) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return abrirCorte(c);
    if (b.dataset.acao === "ocultar") {
      if (!(await confirmar(`Excluir "${c.nome_corte}" da galeria? Ele deixa de aparecer no site e nos favoritos dos clientes. Você pode reexibir depois.`, { titulo: "Excluir da galeria", confirmar: "Excluir", perigo: true }))) return;
      await del(`/admin/galeria/${c.id_corte}`);
    } else {
      await put(`/admin/galeria/${c.id_corte}`, { nome_corte: c.nome_corte, imagem_url: c.imagem_url, ordem_exibicao: c.ordem_exibicao, ativo: true });
    }
    toast("Galeria atualizada.", "sucesso");
    carregarGaleria();
  } catch (err) {
    toast(err.message, "erro");
  }
});

// ───────── Avaliações ─────────
async function carregarAvaliacoes() {
  try {
    const { avaliacoes } = await get("/admin/avaliacoes");
    $("#avaliacoesBody").innerHTML = avaliacoes.length
      ? avaliacoes
          .map(
            (a) => html`
        <tr class="${a.visivel ? "" : "inativo"}">
          <td>${dataCurta(a.data_avaliacao)}</td>
          <td>${a.agendamento.cliente.nome_completo}</td>
          <td>${a.agendamento.servico.nome_servico}<br><small class="text-muted">${a.agendamento.barbeiro.nome_completo}</small></td>
          <td class="stars" style="white-space:nowrap;">${estrelas(a.nota)}</td>
          <td style="max-width:320px;">${a.comentario ?? "—"}</td>
          <td><button class="btn btn-ghost btn-sm" data-visivel="${a.visivel ? "0" : "1"}" data-id="${a.id_avaliacao}">${a.visivel ? "Ocultar" : "Mostrar"}</button></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="6" class="estado-vazio">Nenhuma avaliação ainda.</td></tr>`.toString();
  } catch (err) {
    $("#avaliacoesBody").innerHTML = html`<tr><td colspan="6" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#avaliacoesBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-visivel]");
  if (!b) return;
  try {
    await patch(`/admin/avaliacoes/${b.dataset.id}`, { visivel: b.dataset.visivel === "1" });
    toast(b.dataset.visivel === "1" ? "Avaliação visível no site." : "Avaliação ocultada do site.", "sucesso");
    carregarAvaliacoes();
  } catch (err) {
    toast(err.message, "erro");
  }
});

try {
  preencher((await get("/admin/config")).config);
} catch (err) {
  toast(err.message, "erro");
}
carregarGaleria();
carregarAvaliacoes();
