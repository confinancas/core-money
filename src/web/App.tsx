import { useEffect, useState } from "react";
import type { HealthResponse } from "../shared/api";

// Página provisória: a TASK-0005 troca pelo roteador.
type Estado = { tipo: "carregando" } | { tipo: "ok"; versao: string } | { tipo: "fora" };

export function App() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  useEffect(() => {
    let ativo = true;
    fetch("/api/health")
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const corpo = (await resposta.json()) as HealthResponse;
        if (ativo) setEstado({ tipo: "ok", versao: corpo.version });
      })
      .catch(() => {
        if (ativo) setEstado({ tipo: "fora" });
      });
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <main>
      <h1>Matrimoney</h1>
      {estado.tipo === "ok" && <p>API ok · versão {estado.versao}</p>}
      {estado.tipo === "fora" && (
        <p>
          API fora do ar. Rode <code>npm run dev</code>.
        </p>
      )}
    </main>
  );
}
