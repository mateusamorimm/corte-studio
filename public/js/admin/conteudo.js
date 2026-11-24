import { get, patch } from "../api.js";
import { $, toast, alertaForm, comCarregamento, mostrarErrosCampos, limparErrosCampos } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";

await iniciarPainel(["ADMIN"]);

// ───────── Destaque e redes (configuração) ─────────
const fh = $("#formHero");
const fr = $("#formRedes");
const imgHero = campoImagem({ input: $("#hImagem"), botao: $("#btnHeroImg"), previa: $("#hPrevia"), finalidade: "SALAO" });

function preencher(c) {
  fh.hero_titulo.value = c.hero_titulo ?? "";
  fh.hero_subtitulo.value = c.hero_subtitulo ?? "";
  fh.hero_imagem_url.value = c.hero_imagem_url ?? "";
  imgHero.atualizar();
  fr.instagram_url.value = c.instagram_url ?? "";
  fr.tiktok_url.value = c.tiktok_url ?? "";
  fr.url_mapa.value = c.url_mapa ?? "";
}

async function salvarConfig(form, alerta, dados) {
  limparErrosCampos(form);
  alertaForm(alerta, null);
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      preencher((await patch("/admin/config", dados)).config);
      toast("Conteúdo salvo. Já está no site.", "sucesso");
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
}

fh.addEventListener("submit", (e) => {
  e.preventDefault();
  salvarConfig(fh, $("#alertaHero"), {
    hero_titulo: fh.hero_titulo.value,
    hero_subtitulo: fh.hero_subtitulo.value,
    hero_imagem_url: fh.hero_imagem_url.value.trim(),
  });
});
fr.addEventListener("submit", (e) => {
  e.preventDefault();
  salvarConfig(fr, $("#alertaRedes"), {
    instagram_url: fr.instagram_url.value,
    tiktok_url: fr.tiktok_url.value,
    url_mapa: fr.url_mapa.value,
  });
});

try {
  preencher((await get("/admin/config")).config);
} catch (err) {
  toast(err.message, "erro");
}
