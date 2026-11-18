// Rotas públicas (sem login): conteúdo da home e consulta de horários livres.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { validar } from "../middlewares/validate.js";
import { obterConfig, configPublica } from "../services/configService.js";
import { horariosDisponiveis } from "../services/agendaService.js";
import { horariosQuery } from "../validators/dominio.js";
import { z } from "zod";

const router = Router();

// "Carlos Alberto Silva" → "Carlos S." (privacidade nas avaliações públicas)
function nomePublico(nomeCompleto) {
  const partes = nomeCompleto.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0];
}

router.get("/config", async (_req, res) => {
  res.json({ config: configPublica(await obterConfig()) });
});

router.get("/servicos", async (_req, res) => {
  const servicos = await prisma.servico.findMany({
    where: { ativo: true },
    orderBy: [{ ordem_exibicao: "asc" }, { nome_servico: "asc" }],
    select: {
      id_servico: true,
      nome_servico: true,
      descricao: true,
      icone: true,
      preco: true,
      preco_a_partir_de: true,
      duracao_minutos: true,
      imagem_url: true,
    },
  });
  res.json({ servicos });
});

router.get("/produtos", async (_req, res) => {
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
  res.json({ produtos });
});

router.get("/galeria", async (req, res) => {
  const cortes = await prisma.corteGaleria.findMany({
    where: { ativo: true },
    orderBy: [{ ordem_exibicao: "asc" }, { id_corte: "asc" }],
    select: { id_corte: true, nome_corte: true, imagem_url: true },
  });
  // Marca os favoritos do cliente logado (para o coração na galeria)
  let favoritos = [];
  if (req.usuario) {
    favoritos = (
      await prisma.favorito.findMany({ where: { id_cliente: req.usuario.id_usuario }, select: { id_corte: true } })
    ).map((f) => f.id_corte);
  }
  res.json({ cortes: cortes.map((c) => ({ ...c, favorito: favoritos.includes(c.id_corte) })) });
});

// Avaliações visíveis: nome e avatar do cliente, serviço e nota (sem e-mail/telefone).
router.get("/avaliacoes", validar({ query: z.object({ limite: z.coerce.number().int().min(1).max(50).default(3) }) }), async (req, res) => {
  const where = { visivel: true };
  const [avaliacoes, resumo] = await Promise.all([
    prisma.avaliacao.findMany({
      where,
      orderBy: { data_avaliacao: "desc" },
      take: req.valid.query.limite,
      select: {
        id_avaliacao: true,
        nota: true,
        comentario: true,
        data_avaliacao: true,
        agendamento: {
          select: {
            servico: { select: { nome_servico: true } },
            barbeiro: { select: { nome_completo: true } },
            cliente: { select: { nome_completo: true, avatar_url: true } },
          },
        },
      },
    }),
    prisma.avaliacao.aggregate({ where, _avg: { nota: true }, _count: true }),
  ]);
  res.json({
    avaliacoes: avaliacoes.map((a) => ({
      id_avaliacao: a.id_avaliacao,
      nota: a.nota,
      comentario: a.comentario,
      data_avaliacao: a.data_avaliacao,
      servico: a.agendamento.servico.nome_servico,
      profissional: a.agendamento.barbeiro.nome_completo,
      cliente: nomePublico(a.agendamento.cliente.nome_completo),
      avatar_url: a.agendamento.cliente.avatar_url,
    })),
    total: resumo._count,
    media: resumo._avg.nota,
  });
});

// Profissionais que atendem (para o agendamento). Filtra por serviço, se informado.
router.get("/profissionais", validar({ query: z.object({ servico: z.coerce.number().int().positive().optional() }) }), async (req, res) => {
  const { servico } = req.valid.query;
  const profissionais = await prisma.usuario.findMany({
    where: {
      ativo: true,
      tipo_perfil: { in: ["BARBEIRO", "ADMIN"] },
      servicos_oferecidos: servico ? { some: { id_servico: servico } } : { some: {} },
    },
    orderBy: { nome_completo: "asc" },
    select: { id_usuario: true, nome_completo: true, avatar_url: true },
  });
  res.json({ profissionais });
});

router.get("/agenda/horarios", validar({ query: horariosQuery }), async (req, res) => {
  const { servico, data, profissional, ignorar } = req.valid.query;
  const porEquipe = ["ADMIN", "BARBEIRO"].includes(req.usuario?.tipo_perfil);
  res.json(
    await horariosDisponiveis({
      id_servico: servico,
      data,
      id_barbeiro: profissional ?? null,
      porEquipe,
      ignorarId: porEquipe ? ignorar ?? null : null,
    })
  );
});

export default router;
