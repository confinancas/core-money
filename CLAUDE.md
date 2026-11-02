# Matrimoney — Guia do Repositório para Agentes

App de finanças para casais, open source e auto-hospedado: cada pessoa instala na própria AWS, com as próprias chaves. Conecta contas e cartões, categoriza as transações com IA (obrigatória) e oferece um assistente com voz (opcional). Idioma: português do Brasil. Stack: a definir no EPIC-00, a partir do protótipo.

## Fonte da verdade

- **Comece pelo status**: `../matrimoney-doc/03-status/status-atual.md`.
- **Backlog/specs**: `../matrimoney-doc/` (épicos em `04-backlog/`, tasks em `04-backlog/tasks/`).
- **Processo obrigatório**: `../matrimoney-doc/05-guias/processo-de-desenvolvimento.md`. Trabalhe SOMENTE dentro do escopo da task designada; ao concluir, preencha a seção "Evidências" do arquivo da task e PARE para revisão. Bug fora do escopo: reporte, não conserte.
- **Guia operacional para agentes**: `../matrimoney-doc/05-guias/guia-execucao-agentes.md`. Leia antes de executar qualquer task.

## Comandos

A definir no EPIC-00 (instalar, dev, lint, typecheck, testes, build).

## Regras rígidas

1. **Nenhuma linha de código sem task especificada** e validada por Gustavo.
2. **Este repositório é público (open source).** Nunca commite `.env`, chave, token, senha, dado pessoal ou URL privada. Segredo commitado vaza para o mundo e tem que ser trocado.
3. **As chaves de quem instala vivem no banco**, entradas pelo app ([ADR-003](../matrimoney-doc/06-decisoes/ADR-003-chaves-no-banco.md)). Nenhuma rota devolve uma chave; chave nunca aparece em log ou mensagem de erro.
4. **Só o servidor fala com a Anthropic, o Google e o agregador de Open Finance.** O app (cliente) nunca recebe uma chave.
5. **Dado financeiro real nunca** em teste, fixture, log ou print. Testes usam dados fictícios prefixados `[TEST]`.
6. **Git:** nunca commite nem faça push direto na `main`. Branch `task/<nnxx>-<slug>`, commits `TASK-NNXX: <verbo no imperativo>`, PR em rascunho contra a `main`, merge commit (nunca squash), merge só com o aceite da Fable e o "pode mergear" de Gustavo. O `matrimoney-doc` não tem proteção: o executor e a Fable commitam local, o Opus empurra.

## Arquitetura — o que você precisa saber

- Visão geral e o que está decidido: `../matrimoney-doc/02-arquitetura/stack-e-estrutura.md`.
- Chaves, modo configuração e funções ligadas pela configuração: `../matrimoney-doc/02-arquitetura/configuracao-e-chaves.md`.
- IA (categorização, assistente, insights) e voz: `../matrimoney-doc/02-arquitetura/ia-e-voz.md`.
- Invariantes que toda revisão confere: `../matrimoney-doc/05-guias/guia-revisao.md`, seção 4.

## Armadilhas conhecidas (aprendidas na prática)

Nenhuma ainda.
