// Sessão do app (TASK-0104): quem está logado, o lar e as pessoas dele, lidos de GET /api/auth/session.
// Carrega uma vez, quando a primeira rota da moldura pede (RequireSession); "sair" e a sessão vencida mudam o estado
// para "saiu", e a tela manda para /entrar. Nos testes, `valores` põe a sessão direto, sem chamar a API.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AvisoDeAparelhoNovo } from "../../shared/devices";
import type { SessionHouseholdMember, SessionMember, SessionResponse } from "../../shared/session";
import { ApiError, apiEnviar, apiFetch } from "../lib/api";

export type EstadoDaSessao = "desconhecido" | "carregando" | "entrou" | "saiu" | "falha";

type ControleDaSessao = {
  estado: EstadoDaSessao;
  dados: SessionResponse | null;
  // Lê a sessão se ainda não foi lida (uma vez só, mesmo com dois pedidos juntos).
  garantir: () => void;
  // Esquece a sessão lida: a próxima rota protegida lê de novo (depois de entrar).
  esquecer: () => void;
  // Chama o logout. Só vira "saiu" (e a tela vai para /entrar) quando a API respondeu; na falha, o erro sobe.
  sair: () => Promise<void>;
  // Esquece a sessão deste aparelho sem chamar a API: para quando o servidor já a encerrou.
  encerrarLocal: () => void;
  // Tira os avisos de aparelho novo da sessão (depois do "Foi eu" na API).
  marcaAvisosVistos: () => void;
};

const SEM_CONTROLE: ControleDaSessao = {
  estado: "desconhecido",
  dados: null,
  garantir: () => undefined,
  esquecer: () => undefined,
  sair: async () => undefined,
  encerrarLocal: () => undefined,
  marcaAvisosVistos: () => undefined,
};

const Contexto = createContext<ControleDaSessao>(SEM_CONTROLE);

export function SessionProvider({ valores, children }: { valores?: SessionResponse; children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDaSessao>(valores ? "entrou" : "desconhecido");
  const [dados, setDados] = useState<SessionResponse | null>(valores ?? null);
  // O estado vale também dentro dos retornos assíncronos e das cópias de função antigas.
  const estadoAtual = useRef<EstadoDaSessao>(estado);

  const mudaEstado = useCallback((novo: EstadoDaSessao) => {
    estadoAtual.current = novo;
    setEstado(novo);
  }, []);

  const carregar = useCallback(() => {
    if (valores) return;
    if (estadoAtual.current !== "desconhecido") return;
    mudaEstado("carregando");
    apiFetch<SessionResponse>("/api/auth/session").then(
      (lida) => {
        setDados(lida);
        mudaEstado("entrou");
      },
      (erro: unknown) => {
        setDados(null);
        mudaEstado(erro instanceof ApiError && erro.status === 401 ? "saiu" : "falha");
      },
    );
  }, [mudaEstado, valores]);

  const esquecer = useCallback(() => {
    if (valores) return;
    setDados(null);
    mudaEstado("desconhecido");
  }, [mudaEstado, valores]);

  // Sem resposta da API, a sessão continua aberta e o erro sobe para quem chamou (a tela mostra o aviso).
  const sair = useCallback(async () => {
    await apiEnviar<{ ok: true }>("/api/auth/logout", "POST", {});
    setDados(null);
    mudaEstado("saiu");
  }, [mudaEstado]);

  const encerrarLocal = useCallback(() => {
    setDados(null);
    mudaEstado("saiu");
  }, [mudaEstado]);

  const marcaAvisosVistos = useCallback(() => {
    setDados((atual) => (atual ? { ...atual, notices: [] } : atual));
  }, []);

  const controle = useMemo<ControleDaSessao>(
    () => ({ estado, dados, garantir: carregar, esquecer, sair, encerrarLocal, marcaAvisosVistos }),
    [estado, dados, carregar, esquecer, sair, encerrarLocal, marcaAvisosVistos],
  );

  return <Contexto.Provider value={controle}>{children}</Contexto.Provider>;
}

// O controle da sessão para RequireSession e para a tela de entrada.
export function useControleDaSessao(): ControleDaSessao {
  return useContext(Contexto);
}

export type SessaoDoApp = {
  member: SessionMember;
  members: SessionHouseholdMember[];
  household: SessionResponse["household"];
  notices: unknown[];
  signOut: () => Promise<void>;
  encerrarLocal: () => void;
};

// Quem está logado. Só dentro de RequireSession (que espera a sessão chegar).
export function useSession(): SessaoDoApp {
  const { dados, sair, encerrarLocal } = useContext(Contexto);
  if (!dados) throw new Error("useSession fora de RequireSession: a sessão ainda não chegou.");
  return {
    member: dados.member,
    members: dados.members,
    household: dados.household,
    notices: dados.notices,
    signOut: sair,
    encerrarLocal,
  };
}

// As pessoas do lar para o rodapé do desktop; nulo enquanto a sessão não chegou.
export function useSessionMembers(): SessionHouseholdMember[] | null {
  return useContext(Contexto).dados?.members ?? null;
}

// Os avisos de aparelho novo (TASK-0106) e a marcação de "visto". Vazio enquanto a sessão não chegou.
export function useSessionNotices(): { avisos: AvisoDeAparelhoNovo[]; marcaVistos: () => void } {
  const { dados, marcaAvisosVistos } = useContext(Contexto);
  return { avisos: dados?.notices ?? [], marcaVistos: marcaAvisosVistos };
}

// Para a tela de entrar: ao sair do estado, a próxima rota da moldura lê a sessão nova.
export function useSessaoAposEntrar(): () => void {
  const { esquecer } = useContext(Contexto);
  const navegar = useNavigate();
  return useCallback(() => {
    esquecer();
    navegar("/inicio", { replace: true });
  }, [esquecer, navegar]);
}
