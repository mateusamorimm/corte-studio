// Seed inicial do Studio Corte.
// - Idempotente: pode ser executado mais de uma vez sem duplicar nada.
// - Não sobrescreve dados existentes (só cria o que falta) e nunca apaga registros.
// - Não cria clientes, barbeiros, agendamentos ou avaliações fictícias.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CONFIG = {
  nome_salao: "Studio Corte",
  endereco: "Rua das Tesouras, 123 — Centro, São Paulo/SP",
  telefone: "(11) 99999-0000",
  whatsapp: "5511999990000",
  horario_funcionamento_texto: "Seg–Sáb 09h–20h | Dom 10h–16h",
  hero_titulo: "Seu próximo corte, pensado antes de sentar na cadeira.",
  hero_subtitulo:
    "Veja os serviços, escolha o estilo na galeria, confira onde estamos e marque seu horário com o profissional que preferir.",
};

const SERVICOS = [
  { nome_servico: "Corte Masculino", icone: "✂️", descricao: "Corte clássico ou moderno + finalização. Inclui orientação de manutenção.", preco: "65.00", duracao_minutos: 40 },
  { nome_servico: "Fade / Degradê", icone: "🔥", descricao: "Degradê técnico limpo, com ou sem desenho. Resultado preciso.", preco: "75.00", duracao_minutos: 45 },
  { nome_servico: "Barba + Contorno", icone: "🧔", descricao: "Modelagem completa, alinhamento e toalha quente opcional.", preco: "45.00", duracao_minutos: 30 },
  { nome_servico: "Corte Feminino", icone: "💇", descricao: "Corte, texturização e finalização. Ideal para mudança de visual.", preco: "90.00", duracao_minutos: 60 },
  { nome_servico: "Coloração / Luzes", icone: "🎨", descricao: "Diagnóstico do fio + técnicas modernas. Valor final conforme comprimento.", preco: "180.00", preco_a_partir_de: true, duracao_minutos: 120 },
  { nome_servico: "Corte Infantil", icone: "🧒", descricao: "Ambiente calmo e paciência. A partir de 3 anos.", preco: "50.00", duracao_minutos: 30 },
];

const IMG = (id, w, h) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop`;

const PRODUTOS = [
  { nome_produto: "Pomada Modeladora", categoria: "Finalização", descricao: "Fixação média e efeito matte para o dia todo.", preco: "45.00", quantidade_estoque: 24, imagem_url: null },
  { nome_produto: "Shampoo Anticaspa", categoria: "Cabelo", descricao: "Limpeza profunda com controle da oleosidade.", preco: "35.00", quantidade_estoque: 18, imagem_url: IMG("1556228578-0d85b1a4d571", 400, 400) },
  { nome_produto: "Óleo para Barba", categoria: "Barba", descricao: "Hidrata os fios e a pele, com fragrância amadeirada.", preco: "35.00", quantidade_estoque: 12, imagem_url: IMG("1585751119414-ef2636f8aede", 400, 400) },
  { nome_produto: "Kit Pente + Escova", categoria: "Acessórios", descricao: "Pente de corte e escova para barba e cabelo.", preco: "55.00", quantidade_estoque: 9, imagem_url: IMG("1621605815971-fbc98d665033", 400, 400) },
];

const CORTES = [
  { nome_corte: "Fade médio", imagem_url: IMG("1622286342621-4bd786c2447c", 600, 450) },
  { nome_corte: "Undercut na navalha", imagem_url: IMG("1599351431202-1e0f0137899a", 600, 450) },
  { nome_corte: "Barba alinhada", imagem_url: IMG("1517832606299-7ae9b720a186", 600, 450) },
  { nome_corte: "Cacheado texturizado", imagem_url: IMG("1519699047748-de8e457a634e", 600, 450) },
  { nome_corte: "Corte social + finalização", imagem_url: IMG("1605497788044-5a32c7078486", 600, 450) },
  { nome_corte: "Lavagem e hidratação", imagem_url: IMG("1595476108010-b4d1f102b1b1", 600, 450) },
];

function lerAdmin() {
  const nome = process.env.SEED_ADMIN_NOME?.trim();
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const senha = process.env.SEED_ADMIN_SENHA ?? "";
  const erros = [];
  if (!nome || nome.length < 3) erros.push("SEED_ADMIN_NOME deve ter pelo menos 3 caracteres");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push("SEED_ADMIN_EMAIL inválido");
  if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    erros.push("SEED_ADMIN_SENHA deve ter no mínimo 8 caracteres, com letras e números");
  }
  return { nome, email, senha, erros };
}

async function main() {
  const resumo = [];

  // Administrador
  const admin = lerAdmin();
  const existente = admin.email ? await prisma.usuario.findUnique({ where: { email: admin.email } }) : null;
  if (existente) {
    resumo.push(`Administrador: já existe (id ${existente.id_usuario}) — mantido sem alterações`);
  } else if (admin.erros.length) {
    console.error("✖ Administrador não criado:\n  - " + admin.erros.join("\n  - "));
    process.exitCode = 1;
    return;
  } else {
    const criado = await prisma.usuario.create({
      data: {
        nome_completo: admin.nome,
        email: admin.email,
        senha_hash: await bcrypt.hash(admin.senha, 12),
        tipo_perfil: "ADMIN",
      },
    });
    resumo.push(`Administrador: criado (id ${criado.id_usuario})`);
  }

  // Configuração do salão (linha única)
  const config = await prisma.configuracaoSalao.findUnique({ where: { id: 1 } });
  if (!config) {
    await prisma.configuracaoSalao.create({ data: { id: 1, ...CONFIG } });
    resumo.push("Configuração do salão: criada");
  } else {
    resumo.push("Configuração do salão: já existe — mantida");
  }

  // Serviços
  let novos = 0;
  for (const [i, s] of SERVICOS.entries()) {
    const r = await prisma.servico.findUnique({ where: { nome_servico: s.nome_servico } });
    if (!r) {
      await prisma.servico.create({ data: { ...s, ordem_exibicao: i + 1 } });
      novos++;
    }
  }
  resumo.push(`Serviços: ${novos} criados, ${SERVICOS.length - novos} já existiam`);

  // Produtos
  novos = 0;
  for (const p of PRODUTOS) {
    const r = await prisma.produto.findFirst({ where: { nome_produto: p.nome_produto } });
    if (!r) {
      await prisma.produto.create({ data: p });
      novos++;
    }
  }
  resumo.push(`Produtos: ${novos} criados, ${PRODUTOS.length - novos} já existiam`);

  // Galeria
  novos = 0;
  for (const [i, c] of CORTES.entries()) {
    const r = await prisma.corteGaleria.findFirst({ where: { nome_corte: c.nome_corte } });
    if (!r) {
      await prisma.corteGaleria.create({ data: { ...c, ordem_exibicao: i + 1 } });
      novos++;
    }
  }
  resumo.push(`Galeria: ${novos} criados, ${CORTES.length - novos} já existiam`);

  console.log("✔ Seed concluído:\n  - " + resumo.join("\n  - "));
}

main()
  .catch((e) => {
    console.error("✖ Erro no seed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
