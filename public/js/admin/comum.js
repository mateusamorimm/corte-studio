// Comum a todas as páginas do painel (layout do colega): exige login da equipe,
// monta o menu lateral filtrado pelo perfil e o rodapé com usuário e "Sair".
// A permissão real é sempre conferida pelo servidor; o menu só esconde o que não se pode usar.
import { $, html, avatar, ligarSair } from "../ui.js";
import { exigirLogin, sair, destinoPorPerfil } from "../sessao.js";

const ROTULO = { ADMIN: "Proprietário", BARBEIRO: "Profissional", RECEPCIONISTA: "Recepção" };

// Itens do menu (ordem e nomes do painel do colega)
const A = "ADMIN";
const R = "RECEPCIONISTA";
const P = "BARBEIRO";
const MENU = [
  { href: "index.html", ico: "📊", rotulo: "Dashboard", perfis: [A, R] },
  { href: "pedidos.html", ico: "📦", rotulo: "Pedidos", perfis: [A, R] },
  { href: "agendamentos.html", ico: "📅", rotulo: "Agendamentos", perfis: [A, R, P] },
  { href: "clientes.html", ico: "👥", rotulo: "Clientes", perfis: [A, R] },
  { href: "recepcionistas.html", ico: "🛎️", rotulo: "Recepcionistas", perfis: [A] },
  { href: "equipe.html", ico: "💈", rotulo: "Profissionais", perfis: [A] },
  { href: "profissional-perfil.html", ico: "🪪", rotulo: "Meu perfil profissional", perfis: [P] },
  { href: "servicos.html", ico: "✂️", rotulo: "Serviços", perfis: [A] },
  { href: "produtos.html", ico: "🛍️", rotulo: "Produtos", perfis: [A] },
  { href: "galeria.html", ico: "🖼️", rotulo: "Galeria/Cortes", perfis: [A, P] },
  { href: "fidelidade.html", ico: "🎁", rotulo: "Fidelidade", perfis: [A] },
  { href: "comentarios.html", ico: "💬", rotulo: "Comentários", perfis: [A] },
  { href: "posts.html", ico: "📰", rotulo: "Posts", perfis: [A] },
  { href: "logs.html", ico: "🧾", rotulo: "Logs de conta", perfis: [A] },
  { href: "configuracoes.html", ico: "⚙️", rotulo: "Site e Config", perfis: [A] },
];
// Páginas sem item próprio destacam a seção a que pertencem
const PAI = { "conteudo.html": "configuracoes.html", "cliente-perfil.html": "clientes.html" };

function paginaAtual() {
  return location.pathname.split("/").pop() || "index.html";
}

// perfis: quem pode abrir esta página (padrão: só ADMIN)
export async function iniciarPainel(perfis = ["ADMIN"]) {
  const usuario = await exigirLogin(["ADMIN", "BARBEIRO", "RECEPCIONISTA"]);
  if (!perfis.includes(usuario.tipo_perfil)) {
    location.replace(destinoPorPerfil(usuario));
    return new Promise(() => {});
  }

  let atual = paginaAtual();
  if (atual === "profissional-perfil.html" && usuario.tipo_perfil === "ADMIN") atual = "equipe.html";
  atual = PAI[atual] ?? atual;
  const nav = $("#adminNav");
  if (nav) {
    nav.innerHTML = MENU.filter((i) => i.perfis.includes(usuario.tipo_perfil))
      .map(
        (i) => html`<a href="${i.href}" class="${i.href === atual ? "active" : ""}" ${i.href === atual ? html`aria-current="page"` : ""}>
          <span class="nav-ico" aria-hidden="true">${i.ico}</span><span>${i.rotulo}</span></a>`
      )
      .join("");
  }

  // Elementos exclusivos de alguns perfis somem para os demais
  if (usuario.tipo_perfil !== "ADMIN") document.querySelectorAll("[data-so-admin]").forEach((el) => el.remove());
  if (!["ADMIN", "RECEPCIONISTA"].includes(usuario.tipo_perfil)) document.querySelectorAll("[data-balcao]").forEach((el) => el.remove());
  if (usuario.tipo_perfil === "RECEPCIONISTA") document.querySelectorAll("[data-nao-recepcao]").forEach((el) => el.remove());

  const cartao = $(".sidebar-user");
  if (cartao) {
    cartao.innerHTML = html`
      ${avatar(usuario)}
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${usuario.nome_completo}</div>
        <div class="role">${ROTULO[usuario.tipo_perfil] ?? usuario.tipo_perfil}</div>
      </div>`.toString();
  }
  montarMenuCelular();
  ligarSair(sair);
  return usuario;
}

// No celular o menu fica recolhido para o conteúdo aparecer primeiro
function montarMenuCelular() {
  const lateral = $(".admin-sidebar");
  if (!lateral || $("#btnMenuPainel")) return;
  const botao = document.createElement("button");
  botao.type = "button";
  botao.id = "btnMenuPainel";
  botao.className = "btn btn-outline btn-sm";
  botao.setAttribute("aria-controls", "adminNav");
  botao.setAttribute("aria-expanded", "false");
  botao.textContent = "☰ Menu";
  lateral.querySelector(".logo").after(botao);
  botao.addEventListener("click", () => {
    const aberto = lateral.classList.toggle("menu-aberto");
    botao.setAttribute("aria-expanded", String(aberto));
  });
}

// Abas simples do painel: botões [data-aba] e blocos #aba-<nome>
export function ligarAbas(aoTrocar = null) {
  document.querySelector(".admin-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aba]");
    if (b) trocarAba(b.dataset.aba, aoTrocar);
  });
}
export function trocarAba(nome, aoTrocar = null) {
  document.querySelectorAll(".admin-tabs [data-aba]").forEach((b) => {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle("active", ativa);
    b.setAttribute("aria-pressed", String(ativa));
    document.getElementById(`aba-${b.dataset.aba}`).hidden = !ativa;
  });
  aoTrocar?.(nome);
}
