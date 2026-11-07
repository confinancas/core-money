import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Esta versão do pacote não isola o armazenamento por teste: antes de cada teste, esvazia as tabelas de dados
// (o esquema e o d1_migrations ficam).
beforeEach(async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).all<{ name: string }>();
  if (results.length > 0) {
    await env.DB.batch(results.map(({ name }) => env.DB.prepare(`DELETE FROM "${name}"`)));
  }
});
