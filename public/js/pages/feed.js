// Feed da comunidade: publicar (com conta), ler, curtir e comentar.
import { get } from "../api.js";
import { $, html, toast, comCarregamento } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { cartaoPost, ligarPosts, montarCompositor } from "../posts.js";

const lista = $("#feedList");
const posts = [];
let proximo = null;

const { usuario } = await iniciarVitrine();

if (usuario) {
  montarCompositor($("#compositor"), {
    aoPublicar(p) {
      $(".estado-vazio", lista)?.remove();
      posts.unshift(p);
      lista.insertAdjacentHTML("afterbegin", cartaoPost(p, usuario).toString());
    },
  });
} else {
  const voltar = encodeURIComponent("/feed.html");
  $("#compositor").innerHTML = html`<p class="card compositor-convite"><a href="login.html?voltar=${voltar}" style="color:var(--accent)">Entre</a> ou <a href="cadastro.html?voltar=${voltar}" style="color:var(--accent)">crie sua conta</a> para publicar, curtir e comentar.</p>`.toString();
}

const vazio = () => {
  if (!posts.length) lista.innerHTML = html`<p class="estado-vazio">Ainda não há publicações. Que tal compartilhar o seu visual?</p>`.toString();
};
ligarPosts(lista, { posts, usuario, aoExcluir: vazio });

async function carregar() {
  const r = await get(`/feed${proximo ? `?cursor=${proximo}` : ""}`);
  if (!posts.length) lista.innerHTML = "";
  posts.push(...r.posts);
  lista.insertAdjacentHTML("beforeend", r.posts.map((p) => cartaoPost(p, usuario)).join(""));
  proximo = r.proximo;
  $("#btnMais").hidden = !proximo;
  vazio();
}

$("#btnMais").addEventListener("click", (e) =>
  comCarregamento(e.currentTarget, () => carregar().catch((err) => toast(err.message, "erro")), "Carregando...")
);

try {
  await carregar();
} catch (err) {
  lista.innerHTML = html`<p class="estado-vazio">${err.message}</p>`.toString();
}
