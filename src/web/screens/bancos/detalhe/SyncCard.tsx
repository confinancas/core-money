import { useState } from "react";
import { Link } from "react-router";
import { type DetalheDoBancoDto, freshnessPill, runLine } from "../../../../shared/bank-item-view";
import { baixarAgora } from "../../../api/bank-items";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { StatusPill } from "../../../components/ui/status-pill";
import { mensagemDoErro } from "../../../lib/api";
import { horaDaUltimaComSucesso } from "./texto";

// Atualização (TASK-0206): a última com sucesso e a pílula "Em dia" / "Atrasada". Sem botão no uso normal. Só com uma
// falha: a mensagem do erro e, quando repetir resolve, "Baixar agora". Trocar chaves aparece nos erros de chave.
export function SyncCard({
  banco,
  hoje,
  aoMudar,
}: {
  banco: DetalheDoBancoDto;
  hoje: string;
  aoMudar: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const pilula = freshnessPill(banco.lastSyncAt, hoje);
  const ultimaFalha = banco.runs.find((execucao) => execucao.finishedAt !== null) ?? null;
  const linhaDaFalha = ultimaFalha !== null && banco.failed ? runLine(ultimaFalha) : null;
  const precisaDeChaves =
    ultimaFalha !== null &&
    (ultimaFalha.errorCode === "chaves_invalidas" || ultimaFalha.errorCode === "sem_chaves");
  const execucaoAberta = banco.runs.find((execucao) => execucao.finishedAt === null) ?? null;

  async function baixar() {
    setEnviando(true);
    setTentou(true);
    setAviso(null);
    try {
      await baixarAgora(banco.id);
      aoMudar();
    } catch (erro) {
      setAviso(mensagemDoErro(erro));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-extrabold text-ink">Atualização</h2>
        <StatusPill tone={pilula.tom === "sucesso" ? "sucesso" : "aviso"}>{pilula.texto}</StatusPill>
      </div>
      <p className="text-[14px] text-ink">{horaDaUltimaComSucesso(banco.lastSyncAt)}</p>

      {execucaoAberta !== null && (
        <p className="text-[14px] font-semibold text-ink-2">Baixando… {execucaoAberta.progressPct}%</p>
      )}

      {linhaDaFalha !== null && execucaoAberta === null && (
        <div className="flex flex-col gap-2 rounded-field bg-warn-bg px-3.5 py-3">
          <p className="text-[14px] font-semibold text-warn">{linhaDaFalha.texto}</p>
          {tentou && !banco.running && (
            <p className="text-[13px] text-ink-2">Não deu de novo. O app tenta sozinho à meia-noite.</p>
          )}
        </div>
      )}

      {aviso !== null && (
        <p role="status" className="text-[13px] font-semibold text-danger">
          {aviso}
        </p>
      )}

      {banco.canRetry && execucaoAberta === null && (
        <Button variant="secondary" full loading={enviando} onClick={() => void baixar()}>
          Baixar agora
        </Button>
      )}

      {precisaDeChaves && (
        <Link
          to={`/configuracoes/bancos/conectar?conexao=${encodeURIComponent(banco.connection.id)}&trocar=chaves`}
          className="inline-flex min-h-[44px] items-center text-[14px] font-bold text-primary underline-offset-2 hover:underline"
        >
          Trocar chaves
        </Link>
      )}
    </Card>
  );
}
