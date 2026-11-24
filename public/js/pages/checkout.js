// Checkout (layout do colega): resumo, desconto de fidelidade e preferência de pagamento no salão.
// Nenhum pagamento é processado aqui. Sem conta, vira uma reserva com código de retirada.
import { get, post } from "../api.js";
import { $, html, raw, moeda, toast, alertaForm, comCarregamento, hojeIso, dataCurta } from "../ui.js";
import { iniciarVitrine } from "../vitrine.js";
import { carregarCarrinhoVisitante, esvaziarCarrinhoVisitante, recarregarCarrinho } from "../carrinho.js";
import { regras, mascaraTelefone } from "../validacao.js";

const area = $("#checkout");
const { usuario, config } = await iniciarVitrine();
let resumo = null;
let forma = "PIX";

const FORMAS = [
  ["PIX", "Pix no salão", "Pague pelo QR Code do balcão na retirada."],
  ["CARTAO", "Cartão no salão", "Débito ou crédito na maquininha."],
  ["DINHEIRO", "Dinheiro no salão", "Pague em espécie na retirada."],
];

async function carregar() {
  if (usuario) return get("/me/checkout");
  const c = await carregarCarrinhoVisitante();
  return { itens: c.itens, subtotal: c.total, desconto: "0", total: c.total, recompensa: null, prazo_retirada_dias: config?.prazo_retirada_dias ?? 5, aviso_entrega: config?.aviso_entrega ?? null };
}

function dataMaxima() {
  const d = new Date(`${hojeIso()}T12:00:00`);
  d.setDate(d.getDate() + 30);
  return d.toLocaleDateString("en-CA");
}

function valores() {
  const usar = $("#usarDesconto")?.checked ?? true;
  return { desconto: usar ? Number(resumo.desconto) : 0, total: usar ? Number(resumo.total) : Number(resumo.subtotal) };
}

function atualizarTotal() {
  const v = valores();
  $("#linhaDesconto")?.toggleAttribute("hidden", !v.desconto);
  $("#totalFinal").textContent = moeda(v.total);
}

function desenhar() {
  const itens = resumo.itens.filter((i) => i.produto.ativo);
  if (!itens.length) {
    area.innerHTML = html`<div class="card" style="padding:32px;text-align:center"><p class="text-muted" style="margin-bottom:16px">Seu carrinho está vazio.</p><a class="btn btn-primary" href="catalogo.html?tipo=produtos">Ver produtos</a></div>`.toString();
    return;
  }
  const r = resumo.recompensa;
  area.innerHTML = html`
    <form id="formCheckout" class="checkout-grid" novalidate>
      <div class="card" style="padding:24px">
        <div id="alerta" class="form-alert" hidden></div>
        ${usuario
          ? ""
          : html`
          <h2 class="checkout-titulo">Seus dados</h2>
          <p class="text-muted" style="font-size:0.85rem;margin-bottom:12px"><a href="login.html?voltar=%2Fcheckout.html" style="color:var(--accent)">Entre na sua conta</a> para acumular pontos, ou reserve com um código.</p>
          <div class="form-group"><label class="form-label" for="nome">Nome completo</label><input class="form-input" id="nome" name="nome" maxlength="120" autocomplete="name"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="telefone">WhatsApp / Telefone</label><input class="form-input" id="telefone" name="telefone" type="tel" inputmode="numeric" autocomplete="tel"></div>
            <div class="form-group"><label class="form-label" for="email">E-mail</label><input class="form-input" id="email" name="email" type="email" maxlength="160" autocomplete="email"></div>
          </div>
          <div class="form-group"><label class="form-label" for="data_retirada">Quando pretende retirar?</label><input class="form-input" id="data_retirada" name="data_retirada" type="date" min="${hojeIso()}" max="${dataMaxima()}" value="${hojeIso()}">
            <small class="form-hint">Seguramos os produtos até ${resumo.prazo_retirada_dias} dia(s) depois dessa data.</small></div>`}
        <h2 class="checkout-titulo">Como você quer pagar no salão?</h2>
        <div class="pay-methods" role="radiogroup" aria-label="Forma de pagamento no salão">
          ${FORMAS.map(
            ([id, nome, texto]) => html`<label class="pay-method${id === forma ? " active" : ""}"><input type="radio" name="forma" value="${id}" ${raw(id === forma ? "checked" : "")}> <span><strong>${nome}</strong><small>${texto}</small></span></label>`
          )}
        </div>
        <div class="form-group"><label class="form-label" for="observacao">Observações (opcional)</label><textarea class="form-textarea" id="observacao" name="observacao" maxlength="500" rows="2"></textarea></div>
        ${resumo.aviso_entrega ? html`<p class="form-alert form-alert-info">${resumo.aviso_entrega}</p>` : ""}
      </div>
      <div class="card" style="padding:24px;align-self:start">
        <h2 class="checkout-titulo">Resumo do pedido</h2>
        ${itens.map((i) => html`<div class="order-line"><span>${i.quantidade}× ${i.produto.nome_produto}</span><span>${moeda(Number(i.produto.preco) * i.quantidade)}</span></div>`)}
        <div class="order-line"><span>Subtotal</span><span>${moeda(resumo.subtotal)}</span></div>
        ${r
          ? html`<div class="order-line" id="linhaDesconto"><span>Desconto fidelidade (−${r.desconto_percentual}%)</span><span>−${moeda(resumo.desconto)}</span></div>
            <label class="check-item" style="margin:12px 0"><input type="checkbox" id="usarDesconto" checked> <span style="font-size:0.85rem">Usar “${r.nome}”${r.consome_pontos ? ` (${r.pontos_minimos} pontos)` : " (não gasta pontos)"}</span></label>`
          : ""}
        <div class="order-line" style="border:none;margin-top:8px;font-weight:700;font-size:1.05rem"><span>Total</span><span id="totalFinal"></span></div>
        <p class="text-muted" style="font-size:0.8rem;margin:8px 0 16px">Pagamento e retirada no salão. Reserva válida por ${resumo.prazo_retirada_dias} dia(s).</p>
        ${usuario
          ? ""
          : html`<label class="check-item" style="margin-bottom:16px;align-items:flex-start"><input type="checkbox" id="consentimento"><span style="font-size:0.85rem">Autorizo o uso destes dados só para esta reserva, conforme a <a href="privacidade.html" target="_blank" style="color:var(--accent)">política de privacidade</a>.</span></label>`}
        <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Confirmar pedido</button>
      </div>
    </form>`.toString();
  const form = $("#formCheckout");
  if (form.telefone) mascaraTelefone(form.telefone);
  form.addEventListener("change", (e) => {
    if (e.target.name === "forma") {
      forma = e.target.value;
      form.querySelectorAll(".pay-method").forEach((l) => l.classList.toggle("active", l.contains(e.target)));
    }
    atualizarTotal();
  });
  form.addEventListener("submit", enviar);
  atualizarTotal();
}

async function enviar(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const alerta = $("#alerta");
  alertaForm(alerta, null);
  const erro = (m) => {
    alertaForm(alerta, m);
    alerta.scrollIntoView({ block: "center" });
  };
  if (!usuario) {
    const m = regras.nome(form.nome.value) ?? regras.telefone(form.telefone.value) ?? regras.email(form.email.value) ?? ($("#consentimento").checked ? null : "Autorize o uso dos seus dados para fazer a reserva.");
    if (m) return erro(m);
  }
  await comCarregamento(form.querySelector("[type=submit]"), async () => {
    try {
      if (usuario) {
        const { pedido } = await post("/me/pedidos", {
          observacao: form.observacao.value,
          forma_pagamento: forma,
          usar_desconto: $("#usarDesconto")?.checked ?? true,
        });
        await recarregarCarrinho();
        concluido(pedido.reserva.codigo, pedido.valor_total, pedido.prazo_retirada);
      } else {
        const { reserva } = await post("/reservas", {
          nome: form.nome.value,
          telefone: form.telefone.value,
          email: form.email.value,
          consentimento: true,
          observacao: form.observacao.value,
          forma_pagamento: forma,
          data_retirada: form.data_retirada.value,
          itens: resumo.itens.map((i) => ({ id_produto: i.id_produto, quantidade: i.quantidade })),
        });
        esvaziarCarrinhoVisitante();
        concluido(reserva.codigo, reserva.pedido.total, reserva.pedido.prazo_retirada);
      }
    } catch (err) {
      erro(err.message);
      if (err.status === 409) await recarregarCarrinho();
    }
  }, "Confirmando...");
}

function concluido(codigo, total, prazo) {
  area.innerHTML = html`
    <div class="card" style="padding:32px;text-align:center;max-width:560px;margin:0 auto">
      <h2 style="margin-bottom:8px">✅ Pedido confirmado!</h2>
      <p class="text-secondary">Apresente este código no salão para retirar e pagar ${moeda(total)}.</p>
      <div class="codigo-reserva" aria-label="Código da reserva">${codigo}</div>
      <p class="text-muted" style="font-size:0.9rem">Retire até ${dataCurta(prazo)}. Depois disso, os itens voltam para o estoque.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px">
        ${usuario ? html`<a class="btn btn-outline" href="perfil.html#historico">Ver meus pedidos</a>` : html`<a class="btn btn-outline" href="${`reserva.html?codigo=${codigo}`}">Ver minha reserva</a>`}
        <a class="btn btn-ghost" href="catalogo.html?tipo=produtos">Continuar comprando</a>
      </div>
    </div>`.toString();
  window.scrollTo({ top: 0 });
}

async function atualizar() {
  try {
    resumo = await carregar();
    desenhar();
  } catch (err) {
    area.innerHTML = html`<p class="estado-vazio">${err.message}</p>`.toString();
  }
}
// O carrinho lateral mudou enquanto o checkout está aberto
window.addEventListener("carrinho:atualizado", async (e) => {
  if (!resumo || !$("#formCheckout")) return;
  const chave = (l) => l.map((i) => `${i.id_produto}x${i.quantidade}`).sort().join();
  if (chave(e.detail.itens) === chave(resumo.itens)) return;
  toast("Carrinho atualizado.", "info");
  await atualizar();
});
await atualizar();
