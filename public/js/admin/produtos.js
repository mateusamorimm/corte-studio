import { get, post, put, del } from "../api.js";
import { $, html, moeda, toast, alertaForm, comCarregamento, confirmar, mostrarErrosCampos, limparErrosCampos, urlSegura } from "../ui.js";
import { iniciarPainel } from "./comum.js";
import { campoImagem } from "./imagemCampo.js";

await iniciarPainel(["ADMIN"]);

const form = $("#produtoForm");
const caixa = $("#formProduto");
const imagem = campoImagem({ input: $("#prodImg"), botao: $("#btnEnviarImg"), previa: $("#prodPrevia") });
let produtos = [];

async function carregar() {
  try {
    ({ produtos } = await get("/admin/produtos"));
    render();
  } catch (err) {
    $("#produtosBody").innerHTML = html`<tr><td colspan="5" class="estado-vazio">${err.message}</td></tr>`.toString();
  }
}

function render() {
  const categorias = [...new Set(produtos.map((p) => p.categoria).filter(Boolean))];
  $("#categorias").innerHTML = categorias.map((c) => html`<option value="${c}"></option>`).join("");
  $("#produtosBody").innerHTML = produtos.length
    ? produtos
        .map(
          (p) => html`
        <tr class="${p.ativo ? "" : "inativo"}">
          <td>#${p.id_produto}</td>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <img class="miniatura" src="${urlSegura(p.imagem_url)}" alt="" loading="lazy" data-fallback="produto">
              <span>${p.nome_produto}${p.categoria ? html`<br><small class="text-muted">${p.categoria}</small>` : ""}
              ${p.ativo ? "" : html` <span class="badge badge-accent">INATIVO</span>`}</span>
            </div>
          </td>
          <td>${moeda(p.preco)}</td>
          <td>${p.quantidade_estoque === 0 ? html`<span class="badge badge-accent">ESGOTADO</span>` : p.quantidade_estoque <= 3 ? html`<span class="badge badge-warning">${p.quantidade_estoque}</span>` : p.quantidade_estoque}</td>
          <td>
            <div class="admin-acoes">
              <button class="btn btn-ghost btn-sm" data-acao="editar" data-id="${p.id_produto}">Editar</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-acao="${p.ativo ? "excluir" : "reativar"}" data-id="${p.id_produto}">${p.ativo ? "Excluir" : "Reativar"}</button>
            </div>
          </td>
        </tr>`
        )
        .join("")
    : html`<tr><td colspan="5" class="estado-vazio">Nenhum produto cadastrado.</td></tr>`.toString();
  // Produtos sem imagem mostram o placeholder
  $("#produtosBody").querySelectorAll('img[src=""]').forEach((i) => i.dispatchEvent(new Event("error")));
}

function abrir(p = null) {
  form.reset();
  limparErrosCampos(form);
  alertaForm($("#alertaProduto"), null);
  $("#formTitle").textContent = p ? "Editar Produto" : "Novo Produto";
  $("#prodId").value = p?.id_produto ?? "";
  if (p) {
    form.nome_produto.value = p.nome_produto;
    form.descricao.value = p.descricao ?? "";
    form.categoria.value = p.categoria ?? "";
    form.preco.value = Number(p.preco).toFixed(2);
    form.quantidade_estoque.value = p.quantidade_estoque;
    form.imagem_url.value = p.imagem_url ?? "";
    form.ativo.checked = p.ativo;
  }
  imagem.atualizar();
  caixa.style.display = "block";
  caixa.scrollIntoView({ behavior: "smooth" });
}

const dados = () => ({
  nome_produto: form.nome_produto.value,
  descricao: form.descricao.value,
  categoria: form.categoria.value,
  preco: form.preco.value,
  quantidade_estoque: form.quantidade_estoque.value,
  imagem_url: form.imagem_url.value.trim(),
  ativo: form.ativo.checked,
});

$("#btnNovoProduto").addEventListener("click", () => abrir());
$("#btnCancelar").addEventListener("click", () => (caixa.style.display = "none"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const alerta = $("#alertaProduto");
  alertaForm(alerta, null);
  const erros = [];
  if (!form.nome_produto.value.trim()) erros.push({ campo: "nome_produto", mensagem: "Informe o nome." });
  if (form.preco.value === "" || Number(form.preco.value) < 0) erros.push({ campo: "preco", mensagem: "Informe um preço válido." });
  const est = Number(form.quantidade_estoque.value);
  if (form.quantidade_estoque.value === "" || !Number.isInteger(est) || est < 0) erros.push({ campo: "quantidade_estoque", mensagem: "Informe o estoque (0 ou mais)." });
  if (mostrarErrosCampos(form, erros)) return;
  const id = $("#prodId").value;
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      if (id) await put(`/admin/produtos/${id}`, dados());
      else await post("/admin/produtos", dados());
      caixa.style.display = "none";
      toast(id ? "Produto atualizado." : "Produto cadastrado.", "sucesso");
      await carregar();
    } catch (err) {
      alertaForm(alerta, err.message);
      if (Array.isArray(err.detalhes)) mostrarErrosCampos(form, err.detalhes);
    }
  }, "Salvando...");
});

$("#produtosBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const p = produtos.find((x) => String(x.id_produto) === b.dataset.id);
  try {
    if (b.dataset.acao === "editar") return abrir(p);
    if (b.dataset.acao === "excluir") {
      if (!(await confirmar(`Excluir "${p.nome_produto}" da loja? Ele sai do site e dos carrinhos; os pedidos já feitos são preservados.`, { titulo: "Excluir produto", confirmar: "Excluir", perigo: true }))) return;
      await del(`/admin/produtos/${p.id_produto}`);
      toast("Produto removido da loja.", "sucesso");
    } else {
      await put(`/admin/produtos/${p.id_produto}`, { ...p, ativo: true });
      toast("Produto reativado.", "sucesso");
    }
    await carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
});

carregar();
