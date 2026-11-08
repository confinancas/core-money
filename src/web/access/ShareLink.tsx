import * as QRCode from "qrcode";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  link: string;
  shareTitle: string;
  shareText: string;
  // Frase do pé: quem o link é para (o convite diz "como cônjuge"; a recuperação diz o nome da pessoa).
  dica: string;
  // Para que serve o link: os rótulos de acessibilidade acompanham o uso (convite ou recuperação). Padrão: convite.
  uso?: "convite" | "recuperacao";
};

// Copiar, compartilhar pelo sistema (só quando o aparelho oferece) e o QR code do link (TASK-0105; reusado pela 0106).
// O link não sai da tela por outro caminho: quem o gera é quem mostra.
export function ShareLink({ link, shareTitle, shareText, dica, uso = "convite" }: Props) {
  const rotulos =
    uso === "recuperacao"
      ? {
          secao: "Compartilhar o link de recuperação",
          campo: "Link de recuperação",
          qr: "QR code do link de recuperação",
        }
      : { secao: "Compartilhar o convite", campo: "Link do convite", qr: "QR code do link do convite" };
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostraQr, setMostraQr] = useState(false);
  const [copiaFalhou, setCopiaFalhou] = useState(false);
  const podeCompartilhar = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiaFalhou(false);
      setAviso("Link copiado.");
    } catch {
      setCopiaFalhou(true);
      setAviso("Não deu para copiar. Selecione o link abaixo e copie.");
    }
  }

  async function compartilhar() {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: link });
    } catch {
      // O usuário fechou a folha do sistema: nada a mostrar.
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-field p-4" aria-label={rotulos.secao}>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" full onClick={copiar}>
          Copiar link
        </Button>
        {podeCompartilhar && (
          <Button variant="secondary" full onClick={compartilhar}>
            Compartilhar
          </Button>
        )}
        <Button variant="secondary" full onClick={() => setMostraQr((atual) => !atual)}>
          {mostraQr ? "Ocultar QR code" : "Mostrar QR code"}
        </Button>
      </div>

      {aviso && (
        <p role="status" className="text-[13px] text-ink-2">
          {aviso}
        </p>
      )}
      {copiaFalhou && (
        <input
          readOnly
          aria-label={rotulos.campo}
          value={link}
          onFocus={(evento) => evento.currentTarget.select()}
          className="h-[52px] rounded-field border border-field-border bg-card px-4 text-[14px] text-ink"
        />
      )}
      {mostraQr && <QrDoLink texto={link} rotulo={rotulos.qr} />}

      <p className="text-[12px] leading-normal text-ink-2">{dica}</p>
    </section>
  );
}

// O QR code desenhado em SVG a partir da matriz de módulos do qrcode (sem HTML vindo de fora).
function QrDoLink({ texto, rotulo }: { texto: string; rotulo: string }) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  const margem = 2;
  const quadrados: string[] = [];
  for (let linha = 0; linha < size; linha++) {
    for (let coluna = 0; coluna < size; coluna++) {
      if (data[linha * size + coluna] === 1) quadrados.push(`M${coluna + margem} ${linha + margem}h1v1h-1z`);
    }
  }
  const lado = size + margem * 2;
  return (
    <svg
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      className="mx-auto w-[220px] max-w-full rounded-card bg-white p-2"
    >
      <rect width={lado} height={lado} fill="#fff" />
      <path d={quadrados.join("")} fill="#000" />
    </svg>
  );
}
