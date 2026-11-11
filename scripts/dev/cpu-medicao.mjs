// Lógica pura da medição de CPU (TASK-0010): impressão digital do lar, escolha entre reaproveitar e gravar, junção dos
// eventos do tail, nova tentativa da rota que perdeu evento e ordem de esvaziamento. Sem rede e sem disco: quem chama é
// scripts/dev/measure-cpu.mjs (e cpu-flows.mjs, pela ordem). Os tipos vêm de cpu-medicao.d.mts.

import { createHash } from "node:crypto";

// Tabela da medição no D1 de teste: criada pelo script, fora das migrações do app. O esvaziamento não a apaga.
export const TABELA_DA_MEDICAO = "_medicao_cpu";
export const AQUECIMENTO = 2;
export const MEDIDAS = 10;
export const LIMITE_MS = 10;

export function sha256(texto) {
  return createHash("sha256").update(String(texto)).digest("hex");
}

// Impressão digital do lar: o setupSql, a lista e o conteúdo das migrações do branch, o valor de esvaziarBanco e o código
// que esvazia o banco. Se qualquer um muda, o estado gravado não serve mais para a rodada.
export function impressaoDoLar({
  setupSql = [],
  migracoes = [],
  esvaziarBanco = false,
  codigoDoEsvaziamento = "",
}) {
  return sha256(
    JSON.stringify([
      sha256(JSON.stringify(setupSql)),
      migracoes.map(({ nome, conteudo }) => [nome, sha256(conteudo)]),
      esvaziarBanco === true,
      sha256(codigoDoEsvaziamento),
    ]),
  );
}

const soLeitura = (rota) => rota.method === "GET" && rota.via === undefined;

// A rodada não escreve no lar: só GET e nenhum fluxo de navegador. Só nesse caso o lar fica como o setupSql o deixou.
export function sohLeitura({ requests, flows }) {
  return (flows ?? []).length === 0 && requests.every(soLeitura);
}

// Reaproveita o lar só quando a impressão do banco é igual à do arquivo e a rodada só lê. Os outros casos gravam, como antes.
export function escolheLar({ impressaoDoBanco, impressaoDoArquivo, requests, flows }) {
  if ((flows ?? []).length > 0) return { modo: "gravar", motivo: "tem fluxo de navegador" };
  if (!requests.every(soLeitura)) return { modo: "gravar", motivo: "tem requisição que não é GET" };
  if (impressaoDoBanco === null || impressaoDoBanco === undefined) {
    return { modo: "gravar", motivo: "o banco não tem impressão do lar" };
  }
  if (impressaoDoBanco !== impressaoDoArquivo)
    return { modo: "gravar", motivo: "o setup ou as migrações mudaram" };
  return { modo: "reaproveitar", motivo: "impressão igual e só GET" };
}

// Objetos JSON concatenados (um por evento, com ou sem quebra de linha). Um evento ilegível não entra: a rota fica sem ele.
export function eventosDoTail(texto) {
  const objetos = [];
  let profundidade = 0;
  let emTexto = false;
  let escapado = false;
  let inicio = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escapado) escapado = false;
      else if (c === "\\") escapado = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === "{") {
      if (profundidade === 0) inicio = i;
      profundidade++;
    } else if (c === "}") {
      profundidade--;
      if (profundidade === 0 && inicio >= 0) {
        try {
          objetos.push(JSON.parse(texto.slice(inicio, i + 1)));
        } catch {
          // um evento ilegível vira "faltou evento" na contagem
        }
        inicio = -1;
      }
    }
  }
  return objetos;
}

// Só os eventos de requisição, com método, caminho, instante e CPU.
export function eventosDaRequisicao(objetos) {
  const eventos = [];
  for (const evento of objetos) {
    const requisicao = evento?.event?.request;
    if (typeof requisicao?.method !== "string" || typeof requisicao?.url !== "string") continue;
    let pathname;
    try {
      pathname = new URL(requisicao.url).pathname;
    } catch {
      continue;
    }
    eventos.push({
      method: requisicao.method,
      pathname,
      ts: Number(evento.eventTimestamp ?? 0),
      cpu: evento.cpuTime,
    });
  }
  return eventos;
}

// Caminho com {i} vira um padrão: /api/rules/cpu-regra-{i} casa com cpu-regra-1, cpu-regra-2... (qualquer número).
// {id} casa com um segmento qualquer (o id do convite é um UUID gerado pelo Worker).
export function padraoDoCaminho(caminho) {
  const escapado = caminho.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapado.split("\\{i\\}").join("\\d+").split("\\{id\\}").join("[^/]+")}$`);
}

// Os eventos da rota (mesmo método, caminho casando com o padrão), em ordem de chegada.
export function eventosDaRota(rota, eventos) {
  const padrao = padraoDoCaminho(rota.path);
  return eventos
    .filter((evento) => evento.method === rota.method && padrao.test(evento.pathname))
    .sort((a, b) => a.ts - b.ts);
}

export function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

// Mede a rota: descarta o aquecimento e pega as medidas. Menos eventos que o necessário (ou um sem CPU) é "faltou".
export function medeRota(rota, eventos) {
  const medidos = eventosDaRota(rota, eventos).slice(AQUECIMENTO, AQUECIMENTO + MEDIDAS);
  if (medidos.length < MEDIDAS || medidos.some((evento) => typeof evento.cpu !== "number")) {
    return { name: rota.name, method: rota.method, path: rota.path, n: medidos.length, faltou: true };
  }
  const cpus = medidos.map((evento) => evento.cpu);
  return {
    name: rota.name,
    method: rota.method,
    path: rota.path,
    n: cpus.length,
    medianaMs: mediana(cpus),
    maximaMs: Math.max(...cpus),
    cpuMs: cpus,
    faltou: false,
  };
}

// Junção: o texto do tail (o que já chegou) vira eventos, e cada rota é medida pelos eventos que casam com ela.
export function mediaTail(rotas, texto) {
  const eventos = eventosDaRequisicao(eventosDoTail(texto));
  return rotas.map((rota) => medeRota(rota, eventos));
}

// Rotas que faltaram e ainda não tiveram a nova tentativa. Cada uma é medida de novo uma vez: depois disso, falha.
export function rotasParaRemedir(rotas, resultados, jaRemedidas) {
  return rotas.filter((rota, indice) => resultados[indice]?.faltou === true && !jaRemedidas.has(rota));
}

// Veredito: falha se alguma rota ainda faltou (depois da nova tentativa) ou se alguma mediana passou do limite.
export function avaliaResultados(resultados) {
  const faltaram = resultados.filter((resultado) => resultado.faltou).map((resultado) => resultado.name);
  const acima = resultados
    .filter((resultado) => !resultado.faltou && resultado.medianaMs >= LIMITE_MS)
    .map((resultado) => resultado.name);
  return { ok: faltaram.length === 0 && acima.length === 0, faltaram, acima };
}

// Ordem de esvaziamento: filhos antes dos pais, pelas chaves estrangeiras do CREATE TABLE. A tabela da medição fica de fora.
export function ordemDeEsvaziamento(tabelas) {
  const visiveis = tabelas.filter(({ name }) => name !== TABELA_DA_MEDICAO);
  const pais = new Map(visiveis.map((linha) => [linha.name, new Set()]));
  for (const { name: filho, sql } of visiveis) {
    for (const casa of String(sql ?? "").matchAll(/REFERENCES\s+[`"[]?(\w+)/gi)) {
      const pai = casa[1];
      if (pais.has(pai) && pai !== filho) pais.get(filho).add(pai);
    }
  }
  const ordem = [];
  while (pais.size > 0) {
    const referenciadas = new Set([...pais.values()].flatMap((conjunto) => [...conjunto]));
    const saem = [...pais.keys()].filter((nome) => !referenciadas.has(nome));
    const lote = saem.length > 0 ? saem : [...pais.keys()];
    for (const nome of lote) {
      ordem.push(nome);
      pais.delete(nome);
    }
  }
  return ordem;
}
