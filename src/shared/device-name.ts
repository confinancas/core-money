// Nome do aparelho da passkey, calculado no servidor pelo User-Agent (TASK-0103): "<sistema> · <navegador>".
// A ordem das listas importa: iPhone e iPad vêm antes de Mac (o UA deles traz "Mac OS X"); Android antes de
// Linux; Samsung Internet e Edge antes de Chrome, e Chrome antes de Safari (os UAs trazem "Chrome/" e "Safari/").
const SISTEMAS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

const NAVEGADORES: [RegExp, string][] = [
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const primeiroReconhecido = (lista: [RegExp, string][], texto: string): string | null =>
  lista.find(([padrao]) => padrao.test(texto))?.[1] ?? null;

// Sem reconhecer nem o sistema nem o navegador, o nome é "Aparelho". Com um dos dois, só esse aparece.
export function deviceNameFromUserAgent(userAgent: string | null | undefined): string {
  const texto = userAgent ?? "";
  const partes = [primeiroReconhecido(SISTEMAS, texto), primeiroReconhecido(NAVEGADORES, texto)].filter(
    (parte): parte is string => parte !== null,
  );
  const nome = partes.length > 0 ? partes.join(" · ") : "Aparelho";
  return nome.slice(0, 60);
}
