// Código de primeiro acesso e tokens de convite e recuperação (TASK-0101). Só WebCrypto, para rodar no Worker e no Node 22.
// O banco guarda só o hash: sha256Hex(normalizeAccessCode(código)) para o código, sha256Hex(token) para os links.
// O código em texto aparece só no terminal e no QR code; o token, só no link que a pessoa abre.

// Crockford: sem I, L, O e U, para não confundir na leitura.
export const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CARACTERES_DO_CODIGO = 12;

// 12 caracteres de 5 bits (32 símbolos): 60 bits. Como 256 é múltiplo de 32, byte & 31 não vicia a escolha.
export function generateAccessCode(): string {
  const bytes = new Uint8Array(CARACTERES_DO_CODIGO);
  crypto.getRandomValues(bytes);
  const letras = Array.from(bytes, (byte) => ALFABETO_CODIGO[byte & 31]).join("");
  return `${letras.slice(0, 4)}-${letras.slice(4, 8)}-${letras.slice(8, 12)}`;
}

// Maiúsculas, sem espaços nem hífens, e as letras que se confundem com dígitos viram dígitos (O→0, I e L→1).
export function normalizeAccessCode(texto: string): string {
  return texto.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

// Links de convite e de recuperação: 32 bytes aleatórios em base64url, sem preenchimento (43 caracteres).
export function generateLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binario = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// SHA-256 do texto em hexadecimal minúsculo. Usado para o código normalizado e para os tokens.
export async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
