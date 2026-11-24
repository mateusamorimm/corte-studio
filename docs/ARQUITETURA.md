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

## Agenda (horários livres)

- Expediente semanal por profissional (`disponibilidade_barbeiro`, horário local do salão) e serviços que cada um realiza (`barbeiro_servico`), cadastrados em **Painel → Equipe**.
- `GET /api/agenda/horarios?servico&data[&profissional]`: gera os horários a cada `intervalo_slots_minutos` dentro do expediente, cabendo a duração do serviço, sem bloqueios nem agendamentos ativos sobrepostos, respeitando `antecedencia_minima_minutos` e `janela_agendamento_dias` (a equipe ignora essas duas).
- Fuso: instantes em UTC (`TIMESTAMPTZ`), conversão pelo `fuso_horario` da configuração (`src/lib/tempo.js`).
- Cliente: até 5 agendamentos futuros; cancela online até `antecedencia_cancelamento_hrs` antes; avalia só atendimentos `CONCLUIDO`, uma vez.
- Transições de status pela equipe são validadas (ex.: concluir/falta só depois do horário; reativar um cancelado revalida conflitos sob o lock).

## Imagens

- `POST /api/imagens` (logado): corpo binário, até 3 MB; o tipo é detectado pela assinatura do arquivo (JPEG/PNG/WebP). SVG, GIF e HTML são recusados.
- Guardadas na tabela `imagem` (Neon) e servidas em `GET /api/imagens/:uuid` com `nosniff`, `CSP: default-src 'none'; sandbox` e cache imutável.
- Campos de imagem aceitam esse caminho local ou uma URL `http(s)` externa; `javascript:`/`data:` são recusados no servidor e ignorados no cliente.

## Clientes de balcão

- O admin pode cadastrar cliente sem e-mail (atendimento por telefone/presencial); a migration `20261118000000_perfil_imagens` tornou `usuario.email` opcional **somente** para `CLIENTE` (CHECK `usuario_email_obrigatorio_equipe`).
- Com e-mail, o admin pode enviar o link para o cliente criar a senha (mesmo fluxo de token de uso único da redefinição).

## Implantação de mudanças no banco

1. Testar na branch de teste: `npm run test:db:prepare` e `npm test`.
2. Conferir o banco principal: `npm run db:status`.
3. Aplicar: `npm run db:deploy` (só migrations versionadas; nunca `migrate reset`/`db push`).

## Mídia no Cloudinary

- Fluxo: `POST /api/midia/assinatura` (logado, com limite de envios) → o navegador envia **direto** ao Cloudinary com a assinatura → `POST /api/midia/confirmar` → o servidor consulta o arquivo na Admin API, confere pasta do usuário, formato e tamanho, e registra na tabela `midia`. Arquivo fora das regras é apagado do Cloudinary.
- O `CLOUDINARY_API_SECRET` nunca sai do servidor. A assinatura cobre pasta (`<CLOUDINARY_PASTA>/<finalidade>/u<id>`), formatos permitidos e tags.
- Finalidades e permissões em `src/services/midiaService.js` (ex.: AVATAR/CAPA/REFERENCIA/POST para qualquer conta; PRODUTO/GALERIA/SALAO/EQUIPE/CORTE_3D só ADMIN). Limites: imagem 10 MB, vídeo 60 MB, modelo 3D (.glb) 10 MB.
- Foto, banner e imagens de referência do cliente só aceitam mídia enviada por ele (impede apontar para URLs externas).
- CSP: `connect-src` libera `api.cloudinary.com` e `res.cloudinary.com`; `media-src` libera `res.cloudinary.com`.
- Imagens antigas (tabela `imagem`) → `scripts/migrar-imagens-cloudinary.mjs` (simula por padrão; `--executar` envia e troca as referências, sem apagar a tabela antiga).
- Ordem de implantação: migration `20261119000000_midia_cloudinary` → variáveis `CLOUDINARY_*` no Render → deploy do código → migração das imagens.

## Reservas e visitantes
- Todo agendamento feito pelo site ou pela equipe e todo pedido recebe uma `reserva` com código de 6 caracteres (sem I, O, 0, 1).
- Visitante informa só nome, telefone e e-mail (com aceite registrado). É criado um `usuario` provisório (`visitante = true`, sem
  e-mail de login e sem senha). O e-mail digitado fica na reserva e nunca vira login sozinho.
- A consulta pública exige código **e** telefone (por POST, para o telefone não ir para endereços e logs). Limites: 10 reservas/h por IP e
  3 abertas por telefone (trava `pg_advisory_xact_lock(1004, hashtext(telefone))`).
- No balcão, "Concluir + cadastrar" transforma o provisório em cliente (convite por e-mail) ou transfere o histórico para uma conta existente.
- Horário + produtos da mesma reserva entram na mesma transação: ou tudo é gravado, ou nada.
- `rotinaService`: falta automática (visitante sem check-in após a tolerância) e pedido com prazo vencido (devolve estoque e pontos).
  É disparada pelo tráfego da API, no máximo uma vez por minuto, para não manter o Neon acordado; trava `1003`.

## Vários serviços e pessoas
- `agendamento_servico` guarda a lista; `agendamento.id_servico` continua sendo o serviço principal (compatível com dados antigos).
- Várias pessoas = atendimentos irmãos na mesma reserva: com profissional escolhido, em sequência; sem escolha, ao mesmo tempo com
  profissionais diferentes. As travas `1001` são obtidas em ordem crescente.

## Fidelidade
- `movimento_pontos` é só de inclusão; saldo = soma. O crédito acontece na mesma transação do UPDATE condicional que conclui o
  atendimento/pedido (uma vez por conclusão; desfazer estorna). Nível usa os pontos acumulados (gastar não rebaixa).
- Resgate: trava `1002` por cliente, melhor recompensa ativa, desconto calculado no servidor; cancelar devolve os pontos.

## Feed, avaliações e moderação
- Publica na hora: equipe, clientes com algo concluído ou já aprovados antes. Conta nova fica pendente. Decidir encerra as denúncias.
- Mídia de publicação precisa ter sido enviada pelo autor (finalidade POST) e é apagada do Cloudinary junto com a publicação.
- Avaliação só do que fez parte do atendimento/pedido concluído; uma por atendimento/pedido (UNIQUE + CHECK).

## Dados sensíveis da equipe
- Documentos em AES-256-GCM (`src/lib/cifra.js`, chave `CHAVE_DADOS`), mascarados na lista; abrir a ficha gera registro na auditoria.
- `log_auditoria` é gravado só pelo servidor, descarta campos sensíveis e não tem rota de escrita.
- Recepcionista não troca o e-mail de cliente que já tem senha (evita tomada de conta).

## Visualizador 3D
- `public/vendor/model-viewer-4.1.0.min.js` (BSD-3) servido por nós e baixado só quando a pessoa pede o 3D.
  A CSP libera `'wasm-unsafe-eval'` apenas para o decodificador de malhas; scripts inline continuam proibidos.

## Publicação destas mudanças (quando autorizada)
1. Ponto de recuperação no Neon. 2. `prisma migrate deploy` no banco principal (`20261119…`, `20261124000000…`, `20261124000100…`, todas aditivas).
3. Variáveis no Render: `CLOUDINARY_*`, `CHAVE_DADOS`, `APP_URL`, SMTP. 4. Publicar o código. As migrations vêm **antes** do código.
