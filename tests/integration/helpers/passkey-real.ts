// Passkey real para os testes de integração: um par de chaves P-256 e a asserção assinada como o authenticator
// assinaria (dados de autenticação, contador, flags, clientDataJSON e assinatura DER). Assim o verificador de
// verdade (@simplewebauthn/server) confere a resposta, inclusive a flag de verificação do usuário.

const FLAG_PRESENCA = 0x01;
const FLAG_VERIFICACAO_DO_USUARIO = 0x04;

function concatena(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0);
  const saida = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }
  return saida;
}

function base64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const utf8 = (texto: string) => new TextEncoder().encode(texto);

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// Chave COSE (EC2, P-256, ES256) de um ponto não comprimido: o mapa de 5 pares em CBOR.
function chaveCose(ponto: Uint8Array): Uint8Array {
  const x = ponto.slice(1, 33);
  const y = ponto.slice(33, 65);
  return concatena(
    new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    new Uint8Array([0x22, 0x58, 0x20]),
    y,
  );
}

// Inteiro do DER: sem zeros à frente, com 0x00 se o bit alto estiver ligado.
function inteiroDer(bytes: Uint8Array): Uint8Array {
  let inicio = 0;
  while (inicio < bytes.length - 1 && bytes[inicio] === 0) inicio++;
  const valor = bytes.slice(inicio);
  const ajustado = valor[0] !== undefined && valor[0] & 0x80 ? concatena(new Uint8Array([0]), valor) : valor;
  return concatena(new Uint8Array([0x02, ajustado.length]), ajustado);
}

// A assinatura do WebCrypto vem em r||s (64 bytes); a WebAuthn usa DER.
function paraDer(bruta: Uint8Array): Uint8Array {
  const corpo = concatena(inteiroDer(bruta.slice(0, 32)), inteiroDer(bruta.slice(32, 64)));
  return concatena(new Uint8Array([0x30, corpo.length]), corpo);
}

export type PasskeyReal = {
  credentialId: string;
  publicKey: string;
  privateKey: CryptoKey;
};

export async function criaPasskeyReal(credentialId: string): Promise<PasskeyReal> {
  const par = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const ponto = new Uint8Array((await crypto.subtle.exportKey("raw", par.publicKey)) as ArrayBuffer);
  return {
    credentialId,
    publicKey: base64Url(chaveCose(ponto)),
    privateKey: par.privateKey,
  };
}

// A resposta de login (AuthenticationResponseJSON) assinada para um desafio. Com verificacaoDoUsuario, a flag UV vai ligada.
export async function assinaAsercao(
  passkey: PasskeyReal,
  opcoes: {
    challenge: string;
    rpId: string;
    origin: string;
    verificacaoDoUsuario: boolean;
    contador: number;
  },
): Promise<Record<string, unknown>> {
  const flags = FLAG_PRESENCA | (opcoes.verificacaoDoUsuario ? FLAG_VERIFICACAO_DO_USUARIO : 0);
  const contador = new Uint8Array([0, 0, 0, opcoes.contador]);
  const dadosDeAutenticacao = concatena(await sha256(utf8(opcoes.rpId)), new Uint8Array([flags]), contador);
  const clientDataJSON = utf8(
    JSON.stringify({
      type: "webauthn.get",
      challenge: opcoes.challenge,
      origin: opcoes.origin,
      crossOrigin: false,
    }),
  );
  const assinado = concatena(dadosDeAutenticacao, await sha256(clientDataJSON));
  const bruta = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, passkey.privateKey, assinado),
  );
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: "public-key",
    response: {
      authenticatorData: base64Url(dadosDeAutenticacao),
      clientDataJSON: base64Url(clientDataJSON),
      signature: base64Url(paraDer(bruta)),
    },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
}
