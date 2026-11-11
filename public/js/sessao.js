// Estado da sessão no frontend. A fonte da verdade é sempre o servidor (/api/auth/me):
// nada de perfil ou permissão é guardado em localStorage.
import { get, post } from "./api.js";
import { caminhoInterno } from "./ui.js";

let cache = null;

export function obterUsuario({ forcar = false } = {}) {
  if (!cache || forcar) {
    cache = get("/auth/me")
      .then((r) => r.usuario)
      .catch(() => null);
  }
  return cache;
}

export function destinoPorPerfil(usuario) {
  if (!usuario) return "/login.html";
  if (usuario.tipo_perfil === "ADMIN") return "/admin/index.html";
  if (usuario.tipo_perfil === "BARBEIRO") return "/admin/agendamentos.html";
  return "/perfil.html";
}

// Protege uma página. Retorna o usuário ou redireciona.
export async function exigirLogin(perfis = null) {
  const usuario = await obterUsuario();
  if (!usuario) {
    const voltar = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?voltar=${voltar}`);
    return new Promise(() => {}); // interrompe a página até o redirecionamento
  }
  if (perfis && !perfis.includes(usuario.tipo_perfil)) {
    location.replace(destinoPorPerfil(usuario));
    return new Promise(() => {});
  }
  return usuario;
}

export function destinoAposLogin(usuario) {
  const voltar = new URLSearchParams(location.search).get("voltar");
  const destino = caminhoInterno(voltar, "");
  if (destino && !/^\/(login|cadastro|recuperar-senha|redefinir-senha)\.html/.test(destino)) {
    // Cliente não volta para área administrativa
    if (destino.startsWith("/admin/") && usuario.tipo_perfil === "CLIENTE") return destinoPorPerfil(usuario);
    return destino;
  }
  return destinoPorPerfil(usuario);
}

export async function sair() {
  try {
    await post("/auth/logout");
  } finally {
    cache = null;
    location.href = "/";
  }
}
