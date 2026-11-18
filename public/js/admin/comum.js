// Comum a todas as páginas do painel: exige login da equipe, monta a barra lateral e o menu mobile.
// A permissão real é sempre conferida pelo servidor; aqui só se evita mostrar o que não se pode usar.
import { $, $$, html, avatar, ligarSair } from "../ui.js";
import { exigirLogin, sair, destinoPorPerfil } from "../sessao.js";

const ROTULO = { ADMIN: "Proprietário", BARBEIRO: "Profissional" };

// perfis: quem pode abrir esta página (padrão: só ADMIN)
export async function iniciarPainel(perfis = ["ADMIN"]) {
  const usuario = await exigirLogin(["ADMIN", "BARBEIRO"]);
  if (!perfis.includes(usuario.tipo_perfil)) {
    location.replace(destinoPorPerfil(usuario));
    return new Promise(() => {});
  }

  if (usuario.tipo_perfil !== "ADMIN") $$("[data-so-admin]").forEach((el) => el.remove());

  const cartao = $(".sidebar-user");
  if (cartao) {
    cartao.innerHTML = html`
      ${avatar(usuario)}
      <div>
        <div class="name">${usuario.nome_completo}</div>
        <div class="role">${ROTULO[usuario.tipo_perfil] ?? usuario.tipo_perfil}</div>
      </div>`.toString();
  }
  ligarSair(sair);

  // Menu lateral no celular
  const sidebar = $("#sidebar");
  const cabecalho = $(".admin-header");
  if (sidebar && cabecalho && !$(".admin-menu-toggle")) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn btn-ghost btn-icon admin-menu-toggle";
    botao.setAttribute("aria-label", "Abrir menu");
    botao.setAttribute("aria-controls", "sidebar");
    botao.setAttribute("aria-expanded", "false");
    botao.textContent = "☰";
    cabecalho.prepend(botao);
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      const aberto = sidebar.classList.toggle("open");
      botao.setAttribute("aria-expanded", String(aberto));
    });
    document.addEventListener("click", (e) => {
      if (sidebar.classList.contains("open") && !sidebar.contains(e.target)) {
        sidebar.classList.remove("open");
        botao.setAttribute("aria-expanded", "false");
      }
    });
  }
  return usuario;
}
