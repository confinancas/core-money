import { type Context, Hono } from "hono";
import type { BrandConfig } from "../shared/brand/types";
import { isPublicRoute } from "./auth/public-routes";
import { requireSession, sessaoDoCookie } from "./auth/sessions";
import { verificadorReal, type WebAuthnLoginVerifier, type WebAuthnVerifier } from "./auth/webauthn";
import { categoriesRoutes } from "./categories/routes";
import { createDb } from "./db/client";
import { type Meter, newMeter } from "./db/metered-d1";
import type { AppEnv } from "./env";
import type { SessionResolver } from "./household/context";
import { apiError } from "./http/errors";
import { sameOrigin } from "./http/same-origin";
import { fixedIncomesRoutes } from "./income/fixed-incomes-routes";
import { membersRoutes } from "./members/routes";
import { notificationPrefsRoutes, notificationsRoutes } from "./notifications/routes";
import { type ValidacaoDaChave, validateClaudeKey } from "./providers/anthropic";
import { authRoutes } from "./routes/auth";
import { devicesRoutes } from "./routes/devices";
import { healthRoute } from "./routes/health";
import { householdRoutes } from "./routes/household";
import { invitesRoutes } from "./routes/invites";
import { recoveryRoutes } from "./routes/recovery";
import { settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";
import { setupHouseholdRoutes } from "./routes/setup-household";
import { regrasRoutes, transacoesRoutes } from "./rules/routes";
import { setupGate } from "./setup/state";
import { regrasAutomaticasRoutes, tiposDeGastoRoutes } from "./spend-types/routes";

export type AppOptions = {
  onMeter?: (meter: Meter, c: Context<AppEnv>) => void;
  rotasDoApp?: (app: Hono<AppEnv>) => void;
  marca?: BrandConfig;
  versao?: string;
  // Padrão: a sessão real, pelo cookie mm_sess (TASK-0104). Os testes que passam um resolvedor fixo mandam a identidade
  // sem cookie; a sessão grava c.var.session da mesma forma.
  resolveSession?: SessionResolver;
  // Padrão: a validação real, na Anthropic. Os testes passam uma falsa; nenhum teste fala com a Anthropic.
  validateClaudeKey?: ValidacaoDaChave;
  // Padrão: a verificação real do @simplewebauthn/server. Os testes passam um falso do cadastro (TASK-0103); o login
  // (TASK-0104) usa o real, a menos que o falso traga os dois métodos de login.
  webauthn?: WebAuthnVerifier & Partial<WebAuthnLoginVerifier>;
  // Relógio das rotas que precisam de "hoje" (o dia de início muda a partir do ciclo de hoje). Padrão: o relógio real.
  agora?: () => Date;
};

// Valores de desenvolvimento para os testes; a entrada de dev (index.ts) passa os do dev/marca.json.
// Sem o nome do produto: o src/worker não pode depender de dev/ (que não vai no pacote), e o aceite proíbe o literal fora de dev/.
const MARCA_DE_DESENVOLVIMENTO: BrandConfig = {
  id: "matrimoney",
  workerName: "matrimoney",
  repositorio: "confinancas/matrimoney",
  name: "App de desenvolvimento",
  shortName: "App de desenvolvimento",
  wordmark: ["App", "Dev"],
  colors: { theme: "#0E9A63", background: "#FFFFFF", wordmarkA: "#3D4943", wordmarkB: "#0E9A63" },
  texts: {
    tagline: "Ambiente de desenvolvimento.",
    assistantCta: "Pergunte ao assistente",
    householdLabel: "Conta compartilhada",
  },
};
const VERSAO_DE_DESENVOLVIMENTO = "0.1.0";

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api");
  const validar = options.validateClaudeKey ?? validateClaudeKey;
  const webauthn: WebAuthnVerifier = options.webauthn ?? verificadorReal;
  // Os métodos de login: os do falso, quando ele os traz; senão os reais (o login não depende do falso do cadastro).
  const login: WebAuthnLoginVerifier = { ...verificadorReal, ...options.webauthn };
  const resolverDaSessao: SessionResolver = options.resolveSession ?? sessaoDoCookie;

  // Primeiro middleware: mede o uso do D1 desta requisição e expõe marca e versão no contexto.
  app.use(async (c, next) => {
    const meter = newMeter();
    c.set("meter", meter);
    c.set("db", createDb(c.env.DB, meter));
    c.set("marca", options.marca ?? MARCA_DE_DESENVOLVIMENTO);
    c.set("versao", options.versao ?? VERSAO_DE_DESENVOLVIMENTO);
    await next();
    options.onMeter?.(meter, c);
  });

  // Logo depois do medidor: fora do modo pronto, só a configuração inicial responde (TASK-0102).
  app.use(setupGate());

  // Contra pedido de outro site (TASK-0104), antes de qualquer rota que muda dados.
  app.use(sameOrigin());

  // Sessão: tudo em /api exige sessão, salvo as rotas públicas (acesso e configuração). O requireSession grava
  // c.var.session, e o requireHousehold das rotas do lar a encontra (TASK-0006).
  const exigeSessao = requireSession(resolverDaSessao);
  app.use(async (c, next) => (isPublicRoute(c.req.method, c.req.path) ? next() : exigeSessao(c, next)));

  // As rotas do app entram antes das do núcleo, para o app poder trocar uma delas.
  options.rotasDoApp?.(app);
  app.route("/", healthRoute);
  app.route("/setup", setupRoutes(validar));
  app.route("/setup/household", setupHouseholdRoutes(webauthn));
  app.route("/auth", authRoutes(login, resolverDaSessao));
  app.route("/", settingsRoutes(validar));
  app.route("/household", householdRoutes(resolverDaSessao, options.agora));
  app.route("/members", membersRoutes(resolverDaSessao, options.agora));
  app.route("/notifications", notificationsRoutes(resolverDaSessao, options.agora));
  app.route("/notification-prefs", notificationPrefsRoutes(resolverDaSessao));
  app.route("/categories", categoriesRoutes(resolverDaSessao, options.agora));
  app.route("/rules", regrasRoutes(resolverDaSessao, options.agora));
  app.route("/transactions", transacoesRoutes(resolverDaSessao, options.agora));
  app.route("/spend-types", tiposDeGastoRoutes(resolverDaSessao, options.agora));
  app.route("/fixed-incomes", fixedIncomesRoutes(resolverDaSessao, options.agora));
  app.route("/automatic-rules", regrasAutomaticasRoutes(resolverDaSessao, options.agora));
  app.route("/invites", invitesRoutes(webauthn, resolverDaSessao, options.agora));
  app.route("/devices", devicesRoutes(webauthn, resolverDaSessao, options.agora));
  app.route("/", recoveryRoutes(webauthn, resolverDaSessao, options.agora));

  app.notFound((c) => apiError(c, 404, "rota_inexistente", "Rota não encontrada."));

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} ${err.name}: ${err.message}`);
    return apiError(c, 500, "erro_interno", "Algo deu errado. Tente de novo.");
  });

  return app;
}
