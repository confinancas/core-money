import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { bankStatusPill, type DetalheDoBancoDto } from "../../../shared/bank-item-view";
import { todayInSaoPaulo } from "../../../shared/sao-paulo-date";
import { buscarBanco, conectarDeNovo, desconectarBanco } from "../../api/bank-items";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useConfirm } from "../../components/ui/confirm-dialog";
import { ErrorState } from "../../components/ui/error-state";
import { GreenTop } from "../../components/ui/green-top";
import { SkeletonCard } from "../../components/ui/skeleton";
import { ApiError, mensagemDoErro } from "../../lib/api";
import { ConsentCard } from "./detalhe/ConsentCard";
import { ItemsList } from "./detalhe/ItemsList";
import { PermissionsCard } from "./detalhe/PermissionsCard";
import { RunsList } from "./detalhe/RunsList";
import { SyncCard } from "./detalhe/SyncCard";
import { diaEMes } from "./detalhe/texto";

// Banco conectado (TASK-0206): /configuracoes/bancos/:bankItemId. Genérico para qualquer banco. Enquanto uma atualização
// está em andamento, a tela consulta o detalhe a cada 5 s. Desconectar pede confirmação dentro do app.
const INTERVALO_DE_ATUALIZACAO_MS = 5000;

export function BancoDetalhe() {
  const { bankItemId = "" } = useParams();
  const confirmar = useConfirm();
  const [banco, setBanco] = useState<DetalheDoBancoDto | null>(null);
  const [falhou, setFalhou] = useState<"naoEncontrado" | "erro" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setBanco(await buscarBanco(bankItemId));
      setFalhou(null);
    } catch (erro) {
      setFalhou(erro instanceof ApiError && erro.status === 404 ? "naoEncontrado" : "erro");
    }
  }, [bankItemId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Com uma atualização em andamento, a tela acompanha o percentual.
  const rodando = banco?.running === true;
  useEffect(() => {
    if (!rodando) return;
    const id = window.setInterval(() => void carregar(), INTERVALO_DE_ATUALIZACAO_MS);
    return () => window.clearInterval(id);
  }, [rodando, carregar]);

  const hoje = todayInSaoPaulo(new Date());

  if (falhou === "naoEncontrado") {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <GreenTop
          variant="detail"
          title="Banco não encontrado"
          back={{ to: "/configuracoes", label: "Voltar" }}
        />
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          <Card className="flex flex-col gap-3">
            <p className="text-[15px] text-ink">Este banco não está mais nas suas contas.</p>
            <Link
              to="/configuracoes"
              className="inline-flex min-h-[44px] items-center font-bold text-primary"
            >
              Voltar para Configurações
            </Link>
          </Card>
        </div>
      </section>
    );
  }

  if (banco === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <GreenTop variant="detail" title="Banco conectado" back={{ to: "/configuracoes", label: "Voltar" }} />
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          {falhou === "erro" ? <ErrorState onRetry={() => void carregar()} /> : <SkeletonCard />}
        </div>
      </section>
    );
  }

  const desconectado = banco.disconnectedAt !== null;
  const diaDaDesconexao =
    banco.disconnectedAt !== null ? todayInSaoPaulo(new Date(banco.disconnectedAt)) : hoje;
  const pilula = bankStatusPill(banco);
  const contas = banco.accounts.length + banco.cards.length;

  async function desconectar() {
    const confirmado = await confirmar({
      title: `Desconectar o ${banco?.institutionName ?? "banco"}?`,
      description: "O histórico continua no app. Para voltar a receber, conecte de novo.",
      confirmLabel: "Desconectar",
      tone: "danger",
    });
    if (!confirmado) return;
    setEnviando(true);
    setAviso(null);
    try {
      await desconectarBanco(bankItemId);
      await carregar();
    } catch (erro) {
      setAviso(mensagemDoErro(erro));
    } finally {
      setEnviando(false);
    }
  }

  async function conectarOutraVez() {
    setEnviando(true);
    setAviso(null);
    try {
      await conectarDeNovo(bankItemId);
      await carregar();
    } catch (erro) {
      setAviso(mensagemDoErro(erro));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title={banco.institutionName}
        subtitle={`${banco.connection.label} · via Meu Pluggy`}
        back={{ to: "/configuracoes", label: "Voltar para Configurações" }}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-white">
          <span
            className={
              pilula.tom === "aviso"
                ? "inline-flex items-center rounded-full bg-warn-bg px-2.5 py-[3px] text-[12px] font-extrabold text-warn"
                : pilula.tom === "neutro"
                  ? "inline-flex items-center rounded-full bg-white/22 px-2.5 py-[3px] text-[12px] font-extrabold text-white"
                  : "inline-flex items-center rounded-full bg-success-bg px-2.5 py-[3px] text-[12px] font-extrabold text-success-ink"
            }
          >
            {pilula.texto}
          </span>
          <span className="text-[13px] font-semibold text-white/90">{contas} contas e cartões</span>
        </div>
      </GreenTop>

      <div className="mx-auto grid w-full max-w-[1120px] gap-4 px-4 pt-6 tablet:grid-cols-2 tablet:px-6">
        <div className="flex min-w-0 flex-col gap-4">
          {desconectado ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-[17px] font-extrabold text-ink">
                Desconectado em {diaEMes(diaDaDesconexao)} · histórico mantido
              </h2>
              <Button variant="secondary" full loading={enviando} onClick={() => void conectarOutraVez()}>
                Conectar de novo
              </Button>
            </Card>
          ) : (
            <>
              <ConsentCard banco={banco} hoje={hoje} aoMudar={() => void carregar()} />
              <SyncCard banco={banco} hoje={hoje} aoMudar={() => void carregar()} />
            </>
          )}
          <PermissionsCard />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ItemsList contas={banco.accounts} cartoes={banco.cards} />
          <RunsList execucoes={banco.runs} agora={new Date()} />

          {!desconectado && (
            <Card className="flex flex-col gap-3">
              <button
                type="button"
                disabled={enviando}
                onClick={() => void desconectar()}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border-[1.5px] border-danger bg-transparent text-[14px] font-extrabold text-danger disabled:opacity-60"
              >
                Desconectar {banco.institutionName}
              </button>
              <p className="text-[13px] text-ink-2">
                O histórico que já está no app continua. Só para de chegar coisa nova deste banco.
              </p>
            </Card>
          )}
          {aviso !== null && (
            <p role="status" className="text-[13px] font-semibold text-danger">
              {aviso}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
