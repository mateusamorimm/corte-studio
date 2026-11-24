// Moderação das publicações do feed.
import { get, patch, del } from "../api.js";
import { $, html, urlSegura, avatar, toast, confirmar, dataHora, badgeStatus } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { SITUACAO, botoes, denuncias } from "./moderacao.js";
import { imagemOtimizada } from "../posts.js";

await iniciarPainel(["ADMIN"]);
const filtros = $("#filtros");
const params = new URLSearchParams(location.search);
if (params.get("filtro")) filtros.filtro.value = params.get("filtro");
let temporizador;

async function carregar() {
  const q = new URLSearchParams();
  if (filtros.filtro.value) q.set("filtro", filtros.filtro.value);
  if (filtros.busca.value.trim()) q.set("busca", filtros.busca.value.trim());
  try {
    const { posts } = await get(`/admin/posts?${q}`);
    $("#postsBody").innerHTML = posts.length
      ? posts
          .map(
            (p) => html`
        <tr class="${p.status === "REJEITADO" ? "inativo" : ""}">
          <td><div style="display:flex;gap:8px;align-items:center">${avatar({ nome_completo: p.autor.nome, avatar_url: p.autor.avatar_url })}<span>${p.autor.nome}</span></div></td>
          <td class="celula-texto">${p.texto || "—"}${denuncias(p.denuncias)}</td>
          <td><div class="previas-mini">${p.midias.map((m) =>
            m.tipo === "VIDEO"
              ? html`<a href="${urlSegura(m.url)}" target="_blank" rel="noopener" aria-label="Abrir vídeo"><video src="${urlSegura(m.url)}" preload="metadata" muted></video></a>`
              : html`<a href="${urlSegura(m.url)}" target="_blank" rel="noopener" aria-label="Abrir foto"><img src="${imagemOtimizada(m.url, 120)}" alt="" loading="lazy"></a>`
          )}</div></td>
          <td style="white-space:nowrap">${dataHora(p.data_criacao)}</td>
          <td>♥ ${p.curtidas} · 💬 ${p.comentarios}</td>
          <td>${badgeStatus(SITUACAO, p.status)}</td>
          <td>${botoes(p, p.id_post)}</td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="7" class="estado-vazio">Nenhuma publicação aqui.</td></tr>`.toString();
  } catch (err) {
    $("#postsBody").innerHTML = html`<tr><td colspan="7" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

$("#postsBody").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-decidir]");
  const x = e.target.closest("[data-excluir]");
  try {
    if (d) {
      await patch(`/admin/posts/${d.dataset.id}`, { status: d.dataset.decidir });
      toast(d.dataset.decidir === "APROVADO" ? "Publicação no ar." : "Publicação fora do ar.", "sucesso");
    } else if (x) {
      if (!(await confirmar("Excluir a publicação com fotos, vídeos e comentários? Não dá para desfazer.", { titulo: "Excluir publicação", confirmar: "Excluir", perigo: true }))) return;
      await del(`/admin/posts/${x.dataset.excluir}`);
      toast("Publicação excluída.", "sucesso");
    } else return;
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});
filtros.addEventListener("submit", (e) => e.preventDefault());
filtros.addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});
carregar();
