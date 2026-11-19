# Studio Corte — Sistema de barbearia

Site institucional + agendamento online + loja + painel administrativo.
Stack: **Node.js (Express 5) · Prisma 6 · PostgreSQL (Neon)** · HTML/CSS/JS no frontend (servido pelo próprio Express).

## Tema visual
- Fundo `#09090d` · Cards `#16161f` · Destaque `#ef4444` · Tipografia Inter · Dark mode, responsivo

## Como rodar

```bash
npm ci                 # instala as dependências (gera o Prisma Client)
cp .env.example .env   # preencha DATABASE_URL, DIRECT_URL e SESSION_SECRET
npm run db:status      # confere se o banco está com todas as migrations
npm run dev            # http://localhost:3000
```

Primeira instalação em banco vazio: `npm run db:deploy` (aplica as migrations) e `npm run db:seed`
(cria o administrador definido em `SEED_ADMIN_*`, a configuração do salão, serviços, produtos e galeria).
O seed é idempotente e nunca apaga nem sobrescreve dados.

### Testes (branch de teste do Neon)

Os testes que gravam dados **só rodam** com `TEST_DATABASE_URL`/`TEST_DIRECT_URL` apontando para uma
branch separada do Neon — e se recusam a rodar se forem iguais às URLs do banco principal.

```bash
npm test                 # 50 testes: autenticação, agenda, loja, perfil, painel, permissões, uploads
npm run test:db:prepare  # aplica migrations + seed na branch de teste
npm run dev:teste        # servidor na porta 3001 usando a branch de teste (.env + .env.teste)
```

## Perfis de acesso

| Perfil | O que acessa |
|---|---|
| Visitante | Home (serviços, galeria, produtos, avaliações, mapa), consulta de horários livres, cadastro e login |
| **CLIENTE** | Agendar, cancelar (até X h antes) e avaliar atendimentos; favoritos e imagens de referência; carrinho e pedidos; perfil completo (foto, capa, bio, redes, senha) |
| **BARBEIRO** | Painel → Atendimentos: só a própria agenda (confirmar, concluir, falta, remarcar, bloquear horários) |
| **ADMIN** | Painel completo: dashboard, serviços, clientes, produtos, pedidos, atendimentos, equipe, configurações e editor de conteúdo |

A permissão é sempre conferida no servidor; o frontend só esconde o que o perfil não pode usar.

## Estrutura

```
public/                 frontend (sem scripts inline — CSP estrita)
  index.html            home: conteúdo do banco + agendamento com horários reais
  catalogo.html         serviços, cortes e produtos com filtros e busca
  avaliacoes.html       todas as avaliações: média, distribuição, filtro por nota
  perfil.html           área do cliente
  login / cadastro / recuperar-senha / redefinir-senha
  admin/                index (dashboard), servicos, clientes, produtos, pedidos,
                        agendamentos, equipe, configuracoes, conteudo
  js/api.js, ui.js, sessao.js, validacao.js
  js/vitrine.js         cabeçalho, rodapé e balão comuns às páginas públicas
  js/carrinho.js        carrinho em gaveta (sobre /api/me/carrinho)
  js/contatos.js        contatos oficiais (balão e rodapé) e links do mapa
  js/pages/*.js         scripts das páginas públicas
  js/admin/*.js         scripts do painel
src/
  routes/               auth, publico, conta (/api/me), admin, imagens
  services/             authService, agendaService, lojaService, configService
  validators/           zod (comum, auth, dominio)
  lib/                  prisma, sessão (JWT), tempo (fuso do salão), e-mail, erros
prisma/
  schema.prisma, migrations/ (SQL versionado, inclui CHECK e EXCLUDE), seed.js
tests/                  node:test
docs/ARQUITETURA.md     decisões técnicas (concorrência, estoque, segurança)
```
