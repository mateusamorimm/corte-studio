// Fidelidade: recompensas, regras de pontuação e ajuste (auditado) dos pontos dos clientes.
import { get, post, put, patch } from "../api.js";
import { $, html, avatar, abrirModal, toast, alertaForm, comCarregamento, mostrarErrosCampos, limparErrosCampos } from "../ui.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN"]);
const fr = $("#formRecompensa");
const fj = $("#formAjuste");
const fg = $("#formRegras");
const REGRAS = ["pontos_por_real", "pontos_minimos_evento", "nivel_prata", "nivel_ouro"];
let recompensas = [];
let clientes = [];
let editando = null;
let ajustando = null;

async function carregar() {
  const busca = $("#buscaPontos").value.trim();
  try {
    ({ recompensas, clientes } = await get(`/admin/fidelidade${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`));
    $("#recompensasBody").innerHTML = recompensas.length
      ? recompensas
          .map(
            (r) => html`
        <tr class="${r.ativo ? "" : "inativo"}">
          <td>${r.nome}</td><td>${r.pontos_minimos}</td><td>${r.desconto_percentual}%</td><td>${r.consome_pontos ? "Sim" : "Não"}</td>
          <td>${r.ativo ? html`<span class="badge badge-success">ATIVA</span>` : html`<span class="badge">INATIVA</span>`}</td>
          <td><button class="btn btn-ghost btn-sm" data-editar="${r.id_recompensa}">Editar</button></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="6" class="estado-vazio">Nenhuma recompensa.</td></tr>`.toString();
    $("#pontosBody").innerHTML = clientes.length
      ? clientes
          .map(
            (c) => html`
        <tr>
          <td><div style="display:flex;gap:10px;align-items:center">${avatar(c)}<a href="${`cliente-perfil.html?id=${c.id_usuario}`}">${c.nome_completo}</a></div></td>
          <td><strong>${c.pontos}</strong></td><td>${c.nivel}</td><td>${c.desconto_percentual ? `${c.desconto_percentual}%` : "—"}</td>
          <td><button class="btn btn-ghost btn-sm" data-ajustar="${c.id_usuario}">Distribuir</button></td>
        </tr>`
          )
          .join("")
      : html`<tr><td colspan="5" class="estado-vazio">Nenhum cliente encontrado.</td></tr>`.toString();
  } catch (err) {
    toast(err.message, "erro");
  }
}

function abrirRecompensa(r = null) {
  editando = r;
  fr.reset();
  limparErrosCampos(fr);
  alertaForm($("#alertaRecompensa"), null);
  $("#tituloRecompensa").textContent = r ? "Editar recompensa" : "Nova recompensa";
  if (r) {
    for (const c of ["nome", "pontos_minimos", "desconto_percentual"]) fr[c].value = r[c];
    fr.consome_pontos.checked = r.consome_pontos;
    fr.ativo.checked = r.ativo;
  }
  abrirModal($("#modalRecompensa"));
}
$("#btnNova").addEventListener("click", () => abrirRecompensa());
$("#recompensasBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-editar]");
  if (b) abrirRecompensa(recompensas.find((r) => String(r.id_recompensa) === b.dataset.editar));
});
fr.addEventListener("submit", async (e) => {
  e.preventDefault();
  await comCarregamento(fr.querySelector("[type=submit]"), async () => {
    try {
      const dados = {
        nome: fr.nome.value,
        pontos_minimos: fr.pontos_minimos.value,
        desconto_percentual: fr.desconto_percentual.value,
        consome_pontos: fr.consome_pontos.checked,
        ativo: fr.ativo.checked,
      };
      if (editando) await put(`/admin/fidelidade/recompensas/${editando.id_recompensa}`, dados);
      else await post("/admin/fidelidade/recompensas", dados);
      $("#modalRecompensa").close();
      toast("Recompensa salva.", "sucesso");
      await carregar();
    } catch (err) {
      alertaForm($("#alertaRecompensa"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(fr, err.detalhes);
    }
  }, "Salvando...");
});

$("#pontosBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ajustar]");
  if (!b) return;
  ajustando = clientes.find((c) => String(c.id_usuario) === b.dataset.ajustar);
  fj.reset();
  alertaForm($("#alertaAjuste"), null);
  $("#tituloAjuste").textContent = `${ajustando.nome_completo} — ${ajustando.pontos} pontos`;
  abrirModal($("#modalAjuste"));
});
fj.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!Number(fj.pontos.value)) return alertaForm($("#alertaAjuste"), "Informe uma quantidade diferente de zero.");
  if (!fj.motivo.value.trim()) return alertaForm($("#alertaAjuste"), "Informe o motivo.");
  await comCarregamento(fj.querySelector("[type=submit]"), async () => {
    try {
      const { pontos } = await post(`/admin/fidelidade/clientes/${ajustando.id_usuario}/ajuste`, { pontos: fj.pontos.value, motivo: fj.motivo.value });
      $("#modalAjuste").close();
      toast(`Saldo atualizado: ${pontos} pontos.`, "sucesso");
      await carregar();
    } catch (err) {
      alertaForm($("#alertaAjuste"), err.message);
    }
  }, "Aplicando...");
});

const preencherRegras = (c) => REGRAS.forEach((k) => (fg[k].value = c[k]));
fg.addEventListener("submit", async (e) => {
  e.preventDefault();
  limparErrosCampos(fg);
  alertaForm($("#alertaRegras"), null);
  await comCarregamento(fg.querySelector("[type=submit]"), async () => {
    try {
      preencherRegras((await patch("/admin/config", Object.fromEntries(REGRAS.map((k) => [k, fg[k].value])))).config);
      toast("Regras salvas.", "sucesso");
    } catch (err) {
      alertaForm($("#alertaRegras"), err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(fg, err.detalhes);
    }
  }, "Salvando...");
});

let temporizador;
$("#buscaPontos").addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(carregar, 300);
});

carregar();
get("/admin/config")
  .then(({ config }) => preencherRegras(config))
  .catch((err) => toast(err.message, "erro"));
