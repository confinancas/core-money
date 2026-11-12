import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import type { CategorizationStatus } from "../../../shared/categorization";
import { fetchCategorizationStatus } from "../../api/settings-categorization";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { COR_DE_AVISO, COR_DE_FALTA } from "./cores-da-chave";

// Seção Categorias e IA (TASK-0305): as quatro linhas. O estado da chave vem de /api/categorization/status (mascarado).
// Cores dos estados: falta para a chave recusada, aviso para o Claude fora do ar (cores-da-chave.ts, N9).
export function SectionCategoriasEIA() {
  const [estado, setEstado] = useState<CategorizationStatus | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(() => {
    setFalhou(false);
    void fetchCategorizationStatus().then(setEstado, () => setFalhou(true));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (estado === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar as categorias." onRetry={carregar} />
    ) : (
      <SkeletonCard />
    );
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <SettingsRow
        titulo="Categorias"
        subtitulo="Subcategorias, nomes e cores"
        valor={estado.categoriesCount}
        para="/configuracoes/categorias"
      />
      <SettingsRow
        titulo="Regras por estabelecimento"
        subtitulo="Categorias e nomes que você corrigiu"
        valor={estado.activeRulesCount}
        para="/configuracoes/regras"
      />
      <SettingsRow
        titulo="Documento de regras da IA"
        subtitulo="Instruções usadas para categorizar"
        para="/configuracoes/documento-ia"
      />
      <SettingsRow
        titulo="Chave da API do Claude"
        subtitulo={<EstadoDaChave estado={estado} />}
        para="/configuracoes/claude"
      />
    </Card>
  );
}

function EstadoDaChave({ estado }: { estado: CategorizationStatus }) {
  switch (estado.keyState) {
    case "ok":
      return "Conectada · Haiku para categorizar";
    case "problema_chave":
      // N17: chave nova gravada há pouco, com erros ainda na fila. O texto não promete efeito imediato.
      if (estado.chaveNovaRecente) {
        return "Chave nova recebida; a categorização volta em alguns minutos";
      }
      return <span style={{ color: COR_DE_FALTA }}>A chave foi recusada · toque para trocar</span>;
    case "indisponivel":
      return <span style={{ color: COR_DE_AVISO }}>Claude fora do ar agora · tentando de novo</span>;
    case "sem_chave":
      return "Sem chave · toque para colar";
  }
}
