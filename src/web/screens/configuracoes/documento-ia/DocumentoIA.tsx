import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { type DocumentoDaIA, fetchAiDocument, saveAiDocument } from "../../../api/settings-categorization";

// Configurações › Documento de regras da IA (TASK-0305). Texto livre que a IA lê antes de categorizar (TASK-0303).
// Conflito (409): a versão salva por outra pessoa entra no lugar do texto, e o que foi digitado fica numa caixa abaixo,
// para não se perder.
export const LIMITE_DO_TEXTO = 4000;

export function DocumentoIA() {
  const [carregado, setCarregado] = useState<DocumentoDaIA | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [texto, setTexto] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);
  const [meuTexto, setMeuTexto] = useState<string | null>(null);
  // A versão salva que veio no 409 (current): "Ver a versão salva" usa essa, sem nova leitura.
  const [versaoSalva, setVersaoSalva] = useState<DocumentoDaIA | null>(null);

  function carregar() {
    setFalhou(false);
    fetchAiDocument().then(
      (documento) => {
        setCarregado(documento);
        setTexto(documento.text);
        setBase(documento.updatedAt);
        setSalvoEm(documento.updatedAt);
      },
      () => setFalhou(true),
    );
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: carregar só faz a leitura inicial, uma vez.
  useEffect(() => {
    carregar();
  }, []);

  if (falhou && carregado === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <Cabecalho />
        <div className="px-4 pt-4 tablet:px-6">
          <ErrorState title="Não deu para carregar o documento." onRetry={carregar} />
        </div>
      </section>
    );
  }
  if (carregado === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        <Cabecalho />
        <div className="px-4 pt-4 tablet:px-6">
          <SkeletonCard />
        </div>
      </section>
    );
  }

  const tamanho = Array.from(texto.trim()).length;
  const acima = tamanho > LIMITE_DO_TEXTO;

  async function salvar() {
    if (salvando || acima) return;
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await saveAiDocument(texto, base);
      if (resultado.ok) {
        setBase(resultado.documento.updatedAt);
        setSalvoEm(resultado.documento.updatedAt);
        setTexto(resultado.documento.text);
        setConflito(false);
        // Salvou de novo: a cópia do texto anterior sai da tela.
        setMeuTexto(null);
      } else {
        setConflito(true);
        setMeuTexto(texto);
        setVersaoSalva(resultado.atual);
      }
    } catch {
      setErro("Não deu para salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  function verVersaoSalva() {
    // O texto digitado fica em meuTexto (a caixa de cópia continua na tela); a versão salva entra no lugar dele.
    if (versaoSalva === null) return;
    setTexto(versaoSalva.text);
    setBase(versaoSalva.updatedAt);
    setSalvoEm(versaoSalva.updatedAt);
    setConflito(false);
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <Cabecalho />
      <form
        className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 px-4 pt-5 pb-8 tablet:px-6"
        onSubmit={(evento) => {
          evento.preventDefault();
          void salvar();
        }}
      >
        <p className="text-[14px] leading-normal text-ink-2">
          A IA lê este texto antes de sugerir uma categoria, junto com as dicas de cada categoria e as regras
          de vocês. Escreva como explicaria para uma pessoa: "Pix para a diarista é Serviços", "Uber depois
          das 22h é Lazer".
        </p>

        {conflito && (
          <div role="alert" className="flex flex-col gap-3 rounded-card bg-danger-bg p-4">
            <p className="text-[14px] font-semibold text-danger">
              Outra pessoa salvou o documento enquanto você editava.
            </p>
            <div>
              <Button variant="secondary" onClick={verVersaoSalva}>
                Ver a versão salva
              </Button>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-2">
          <span className="sr-only">Documento de regras</span>
          <textarea
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            rows={14}
            aria-invalid={acima ? true : undefined}
            className="resize-y rounded-field border border-field-border bg-field px-4 py-3.5 font-sans text-[15px] leading-[1.5] text-ink outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/14"
          />
        </label>

        <div className="flex flex-col gap-1 text-[13px]">
          <span className={acima ? "font-semibold text-danger" : "text-ink-2"}>
            {tamanho} de {LIMITE_DO_TEXTO.toLocaleString("pt-BR")}
          </span>
          {acima && <span className="text-danger">Use até 4.000 caracteres.</span>}
          {salvoEm !== null && <span className="text-ink-2">Salvo em {formataData(salvoEm)}</span>}
        </div>

        {meuTexto !== null && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-ink-2">Seu texto, para copiar se precisar:</span>
            <textarea
              readOnly
              value={meuTexto}
              rows={6}
              className="resize-y rounded-field border border-field-border bg-card px-4 py-3 font-sans text-[14px] text-ink"
            />
          </div>
        )}

        {erro !== null && (
          <p role="alert" className="text-[14px] font-semibold text-danger">
            {erro}
          </p>
        )}

        <div className="pt-2">
          <Button type="submit" full loading={salvando} disabled={acima}>
            Salvar documento
          </Button>
        </div>
      </form>
    </section>
  );
}

function Cabecalho() {
  return (
    <GreenTop
      variant="detail"
      title="Documento de regras da IA"
      back={{ to: "/configuracoes", label: "Voltar às configurações" }}
    />
  );
}

// "dd/mm às hh:mm", pela data local do aparelho.
export function formataData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const dd = String(data.getDate()).padStart(2, "0");
  const mm = String(data.getMonth() + 1).padStart(2, "0");
  const hh = String(data.getHours()).padStart(2, "0");
  const mi = String(data.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} às ${hh}:${mi}`;
}
