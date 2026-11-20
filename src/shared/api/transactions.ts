import { z } from "zod";

// Contrato da compra (TASK-0403): GET /api/transactions/:id e o PATCH que grava nome próprio, tipo e ocultar. O
// detalhe volta inteiro nas duas respostas. Sem id de membro: quem categorizou sai como pessoa, regra ou IA.

export const NOME_PROPRIO_MAXIMO = 80;
// Os sete tipos, na ordem da barra (SPEND_TYPE_DEFS). A tela da compra só oferece cinco no cartão.
export const TIPOS_DE_GASTO = [
  "fixos",
  "conforto",
  "educacao",
  "extras",
  "prazeres",
  "metas",
  "investimentos",
] as const;
export const ORIGENS_DO_TIPO = ["escolhido", "regra", "categoria", "padrao"] as const;
export const CONFIANCAS_DA_IA = ["pouca", "média", "alta"] as const;

export const DetalheDaCompraSchema = z.object({
  id: z.string(),
  movement: z.string(),
  localDate: z.string(),
  occurredAt: z.string(),
  amountCents: z.number().int(),
  originalDescription: z.string(),
  customName: z.string().nullable(),
  displayName: z.string(),
  category: z.object({ id: z.string(), name: z.string(), parentName: z.string().nullable() }).nullable(),
  categorizedBy: z.enum(["pessoa", "regra", "ia"]).nullable(),
  aiSuggestion: z
    .object({
      categoryId: z.string(),
      name: z.string(),
      confidence: z.enum(CONFIANCAS_DA_IA).nullable(),
    })
    .nullable(),
  spendType: z.enum(TIPOS_DE_GASTO).nullable(),
  spendTypeSource: z.enum(ORIGENS_DO_TIPO).nullable(),
  hidden: z.boolean(),
  hiddenReason: z.string().nullable(),
  installment: z.object({ number: z.number().int(), total: z.number().int() }).nullable(),
  card: z.object({ id: z.string(), label: z.string(), last4: z.string() }).nullable(),
  account: z.object({ id: z.string(), label: z.string() }).nullable(),
  bill: z.object({ closesOn: z.string(), dueOn: z.string().nullable() }).nullable(),
  cycle: z.object({ key: z.string(), startsOn: z.string(), endsOn: z.string() }).nullable(),
  // Pix enviado e TED (TASK-0404): só nesses movimentos a contraparte vem preenchida; nos outros, null.
  counterparty: z
    .object({
      name: z.string().nullable(),
      docMasked: z.string().nullable(),
      docKind: z.enum(["cpf", "cnpj"]).nullable(),
      bank: z.string().nullable(),
      pixKeyMasked: z.string().nullable(),
    })
    .nullable(),
  // De onde saiu o Pix: a instituição e o rótulo da conexão (o "Saiu de" da tela). Separado de account, que é o da compra.
  origin: z.object({ institution: z.string().nullable(), connectionLabel: z.string().nullable() }).nullable(),
  cardWouldAccept: z.boolean(),
  isCardPayment: z.boolean(),
  canMarkCardPayment: z.boolean(),
});

export type DetalheDaCompra = z.infer<typeof DetalheDaCompraSchema>;

// Corpo do PATCH: ao menos um campo. customName passa pelo trim; mais de 80 caracteres (depois do trim) recusa.
// A rota trata o tamanho antes deste schema, para responder 422 nome_longo; aqui ele também recusa.
export const CorpoDoPatchSchema = z
  .strictObject({
    customName: z
      .string()
      .refine((texto) => texto.trim().length <= NOME_PROPRIO_MAXIMO)
      .nullable()
      .optional(),
    spendType: z.enum(TIPOS_DE_GASTO).optional(),
    hidden: z.boolean().optional(),
    cardWouldAccept: z.boolean().optional(),
  })
  .refine((corpo) => Object.keys(corpo).length > 0);

export type CorpoDoPatch = z.infer<typeof CorpoDoPatchSchema>;

// PUT /api/transactions/:id/card-payment (TASK-0404): liga ou desliga "É pagamento de cartão".
export const CorpoDoCardPaymentSchema = z.strictObject({ isCardPayment: z.boolean() });
export const RespostaDoCardPaymentSchema = z.object({ isCardPayment: z.boolean(), alsoMarked: z.number().int() });
export type RespostaDoCardPayment = z.infer<typeof RespostaDoCardPaymentSchema>;
