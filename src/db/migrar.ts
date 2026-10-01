import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { carregarConfig } from '../config.js';
import { abrirBanco, PASTA_MIGRACOES } from './cliente.js';

// Aplica as migrações pendentes. Rode antes de publicar uma versão que mude o schema.
// No build da Vercel o NODE_ENV não é "production", então sem esta checagem o config
// cairia no Postgres local de desenvolvimento e o erro seria um ECONNREFUSED confuso.
if (process.env['VERCEL'] && !process.env['DATABASE_URL']) {
  console.error(
    'DATABASE_URL não está disponível no build da Vercel. Cadastre a variável no ambiente Production.',
  );
  process.exit(1);
}
const config = carregarConfig();
const banco = abrirBanco(config.urlBanco);
try {
  await migrate(banco, { migrationsFolder: PASTA_MIGRACOES });
  console.log('Migrações aplicadas');
} catch (e) {
  // O DrizzleQueryError só mostra a query; o erro real do Postgres/rede fica em `cause`.
  const causa = e instanceof Error && e.cause ? e.cause : e;
  console.error('Falha ao aplicar migrações:', causa);
  process.exitCode = 1;
} finally {
  await banco.$client.end({ timeout: 5 });
}
