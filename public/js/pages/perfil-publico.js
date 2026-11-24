// Perfil público de clientes e profissionais, conforme a privacidade de cada um (definida no servidor).
import { get } from "../api.js";
import { $, html, urlSegura, avatar, mesAno, moeda, telefoneFormatado, iniciais } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { cartaoPost, ligarPosts } from "../posts.js";
import { chipsRedes } from "../social.js";
import { cartaoCorte, rotuloArea, alternarFavorito } from "../cartoes.js";
import { abrirCorte } from "../corteModal.js";
import { iniciarAgendamento, abrirAgendamento, retomarRascunho } from "../agendamento.js";

const area = $("#perfil");
const { usuario, config } = await iniciarVitrine();
iniciarAgendamento({ usuario, config });
const id = new URLSearchParams(location.search).get("id");

const nota = (a) => (a?.total ? `★ ${Number(a.media).toFixed(1).replace(".", ",")} (${a.total} ${a.total > 1 ? "avaliações" : "avaliação"})` : null);
const lista = (itens, vazio) => (itens.length ? itens : html`<p class="text-muted" style="font-size:0.9rem">${vazio}</p>`);

function cabecalho(p, meta) {
  const capa = urlSegura(p.capa_url);
  return html`
    <div class="perfil-header">
      <div class="perfil-banner">${capa ? html`<img src="${capa}" alt="">` : ""}</div>
      <div class="perfil-avatar-wrap">${p.avatar_url ? avatar({ ...p, nome_completo: p.nome }, "perfil-avatar") : html`<span class="perfil-avatar avatar-iniciais" aria-hidden="true">${iniciais(p.nome)}</span>`}</div>
      <div class="perfil-info">
        <h1>${p.nome}${p.tipo !== "CLIENTE" ? html` <span class="badge badge-accent">${p.tipo === "PROFISSIONAL" ? "Profissional" : "Equipe"}</span>` : ""}</h1>
        <div class="perfil-meta">${meta.filter(Boolean).join(" · ")}</div>
        ${p.previa ? html`<p class="form-alert form-alert-info" style="margin-top:12px">Seu perfil está privado: só você vê esta prévia. Ative em <a href="perfil.html#privacidade">Privacidade</a>.</p>` : ""}
        ${p.privado ? html`<p class="text-muted">🔒 Este perfil é privado. Só as publicações no feed aparecem.</p>` : ""}
        ${p.bio ? html`<p class="text-secondary" style="margin:8px 0 12px;font-size:0.95rem;white-space:pre-line">${p.bio}</p>` : ""}
        ${p.redes?.length ? html`<div class="social-row">${chipsRedes(p.redes)}</div>` : ""}
        ${p.tipo === "PROFISSIONAL" ? html`<div class="perfil-actions"><button type="button" class="btn btn-primary btn-sm" data-agendar-com="${p.id_usuario}">Agendar com ${p.nome.split(" ")[0]}</button></div>` : ""}
      </div>
    </div>`;
}

const secaoPosts = (p) => html`<div class="public-card"><h3>Publicações</h3><div class="feed-list" id="posts">${lista(p.posts.map((x) => cartaoPost(x, usuario)), "Nenhuma publicação ainda.")}</div></div>`;

const item = (titulo, valor) => (valor ? html`<div class="hist-item"><span>${titulo}</span><span class="text-secondary">${valor}</span></div>` : "");

function profissional(p) {
  return html`
    ${cabecalho(p, [rotuloArea(p.area), nota(p.avaliacao), p.estatisticas.atendimentos ? `${p.estatisticas.atendimentos} atendimento(s)` : null])}
    <div class="public-grid">
      <div>
        <div class="public-card">
          <h3>Sobre o trabalho</h3>
          ${p.especialidades.length ? html`<div class="corte-meta" style="margin-bottom:10px">${p.especialidades.map((e) => html`<span class="badge">${e}</span>`)}</div>` : ""}
          ${item("Experiência", p.anos_experiencia != null ? `${p.anos_experiencia} ano(s)` : null)}
          ${item("Certificações", p.certificacoes)}
          ${item("Serviços", p.servicos.map((s) => s.nome_servico).join(", "))}
        </div>
        ${p.cortes.length ? html`<div class="public-card"><h3>Cortes publicados</h3><div class="cortes-grid cortes-grid-menor" id="cortes">${p.cortes.map((c) => cartaoCorte(c))}</div></div>` : ""}
      </div>
      ${secaoPosts(p)}
    </div>`;
}

function cliente(p) {
  if (p.privado) return html`${cabecalho(p, [])}<div style="margin-top:24px">${secaoPosts(p)}</div>`;
  const f = p.favoritos;
  const favoritos = f
    ? [
        ...f.cortes.map((c) => html`<div class="hist-item"><span>✂️ ${c.nome_corte}</span><span class="text-muted">corte</span></div>`),
        ...f.servicos.map((s) => html`<div class="hist-item"><span>${s.icone ?? "💈"} ${s.nome_servico}</span><span class="text-muted">${moeda(s.preco)}</span></div>`),
        ...f.produtos.map((x) => html`<div class="hist-item"><span>🧴 ${x.nome_produto}</span><span class="text-muted">${moeda(x.preco)}</span></div>`),
      ]
    : null;
  return html`
    ${cabecalho(p, [p.membro_desde ? `Membro desde ${mesAno(p.membro_desde)}` : null])}
    <div class="public-grid">
      <div>
        <div class="public-card">
          <h3>Sobre</h3>
          ${item("E-mail", p.email)}
          ${item("Telefone", p.telefone ? telefoneFormatado(p.telefone) : null)}
          ${item("Aniversário", p.aniversario)}
          ${p.estatisticas ? html`${item("Visitas ao salão", String(p.estatisticas.visitas))}${item("Publicações", String(p.estatisticas.publicacoes))}` : ""}
          ${!p.email && !p.telefone && !p.aniversario && !p.estatisticas ? html`<p class="text-muted" style="font-size:0.9rem">Esta pessoa prefere não mostrar mais dados.</p>` : ""}
        </div>
        ${favoritos ? html`<div class="public-card"><h3>Preferências / favoritos</h3>${lista(favoritos, "Nenhum favorito ainda.")}</div>` : ""}
      </div>
      ${secaoPosts(p)}
    </div>`;
}

try {
  if (!/^\d+$/.test(id ?? "")) throw new Error("Perfil não encontrado.");
  const { perfil } = await get(`/perfis/${id}`);
  document.title = `${perfil.nome} — Studio Corte`;
  area.innerHTML = (perfil.tipo === "PROFISSIONAL" ? profissional(perfil) : cliente(perfil)).toString();
  ligarPosts($("#posts"), { posts: perfil.posts, usuario });
  area.addEventListener("click", (e) => {
    const agendar = e.target.closest("[data-agendar-com]");
    const corte = e.target.closest("[data-corte]");
    const fav = e.target.closest("[data-favorito]");
    if (agendar) abrirAgendamento({ id_barbeiro: Number(agendar.dataset.agendarCom) });
    else if (fav)
      alternarFavorito(fav, {
        usuario,
        listas: { corte: perfil.cortes ?? [] },
        depois: () => ($("#cortes").innerHTML = perfil.cortes.map((c) => cartaoCorte(c)).join("")),
      });
    else if (corte) {
      const c = perfil.cortes.find((x) => String(x.id_corte) === corte.dataset.corte);
      abrirCorte(c, { quero: (x) => abrirAgendamento({ cortes: [x.id_corte], id_barbeiro: perfil.id_usuario }) });
    }
  });
  retomarRascunho();
} catch (err) {
  area.innerHTML = html`<p class="estado-vazio">${err.message}</p>`.toString();
}
