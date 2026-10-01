import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Qualquer banco Postgres do Drizzle: postgres.js em produção, PGlite nos testes. */
export type Banco = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Pasta das migrações geradas pelo drizzle-kit (`npm run db:generate`). */
export const PASTA_MIGRACOES = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Conecta ao Postgres. Não aplica migrações: elas rodam à parte (`npm run db:migrate`),
 * para não pesar em cada cold start da Vercel.
 */
export function abrirBanco(url: string): PostgresJsDatabase<typeof schema> & {
  $client: postgres.Sql;
} {
  const cliente = postgres(url, {
    // O pooler de transações do Supabase (porta 6543) não suporta prepared statements.
    prepare: false,
    // Uma função serverless atende poucas requisições ao mesmo tempo; o pooler segura o resto.
    max: 5,
    idle_timeout: 20,
  });
  return drizzle({ client: cliente, schema });
}
