// Bancos com nome e cor na interface. Código COMPE (3 dígitos) e ISPB (8 dígitos) são dados públicos do Banco Central.
// As cores são de referência para a interface (a revisar na TASK-0203); os ISPB foram conferidos só de memória e
// precisam de conferência na lista pública do BCB antes de produção.

export type BankInfo = {
  compe: string;
  ispb: string;
  name: string;
  color: string;
  // Textos (sem acento, minúsculos) que identificam o banco num texto livre.
  aliases: readonly string[];
};

export const BANKS: readonly BankInfo[] = [
  { compe: "001", ispb: "00000000", name: "Banco do Brasil", color: "#FFCC00", aliases: ["banco do brasil"] },
  { compe: "033", ispb: "90400888", name: "Santander", color: "#EC0000", aliases: ["santander"] },
  { compe: "077", ispb: "00416968", name: "Inter", color: "#FF7A00", aliases: ["banco inter", "inter"] },
  {
    compe: "104",
    ispb: "00360305",
    name: "Caixa",
    color: "#005CA9",
    aliases: ["caixa economica federal", "caixa economica"],
  },
  { compe: "237", ispb: "60746948", name: "Bradesco", color: "#CC092F", aliases: ["bradesco"] },
  { compe: "260", ispb: "18236120", name: "Nubank", color: "#820AD1", aliases: ["nubank", "nu pagamentos"] },
  { compe: "323", ispb: "10573521", name: "Mercado Pago", color: "#009EE3", aliases: ["mercado pago"] },
  { compe: "336", ispb: "31872495", name: "C6 Bank", color: "#242424", aliases: ["c6 bank", "c6"] },
  { compe: "341", ispb: "60701190", name: "Itaú", color: "#EC7000", aliases: ["itau"] },
  { compe: "380", ispb: "22896431", name: "PicPay", color: "#21C25E", aliases: ["picpay"] },
];

// Nome do banco pelo código COMPE ou pelo ISPB. Código desconhecido vira "Banco <código>"; sem código, null.
export function bankNameFromCode(compe?: string | null, ispb?: string | null): string | null {
  const codigoCompe = normalizaCodigo(compe, 3);
  const codigoIspb = normalizaCodigo(ispb, 8);
  const porCompe = codigoCompe ? BANKS.find((banco) => banco.compe === codigoCompe) : undefined;
  if (porCompe) return porCompe.name;
  const porIspb = codigoIspb ? BANKS.find((banco) => banco.ispb === codigoIspb) : undefined;
  if (porIspb) return porIspb.name;
  if (codigoCompe) return `Banco ${codigoCompe}`;
  if (codigoIspb) return `Banco ${codigoIspb}`;
  return null;
}

// Acha o banco num texto livre (ex.: o nome de uma conexão). Palavra inteira, sem acento e sem maiúsculas.
export function institutionFromText(texto: string): BankInfo | null {
  const normalizado = texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  for (const banco of BANKS) {
    for (const apelido of banco.aliases) {
      if (new RegExp(`\\b${apelido}\\b`).test(normalizado)) return banco;
    }
  }
  return null;
}

function normalizaCodigo(valor: string | null | undefined, largura: number): string {
  const numero = (valor ?? "").replace(/\D/g, "");
  return numero === "" ? "" : numero.padStart(largura, "0");
}
