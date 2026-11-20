import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { Card } from "../../components/ui/card";

// Dados de quem recebeu (TASK-0404). Cada linha some quando o dado é nulo; "Documento" quando não há o tipo.
export function CounterpartyRows({ detalhe }: { detalhe: DetalheDaCompra }) {
  const c = detalhe.counterparty;
  if (c === null) return null;
  const linhas: { rotulo: string; valor: string }[] = [];
  if (c.name !== null) linhas.push({ rotulo: "Para", valor: c.name });
  if (c.docMasked !== null) {
    const rotuloDoc = c.docKind === "cnpj" ? "CNPJ" : c.docKind === "cpf" ? "CPF" : "Documento";
    linhas.push({ rotulo: rotuloDoc, valor: c.docMasked });
  }
  if (c.bank !== null) linhas.push({ rotulo: "Banco de quem recebeu", valor: c.bank });
  if (c.pixKeyMasked !== null) linhas.push({ rotulo: "Chave Pix", valor: c.pixKeyMasked });
  if (detalhe.origin !== null && detalhe.origin.institution !== null) {
    const conexao = detalhe.origin.connectionLabel;
    linhas.push({
      rotulo: "Saiu de",
      valor: conexao ? `${detalhe.origin.institution} · ${conexao}` : detalhe.origin.institution,
    });
  }
  if (linhas.length === 0) return null;

  return (
    <Card className="flex flex-col px-[22px] py-1">
      {linhas.map((linha) => (
        <div
          key={linha.rotulo}
          className="flex min-h-11 items-center justify-between gap-3 border-divider border-b py-2 last:border-b-0"
        >
          <span className="text-[13px] text-ink-2">{linha.rotulo}</span>
          <span className="text-right text-[13px] font-semibold text-ink">{linha.valor}</span>
        </div>
      ))}
    </Card>
  );
}
