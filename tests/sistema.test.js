// Testes de integração do sistema completo (agenda, loja, perfil, painel, permissões, uploads).
// Só rodam com TEST_DATABASE_URL (branch de teste do Neon) e removem apenas o que criaram.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MOTIVO_SKIP, prepararAmbienteTeste, Navegador, sufixo, DOMINIO_TESTE } from "./helpers.js";

const SENHA = "Teste1234";
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

const dataLocal = (dias) => {
  const d = new Date(Date.now() + dias * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
};

describe("sistema completo", { skip: MOTIVO_SKIP, concurrency: false }, () => {
  let server, base, prisma, caixa;
  const s = sufixo();
  const email = (nome) => `${nome}.${s}@${DOMINIO_TESTE}`;
  const criados = { servico: null, produto: null, corte: null };
  let admin, cliente, cliente2, barbeiro, idBarbeiro;

  async function entrar(emailLogin, senha = SENHA) {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/login", { email: emailLogin, senha });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return nav;
  }

  async function cadastrar(nome) {
    const nav = new Navegador(base);
    const r = await nav.post("/api/auth/cadastro", { nome_completo: `${nome} Sobrenome`, email: email(nome), senha: SENHA, telefone: "11987654321" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    nav.id = r.json.usuario.id_usuario;
    return nav;
  }

  async function enviarImagem(nav, bytes, tipo) {
    if (!nav.cookies.has("sc_csrf")) await nav.get("/api/csrf");
    const res = await fetch(`${base}/api/imagens`, {
      method: "POST",
      headers: { cookie: nav.cabecalhoCookie(), origin: base, "x-csrf-token": decodeURIComponent(nav.cookies.get("sc_csrf") ?? ""), "content-type": tipo },
      body: bytes,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  before(async () => {
    prepararAmbienteTeste();
    ({ prisma } = await import("../src/lib/prisma.js"));
    ({ caixaDeTeste: caixa } = await import("../src/lib/mailer.js"));
    const { criarApp } = await import("../src/app.js");
    server = criarApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;

    await prisma.usuario.create({
      data: { nome_completo: "Admin Sistema", email: email("admin"), senha_hash: await bcrypt.hash(SENHA, 4), tipo_perfil: "ADMIN" },
    });
    admin = await entrar(email("admin"));
    cliente = await cadastrar("cliente");
    cliente2 = await cadastrar("clientedois");
  });

  after(async () => {
    const usuarios = await prisma.usuario.findMany({ where: { email: { endsWith: `.${s}@${DOMINIO_TESTE}` } }, select: { id_usuario: true } });
    const ids = usuarios.map((u) => u.id_usuario);
    await prisma.agendamento.deleteMany({ where: { OR: [{ id_cliente: { in: ids } }, { id_barbeiro: { in: ids } }] } });
    await prisma.pedido.deleteMany({ where: { id_cliente: { in: ids } } });
    await prisma.imagem.deleteMany({ where: { id_usuario: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id_usuario: { in: ids } } });
    if (criados.servico) await prisma.servico.delete({ where: { id_servico: criados.servico } });
    if (criados.produto) await prisma.produto.delete({ where: { id_produto: criados.produto } });
    if (criados.corte) await prisma.corteGaleria.delete({ where: { id_corte: criados.corte } });
    await prisma.$disconnect();
    server.close();
  });

  // ───────── Permissões ─────────

  test("visitante e cliente não acessam o painel", async () => {
    assert.equal((await new Navegador(base).get("/api/admin/dashboard")).status, 401);
    assert.equal((await cliente.get("/api/admin/dashboard")).status, 403);
    assert.equal((await cliente.get("/api/admin/agendamentos")).status, 403);
    assert.equal((await cliente.post("/api/admin/servicos", { nome_servico: "X", preco: 1, duracao_minutos: 30 })).status, 403);
    assert.equal((await new Navegador(base).get("/api/me/resumo")).status, 401);
  });

  // ───────── Cadastros do painel ─────────

  test("admin cria serviço, produto e corte da galeria", async () => {
    let r = await admin.post("/api/admin/servicos", { nome_servico: `Corte Teste ${s}`, preco: "50,00", duracao_minutos: 30, icone: "✂️" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.servico.preco, "50");
    criados.servico = r.json.servico.id_servico;

    r = await admin.post("/api/admin/servicos", { nome_servico: `Corte Teste ${s}`, preco: 10, duracao_minutos: 30 });
    assert.equal(r.status, 409, "nome de serviço duplicado");

    r = await admin.post("/api/admin/produtos", { nome_produto: `Pomada ${s}`, preco: 40, quantidade_estoque: 2 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    criados.produto = r.json.produto.id_produto;

    r = await admin.post("/api/admin/produtos", { nome_produto: "Ruim", preco: -1, quantidade_estoque: 1 });
    assert.equal(r.status, 400);

    r = await admin.post("/api/admin/galeria", { nome_corte: `Fade ${s}`, imagem_url: "javascript:alert(1)" });
    assert.equal(r.status, 400, "URL de imagem perigosa é recusada");
    r = await admin.post("/api/admin/galeria", { nome_corte: `Fade ${s}`, imagem_url: "https://images.unsplash.com/photo-1?w=10" });
    assert.equal(r.status, 201);
    criados.corte = r.json.corte.id_corte;
  });

  test("admin cadastra profissional com serviços, expediente e convite por e-mail", async () => {
    caixa.length = 0;
    const disponibilidade = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, inicio: "08:00", fim: "20:00" }));
    const r = await admin.post("/api/admin/equipe", {
      nome_completo: "Barbeiro Teste",
      email: email("barbeiro"),
      telefone: "11912345678",
      tipo_perfil: "BARBEIRO",
      servicos: [criados.servico],
      disponibilidade,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    idBarbeiro = r.json.membro.id_usuario;
    assert.equal(r.json.membro.disponibilidade.length, 7);
    assert.equal(r.json.membro.tem_acesso, false);

    const convite = caixa.find((m) => m.para === email("barbeiro"));
    assert.ok(convite, "convite enviado");
    const token = convite.texto.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    const nav = new Navegador(base);
    const red = await nav.post("/api/auth/redefinir-senha", { token, senha: SENHA });
    assert.equal(red.status, 200);
    barbeiro = await entrar(email("barbeiro"));
  });

  test("expediente com intervalos sobrepostos é recusado", async () => {
    const r = await admin.put(`/api/admin/equipe/${idBarbeiro}`, {
      nome_completo: "Barbeiro Teste",
      email: email("barbeiro"),
      tipo_perfil: "BARBEIRO",
      servicos: [criados.servico],
      disponibilidade: [
        { dia_semana: 1, inicio: "08:00", fim: "12:00" },
        { dia_semana: 1, inicio: "11:00", fim: "14:00" },
      ],
    });
    assert.equal(r.status, 400);
  });

  test("barbeiro só acessa a própria agenda", async () => {
    assert.equal((await barbeiro.get("/api/admin/clientes")).status, 403);
    assert.equal((await barbeiro.get("/api/admin/dashboard")).status, 403);
    assert.equal((await barbeiro.get("/api/admin/agendamentos")).status, 200);
    const eq = await barbeiro.get("/api/admin/equipe");
    assert.deepEqual(eq.json.equipe.map((m) => m.id_usuario), [idBarbeiro]);
  });

  // ───────── Agenda ─────────

  let slot, agendamentoId;

  test("horários livres respeitam expediente e duração do serviço", async () => {
    const pub = new Navegador(base);
    const prof = await pub.get(`/api/profissionais?servico=${criados.servico}`);
    assert.ok(prof.json.profissionais.some((p) => p.id_usuario === idBarbeiro));

    const r = await pub.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(1)}&profissional=${idBarbeiro}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.horarios.length > 10, "deve haver vários horários amanhã");
    slot = r.json.horarios[4].inicio;
    const ultimo = r.json.horarios.at(-1);
    assert.equal(new Date(ultimo.fim) - new Date(ultimo.inicio), 30 * 60000);
  });

  test("cliente agenda; mesmo horário para outro cliente dá conflito", async () => {
    let r = await cliente.post("/api/me/agendamentos", { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: slot, observacao: "Degradê baixo" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.agendamento.status, "PENDENTE");
    assert.equal(r.json.agendamento.preco_registrado, "50");
    agendamentoId = r.json.agendamento.id_agendamento;

    r = await cliente2.post("/api/me/agendamentos", { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: slot });
    assert.equal(r.status, 409);

    const livres = await cliente2.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(1)}&profissional=${idBarbeiro}`);
    assert.ok(!livres.json.horarios.some((h) => h.inicio === slot), "horário ocupado some da lista");
  });

  test("dois clientes no mesmo horário ao mesmo tempo: só um consegue", async () => {
    const livres = await cliente.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(2)}&profissional=${idBarbeiro}`);
    const alvo = livres.json.horarios[6].inicio;
    const extra = await cadastrar("clientetres");
    const respostas = await Promise.all(
      [cliente2, extra].map((n) => n.post("/api/me/agendamentos", { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: alvo }))
    );
    const status = respostas.map((x) => x.status).sort();
    assert.deepEqual(status, [201, 409], JSON.stringify(respostas.map((x) => x.json)));
  });

  test("agendamento fora do expediente, no passado ou sem antecedência é recusado", async () => {
    const madrugada = new Date(`${dataLocal(1)}T03:00:00-03:00`).toISOString();
    let r = await cliente.post("/api/me/agendamentos", { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: madrugada });
    assert.equal(r.status, 409);
    r = await cliente.post("/api/me/agendamentos", { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: new Date(Date.now() - 3600000).toISOString() });
    assert.equal(r.status, 400);
  });

  test("bloqueio que colide com agendamento é recusado; bloqueio livre funciona", async () => {
    const ini = new Date(slot);
    let r = await admin.post("/api/admin/bloqueios", {
      id_barbeiro: idBarbeiro,
      inicio: new Date(ini.getTime() - 15 * 60000).toISOString(),
      fim: new Date(ini.getTime() + 15 * 60000).toISOString(),
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.erro.codigo, "CONFLITO_AGENDAMENTOS");

    const inicioBloq = new Date(`${dataLocal(3)}T12:00:00-03:00`);
    r = await barbeiro.post("/api/admin/bloqueios", {
      id_barbeiro: idBarbeiro,
      inicio: inicioBloq.toISOString(),
      fim: new Date(inicioBloq.getTime() + 2 * 3600000).toISOString(),
      motivo: "Almoço longo",
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const livres = await cliente.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(3)}&profissional=${idBarbeiro}`);
    assert.ok(!livres.json.horarios.some((h) => new Date(h.inicio) >= inicioBloq && new Date(h.inicio) < new Date(inicioBloq.getTime() + 2 * 3600000)));
  });

  test("equipe confirma; não conclui antes do horário; remarca", async () => {
    let r = await barbeiro.patch(`/api/admin/agendamentos/${agendamentoId}/status`, { status: "CONFIRMADO" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.agendamento.status, "CONFIRMADO");
    r = await admin.patch(`/api/admin/agendamentos/${agendamentoId}/status`, { status: "CONCLUIDO" });
    assert.equal(r.status, 409);

    const livres = await admin.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(4)}&profissional=${idBarbeiro}&ignorar=${agendamentoId}`);
    r = await admin.put(`/api/admin/agendamentos/${agendamentoId}`, { id_servico: criados.servico, id_barbeiro: idBarbeiro, inicio: livres.json.horarios[2].inicio });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.agendamento.data_hora_inicio, livres.json.horarios[2].inicio);
  });

  test("cliente não mexe no agendamento de outro; cancela o próprio", async () => {
    let r = await cliente2.post(`/api/me/agendamentos/${agendamentoId}/cancelar`, {});
    assert.equal(r.status, 404);
    r = await cliente.post(`/api/me/agendamentos/${agendamentoId}/cancelar`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.agendamento.status, "CANCELADO");
    r = await cliente.post(`/api/me/agendamentos/${agendamentoId}/cancelar`, {});
    assert.equal(r.status, 409, "cancelar de novo não é permitido");
    r = await admin.patch(`/api/admin/agendamentos/${agendamentoId}/status`, { status: "CONFIRMADO" });
    assert.equal(r.status, 200, "admin reativa um cancelado futuro");
  });

  test("avaliação só de atendimento concluído, uma única vez, e aparece no site sem sobrenome", async () => {
    const inicio = new Date(Date.now() - 3 * 86400000);
    const passado = await prisma.agendamento.create({
      data: {
        id_cliente: cliente.id,
        id_barbeiro: idBarbeiro,
        id_servico: criados.servico,
        data_hora_inicio: inicio,
        data_hora_fim: new Date(inicio.getTime() + 30 * 60000),
        preco_registrado: "50.00",
        status: "CONFIRMADO",
      },
    });
    let r = await cliente.post(`/api/me/agendamentos/${passado.id_agendamento}/avaliacao`, { nota: 5 });
    assert.equal(r.status, 409, "ainda não concluído");
    r = await admin.patch(`/api/admin/agendamentos/${passado.id_agendamento}/status`, { status: "CONCLUIDO" });
    assert.equal(r.status, 200);
    r = await cliente2.post(`/api/me/agendamentos/${passado.id_agendamento}/avaliacao`, { nota: 5 });
    assert.equal(r.status, 404, "outro cliente não avalia");
    r = await cliente.post(`/api/me/agendamentos/${passado.id_agendamento}/avaliacao`, { nota: 5, comentario: `Excelente ${s}` });
    assert.equal(r.status, 201);
    r = await cliente.post(`/api/me/agendamentos/${passado.id_agendamento}/avaliacao`, { nota: 4 });
    assert.equal(r.status, 409);

    const pub = await new Navegador(base).get("/api/avaliacoes?limite=50");
    const minha = pub.json.avaliacoes.find((a) => a.comentario === `Excelente ${s}`);
    assert.equal(minha.cliente, "cliente S.");
    assert.equal(JSON.stringify(pub.json).includes(email("cliente")), false, "e-mail não vaza");

    const resumo = await cliente.get("/api/me/resumo");
    assert.equal(resumo.json.resumo.visitas, 1);
    assert.equal(resumo.json.resumo.total_gasto, "50.00");
  });

  // ───────── Loja ─────────

  test("carrinho respeita estoque; pedido baixa estoque e cancelamento devolve", async () => {
    let r = await cliente.post("/api/me/carrinho", { id_produto: criados.produto, quantidade: 3 });
    assert.equal(r.status, 409, "mais que o estoque");
    r = await cliente.post("/api/me/carrinho", { id_produto: criados.produto, quantidade: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.json.total, "80.00");

    r = await cliente.post("/api/me/pedidos", {});
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const pedido = r.json.pedido;
    assert.equal(pedido.valor_total, "80");
    assert.equal((await prisma.produto.findUnique({ where: { id_produto: criados.produto } })).quantidade_estoque, 0);
    assert.equal((await cliente.get("/api/me/carrinho")).json.itens.length, 0, "carrinho esvaziado");

    r = await cliente2.post("/api/me/carrinho", { id_produto: criados.produto, quantidade: 1 });
    assert.equal(r.status, 409, "sem estoque");

    r = await cliente2.post(`/api/me/pedidos/${pedido.id_pedido}/cancelar`, {});
    assert.equal(r.status, 404, "não cancela pedido de outro");
    r = await cliente.post(`/api/me/pedidos/${pedido.id_pedido}/cancelar`, {});
    assert.equal(r.status, 200);
    r = await cliente.post(`/api/me/pedidos/${pedido.id_pedido}/cancelar`, {});
    assert.equal(r.status, 409, "duplo cancelamento não devolve estoque de novo");
    assert.equal((await prisma.produto.findUnique({ where: { id_produto: criados.produto } })).quantidade_estoque, 2);
  });

  test("dois pedidos simultâneos pela última unidade: só um é aceito", async () => {
    await prisma.produto.update({ where: { id_produto: criados.produto }, data: { quantidade_estoque: 1 } });
    await cliente.post("/api/me/carrinho", { id_produto: criados.produto, quantidade: 1 });
    await cliente2.post("/api/me/carrinho", { id_produto: criados.produto, quantidade: 1 });
    const respostas = await Promise.all([cliente.post("/api/me/pedidos", {}), cliente2.post("/api/me/pedidos", {})]);
    assert.deepEqual(respostas.map((x) => x.status).sort(), [201, 409]);
    assert.equal((await prisma.produto.findUnique({ where: { id_produto: criados.produto } })).quantidade_estoque, 0);
  });

  test("admin avança o pedido até concluído; concluído não cancela", async () => {
    const { json } = await admin.get("/api/admin/pedidos?status=PENDENTE");
    const p = json.pedidos.find((x) => x.itens.some((i) => i.id_produto === criados.produto));
    let r = await admin.patch(`/api/admin/pedidos/${p.id_pedido}/status`, { status: "PRONTO_PARA_RETIRADA" });
    assert.equal(r.status, 200);
    r = await admin.patch(`/api/admin/pedidos/${p.id_pedido}/status`, { status: "CONCLUIDO" });
    assert.equal(r.status, 200);
    r = await admin.patch(`/api/admin/pedidos/${p.id_pedido}/status`, { status: "CANCELADO" });
    assert.equal(r.status, 409);
  });

  // ───────── Favoritos, perfil e imagens ─────────

  test("favoritar e desfavoritar corte da galeria", async () => {
    let r = await cliente.put(`/api/me/favoritos/${criados.corte}`);
    assert.equal(r.status, 200);
    r = await cliente.put(`/api/me/favoritos/${criados.corte}`);
    assert.equal(r.status, 200, "idempotente");
    const gal = await cliente.get("/api/galeria");
    assert.equal(gal.json.cortes.find((c) => c.id_corte === criados.corte).favorito, true);
    assert.equal((await cliente.get("/api/me/favoritos")).json.favoritos.length, 1);
    r = await cliente.del(`/api/me/favoritos/${criados.corte}`);
    assert.equal((await cliente.get("/api/me/favoritos")).json.favoritos.length, 0);
  });

  test("upload aceita só imagens reais e entrega com cabeçalhos seguros", async () => {
    assert.equal((await enviarImagem(new Navegador(base), PNG_1X1, "image/png")).status, 401);
    let r = await enviarImagem(cliente, Buffer.from("<script>alert(1)</script>"), "image/png");
    assert.equal(r.status, 415, "HTML disfarçado de PNG é recusado");
    r = await enviarImagem(cliente, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml");
    assert.equal(r.status, 415);
    r = await enviarImagem(cliente, PNG_1X1, "image/png");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const res = await fetch(`${base}${r.json.url}`);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("content-security-policy"), /sandbox/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");

    const env = await cliente.post("/api/me/cortes-enviados", { nome: "Referência", imagem_url: r.json.url });
    assert.equal(env.status, 201);
    const cap = await cliente.put("/api/me/capa", { url: r.json.url });
    assert.equal(cap.json.usuario.capa_url, r.json.url);
  });

  test("perfil salva bio, endereço e redes; troca de senha exige a atual", async () => {
    let r = await cliente.put("/api/me/perfil", {
      nome_completo: "cliente Sobrenome",
      telefone: "(11) 98765-4321",
      endereco: "São Paulo, SP",
      bio: "Fã de degradê",
      instagram: "https://instagram.com/meu.perfil",
      tiktok: "@meutiktok",
      whatsapp: "(11) 98765-4321",
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.usuario.instagram, "meu.perfil");
    assert.equal(r.json.usuario.whatsapp, "5511987654321");

    r = await cliente.put("/api/me/senha", { senha_atual: "errada123", nova_senha: "NovaSenha123" });
    assert.equal(r.status, 400);
    const outraSessao = await entrar(email("cliente"));
    r = await cliente.put("/api/me/senha", { senha_atual: SENHA, nova_senha: "NovaSenha123" });
    assert.equal(r.status, 200);
    assert.equal((await outraSessao.get("/api/auth/me")).json.usuario, null, "outras sessões caem");
    assert.ok((await cliente.get("/api/auth/me")).json.usuario, "a sessão atual continua");
  });

  // ───────── Painel ─────────

  test("dashboard, clientes com estatísticas e configuração", async () => {
    const d = await admin.get("/api/admin/dashboard");
    assert.equal(d.status, 200);
    assert.ok(d.json.metricas.total_clientes >= 2);
    assert.ok(Array.isArray(d.json.atividade));

    const c = await admin.get(`/api/admin/clientes?busca=${encodeURIComponent(email("cliente"))}`);
    const eu = c.json.clientes.find((x) => x.id_usuario === cliente.id);
    assert.equal(eu.visitas, 1);

    let r = await admin.post("/api/admin/clientes", { nome_completo: "Cliente Balcão", telefone: "11955554444" });
    assert.equal(r.status, 201, "cliente de balcão sem e-mail");
    const balcao = r.json.cliente.id_usuario;
    r = await admin.post("/api/admin/agendamentos", {
      id_cliente: balcao,
      id_servico: criados.servico,
      id_barbeiro: idBarbeiro,
      inicio: (await admin.get(`/api/agenda/horarios?servico=${criados.servico}&data=${dataLocal(5)}&profissional=${idBarbeiro}`)).json.horarios[0].inicio,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.agendamento.status, "CONFIRMADO");
    await prisma.agendamento.deleteMany({ where: { id_cliente: balcao } });
    await prisma.usuario.delete({ where: { id_usuario: balcao } });

    const cfg = await admin.get("/api/admin/config");
    r = await admin.patch("/api/admin/config", { intervalo_slots_minutos: cfg.json.config.intervalo_slots_minutos });
    assert.equal(r.status, 200);
    r = await admin.patch("/api/admin/config", { url_mapa: "javascript:alert(1)" });
    assert.equal(r.status, 400);
  });

  test("admin não se desativa nem perde o último acesso de administrador", async () => {
    const eu = (await admin.get("/api/auth/me")).json.usuario;
    const r = await admin.patch(`/api/admin/equipe/${eu.id_usuario}/ativo`, { ativo: false });
    assert.equal(r.status, 409);
  });

  test("profissional com agendamento futuro não pode ser desativado", async () => {
    const r = await admin.patch(`/api/admin/equipe/${idBarbeiro}/ativo`, { ativo: false });
    assert.equal(r.status, 409);
  });
});
