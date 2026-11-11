// Conexões do Meu Pluggy (TASK-0203): pré-visualização dos bancos, criação da conexão, outro banco, troca de chaves e
// a lista. Só o servidor fala com o Pluggy (regra 4): as chaves entram pelo app, são testadas e cifradas com a chave
// mestra (TASK-0102, ADR-004) e nunca voltam ao navegador. Cada escrita confere tudo antes de gravar.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  BankItemDto,
  ConnectionDto,
  ConnectionsResponse,
  CreatedConnectionResponse,
  ItemDoPedido,
  ItemPreview,
  PreviewItemsResponse,
  StatusDoBancoDto,
} from "../../shared/pluggy-api";
import { MAXIMO_DE_BANCOS_ATIVOS } from "../../shared/pluggy-api";
import { mascararDocumento } from "../bank/map";
import type { Db } from "../db/client";
import { bankItems, pluggyConnections } from "../db/schema";
import type { Env } from "../env";
import { decryptSecret, encryptSecret } from "../security/crypto";
import { apagarApiKey } from "./api-key-cache";
import { createPluggyClient, type PluggyClient } from "./client";
import { PluggyError } from "./errors";
import { accountsSummary, institutionFromItem } from "./institution";
import type { PluggyAccount, PluggyItem } from "./types";

// Erros de domínio: a rota traduz cada um para a resposta da convenção.
export class ConexaoNaoEncontradaError extends Error {
  constructor() {
    super("Conexão não encontrada.");
    this.name = "ConexaoNaoEncontradaError";
  }
}

export class SemChavesError extends Error {
  constructor() {
    super("A conexão não tem chaves guardadas.");
    this.name = "SemChavesError";
  }
}

// As chaves estão guardadas, mas não abrem nesta instalação (a chave mestra mudou ou a linha foi adulterada).
export class ChavesIlegiveisError extends Error {
  constructor() {
    super("As chaves da conexão não abrem.");
    this.name = "ChavesIlegiveisError";
  }
}

export class ItemNaoEncontradoError extends Error {
  constructor() {
    super("Item não encontrado no Meu Pluggy.");
    this.name = "ItemNaoEncontradoError";
  }
}

export class NomeDoBancoError extends Error {
  constructor() {
    super("Nome do banco não deduzido nem enviado.");
    this.name = "NomeDoBancoError";
  }
}

export class BancoJaConectadoError extends Error {
  constructor() {
    super("Banco já conectado.");
    this.name = "BancoJaConectadoError";
  }
}

export class RotuloEmUsoError extends Error {
  constructor() {
    super("Rótulo já usado no lar.");
    this.name = "RotuloEmUsoError";
  }
}

export class LimiteDoPluggyError extends Error {
  constructor() {
    super("Limite de bancos por conta atingido.");
    this.name = "LimiteDoPluggyError";
  }
}

// Contexto de uma operação: o lar da sessão, o D1 (db) e as variáveis (chave mestra e endereço do Pluggy).
export type ContextoDeConexao = {
  db: Db;
  env: Env;
  householdId: string;
  // Só os testes passam um fetch falso; em produção vale o fetch do Worker.
  fetch?: typeof fetch;
  agora: () => Date;
};

export type ParDeChaves = { clientId: string; clientSecret: string };

type LinhaDaConexao = typeof pluggyConnections.$inferSelect;

// Nome de cada cifra: uma linha copiada para outra conexão ou outro campo não abre (ADR-004).
export const nomeDaChave = (connectionId: string, campo: "client_id" | "client_secret") =>
  `pluggy:${connectionId}:${campo}`;

async function buscarConexao(ctx: ContextoDeConexao, connectionId: string): Promise<LinhaDaConexao> {
  const [linha] = await ctx.db
    .select()
    .from(pluggyConnections)
    .where(and(eq(pluggyConnections.id, connectionId), eq(pluggyConnections.householdId, ctx.householdId)))
    .limit(1);
  if (!linha) throw new ConexaoNaoEncontradaError();
  return linha;
}

// Decifra as duas chaves da conexão. Sem as cifras, SemChavesError; cifra que não abre, ChavesIlegiveisError.
async function chavesDaConexao(env: Env, linha: LinhaDaConexao): Promise<ParDeChaves> {
  if (!linha.clientIdEnc || !linha.iv || !linha.clientSecretEnc || !linha.clientSecretIv) {
    throw new SemChavesError();
  }
  try {
    const clientId = await decryptSecret(env.MASTER_KEY, nomeDaChave(linha.id, "client_id"), {
      ciphertext: linha.clientIdEnc,
      iv: linha.iv,
    });
    const clientSecret = await decryptSecret(env.MASTER_KEY, nomeDaChave(linha.id, "client_secret"), {
      ciphertext: linha.clientSecretEnc,
      iv: linha.clientSecretIv,
    });
    return { clientId, clientSecret };
  } catch {
    throw new ChavesIlegiveisError();
  }
}

function clienteComChaves(ctx: ContextoDeConexao, chaves: ParDeChaves, cacheKey: string): PluggyClient {
  return createPluggyClient({
    clientId: chaves.clientId,
    clientSecret: chaves.clientSecret,
    cacheKey,
    baseUrl: ctx.env.PLUGGY_BASE_URL,
    fetch: ctx.fetch,
  });
}

// Cliente do Pluggy de uma conexão do lar: decifra as chaves e usa o id da conexão como cacheKey da apiKey.
export async function clientForConnection(
  ctx: ContextoDeConexao,
  connectionId: string,
): Promise<PluggyClient> {
  const linha = await buscarConexao(ctx, connectionId);
  const chaves = await chavesDaConexao(ctx.env, linha);
  return clienteComChaves(ctx, chaves, connectionId);
}

// Só testa as chaves digitadas (o /auth do Pluggy), sem gravar nada. A apiKey gerada sai do cache logo depois.
export async function testarChaves(ctx: ContextoDeConexao, chaves: ParDeChaves): Promise<void> {
  const temporaria = crypto.randomUUID();
  try {
    await clienteComChaves(ctx, chaves, temporaria).testKeys();
  } finally {
    apagarApiKey(temporaria);
  }
}

// Lê o item e as contas. Item inexistente vira null (a tela diz "não achamos este id"); o resto sobe.
async function lerItem(
  client: PluggyClient,
  itemId: string,
): Promise<{ item: PluggyItem; accounts: PluggyAccount[] } | null> {
  try {
    const item = await client.getItem(itemId);
    const accounts = await client.listAccounts(itemId);
    return { item, accounts };
  } catch (erro) {
    if (erro instanceof PluggyError && erro.kind === "not_found") return null;
    throw erro;
  }
}

async function idsJaConectados(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const linhas = await db.select({ id: bankItems.id }).from(bankItems).where(inArray(bankItems.id, ids));
  return new Set(linhas.map((linha) => linha.id));
}

// Pré-visualização: a conexão do lar (chaves guardadas) ou as chaves digitadas, para uma conexão que ainda não existe.
export async function previewItems(
  ctx: ContextoDeConexao,
  origem: { connectionId: string } | { chaves: ParDeChaves },
  itemIds: string[],
): Promise<PreviewItemsResponse> {
  const temporaria = "chaves" in origem ? crypto.randomUUID() : null;
  const client =
    "chaves" in origem
      ? clienteComChaves(ctx, origem.chaves, temporaria ?? "")
      : await clientForConnection(ctx, origem.connectionId);
  try {
    const conhecidos = await idsJaConectados(ctx.db, itemIds);
    const items: ItemPreview[] = [];
    for (const itemId of itemIds) {
      const lido = await lerItem(client, itemId);
      if (lido === null) {
        items.push({ itemId, error: "nao_encontrado" });
        continue;
      }
      const instituicao = institutionFromItem(lido.item, lido.accounts);
      items.push({
        itemId,
        institutionName: instituicao.name,
        institutionColor: instituicao.color,
        summary: accountsSummary(lido.accounts),
        consentExpiresAt: lido.item.consentExpiresAt ?? null,
        alreadyConnected: conhecidos.has(itemId),
      });
    }
    return { items };
  } finally {
    if (temporaria !== null) apagarApiKey(temporaria);
  }
}

// CPF do titular, mascarado, pela identidade do item. Sem identidade ou falha do Pluggy: null (não bloqueia a conexão).
async function cpfDoItem(client: PluggyClient, itemId: string): Promise<string | null> {
  try {
    const identidade = await client.getIdentity(itemId);
    const documento = identidade?.document ?? null;
    if (documento === null || documento.replace(/\D/g, "").length !== 11) return null;
    return mascararDocumento(documento);
  } catch (erro) {
    if (erro instanceof PluggyError) return null;
    throw erro;
  }
}

type ItemResolvido = {
  itemId: string;
  institutionName: string;
  institutionColor: string;
  consentExpiresAt: string | null;
};

// Confere cada item no Pluggy e resolve o banco: o nome deduzido vale; o enviado só quando o servidor não deduz.
async function resolverItens(client: PluggyClient, itens: ItemDoPedido[]): Promise<ItemResolvido[]> {
  const resolvidos: ItemResolvido[] = [];
  for (const pedido of itens) {
    const lido = await lerItem(client, pedido.itemId);
    if (lido === null) throw new ItemNaoEncontradoError();
    const instituicao = institutionFromItem(lido.item, lido.accounts);
    const nome = instituicao.name ?? pedido.institutionName ?? null;
    if (nome === null) throw new NomeDoBancoError();
    resolvidos.push({
      itemId: pedido.itemId,
      institutionName: nome,
      institutionColor: instituicao.color,
      consentExpiresAt: lido.item.consentExpiresAt ?? null,
    });
  }
  return resolvidos;
}

// Id de linha que já existe, numa corrida entre dois pedidos, vira a mesma resposta da checagem.
function traduzirErroDeUnicidade(erro: unknown): unknown {
  const texto = erro instanceof Error ? erro.message : String(erro);
  if (/UNIQUE constraint failed: bank_items/.test(texto)) return new BancoJaConectadoError();
  if (/UNIQUE constraint failed: pluggy_connections/.test(texto)) return new RotuloEmUsoError();
  return erro;
}

function linhasDeBancos(connectionId: string, resolvidos: ItemResolvido[], agora: string) {
  return resolvidos.map((item) => ({
    id: item.itemId,
    connectionId,
    institutionName: item.institutionName,
    institutionColor: item.institutionColor,
    consentExpiresAt: item.consentExpiresAt,
    status: "ativo",
    createdAt: agora,
  }));
}

export async function createConnection(
  ctx: ContextoDeConexao,
  entrada: { label: string; chaves: ParDeChaves; items: ItemDoPedido[] },
): Promise<CreatedConnectionResponse> {
  const connectionId = crypto.randomUUID();
  try {
    const rotuloEmUso = await ctx.db
      .select({ id: pluggyConnections.id })
      .from(pluggyConnections)
      .where(
        and(eq(pluggyConnections.householdId, ctx.householdId), eq(pluggyConnections.label, entrada.label)),
      )
      .limit(1);
    if (rotuloEmUso.length > 0) throw new RotuloEmUsoError();

    const conhecidos = await idsJaConectados(
      ctx.db,
      entrada.items.map((item) => item.itemId),
    );
    if (conhecidos.size > 0) throw new BancoJaConectadoError();

    const client = clienteComChaves(ctx, entrada.chaves, connectionId);
    await client.testKeys();
    const resolvidos = await resolverItens(client, entrada.items);
    const cpfMasked = await cpfDoItem(client, resolvidos[0]?.itemId ?? "");

    const agora = ctx.agora().toISOString();
    const cifraId = await encryptSecret(
      ctx.env.MASTER_KEY,
      nomeDaChave(connectionId, "client_id"),
      entrada.chaves.clientId,
    );
    const cifraSegredo = await encryptSecret(
      ctx.env.MASTER_KEY,
      nomeDaChave(connectionId, "client_secret"),
      entrada.chaves.clientSecret,
    );

    try {
      await ctx.db.batch([
        ctx.db.insert(pluggyConnections).values({
          id: connectionId,
          householdId: ctx.householdId,
          label: entrada.label,
          cpfMasked,
          clientIdEnc: cifraId.ciphertext,
          iv: cifraId.iv,
          clientSecretEnc: cifraSegredo.ciphertext,
          clientSecretIv: cifraSegredo.iv,
          createdAt: agora,
        }),
        ctx.db.insert(bankItems).values(linhasDeBancos(connectionId, resolvidos, agora)),
      ]);
    } catch (erro) {
      throw traduzirErroDeUnicidade(erro);
    }

    return {
      connection: { id: connectionId, label: entrada.label, cpfMasked },
      bankItems: resolvidos.map((item) => ({ id: item.itemId, institutionName: item.institutionName })),
    };
  } finally {
    apagarApiKey(connectionId);
  }
}

export async function addBankItems(
  ctx: ContextoDeConexao,
  connectionId: string,
  items: ItemDoPedido[],
): Promise<{ bankItems: { id: string; institutionName: string }[] }> {
  const linha = await buscarConexao(ctx, connectionId);
  const chaves = await chavesDaConexao(ctx.env, linha);

  const [ativos] = await ctx.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(bankItems)
    .where(and(eq(bankItems.connectionId, connectionId), isNull(bankItems.disconnectedAt)));
  if (Number(ativos?.n ?? 0) + items.length > MAXIMO_DE_BANCOS_ATIVOS) throw new LimiteDoPluggyError();

  const conhecidos = await idsJaConectados(
    ctx.db,
    items.map((item) => item.itemId),
  );
  if (conhecidos.size > 0) throw new BancoJaConectadoError();

  const client = clienteComChaves(ctx, chaves, connectionId);
  const resolvidos = await resolverItens(client, items);
  try {
    await ctx.db
      .insert(bankItems)
      .values(linhasDeBancos(connectionId, resolvidos, ctx.agora().toISOString()));
  } catch (erro) {
    throw traduzirErroDeUnicidade(erro);
  }
  return {
    bankItems: resolvidos.map((item) => ({ id: item.itemId, institutionName: item.institutionName })),
  };
}

// Troca das chaves: testadas antes de gravar. Depois, os bancos com ação necessária voltam a ativo (o histórico fica).
export async function replaceKeys(
  ctx: ContextoDeConexao,
  connectionId: string,
  chaves: ParDeChaves,
): Promise<void> {
  await buscarConexao(ctx, connectionId);
  const client = clienteComChaves(ctx, chaves, connectionId);
  await client.testKeys();

  const cifraId = await encryptSecret(
    ctx.env.MASTER_KEY,
    nomeDaChave(connectionId, "client_id"),
    chaves.clientId,
  );
  const cifraSegredo = await encryptSecret(
    ctx.env.MASTER_KEY,
    nomeDaChave(connectionId, "client_secret"),
    chaves.clientSecret,
  );
  await ctx.db.batch([
    ctx.db
      .update(pluggyConnections)
      .set({
        clientIdEnc: cifraId.ciphertext,
        iv: cifraId.iv,
        clientSecretEnc: cifraSegredo.ciphertext,
        clientSecretIv: cifraSegredo.iv,
      })
      .where(eq(pluggyConnections.id, connectionId)),
    ctx.db
      .update(bankItems)
      .set({ status: "ativo" })
      .where(and(eq(bankItems.connectionId, connectionId), eq(bankItems.status, "acao_necessaria"))),
  ]);
}

// Lista do lar: uma consulta com junção (conexões na ordem de criação, e os bancos de cada uma). Sem chaves na resposta.
const SQL_CONEXOES = `
SELECT c.id AS connection_id, c.label, c.cpf_masked, c.client_id_enc, c.client_secret_enc,
       b.id AS bank_id, b.institution_name, b.institution_color, b.consent_expires_at, b.status,
       b.disconnected_at, b.last_sync_at
FROM pluggy_connections c
LEFT JOIN bank_items b ON b.connection_id = c.id
WHERE c.household_id = ?1
ORDER BY c.created_at, c.id, b.created_at, b.id`;

type LinhaDaLista = {
  connection_id: string;
  label: string;
  cpf_masked: string | null;
  client_id_enc: string | null;
  client_secret_enc: string | null;
  bank_id: string | null;
  institution_name: string | null;
  institution_color: string | null;
  consent_expires_at: string | null;
  status: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
};

export async function listConnections(db: Db, householdId: string): Promise<ConnectionsResponse> {
  const { results } = await db.$client.prepare(SQL_CONEXOES).bind(householdId).all<LinhaDaLista>();
  const porId = new Map<string, ConnectionDto>();
  for (const linha of results) {
    let conexao = porId.get(linha.connection_id);
    if (!conexao) {
      conexao = {
        id: linha.connection_id,
        label: linha.label,
        cpfMasked: linha.cpf_masked,
        hasKeys: linha.client_id_enc !== null && linha.client_secret_enc !== null,
        bankItems: [],
      };
      porId.set(linha.connection_id, conexao);
    }
    if (linha.bank_id !== null) {
      const banco: BankItemDto = {
        id: linha.bank_id,
        institutionName: linha.institution_name ?? "",
        institutionColor: linha.institution_color,
        consentExpiresAt: linha.consent_expires_at,
        status: (linha.status ?? "ativo") as StatusDoBancoDto,
        disconnectedAt: linha.disconnected_at,
        lastSyncAt: linha.last_sync_at,
      };
      conexao.bankItems.push(banco);
    }
  }
  return { connections: [...porId.values()] };
}
