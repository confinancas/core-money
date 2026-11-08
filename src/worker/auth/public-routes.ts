// Rotas de /api que não exigem sessão (TASK-0104). Todo o resto de /api passa pelo requireSession.
// Entrada "MÉTODO /caminho" (exata) ou "/prefixo/*" (qualquer método), como em SETUP_OPEN_ROUTES.
// As tasks seguintes acrescentam as delas aqui.
export const PUBLIC_API_ROUTES: readonly string[] = [
  "GET /api/health",
  "/api/setup/*",
  "POST /api/auth/login/options",
  "POST /api/auth/login/verify",
  "POST /api/auth/logout",
  "GET /api/auth/session",
];

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_API_ROUTES.some((entrada) => {
    if (entrada.endsWith("/*")) return path.startsWith(entrada.slice(0, -1));
    const [metodoDaEntrada, caminhoDaEntrada] = entrada.split(" ");
    return method === metodoDaEntrada && path === caminhoDaEntrada;
  });
}
