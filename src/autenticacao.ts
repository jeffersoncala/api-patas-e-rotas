import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessoes } from './db/schema.js';
import { naoAutorizado } from './erros.js';

export interface UsuarioAutenticado {
  id: string;
  sessaoId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo hook `autenticar`; `null` nas rotas públicas. */
    usuario: UsuarioAutenticado | null;
  }
}

/**
 * Hook `onRequest` das rotas protegidas: exige `Authorization: Bearer <accessToken>`.
 *
 * Além da assinatura, confere se a sessão do token ainda está ativa. É uma consulta por
 * chave primária no SQLite local, barata, e é o que faz o logout valer na hora (na API
 * Java, que validava só a assinatura, o token revogado seguia aceito até expirar).
 */
export async function autenticar(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const [tipo, token] = req.headers.authorization?.split(' ') ?? [];
  if (tipo?.toLowerCase() !== 'bearer' || !token) {
    throw naoAutorizado();
  }

  let claims;
  try {
    claims = await req.server.tokens.verificarAcesso(token);
  } catch {
    throw naoAutorizado();
  }

  const sessao = req.server.banco
    .select({ id: sessoes.id })
    .from(sessoes)
    .where(
      and(
        eq(sessoes.id, claims.sid),
        eq(sessoes.usuarioId, claims.sub),
        isNull(sessoes.revogadaEm),
        gt(sessoes.expiraEm, new Date()),
      ),
    )
    .get();
  if (!sessao) {
    throw naoAutorizado('Sessão encerrada. Entre novamente');
  }

  req.usuario = { id: claims.sub, sessaoId: claims.sid };
}

/** Usuário da requisição em rotas protegidas (o hook já garantiu que existe). */
export function usuarioDe(req: FastifyRequest): UsuarioAutenticado {
  if (!req.usuario) throw naoAutorizado();
  return req.usuario;
}
