import { post } from "../api.js";
import { $, alertaForm, mostrarErrosCampos, limparErrosCampos, comCarregamento } from "../ui.js";
import { regras, validarForm, alternarSenha, mascaraTelefone, mascaraCpf } from "../validacao.js";
import { obterUsuario, destinoAposLogin } from "../sessao.js";

const form = $("#cadastroForm");
const alerta = $("#alerta");
alternarSenha();
mascaraTelefone(form.telefone);
mascaraCpf(form.cpf);
form.data_nascimento.max = new Date().toISOString().slice(0, 10);

const voltar = new URLSearchParams(location.search).get("voltar");
if (voltar) $("#linkLogin").href = `login.html?voltar=${encodeURIComponent(voltar)}`;

obterUsuario().then((u) => {
  if (u) location.replace(destinoAposLogin(u));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertaForm(alerta, null);
  limparErrosCampos(form);

  const erros = validarForm(form, {
    nome_completo: regras.nome,
    email: regras.email,
    telefone: regras.telefone,
    data_nascimento: regras.dataPassadaOpcional,
    cpf: regras.cpfOpcional,
    senha: regras.senha,
    confirmar: (v, f) => (v === f.senha.value ? null : "As senhas não conferem."),
  });
  if (mostrarErrosCampos(form, erros)) return;

  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      const { usuario } = await post("/auth/cadastro", {
        nome_completo: form.nome_completo.value,
        email: form.email.value,
        telefone: form.telefone.value,
        cpf: form.cpf.value,
        data_nascimento: form.data_nascimento.value,
        senha: form.senha.value,
      });
      location.replace(destinoAposLogin(usuario));
    } catch (err) {
      alertaForm(alerta, err.message);
      if (err.detalhes?.length) mostrarErrosCampos(form, err.detalhes);
      else if (err.detalhes?.campo) mostrarErrosCampos(form, [{ campo: err.detalhes.campo, mensagem: err.message }]);
    }
  }, "Criando conta...");
});
