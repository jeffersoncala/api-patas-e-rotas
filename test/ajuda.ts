import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll } from 'vitest';
import { criarApp, type App } from '../src/app.js';
import type { Armazenamento } from '../src/armazenamento.js';
import { carregarConfig } from '../src/config.js';
import { PASTA_MIGRACOES } from '../src/db/cliente.js';
import * as schema from '../src/db/schema.js';
import type { Email } from '../src/email.js';

const abertos: { app: App; pg: PGlite }[] = [];
afterEach(async () => {
  await Promise.all(
    abertos.splice(0).map(async ({ app, pg }) => {
      await app.close();
      await pg.close();
    }),
  );
});

/** Banco já migrado, criado uma vez por arquivo de teste; cada teste usa uma cópia dele. */
let modelo: Promise<PGlite> | undefined;
const criarModelo = async () => {
  const pg = new PGlite();
  await migrate(drizzle({ client: pg }), { migrationsFolder: PASTA_MIGRACOES });
  return pg;
};
// Subir o PGlite (WASM) e migrar leva alguns segundos: fica fora do tempo dos testes.
beforeAll(async () => {
  await (modelo ??= criarModelo());
}, 60_000);

/** Storage em memória: `enviar` simula o PUT que o front faz na URL de upload. */
export function armazenamentoEmMemoria() {
  const arquivos = new Set<string>();
  const armazenamento: Armazenamento = {
    urlDeUpload: async (caminho) => `https://storage.teste/upload/${caminho}?token=x`,
    existe: async (caminho) => arquivos.has(caminho),
    urlsDeLeitura: async (caminhos) =>
      caminhos.map((c) => (arquivos.has(c) ? `https://storage.teste/ler/${c}?token=x` : null)),
    remover: async (caminhos) => caminhos.forEach((c) => arquivos.delete(c)),
  };
  return { armazenamento, arquivos, enviar: (caminho: string) => arquivos.add(caminho) };
}

/** App com um Postgres em memória (PGlite), novo e vazio a cada chamada. */
export async function criarAppTeste() {
  // `clone()` é tipado como a interface genérica, mas devolve um PGlite.
  const pg = (await (await (modelo ??= criarModelo())).clone()) as PGlite;
  const banco = drizzle({ client: pg, schema });

  const emails: Email[] = [];
  const storage = armazenamentoEmMemoria();
  const app = await criarApp({
    armazenamento: storage.armazenamento,
    config: carregarConfig({ NODE_ENV: 'test' }),
    banco,
    enviarEmail: async (email) => {
      emails.push(email);
    },
  });
  abertos.push({ app, pg });
  return { app, emails, storage };
}

let sequencia = 0;

/** Cadastra um tutor e devolve o header de autorização pronto para usar no `inject`. */
export async function cadastrar(
  app: App,
  dados: Partial<{ email: string; tutor: string; pet: string; password: string }> = {},
) {
  sequencia++;
  const corpo = {
    email: `tutor${sequencia}@exemplo.com`,
    password: 'segredo123',
    tutor: `Tutor ${sequencia}`,
    pet: `Pet ${sequencia}`,
    especie: 'cachorro',
    porte: 'medio',
    ...dados,
  };
  const resposta = await app.inject({ method: 'POST', url: '/auth/cadastro', payload: corpo });
  if (resposta.statusCode !== 201) {
    throw new Error(`Cadastro falhou (${resposta.statusCode}): ${resposta.body}`);
  }
  const login = resposta.json<{
    accessToken: string;
    refreshToken: string;
    usuario: { id: string };
  }>();
  return {
    ...login,
    corpo,
    headers: { authorization: `Bearer ${login.accessToken}` },
  };
}
