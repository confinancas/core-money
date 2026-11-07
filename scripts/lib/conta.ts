import { confirma, type Terminal } from "./terminal";
import type { ContaCloudflare, Wrangler } from "./wrangler";

// Passo 2 da instalação e primeiro passo da recuperação (TASK-0101): confere a autenticação e a conta antes de
// qualquer escrita. Devolve a conta escolhida, ou undefined quando o comando deve sair (a mensagem já foi impressa).
// Com mais de uma conta, a pessoa escolhe pelo número; a conta vai para o wrangler por CLOUDFLARE_ACCOUNT_ID.
export async function confirmaConta(
  wrangler: Wrangler,
  terminal: Terminal,
  sim: boolean,
  definirConta: (id: string) => void,
): Promise<ContaCloudflare | undefined> {
  const autenticacao = await wrangler.whoami();
  if (!autenticacao.autenticada) {
    terminal.escreve(
      "Sem autenticação na Cloudflare. Há duas formas: ponha CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID no arquivo .env desta pasta, ou rode npx wrangler login. Nada foi publicado.",
    );
    return undefined;
  }
  const { contas } = autenticacao;
  if (contas.length === 0) {
    terminal.escreve("A autenticação não tem nenhuma conta da Cloudflare. Nada foi feito.");
    return undefined;
  }

  let escolhida = contas[0];
  if (contas.length > 1) {
    if (sim) {
      terminal.escreve("Com --sim, a autenticação precisa ter uma conta só. Nada foi feito.");
      return undefined;
    }
    terminal.escreve("A autenticação tem mais de uma conta da Cloudflare:");
    for (const [posicao, conta] of contas.entries()) {
      terminal.escreve(`  ${posicao + 1}. ${conta.nome} (${conta.id})`);
    }
    const numero = Number((await terminal.pergunta("Qual conta usar? (número) ")).trim());
    if (!Number.isInteger(numero) || numero < 1 || numero > contas.length) {
      terminal.escreve("Número de conta inválido. Nada foi feito.");
      return undefined;
    }
    escolhida = contas[numero - 1];
  }

  terminal.escreve(`Vou usar a conta da Cloudflare: ${escolhida.nome} (${escolhida.id}).`);
  if (!(await confirma(terminal, "Continuar?", sim))) {
    terminal.escreve("Nada foi feito.");
    return undefined;
  }
  definirConta(escolhida.id);
  return escolhida;
}
