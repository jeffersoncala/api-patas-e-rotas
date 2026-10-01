import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const EMISSOR = 'pataserotas-api';
const PUBLICO = 'pataserotas-app';

export interface ClaimsAcesso {
  /** id do usuário */
  sub: string;
  /** id da sessão: permite revogar o access token no logout, antes de ele expirar */
  sid: string;
}

export class Tokens {
  private readonly chave: Uint8Array;

  constructor(
    segredo: string,
    private readonly ttlSegundos: number,
  ) {
    this.chave = new TextEncoder().encode(segredo);
  }

  async emitirAcesso({ sub, sid }: ClaimsAcesso): Promise<{ token: string; expiraEm: Date }> {
    const expiraEm = new Date(Date.now() + this.ttlSegundos * 1000);
    const token = await new SignJWT({ sid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(EMISSOR)
      .setAudience(PUBLICO)
      .setIssuedAt()
      .setExpirationTime(expiraEm)
      .sign(this.chave);
    return { token, expiraEm };
  }

  /** Lança se a assinatura, o emissor, o público ou a validade não baterem. */
  async verificarAcesso(token: string): Promise<ClaimsAcesso> {
    const { payload } = await jwtVerify(token, this.chave, {
      issuer: EMISSOR,
      audience: PUBLICO,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') {
      throw new Error('Token sem sub/sid');
    }
    return { sub: payload.sub, sid: payload['sid'] };
  }
}

/** Token opaco e aleatório (refresh, redefinição de senha). Só o hash vai para o banco. */
export function gerarTokenOpaco(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
