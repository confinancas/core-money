import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { type CategoryDTO, type CategoryFieldErrors, defaultColorFor } from "../../../shared/categories";
import { createCategory, fetchCategories, type NovaCategoriaEntrada } from "../../api/categories";
import { ApiError } from "../../lib/api";
import { CategoryForm } from "./CategoryForm";
import { caminhoSeguro } from "./voltar";

// Criar uma categoria (principal ou subcategoria de um nível). Depois de criar, volta a quem abriu com a nova selecionada.
export function NovaCategoria() {
  const navegar = useNavigate();
  const localizacao = useLocation();
  const [params] = useSearchParams();
  const voltar = caminhoSeguro(params.get("voltar"));
  const destino = voltar ?? "/categorias/escolher";
  // Aberta pelo seletor de uma compra (o voltar leva ?transacao=): a volta troca esta entrada pelo seletor (replace), e
  // leva junto a marca de histórico da compra. Sem isso, a seta da compra cairia aqui de novo (TASK-0403, F6).
  const daCompra = voltar !== null && new URL(voltar, "http://app.invalid").searchParams.has("transacao");
  const marcaDeHistorico = (localizacao.state as { temHistorico?: unknown } | null)?.temHistorico;
  // O estado que a compra precisa de volta: a marca de histórico, se chegou. Vale para criar e para desistir (F8).
  const estadoDaCompra = typeof marcaDeHistorico === "boolean" ? { temHistorico: marcaDeHistorico } : {};
  const paiPedido = params.get("pai");

  const [categorias, setCategorias] = useState<CategoryDTO[] | null>(null);
  const [falha, setFalha] = useState<ApiError | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [erroCampos, setErroCampos] = useState<CategoryFieldErrors>({});
  // Um envio por vez: o ref segura a trava mesmo que dois cliques cheguem antes do re-render.
  const enviandoRef = useRef(false);

  const partida = useRef(0);
  const carregar = useCallback(() => {
    const esta = ++partida.current;
    setFalha(null);
    fetchCategories().then(
      (lista) => {
        if (esta === partida.current) setCategorias(lista);
      },
      (erro: unknown) => {
        if (esta !== partida.current) return;
        setFalha(erro instanceof ApiError ? erro : new ApiError(0, "erro_http", "Algo deu errado."));
      },
    );
  }, []);

  useEffect(() => {
    carregar();
    return () => {
      partida.current++;
    };
  }, [carregar]);

  async function criar(entrada: NovaCategoriaEntrada) {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErroGeral(null);
    setErroCampos({});
    try {
      const criada = await createCategory(entrada);
      navegar(destino, {
        replace: daCompra,
        state: { categoriaCriada: criada.id, ...estadoDaCompra },
      });
    } catch (erro) {
      if (erro instanceof ApiError && erro.code === "validacao" && erro.fields) {
        setErroCampos(erro.fields);
      } else {
        setErroGeral("Não deu para salvar. Tente de novo.");
      }
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  // Desistir (a seta do topo) de uma criação aberta pela compra volta ao seletor com replace e leva a marca de histórico:
  // um link comum empilharia o seletor sobre esta tela, e a seta da compra cairia aqui de novo (TASK-0403, F8).
  const cabecalho = (
    <GreenTop
      variant="detail"
      title="Nova categoria"
      back={{
        to: destino,
        label: "Voltar às categorias",
        aoClicar: daCompra ? () => navegar(destino, { replace: true, state: estadoDaCompra }) : undefined,
      }}
    />
  );

  if (categorias === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className="px-4 pt-4 tablet:px-6">
          {falha ? (
            <ErrorState
              title="Não deu para carregar as categorias."
              offline={falha.code === "sem_conexao"}
              onRetry={carregar}
            />
          ) : (
            <SkeletonCard />
          )}
        </div>
      </div>
    );
  }

  // Subcategoria pedida (?pai=) só vale se a principal ainda estiver ativa; a cor sugerida é a dela.
  const paiInicial =
    paiPedido !== null &&
    categorias.some((categoria) => categoria.id === paiPedido && categoria.parentId === null)
      ? paiPedido
      : null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {cabecalho}
      <CategoryForm
        categorias={categorias}
        inicial={{
          name: "",
          color: defaultColorFor(categorias, paiInicial),
          parentId: paiInicial,
          aiHint: null,
        }}
        textoBotao="Criar categoria"
        enviando={enviando}
        erroGeral={erroGeral}
        erroCampos={erroCampos}
        aoEnviar={criar}
      />
    </div>
  );
}
