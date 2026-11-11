import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { IconeCadeado } from "../../../components/icons";

export type ChavesDaTela = { clientId: string; clientSecret: string };

type Props = {
  rotulo: string;
  chaves: ChavesDaTela;
  aoMudar: (campo: keyof ChavesDaTela, valor: string) => void;
  testado: boolean;
  testando: boolean;
  erro: string | null;
  // Modo "trocar": só este passo, com "Salvar chaves" no lugar de "Continuar".
  modo: "nova" | "trocar";
  salvando: boolean;
  aoTestar: () => void;
  aoContinuar: () => void;
  aoSalvar: () => void;
  aoVoltar: () => void;
};

// Passo 2 (TASK-0203): as chaves digitadas. Ficam só na memória da tela até o passo 3; nunca voltam do servidor.
export function StepChaves({
  rotulo,
  chaves,
  aoMudar,
  testado,
  testando,
  erro,
  modo,
  salvando,
  aoTestar,
  aoContinuar,
  aoSalvar,
  aoVoltar,
}: Props) {
  const preenchidas = chaves.clientId.trim() !== "" && chaves.clientSecret.trim() !== "";

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (modo === "trocar") aoSalvar();
    else if (testado) aoContinuar();
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[24px] font-extrabold tracking-[-0.3px]">Cole as chaves da API</h2>
        <p className="text-[14px] leading-normal text-ink-2">
          No site do Meu Pluggy, abra <b className="text-ink">dashboard.pluggy.ai › API Keys</b> e copie as
          duas chaves da {rotulo}.
        </p>
      </div>

      <TextField
        label="Client ID"
        name="client-id"
        autoComplete="off"
        spellCheck={false}
        value={chaves.clientId}
        onChange={(evento) => aoMudar("clientId", evento.target.value)}
      />
      <TextField
        label="Client Secret"
        name="client-secret"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={chaves.clientSecret}
        onChange={(evento) => aoMudar("clientSecret", evento.target.value)}
      />

      {erro && (
        <p role="alert" className="text-[13px] text-danger">
          {erro}
        </p>
      )}

      <Button
        variant="secondary"
        full
        loading={testando}
        disabled={!preenchidas || testando || salvando}
        onClick={aoTestar}
      >
        {testado ? "✓ Chaves funcionando" : "Testar chaves"}
      </Button>

      <div className="flex items-start gap-2.5 rounded-field bg-success-bg px-3.5 py-3 text-[12px] leading-normal text-ink-2">
        <IconeCadeado size={18} className="mt-px shrink-0 text-success-ink" />
        <span>As chaves ficam criptografadas no servidor de vocês e nunca aparecem de novo no app.</span>
      </div>

      {modo === "trocar" ? (
        <Button type="submit" full loading={salvando} disabled={!preenchidas || salvando || testando}>
          Salvar chaves
        </Button>
      ) : (
        <>
          <Button type="submit" full disabled={!testado || testando}>
            Continuar
          </Button>
          <Button variant="secondary" full onClick={aoVoltar}>
            Voltar
          </Button>
        </>
      )}
    </form>
  );
}
