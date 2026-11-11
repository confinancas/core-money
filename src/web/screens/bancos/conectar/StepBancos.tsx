import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";
import {
  autorizacaoDoBanco,
  cpfParaTela,
  podeConectarBancos,
  siglaDoBanco,
  textoDoBotaoDeBancos,
} from "./view-model";

// Um banco na tela de escolha: o que o Pluggy disse sobre o id colado, e o nome que a pessoa digitou (se preciso).
export type CartaoDeBanco = {
  itemId: string;
  nomeDeduzido: string | null;
  cor: string;
  resumo: string;
  consentExpiresAt: string | null;
  jaConectado: boolean;
  selecionado: boolean;
  nomeDigitado: string;
  erro: string | null;
};

type Props = {
  rotulo: string;
  bancos: CartaoDeBanco[];
  // Mostra o texto do passo, ou o de "autorizar outro banco desta conta" quando a conta já existe.
  modo: "nova" | "outro-banco";
  cpfMascarado: string | null;
  adicionando: boolean;
  erroDoId: string | null;
  erroGeral: string | null;
  enviando: boolean;
  aoAdicionar: (id: string) => void;
  aoEscolher: (itemId: string) => void;
  aoNomear: (itemId: string, nome: string) => void;
  aoConectar: () => void;
  aoVoltar: () => void;
};

const LINK_DO_MEU_PLUGGY = "https://meu.pluggy.ai";
const FORMATO_DO_ID = /^[0-9A-Za-z-]{1,100}$/;

// Passo 3 (TASK-0203): o id de cada banco, colado do dashboard, e os cartões dos bancos já autorizados.
export function StepBancos({
  rotulo,
  bancos,
  modo,
  cpfMascarado,
  adicionando,
  erroDoId,
  erroGeral,
  enviando,
  aoAdicionar,
  aoEscolher,
  aoNomear,
  aoConectar,
  aoVoltar,
}: Props) {
  const [id, setId] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const cpf = cpfParaTela(cpfMascarado);
  const escolhidos = bancos.filter((banco) => banco.selecionado);

  function adicionar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpo = id.trim();
    if (!FORMATO_DO_ID.test(limpo)) {
      setErroLocal("Confira se copiou o id inteiro: ele é um código com letras, números e traços.");
      return;
    }
    setErroLocal(null);
    aoAdicionar(limpo);
    setId("");
  }

  // O botão de conectar fica fora do formulário do id (formulários não se aninham): o clique confere os nomes.
  function conectar() {
    const prontos = podeConectarBancos(
      escolhidos.map((banco) => ({ nomeDeduzido: banco.nomeDeduzido, nomeDigitado: banco.nomeDigitado })),
    );
    if (prontos) aoConectar();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {modo === "outro-banco" && (
          <p className="text-[13px] font-bold uppercase tracking-[1px] text-primary">
            Autorizar outro banco desta conta
          </p>
        )}
        <h2 className="text-[24px] font-extrabold tracking-[-0.3px]">Cole o id de cada banco</h2>
        <p className="text-[14px] leading-normal text-ink-2">
          O Meu Pluggy não deixa o app ver a lista sozinho. No dashboard.pluggy.ai, abra Applications › sua
          aplicação › Demo › Connect Account, escolha MeuPluggy, entre com a {rotulo} e copie o id de cada
          banco em Connected Items.
        </p>
        {cpf !== null && <p className="text-[12px] text-ink-2">{cpf}</p>}
      </div>

      <form
        onSubmit={adicionar}
        noValidate
        className="flex flex-col gap-3"
        aria-label="Adicionar um id de banco"
      >
        <TextField
          label="Id do banco no Meu Pluggy"
          name="id-do-banco"
          autoComplete="off"
          spellCheck={false}
          value={id}
          onChange={(evento) => setId(evento.target.value)}
          error={erroLocal ?? erroDoId ?? undefined}
        />
        <Button
          type="submit"
          variant="secondary"
          full
          loading={adicionando}
          disabled={id.trim() === "" || adicionando}
        >
          Adicionar
        </Button>
      </form>

      {bancos.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {bancos.map((banco) => (
            <li key={banco.itemId}>
              <CartaoDoBanco banco={banco} aoEscolher={aoEscolher} aoNomear={aoNomear} />
            </li>
          ))}
        </ul>
      )}

      {erroGeral && (
        <p role="alert" className="text-[13px] text-danger">
          {erroGeral}
        </p>
      )}

      <a
        href={LINK_DO_MEU_PLUGGY}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center justify-center text-[14px] font-bold text-primary"
      >
        Autorizar outro banco no Meu Pluggy
      </a>

      <Button full loading={enviando} disabled={escolhidos.length === 0 || enviando} onClick={conectar}>
        {escolhidos.length === 0 ? "Escolha um banco" : textoDoBotaoDeBancos(escolhidos.length)}
      </Button>
      <Button variant="secondary" full onClick={aoVoltar} disabled={enviando}>
        Voltar
      </Button>
    </div>
  );
}

// Um banco: caixa de escolha (role checkbox), a sigla na cor do banco, o nome e o resumo das contas.
function CartaoDoBanco({
  banco,
  aoEscolher,
  aoNomear,
}: {
  banco: CartaoDeBanco;
  aoEscolher: (itemId: string) => void;
  aoNomear: (itemId: string, nome: string) => void;
}) {
  const nome = banco.nomeDeduzido ?? (banco.nomeDigitado.trim() === "" ? null : banco.nomeDigitado.trim());
  const textoDeAutorizacao = autorizacaoDoBanco(banco.consentExpiresAt);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-card border bg-card p-3",
        banco.selecionado ? "border-primary" : "border-field-border",
      )}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a spec pede role="checkbox" no cartão do banco (TASK-0203) */}
      <button
        type="button"
        role="checkbox"
        aria-checked={banco.selecionado}
        aria-disabled={banco.jaConectado || undefined}
        disabled={banco.jaConectado}
        onClick={() => aoEscolher(banco.itemId)}
        className="flex min-h-14 w-full items-center gap-3 text-left disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-extrabold text-white"
          style={{ backgroundColor: banco.cor }}
        >
          {siglaDoBanco(nome ?? "??")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold text-ink">{nome ?? "Banco sem nome"}</span>
          <span className="text-[12px] text-ink-2">
            {[banco.resumo, textoDeAutorizacao].filter((parte) => parte !== "").join(" · ")}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
            banco.selecionado ? "border-primary bg-primary" : "border-field-border",
          )}
        />
      </button>
      {banco.nomeDeduzido === null && !banco.jaConectado && (
        <TextField
          label="Nome do banco"
          name={`nome-do-banco-${banco.itemId}`}
          autoComplete="off"
          value={banco.nomeDigitado}
          onChange={(evento) => aoNomear(banco.itemId, evento.target.value)}
          error={banco.erro ?? undefined}
        />
      )}
      {banco.jaConectado && (
        <p role="alert" className="text-[13px] text-danger">
          {banco.erro}
        </p>
      )}
    </div>
  );
}
