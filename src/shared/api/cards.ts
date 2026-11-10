import { z } from "zod";

// Contrato das rotas de cartões (TASK-0402): GET /api/cards e GET /api/cards/:cardId. O servidor monta as respostas
// com estes formatos; a web e os testes de integração as leem com eles. Valores em centavos; datas AAAA-MM-DD.

const Centavos = z.number().int();
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ChaveDeCiclo = z.string().regex(/^\d{4}-\d{2}$/);

export const ItemDeParcelaSchema = z.object({
  name: z.string(),
  installment: z.number().int(),
  of: z.number().int(),
});

// Selo do cartão: fatura fechada a pagar (vence), ou a última paga (paga, no ciclo dela).
export const SeloSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("vence"), dueOn: Data }),
    z.object({ kind: z.literal("paga"), cycleKey: ChaveDeCiclo }),
  ])
  .nullable();

// A fatura que o cartão mostra no topo: a aberta, ou a fechada a pagar (e aí openTotalCents traz a nova aberta).
export const FaturaAtualSchema = z
  .object({
    state: z.enum(["aberta", "fechada"]),
    billId: z.string(),
    cycleKey: ChaveDeCiclo,
    closesOn: Data,
    dueOn: Data.nullable(),
    totalCents: Centavos,
  })
  .nullable();

const CartaoResumoSchema = z.object({
  id: z.string(),
  label: z.string(),
  bankName: z.string(),
  last4: z.string(),
  color: z.string(),
  limitCents: Centavos.nullable(),
  availableCents: Centavos.nullable(),
  badge: SeloSchema,
  current: FaturaAtualSchema,
  openTotalCents: Centavos.nullable(),
});

export const CompraDaListaSchema = z.object({
  id: z.string(),
  name: z.string(),
  localDate: Data,
  cardLabel: z.string().optional(),
  categoryName: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  amountCents: Centavos,
  movement: z.enum(["compra", "estorno"]),
  hidden: z.boolean(),
  uncategorized: z.boolean(),
});

export const RespostaDeCartoesSchema = z.object({
  openBillsCents: Centavos,
  futureInstallmentsCents: Centavos,
  cards: z.array(CartaoResumoSchema),
  recent: z.array(CompraDaListaSchema),
});

const FaturaDaSerieSchema = z.object({
  billId: z.string().nullable(),
  cycleKey: ChaveDeCiclo,
  closesOn: Data,
  dueOn: Data.nullable(),
  status: z.enum(["aberta", "fechada", "paga", "futura"]),
  paidOn: Data.nullable(),
  totalCents: Centavos,
  futureItems: z.array(ItemDeParcelaSchema),
});

export const RespostaDeCartaoSchema = z.object({
  card: z.object({
    id: z.string(),
    label: z.string(),
    bankName: z.string(),
    last4: z.string(),
    color: z.string(),
    limitCents: Centavos.nullable(),
    availableCents: Centavos.nullable(),
    bestDayOn: Data.nullable(),
  }),
  badge: SeloSchema,
  open: z
    .object({
      billId: z.string(),
      cycleKey: ChaveDeCiclo,
      closesOn: Data,
      dueOn: Data.nullable(),
      totalCents: Centavos,
    })
    .nullable(),
  futureInstallmentsCents: Centavos,
  avg6Cents: Centavos,
  avgMonths: z.number().int(),
  bills: z.array(FaturaDaSerieSchema),
  openItems: z.array(CompraDaListaSchema.omit({ cardLabel: true })),
  openCount: z.number().int(),
  openHiddenCount: z.number().int(),
});

export type RespostaDeCartoes = z.infer<typeof RespostaDeCartoesSchema>;
export type RespostaDeCartao = z.infer<typeof RespostaDeCartaoSchema>;
export type CartaoResumo = RespostaDeCartoes["cards"][number];
export type CompraDaLista = z.infer<typeof CompraDaListaSchema>;
export type FaturaDaSerie = RespostaDeCartao["bills"][number];
export type Selo = z.infer<typeof SeloSchema>;
export type FaturaAtual = z.infer<typeof FaturaAtualSchema>;
