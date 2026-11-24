// Publicações do feed: cartão (layout do colega), curtidas, comentários, denúncia, exclusão e formulário.
import { get, post, put, del, enviarImagem, enviarMidia } from "./api.js";
import { $, html, raw, urlSegura, avatar, toast, tempoRelativo, comCarregamento, confirmar, alertaForm, validarArquivoImagem } from "./ui.js";

// Versão reduzida e comprimida pelo Cloudinary (só muda o endereço de exibição)
export const imagemOtimizada = (url, largura = 1080) =>
  urlSegura(url).replace(/^(https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/)/, `$1f_auto,q_auto,c_limit,w_${largura}/`);

const STATUS = { PENDENTE: "Aguardando aprovação do salão", REJEITADO: "Não aprovada pelo salão" };
const linkPerfil = (a) => `perfil-publico.html?id=${a.id_usuario}`;

function midias(lista, texto) {
  if (!lista.length) return "";
  return html`<div class="media${lista.length > 1 ? " media-grade" : ""}">${lista.map((m) =>
    m.tipo === "VIDEO"
      ? html`<video src="${urlSegura(m.url)}" controls preload="metadata" playsinline></video>`
      : html`<a href="${urlSegura(m.url)}" target="_blank" rel="noopener" aria-label="Abrir imagem"><img src="${imagemOtimizada(m.url)}" alt="${texto ? `Foto da publicação: ${texto.slice(0, 80)}` : "Foto da publicação"}" loading="lazy" data-fallback="corte"></a>`
  )}</div>`;
}

export const cartaoPost = (p, usuario) => html`
  <article class="feed-card" data-post="${p.id_post}">
    <div class="post-header">
      <a href="${linkPerfil(p.autor)}">
        ${avatar({ nome_completo: p.autor.nome, avatar_url: p.autor.avatar_url })}
        <div>
          <div class="name">${p.autor.nome}${p.autor.equipe ? html` <span class="badge badge-accent">Equipe</span>` : ""}</div>
          <div class="time">${tempoRelativo(p.data_criacao)}</div>
        </div>
      </a>
      <div class="post-menu">
        ${p.meu || usuario?.tipo_perfil === "ADMIN" ? html`<button type="button" class="btn btn-ghost btn-sm" data-excluir-post aria-label="Excluir publicação">Excluir</button>` : ""}
        ${!p.meu && usuario ? html`<button type="button" class="btn btn-ghost btn-sm" data-denunciar="post" aria-label="Denunciar publicação">Denunciar</button>` : ""}
      </div>
    </div>
    ${STATUS[p.status] ? html`<p class="form-alert form-alert-info" style="margin-bottom:10px">${STATUS[p.status]}</p>` : ""}
    ${p.texto ? html`<p class="post-texto">${p.texto}</p>` : ""}
    ${midias(p.midias, p.texto)}
    ${p.status === "APROVADO"
      ? html`<div class="post-acoes">
          <button type="button" class="like-btn${p.curtiu ? " liked" : ""}" data-curtir aria-pressed="${p.curtiu ? "true" : "false"}" aria-label="${p.curtiu ? "Descurtir" : "Curtir"}">${p.curtiu ? "♥" : "♡"} <span>${p.curtidas}</span></button>
          <button type="button" class="like-btn" data-comentarios aria-expanded="false">💬 <span>${p.comentarios}</span></button>
        </div>
        <div class="post-comentarios" hidden></div>`
      : ""}
  </article>`;

const comentario = (c, usuario, postMeu) => html`
  <div class="post-comentario" data-comentario="${c.id_comentario}">
    <a href="${linkPerfil(c.autor)}">${avatar({ nome_completo: c.autor.nome, avatar_url: c.autor.avatar_url })}</a>
    <div class="corpo">
      <div><a href="${linkPerfil(c.autor)}" class="name">${c.autor.nome}</a> <span class="time">${tempoRelativo(c.data_criacao)}</span></div>
      <p>${c.texto}</p>
      ${STATUS[c.status] ? html`<small class="text-muted">${c.status === "PENDENTE" ? "Aguardando aprovação" : "Não aprovado"}</small>` : ""}
    </div>
    ${c.meu || postMeu || usuario?.tipo_perfil === "ADMIN"
      ? html`<button type="button" class="btn btn-ghost btn-sm" data-excluir-comentario aria-label="Excluir comentário">✕</button>`
      : usuario
        ? html`<button type="button" class="btn btn-ghost btn-sm" data-denunciar="comentario" aria-label="Denunciar comentário" title="Denunciar">⚑</button>`
        : ""}
  </div>`;

function pedirMotivo(titulo) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal modal-sm";
    dlg.innerHTML = html`
      <form method="dialog" class="modal-body">
        <h3 class="modal-title">${titulo}</h3>
        <div class="form-group">
          <label class="form-label" for="dMotivo">O que há de errado?</label>
          <textarea class="form-textarea" id="dMotivo" rows="3" maxlength="300" required></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-cancelar>Cancelar</button>
          <button value="ok" class="btn btn-primary btn-sm">Denunciar</button>
        </div>
      </form>`.toString();
    document.body.appendChild(dlg);
    $("[data-cancelar]", dlg).addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok" ? $("#dMotivo", dlg).value.trim() : null);
      dlg.remove();
    });
    dlg.showModal();
  });
}

const irParaLogin = () => (location.href = `login.html?voltar=${encodeURIComponent(location.pathname + location.search)}`);

// Liga as ações de uma lista de publicações. posts: array mutável com os dados exibidos.
export function ligarPosts(raiz, { posts, usuario, aoExcluir = null }) {
  const achar = (el) => posts.find((p) => String(p.id_post) === el.closest("[data-post]")?.dataset.post);

  raiz.addEventListener("click", async (e) => {
    const p = e.target.closest("[data-post]") ? achar(e.target) : null;
    if (!p) return;
    const cartao = e.target.closest("[data-post]");
    const curtir = e.target.closest("[data-curtir]");
    const abrir = e.target.closest("[data-comentarios]");
    const excluir = e.target.closest("[data-excluir-post]");
    const excluirCom = e.target.closest("[data-excluir-comentario]");
    const denunciar = e.target.closest("[data-denunciar]");
    try {
      if (curtir) {
        if (!usuario) return irParaLogin();
        curtir.disabled = true;
        const r = await (p.curtiu ? del : put)(`/feed/${p.id_post}/curtida`);
        Object.assign(p, r);
        curtir.disabled = false;
        curtir.classList.toggle("liked", p.curtiu);
        curtir.setAttribute("aria-pressed", String(p.curtiu));
        curtir.setAttribute("aria-label", p.curtiu ? "Descurtir" : "Curtir");
        curtir.innerHTML = html`${p.curtiu ? "♥" : "♡"} <span>${p.curtidas}</span>`.toString();
      } else if (abrir) {
        const area = $(".post-comentarios", cartao);
        area.hidden = !area.hidden;
        abrir.setAttribute("aria-expanded", String(!area.hidden));
        if (!area.hidden) await carregarComentarios(p, area);
      } else if (excluir) {
        if (!(await confirmar("Excluir esta publicação com as fotos, vídeos e comentários? Não dá para desfazer.", { titulo: "Excluir publicação", confirmar: "Excluir", perigo: true }))) return;
        await del(`/feed/${p.id_post}`);
        posts.splice(posts.indexOf(p), 1);
        cartao.remove();
        toast("Publicação excluída.", "sucesso");
        aoExcluir?.();
      } else if (excluirCom) {
        if (!(await confirmar("Excluir este comentário?", { titulo: "Excluir comentário", confirmar: "Excluir", perigo: true }))) return;
        const linha = excluirCom.closest("[data-comentario]");
        await del(`/feed/comentarios/${linha.dataset.comentario}`);
        linha.remove();
        p.comentarios = Math.max(0, p.comentarios - 1);
        $("[data-comentarios] span", cartao).textContent = String(p.comentarios);
      } else if (denunciar) {
        const ehPost = denunciar.dataset.denunciar === "post";
        const motivo = await pedirMotivo(ehPost ? "Denunciar publicação" : "Denunciar comentário");
        if (!motivo) return;
        const id = ehPost ? p.id_post : denunciar.closest("[data-comentario]").dataset.comentario;
        const r = await post(ehPost ? `/feed/${id}/denuncia` : `/feed/comentarios/${id}/denuncia`, { motivo });
        toast(r.mensagem, "sucesso", 6000);
      }
    } catch (err) {
      if (curtir) curtir.disabled = false;
      toast(err.message, "erro");
    }
  });

  raiz.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-form-comentario]");
    if (!form) return;
    e.preventDefault();
    const p = achar(form);
    const texto = form.texto.value.trim();
    if (!texto) return;
    await comCarregamento(form.querySelector("[type=submit]"), async () => {
      try {
        const r = await post(`/feed/${p.id_post}/comentarios`, { texto });
        form.reset();
        $(".lista", form.parentElement).insertAdjacentHTML("beforeend", comentario(r.comentario, usuario, p.meu).toString());
        $(".lista .estado-vazio", form.parentElement)?.remove();
        if (r.aviso) toast(r.aviso, "info", 6000);
        else {
          p.comentarios += 1;
          $("[data-comentarios] span", form.closest("[data-post]")).textContent = String(p.comentarios);
        }
      } catch (err) {
        toast(err.message, "erro");
      }
    }, "...");
  });

  async function carregarComentarios(p, area) {
    area.innerHTML = '<p class="text-muted" style="font-size:0.85rem">Carregando...</p>';
    const { comentarios } = await get(`/feed/${p.id_post}/comentarios`);
    area.innerHTML = html`
      <div class="lista">${comentarios.length ? comentarios.map((c) => comentario(c, usuario, p.meu)) : html`<p class="estado-vazio" style="padding:12px">Seja o primeiro a comentar.</p>`}</div>
      ${usuario
        ? html`<form class="form-comentario" data-form-comentario>
            <input class="form-input" name="texto" maxlength="500" placeholder="Escreva um comentário..." aria-label="Comentário" autocomplete="off" required>
            <button type="submit" class="btn btn-primary btn-sm">Enviar</button>
          </form>`
        : html`<p class="text-muted" style="font-size:0.85rem"><a href="login.html?voltar=${encodeURIComponent(location.pathname + location.search)}" style="color:var(--accent)">Entre</a> para comentar.</p>`}`.toString();
  }
}

// ───────── Nova publicação ─────────
const MAX_ARQUIVOS = 6;
const VIDEOS = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_VIDEO = 60 * 1024 * 1024;

export function montarCompositor(raiz, { aoPublicar }) {
  raiz.innerHTML = html`
    <form class="card compositor" novalidate>
      <label class="form-label" for="npTexto">Nova publicação</label>
      <div class="form-alert" data-alerta hidden></div>
      <textarea class="form-textarea" id="npTexto" name="texto" rows="3" maxlength="1000" placeholder="Compartilhe seu visual, uma dica ou como foi o atendimento..."></textarea>
      <div class="compositor-previas" data-previas></div>
      <div class="compositor-acoes">
        <label class="btn btn-outline btn-sm">📷 Fotos e vídeos
          <input type="file" name="arquivos" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple hidden>
        </label>
        <button type="submit" class="btn btn-primary btn-sm">Publicar</button>
      </div>
      <small class="form-hint">Até ${MAX_ARQUIVOS} arquivos. Fotos JPG, PNG ou WebP; vídeos MP4, WebM ou MOV de até 60 MB. Só publique imagens suas ou autorizadas.</small>
    </form>`.toString();
  const form = $("form", raiz);
  const alerta = $("[data-alerta]", raiz);
  const previas = $("[data-previas]", raiz);
  let arquivos = [];

  function desenhar() {
    previas.querySelectorAll("[data-url]").forEach((el) => URL.revokeObjectURL(el.dataset.url));
    previas.innerHTML = arquivos
      .map((a, i) => {
        const url = URL.createObjectURL(a);
        return html`<div class="previa" data-url="${url}">${a.type.startsWith("video/") ? html`<div class="previa-video">🎬<small>${a.name}</small></div>` : html`<img src="${url}" alt="">`}<button type="button" data-tirar="${i}" aria-label="Remover ${a.name}">✕</button></div>`;
      })
      .join("");
  }

  form.arquivos.addEventListener("change", () => {
    alertaForm(alerta, null);
    for (const a of form.arquivos.files) {
      const erro = VIDEOS.includes(a.type) ? (a.size > MAX_VIDEO ? "Vídeo muito grande. O limite é 60 MB." : null) : validarArquivoImagem(a);
      if (erro) alertaForm(alerta, `${a.name}: ${erro}`);
      else if (arquivos.length >= MAX_ARQUIVOS) alertaForm(alerta, `No máximo ${MAX_ARQUIVOS} arquivos por publicação.`);
      else arquivos.push(a);
    }
    form.arquivos.value = "";
    desenhar();
  });
  previas.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tirar]");
    if (!b) return;
    arquivos.splice(Number(b.dataset.tirar), 1);
    desenhar();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertaForm(alerta, null);
    const texto = form.texto.value.trim();
    if (!texto && !arquivos.length) return alertaForm(alerta, "Escreva algo ou escolha uma foto ou vídeo.");
    await comCarregamento(form.querySelector("[type=submit]"), async () => {
      try {
        const ids = [];
        for (const a of arquivos) {
          const video = a.type.startsWith("video/");
          const m = video
            ? await enviarMidia(a, { finalidade: "POST", tipo: "VIDEO" })
            : await enviarImagem(a, { finalidade: "POST", registro: true });
          ids.push(m.id_midia);
        }
        const r = await post("/feed", { texto, midias: ids });
        form.reset();
        arquivos = [];
        desenhar();
        toast(r.aviso ?? "Publicado!", r.aviso ? "info" : "sucesso", 6000);
        aoPublicar(r.post);
      } catch (err) {
        alertaForm(alerta, err.message);
      }
    }, "Publicando...");
  });
  return raw("");
}
