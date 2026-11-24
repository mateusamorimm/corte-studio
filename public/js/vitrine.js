// Estrutura comum das páginas públicas (home, catálogo, avaliações):
// menu mobile, botão de conta/painel, carrinho em gaveta, rodapé e balão de contatos.
import { get } from "./api.js";
import { $, html, avatar, toast } from "./ui.js";
import { destinoPorPerfil, obterUsuario } from "./sessao.js";
import { iniciarCarrinho } from "./carrinho.js";
import { montarBalaoContatos, montarRodape } from "./contatos.js";

function montarCabecalho(usuario) {
  const toggle = $("#mobileToggle");
  const nav = $("#mainNav");
  toggle?.addEventListener("click", () => {
    const aberto = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(aberto));
  });
  nav?.addEventListener("click", (e) => {
    if (!e.target.closest("a")) return;
    nav.classList.remove("open");
    toggle?.setAttribute("aria-expanded", "false");
  });

  const btnLogin = $("#btnLogin");
  if (!usuario || !btnLogin) return;
  // Logado: "Entrar" vira o chip do usuário (foto + primeiro nome), como no layout do colega
  const chip = document.createElement("a");
  chip.href = "perfil.html";
  chip.className = "user-chip";
  chip.id = "btnLogin";
  chip.title = "Meu perfil";
  chip.innerHTML = html`${avatar(usuario)}<span>${usuario.nome_completo.split(" ")[0]}</span>`.toString();
  btnLogin.replaceWith(chip);
  if (usuario.tipo_perfil !== "CLIENTE") {
    const painel = document.createElement("a");
    painel.href = destinoPorPerfil(usuario);
    painel.className = "btn btn-outline btn-sm";
    painel.textContent = "Painel";
    chip.before(painel);
  }
}

// Retorna { usuario, config }. A configuração pode vir nula se a API falhar.
export async function iniciarVitrine() {
  const [u, c] = await Promise.allSettled([obterUsuario(), get("/config")]);
  const usuario = u.status === "fulfilled" ? u.value : null;
  const config = c.status === "fulfilled" ? c.value.config : null;
  montarCabecalho(usuario);
  iniciarCarrinho(usuario);
  if (config) {
    montarRodape(config);
    montarBalaoContatos(config);
  } else {
    toast("Não foi possível carregar os dados do salão. Atualize a página.", "aviso");
  }
  return { usuario, config };
}
