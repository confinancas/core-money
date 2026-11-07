# core-money — Guia do Repositório para Agentes

Núcleo dos apps de finanças da Confinanças (o Matrimoney, para casais, e depois o Meumoney), open source e auto-hospedados: cada pessoa instala na própria conta da Cloudflare, com as próprias chaves. Cada app tem um repositório fino, que usa este como dependência, presa a uma tag do GitHub (ADR-012 no doc). Conecta contas e cartões, categoriza as transações com IA (opcional) e oferece um assistente com voz (opcional). Idioma: português do Brasil. Stack: PWA em Hono + React (Vite), num Worker da Cloudflare, com banco D1 (ADR-006 e ADR-007 no doc). Estrutura e comandos: EPIC-00.

## Fonte da verdade

- **Comece pelo status**: `../money-doc/03-status/status-atual.md`.
- **Backlog/specs**: `../money-doc/` (épicos em `04-backlog/`, tasks em `04-backlog/tasks/`).
- **Processo obrigatório**: `../money-doc/05-guias/processo-de-desenvolvimento.md`. Trabalhe SOMENTE dentro do escopo da task designada; ao concluir, preencha a seção "Evidências" do arquivo da task e PARE para revisão. Bug fora do escopo: reporte, não conserte.
- **Guia operacional para agentes**: `../money-doc/05-guias/guia-execucao-agentes.md`. Leia antes de executar qualquer task.

## Comandos

- Instalar: `npm ci` (Node 22, conforme `.nvmrc`).
- Desenvolver: `npm run dev` (telas em http://localhost:5173, API em :8787, D1 local). Não precisa de conta na Cloudflare nem de `.env`.
- Ver como em produção: `npm run preview`.
- Banco local: `npm run db:migrate:local`.
- Checar: `npm run lint`, `npm run typecheck`, `npm run build`.
- Arquivos locais a copiar para o worktree: nenhum para o dev local.

## Regras rígidas

1. **Nenhuma linha de código sem task especificada** e validada por Gustavo.
2. **Este repositório é público (open source).** Nunca commite `.env`, chave, token, senha, dado pessoal ou URL privada. Segredo commitado vaza para o mundo e tem que ser trocado.
3. **As chaves de quem instala vivem no banco**, entradas pelo app ([ADR-003](../money-doc/06-decisoes/ADR-003-chaves-no-banco.md)). Nenhuma rota devolve uma chave; chave nunca aparece em log ou mensagem de erro.
4. **Só o servidor fala com a Anthropic, o Google e o agregador de Open Finance.** O app (cliente) nunca recebe uma chave.
5. **Dado financeiro real nunca** em teste, fixture, log ou print. Testes usam dados fictícios prefixados `[TEST]`.
6. **Tudo cabe no plano gratuito da Cloudflare** ([ADR-008](../money-doc/06-decisoes/ADR-008-plano-gratuito.md)): cada rota e cada cron em até 10 ms de CPU, até 50 chamadas externas por execução (cada consulta ao D1 conta), consultas com índice e em lote. Regras em `../money-doc/02-arquitetura/plano-gratuito.md`.
7. **Git:** nunca commite nem faça push direto na `main`. Branch `task/<nnxx>-<slug>`, commits `TASK-NNXX: <verbo no imperativo>`, PR em rascunho contra a `main`, merge commit (nunca squash), merge só com o aceite da Fable e o "pode mergear" de Gustavo. O `money-doc` não tem proteção: o executor e a Fable commitam local, o Opus empurra.

## Arquitetura — o que você precisa saber

- Visão geral e o que está decidido: `../money-doc/02-arquitetura/stack-e-estrutura.md`.
- Limites do plano gratuito e o aviso de uso: `../money-doc/02-arquitetura/plano-gratuito.md`.
- Chaves, modo configuração e funções ligadas pela configuração: `../money-doc/02-arquitetura/configuracao-e-chaves.md`.
- IA (categorização, assistente, insights) e voz: `../money-doc/02-arquitetura/ia-e-voz.md`.
- Invariantes que toda revisão confere: `../money-doc/05-guias/guia-revisao.md`, seção 4.

## Armadilhas conhecidas (aprendidas na prática)

Nenhuma ainda.
