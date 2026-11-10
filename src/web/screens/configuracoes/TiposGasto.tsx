import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  investmentsPct,
  type PlannedPercentages,
  SPEND_TYPE_DEFS,
  type SpendType,
  sumPlanned,
  TIPO_DA_REGRA_AUTOMATICA,
} from "../../../shared/spend-types";
import {
  type CategoriaDeTipo,
  createAutomaticRule,
  deleteAutomaticRule,
  fetchSpendTypes,
  type RegraAutomatica,
  saveCategoryDefaultType,
  savePercentages,
  type TiposDeGastoResposta,
} from "../../api/spend-types";
import { ChoiceSheet } from "../../components/settings/ChoiceSheet";
import { ApiError } from "../../lib/api";
import { AutomaticRules } from "./tipos-de-gasto/AutomaticRules";
import { CategoryTypeList } from "./tipos-de-gasto/CategoryTypeList";
import { DistributionCard } from "./tipos-de-gasto/DistributionCard";
import { LimitCard } from "./tipos-de-gasto/LimitCard";
import { RuleSheet } from "./tipos-de-gasto/RuleSheet";
import { TypeRow } from "./tipos-de-gasto/TypeRow";
import {
  AVISO_DE_SOMA,
  mudaPercentual,
  OPCOES_DE_TIPO,
  TIPOS_DO_LIMITE,
  TIPOS_GUARDADOS,
  textoDeRegrasSalvas,
  textoDoSalvo,
  valorPorCiclo,
} from "./tipos-de-gasto/view-model";

const ATRASO_DO_SALVAR_MS = 600;
const MENSAGEM_DE_ERRO = "Não deu para salvar agora. Tente de novo.";
const TEXTO_DO_TIPO_PADRAO =
  "Toda compra herda o tipo da categoria. Você pode trocar numa compra específica.";
const PADRAO = "padrao" as const;

const iguais = (a: PlannedPercentages, b: PlannedPercentages): boolean =>
  SPEND_TYPE_DEFS.every((tipo) => tipo.pctKey === null || a[tipo.pctKey] === b[tipo.pctKey]);

// Tela Tipos de gasto (TASK-0802, celular, tablet e desktop): percentuais que se gravam sozinhos, o limite, a
// categoria com o tipo padrão e as regras automáticas. Nada passa de 100%: a soma acima grava nada e avisa.
export function TiposGasto() {
  const [dados, setDados] = useState<TiposDeGastoResposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [percentuais, setPercentuais] = useState<PlannedPercentages | null>(null);
  const [estadoDoSalvar, setEstadoDoSalvar] = useState<"parado" | "salvo" | "erro">("parado");
  const gravado = useRef<PlannedPercentages | null>(null);

  const [categoria, setCategoria] = useState<CategoriaDeTipo | null>(null);
  const [tipoEscolhido, setTipoEscolhido] = useState<SpendType | typeof PADRAO>(PADRAO);
  const [salvandoCategoria, setSalvandoCategoria] = useState(false);
  const [erroCategoria, setErroCategoria] = useState<string | null>(null);

  const [regraAberta, setRegraAberta] = useState<RegraAutomatica["kind"] | null>(null);
  const [textoDaRegra, setTextoDaRegra] = useState("");
  const [salvandoRegra, setSalvandoRegra] = useState(false);
  const [erroRegra, setErroRegra] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // Lê a tela. A primeira leitura põe os percentuais do lar. As seguintes (depois de gravar) só atualizam os dados: os
  // percentuais da tela são os da pessoa, e um toque que chegou durante a gravação não pode ser apagado pela resposta.
  const carregar = useCallback(async (inicial: boolean) => {
    setFalhou(false);
    try {
      const resposta = await fetchSpendTypes();
      setDados(resposta);
      if (inicial) {
        setPercentuais(resposta.percentages);
        gravado.current = resposta.percentages;
      }
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar(true);
  }, [carregar]);

  // Grava sozinho 600 ms depois do último toque. Soma acima de 100: não grava nada (o aviso aparece).
  useEffect(() => {
    if (percentuais === null || gravado.current === null) return;
    if (iguais(percentuais, gravado.current) || sumPlanned(percentuais) > 100) return;
    const alvo = percentuais;
    const timer = setTimeout(() => {
      savePercentages(alvo).then(
        () => {
          gravado.current = alvo;
          setEstadoDoSalvar("salvo");
          void carregar(false);
        },
        () => setEstadoDoSalvar("erro"),
      );
    }, ATRASO_DO_SALVAR_MS);
    return () => clearTimeout(timer);
  }, [percentuais, carregar]);

  if (dados === null || percentuais === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <GreenTop
          variant="detail"
          title="Tipos de gasto"
          back={{ to: "/configuracoes", label: "Voltar às configurações" }}
        />
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          {falhou ? (
            <ErrorState
              title="Não deu para carregar os tipos de gasto."
              onRetry={() => void carregar(true)}
            />
          ) : (
            <SkeletonCard />
          )}
        </div>
      </section>
    );
  }

  const soma = sumPlanned(percentuais);
  const passou = soma > 100;
  const invest = investmentsPct(percentuais);
  const mudar = (tipo: SpendType, delta: number) => {
    setEstadoDoSalvar("parado");
    setPercentuais((atual) => (atual === null ? atual : mudaPercentual(atual, tipo, delta)));
  };

  async function salvarTipoDaCategoria() {
    if (categoria === null || salvandoCategoria) return;
    setSalvandoCategoria(true);
    setErroCategoria(null);
    try {
      await saveCategoryDefaultType(categoria.id, tipoEscolhido === PADRAO ? null : tipoEscolhido);
      setCategoria(null);
      await carregar(false);
    } catch {
      setErroCategoria(MENSAGEM_DE_ERRO);
    } finally {
      setSalvandoCategoria(false);
    }
  }

  const regraExistente = (kind: RegraAutomatica["kind"]) =>
    dados.automaticRules.find((regra) => regra.kind === kind);

  async function salvarRegra() {
    if (regraAberta === null || salvandoRegra) return;
    setSalvandoRegra(true);
    setErroRegra(null);
    try {
      // Editar é criar a nova (que aplica ao histórico) e depois apagar a anterior (que devolve o que só ela cobria).
      const criada = await createAutomaticRule(regraAberta, textoDaRegra);
      const anterior = regraExistente(regraAberta);
      if (anterior !== undefined) await deleteAutomaticRule(anterior.id);
      setMensagem(textoDeRegrasSalvas(criada.applied, TIPO_DA_REGRA_AUTOMATICA[regraAberta]));
      setRegraAberta(null);
      await carregar(false);
    } catch (erro) {
      setErroRegra(erro instanceof ApiError && erro.code === "validacao" ? erro.message : MENSAGEM_DE_ERRO);
    } finally {
      setSalvandoRegra(false);
    }
  }

  async function removerRegra() {
    const existente = regraAberta === null ? undefined : regraExistente(regraAberta);
    if (existente === undefined || salvandoRegra) return;
    setSalvandoRegra(true);
    try {
      await deleteAutomaticRule(existente.id);
      setRegraAberta(null);
      setMensagem("Regra removida. As transações voltaram para a categoria ou o padrão.");
      await carregar(false);
    } catch {
      setErroRegra(MENSAGEM_DE_ERRO);
    } finally {
      setSalvandoRegra(false);
    }
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title="Tipos de gasto"
        back={{ to: "/configuracoes", label: "Voltar às configurações" }}
      />
      {/* Colunas como nos protótipos: uma no celular, duas no tablet e três no desktop. Cada grupo fica inteiro numa
          coluna (break-inside-avoid), e a quebra de coluna é do próprio grupo. A ordem do DOM é a da leitura de tela. */}
      <div className="mx-auto w-full max-w-[1120px] columns-1 gap-x-5 px-4 pt-6 pb-8 tablet:columns-2 tablet:px-6 desktop:columns-3">
        <div className="mb-5 flex break-inside-avoid flex-col gap-5">
          <DistributionCard percentuais={percentuais} base={dados.base} />
          <p
            role="status"
            aria-live="polite"
            className="-mt-3 min-h-5 px-1 text-[13px] font-semibold text-primary-ink"
          >
            {estadoDoSalvar === "salvo" && textoDoSalvo}
            {estadoDoSalvar === "erro" && MENSAGEM_DE_ERRO}
          </p>
          <LimitCard limite={dados.currentLimit} percentuais={percentuais} />

          <h2 className="px-1.5 text-[12px] font-bold uppercase tracking-[1px] text-ink-2">
            Gastos · entram no limite
          </h2>
          <Card className="flex flex-col px-[18px] py-1">
            {SPEND_TYPE_DEFS.filter((tipo) => TIPOS_DO_LIMITE.includes(tipo.id)).map((tipo) => {
              const pct = tipo.pctKey === null ? 0 : percentuais[tipo.pctKey];
              return (
                <TypeRow
                  key={tipo.id}
                  tipo={tipo}
                  pct={pct}
                  valorCents={valorPorCiclo(dados.base, pct)}
                  onDiminuir={() => mudar(tipo.id, -1)}
                  onAumentar={() => mudar(tipo.id, 1)}
                />
              );
            })}
          </Card>
        </div>

        <div className="mb-5 flex break-inside-avoid flex-col gap-5 desktop:break-before-column">
          <h2 className="px-1.5 text-[12px] font-bold uppercase tracking-[1px] text-ink-2">
            Dinheiro guardado · fica fora do limite
          </h2>
          <Card className="flex flex-col px-[18px] py-1">
            {SPEND_TYPE_DEFS.filter((tipo) => TIPOS_GUARDADOS.includes(tipo.id)).map((tipo) => {
              const pct = tipo.pctKey === null ? 0 : percentuais[tipo.pctKey];
              return (
                <TypeRow
                  key={tipo.id}
                  tipo={tipo}
                  pct={pct}
                  valorCents={valorPorCiclo(dados.base, pct)}
                  onDiminuir={() => mudar(tipo.id, -1)}
                  onAumentar={() => mudar(tipo.id, 1)}
                />
              );
            })}
            {SPEND_TYPE_DEFS.filter((tipo) => tipo.id === "investimentos").map((tipo) => (
              <TypeRow
                key={tipo.id}
                tipo={tipo}
                pct={invest}
                valorCents={valorPorCiclo(dados.base, invest)}
                automatico
                negativo={invest < 0}
              />
            ))}
          </Card>
          {passou && (
            <section
              role="alert"
              className="rounded-[20px] border border-danger-bg bg-danger-bg px-[18px] py-3.5 text-[13px] leading-[1.45] text-danger"
            >
              {AVISO_DE_SOMA}
            </section>
          )}
        </div>

        <div className="mb-5 flex break-inside-avoid flex-col gap-5 tablet:break-before-column desktop:break-before-auto">
          <h2 className="px-1.5 text-[12px] font-bold uppercase tracking-[1px] text-ink-2">
            Tipo padrão por categoria
          </h2>
          <p className="px-1.5 -mt-3 text-[13px] text-ink-2">{TEXTO_DO_TIPO_PADRAO}</p>
          <Card className="flex flex-col px-[18px] py-1">
            <CategoryTypeList
              categorias={dados.categories}
              aoEscolher={(escolhida) => {
                setCategoria(escolhida);
                setTipoEscolhido(escolhida.defaultSpendType ?? PADRAO);
                setErroCategoria(null);
              }}
            />
          </Card>
        </div>

        <div className="mb-5 flex break-inside-avoid flex-col gap-5 desktop:break-before-column">
          <h2 className="px-1.5 text-[12px] font-bold uppercase tracking-[1px] text-ink-2">
            Regras automáticas
          </h2>
          <Card className="flex flex-col px-[18px] py-1">
            <AutomaticRules
              regras={dados.automaticRules}
              aoDefinir={(kind) => {
                setRegraAberta(kind);
                setTextoDaRegra(regraExistente(kind)?.matchValue ?? "");
                setErroRegra(null);
                setMensagem(null);
              }}
            />
          </Card>
          {mensagem !== null && (
            <p role="status" className="px-1 text-[13px] font-semibold text-primary-ink">
              {mensagem}
            </p>
          )}
        </div>
      </div>

      <ChoiceSheet<SpendType | typeof PADRAO>
        aberto={categoria !== null}
        titulo={categoria?.name ?? ""}
        descricao={TEXTO_DO_TIPO_PADRAO}
        nomeDoGrupo="Tipo de gasto da categoria"
        opcoes={[...OPCOES_DE_TIPO, { valor: PADRAO, rotulo: "Usar o padrão" }]}
        escolhido={tipoEscolhido}
        onEscolher={setTipoEscolhido}
        onSalvar={() => void salvarTipoDaCategoria()}
        onCancelar={() => setCategoria(null)}
        salvando={salvandoCategoria}
        erro={erroCategoria}
        rotulos
      />

      <RuleSheet
        kind={regraAberta}
        regra={regraAberta === null ? undefined : regraExistente(regraAberta)}
        texto={textoDaRegra}
        destinos={dados.recentDestinations}
        salvando={salvandoRegra}
        erro={erroRegra}
        onTexto={setTextoDaRegra}
        onSalvar={() => void salvarRegra()}
        onRemover={() => void removerRegra()}
        onFechar={() => setRegraAberta(null)}
      />
    </section>
  );
}
