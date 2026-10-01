import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const TAMANHO_CHAVE = 64;

/**
 * Custo do scrypt. 2^16 com r=8 usa 64 MiB por hash, dentro do recomendado pelo OWASP.
 * Nos testes o custo cai para o hash não dominar o tempo da suíte.
 */
export const CUSTO_PADRAO = 2 ** 16;
export const CUSTO_TESTE = 2 ** 10;

function derivar(senha: string, sal: Buffer, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, falha) =>
    scrypt(senha.normalize('NFKC'), sal, TAMANHO_CHAVE, opcoes, (erro, chave) =>
      erro ? falha(erro) : ok(chave),
    ),
  );
}

const opcoesPara = (N: number): ScryptOptions => ({ N, r: 8, p: 1, maxmem: 256 * N * 8 });

/** Formato guardado: `scrypt$N$sal$hash` (base64url). O N vai junto para permitir subir o custo depois. */
export async function gerarHashSenha(senha: string, custo = CUSTO_PADRAO): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, opcoesPara(custo));
  return ['scrypt', custo, sal.toString('base64url'), chave.toString('base64url')].join('$');
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [algoritmo, custo, sal, hash] = guardado.split('$');
  if (algoritmo !== 'scrypt' || !custo || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const chave = await derivar(senha, Buffer.from(sal, 'base64url'), opcoesPara(Number(custo)));
  return chave.length === esperado.length && timingSafeEqual(chave, esperado);
}
