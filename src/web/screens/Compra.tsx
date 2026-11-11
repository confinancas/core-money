import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type { CorpoDoPatch, DetalheDaCompra } from "../../shared/api/transactions";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { SpendType } from "../../shared/spend-types";
import { criarRegraDoNome, fetchTransaction, patchTransaction } from "../api/transactions";
import { type Aba, destinoDeVoltar } from "../app/frame/aba";
import { useRotaAtual } from "../app/rota-atual";
import { EmptyState } from "../components/ui/empty-state";
import { ErrorState } from "../components/ui/error-state";
import { GreenTop } from "../components/ui/green-top";
import { SkeletonCard } from "../components/ui/skeleton";
import { ApiError } from "../lib/api";
import { CategoryCard } from "./transaction/CategoryCard";
import { DetailRows } from "./transaction/DetailRows";
import { HideToggle } from "./transaction/HideToggle";
import { SpendTypePicker } from "./transaction/SpendTypePicker";
import { type ResultadoDoNome, TitleCard } from "./transaction/TitleCard";
import { podeOcultar, tituloDaCompra } from "./transaction/view-model";

// Compra (TASK-0403): o detalhe de uma compra do cartão, ou de uma saída da conta (débito, boleto, outra). Nome próprio,
// categoria, tipo e ocultar. Cada mudança grava na hora, com atualização otimista; se o servidor recusa ou cai, o
// controle volta ao anterior e o aviso aparece sob o cartão afetado. Celular: uma coluna; tablet: título e categoria à
// esquerda, linhas e ocultar à direita; desktop: três colunas (título | categoria e tipo | linhas e ocultar).

type CampoComErro = "nome" | "tipo" | "ocultar";
type Estado = "carregando" | "pronta" | "falhou" | "nao_existe";

export function Compra() {
  const { transactionId = "" } = useParams();
  const navegar = useNavigate();
  const localizacao = useLocation();
  const { aba } = useRotaAtual();
  const [dados, setDados] = useState<DetalheDaCompra | null>(null);
  const [estado, setEstado] = useState<Estado>("carregando");
  const [erros, setErros] = useState<Partial<Record<CampoComErro, string>>>({});
  const partida = useRef(0);

  // Cada carga tem um número: só a última ainda vale. Ao voltar de Escolher categoria, a tela monta de novo e relê.
  const carregar = useCallback(async () => {
    const esta = ++partida.current;
    setEstado((atual) => (atual === "pronta" ? atual : "carregando"));
    try {
      const lida = await fetchTransaction(transactionId);
      if (esta !== partida.current) return;
      setDados(lida);
      setEstado("pronta");
    } catch (erro) {
      if (esta !== partida.current) return;
      setEstado(erro instanceof ApiError && erro.status === 404 ? "nao_existe" : "falhou");
    }
  }, [transactionId]);

  useEffect(() => {
    void carregar();
    return () => {
      partida.current++;
    };
  }, [carregar]);

  // Grava um campo: mostra o valor novo já; se o PATCH falha, volta ao anterior. O nome tem aviso próprio no cartão.
  async function gravar(
    campo: CampoComErro,
    corpo: CorpoDoPatch,
    otimista: (atual: DetalheDaCompra) => DetalheDaCompra,
  ): Promise<boolean> {
    const atual = dados;
    if (atual === null) return false;
    setErros({});
    setDados(otimista(atual));
    try {
      setDados(await patchTransaction(transactionId, corpo));
      return true;
    } catch {
      setDados(atual);
      if (campo !== "nome") setErros({ [campo]: "Não deu para salvar. Tente de novo." });
      return false;
    }
  }

  function escolherTipo(tipo: SpendType) {
    if (dados === null || dados.spendType === tipo) return;
    void gravar("tipo", { spendType: tipo }, (atual) => ({
      ...atual,
      spendType: tipo,
      spendTypeSource: "escolhido",
    }));
  }

  function alternarOcultar(oculta: boolean) {
    if (dados === null) return;
    void gravar("ocultar", { hidden: oculta }, (atual) => ({
      ...atual,
      hidden: oculta,
      hiddenReason: oculta ? "gasto_terceiros" : null,
    }));
  }

  // Nome: PATCH com o nome (null volta ao original). Com a chave ligada, depois a regra só com o nome; se só a regra
  // falha, o nome fica salvo e a edição continua aberta.
  async function salvarNome(nome: string | null, comRegra: boolean): Promise<ResultadoDoNome> {
    const gravado = await gravar("nome", { customName: nome }, (atual) => ({
      ...atual,
      customName: nome,
      displayName: nome ?? atual.originalDescription,
    }));
    if (!gravado) return "erro";
    if (!comRegra || nome === null) return "ok";
    try {
      await criarRegraDoNome(transactionId, nome);
      return "ok";
    } catch {
      return "erro_da_regra";
    }
  }

  const voltarPara = destinoDeVoltar(aba);
  // A seta volta no histórico, como o botão de voltar do navegador; sem histórico (aberta direto), vai para a aba.
  function voltar() {
    if (localizacao.key !== "default") navegar(-1);
    else navegar(voltarPara);
  }

  const hoje = todayInSaoPaulo(new Date());
  const titulo = dados === null ? "Compra" : tituloDaCompra(dados.movement);

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title={titulo}
        back={{ to: voltarPara, label: "Voltar", aoClicar: voltar }}
        overlap
      />

      {estado === "carregando" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <SkeletonCard />
        </div>
      )}
      {estado === "falhou" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <ErrorState title="Não deu para abrir esta compra." onRetry={() => void carregar()} />
        </div>
      )}
      {estado === "nao_existe" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <EmptyState title="Esta compra não existe mais." />
        </div>
      )}
      {estado === "pronta" && dados !== null && (
        <Corpo
          dados={dados}
          aba={aba}
          hoje={hoje}
          erros={erros}
          aoEscolherTipo={escolherTipo}
          aoAlternarOcultar={alternarOcultar}
          aoSalvarNome={salvarNome}
        />
      )}
    </section>
  );
}

function Corpo({
  dados,
  aba,
  hoje,
  erros,
  aoEscolherTipo,
  aoAlternarOcultar,
  aoSalvarNome,
}: {
  dados: DetalheDaCompra;
  aba: Aba | null;
  hoje: string;
  erros: Partial<Record<CampoComErro, string>>;
  aoEscolherTipo: (tipo: SpendType) => void;
  aoAlternarOcultar: (oculta: boolean) => void;
  aoSalvarNome: (nome: string | null, comRegra: boolean) => Promise<ResultadoDoNome>;
}) {
  return (
    <div className="mx-auto -mt-11 grid w-full max-w-[1120px] items-start gap-5 px-4 pb-8 tablet:grid-cols-2 tablet:px-6 desktop:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-5 tablet:col-start-1 tablet:row-start-1 desktop:col-start-1 desktop:row-start-1">
        <TitleCard detalhe={dados} hoje={hoje} aoSalvarNome={aoSalvarNome} />
      </div>

      <div className="flex min-w-0 flex-col gap-5 tablet:col-start-1 tablet:row-start-2 desktop:col-start-2 desktop:row-start-1">
        <CategoryCard detalhe={dados} aba={aba} />
        {dados.spendType !== null && (
          <SpendTypePicker detalhe={dados} erro={erros.tipo ?? null} aoEscolher={aoEscolherTipo} />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5 tablet:col-start-2 tablet:row-span-2 tablet:row-start-1 desktop:col-start-3 desktop:row-span-1 desktop:row-start-1">
        <DetailRows detalhe={dados} />
        {podeOcultar(dados.movement) && (
          <HideToggle hidden={dados.hidden} erro={erros.ocultar ?? null} aoMudar={aoAlternarOcultar} />
        )}
      </div>
    </div>
  );
}
