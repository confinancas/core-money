import { createInterface } from "node:readline";
import QRCode from "qrcode";

// Entrada e saída do terminal, injetáveis para os testes (TASK-0101).
export type Terminal = {
  escreve(linha: string): void;
  pergunta(texto: string): Promise<string>;
};

export function terminalDoProcesso(): Terminal {
  return {
    escreve(linha) {
      console.log(linha);
    },
    pergunta(texto) {
      return new Promise((resolver) => {
        const leitura = createInterface({ input: process.stdin, output: process.stdout });
        let respondida = false;
        // Se a entrada fechar sem resposta, vale resposta vazia (o fluxo trata como "não").
        leitura.on("close", () => {
          if (!respondida) resolver("");
        });
        leitura.question(texto, (resposta) => {
          respondida = true;
          resolver(resposta);
          leitura.close();
        });
      });
    },
  };
}

// Caixa de destaque com bordas simples. Sem emoji, para que o alinhamento não quebre.
export function caixa(linhas: string[]): string {
  const largura = Math.max(...linhas.map((linha) => linha.length));
  const borda = "─".repeat(largura + 2);
  return [`┌${borda}┐`, ...linhas.map((linha) => `│ ${linha.padEnd(largura)} │`), `└${borda}┘`].join("\n");
}

export function qrParaTerminal(texto: string): Promise<string> {
  return QRCode.toString(texto, { type: "terminal", small: true });
}

// Pergunta s/n. Com --sim, responde sim sem perguntar e deixa a linha no terminal.
export async function confirma(terminal: Terminal, pergunta: string, sim: boolean): Promise<boolean> {
  if (sim) {
    terminal.escreve(`${pergunta} (s/n) s (--sim)`);
    return true;
  }
  const resposta = (await terminal.pergunta(`${pergunta} (s/n) `)).trim().toLowerCase();
  return resposta === "s" || resposta === "sim";
}
