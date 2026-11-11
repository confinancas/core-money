import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CategoryDTO, CategoryFieldErrors, CategoryInput } from "../../../../shared/categories";
import { type NovaCategoriaEntrada, updateCategory } from "../../../api/categories";
import { ApiError } from "../../../lib/api";
import { CategoryForm } from "../../categorias/CategoryForm";

type Props = {
  categoria: CategoryDTO;
  // Todas as categorias do lar (ativas e arquivadas): a validação e as principais de "Dentro de" usam a lista inteira.
  todas: CategoryDTO[];
  // Depois de salvar, arquivar ou reativar: quem chama recarrega a lista.
  aoMudar: () => void;
};

// Editor de uma categoria (TASK-0305). Usa o CategoryForm da TASK-0301 com a categoria em edição. Arquivar pede
// confirmação dentro da tela (nunca confirm()), e reativar é direto.
export function EditarCategoria({ categoria, todas, aoMudar }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [erroCampos, setErroCampos] = useState<CategoryFieldErrors>({});
  const [confirmando, setConfirmando] = useState(false);
  // Aviso "Salvo" depois de um PATCH que deu certo (N7, TASK-0305 rodada 1).
  const [salvo, setSalvo] = useState(false);

  const temSubcategorias = todas.some((c) => c.parentId === categoria.id && !c.archived);

  async function salvar(entrada: NovaCategoriaEntrada) {
    if (enviando) return;
    setEnviando(true);
    setErroGeral(null);
    setErroCampos({});
    setSalvo(false);
    try {
      // Só os campos do editor: o tipo padrão é da tela Tipos de gasto (TASK-0802). Mandá-lo como nulo apagaria o tipo
      // e rederivaria as transações da categoria.
      await updateCategory(categoria.id, {
        name: entrada.name,
        color: entrada.color,
        parentId: entrada.parentId,
        aiHint: entrada.aiHint,
      });
      setSalvo(true);
      aoMudar();
    } catch (erro) {
      if (erro instanceof ApiError && erro.code === "validacao" && erro.fields) setErroCampos(erro.fields);
      else setErroGeral("Não deu para salvar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  async function alterarArquivada(arquivar: boolean) {
    setErroGeral(null);
    setEnviando(true);
    try {
      await updateCategory(categoria.id, { archived: arquivar } as Partial<NovaCategoriaEntrada> & {
        archived: boolean;
      });
      setConfirmando(false);
      aoMudar();
    } catch (erro) {
      if (erro instanceof ApiError && erro.code === "validacao" && erro.fields) {
        setErroGeral(Object.values(erro.fields)[0] ?? "Não deu para mudar a categoria.");
      } else {
        setErroGeral("Não deu para mudar a categoria. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  }

  const inicial: CategoryInput = {
    name: categoria.name,
    color: categoria.color,
    parentId: categoria.parentId,
    aiHint: categoria.aiHint,
    defaultSpendType: categoria.defaultSpendType,
    archived: categoria.archived,
  };

  return (
    // O formulário recomeça quando os dados da categoria mudam (ou seja, quando a lista recarrega depois de salvar).
    <div
      key={[
        categoria.id,
        categoria.name,
        categoria.color,
        categoria.parentId ?? "",
        categoria.aiHint ?? "",
        categoria.archived,
      ].join("|")}
      className="flex flex-col"
    >
      <CategoryForm
        categorias={todas}
        idEmEdicao={categoria.id}
        empilhado
        inicial={{
          name: inicial.name,
          color: inicial.color,
          parentId: inicial.parentId,
          aiHint: inicial.aiHint,
        }}
        textoBotao="Salvar alterações"
        enviando={enviando}
        erroGeral={erroGeral}
        erroCampos={erroCampos}
        aoEnviar={(entrada) => void salvar(entrada)}
      />

      <div className="flex flex-col gap-3 px-4 pb-8 tablet:px-6">
        {categoria.archived ? (
          <Button variant="secondary" full loading={enviando} onClick={() => void alterarArquivada(false)}>
            Reativar categoria
          </Button>
        ) : confirmando ? (
          <section
            aria-label="Arquivar categoria"
            className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card"
          >
            <p className="text-[14px] leading-normal text-ink">
              Arquivar {categoria.name}? Ela some da lista de escolha e a IA deixa de sugeri-la. As transações
              antigas continuam com ela.
            </p>
            {temSubcategorias && (
              <p className="text-[13px] text-ink-2">As subcategorias também serão arquivadas.</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={enviando}
                onClick={() => void alterarArquivada(true)}
                className="min-h-11 rounded-field bg-danger px-5 text-[15px] font-bold text-white disabled:opacity-60"
              >
                Arquivar
              </button>
              <Button variant="secondary" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="min-h-11 self-center px-3 text-[15px] font-bold text-danger"
          >
            Arquivar categoria
          </button>
        )}
        {salvo && (
          <p role="status" className="text-center text-[14px] font-semibold text-ink-2">
            Salvo
          </p>
        )}
        {erroGeral !== null && (
          <p role="alert" className="text-center text-[13px] text-danger">
            {erroGeral}
          </p>
        )}
      </div>
    </div>
  );
}
