# Studio Corte — Sistema Completo (HTML + CSS + JS)

Sistema de gerenciamento e site institucional para barbearia/cabeleireiro, baseado 100% no tema visual das imagens fornecidas.

## Tema visual
- Fundo: `#09090d`
- Cards: `#16161f`
- Accent: `#ef4444`
- Tipografia: Inter
- Dark mode premium, responsivo

## Estrutura

```
studio-corte/
├── index.html              → Página inicial (hero, cortes, serviços, produtos, localização, avaliações)
├── login.html              → Login (cliente e admin)
├── recuperar-senha.html    → Fluxo de recuperação (notifica o proprietário)
├── perfil.html             → Área do usuário (dados, favoritos, histórico, carrinho)
├── admin/
│   ├── index.html          → Dashboard do proprietário
│   ├── clientes.html
│   ├── servicos.html
│   ├── produtos.html       → CRUD de produtos
│   ├── agendamentos.html
│   └── configuracoes.html
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── components.css
│   ├── home.css
│   ├── login.css
│   ├── perfil.css
│   └── admin.css
└── js/
    ├── data.js             → Dados simulados + auth + carrinho (localStorage)
    └── main.js
```

## Como usar

1. Abra `index.html` em qualquer navegador moderno (ou use um servidor local).
2. **Cliente demo**: qualquer e-mail + qualquer senha → vai para o perfil.
3. **Admin demo**: `admin@studiocorte.com` + qualquer senha → painel de controle.

## Funcionalidades implementadas

- [x] Tema idêntico às imagens (cores, cards, tipografia, layout)
- [x] Página inicial completa (hero, galeria, serviços, produtos condicionais, mapa, avaliações, rodapé reduzido)
- [x] Login + recuperação de senha (notifica o admin)
- [x] Perfil do usuário (dados, redes, favoritos, históricos, estatísticas, carrinho)
- [x] Painel do proprietário (métricas, agendamentos, atividade, populares)
- [x] Gerenciamento de produtos (CRUD com localStorage)
- [x] Gerenciamento de clientes, serviços e agendamentos
- [x] Carrinho no perfil do usuário
- [x] Seção de produtos na home (só aparece se houver produtos)
- [x] Responsivo (mobile / tablet / desktop)
- [x] Auth simulada com localStorage
- [x] Avisos de recuperação de senha no dashboard do admin

## Próximos passos possíveis
- Backend real (Node, Firebase, Supabase…)
- Upload real de imagens
- Agendamento com calendário
- Notificações push / WhatsApp API
- Editor de conteúdo avançado (pedido no extra de automação)

## Demo rápida
1. Abra `index.html`
2. Clique em “Entrar na Conta”
3. Use `admin@studiocorte.com` para ver o painel completo
4. Ou qualquer outro e-mail para ver o perfil de cliente + carrinho
