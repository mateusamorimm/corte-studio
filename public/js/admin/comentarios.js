// Aprovação das avaliações e moderação dos comentários do feed.
import { get, patch, del } from "../api.js";
import { $, html, estrelas, toast, confirmar, dataCurta, dataHora, badgeStatus } from "../ui.js";
import { iniciarPainel, ligarAbas, trocarAba } from "./comum.js";
import { SITUACAO, botoes, denuncias } from "./moderacao.js";

await iniciarPainel(["ADMIN"]);
const params = new URLSearchParams(location.search);
const fa = $("#filtroAvaliacoes");
const ff = $("#filtroFeed");
if (params.get("aba") === "feed") ff.filtro.value = params.get("status") ?? "";
else fa.status.value = params.get("status") ?? "";

async function carregarAvaliacoes() {
  try {
    const { avaliacoes } = await get(`/admin/avaliacoes${fa.status.value ? `?status=${fa.status.value}` : ""}`);
    $("#avaliacoesBody").innerHTML = avaliacoes.length
      ? avaliacoes
          .map(
            (a) => html`
        <tr class="${a.visivel && a.status_moderacao !== "REJEITADO" ? "" : "inativo"}">
          <td style="white-space:nowrap">${dataCurta(a.data_avaliacao)}</td>
          <td>${a.cliente}</td>
          <td>${a.referencia}${a.profissional ? html`<br><small>${a.profissional}</small>` : ""}</td>
          <td><span class="stars" style="white-space:nowrap">${estrelas(a.nota)}</span>${a.notas.map((n) => html`<br><small>${n.nome}: ${n.nota}★</small>`)}</td>
          <td class="celula-texto">${a.comentario ?? "—"}</td>
          <td>${badgeStatus(SITUACAO, a.status_moderacao)}${a.visivel ? "" : html`<br><small>oculta</small>`}</td>
          <td>${botoes({ status: a.status_moderacao }, a.id_avaliacao, { excluir: false })}
            ${a.status_moderacao === "APROVADO" ? html`<button class="btn btn-ghost btn-sm" data-visivel="${a.visivel ? "0" : "1"}" data-id="${a.id_avaliacao}">${a.visivel ? "Ocultar" : "Mostrar"}</button>` : ""}</td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="7" class="estado-vazio">Nenhuma avaliação aqui.</td></tr>`.toString();
  } catch (err) {
    $("#avaliacoesBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#avaliacoesBody").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-decidir]");
  const v = e.target.closest("[data-visivel]");
  if (!d && !v) return;
  try {
    const dados = d ? { status_moderacao: d.dataset.decidir } : { visivel: v.dataset.visivel === "1" };
    await patch(`/admin/avaliacoes/${(d ?? v).dataset.id}`, dados);
    toast("Avaliação atualizada.", "sucesso");
    await carregarAvaliacoes();
  } catch (err) {
    toast(err.message, "erro");
  }
});

async function carregarComentarios() {
  try {
    const { comentarios } = await get(`/admin/comentarios${ff.filtro.value ? `?filtro=${ff.filtro.value}` : ""}`);
    $("#comentariosBody").innerHTML = comentarios.length
      ? comentarios
          .map(
            (c) => html`
        <tr class="${c.status === "REJEITADO" ? "inativo" : ""}">
          <td style="white-space:nowrap">${dataHora(c.data_criacao)}</td>
          <td>${c.autor.nome}</td>
          <td class="celula-texto">${c.texto}${denuncias(c.denuncias)}</td>
          <td class="celula-texto"><small>${c.post.texto ? `${c.post.texto.slice(0, 80)}${c.post.texto.length > 80 ? "…" : ""}` : `Publicação nº ${c.post.id_post}`}</small></td>
          <td>${badgeStatus(SITUACAO, c.status)}</td>
          <td>${botoes(c, c.id_comentario)}</td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="6" class="estado-vazio">Nenhum comentário aqui.</td></tr>`.toString();
  } catch (err) {
    $("#comentariosBody").innerHTML = html`<tr><td colspan="6" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#comentariosBody").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-decidir]");
  const x = e.target.closest("[data-excluir]");
  try {
    if (d) await patch(`/admin/comentarios/${d.dataset.id}`, { status: d.dataset.decidir });
    else if (x) {
      if (!(await confirmar("Excluir este comentário?", { titulo: "Excluir comentário", confirmar: "Excluir", perigo: true }))) return;
      await del(`/admin/comentarios/${x.dataset.excluir}`);
    } else return;
    toast("Comentário atualizado.", "sucesso");
    await carregarComentarios();
  } catch (err) {
    toast(err.message, "erro");
  }
});

for (const [f, fn] of [[fa, carregarAvaliacoes], [ff, carregarComentarios]]) {
  f.addEventListener("submit", (e) => e.preventDefault());
  f.addEventListener("change", fn);
}
ligarAbas();
if (params.get("aba") === "feed") trocarAba("feed");
carregarAvaliacoes();
carregarComentarios();
