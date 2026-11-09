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
- Gate, antes de entregar: `npm run gate` (lint, typecheck, testes unitários, build e integração), 2× seguidas.
- E2E: `npm run test:e2e` (obrigatório se a task tocou `src/web`, `index.html`, `vite.config.ts`, `preset/` ou arquivos públicos).
- CPU: `npm run cpu -- tests/cpu/TASK-NNXX.json` (obrigatório se a task criou ou mudou rota ou cron; precisa do `.env` no worktree).
- App fino: `npm run check:app-fino` monta uma fixture com o núcleo empacotado (`npm pack`, instalação, build, typecheck e dry-run). Quebrar um item de `exports` faz o job `app-fino` falhar.
- Arquivos locais a copiar para o worktree: `.env` da pasta principal, só para `npm run cpu`. O dev local e o gate não usam.

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

- **Pacote novo:** `npm install` precisa de `--legacy-peer-deps` (peer cíclico vite → @vitejs/devtools → vitest). `npm ci` não precisa.
- **Glob no TypeScript 7:** `dir/**` é recusado; use `dir/**/*`.
- **Windows:** scripts Node chamam `node node_modules/<pacote>/bin/...` com `spawn`, sem shell. Encerre todo processo que subiu (wrangler, workerd, vite, playwright), ou a pasta do worktree não pode ser apagada.
- **Proxy do Vite:** aponta para `127.0.0.1`; `localhost` resolve para `::1`, e o wrangler escuta em IPv4.
- **`wrangler tail`:** perde eventos em rajada, por isso o `npm run cpu` espaça as requisições em 1 s.
- **Testes de integração:** o D1 de teste é compartilhado e aplica chaves estrangeiras. O `vitest.integration.config.ts` roda um arquivo por vez (`fileParallelism: false`), e o setup esvazia as tabelas antes de cada teste, filhos antes dos pais.
- **Tailwind 4 não procura classes em `node_modules`:** o núcleo declara `@source ".."` em `src/web/styles/global.css`. Sem isso, as classes dos componentes somem nos apps finos.
- **Os apps finos só chamam `montarApp()`:** CSS e provedores ficam em `src/web/montar-app.tsx`, nunca em `src/web/main.tsx`. Caminhos do preset saem de `import.meta.url`, porque num app o núcleo está em `node_modules`.
- **shadcn:** o CLI não roda sem interação neste repositório; os componentes ficam escritos à mão em `src/web/components/ui/`.
- **`ON CONFLICT` numa chave única:** o `INSERT` não pode reusar o id da linha existente: a chave primária fica fora do conflito, e o SQLite falha. Gere um id novo em todo `INSERT`.
- **Limite do D1:** 100 parâmetros por comando. A gravação de movimentos usa 4 linhas por `INSERT`.
- **Caminhos do preset:** `marca` e `publicDir` são do app e saem de `process.cwd()`; o alias `@` vem de `import.meta.url`.
- **Vitest 4 não aplica o `define` aos projetos:** `__BRAND__` e `__DEV_ROUTES__` dos testes vêm de `tests/setup/globais.ts`.
- **Marca:** o nome não entra em `src/` nem em `index.html`; o teste `brand-literals` confere. `src/web/assets/rosto-ia.svg` não tem `<style>`: as animações estão no `global.css`.
- **Regra que decide pela vizinhança:** só escreve onde a vizinhança inteira está na leitura (ler ±10 dias para escrever ±5), em grupos de 45 ids, para caber em 100 parâmetros.
- **App fino e JSON:** `criarWorker({ marca })` precisa de cast no app, porque o JSON importado tem tipos alargados. O `concurrently` fica em `dependencies`, porque o `dev` do app o usa.
- **Instalador:** `scripts/instalar.ts` e `scripts/recuperar-acesso.ts` rodam na pasta do app, pelos `bin`. O estado fica em `.core-money/instalacao.json`, com nome fixo para qualquer marca. Os testes usam um runner falso; nenhum teste fala com a Cloudflare.
- **Medidor (`metered-d1`):** um comando preparado por um `Db` só entra no `batch` desse mesmo `Db`. Um `batch` com comando de outro medidor falha com `ZodError` do miniflare.
- **`rows_written` do D1:** conta as entradas de índice. Uma linha com dois índices sobre a coluna alterada conta mais que 1.
- **Lista de ids sem limite:** `json_each(?)`, com o JSON num único parâmetro, como em `src/worker/cycle/assign.ts`. Evita os grupos de 90.
- **Sonda do Pluggy:** `npm run -s pluggy:sonda`, porque o `-s` tira o cabeçalho do npm do stdout. As credenciais entram pelo terminal, nunca por arquivo. A fixture de 500 movimentos sai de `node tests/fixtures/pluggy/gerar-transactions-500.mjs`, seguida de `npx biome format --write` nela.
- **Modo configuração:** fora de `pronto`, o portão responde 503 a toda rota fora de `/api/setup/*` e `GET /api/health`. Teste que usa a API semeia `pronto` pelo auxiliar e chama `resetSetupCacheForTests()` antes, porque `pronto` fica em cache no módulo. O `wrangler dev` precisa do `.dev.vars` com `MASTER_KEY` (ver como-rodar).
- **E2E com duas instâncias:** 8788 (instalação pronta, semeada pelos testes) e 8790 (configuração do zero), cada uma com a própria porta de inspeção. Teste que volta à configuração usa só a 8790.
- **Medidor e Drizzle:** as leituras pelo `select` do Drizzle contam em `calls` e `statements`, mas não em `rowsRead`. Para medir linhas lidas, use `prepare().all()` direto.
- **`json_each` como laço de fora:** `FROM json_each(?) AS j CROSS JOIN transactions AS t ON t.id = j.value`. Sem o `CROSS JOIN`, o planejador usa o índice do lar e lê o lar inteiro a cada consulta. Confira com `EXPLAIN QUERY PLAN` e com `rowsRead` num lar grande.
- **Escrita de categoria:** só `src/worker/categorization/apply.ts` grava `category_id`. A chave de casamento sai do SQL (`t.establishment_key` e `COUNTERPARTY_KEY_SQL`), nunca do corpo da requisição.
- **Parâmetros por comando:** `tests/integration/helpers/parametros.ts` conta os `?` de cada SQL no `prepare`, para provar o limite de 100.
- **UPDATE com alias:** `UPDATE transactions AS t SET ...`; no `SET`, os nomes saem sem alias, e no `WHERE` com `t.`.
- **E2E com outros agentes:** as portas 8788, 8789 e 8790 são fixas, e o Playwright reaproveita o servidor que já estiver nelas. Com outro executor rodando, espere as três ficarem livres e rode `CI=1 npm run test:e2e`: assim o Playwright recusa a porta ocupada em vez de usar o servidor alheio.
- **`SETUP_SEM_CACHE=1`:** só nas instâncias que voltam ao cadastro do zero (a 8790 do E2E e o Worker da medição do fluxo `cadastro`): o portão não guarda `pronto` no módulo. Produção nunca define essa variável.
- **WebAuthn no E2E:** o rpID não pode ser IP, então o `cadastro.spec.ts` usa `http://localhost:<porta>`. O autenticador virtual fica em `tests/e2e/helpers/webauthn.ts`; `setUserVerified(false)` simula o cancelamento (`NotAllowedError`).
- **Medição por fluxo:** rota que só o navegador chama leva `via` no arquivo de medição e é medida por `scripts/dev/cpu-flows.mjs`. O fluxo `cadastro` reseta o banco de teste a cada rodada, uma chamada por instrução, e leva cerca de 30 minutos para 12 rodadas.
- **Sessão:** toda rota de `/api` fora de `src/worker/auth/public-routes.ts` exige sessão; sem cookie, 401 antes da rota. No E2E, a sessão da 8788 é semeada pelo global setup, e cada spec que passa pela moldura põe o cookie com `signUpAndSignIn(page)`.
- **Medição do login:** o `measure-cpu` cria a passkey de teste no banco de medição e entrega a chave privada ao autenticador virtual; o fluxo `login` não zera o banco e não liga `SETUP_SEM_CACHE`, e os passos têm pausa de 1,5 s, porque o tail perde eventos em rajada. A entrada do deploy de medição é `scripts/dev/cpu-worker.ts` (o `main` de produção continua `src/worker/index.ts`), que nunca entra no app nem no pacote.
- **Cota diária do D1 de teste:** as medições grandes (2.000 lançamentos, retroativo, importação) escrevem muitas linhas, e a cota de linhas escritas por dia da conta estoura (erro 7500). Ela renova às 00:00 UTC; meça só o que a task pede.
- **Convites:** o link só existe na resposta de criar ou de gerar novo; o banco guarda só o hash do token, e a consulta pública do convite é `POST`, com o token no corpo. Não tire as guardas do lote do aceite (uso, cônjuge, vencimento): sem a do cônjuge, duas aceitações no mesmo milissegundo dão 500 pela chave única de `members`, e não 409.
- **Teste de finalidade do desafio:** use um desafio que tenha `member_id`. Um desafio de login já é recusado por ter `member_id` nulo e, sozinho, não prova a finalidade.
- **Tipos do Worker no teste de unidade:** o tsconfig de unidade não tem `D1Database`. Funções puras ficam em módulo separado, como `src/worker/invites/status.ts`.
- **Medição:** `{id}` no caminho do arquivo de medição casa com qualquer segmento. Fluxo que precisa de sessão leva `sessao: true` e recebe o token pelo ambiente (`MM_CPU_SESSAO`).
- **Aparelhos:** remover um aparelho apaga as sessões dele antes da passkey, no mesmo lote; na ordem contrária, a chave estrangeira recusa com 500.
- **Recuperação:** o consumo do link entra no lote da passkey, com o `INSERT` condicionado ao link aberto. Não tire essa guarda: sem ela, duas abas gravam duas passkeys.
- **Mensagens da API:** os textos em `src/worker` não levam o nome da marca (o teste `brand-literals` confere). Use texto neutro, e a tela usa `brand.name`.
- **E2E que copia um link:** precisa de `grantPermissions` para a área de transferência; sem isso, a tela mostra o caminho alternativo.
- **Mutações:** rode a unidade e a integração em comandos separados. A integração ignora os arquivos de unidade, e a bateria junta dá falsa sobrevivência.
- **Configurações:** uma seção nova é um `Section<Nome>.tsx` e uma linha em `sections.ts`, com `tabletColumn` e `desktopColumn`; o layout não muda.
- **E2E na instalação pronta (8788):** chame `semearInstalacaoPronta()` antes de `semeiaSessaoDaInstalacaoPronta()`, senão a tela cai na configuração inicial. Teste que muda o dia de início volta o `cycle_start_day` a 11 antes de cada teste, e teste que sai usa sessão própria, para não derrubar a dos outros.
- **Varredura do ciclo:** a varredura exaustiva da transição (`tests/unit/shared/cycle.test.ts`) tem timeout de 30 s, porque passa de 5 s sob o gate.
- **Tipo de gasto:** `spend_type` só é gravado em `src/worker/categorization/apply.ts` (a herança vai junto com a categoria), em `src/worker/spend-types/derive.ts` e na carga da migração `0008`. A SQL da herança é `tipoDaCategoriaSql` (`src/worker/spend-types/resolve.ts`), com o alias `t`; o espelho em TypeScript é `resolveSpendType`.
- **A web não importa de `src/worker`:** constantes compartilhadas vão para `src/shared`.
- **D1 e profundidade:** uma cadeia longa de `REPLACE` estoura "Expression tree is too large (maximum depth 100)". A normalização de acento da contraparte usa 13.
- **D1 remoto e `pragma_*`:** o D1 remoto recusa `pragma_*` (SQLITE_AUTH). Para ler chaves estrangeiras, use o `CREATE TABLE` em `sqlite_master`.
- **Batch do Drizzle no D1:** `db.batch()` não aceita `db.run()` com SQL cru. Para SQL cru num batch, use `db.$client.batch(...)`, que é o binding medido.
