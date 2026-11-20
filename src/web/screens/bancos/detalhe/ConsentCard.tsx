import { useEffect, useRef, useState } from "react";
import { consentView, type DetalheDoBancoDto } from "../../../../shared/bank-item-view";
import { conferirConsentimento } from "../../../api/bank-items";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { mensagemDoErro } from "../../../lib/api";

// Portal do Meu Pluggy onde a autorização se renova (TASK-0206). O link abre em outra aba.
export const LINK_DO_MEU_PLUGGY = "https://dashboard.pluggy.ai";

// Consentimento: título, texto, barra e "Renovar". A renovação acontece no Meu Pluggy; o app confere quando a pessoa
// volta para a aba (uma vez sozinho) ou quando toca "Já renovei · conferir".
export function ConsentCard({
  banco,
  hoje,
  aoMudar,
}: {
  banco: DetalheDoBancoDto;
  hoje: string;
  aoMudar: () => void;
}) {
  const visao = consentView(banco.consentExpiresAt, hoje, banco.institutionName);
  const [renovando, setRenovando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const conferiuAoVoltar = useRef(false);

  // Conferência automática: só depois de abrir a renovação, e só uma vez por abertura. O ouvinte chama a conferência
  // mais recente pela referência, para não se prender ao render em que foi montado.
  const conferirRef = useRef<() => Promise<void>>(async () => undefined);
  conferirRef.current = conferir;
  useEffect(() => {
    if (!renovando) return;
    const aoVoltar = () => {
      if (document.visibilityState !== "visible" || conferiuAoVoltar.current) return;
      conferiuAoVoltar.current = true;
      void conferirRef.current();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [renovando]);

  async function conferir() {
    setEnviando(true);
    setAviso(null);
    try {
      const resposta = await conferirConsentimento(banco.id);
      if (resposta.itemMissing) {
        setAviso(
          "O Meu Pluggy não acha mais este banco. Conecte de novo pelo Meu Pluggy para voltar a receber.",
        );
      } else if (resposta.renewed && resposta.consentExpiresAt !== null) {
        const data = resposta.consentExpiresAt.slice(0, 10);
        setAviso(`Renovado até ${data.slice(5, 7)}/${data.slice(0, 4)}.`);
        setRenovando(false);
      } else {
        setAviso("Ainda não vimos a renovação. Pode levar alguns minutos no Meu Pluggy.");
      }
      aoMudar();
    } catch (erro) {
      setAviso(mensagemDoErro(erro));
    } finally {
      setEnviando(false);
    }
  }

  const corDoTitulo =
    visao.tom === "aviso" ? "text-warn" : visao.tom === "sucesso" ? "text-success-ink" : "text-ink";
  const corDaBarra = visao.tom === "aviso" ? "bg-warn" : "bg-primary";

  return (
    <Card className="flex flex-col gap-3">
      <h2 className={`text-[17px] font-extrabold ${corDoTitulo}`}>
        {renovando ? "Renovação aberta no Meu Pluggy" : visao.titulo}
      </h2>
      <p className="text-[14px] leading-normal text-ink-2">
        {renovando ? "Autorize de novo no Meu Pluggy. Quando voltar, o app confere sozinho." : visao.texto}
      </p>
      <div
        role="progressbar"
        aria-label="Validade do consentimento"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(visao.barraPct)}
        className="h-2 overflow-hidden rounded-full bg-field-border"
      >
        <div className={`h-full rounded-full ${corDaBarra}`} style={{ width: `${visao.barraPct}%` }} />
      </div>
      {visao.linhaDeBaixo !== null && <p className="text-[13px] text-ink-2">{visao.linhaDeBaixo}</p>}

      {aviso !== null && (
        <p
          role="status"
          className="rounded-field bg-primary-soft px-3.5 py-3 text-[13px] font-semibold text-ink"
        >
          {aviso}
        </p>
      )}

      {renovando ? (
        <Button variant="secondary" full loading={enviando} onClick={() => void conferir()}>
          Já renovei · conferir
        </Button>
      ) : (
        <a
          href={LINK_DO_MEU_PLUGGY}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            conferiuAoVoltar.current = false;
            setRenovando(true);
          }}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-primary text-[13px] font-extrabold uppercase tracking-[1.2px] text-white shadow-primary"
        >
          Renovar por mais 12 meses
        </a>
      )}
    </Card>
  );
}
