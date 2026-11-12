import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { IconeSeta } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildCategoryTree, type CategoryDTO } from "../../../../shared/categories";
import { fetchCategories } from "../../../api/categories";
import { useBreakpoint } from "../../../app/useBreakpoint";
import { CategoryDot } from "../../../components/CategoryDot";
import { EditarCategoria } from "./EditarCategoria";

// Configurações › Categorias (TASK-0305). Lista em árvore (como a do protótipo Categorias) e, no tablet e no desktop,
// o editor ao lado. No celular, o editor é a rota própria (/configuracoes/categorias/:categoryId).
export function GerenciarCategorias() {
  const { categoryId } = useParams();
  const largura = useBreakpoint();
  const [categorias, setCategorias] = useState<CategoryDTO[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);

  const carregar = useCallback(() => {
    setFalhou(false);
    fetchCategories({ incluirArquivadas: true }).then(setCategorias, () => setFalhou(true));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const cabecalho = (
    <GreenTop
      variant="detail"
      title="Categorias"
      subtitle="Subcategorias, nomes e cores"
      back={{ to: "/configuracoes", label: "Voltar às configurações" }}
    />
  );

  if (categorias === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className="px-4 pt-4 tablet:px-6">
          {falhou ? (
            <ErrorState title="Não deu para carregar as categorias." onRetry={carregar} />
          ) : (
            <SkeletonCard />
          )}
        </div>
      </section>
    );
  }

  const selecionada = categoryId ? categorias.find((c) => c.id === categoryId) : undefined;
  const ativas = categorias.filter((c) => !c.archived);
  const arquivadas = categorias.filter((c) => c.archived);
  const arvore = buildCategoryTree(ativas);
  const soEditor = largura === "celular" && categoryId !== undefined;

  const lista = (
    <div className="flex min-w-0 flex-col gap-4">
      <Link
        to="/categorias/nova?voltar=/configuracoes/categorias"
        className="flex min-h-11 items-center justify-center rounded-field bg-primary px-4 text-[15px] font-bold text-white"
      >
        Nova categoria
      </Link>
      {ativas.length === 0 ? (
        <EmptyState title="Nenhuma categoria ainda." />
      ) : (
        <Card className="flex flex-col overflow-hidden p-0" aria-label="Categorias">
          {arvore.map((no) => (
            <div key={no.categoria.id} className="flex flex-col">
              <LinhaDeCategoria categoria={no.categoria} ativa={selecionada?.id === no.categoria.id} />
              {no.subcategorias.map((sub) => (
                <LinhaDeCategoria key={sub.id} categoria={sub} sub ativa={selecionada?.id === sub.id} />
              ))}
            </div>
          ))}
        </Card>
      )}
      {arquivadas.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={mostrarArquivadas}
            onClick={() => setMostrarArquivadas((aberta) => !aberta)}
            className="min-h-11 px-1 text-left text-[13px] font-extrabold uppercase tracking-[1px] text-ink-2"
          >
            Arquivadas ({arquivadas.length})
          </button>
          {mostrarArquivadas && (
            <Card className="flex flex-col overflow-hidden p-0" aria-label="Categorias arquivadas">
              {arquivadas.map((categoria) => (
                <LinhaDeCategoria
                  key={categoria.id}
                  categoria={categoria}
                  sub={categoria.parentId !== null}
                  ativa={selecionada?.id === categoria.id}
                  cinza
                />
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );

  if (soEditor) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <GreenTop
          variant="detail"
          title="Editar categoria"
          back={{ to: "/configuracoes/categorias", label: "Voltar às categorias" }}
        />
        {selecionada ? (
          <EditarCategoria categoria={selecionada} todas={categorias} aoMudar={carregar} />
        ) : (
          <div className="px-4 pt-4">
            <ErrorState title="Categoria não encontrada." onRetry={carregar} />
          </div>
        )}
      </section>
    );
  }

  const editor = selecionada ? (
    <EditarCategoria categoria={selecionada} todas={categorias} aoMudar={carregar} />
  ) : categoryId ? (
    <div className="px-4 pt-4 tablet:px-0">
      <ErrorState title="Categoria não encontrada." onRetry={carregar} />
    </div>
  ) : (
    <p className="px-4 pt-6 text-center text-[14px] text-ink-2 tablet:px-0">
      Escolha uma categoria para editar.
    </p>
  );

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      {cabecalho}
      <div
        className={cn(
          "mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:grid-cols-2 tablet:gap-[18px] tablet:px-6",
        )}
      >
        {lista}
        {largura !== "celular" && (
          <div className="min-w-0">
            <Card className="flex flex-col p-0">{editor}</Card>
          </div>
        )}
      </div>
    </section>
  );
}

function LinhaDeCategoria({
  categoria,
  sub = false,
  ativa,
  cinza = false,
}: {
  categoria: CategoryDTO;
  sub?: boolean;
  ativa: boolean;
  cinza?: boolean;
}) {
  return (
    <Link
      to={`/configuracoes/categorias/${encodeURIComponent(categoria.id)}`}
      aria-current={ativa ? "true" : undefined}
      className={cn(
        "flex min-h-14 items-center gap-3 border-b border-divider px-4 py-3 transition-colors last:border-b-0 hover:bg-field",
        sub && "pl-10",
        ativa && "bg-primary-soft",
        cinza && "text-ink-2",
      )}
    >
      <CategoryDot cor={categoria.color} sub={sub} />
      <span
        className={cn("min-w-0 flex-1 truncate text-[15px] font-bold", cinza ? "text-ink-2" : "text-ink")}
      >
        {categoria.name}
      </span>
      <IconeSeta size={18} className="shrink-0 rotate-180 text-ink-2" />
    </Link>
  );
}
