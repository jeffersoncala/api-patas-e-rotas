import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Banco = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Pasta das migrações geradas pelo drizzle-kit (`npm run db:generate`). */
const PASTA_MIGRACOES = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Abre o SQLite e aplica as migrações pendentes.
 * Use `':memory:'` nos testes: cada chamada ganha um banco novo e isolado.
 */
export function abrirBanco(arquivo: string): Banco {
  if (arquivo !== ':memory:') {
    mkdirSync(dirname(resolve(arquivo)), { recursive: true });
  }
  const sqlite = new Database(arquivo);
  // WAL deixa leituras e escrita concorrentes; foreign_keys vem desligado por padrão no SQLite.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const banco = drizzle({ client: sqlite, schema });
  migrate(banco, { migrationsFolder: PASTA_MIGRACOES });
  return banco;
}
