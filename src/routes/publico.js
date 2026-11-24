// Rotas públicas (sem login): conteúdo da home e consulta de horários livres.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { validar } from "../middlewares/validate.js";
import { obterConfig, configPublica } from "../services/configService.js";
import { horariosDisponiveis } from "../services/agendaService.js";
import { listarPublicas, mediasPorAlvo } from "../services/avaliacaoService.js";
import { filtroProfissionalVisivel, mediaDoProfissional, perfilPublico } from "../services/perfilService.js";
import { horariosQuery } from "../validators/dominio.js";
import { area, idParam, opcionalQuery } from "../validators/comum.js";
import { z } from "zod";

const router = Router();

// Filtro por área: "AMBOS" aparece tanto em barbearia quanto em cabeleireiro.
const catalogoQuery = z.object({ area: opcionalQuery(area) });
const filtroArea = (a) => (!a || a === "AMBOS" ? {} : { area: { in: [a, "AMBOS"] } });

async function favoritosIds(usuario, tabela, coluna) {
  if (!usuario) return new Set();
  const linhas = await prisma[tabela].findMany({ where: { id_cliente: usuario.id_usuario }, select: { [coluna]: true } });
  return new Set(linhas.map((l) => l[coluna]));
}

router.get("/config", async (_req, res) => {
  const [config, contatos] = await Promise.all([
    obterConfig(),
    prisma.contatoOficial.findMany({
      where: { publico: true },
      orderBy: [{ ordem: "asc" }, { id_contato: "asc" }],
      select: { tipo: true, rotulo: true, valor: true, url: true },
    }),
  ]);
  res.json({ config: { ...configPublica(config), contatos } });
});

router.get("/servicos", validar({ query: catalogoQuery }), async (req, res) => {
  const favoritos = await favoritosIds(req.usuario, "favoritoServico", "id_servico");
  const servicos = await prisma.servico.findMany({
    where: { ativo: true, ...filtroArea(req.valid.query.area) },
    orderBy: [{ ordem_exibicao: "asc" }, { nome_servico: "asc" }],
    select: {
      id_servico: true,
      nome_servico: true,
      descricao: true,
      icone: true,
      preco: true,
      preco_a_partir_de: true,
      duracao_minutos: true,
      area: true,
      imagem_url: true,
    },
  });
  res.json({ servicos: servicos.map((s) => ({ ...s, favorito: favoritos.has(s.id_servico) })) });
});

router.get("/produtos", async (req, res) => {
  const favoritos = await favoritosIds(req.usuario, "favoritoProduto", "id_produto");
  const produtos = await prisma.produto.findMany({
    where: { ativo: true },
    orderBy: [{ categoria: "asc" }, { nome_produto: "asc" }],
    select: {
      id_produto: true,
      nome_produto: true,
      descricao: true,
      categoria: true,
      preco: true,
      imagem_url: true,
      quantidade_estoque: true,
    },
  });
  res.json({ produtos: produtos.map((p) => ({ ...p, favorito: favoritos.has(p.id_produto) })) });
});

router.get("/galeria", validar({ query: catalogoQuery }), async (req, res) => {
  const favoritos = await favoritosIds(req.usuario, "favorito", "id_corte");
  const cortes = await prisma.corteGaleria.findMany({
    where: { ativo: true, ...filtroArea(req.valid.query.area) },
    orderBy: [{ ordem_exibicao: "asc" }, { id_corte: "asc" }],
    select: {
      id_corte: true,
      nome_corte: true,
      descricao: true,
      area: true,
      duracao_ref_minutos: true,
      preco_ref: true,
      imagem_url: true,
      modelo_3d_url: true,
      autor: { select: { id_usuario: true, nome_completo: true, ativo: true } },
    },
  });
  res.json({
    cortes: cortes.map(({ autor, ...c }) => ({
      ...c,
      autor: autor?.ativo ? { id_usuario: autor.id_usuario, nome: autor.nome_completo } : null,
      favorito: favoritos.has(c.id_corte),
    })),
  });
});

// Avaliações aprovadas: nome abreviado e avatar do cliente, nota geral e por critério (sem e-mail/telefone).
// Paginação (?pagina), nota (?nota=5 ou ?nota=3 para "3 ou menos") e critério (?alvo=SERVICO | MULTI).
const avaliacoesQuery = z.object({
  limite: z.coerce.number().int().min(1).max(50).default(3),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
  nota: opcionalQuery(z.coerce.number().int().min(1).max(5)),
  alvo: opcionalQuery(z.enum(["SALAO", "SERVICO", "CORTE", "PRODUTO", "PROFISSIONAL", "MULTI"])),
});
router.get("/avaliacoes", validar({ query: avaliacoesQuery }), async (req, res) => {
  res.json(await listarPublicas(req.valid.query));
});

router.get("/avaliacoes/medias", async (_req, res) => {
  res.json({ medias: await mediasPorAlvo() });
});

router.get("/perfis/:id", validar({ params: idParam }), async (req, res) => {
  res.json({ perfil: await perfilPublico(req.valid.params.id, req.usuario) });
});

// Profissionais que atendem. Filtra pelos serviços (todos eles), se informados.
const profissionaisQuery = z.object({
  servico: opcionalQuery(z.coerce.number().int().positive()),
  servicos: opcionalQuery(z.string().regex(/^\d+(,\d+)*$/, "Serviços inválidos.").transform((s) => s.split(",").map(Number))),
  area: opcionalQuery(area),
});
router.get("/profissionais", validar({ query: profissionaisQuery }), async (req, res) => {
  const { servico, servicos, area: filtro } = req.valid.query;
  const ids = servicos ?? (servico ? [servico] : []);
  const profissionais = await prisma.usuario.findMany({
    where: {
      AND: [
        filtroProfissionalVisivel,
        ...ids.map((id_servico) => ({ servicos_oferecidos: { some: { id_servico } } })),
        ...(filtro && filtro !== "AMBOS" ? [{ OR: [{ perfil_profissional: { area: { in: [filtro, "AMBOS"] } } }, ...(filtro === "BARBEARIA" ? [{ perfil_profissional: { is: null } }] : [])] }] : []),
      ],
    },
    orderBy: { nome_completo: "asc" },
    select: {
      id_usuario: true,
      nome_completo: true,
      avatar_url: true,
      bio: true,
      perfil_profissional: { select: { area: true, especialidades: true, anos_experiencia: true } },
    },
  });
  const medias = await Promise.all(profissionais.map((p) => mediaDoProfissional(p.id_usuario)));
  res.json({
    profissionais: profissionais.map(({ perfil_profissional: pp, ...p }, i) => ({
      ...p,
      area: pp?.area ?? "BARBEARIA",
      especialidades: pp?.especialidades ?? [],
      anos_experiencia: pp?.anos_experiencia ?? null,
      avaliacao: medias[i],
    })),
  });
});

router.get("/agenda/horarios", validar({ query: horariosQuery }), async (req, res) => {
  const { servicos, data, profissional, ignorar, pessoas } = req.valid.query;
  const porEquipe = ["ADMIN", "BARBEIRO", "RECEPCIONISTA"].includes(req.usuario?.tipo_perfil);
  res.json(
    await horariosDisponiveis({
      servicos,
      data,
      pessoas,
      id_barbeiro: profissional ?? null,
      porEquipe,
      ignorarId: porEquipe ? ignorar ?? null : null,
    })
  );
});

export default router;
