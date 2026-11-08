// Textos e datas dos convites (TASK-0105). Datas sempre no dia de São Paulo, nunca no fuso do aparelho.
import { brand } from "../../shared/brand";

const FUSO = "America/Sao_Paulo";

// Criado uma vez no módulo: instanciar Intl.DateTimeFormat a cada chamada é caro.
const formatoDiaMes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });

// Frase do pé do link no convite do cônjuge (ShareLink): quem abre primeiro entra como cônjuge.
export const DICA_DO_CONVITE =
  "Mande por um canal de confiança: quem abrir o link primeiro entra como cônjuge.";

// Frase do pé do link de recuperação: quem abre primeiro entra como a pessoa que perdeu o acesso.
export function dicaDaRecuperacao(nome: string): string {
  return `Mande por um canal de confiança: quem abrir o link primeiro entra como ${nome}.`;
}

// DD/MM do vencimento, no dia de São Paulo.
export function diaEMes(iso: string): string {
  return formatoDiaMes.format(new Date(iso));
}

export const TITULO_DO_COMPARTILHAMENTO = `Convite para o ${brand.name}`;

// Texto que vai junto do link no compartilhamento do sistema (WhatsApp, e-mail, o que o aparelho oferecer).
export function textoDoCompartilhamento(quemConvida: string, expiraEm: string): string {
  return `${quemConvida} convidou você para o ${brand.name}. Abra o link para entrar (vale até ${diaEMes(expiraEm)}):`;
}

// Os quatro itens de "Vocês dois vão poder" (protótipo AdicionarConjuge e o passo 3 do cadastro).
export const VOCES_DOIS_VAO_PODER = [
  "Ver cartões, contas, renda e relatórios do casal",
  "Conectar a própria conta Meu Pluggy",
  "Categorizar, renomear e ocultar compras e Pix",
  "Concluir o balanço do mês e mudar as configurações",
];
