// Rotas das contas do Meu Pluggy (TASK-0203): /api/pluggy-connections. Com sessão (o requireSession global) e no lar
// da sessão. Cada erro sai pela convenção (apiError). Nenhuma resposta leva Client ID, Client Secret nem apiKey.
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  connectionLabelSchema,
  itemDoPedidoSchema,
  itemIdsSchema,
  MENSAGEM_BANCO_JA_CONECTADO,
  MENSAGEM_CHAVES_ILEGIVEIS,
  MENSAGEM_CHAVES_RECUSADAS,
  MENSAGEM_CONEXAO_NAO_ENCONTRADA,
  MENSAGEM_ITEM_NAO_ENCONTRADO,
  MENSAGEM_LIMITE_DO_PLUGGY,
  MENSAGEM_NOME_DO_BANCO,
  MENSAGEM_PLUGGY_INDISPONIVEL,
  MENSAGEM_ROTULO_EM_USO,
  MENSAGEM_SEM_CHAVES,
  pluggyKeysSchema,
} from "../../shared/pluggy-api";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { chaveMestraValida } from "../security/crypto";
import { lerCorpo, respondeChaveMestraAusente, respondeDadosInvalidos } from "../setup/chaves";
import {
  addBankItems,
  BancoJaConectadoError,
  ChavesIlegiveisError,
  ConexaoNaoEncontradaError,
  type ContextoDeConexao,
  createConnection,
  ItemNaoEncontradoError,
  LimiteDoPluggyError,
  listConnections,
  NomeDoBancoError,
  type ParDeChaves,
  previewItems,
  RotuloEmUsoError,
  replaceKeys,
  SemChavesError,
  testarChaves,
} from "./connections";
import { PluggyError } from "./errors";

export type OpcoesDasRotasDoPluggy = {
  agora?: () => Date;
  // Só os testes passam um fetch falso; em produção vale o do Worker.
  fetch?: typeof fetch;
};

// Erro de validação: um campo por chave do corpo, com a primeira mensagem de cada um.
function camposDe(erro: z.ZodError, prefixo = ""): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const problema of erro.issues) {
    const nome = [prefixo, ...problema.path.map(String)].filter((parte) => parte !== "").join(".");
    const chave = nome === "" ? "corpo" : nome;
    if (!(chave in campos)) campos[chave] = problema.message;
  }
  return campos;
}

const respondeValidacao = (c: Context<AppEnv>, fields: Record<string, string>) =>
  apiError(c, 400, "validacao", undefined, { fields });

// Erro de domínio ou do Pluggy vira a resposta da convenção. O resto sobe para o tratador global (500).
export function respondeDeErro(c: Context<AppEnv>, erro: unknown) {
  if (erro instanceof ConexaoNaoEncontradaError) {
    return apiError(c, 404, "conexao_nao_encontrada", MENSAGEM_CONEXAO_NAO_ENCONTRADA);
  }
  if (erro instanceof SemChavesError) return apiError(c, 409, "sem_chaves", MENSAGEM_SEM_CHAVES);
  if (erro instanceof ChavesIlegiveisError)
    return apiError(c, 409, "chaves_ilegiveis", MENSAGEM_CHAVES_ILEGIVEIS);
  if (erro instanceof ItemNaoEncontradoError) {
    return apiError(c, 422, "item_nao_encontrado", MENSAGEM_ITEM_NAO_ENCONTRADO);
  }
  if (erro instanceof NomeDoBancoError) return apiError(c, 422, "nome_do_banco", MENSAGEM_NOME_DO_BANCO);
  if (erro instanceof BancoJaConectadoError) {
    return apiError(c, 409, "banco_ja_conectado", MENSAGEM_BANCO_JA_CONECTADO);
  }
  if (erro instanceof RotuloEmUsoError) return apiError(c, 409, "rotulo_em_uso", MENSAGEM_ROTULO_EM_USO);
  if (erro instanceof LimiteDoPluggyError)
    return apiError(c, 422, "limite_meu_pluggy", MENSAGEM_LIMITE_DO_PLUGGY);
  if (erro instanceof PluggyError) {
    // Chave recusada pelo Pluggy é 422; qualquer outra falha do Pluggy (fora, limite de uso) é 502.
    if (erro.kind === "auth") return apiError(c, 422, "chaves_invalidas", MENSAGEM_CHAVES_RECUSADAS);
    return apiError(c, 502, "pluggy_indisponivel", MENSAGEM_PLUGGY_INDISPONIVEL);
  }
  throw erro;
}

// Chaves do corpo: o formato é conferido antes de qualquer chamada ao Pluggy.
function chavesDoCorpo(
  corpo: Record<string, unknown>,
): { ok: true; chaves: ParDeChaves } | { ok: false; campos: Record<string, string> } {
  const lido = pluggyKeysSchema.safeParse({ clientId: corpo.clientId, clientSecret: corpo.clientSecret });
  if (!lido.success) return { ok: false, campos: camposDe(lido.error) };
  return { ok: true, chaves: lido.data };
}

function contextoDaRota(
  c: Context<AppEnv>,
  householdId: string,
  opcoes: OpcoesDasRotasDoPluggy,
): ContextoDeConexao {
  return {
    db: c.var.db,
    env: c.env,
    householdId,
    fetch: opcoes.fetch,
    agora: opcoes.agora ?? (() => new Date()),
  };
}

export function pluggyConnectionsRoutes(
  resolveSession: SessionResolver,
  opcoes: OpcoesDasRotasDoPluggy = {},
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Lista do lar: uma consulta com junção. Não decifra nada (hasKeys só diz se as cifras existem).
  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    return c.json(await listConnections(c.var.db, householdId), 200);
  });

  // Testa as chaves digitadas, sem gravar nada.
  rotas.post("/test-keys", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const chaves = chavesDoCorpo(corpo);
    if (!chaves.ok) return respondeValidacao(c, chaves.campos);

    const { householdId } = getSession(c);
    try {
      await testarChaves(contextoDaRota(c, householdId, opcoes), chaves.chaves);
    } catch (erro) {
      return respondeDeErro(c, erro);
    }
    return c.json({ ok: true }, 200);
  });

  // Pré-visualização dos bancos: a conexão do lar (com as chaves guardadas) ou as chaves digitadas.
  rotas.post("/preview-items", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const itens = itemIdsSchema.safeParse(corpo.itemIds);
    if (!itens.success)
      return respondeValidacao(c, { itemIds: itens.error.issues[0]?.message ?? "Confira os ids." });

    const { householdId } = getSession(c);
    const ctx = contextoDaRota(c, householdId, opcoes);
    try {
      if (typeof corpo.connectionId === "string" && corpo.connectionId !== "") {
        if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);
        return c.json(await previewItems(ctx, { connectionId: corpo.connectionId }, itens.data), 200);
      }
      const chaves = chavesDoCorpo(corpo);
      if (!chaves.ok) return respondeValidacao(c, chaves.campos);
      return c.json(await previewItems(ctx, { chaves: chaves.chaves }, itens.data), 200);
    } catch (erro) {
      return respondeDeErro(c, erro);
    }
  });

  // Cria a conexão e os bancos escolhidos, num só lote. O servidor refaz a conferência: não confia no navegador.
  rotas.post("/", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);

    const rotulo = connectionLabelSchema.safeParse(corpo.label);
    const chaves = chavesDoCorpo(corpo);
    const itens = z.array(itemDoPedidoSchema).min(1).max(5).safeParse(corpo.items);
    const campos: Record<string, string> = {};
    if (!rotulo.success) campos.label = rotulo.error.issues[0]?.message ?? "Confira o nome.";
    if (!chaves.ok) Object.assign(campos, chaves.campos);
    if (!itens.success) campos.items = itens.error.issues[0]?.message ?? "Escolha de 1 a 5 bancos.";
    if (Object.keys(campos).length > 0) return respondeValidacao(c, campos);
    if (!rotulo.success || !chaves.ok || !itens.success) return respondeDadosInvalidos(c);

    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);
    const { householdId } = getSession(c);
    try {
      const criada = await createConnection(contextoDaRota(c, householdId, opcoes), {
        label: rotulo.data,
        chaves: chaves.chaves,
        items: itens.data,
      });
      return c.json(criada, 201);
    } catch (erro) {
      return respondeDeErro(c, erro);
    }
  });

  // Outro banco da mesma conexão, com as chaves guardadas.
  rotas.post("/:id/bank-items", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const itens = z.array(itemDoPedidoSchema).min(1).max(5).safeParse(corpo.items);
    if (!itens.success)
      return respondeValidacao(c, { items: itens.error.issues[0]?.message ?? "Escolha de 1 a 5 bancos." });
    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);

    const { householdId } = getSession(c);
    try {
      const adicionados = await addBankItems(
        contextoDaRota(c, householdId, opcoes),
        c.req.param("id"),
        itens.data,
      );
      return c.json(adicionados, 201);
    } catch (erro) {
      return respondeDeErro(c, erro);
    }
  });

  // Troca das chaves da conexão: testadas antes de gravar; os bancos com ação necessária voltam a ativo.
  rotas.put("/:id/keys", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const chaves = chavesDoCorpo(corpo);
    if (!chaves.ok) return respondeValidacao(c, chaves.campos);
    if (!chaveMestraValida(c.env.MASTER_KEY)) return respondeChaveMestraAusente(c);

    const { householdId } = getSession(c);
    try {
      await replaceKeys(contextoDaRota(c, householdId, opcoes), c.req.param("id"), chaves.chaves);
    } catch (erro) {
      return respondeDeErro(c, erro);
    }
    return c.json({ ok: true }, 200);
  });

  return rotas;
}
