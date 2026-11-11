// Contrato das rotas de contas do Meu Pluggy (TASK-0203): /api/pluggy-connections. Só o que sai do servidor para o
// app e as regras de formato que o servidor e a tela usam. Nenhuma resposta leva Client ID, Client Secret nem apiKey.
import { z } from "zod";

export const MENSAGEM_ROTULO_PROIBIDO = "Use o nome de quem é a conta, para aparecer igual para os dois.";
const ROTULOS_PROIBIDOS = ["sua conta", "minha conta", "conta"];
export const MENSAGEM_ROTULO_VAZIO = "Dê um nome para a conexão.";
export const MENSAGEM_ROTULO_LONGO = "O nome tem até 40 caracteres.";

// Nome da conexão: 1 a 40 caracteres depois do trim, sem os nomes genéricos (sem diferenciar maiúsculas).
export const connectionLabelSchema = z
  .string({ error: MENSAGEM_ROTULO_VAZIO })
  .trim()
  .min(1, MENSAGEM_ROTULO_VAZIO)
  .max(40, MENSAGEM_ROTULO_LONGO)
  .refine((rotulo) => !ROTULOS_PROIBIDOS.includes(rotulo.toLowerCase()), MENSAGEM_ROTULO_PROIBIDO);

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const MENSAGEM_CLIENT_ID =
  "Confira o Client ID: ele tem o formato de um código com letras, números e traços.";
export const MENSAGEM_CLIENT_SECRET = "O Client Secret tem de 8 a 200 caracteres, sem espaços.";

// Chaves do Meu Pluggy: Client ID é um UUID; Client Secret de 8 a 200 caracteres, sem espaço.
export const pluggyKeysSchema = z.object({
  clientId: z.string({ error: MENSAGEM_CLIENT_ID }).trim().regex(UUID, MENSAGEM_CLIENT_ID),
  clientSecret: z
    .string({ error: MENSAGEM_CLIENT_SECRET })
    .min(8, MENSAGEM_CLIENT_SECRET)
    .max(200, MENSAGEM_CLIENT_SECRET)
    .regex(/^\S+$/, MENSAGEM_CLIENT_SECRET),
});

// Id de item do Meu Pluggy: o id copiado do dashboard (um UUID). Até 5 por pedido.
export const MENSAGEM_ID_DO_BANCO = "Confira o id do banco: ele é um código com letras, números e traços.";
export const itemIdSchema = z
  .string({ error: MENSAGEM_ID_DO_BANCO })
  .trim()
  .regex(/^[0-9A-Za-z-]{1,100}$/, MENSAGEM_ID_DO_BANCO);

export const MAXIMO_DE_BANCOS_POR_PEDIDO = 5;
export const MAXIMO_DE_BANCOS_ATIVOS = 5;

export const itemDoPedidoSchema = z.object({
  itemId: itemIdSchema,
  institutionName: z.string().trim().min(1).max(60).optional(),
});

export type ItemDoPedido = z.infer<typeof itemDoPedidoSchema>;

export const itemIdsSchema = z.array(itemIdSchema).min(1).max(MAXIMO_DE_BANCOS_POR_PEDIDO);

export type StatusDoBancoDto = "ativo" | "instavel" | "acao_necessaria";

export type BankItemDto = {
  id: string;
  institutionName: string;
  institutionColor: string | null;
  consentExpiresAt: string | null;
  status: StatusDoBancoDto;
  disconnectedAt: string | null;
  lastSyncAt: string | null;
};

export type ConnectionDto = {
  id: string;
  label: string;
  cpfMasked: string | null;
  hasKeys: boolean;
  bankItems: BankItemDto[];
};

export type ConnectionsResponse = { connections: ConnectionDto[] };

export type ItemPreview =
  | {
      itemId: string;
      institutionName: string | null;
      institutionColor: string;
      summary: string;
      consentExpiresAt: string | null;
      alreadyConnected: boolean;
    }
  | { itemId: string; error: "nao_encontrado" };

export type PreviewItemsResponse = { items: ItemPreview[] };

export type CreatedConnectionResponse = {
  connection: { id: string; label: string; cpfMasked: string | null };
  bankItems: { id: string; institutionName: string }[];
};

// Mensagens da API (sem o nome da marca: o teste brand-literals confere src/worker).
export const MENSAGEM_CHAVES_RECUSADAS =
  "O Meu Pluggy recusou estas chaves. Confira o Client ID e o Client Secret.";
export const MENSAGEM_PLUGGY_INDISPONIVEL = "O Meu Pluggy não respondeu. Tente de novo em instantes.";
export const MENSAGEM_ITEM_NAO_ENCONTRADO =
  "Não achamos este id no Meu Pluggy. Confira se copiou o id inteiro.";
// Sem o nome da marca na API (o teste brand-literals confere): a tela põe o nome do app na frase.
export const MENSAGEM_BANCO_JA_CONECTADO = "Este banco já está conectado.";
export const MENSAGEM_ROTULO_EM_USO = "Já existe uma conexão com este nome.";
export const MENSAGEM_NOME_DO_BANCO = "Diga qual é o banco.";
export const MENSAGEM_LIMITE_DO_PLUGGY = "O Meu Pluggy gratuito aceita até 5 bancos por conta.";
export const MENSAGEM_SEM_CHAVES = "Cole as chaves desta conta antes de autorizar outro banco.";
export const MENSAGEM_CHAVES_ILEGIVEIS = "As chaves desta conta não abrem nesta instalação. Cole de novo.";
export const MENSAGEM_CONEXAO_NAO_ENCONTRADA = "Esta conta não existe mais.";
