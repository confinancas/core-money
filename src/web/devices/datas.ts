// Datas e horas dos aparelhos e da recuperação (TASK-0106). Sempre no dia e na hora de São Paulo, nunca no fuso do
// aparelho. Os formatos são os da spec: DD/MM/AAAA para a data do aparelho, HH:MM para o vencimento do link.
const FUSO = "America/Sao_Paulo";

const formatoDiaMesAno = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const formatoHoraMinuto = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const formatoDiaMes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
});

// "Adicionado em DD/MM/AAAA" e "último uso DD/MM/AAAA".
export function dataDoAparelho(iso: string): string {
  return formatoDiaMesAno.format(new Date(iso));
}

// "vale até HH:MM" do link de recuperação.
export function horaDoLink(iso: string): string {
  return formatoHoraMinuto.format(new Date(iso));
}

// "entrou em DD/MM às HH:MM" do aviso de aparelho novo.
export function diaEHoraDoAviso(iso: string): { dia: string; hora: string } {
  return { dia: formatoDiaMes.format(new Date(iso)), hora: formatoHoraMinuto.format(new Date(iso)) };
}
