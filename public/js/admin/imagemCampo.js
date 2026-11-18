// Campo de imagem do painel: aceita URL colada ou envio de arquivo, com miniatura.
import { enviarImagem } from "../api.js";
import { urlSegura, toast, comCarregamento, escolherImagem, validarArquivoImagem } from "../ui.js";

export function campoImagem({ input, botao, previa }) {
  const atualizar = () => {
    const url = urlSegura(input.value.trim());
    if (!previa) return;
    previa.hidden = !url;
    if (url) previa.src = url;
  };
  input.addEventListener("input", atualizar);
  // URL local (/api/imagens/...) também é aceita no campo do tipo url
  input.type = "text";
  input.inputMode = "url";
  botao.addEventListener("click", async () => {
    const arquivo = await escolherImagem();
    if (!arquivo) return;
    const erro = validarArquivoImagem(arquivo);
    if (erro) return toast(erro, "erro");
    await comCarregamento(botao, async () => {
      try {
        input.value = await enviarImagem(arquivo);
        atualizar();
        toast("Imagem enviada.", "sucesso");
      } catch (err) {
        toast(err.message, "erro");
      }
    }, "Enviando...");
  });
  return { atualizar };
}
