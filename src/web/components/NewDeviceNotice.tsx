import { useState } from "react";
import { useNavigate } from "react-router";
import { diaEHoraDoAviso } from "../devices/datas";
import { apiEnviar, mensagemDoErro } from "../lib/api";
import { useSessionNotices } from "../session/SessionProvider";

// Faixa de aviso de aparelho novo (TASK-0106), no topo do conteúdo das molduras tab, detail e full. Só aparece para
// a pessoa dona do aparelho antigo, enquanto a sessão não marcou "Foi eu". Cores de Aviso (#C27400 sobre #FFF5E4).
export function NewDeviceNotice() {
  const { avisos, marcaVistos } = useSessionNotices();
  const navegar = useNavigate();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const aviso = avisos[0];
  if (!aviso) return null;

  // Marca o aviso como visto nesta sessão. Se a API falhar, a faixa fica e a pessoa tenta de novo.
  async function marcaVisto(destino?: string) {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await apiEnviar<{ ok: true }>("/api/auth/notices/seen", "POST", {});
      marcaVistos();
      if (destino) navegar(destino);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  const { dia, hora } = diaEHoraDoAviso(aviso.createdAt);
  return (
    <section
      aria-label="Aviso de aparelho novo"
      className="mx-auto mt-4 flex w-full max-w-[720px] flex-col gap-3 rounded-card bg-[#FFF5E4] px-4 py-3.5 text-[14px] leading-normal text-[#C27400]"
    >
      <p>
        Um aparelho novo ({aviso.deviceName}) entrou na sua conta em {dia} às {hora}, por um link de
        recuperação. Foi você?
      </p>
      <div className="flex flex-wrap gap-4 text-[13px] font-extrabold uppercase tracking-[1px]">
        <button
          type="button"
          disabled={enviando}
          onClick={() => void marcaVisto()}
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 disabled:opacity-50"
        >
          Foi eu
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={() => void marcaVisto("/configuracoes/casal")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 disabled:opacity-50"
        >
          Ver aparelhos
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-[13px]">
          {erro}
        </p>
      )}
    </section>
  );
}
