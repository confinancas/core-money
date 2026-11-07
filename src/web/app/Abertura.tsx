import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { ErrorState } from "@/components/ui/error-state";
import { brand } from "../../shared/brand";
import { ApiError } from "../lib/api";
import { resolveStartRoute } from "./bootstrap";

// Abertura (/): marca, verificações da partida e, depois, a rota de início. Sem espera artificial.
export function Abertura() {
  const navegar = useNavigate();
  const [falha, setFalha] = useState<ApiError | null>(null);
  // Cada partida tem um número: só a última ainda vale (a que ficou para trás não navega nem mostra erro).
  const partida = useRef(0);

  const iniciar = useCallback(() => {
    const esta = ++partida.current;
    resolveStartRoute().then(
      (rota) => {
        if (esta === partida.current) navegar(rota, { replace: true });
      },
      (erro: unknown) => {
        if (esta !== partida.current) return;
        setFalha(
          erro instanceof ApiError ? erro : new ApiError(0, "erro_http", "Algo deu errado. Tente de novo."),
        );
      },
    );
  }, [navegar]);

  useEffect(() => {
    iniciar();
    return () => {
      partida.current++;
    };
  }, [iniciar]);

  function tentarDeNovo() {
    setFalha(null);
    iniciar();
  }

  return (
    <main className="mm-abertura flex min-h-dvh flex-col items-center justify-center gap-[22px] px-4 py-10">
      <div
        role="status"
        aria-label={`Abrindo o ${brand.name}`}
        className="flex flex-col items-center gap-[22px]"
      >
        <BrandIcon className="mm-respira size-[124px] drop-shadow-[0_18px_30px_rgba(11,140,90,0.28)] tablet:size-[150px]" />
        <BrandWordmark className="text-[36px] tablet:text-[46px]" />
      </div>
      {falha && (
        <div className="w-full max-w-[360px]">
          <ErrorState offline={falha.code === "sem_conexao"} onRetry={tentarDeNovo} />
        </div>
      )}
    </main>
  );
}
