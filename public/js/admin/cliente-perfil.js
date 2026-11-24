// Ficha do cliente: estatísticas, contato rápido, dados, fidelidade e histórico.
import { get } from "../api.js";
import { $, html, raw, moeda, avatar, dataCurta, dataHora, dataSemFuso, telefoneFormatado, badgeStatus, STATUS_AGENDAMENTO, STATUS_PEDIDO, nomesServicos, mesAno } from "../ui.js";
import { chipsRedes } from "../social.js";
import { iniciarPainel } from "./comum.js";

await iniciarPainel(["ADMIN", "RECEPCIONISTA"]);
const area = $("#ficha");
const id = new URLSearchParams(location.search).get("id");
const linha = (rotulo, valor) => html`<div class="stat-row"><span>${rotulo}</span><span>${valor ?? "—"}</span></div>`;
const mascararCpf = (c) => (c ? `•••.${c.slice(3, 6)}.${c.slice(6, 9)}-••` : null);

try {
  if (!/^\d+$/.test(id ?? "")) throw new Error("Cliente não encontrado.");
  const { cliente: c, agendamentos, pedidos, fidelidade: f, favoritos, redes, estatisticas: e } = await get(`/admin/clientes/${id}`);
  const tel = (c.whatsapp ?? c.telefone ?? "").replace(/\D/g, "");
  const wa = tel ? `https://wa.me/${tel.startsWith("55") && tel.length > 11 ? tel : `55${tel}`}` : null;
  const favs = [...favoritos.cortes.map((x) => x.nome_corte), ...favoritos.servicos.map((x) => x.nome_servico), ...favoritos.produtos.map((x) => x.nome_produto)];
  area.innerHTML = html`
    <div class="ficha-topo">${avatar(c, "avatar avatar-lg")}
      <div><h2 style="font-size:1.3rem">${c.nome_completo} ${c.ativo ? "" : html`<span class="badge badge-accent">DESATIVADO</span>`}</h2>
      <p class="text-muted">Cliente desde ${mesAno(c.data_cadastro)} · ${f.nivel} · ${f.pontos} pontos</p>
      ${redes.length ? html`<div class="social-row">${chipsRedes(redes)}</div>` : ""}</div></div>
    <div class="ficha">
      <div class="admin-card"><h3>Estatísticas</h3>
        ${linha("Visitas", String(e.visitas))}${linha("Compras concluídas", String(e.compras))}${linha("Total gasto", moeda(e.total_gasto))}${linha("Última visita", e.ultima_visita ? dataCurta(e.ultima_visita) : null)}${linha("Faltas", String(e.faltas))}
      </div>
      <div class="admin-card"><h3>Contato rápido</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${wa ? html`<a class="btn btn-outline btn-sm" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
          ${c.telefone ? html`<a class="btn btn-outline btn-sm" href="${`tel:+55${c.telefone}`}">📞 Ligar</a>` : ""}
          ${c.email ? html`<a class="btn btn-outline btn-sm" href="${`mailto:${c.email}`}">✉️ E-mail</a>` : ""}
        </div>
        ${favs.length ? html`<h3 style="margin-top:20px">Preferências</h3><p class="text-secondary" style="font-size:0.9rem">${favs.join(", ")}</p>` : ""}
      </div>
      <div class="admin-card"><h3>Dados</h3>
        ${linha("E-mail", c.email)}${linha("Telefone", c.telefone ? telefoneFormatado(c.telefone) : null)}${linha("CPF", mascararCpf(c.cpf))}${linha("Nascimento", c.data_nascimento ? dataSemFuso(c.data_nascimento) : null)}${linha("Endereço", c.endereco)}
      </div>
      <div class="admin-card"><h3>Fidelidade</h3>
        ${linha("Nível", f.nivel)}${linha("Pontos", String(f.pontos))}${linha("Desconto ativo", f.desconto_ativo ? `${f.desconto_ativo.desconto_percentual}%` : null)}
        ${f.extrato.slice(0, 5).map((m) => html`<div class="stat-row"><span><small>${m.motivo}</small></span><span class="${m.pontos > 0 ? "pontos-mais" : "pontos-menos"}">${m.pontos > 0 ? "+" : ""}${m.pontos}</span></div>`)}
      </div>
    </div>
    <div class="admin-card" style="margin-bottom:20px"><h3>Atendimentos</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Serviços</th><th>Profissional</th><th>Status</th><th>Valor</th></tr></thead><tbody>
      ${agendamentos.length ? agendamentos.map((a) => html`<tr><td>${dataHora(a.data_hora_inicio)}</td><td>${nomesServicos(a)}</td><td>${a.barbeiro.nome_completo}</td><td>${badgeStatus(STATUS_AGENDAMENTO, a.status)}</td><td>${moeda(a.preco_registrado)}</td></tr>`) : raw('<tr><td colspan="5" class="estado-vazio">Nenhum atendimento.</td></tr>')}
    </tbody></table></div></div>
    <div class="admin-card"><h3>Pedidos</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Data</th><th>Itens</th><th>Status</th><th>Total</th></tr></thead><tbody>
      ${pedidos.length ? pedidos.map((p) => html`<tr><td><span class="codigo-tag">${p.reserva?.codigo ?? `#${p.id_pedido}`}</span></td><td>${dataCurta(p.data_pedido)}</td><td>${p.itens.map((i) => `${i.quantidade}x ${i.nome_produto_registrado}`).join(", ")}</td><td>${badgeStatus(STATUS_PEDIDO, p.status)}</td><td>${moeda(p.valor_total)}</td></tr>`) : raw('<tr><td colspan="5" class="estado-vazio">Nenhum pedido.</td></tr>')}
    </tbody></table></div></div>`.toString();
} catch (err) {
  area.innerHTML = html`<p class="estado-vazio">${err.message}</p>`.toString();
}
