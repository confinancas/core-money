import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UsageResponse } from "../../shared/usage";
import { apiEnviar, apiFetch } from "../lib/api";

// Uso do plano gratuito (TASK-0109): lido ao montar a moldura, de novo quando o app volta à tela (no máximo a cada
// 15 minutos) e depois de mudar o plano. Quem lê é a faixa (UsageBanner) e a seção Plano da Cloudflare.
export const INTERVALO_DE_LEITURA_DO_USO_MS = 15 * 60 * 1000;

export type ValorDoUso = {
  uso: UsageResponse | null;
  atualizar: () => Promise<void>;
  definirPlanoPago: (paidPlan: boolean) => Promise<void>;
};

// Padrão sem provedor: nada lido e nada a fazer (a faixa não aparece).
export const UsoContexto = createContext<ValorDoUso>({
  uso: null,
  atualizar: async () => undefined,
  definirPlanoPago: async () => undefined,
});

export function UsoProvider({ children }: { children: ReactNode }) {
  const [uso, setUso] = useState<UsageResponse | null>(null);
  const ultimaLeitura = useRef(0);

  // Falha de leitura mantém o último valor: o aviso de limite (se for o caso) já aparece pela moldura.
  const atualizar = useCallback(async () => {
    try {
      // Leitura de fundo: no 401 não leva a /entrar (quem decide a sessão é a sonda e o RequireSession).
      const resposta = await apiFetch<UsageResponse>("/api/usage", {}, { semRedirecionarNaSessao: true });
      ultimaLeitura.current = Date.now();
      setUso(resposta);
    } catch {
      // mantém o último valor
    }
  }, []);

  // Falha de gravação chega a quem chamou (a seção mostra a mensagem); com sucesso, relê o uso.
  const definirPlanoPago = useCallback(
    async (paidPlan: boolean) => {
      await apiEnviar<{ paidPlan: boolean }>("/api/settings/paid-plan", "PUT", { paidPlan });
      await atualizar();
    },
    [atualizar],
  );

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  useEffect(() => {
    function aoVoltarATela() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimaLeitura.current < INTERVALO_DE_LEITURA_DO_USO_MS) return;
      void atualizar();
    }
    document.addEventListener("visibilitychange", aoVoltarATela);
    return () => document.removeEventListener("visibilitychange", aoVoltarATela);
  }, [atualizar]);

  const valor = useMemo(() => ({ uso, atualizar, definirPlanoPago }), [uso, atualizar, definirPlanoPago]);
  return <UsoContexto.Provider value={valor}>{children}</UsoContexto.Provider>;
}

export function useUso(): ValorDoUso {
  return useContext(UsoContexto);
}
