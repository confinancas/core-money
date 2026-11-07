import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { caminhoDoWrangler, execucaoReal } from "../../../scripts/lib/wrangler";

// O spawn é trocado por um falso: este teste confere a forma da chamada (sem shell, CI=true, stdin) sem rodar o wrangler.
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn() };
});

const spawnFalso = vi.mocked(spawn);

function filhoFalso(codigo = 0, saida = "") {
  const stdin = { end: vi.fn() };
  const filho = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin,
  });
  setImmediate(() => {
    filho.stdout.emit("data", saida);
    filho.emit("close", codigo);
  });
  return filho;
}

describe("execucaoReal", () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it("roda o wrangler por caminho, sem shell, com CI=true e na pasta do app", async () => {
    spawnFalso.mockImplementation(() => filhoFalso(0, "{}") as unknown as ReturnType<typeof spawn>);
    const execucao = execucaoReal("/pasta/do/app", {});

    await execucao(["whoami", "--json"]);

    const [executavel, argumentos, opcoes] = spawnFalso.mock.calls[0] as unknown as [
      string,
      string[],
      { shell: boolean; cwd: string; env: Record<string, string>; stdio: unknown[] },
    ];
    expect(executavel).toBe(process.execPath);
    expect(argumentos).toEqual([caminhoDoWrangler(), "whoami", "--json"]);
    expect(opcoes.shell).toBe(false);
    expect(opcoes.cwd).toBe("/pasta/do/app");
    expect(opcoes.env.CI).toBe("true");
    expect(opcoes.stdio[0]).toBe("ignore");
  });

  it("a entrada vai pelo stdin, com o stdin aberto só nesse caso", async () => {
    const filho = filhoFalso(0);
    spawnFalso.mockImplementation(() => filho as unknown as ReturnType<typeof spawn>);
    const execucao = execucaoReal("/pasta/do/app", {});

    await execucao(["secret", "put", "MASTER_KEY"], { entrada: "valor-secreto" });

    const [, argumentos, opcoes] = spawnFalso.mock.calls[0] as unknown as [
      string,
      string[],
      { stdio: unknown[] },
    ];
    expect(argumentos).not.toContain("valor-secreto");
    expect(opcoes.stdio[0]).toBe("pipe");
    expect(filho.stdin.end).toHaveBeenCalledWith("valor-secreto");
  });

  it("o ambiente extra (a conta escolhida) entra no processo do wrangler", async () => {
    spawnFalso.mockImplementation(() => filhoFalso(0) as unknown as ReturnType<typeof spawn>);
    const ambiente = { CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };
    const execucao = execucaoReal("/pasta/do/app", ambiente);

    await execucao(["deploy"]);

    const opcoes = spawnFalso.mock.calls[0][2] as { env: Record<string, string> };
    expect(opcoes.env.CLOUDFLARE_ACCOUNT_ID).toBe("0123456789abcdef0123456789abcdef");
    expect(opcoes.env.WRANGLER_SEND_METRICS).toBe("false");
  });
});
