// Aparelhos de cada pessoa do lar (TASK-0106): o que GET /api/devices devolve e o que a tela e os avisos leem.
// Uma passkey é um aparelho (ADR-010). O id é o credential id; nenhum segredo sai daqui.
export type ComoFoiAdicionado = "cadastro" | "convite" | "aparelho" | "recuperacao";

export type AparelhoDaPessoa = {
  id: string;
  deviceName: string;
  addedVia: ComoFoiAdicionado;
  createdAt: string;
  lastUsedAt: string | null;
  // O aparelho que está usando esta tela.
  isCurrent: boolean;
};

export type PessoaComAparelhos = {
  id: string;
  name: string;
  role: "titular" | "conjuge";
  isMe: boolean;
  devices: AparelhoDaPessoa[];
};

export type ListaDeAparelhos = { members: PessoaComAparelhos[] };

// POST /api/devices/verify: o aparelho novo, como a lista o mostra.
export type AparelhoCriado = { device: AparelhoDaPessoa };

// Aviso de aparelho novo, na sessão (GET /api/auth/session): um aparelho entrou por recuperação.
export type AvisoDeAparelhoNovo = {
  kind: "aparelho_novo";
  passkeyId: string;
  deviceName: string;
  createdAt: string;
};
