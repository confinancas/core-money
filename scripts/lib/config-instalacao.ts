import { applyEdits, modify, parse } from "jsonc-parser";
import { ErroDeUso } from "./marca";

// Configuração gerada a partir do wrangler.jsonc do app, só para a instalação (TASK-0101).
// Edita só name e o binding DB; o resto (crons, assets, flags, comentários e migrations_dir) fica como está.
export const CONFIG_DA_INSTALACAO = "wrangler.instalacao.jsonc";

export const CABECALHO_DA_CONFIG =
  "// Gerado por npm run instalar. Não edite: o próximo instalar sobrescreve.";

const FORMATACAO = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export type DadosDaConfig = { nome: string; bancoNome: string; bancoId: string };

export function geraConfigDaInstalacao(textoDoWranglerJsonc: string, dados: DadosDaConfig): string {
  const config = parse(textoDoWranglerJsonc) as { d1_databases?: unknown } | undefined;
  const bancos = Array.isArray(config?.d1_databases) ? (config.d1_databases as { binding?: unknown }[]) : [];
  const posicao = bancos.findIndex((banco) => banco?.binding === "DB");
  if (posicao < 0) {
    throw new ErroDeUso("O wrangler.jsonc do app precisa de um banco D1 com o binding DB.");
  }

  let texto = textoDoWranglerJsonc;
  const edita = (caminho: (string | number)[], valor: string) => {
    texto = applyEdits(texto, modify(texto, caminho, valor, { formattingOptions: FORMATACAO }));
  };
  edita(["name"], dados.nome);
  edita(["d1_databases", posicao, "database_name"], dados.bancoNome);
  edita(["d1_databases", posicao, "database_id"], dados.bancoId);
  return `${CABECALHO_DA_CONFIG}\n${texto}`;
}
