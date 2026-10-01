import type { IncomingMessage, ServerResponse } from 'node:http';
import { criarApp } from './app.js';
import { carregarConfig } from './config.js';
import { abrirBanco } from './db/cliente.js';

/**
 * Entrada da função serverless da Vercel (`api/index.js`). O app é montado uma vez por
 * instância e reaproveitado entre as requisições; não há `listen`, a Vercel entrega cada
 * requisição para o servidor HTTP interno do Fastify.
 */
const config = carregarConfig();
const app = await criarApp({
  config,
  banco: abrirBanco(config.urlBanco),
  logger: { level: 'info' },
});
await app.ready();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit('request', req, res);
}
