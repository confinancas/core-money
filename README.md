# core-money

Núcleo dos apps de finanças da Confinanças: a API em Hono e as telas em React (Vite), num Worker da Cloudflare com banco D1.

Este repositório não é instalado direto. Quem quer instalar o Matrimoney deve ir ao repositório do app, `confinancas/matrimoney`, que usa este núcleo como dependência.

## Licença

Copyright (C) 2026 Confinanças

Este programa é software livre: você pode redistribuí-lo e/ou modificá-lo sob os termos da GNU Affero General Public License, versão 3 ou posterior (AGPL-3.0-or-later). O texto completo está no arquivo [LICENSE](LICENSE).

## Desenvolvimento

Pré-requisitos: Node 22 e npm. O desenvolvimento local não precisa de conta na Cloudflare nem do arquivo `.env`.

```sh
npm ci                    # instala as dependências
npm run dev               # telas em http://localhost:5173 e API em http://localhost:8787
npm run preview           # gera as telas e sobe a API, como em produção
npm run db:migrate:local  # aplica as migrações no D1 local
npm run lint
npm run typecheck
npm run build
```
