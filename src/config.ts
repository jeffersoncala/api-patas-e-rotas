import { z } from 'zod';

/** Segredo fixo só para desenvolvimento e testes; produção exige JWT_SECRET. */
const SEGREDO_DEV = 'segredo-de-desenvolvimento-nao-use-em-producao!';

/** Postgres local para desenvolvimento; produção exige DATABASE_URL (os testes usam PGlite). */
const BANCO_DEV = 'postgres://postgres:postgres@localhost:5432/pataserotas';

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().optional(),
    JWT_SECRET: z.string().optional(),
    ACCESS_TOKEN_TTL_SEGUNDOS: z.coerce.number().int().positive().default(3600),
    REFRESH_TOKEN_TTL_DIAS: z.coerce.number().int().positive().default(30),
    CORS_ORIGIN: z.string().default('http://localhost:4200'),
    FRONT_URL: z.url().default('http://localhost:4200'),
  })
  .transform((env, ctx) => {
    const segredo = env.JWT_SECRET || (env.NODE_ENV === 'production' ? '' : SEGREDO_DEV);
    if (segredo.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET é obrigatório em produção e precisa de ao menos 32 caracteres',
      });
      return z.NEVER;
    }
    const urlBanco = env.DATABASE_URL || (env.NODE_ENV === 'production' ? '' : BANCO_DEV);
    if (!urlBanco) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL é obrigatório em produção',
      });
      return z.NEVER;
    }
    return {
      ambiente: env.NODE_ENV,
      host: env.HOST,
      porta: env.PORT,
      urlBanco,
      jwtSegredo: segredo,
      accessTokenTtlSegundos: env.ACCESS_TOKEN_TTL_SEGUNDOS,
      refreshTokenTtlDias: env.REFRESH_TOKEN_TTL_DIAS,
      origensCors: env.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      urlFront: env.FRONT_URL.replace(/\/$/, ''),
    };
  });

export type Config = z.output<typeof esquema>;

/** Lê e valida as variáveis de ambiente; falha logo no startup se algo estiver errado. */
export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    throw new Error(`Configuração inválida:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}
