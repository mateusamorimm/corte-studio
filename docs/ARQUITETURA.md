# Studio Corte — Arquitetura e decisões técnicas

Stack: Node.js + Express 5 · Prisma 6 · PostgreSQL (Neon) · HTML/CSS/JS no frontend (servido pelo próprio Express, mesma origem).

## Estrutura

```
public/            frontend (HTML/CSS/JS)
src/
  app.js           Express: helmet/CSP, cookies, sessão, CSRF, /api, estáticos
  server.js        inicialização
  config/env.js    validação das variáveis de ambiente
  lib/             prisma, sessão (JWT), erros
  middlewares/     auth, csrf, validate (zod), errorHandler
  routes/          rotas da API
prisma/
  schema.prisma    15 modelos, 3 enums
  migrations/      SQL versionado (inclui CHECK e EXCLUDE)
tests/             node:test
```

## Concorrência na agenda

1. **Lock por barbeiro**: toda escrita que afeta a agenda de um barbeiro (criar/remarcar/reativar agendamento, criar/alterar bloqueio, alterar disponibilidade) roda numa transação que começa com `pg_advisory_xact_lock(1001, id_barbeiro)`. Operações simultâneas para o mesmo barbeiro são serializadas; para barbeiros diferentes seguem em paralelo. O lock é liberado no fim da transação.
2. **Revalidação dentro da transação**: depois do lock, o servidor confere disponibilidade, bloqueios e agendamentos existentes antes de gravar.
3. **Restrições no banco** (última barreira, mesmo contra código com bug):
   - `agendamento_sem_conflito` — `EXCLUDE USING gist` impede dois agendamentos ativos (PENDENTE, CONFIRMADO, CONCLUIDO) sobrepostos do mesmo barbeiro.
   - `bloqueio_sem_sobreposicao` — bloqueios do mesmo barbeiro não se sobrepõem.
   - Violação (`23P01`) vira HTTP 409 "Conflito de horário".
4. Um bloqueio que colida com agendamentos ativos é recusado com a lista dos conflitos (o admin decide cancelar/remarcar antes).

## Estoque e pedidos

- **Finalizar**: uma transação lê o carrinho, e para cada item executa
  `UPDATE produto SET quantidade_estoque = quantidade_estoque - q WHERE id_produto = ? AND ativo AND quantidade_estoque >= q`.
  Se alguma linha não for afetada, a transação inteira é desfeita e o cliente recebe qual item faltou. O `CHECK (quantidade_estoque >= 0)` garante que nunca fique negativo. Preços vêm do banco no momento (o carrinho não guarda preço). Pedido, itens e limpeza do carrinho são gravados na mesma transação.
- **Cancelar**: `UPDATE pedido SET status='CANCELADO', cancelado_em=now() WHERE id_pedido=? AND status IN ('PENDENTE','PRONTO_PARA_RETIRADA')`. Só se essa linha for afetada o estoque é devolvido, na mesma transação. Um segundo cancelamento (ou duplo clique) não afeta linha nenhuma e não devolve nada. Pedidos CONCLUIDO não podem ser cancelados.

## Autenticação e CSRF

- Senhas com bcrypt (custo 12). Sessão em JWT dentro de cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção.
- A cada requisição o usuário é relido do banco: desativar/rebaixar vale na hora. Trocar a senha invalida as sessões antigas (`sv` no token).
- CSRF em três camadas: SameSite, verificação de `Origin`/`Referer`, e token *signed double-submit* (cookie `sc_csrf` + cabeçalho `X-CSRF-Token`, assinado com HMAC e vinculado à sessão). Exigido em todo POST/PUT/PATCH/DELETE, inclusive login e cadastro.
- Recuperação de senha: token aleatório de uso único, validade 1h, apenas o SHA-256 fica no banco.

## XSS

- CSP sem scripts inline (`script-src 'self'`, `script-src-attr 'none'`).
- Todo conteúdo vindo do banco é inserido via `textContent` ou escapado com `escapeHtml`.

## Banco de dados

- Nenhuma operação destrutiva automática: migrations versionadas aplicadas com `prisma migrate deploy`; nada de `migrate reset` ou `db push --force-reset`.
- Remoções de usuários, serviços, produtos e cortes são lógicas (`ativo = false`) para preservar histórico.
