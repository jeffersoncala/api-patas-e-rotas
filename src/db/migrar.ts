import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { carregarConfig } from '../config.js';
import { abrirBanco, PASTA_MIGRACOES } from './cliente.js';

// Aplica as migrações pendentes. Rode antes de publicar uma versão que mude o schema.
const config = carregarConfig();
const banco = abrirBanco(config.urlBanco);
await migrate(banco, { migrationsFolder: PASTA_MIGRACOES });
await banco.$client.end();
console.log('Migrações aplicadas');
