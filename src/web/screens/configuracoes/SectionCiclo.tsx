import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import type { HouseholdDto, HouseholdResponse } from "../../../shared/household";
import { ChoiceSheet, type OpcaoDeEscolha } from "../../components/settings/ChoiceSheet";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { ApiError, apiFetch } from "../../lib/api";
import { DIAS_DO_CICLO, subtituloDoCiclo } from "./cycle-subtitle";

const MENSAGEM_DE_ERRO_AO_SALVAR = "Não deu para salvar agora. Tente de novo.";
const OPCOES_DE_DIA: OpcaoDeEscolha[] = DIAS_DO_CICLO.map((dia) => ({ valor: dia, rotulo: String(dia) }));

// Seção Ciclo e orçamento (TASK-0107): o dia de início (editável, com ChoiceSheet) e o limite (só leitura).
// Os dados vêm de GET /api/household; salvar é um PATCH /api/household com só o campo do dia.
export function SectionCiclo() {
  const [lar, setLar] = useState<HouseholdDto | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [escolhido, setEscolhido] = useState(11);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const travado = useRef(false);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      const resposta = await apiFetch<HouseholdResponse>("/api/household");
      setLar(resposta.household);
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (lar === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar o ciclo." onRetry={() => void carregar()} />
    ) : (
      <SkeletonCard />
    );
  }

  function abrirEscolha() {
    setEscolhido(lar?.cycleStartDay ?? 11);
    setErro(null);
    setAberta(true);
  }

  // Salvar: o dia novo vale a partir do próximo ciclo (o servidor refaz só o calendário futuro). Erro de valor (400)
  // mostra o texto do campo; erro de rede ou outro, a mensagem padrão. Em qualquer erro, a linha fica como estava.
  async function salvar() {
    if (travado.current || lar === null) return;
    if (escolhido === lar.cycleStartDay) {
      setAberta(false);
      return;
    }
    travado.current = true;
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await apiFetch<HouseholdResponse>("/api/household", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cycleStartDay: escolhido }),
      });
      setLar(resposta.household);
      setAberta(false);
    } catch (falha) {
      setErro(mensagemDeSalvar(falha));
    } finally {
      travado.current = false;
      setSalvando(false);
    }
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
        <SettingsRow
          titulo="Início do ciclo"
          subtitulo={subtituloDoCiclo(lar.cycleStartDay)}
          valor={`Dia ${lar.cycleStartDay}`}
          aoAbrir={abrirEscolha}
        />
        {/* Encaixe: o valor do limite entra nesta linha pela TASK-0803. */}
        <SettingsRow
          titulo="Limite de gasto do ciclo"
          subtitulo="Calculado sozinho no início de cada ciclo"
        />
      </Card>

      <ChoiceSheet
        aberto={aberta}
        titulo="Início do ciclo"
        descricao="O dia novo vale a partir do próximo ciclo. O ciclo atual termina como estava, e os meses fechados não mudam."
        nomeDoGrupo="Dia de início do ciclo"
        opcoes={OPCOES_DE_DIA}
        escolhido={escolhido}
        onEscolher={setEscolhido}
        onSalvar={() => void salvar()}
        onCancelar={() => setAberta(false)}
        salvando={salvando}
        erro={erro}
      />
    </>
  );
}

// O texto do campo que a API recusou; o resto (rede, servidor) cai na mensagem padrão da tela.
function mensagemDeSalvar(falha: unknown): string {
  if (falha instanceof ApiError && falha.status === 400 && falha.fields?.cycleStartDay) {
    return falha.fields.cycleStartDay;
  }
  return MENSAGEM_DE_ERRO_AO_SALVAR;
}
