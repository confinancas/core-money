import { useEffect, useState } from "react";
import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { NOME_PROPRIO_MAXIMO } from "../../../shared/api/transactions";
import { type Categorizacao, fetchCategorization } from "../../api/rules";
import { IconeLapis, IconeOlhoRiscado } from "../../components/icons";
import { Card } from "../../components/ui/card";
import { Money } from "../../components/ui/money";
import { Switch } from "../../components/ui/switch";
import { TextField } from "../../components/ui/text-field";
import { linhaDeData } from "./view-model";

// Cartão do título (TASK-0403): a etiqueta de gasto de terceiros, o nome com o lápis, o original, o valor e a linha de
// data. Ao editar: o campo do nome, a chave "Usar este nome nas próximas" (desligada toda vez que a edição abre) e os
// três botões. Quem grava é a tela (aoSalvarNome); aqui só o formulário e as mensagens.

export type ResultadoDoNome = "ok" | "erro" | "erro_da_regra";

const MENSAGEM_DE_ERRO = "Não deu para salvar. Tente de novo.";
const MENSAGEM_DA_REGRA = "O nome foi salvo, mas não deu para usar nas próximas. Tente de novo.";

export function TitleCard({
  detalhe,
  hoje,
  aoSalvarNome,
}: {
  detalhe: DetalheDaCompra;
  hoje: string;
  aoSalvarNome: (nome: string | null, comRegra: boolean) => Promise<ResultadoDoNome>;
}) {
  const original = detalhe.originalDescription;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [chave, setChave] = useState(false);
  const [categorizacao, setCategorizacao] = useState<Categorizacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ao abrir a edição, lê a chave de casamento (estabelecimento e rótulo) e a regra que já guarda um nome.
  useEffect(() => {
    if (!editando) return;
    let ativa = true;
    fetchCategorization(detalhe.id).then(
      (lida) => {
        if (ativa) setCategorizacao(lida);
      },
      () => {
        if (ativa) setCategorizacao(null);
      },
    );
    return () => {
      ativa = false;
    };
  }, [editando, detalhe.id]);

  const temChave =
    categorizacao !== null && categorizacao.scope !== null && (categorizacao.matchLabel ?? "") !== "";
  const nomeDaRegra = categorizacao?.rule?.setCustomName ?? null;
  const tamanho = rascunho.trim().length;
  const muitoLongo = tamanho > NOME_PROPRIO_MAXIMO;

  function abrirEdicao() {
    setRascunho(detalhe.customName ?? "");
    setChave(false);
    setErro(null);
    setCategorizacao(null);
    setEditando(true);
  }

  function fecharEdicao() {
    setEditando(false);
    setErro(null);
  }

  async function gravar(nome: string | null, comRegra: boolean) {
    setSalvando(true);
    setErro(null);
    const resultado = await aoSalvarNome(nome, comRegra);
    setSalvando(false);
    if (resultado === "ok") fecharEdicao();
    else setErro(resultado === "erro_da_regra" ? MENSAGEM_DA_REGRA : MENSAGEM_DE_ERRO);
  }

  function salvar() {
    const valor = rascunho.trim();
    const nome = valor === "" || valor === original.trim() ? null : valor;
    void gravar(nome, chave && temChave && nome !== null);
  }

  const ocultaValor = detalhe.hidden;
  const estorno = detalhe.movement === "estorno";

  return (
    <Card className="flex flex-col items-center gap-2 text-center">
      {ocultaValor && (
        <p className="flex items-center gap-1.5 rounded-full border border-dashed border-hidden-border bg-[repeating-linear-gradient(135deg,var(--color-hidden-a)_0_7px,var(--color-hidden-b)_7px_14px)] px-3 py-1 text-[12px] font-bold text-ink-3">
          <IconeOlhoRiscado size={14} />
          Gasto de terceiros · fora dos cálculos
        </p>
      )}

      {editando ? (
        <form
          className="flex w-full flex-col gap-3 text-left"
          onSubmit={(evento) => {
            evento.preventDefault();
            salvar();
          }}
        >
          <TextField
            label="Nome que aparece para vocês"
            placeholder={original}
            value={rascunho}
            onChange={(evento) => setRascunho(evento.target.value)}
            hint={`Original do banco: ${original} · nunca é alterado`}
            error={muitoLongo ? `Use até ${NOME_PROPRIO_MAXIMO} caracteres.` : undefined}
          />

          {temChave && categorizacao !== null && (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-ink">
                  Usar este nome nas próximas de {categorizacao.matchLabel}
                </p>
                <p className="mt-0.5 text-[12px] leading-[1.45] text-ink-2">
                  Vale daqui para a frente e vira regra. Dá para desfazer em Configurações › Regras.
                </p>
                {nomeDaRegra !== null && (
                  <p className="mt-1 text-[12px] font-semibold text-ink-2">
                    Hoje as próximas usam {nomeDaRegra}.
                  </p>
                )}
              </div>
              <Switch
                checked={chave}
                onCheckedChange={setChave}
                label={`Usar este nome nas próximas de ${categorizacao.matchLabel}`}
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={salvando}
              onClick={() => void gravar(null, false)}
              className="min-h-11 rounded-[14px] text-[13px] font-semibold text-ink-3 disabled:opacity-50"
            >
              Usar original
            </button>
            <button
              type="button"
              disabled={salvando}
              onClick={fecharEdicao}
              className="min-h-11 rounded-full border-[1.5px] border-switch-off-border text-[14px] font-semibold text-ink disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || muitoLongo}
              className="min-h-11 rounded-[14px] bg-primary text-[14px] font-bold text-white disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
          {erro !== null && (
            <p role="alert" className="text-[13px] text-danger">
              {erro}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="flex items-center justify-center gap-1">
            <h2 className="min-w-0 break-words text-[20px] font-extrabold text-ink">{detalhe.displayName}</h2>
            <button
              type="button"
              aria-label="Renomear"
              onClick={abrirEdicao}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary"
            >
              <IconeLapis size={18} />
            </button>
          </div>
          {detalhe.displayName !== original && (
            <p className="break-words text-[12px] text-ink-2">Original: {original}</p>
          )}
          {erro !== null && (
            <p role="alert" className="text-[13px] text-danger">
              {erro}
            </p>
          )}
        </>
      )}

      {estorno ? (
        <Money
          cents={-Math.abs(detalhe.amountCents)}
          className="mt-1 text-[34px] font-extrabold text-success-ink"
        />
      ) : (
        <Money
          cents={Math.abs(detalhe.amountCents)}
          sign="none"
          struck={ocultaValor}
          className="mt-1 text-[34px] font-extrabold"
        />
      )}
      <p className="text-[13px] text-ink-2">{linhaDeData(detalhe, hoje)}</p>
    </Card>
  );
}
