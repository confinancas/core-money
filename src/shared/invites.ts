// Convites de cônjuge (TASK-0105): o que a API devolve e o que as telas leem. O link só vem na resposta de criar
// e de gerar novo; a lista e a consulta pelo token nunca trazem o token.

// Um convite do lar (GET /api/invites e a resposta de criar): o que o titular vê.
export type ConviteDoLar = {
  id: string;
  kind: "conjuge";
  name: string | null;
  email: string | null;
  expiresAt: string;
  createdByName: string;
};

// POST /api/invites/conjuge e POST /api/invites/:id/renew: o convite e o link, uma vez.
export type ConviteCriado = {
  invite: ConviteDoLar;
  link: string;
};

// POST /api/invites/inspect: o que a pessoa que abre o link vê antes de criar o acesso.
export type ConviteParaAbrir = {
  kind: "conjuge";
  invitedBy: string;
  name: string | null;
  email: string | null;
  expiresAt: string;
};
