import { semeiaSessaoDaInstalacaoPronta } from "./helpers/sessao";

// Uma vez por execução: a instalação pronta (8788) tem o lar, a pessoa e a sessão de teste (TASK-0104).
export default function globalSetup(): void {
  semeiaSessaoDaInstalacaoPronta();
}
