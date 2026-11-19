// Comum a todas as páginas do painel (layout do colega): exige login da equipe,
// monta o menu lateral filtrado pelo perfil e o rodapé com usuário e "Sair".
// A permissão real é sempre conferida pelo servidor; o menu só esconde o que não se pode usar.
import { $, html, avatar, ligarSair } from "../ui.js";
import { exigirLogin, sair, destinoPorPerfil } from "../sessao.js";

const ROTULO = { ADMIN: "Proprietário", BARBEIRO: "Profissional" };

// Itens do menu (ordem e nomes do painel do colega)
const MENU = [
  { href: "index.html", ico: "📊", rotulo: "Dashboard", perfis: ["ADMIN"] },
  { href: "pedidos.html", ico: "📦", rotulo: "Pedidos", perfis: ["ADMIN"] },
  { href: "agendamentos.html", ico: "📅", rotulo: "Agendamentos", perfis: ["ADMIN", "BARBEIRO"] },
  { href: "clientes.html", ico: "👥", rotulo: "Clientes", perfis: ["ADMIN"] },
  { href: "equipe.html", ico: "💈", rotulo: "Profissionais", perfis: ["ADMIN"] },
  { href: "servicos.html", ico: "✂️", rotulo: "Serviços", perfis: ["ADMIN"] },
  { href: "produtos.html", ico: "🛍️", rotulo: "Produtos", perfis: ["ADMIN"] },
  { href: "conteudo.html", ico: "🖼️", rotulo: "Galeria e conteúdo", perfis: ["ADMIN"] },
  { href: "configuracoes.html", ico: "⚙️", rotulo: "Site e Config", perfis: ["ADMIN"] },
];

function paginaAtual() {
  return location.pathname.split("/").pop() || "index.html";
}

// perfis: quem pode abrir esta página (padrão: só ADMIN)
export async function iniciarPainel(perfis = ["ADMIN"]) {
  const usuario = await exigirLogin(["ADMIN", "BARBEIRO"]);
  if (!perfis.includes(usuario.tipo_perfil)) {
    location.replace(destinoPorPerfil(usuario));
    return new Promise(() => {});
  }

  const atual = paginaAtual();
  const nav = $("#adminNav");
  if (nav) {
    nav.innerHTML = MENU.filter((i) => i.perfis.includes(usuario.tipo_perfil))
      .map(
        (i) => html`<a href="${i.href}" class="${i.href === atual ? "active" : ""}" ${i.href === atual ? html`aria-current="page"` : ""}>
          <span class="nav-ico" aria-hidden="true">${i.ico}</span><span>${i.rotulo}</span></a>`
      )
      .join("");
  }

  // Elementos marcados como exclusivos do administrador somem para o profissional
  if (usuario.tipo_perfil !== "ADMIN") document.querySelectorAll("[data-so-admin]").forEach((el) => el.remove());

  const cartao = $(".sidebar-user");
  if (cartao) {
    cartao.innerHTML = html`
      ${avatar(usuario)}
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${usuario.nome_completo}</div>
        <div class="role">${ROTULO[usuario.tipo_perfil] ?? usuario.tipo_perfil}</div>
      </div>`.toString();
  }
  ligarSair(sair);
  return usuario;
}
