// Valores monetários em centavos inteiros. A formatação fica só na interface.

export type Sinal = "auto" | "always" | "none";

export type PartesDoValor = { sign: "" | "+" | "−"; int: string; cents: string };

// auto: sinal só no negativo. always: "+" no positivo e "−" no negativo. none: valor absoluto. Zero nunca tem sinal.
export function splitMoney(cents: number, sign: Sinal = "auto"): PartesDoValor {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError("valor em centavos precisa ser inteiro");
  }
  const absoluto = BigInt(Math.abs(cents));
  const inteiro = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = (absoluto % 100n).toString().padStart(2, "0");

  let simbolo: PartesDoValor["sign"] = "";
  if (sign !== "none" && cents < 0) simbolo = "−";
  if (sign === "always" && cents > 0) simbolo = "+";

  return { sign: simbolo, int: inteiro, cents: centavos };
}

export function formatMoney(cents: number, sign?: Sinal): string {
  const partes = splitMoney(cents, sign);
  return `${partes.sign}${partes.int},${partes.cents}`;
}
