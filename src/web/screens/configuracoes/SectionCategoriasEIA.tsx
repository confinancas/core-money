import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import type { CategorizationStatus } from "../../../shared/categorization";
import { fetchCategorizationStatus } from "../../api/settings-categorization";
import { SettingsRow } from "../../components/settings/SettingsRow";

// Seção Categorias e IA (TASK-0305): as quatro linhas. O estado da chave vem de /api/categorization/status (mascarado).
// Cores dos estados: vermelho para a chave recusada, cor de aviso para o Claude fora do ar (tokens do design system).
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
      return <span className="text-[#E5484D]">A chave foi recusada · toque para trocar</span>;
    case "indisponivel":
      return <span className="text-[#C27400]">Claude fora do ar agora · tentando de novo</span>;
    case "sem_chave":
      return "Sem chave · toque para colar";
  }
}
