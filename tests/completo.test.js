// Testes de integração: catálogo/3D, perfis e privacidade, feed, avaliações por critério, fidelidade,
// recepção, reservas, checkout, rotinas e auditoria. Só rodam na branch de teste e removem o que criaram.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { MOTIVO_SKIP, prepararAmbienteTeste, Navegador, sufixo, DOMINIO_TESTE } from "./helpers.js";

const SENHA = "Teste1234";
// Antes de qualquer import do código (a configuração é lida uma vez)
process.env.CLOUDINARY_CLOUD_NAME = "nuvemteste";
process.env.CLOUDINARY_API_KEY = "123456789012345";
process.env.CLOUDINARY_API_SECRET = "segredo-de-teste-do-cloudinary";
process.env.CLOUDINARY_PASTA = "studio-corte-teste";
process.env.CHAVE_DADOS = "ab".repeat(32);

describe("funcionalidades completas", { skip: MOTIVO_SKIP, concurrency: false }, () => {
  let server, base, prisma, transporte, caixa, executarRotinas, decifrar;
  const s = sufixo();
  const email = (n) => `${n}.c${s}@${DOMINIO_TESTE}`;
  const tel = `119${s.slice(-8)}`;
  const ids = {};
  const nav = {};
  const criados = { servicos: [], produtos: [], cortes: [], recompensas: [], contatos: [] };
  const recursos = new Map();
  const destruidos = [];
  let cfgAntes;

  async function entrar(identificador, senha = SENHA) {
    const n = new Navegador(base);
    const r = await n.post("/api/auth/login", { email: identificador, senha });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return n;
  }
  const ok = (r, status = 200) => {
    assert.equal(r.status, status, JSON.stringify(r.json));
    return r.json;
  };

  // Próxima segunda-feira às HH:MM (horário do salão), pelo menos daqui a 2 dias
  function segunda(hora = "10:00") {
    const d = new Date(Date.now() + 2 * 864e5);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    return { data: iso, inicio: new Date(`${iso}T${hora}:00-03:00`).toISOString() };
  }
  // Atendimento no passado, já pronto para concluir
  const passado = (extra = {}) =>
    prisma.agendamento.create({
      data: {
        id_cliente: ids.cliente,
        id_barbeiro: ids.barbeiro,
        id_servico: criados.servicos[0],
        data_hora_inicio: new Date(Date.now() - (extra.horas ?? 5) * 36e5),
        data_hora_fim: new Date(Date.now() - (extra.horas ?? 5) * 36e5 + 30 * 6e4),
        preco_registrado: 80,
        status: "CONFIRMADO",
        servicos: { create: [{ id_servico: criados.servicos[0], preco_registrado: 80, duracao_minutos: 30 }] },
      },
    });

  function midiaFalsa(finalidade, idUsuario, nome, { tipo = "image", formato = "jpg" } = {}) {
    const pid = `studio-corte-teste/${finalidade.toLowerCase()}/u${idUsuario}/${nome}${s}${tipo === "raw" ? `.${formato}` : ""}`;
    recursos.set(pid, {
      public_id: pid,
      format: formato,
      bytes: 5000,
      width: 10,
      height: 10,
      secure_url: `https://res.cloudinary.com/nuvemteste/${tipo}/upload/v1/${pid}${tipo === "raw" ? "" : `.${formato}`}`,
    });
    return pid;
  }
  async function enviar(n, finalidade, idUsuario, nome, tipo = "IMAGEM") {
    const t = { IMAGEM: {}, VIDEO: { tipo: "video", formato: "mp4" }, MODELO_3D: { tipo: "raw", formato: "glb" } }[tipo];
    return ok(await n.post("/api/midia/confirmar", { finalidade, tipo, public_id: midiaFalsa(finalidade, idUsuario, nome, t) }), 201);
  }

  before(async () => {
    prepararAmbienteTeste();
    ({ prisma } = await import("../src/lib/prisma.js"));
    ({ transporte } = await import("../src/lib/cloudinary.js"));
    ({ caixaDeTeste: caixa } = await import("../src/lib/mailer.js"));
    ({ executarRotinas } = await import("../src/services/rotinaService.js"));
    ({ decifrar } = await import("../src/lib/cifra.js"));
    transporte.fetch = async (url, opcoes = {}) => {
      const u = String(url);
      if (u.includes("/destroy")) {
        destruidos.push(Object.fromEntries(opcoes.body).public_id);
        return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
      }
      const r = recursos.get(decodeURIComponent(u.match(/\/upload\/(.+)$/)[1]));
      return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response("{}", { status: 404 });
    };
    const { criarApp } = await import("../src/app.js");
    server = criarApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
    cfgAntes = await prisma.configuracaoSalao.findUnique({ where: { id: 1 } });

    const hash = await bcrypt.hash(SENHA, 4);
    for (const [k, nome, tipo_perfil] of [
      ["admin", "Admin Completo", "ADMIN"],
      ["recep", "Rita Recepção", "RECEPCIONISTA"],
      ["barbeiro", "Bruno Barbeiro", "BARBEIRO"],
      ["barbeiro2", "Beto Barbeiro", "BARBEIRO"],
      ["cliente", "Carla Cliente Silva", "CLIENTE"],
      ["outro", "Otto Outro Souza", "CLIENTE"],
    ]) {
      const u = await prisma.usuario.create({ data: { nome_completo: nome, email: email(k), telefone: "11988887777", senha_hash: hash, tipo_perfil } });
      ids[k] = u.id_usuario;
      nav[k] = await entrar(email(k));
    }
    nav.visita = new Navegador(base);

    const srv = async (nome, preco, dur, area = "BARBEARIA") => {
      const r = ok(await nav.admin.post("/api/admin/servicos", { nome_servico: `${nome} ${s}`, preco, duracao_minutos: dur, area }), 201);
      criados.servicos.push(r.servico.id_servico);
      return r.servico.id_servico;
    };
    await srv("Corte", 80, 30);
    await srv("Barba", 40, 30);
    await srv("Luzes", 200, 60, "CABELEIREIRO");
    const disponibilidade = [1, 2, 3, 4, 5].map((dia_semana) => ({ dia_semana, inicio: "09:00", fim: "18:00" }));
    for (const k of ["barbeiro", "barbeiro2"]) {
      ok(
        await nav.admin.put(`/api/admin/equipe/${ids[k]}`, {
          nome_completo: k === "barbeiro" ? "Bruno Barbeiro" : "Beto Barbeiro",
          email: email(k),
          tipo_perfil: "BARBEIRO",
          servicos: criados.servicos.slice(0, 2),
          disponibilidade,
          perfil: { area: "BARBEARIA", especialidades: ["Degradê"], anos_experiencia: 5, certificacoes: "Curso X", bio: "Bio pública", visivel_no_site: true },
        })
      );
    }
    const p = ok(await nav.admin.post("/api/admin/produtos", { nome_produto: `Pomada ${s}`, preco: "100.00", quantidade_estoque: 10 }), 201);
    criados.produtos.push(p.produto.id_produto);
  });

  after(async () => {
    const usuarios = (await prisma.usuario.findMany({ where: { OR: [{ email: { endsWith: `.c${s}@${DOMINIO_TESTE}` } }, { telefone: tel }] }, select: { id_usuario: true } })).map((u) => u.id_usuario);
    const posts = (await prisma.post.findMany({ where: { id_autor: { in: usuarios } }, select: { id_post: true } })).map((p) => p.id_post);
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ id_autor: { in: usuarios } }, { id_autor: null, detalhes: { path: ["identificador"], string_contains: s } }] } });
    await prisma.post.deleteMany({ where: { id_post: { in: posts } } });
    await prisma.midia.deleteMany({ where: { id_usuario: { in: usuarios } } });
    await prisma.agendamento.deleteMany({ where: { OR: [{ id_cliente: { in: usuarios } }, { id_barbeiro: { in: usuarios } }] } });
    await prisma.pedido.deleteMany({ where: { id_cliente: { in: usuarios } } });
    await prisma.reserva.deleteMany({ where: { id_cliente: { in: usuarios } } });
    await prisma.movimentoPontos.deleteMany({ where: { id_usuario: { in: usuarios } } });
    await prisma.corteGaleria.deleteMany({ where: { id_corte: { in: criados.cortes } } });
    await prisma.recompensa.deleteMany({ where: { id_recompensa: { in: criados.recompensas } } });
    await prisma.contatoOficial.deleteMany({ where: { id_contato: { in: criados.contatos } } });
    await prisma.usuario.deleteMany({ where: { id_usuario: { in: usuarios } } });
    await prisma.produto.deleteMany({ where: { id_produto: { in: criados.produtos } } });
    await prisma.servico.deleteMany({ where: { id_servico: { in: criados.servicos } } });
    if (cfgAntes) await prisma.configuracaoSalao.update({ where: { id: 1 }, data: cfgAntes });
    await prisma.$disconnect();
    server.close();
  });

  // ───────── Conta ─────────
  test("cadastro exige aceite da política; usuário de login funciona e é único", async () => {
    const dados = { nome_completo: "Nova Conta", email: email("nova"), senha: SENHA, telefone: "11977776666" };
    assert.equal((await nav.visita.post("/api/auth/cadastro", dados)).status, 400);
    const n = new Navegador(base);
    const r = ok(await n.post("/api/auth/cadastro", { ...dados, consentimento: true, usuario: `Nova.${s}` }), 201);
    assert.equal(r.usuario.usuario, `nova.${s}`);
    const db = await prisma.usuario.findUnique({ where: { email: email("nova") } });
    assert.ok(db.consentimento_lgpd_em);
    await entrar(`nova.${s}`);
    assert.equal((await nav.cliente.put("/api/me/usuario", { usuario: `nova.${s}` })).status, 409);
    assert.equal((await nav.cliente.put("/api/me/usuario", { usuario: "a b" })).status, 400);
    ok(await nav.cliente.put("/api/me/usuario", { usuario: `carla.${s}` }));
    const errado = await new Navegador(base).post("/api/auth/login", { email: `carla.${s}`, senha: "Errada123" });
    assert.equal(errado.status, 401);
  });

  test("troca de e-mail só vale depois da confirmação e exige a senha", async () => {
    const n = await entrar(email("nova"));
    const novo = email("novoendereco");
    assert.equal((await n.post("/api/me/email", { novo_email: novo, senha_atual: "Errada123" })).status, 400);
    caixa.length = 0;
    ok(await n.post("/api/me/email", { novo_email: novo, senha_atual: SENHA }));
    assert.equal((await prisma.usuario.count({ where: { email: novo } })), 0);
    const token = caixa.at(-1).texto.match(/token=([\w-]{43})/)[1];
    ok(await nav.visita.post("/api/auth/confirmar-email", { token }));
    assert.equal((await prisma.usuario.count({ where: { email: novo } })), 1);
    assert.equal((await nav.visita.post("/api/auth/confirmar-email", { token })).status, 400);
  });

  test("redes sociais: só links seguros, sem repetir, e só o dono mexe", async () => {
    for (const url of ["javascript:alert(1)", "http://inseguro.com", "data:text/html,x"]) {
      assert.equal((await nav.cliente.post("/api/me/redes", { rede: "custom", rotulo: "X", url })).status, 400, url);
    }
    const r = ok(await nav.cliente.post("/api/me/redes", { rede: "instagram", rotulo: "Instagram", url: "https://instagram.com/carla", publico: true }), 201);
    ok(await nav.cliente.post("/api/me/redes", { rede: "telefone", rotulo: "Telefone", url: "tel:+5511999998888", publico: false }), 201);
    assert.equal((await nav.cliente.post("/api/me/redes", { rede: "instagram", rotulo: "I", url: "https://instagram.com/carla" })).status, 409);
    assert.equal((await nav.outro.del(`/api/me/redes/${r.redes[0].id_rede}`)).status, 404);
  });

  // ───────── Privacidade e perfis públicos ─────────
  test("perfil nasce privado; só mostra o que o usuário permite", async () => {
    assert.equal((await nav.visita.get(`/api/perfis/${ids.cliente}`)).status, 404);
    const previa = ok(await nav.cliente.get(`/api/perfis/${ids.cliente}`));
    assert.equal(previa.perfil.previa, true);
    await prisma.usuario.update({ where: { id_usuario: ids.cliente }, data: { cpf: "39053344705", data_nascimento: new Date("1990-03-12T00:00:00Z"), bio: "Minha bio" } });
    const padrao = { perfil_publico: true, mostrar_email: false, mostrar_telefone: false, mostrar_nascimento: false, mostrar_bio: true, mostrar_estatisticas: true, mostrar_favoritos: true };
    ok(await nav.cliente.put("/api/me/privacidade", padrao));
    let { perfil } = ok(await nav.visita.get(`/api/perfis/${ids.cliente}`));
    assert.equal(perfil.nome, "Carla S.");
    assert.equal(perfil.email, null);
    assert.equal(perfil.telefone, null);
    assert.equal(perfil.bio, "Minha bio");
    assert.equal(perfil.redes.length, 1, "rede não pública fica fora");
    assert.equal(JSON.stringify(perfil).includes("39053344705"), false, "CPF nunca é público");
    ok(await nav.cliente.put("/api/me/privacidade", { ...padrao, mostrar_email: true, mostrar_nascimento: true, mostrar_bio: false, mostrar_favoritos: false }));
    ({ perfil } = ok(await nav.visita.get(`/api/perfis/${ids.cliente}`)));
    assert.equal(perfil.email, email("cliente"));
    assert.equal(perfil.aniversario, "12 de março", "sem o ano");
    assert.equal(perfil.bio, null);
    assert.equal(perfil.favoritos, null);
    ok(await nav.cliente.put("/api/me/privacidade", padrao));
  });

  test("perfil do profissional é público, com especialidades; oculto some do site", async () => {
    const { perfil } = ok(await nav.visita.get(`/api/perfis/${ids.barbeiro}`));
    assert.equal(perfil.tipo, "PROFISSIONAL");
    assert.deepEqual(perfil.especialidades, ["Degradê"]);
    assert.equal(perfil.email, undefined);
    // o profissional edita o próprio perfil, mas não decide a visibilidade
    ok(await nav.barbeiro.put(`/api/admin/profissionais/${ids.barbeiro}`, { area: "AMBOS", especialidades: ["Fade", "Barba"], visivel_no_site: false, bio: "Nova bio" }));
    assert.equal((await prisma.perfilProfissional.findUnique({ where: { id_usuario: ids.barbeiro } })).visivel_no_site, true);
    assert.equal((await nav.barbeiro.put(`/api/admin/profissionais/${ids.barbeiro2}`, { area: "AMBOS" })).status, 404);
    const lista = ok(await nav.visita.get("/api/profissionais?area=CABELEIREIRO"));
    assert.ok(lista.profissionais.some((p) => p.id_usuario === ids.barbeiro));
    assert.ok(!lista.profissionais.some((p) => p.id_usuario === ids.barbeiro2));
  });

  // ───────── Catálogo e 3D ─────────
  test("catálogo filtra por área e guarda favoritos de serviços e produtos", async () => {
    const barb = ok(await nav.visita.get("/api/servicos?area=BARBEARIA")).servicos.map((x) => x.id_servico);
    assert.ok(barb.includes(criados.servicos[0]) && !barb.includes(criados.servicos[2]));
    ok(await nav.cliente.put(`/api/me/favoritos/servicos/${criados.servicos[0]}`));
    ok(await nav.cliente.put(`/api/me/favoritos/produtos/${criados.produtos[0]}`));
    const f = ok(await nav.cliente.get("/api/me/favoritos"));
    assert.equal(f.servicos.length, 1);
    assert.equal(f.produtos.length, 1);
    assert.equal(ok(await nav.cliente.get("/api/servicos")).servicos.find((x) => x.id_servico === criados.servicos[0]).favorito, true);
    ok(await nav.cliente.del(`/api/me/favoritos/servicos/${criados.servicos[0]}`));
    assert.equal((await nav.cliente.put("/api/me/favoritos/servicos/99999999")).status, 404);
  });

  test("profissional publica corte só com foto; 3D é opcional e validado", async () => {
    const foto = await enviar(nav.barbeiro, "GALERIA", ids.barbeiro, "foto");
    const c = ok(await nav.barbeiro.post("/api/admin/galeria", { nome_corte: `Corte ${s}`, imagem_url: foto.url, area: "AMBOS", duracao_ref_minutos: "", preco_ref: "" }), 201).corte;
    criados.cortes.push(c.id_corte);
    assert.equal(c.modelo_3d_url, null);
    assert.equal(c.id_autor, ids.barbeiro);
    const pub = ok(await nav.visita.get("/api/galeria")).cortes.find((x) => x.id_corte === c.id_corte);
    assert.equal(pub.modelo_3d_url, null);
    assert.equal(pub.autor.nome, "Bruno Barbeiro");

    const base3d = { nome_corte: `Corte ${s}`, imagem_url: foto.url, area: "AMBOS" };
    for (const ruim of ["https://evil.example/x.glb", "javascript:alert(1)", "https://sketchfab.com/feed"]) {
      assert.equal((await nav.barbeiro.put(`/api/admin/galeria/${c.id_corte}`, { ...base3d, modelo_3d_url: ruim })).status, 400, ruim);
    }
    const glb = await enviar(nav.barbeiro, "CORTE_3D", ids.barbeiro, "modelo", "MODELO_3D");
    assert.equal(ok(await nav.barbeiro.put(`/api/admin/galeria/${c.id_corte}`, { ...base3d, modelo_3d_url: glb.url })).corte.modelo_3d_url, glb.url);
    const sk = ok(await nav.barbeiro.put(`/api/admin/galeria/${c.id_corte}`, { ...base3d, modelo_3d_url: `https://sketchfab.com/3d-models/cabeca-${"a1".repeat(16)}` })).corte;
    assert.equal(sk.modelo_3d_url, `https://sketchfab.com/models/${"a1".repeat(16)}/embed`);
    assert.equal(ok(await nav.barbeiro.put(`/api/admin/galeria/${c.id_corte}`, { ...base3d, modelo_3d_url: "" })).corte.modelo_3d_url, null, "pode remover o 3D");

    // outro profissional não mexe, nem usa a mídia alheia; cliente e recepção não enviam 3D
    assert.equal((await nav.barbeiro2.put(`/api/admin/galeria/${c.id_corte}`, base3d)).status, 403);
    assert.equal((await nav.barbeiro2.post("/api/admin/galeria", base3d)).status, 400);
    assert.equal(ok(await nav.barbeiro2.get("/api/admin/galeria")).cortes.length, 0);
    for (const k of ["cliente", "recep"]) assert.equal((await nav[k].post("/api/midia/assinatura", { finalidade: "CORTE_3D", tipo: "MODELO_3D" })).status, 403);
    assert.equal((await nav.recep.get("/api/admin/galeria")).status, 403);
  });

  // ───────── Agendamento: vários serviços e pessoas ─────────
  test("vários serviços somam duração e preço, com código de reserva", async () => {
    const { data, inicio } = segunda("09:00");
    const h = ok(await nav.cliente.get(`/api/agenda/horarios?servicos=${criados.servicos.slice(0, 2).join(",")}&data=${data}&profissional=${ids.barbeiro}`));
    assert.equal(h.duracao_minutos, 60);
    assert.equal(h.preco_total, "120.00");
    const r = ok(await nav.cliente.post("/api/me/agendamentos", { servicos: criados.servicos.slice(0, 2), id_barbeiro: ids.barbeiro, inicio, cortes: [criados.cortes[0]] }), 201);
    assert.match(r.codigo, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(r.agendamento.servicos.length, 2);
    assert.equal(Number(r.agendamento.preco_registrado), 120);
    assert.equal(new Date(r.agendamento.data_hora_fim) - new Date(r.agendamento.data_hora_inicio), 60 * 6e4);
    assert.equal(r.agendamento.cortes[0].corte.id_corte, criados.cortes[0]);
    ids.agMulti = r.agendamento.id_agendamento;
    // profissional que não faz um dos serviços
    assert.equal((await nav.outro.post("/api/me/agendamentos", { servicos: [criados.servicos[0], criados.servicos[2]], id_barbeiro: ids.barbeiro, inicio: segunda("14:00").inicio })).status, 409);
    // remarcar mantém os dois serviços
    const rem = ok(await nav.admin.put(`/api/admin/agendamentos/${ids.agMulti}`, { id_barbeiro: ids.barbeiro, inicio: segunda("11:00").inicio }));
    assert.equal(rem.agendamento.servicos.length, 2);
    assert.equal(Number(rem.agendamento.preco_registrado), 120);
  });

  test("duas pessoas ao mesmo tempo usam profissionais diferentes; três não cabem", async () => {
    const { inicio } = segunda("15:00");
    const tres = await nav.outro.post("/api/me/agendamentos", { servicos: [criados.servicos[0]], pessoas: 3, inicio });
    assert.equal(tres.status, 409);
    const r = ok(await nav.outro.post("/api/me/agendamentos", { servicos: [criados.servicos[0]], pessoas: 2, inicio }), 201);
    assert.equal(r.agendamentos.length, 2);
    assert.notEqual(r.agendamentos[0].barbeiro.id_usuario, r.agendamentos[1].barbeiro.id_usuario);
    assert.equal(r.agendamentos[0].reserva.codigo, r.agendamentos[1].reserva.codigo);
    for (const a of r.agendamentos) ok(await nav.outro.post(`/api/me/agendamentos/${a.id_agendamento}/cancelar`, {}));
    assert.equal((await prisma.reserva.findUnique({ where: { codigo: r.codigo } })).status, "CANCELADA");
    // com profissional escolhido, em sequência
    const seq = ok(await nav.outro.post("/api/me/agendamentos", { servicos: [criados.servicos[0]], pessoas: 2, id_barbeiro: ids.barbeiro2, inicio }), 201);
    assert.equal(seq.agendamentos[1].data_hora_inicio, seq.agendamentos[0].data_hora_fim);
    for (const a of seq.agendamentos) ok(await nav.outro.post(`/api/me/agendamentos/${a.id_agendamento}/cancelar`, {}));
  });

  // ───────── Reservas de visitante ─────────
  let reserva;
  test("visitante reserva horário e produto só com contato e aceite; recebe código", async () => {
    const corpo = {
      nome: "Vitor Visitante",
      telefone: tel,
      email: email("visitante"),
      consentimento: true,
      agendamento: { servicos: [criados.servicos[0]], id_barbeiro: ids.barbeiro2, inicio: segunda("10:00").inicio },
      itens: [{ id_produto: criados.produtos[0], quantidade: 2 }],
      data_retirada: segunda().data,
    };
    assert.equal((await nav.visita.post("/api/reservas", { ...corpo, consentimento: false })).status, 400);
    assert.equal((await nav.visita.post("/api/reservas", { ...corpo, agendamento: null, itens: [] })).status, 400);
    const estoque = () => prisma.produto.findUnique({ where: { id_produto: criados.produtos[0] } }).then((p) => p.quantidade_estoque);
    assert.equal(await estoque(), 10);
    ({ reserva } = ok(await nav.visita.post("/api/reservas", corpo), 201));
    assert.match(reserva.codigo, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(await estoque(), 8);
    assert.equal(Number(reserva.pedido.total), 200);
    // conflito de horário desfaz tudo (nenhum estoque baixado)
    assert.equal((await nav.visita.post("/api/reservas", corpo)).status, 409);
    assert.equal(await estoque(), 8);
    const db = await prisma.reserva.findUnique({ where: { codigo: reserva.codigo }, include: { cliente: true } });
    assert.equal(db.cliente.visitante, true);
    assert.equal(db.cliente.email, null, "o e-mail informado não vira login");
    assert.ok(db.consentimento_lgpd_em);
    const prazo = (new Date(reserva.pedido.prazo_retirada) - Date.now()) / 864e5;
    assert.ok(prazo > 5, "prazo conta a partir da data desejada");
  });

  test("consulta exige código e telefone certos; visitantes não aparecem em Clientes", async () => {
    assert.equal((await nav.visita.post("/api/reservas/consulta", { codigo: reserva.codigo, telefone: "11900000000" })).status, 404);
    assert.equal((await nav.visita.post("/api/reservas/consulta", { codigo: "ZZZZZZ", telefone: tel })).status, 404);
    const r = ok(await nav.visita.post("/api/reservas/consulta", { codigo: reserva.codigo.toLowerCase(), telefone: tel }));
    assert.equal(r.reserva.agendamentos[0].servicos.length, 1);
    const cli = ok(await nav.recep.get(`/api/admin/clientes?busca=${encodeURIComponent("Vitor Visitante")}`));
    assert.equal(cli.clientes.length, 0);
    const bal = ok(await nav.recep.get(`/api/admin/reservas?busca=${reserva.codigo}`));
    assert.equal(bal.reservas.length, 1);
    assert.equal((await nav.barbeiro.get("/api/admin/reservas")).status, 403);
    assert.equal((await nav.cliente.get("/api/admin/reservas")).status, 403);
  });

  test("limite de reservas abertas por telefone", async () => {
    const simples = (i) => ({ nome: "Vitor Visitante", telefone: tel, email: email("visitante"), consentimento: true, itens: [{ id_produto: criados.produtos[0], quantidade: 1 }], observacao: `n${i}` });
    const a = ok(await nav.visita.post("/api/reservas", simples(1)), 201).reserva;
    const b = ok(await nav.visita.post("/api/reservas", simples(2)), 201).reserva;
    assert.equal((await nav.visita.post("/api/reservas", simples(3))).status, 409);
    for (const r of [a, b]) assert.equal(ok(await nav.visita.post("/api/reservas/cancelar", { codigo: r.codigo, telefone: tel })).reserva.status, "CANCELADA");
    assert.equal((await prisma.produto.findUnique({ where: { id_produto: criados.produtos[0] } })).quantidade_estoque, 8, "estoque devolvido");
  });

  test("balcão registra chegada, cadastra o visitante por convite e conclui o pedido", async () => {
    const id = (await prisma.reserva.findUnique({ where: { codigo: reserva.codigo } })).id_reserva;
    const cheg = ok(await nav.recep.post(`/api/admin/reservas/${id}/chegada`));
    assert.ok(cheg.reserva.agendamentos[0].chegou_em);
    assert.equal(cheg.reserva.agendamentos[0].status, "CONFIRMADO");
    // e-mail de membro da equipe é recusado; de cliente existente pede confirmação
    const dados = { nome_completo: "Vitor Visitante", telefone: tel, concluir: true };
    assert.equal((await nav.recep.post(`/api/admin/reservas/${id}/cadastrar`, { ...dados, email: email("barbeiro") })).status, 409);
    assert.equal((await nav.recep.post(`/api/admin/reservas/${id}/cadastrar`, { ...dados, email: email("outro") })).status, 409);
    caixa.length = 0;
    const r = ok(await nav.recep.post(`/api/admin/reservas/${id}/cadastrar`, { ...dados, email: email("visitante") }));
    assert.equal(r.novo, true);
    assert.equal(r.reserva.pedido.status, "CONCLUIDO");
    assert.match(caixa.at(-1).texto, /criar sua senha/);
    const u = await prisma.usuario.findUnique({ where: { email: email("visitante") } });
    assert.equal(u.visitante, false);
    assert.equal(u.senha_hash, null, "a equipe nunca define a senha");
    const pontos = await prisma.movimentoPontos.findMany({ where: { id_usuario: u.id_usuario } });
    assert.equal(pontos.length, 1);
    assert.equal(pontos[0].pontos, 20);
  });

  test("vincular à conta existente leva o histórico para ela", async () => {
    const t2 = `118${s.slice(-8)}`;
    const { reserva: r } = ok(await nav.visita.post("/api/reservas", { nome: "Otto Outro", telefone: t2, email: email("outro"), consentimento: true, itens: [{ id_produto: criados.produtos[0], quantidade: 1 }] }), 201);
    const id = (await prisma.reserva.findUnique({ where: { codigo: r.codigo } })).id_reserva;
    const v = ok(await nav.recep.post(`/api/admin/reservas/${id}/cadastrar`, { nome_completo: "Otto Outro", telefone: t2, email: email("outro"), vincular: true, concluir: true }));
    assert.equal(v.novo, false);
    assert.equal(v.reserva.cliente.id_usuario, ids.outro);
    assert.equal(ok(await nav.outro.get("/api/me/pedidos")).pedidos[0].status, "CONCLUIDO");
    await prisma.usuario.deleteMany({ where: { telefone: t2, visitante: true } });
  });

  // ───────── Rotinas automáticas ─────────
  test("visitante sem check-in vira falta após a tolerância; com chegada ou conta, não", async () => {
    const provisorio = await prisma.usuario.create({ data: { nome_completo: "Falta Visitante", telefone: tel, visitante: true } });
    const reservar = async (cod, idCliente, visitante, chegou_em = null, horas = 1) => {
      const r = await prisma.reserva.create({ data: { codigo: cod, id_cliente: idCliente, visitante, nome: "Falta", telefone: tel } });
      const a = await passado({ horas });
      return prisma.agendamento.update({ where: { id_agendamento: a.id_agendamento }, data: { id_cliente: idCliente, id_reserva: r.id_reserva, status: "PENDENTE", chegou_em } });
    };
    const { gerarCodigo } = await import("../src/services/codigoService.js");
    const faltou = await reservar(gerarCodigo(), provisorio.id_usuario, true, null, 30);
    const chegou = await reservar(gerarCodigo(), provisorio.id_usuario, true, new Date(), 31);
    const comConta = await reservar(gerarCodigo(), ids.cliente, false, null, 32);
    await executarRotinas();
    const st = async (a) => prisma.agendamento.findUnique({ where: { id_agendamento: a.id_agendamento }, include: { reserva: true } });
    const f = await st(faltou);
    assert.equal(f.status, "NAO_COMPARECEU");
    assert.equal(f.falta_automatica, true);
    assert.equal(f.reserva.status, "EXPIRADA");
    assert.equal((await st(chegou)).status, "PENDENTE");
    assert.equal((await st(comConta)).status, "PENDENTE");
  });

  test("pedido com prazo vencido é cancelado, devolve estoque e pontos", async () => {
    await nav.cliente.post("/api/me/carrinho", { id_produto: criados.produtos[0], quantidade: 1 });
    const { pedido } = ok(await nav.cliente.post("/api/me/pedidos", { forma_pagamento: "PIX" }), 201);
    const antes = (await prisma.produto.findUnique({ where: { id_produto: criados.produtos[0] } })).quantidade_estoque;
    await prisma.pedido.update({ where: { id_pedido: pedido.id_pedido }, data: { prazo_retirada: new Date(Date.now() - 1000) } });
    await executarRotinas();
    const p = await prisma.pedido.findUnique({ where: { id_pedido: pedido.id_pedido }, include: { reserva: true } });
    assert.equal(p.status, "CANCELADO");
    assert.equal(p.motivo_cancelamento, "Prazo de retirada vencido");
    assert.equal(p.reserva.status, "EXPIRADA");
    assert.equal((await prisma.produto.findUnique({ where: { id_produto: criados.produtos[0] } })).quantidade_estoque, antes + 1);
  });

  // ───────── Fidelidade e checkout ─────────
  test("pontos entram uma vez por conclusão, saem se desfeita e voltam se concluída de novo", async () => {
    const a = await passado({ horas: 6 });
    const pontos = async () => ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade.pontos;
    const inicial = await pontos();
    ok(await nav.admin.patch(`/api/admin/agendamentos/${a.id_agendamento}/status`, { status: "CONCLUIDO" }));
    assert.equal(await pontos(), inicial + 8);
    ok(await nav.admin.patch(`/api/admin/agendamentos/${a.id_agendamento}/status`, { status: "CONCLUIDO" }));
    assert.equal(await pontos(), inicial + 8, "repetir não soma");
    ok(await nav.admin.patch(`/api/admin/agendamentos/${a.id_agendamento}/status`, { status: "CONFIRMADO" }));
    assert.equal(await pontos(), inicial);
    // duas conclusões simultâneas: só uma credita
    await Promise.all([1, 2].map(() => nav.admin.patch(`/api/admin/agendamentos/${a.id_agendamento}/status`, { status: "CONCLUIDO" })));
    assert.equal(await pontos(), inicial + 8);
    ids.agConcluido = a.id_agendamento;
  });

  test("desconto é calculado no servidor, consome pontos e volta no cancelamento", async () => {
    const r = ok(await nav.admin.post("/api/admin/fidelidade/recompensas", { nome: `Teste ${s}`, pontos_minimos: 700001, desconto_percentual: 25, consome_pontos: true }), 201).recompensa;
    criados.recompensas.push(r.id_recompensa);
    assert.equal((await nav.cliente.post(`/api/admin/fidelidade/clientes/${ids.cliente}/ajuste`, { pontos: 100, motivo: "x" })).status, 403);
    assert.equal((await nav.recep.post(`/api/admin/fidelidade/clientes/${ids.cliente}/ajuste`, { pontos: 100, motivo: "x" })).status, 403);
    assert.equal((await nav.admin.post(`/api/admin/fidelidade/clientes/${ids.cliente}/ajuste`, { pontos: -99999, motivo: "x" })).status, 409);
    for (let i = 0; i < 8; i++) ok(await nav.admin.post(`/api/admin/fidelidade/clientes/${ids.cliente}/ajuste`, { pontos: 100000, motivo: "Campanha" }));
    const antes = ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade;
    assert.equal(antes.nivel, "Ouro");
    assert.equal(antes.desconto_ativo.id_recompensa, r.id_recompensa);

    await nav.cliente.post("/api/me/carrinho", { id_produto: criados.produtos[0], quantidade: 2 });
    const ck = ok(await nav.cliente.get("/api/me/checkout"));
    assert.equal(ck.subtotal, "200.00");
    assert.equal(ck.desconto, "50.00");
    const { pedido } = ok(await nav.cliente.post("/api/me/pedidos", { forma_pagamento: "CARTAO", valor_total: 1, desconto: 999 }), 201);
    assert.equal(Number(pedido.valor_total), 150, "valores do navegador são ignorados");
    assert.equal(pedido.pontos_usados, 700001);
    assert.match(pedido.reserva.codigo, /^[A-HJ-NP-Z2-9]{6}$/);
    const meio = ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade;
    assert.equal(meio.pontos, antes.pontos - 700001);
    assert.equal(meio.nivel, "Ouro", "gastar pontos não rebaixa o nível");
    ok(await nav.cliente.post(`/api/me/pedidos/${pedido.id_pedido}/cancelar`, {}));
    assert.equal(ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade.pontos, antes.pontos);

    // opção de não usar o desconto
    await nav.cliente.post("/api/me/carrinho", { id_produto: criados.produtos[0], quantidade: 1 });
    const sem = ok(await nav.cliente.post("/api/me/pedidos", { usar_desconto: false }), 201).pedido;
    assert.equal(Number(sem.valor_total), 100);
    assert.equal(sem.pontos_usados, 0);
    ids.pedido = sem.id_pedido;
    assert.equal((await nav.cliente.post("/api/me/pedidos", { forma_pagamento: "CRIPTO" })).status, 400);
  });

  test("dois pedidos ao mesmo tempo não gastam os mesmos pontos", async () => {
    const saldo = ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade.pontos;
    await nav.cliente.post("/api/me/carrinho", { id_produto: criados.produtos[0], quantidade: 1 });
    const rs = await Promise.all([1, 2].map(() => nav.cliente.post("/api/me/pedidos", {})));
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    const depois = ok(await nav.cliente.get("/api/me/fidelidade")).fidelidade.pontos;
    assert.equal(depois, saldo - 700001);
    ok(await nav.cliente.post(`/api/me/pedidos/${rs.find((r) => r.status === 201).json.pedido.id_pedido}/cancelar`, {}));
  });

  // ───────── Avaliações ─────────
  test("avaliação por critério: só do que foi feito, uma vez, com aprovação", async () => {
    ok(await nav.admin.patch("/api/admin/config", { avaliacao_requer_aprovacao: true }));
    const id = ids.agConcluido;
    const alvos = ok(await nav.cliente.get(`/api/me/agendamentos/${id}/avaliacao`)).alvos;
    assert.deepEqual(alvos.map((a) => a.alvo), ["SALAO", "SERVICO", "PROFISSIONAL"]);
    const envio = (notas, extra = {}) => nav.cliente.post(`/api/me/agendamentos/${id}/avaliacao`, { notas, comentario: `Muito bom ${s}`, ...extra });
    assert.equal((await envio([])).status, 400);
    assert.equal((await envio([{ alvo: "PROFISSIONAL", id: ids.barbeiro2, nota: 5 }])).status, 400, "profissional que não atendeu");
    assert.equal((await envio([{ alvo: "SALAO", nota: 9 }])).status, 400);
    assert.equal((await nav.outro.post(`/api/me/agendamentos/${id}/avaliacao`, { notas: [{ alvo: "SALAO", nota: 5 }] })).status, 404);
    const r = ok(await envio([{ alvo: "SALAO", nota: 5 }, { alvo: "SERVICO", id: criados.servicos[0], nota: 4 }, { alvo: "PROFISSIONAL", id: ids.barbeiro, nota: 3 }]), 201);
    assert.equal(r.avaliacao.nota, 4);
    assert.ok(r.aviso);
    assert.equal((await envio([{ alvo: "SALAO", nota: 1 }])).status, 409);
    const publica = async (q = "") => ok(await nav.visita.get(`/api/avaliacoes?limite=50${q}`)).avaliacoes.find((a) => a.comentario === `Muito bom ${s}`);
    assert.equal(await publica(), undefined);
    ok(await nav.admin.patch(`/api/admin/avaliacoes/${r.avaliacao.id_avaliacao}`, { status_moderacao: "APROVADO" }));
    assert.equal((await publica()).notas.length, 3);
    assert.ok(await publica("&alvo=PROFISSIONAL"));
    assert.ok(await publica("&alvo=MULTI"));
    assert.equal(await publica("&alvo=PRODUTO"), undefined);
    assert.equal(ok(await nav.visita.get(`/api/perfis/${ids.barbeiro}`)).perfil.avaliacao.media, 3);
    assert.equal(ok(await nav.visita.get("/api/avaliacoes/medias")).medias.SERVICO[criados.servicos[0]].media, 4);
    assert.equal((await nav.recep.patch(`/api/admin/avaliacoes/${r.avaliacao.id_avaliacao}`, { status_moderacao: "REJEITADO" })).status, 403);
  });

  test("compra concluída também é avaliada; sem aprovação obrigatória, publica na hora", async () => {
    assert.equal((await nav.cliente.post(`/api/me/pedidos/${ids.pedido}/avaliacao`, { notas: [{ alvo: "PRODUTO", id: criados.produtos[0], nota: 5 }] })).status, 409, "ainda não retirada");
    ok(await nav.recep.patch(`/api/admin/pedidos/${ids.pedido}/status`, { status: "CONCLUIDO" }));
    ok(await nav.admin.patch("/api/admin/config", { avaliacao_requer_aprovacao: false }));
    const r = ok(await nav.cliente.post(`/api/me/pedidos/${ids.pedido}/avaliacao`, { notas: [{ alvo: "PRODUTO", id: criados.produtos[0], nota: 5 }], comentario: `Produto ${s}` }), 201);
    assert.equal(r.avaliacao.status_moderacao, "APROVADO");
    const a = ok(await nav.visita.get("/api/avaliacoes?limite=50&alvo=PRODUTO")).avaliacoes.find((x) => x.comentario === `Produto ${s}`);
    assert.equal(a.tipo, "COMPRA");
    ok(await nav.admin.patch("/api/admin/config", { avaliacao_requer_aprovacao: true }));
  });

  // ───────── Feed ─────────
  let postCliente, postNovo;
  test("cliente atendido publica na hora com foto e vídeo; conta nova espera aprovação", async () => {
    const foto = await enviar(nav.cliente, "POST", ids.cliente, "p1");
    const video = await enviar(nav.cliente, "POST", ids.cliente, "v1", "VIDEO");
    assert.equal((await nav.visita.post("/api/feed", { texto: "x" })).status, 401);
    assert.equal((await nav.cliente.post("/api/feed", { texto: "" })).status, 400);
    assert.equal((await nav.outro.post("/api/feed", { texto: "roubo", midias: [foto.id_midia] })).status, 400, "mídia de outra pessoa");
    const r = ok(await nav.cliente.post("/api/feed", { texto: `<script>alert(1)</script> ${s}`, midias: [foto.id_midia, video.id_midia] }), 201);
    postCliente = r.post.id_post;
    assert.equal(r.post.status, "APROVADO");
    assert.deepEqual(r.post.midias.map((m) => m.tipo), ["IMAGEM", "VIDEO"]);
    assert.equal((await nav.cliente.post("/api/feed", { texto: "de novo", midias: [foto.id_midia] })).status, 400, "mídia já usada");

    const n = await entrar(`nova.${s}`);
    nav.nova = n;
    const p = ok(await n.post("/api/feed", { texto: `Primeira da conta nova ${s}` }), 201);
    postNovo = p.post.id_post;
    assert.equal(p.post.status, "PENDENTE");
    const feed = ok(await nav.visita.get("/api/feed?limite=30")).posts.map((x) => x.id_post);
    assert.ok(feed.includes(postCliente) && !feed.includes(postNovo));
    assert.ok(ok(await n.get("/api/feed?limite=30")).posts.some((x) => x.id_post === postNovo), "o autor vê o próprio pendente");
    assert.equal((await nav.cliente.put(`/api/feed/${postNovo}/curtida`)).status, 404);
    assert.equal((await nav.barbeiro.patch(`/api/admin/posts/${postNovo}`, { status: "APROVADO" })).status, 403);
    ok(await nav.admin.patch(`/api/admin/posts/${postNovo}`, { status: "APROVADO" }));
    assert.equal(ok(await n.post("/api/feed", { texto: `Segunda ${s}` }), 201).post.status, "APROVADO", "depois da primeira aprovada, publica direto");
  });

  test("curtidas não duplicam; comentários e exclusão respeitam o dono", async () => {
    ok(await nav.outro.put(`/api/feed/${postCliente}/curtida`));
    const r = ok(await nav.outro.put(`/api/feed/${postCliente}/curtida`));
    assert.equal(r.curtidas, 1);
    assert.equal(ok(await nav.outro.del(`/api/feed/${postCliente}/curtida`)).curtidas, 0);
    const c = ok(await nav.outro.post(`/api/feed/${postCliente}/comentarios`, { texto: `Ficou ótimo ${s}` }), 201).comentario;
    assert.equal(c.status, "APROVADO");
    assert.equal(c.autor.nome, "Otto S.");
    const lista = ok(await nav.visita.get(`/api/feed/${postCliente}/comentarios`)).comentarios;
    assert.equal(lista.length, 1);
    assert.equal((await nav.nova.del(`/api/feed/comentarios/${c.id_comentario}`)).status, 403);
    assert.equal((await nav.outro.del(`/api/feed/${postCliente}`)).status, 403);
    assert.equal((await nav.visita.post(`/api/feed/${postCliente}/comentarios`, { texto: "x" })).status, 401);
    ids.comentario = c.id_comentario;
  });

  test("denúncia vai para a moderação; decidir encerra as denúncias", async () => {
    assert.equal((await nav.cliente.post(`/api/feed/${postCliente}/denuncia`, { motivo: "x" })).status, 409, "não denuncia o próprio");
    ok(await nav.outro.post(`/api/feed/${postCliente}/denuncia`, { motivo: "Conteúdo impróprio" }), 201);
    ok(await nav.outro.post(`/api/feed/${postCliente}/denuncia`, { motivo: "de novo" }), 201);
    ok(await nav.cliente.post(`/api/feed/comentarios/${ids.comentario}/denuncia`, { motivo: "Ofensa" }), 201);
    const fila = ok(await nav.admin.get("/api/admin/posts?filtro=DENUNCIADO")).posts.find((p) => p.id_post === postCliente);
    assert.equal(fila.denuncias.length, 1);
    assert.ok(ok(await nav.admin.get("/api/admin/comentarios?filtro=DENUNCIADO")).comentarios.some((c) => c.id_comentario === ids.comentario));
    ok(await nav.admin.patch(`/api/admin/comentarios/${ids.comentario}`, { status: "REJEITADO" }));
    assert.equal(ok(await nav.visita.get(`/api/feed/${postCliente}/comentarios`)).comentarios.length, 0);
    ok(await nav.admin.patch(`/api/admin/posts/${postCliente}`, { status: "REJEITADO" }));
    assert.ok(!ok(await nav.visita.get("/api/feed?limite=30")).posts.some((p) => p.id_post === postCliente));
    assert.ok(!ok(await nav.admin.get("/api/admin/posts?filtro=DENUNCIADO")).posts.some((p) => p.id_post === postCliente));
    ok(await nav.admin.patch(`/api/admin/posts/${postCliente}`, { status: "APROVADO" }));
  });

  test("mídia em publicação não é apagada solta; excluir a publicação remove os arquivos", async () => {
    const m = await prisma.postMidia.findFirst({ where: { id_post: postCliente } });
    assert.equal((await nav.cliente.del(`/api/midia/${m.id_midia}`)).status, 409);
    const antes = destruidos.length;
    ok(await nav.cliente.del(`/api/feed/${postCliente}`));
    assert.equal(destruidos.length, antes + 2);
    assert.equal(await prisma.postComentario.count({ where: { id_post: postCliente } }), 0);
  });

  // ───────── Recepção ─────────
  test("permissões da recepção: balcão sim; faturamento, RH e configurações não", async () => {
    const d = ok(await nav.recep.get("/api/admin/dashboard"));
    assert.equal(d.metricas.faturamento_mes, null);
    assert.deepEqual(d.solicitacoes_senha, []);
    assert.equal(d.notificacoes.denuncias, undefined);
    for (const r of ["/agendamentos", "/pedidos", "/clientes", "/reservas", `/clientes/${ids.cliente}`]) ok(await nav.recep.get(`/api/admin${r}`));
    for (const r of ["/recepcionistas", "/logs", "/config", "/produtos", "/fidelidade", "/posts", "/comentarios", "/avaliacoes", "/contatos", `/profissionais/${ids.barbeiro}`]) {
      assert.equal((await nav.recep.get(`/api/admin${r}`)).status, 403, r);
    }
    const eq = ok(await nav.recep.get("/api/admin/equipe")).equipe.find((m) => m.id_usuario === ids.barbeiro);
    assert.equal(eq.email, undefined, "sem dados pessoais da equipe");
    assert.equal((await nav.recep.post("/api/admin/bloqueios", { id_barbeiro: ids.barbeiro, inicio: segunda("17:00").inicio, fim: segunda("17:30").inicio })).status, 403);
    assert.equal((await nav.recep.patch(`/api/admin/clientes/${ids.cliente}/ativo`, { ativo: false })).status, 403);
    const edicao = { nome_completo: "Carla Cliente Silva", telefone: "11988887777" };
    assert.equal((await nav.recep.put(`/api/admin/clientes/${ids.cliente}`, { ...edicao, email: email("invasor") })).status, 403, "não troca o e-mail de quem tem acesso");
    ok(await nav.recep.put(`/api/admin/clientes/${ids.cliente}`, { ...edicao, email: email("cliente") }));
    const ag = ok(await nav.recep.post("/api/admin/agendamentos", { id_cliente: ids.outro, servicos: [criados.servicos[0]], inicio: segunda("16:30").inicio }), 201);
    ok(await nav.recep.post(`/api/admin/agendamentos/${ag.agendamento.id_agendamento}/chegada`));
  });

  test("documentos da recepcionista ficam cifrados; só a ficha do admin mostra, com registro", async () => {
    const dados = { nome_completo: "Bia Balcão", email: email("bia"), vinculo: "CLT", cpf: "390.533.447-05", rg: "12.345.678-9", emergencia: "Mãe 11 90000-0000", data_entrada: "2026-01-05", uf: "sp", cep: "01001-000" };
    assert.equal((await nav.recep.post("/api/admin/recepcionistas", dados)).status, 403);
    assert.equal((await nav.admin.post("/api/admin/recepcionistas", { ...dados, cpf: "111.111.111-11" })).status, 400);
    caixa.length = 0;
    const r = ok(await nav.admin.post("/api/admin/recepcionistas", dados), 201).recepcionista;
    ids.bia = r.id_usuario;
    assert.ok(caixa.some((m) => /criar sua senha/.test(m.texto)));
    assert.ok(r.funcionario.cpf.startsWith("•"), "mascarado na resposta comum");
    const db = await prisma.funcionario.findUnique({ where: { id_usuario: ids.bia } });
    assert.ok(db.cpf_cifrado.startsWith("v1:"));
    assert.equal(JSON.stringify(db).includes("39053344705"), false);
    assert.equal(decifrar(db.cpf_cifrado), "39053344705");
    assert.equal(db.uf, "SP");
    const ficha = ok(await nav.admin.get(`/api/admin/recepcionistas/${ids.bia}`)).recepcionista;
    assert.equal(ficha.funcionario.rg, "12.345.678-9");
    assert.equal(ficha.senha_hash, undefined);
    assert.equal(await prisma.logAuditoria.count({ where: { acao: "recepcionista.consulta_ficha", id_entidade: ids.bia } }), 1);
    // adulteração é detectada
    const [v, iv, tag, d] = db.cpf_cifrado.split(":");
    assert.throws(() => decifrar([v, iv, tag, `${d.slice(0, -2)}AA`].join(":")));
  });

  test("ponto alterna entrada e saída no horário do servidor; desligamento encerra o acesso", async () => {
    const rec = nav.recep;
    assert.equal((await rec.post("/api/admin/meu-ponto", { tipo: "SAIDA" })).status, 409);
    const p = ok(await rec.post("/api/admin/meu-ponto", { tipo: "ENTRADA", em: "2000-01-01T00:00:00Z" }), 201).ponto;
    assert.ok(Math.abs(new Date(p.em) - Date.now()) < 60000, "hora do servidor");
    assert.equal((await rec.post("/api/admin/meu-ponto", { tipo: "ENTRADA" })).status, 409);
    ok(await nav.admin.post(`/api/admin/recepcionistas/${ids.recep}/ponto`, { tipo: "SAIDA" }), 201);
    assert.equal((await nav.barbeiro.post("/api/admin/meu-ponto", { tipo: "ENTRADA" })).status, 403);
    ok(await nav.admin.post(`/api/admin/recepcionistas/${ids.recep}/desligamento`, { data_saida: "2026-11-30", motivo: "Fim do contrato" }));
    assert.equal((await rec.get("/api/admin/dashboard")).status, 401, "sessão cai na hora");
    assert.equal((await new Navegador(base).post("/api/auth/login", { email: email("recep"), senha: SENHA })).status, 403);
  });

  // ───────── Contatos e auditoria ─────────
  test("contatos oficiais: só links seguros e só os públicos aparecem no site", async () => {
    assert.equal((await nav.admin.post("/api/admin/contatos", { tipo: "custom", rotulo: "X", valor: "x", url: "javascript:alert(1)" })).status, 400);
    for (const publico of [true, false]) {
      const c = ok(await nav.admin.post("/api/admin/contatos", { tipo: "telegram", rotulo: `T${s}`, valor: "t.me/salao", url: `https://t.me/salao${publico}`, publico }), 201).contato;
      criados.contatos.push(c.id_contato);
    }
    const pub = ok(await nav.visita.get("/api/config")).config.contatos.filter((c) => c.rotulo === `T${s}`);
    assert.equal(pub.length, 1);
  });

  test("auditoria registra quem fez o quê, sem dados sensíveis, e só o admin lê", async () => {
    await new Navegador(base).post("/api/auth/login", { email: email("cliente"), senha: "Errada999" });
    const r = ok(await nav.admin.get(`/api/admin/logs?busca=${encodeURIComponent("Admin Completo")}&limite=100`));
    const acoes = new Set(r.logs.map((l) => l.acao));
    for (const a of ["recepcionista.criacao", "fidelidade.ajuste", "post.moderacao", "servico.criacao"]) assert.ok(acoes.has(a), a);
    const todos = await prisma.logAuditoria.findMany({ where: { OR: [{ id_autor: { in: Object.values(ids) } }, { acao: "login.falha" }] }, take: 500 });
    const texto = JSON.stringify(todos);
    for (const proibido of [SENHA, "Errada999", "39053344705", "12.345.678-9"]) assert.equal(texto.includes(proibido), false, proibido);
    for (const k of ["cliente", "barbeiro"]) assert.equal((await nav[k].get("/api/admin/logs")).status, 403);
    for (const m of ["post", "put", "patch", "del"]) assert.equal((await nav.admin[m]("/api/admin/logs")).status, 404);
  });

  test("configuração valida níveis e expõe só o que é público", async () => {
    assert.equal((await nav.admin.patch("/api/admin/config", { nivel_prata: 900, nivel_ouro: 500 })).status, 400);
    ok(await nav.admin.patch("/api/admin/config", { slogan: "Slogan teste", entrega_ativa: false, aviso_entrega_off: "Só retirada" }));
    const c = ok(await nav.visita.get("/api/config")).config;
    assert.equal(c.slogan, "Slogan teste");
    assert.equal(c.aviso_entrega, "Só retirada");
    assert.equal(c.pontos_por_real, undefined);
  });
});
