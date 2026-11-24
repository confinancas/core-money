import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { Card } from "../../components/ui/card";
import { textoDoCiclo } from "./view-model";

// Dados de quem recebeu e do banco (TASK-0404). Cada linha some quando o dado é nulo; "Documento" quando não há o tipo.
// "Descrição do banco" fica embaixo, com o valor em negrito e sem alinhar à direita.
export function CounterpartyRows({ detalhe }: { detalhe: DetalheDaCompra }) {
  const c = detalhe.counterparty;
  const linhas: { rotulo: string; valor: string }[] = [];
  if (c?.name) linhas.push({ rotulo: "Para", valor: c.name });
  if (c?.docMasked) {
    const rotuloDoc = c.docKind === "cnpj" ? "CNPJ" : c.docKind === "cpf" ? "CPF" : "Documento";
    linhas.push({ rotulo: rotuloDoc, valor: c.docMasked });
  }
  if (c?.bank) linhas.push({ rotulo: "Banco de quem recebeu", valor: c.bank });
  if (c?.pixKeyMasked) linhas.push({ rotulo: "Chave Pix", valor: c.pixKeyMasked });
  if (detalhe.origin !== null && detalhe.origin.institution !== null) {
    const conexao = detalhe.origin.connectionLabel;
    linhas.push({
      rotulo: "Saiu de",
      valor: conexao ? `${detalhe.origin.institution} · ${conexao}` : detalhe.origin.institution,
    });
  }
  if (detalhe.cycle !== null) linhas.push({ rotulo: "Conta no ciclo", valor: textoDoCiclo(detalhe.cycle) });
  const descricao = detalhe.originalDescription.trim() !== "" ? detalhe.originalDescription : null;
  if (linhas.length === 0 && descricao === null) return null;

  return (
    <Card className="flex flex-col px-[22px] py-1">
      {linhas.map((linha) => (
        <div
          key={linha.rotulo}
          className="flex min-h-11 items-center justify-between gap-3 border-divider border-b py-2 last:border-b-0"
        >
          <span className="shrink-0 whitespace-nowrap text-[13px] text-ink-2">{linha.rotulo}</span>
          <span className="text-right text-[13px] font-semibold text-ink">{linha.valor}</span>
        </div>
      ))}
      {descricao !== null && (
        <div className="flex min-h-11 flex-col gap-0.5 py-2">
          <span className="text-[13px] text-ink-2">Descrição do banco</span>
          <span className="break-words text-[13px] font-bold text-ink">{descricao}</span>
        </div>
      )}
    </Card>
  );
}
