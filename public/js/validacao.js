// Validações do frontend — espelham as regras do backend (src/validators).
// Servem para dar retorno imediato; o servidor sempre valida de novo.

export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");

export function cpfValido(valor) {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}

export const regras = {
  nome: (v) => (v.trim().length >= 3 ? null : "Informe o nome completo (mínimo 3 caracteres)."),
  email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : "Informe um e-mail válido."),
  senha: (v) =>
    v.length < 8
      ? "A senha deve ter no mínimo 8 caracteres."
      : !/[A-Za-zÀ-ÿ]/.test(v) || !/\d/.test(v)
        ? "A senha deve conter letras e números."
        : new TextEncoder().encode(v).length > 72
          ? "A senha deve ter no máximo 72 caracteres."
          : null,
  telefone: (v) => ([10, 11].includes(soDigitos(v).length) ? null : "Informe o telefone com DDD."),
  cpfOpcional: (v) => (!v.trim() || cpfValido(v) ? null : "CPF inválido."),
  dataPassadaOpcional: (v) => (!v || new Date(`${v}T00:00:00`) < new Date() ? null : "Data inválida."),
};

// campos: { nomeDoCampo: funcaoDeRegra } → [{ campo, mensagem }]
export function validarForm(form, campos) {
  const erros = [];
  for (const [campo, regra] of Object.entries(campos)) {
    const el = form.elements.namedItem(campo);
    const msg = regra(el?.value ?? "", form);
    if (msg) erros.push({ campo, mensagem: msg });
  }
  return erros;
}

// Máscaras simples enquanto digita
export function mascaraTelefone(input) {
  input.addEventListener("input", () => {
    const d = soDigitos(input.value).slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 6) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length === 11 ? 7 : 6)}-${d.slice(d.length === 11 ? 7 : 6)}`;
    input.value = v;
  });
}

export function mascaraCpf(input) {
  input.addEventListener("input", () => {
    const d = soDigitos(input.value).slice(0, 11);
    input.value = d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  });
}

// Botão "mostrar senha" para inputs com data-toggle-senha
export function alternarSenha(raiz = document) {
  raiz.querySelectorAll("[data-toggle-senha]").forEach((btn) => {
    const input = document.getElementById(btn.dataset.toggleSenha);
    btn.addEventListener("click", () => {
      const mostrar = input.type === "password";
      input.type = mostrar ? "text" : "password";
      btn.setAttribute("aria-pressed", String(mostrar));
      btn.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
      btn.textContent = mostrar ? "🙈" : "👁️";
    });
  });
}
