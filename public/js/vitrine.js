// Estrutura comum das páginas públicas (home, catálogo, avaliações):
// menu mobile, botão de conta/painel, carrinho em gaveta, rodapé e balão de contatos.
import { get } from "./api.js";
import { $, toast } from "./ui.js";
import { obterUsuario } from "./sessao.js";
import { iniciarCarrinho } from "./carrinho.js";
import { montarBalaoContatos, montarRodape } from "./contatos.js";

function montarCabecalho(usuario) {
  const toggle = $("#mobileToggle");
  const nav = $("#mainNav");
  toggle?.addEventListener("click", () => nav.classList.toggle("open"));
  nav?.addEventListener("click", (e) => e.target.closest("a") && nav.classList.remove("open"));

  const btnLogin = $("#btnLogin");
  if (!usuario || !btnLogin) return;
  btnLogin.textContent = usuario.nome_completo.split(" ")[0];
  btnLogin.href = "perfil.html";
  if (usuario.tipo_perfil !== "CLIENTE") {
    const painel = document.createElement("a");
    painel.href = usuario.tipo_perfil === "ADMIN" ? "admin/index.html" : "admin/agendamentos.html";
    painel.className = "btn btn-outline btn-sm";
    painel.textContent = "Painel";
    btnLogin.parentNode.insertBefore(painel, btnLogin);
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
