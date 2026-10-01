import { criarApp } from './app.js';
import { carregarConfig } from './config.js';
import { abrirBanco } from './db/cliente.js';

const config = carregarConfig();
const banco = abrirBanco(config.urlBanco);

const app = await criarApp({
  config,
  banco,
  logger:
    config.ambiente === 'development'
      ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
      : { level: 'info' },
});

// Encerramento gracioso: termina as requisições em andamento e fecha as conexões.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, async () => {
    app.log.info(`${sinal} recebido, encerrando`);
    await app.close();
    await banco.$client.end();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.host, port: config.porta });
  app.log.info(`Documentação em http://localhost:${config.porta}/docs`);
} catch (erro) {
  app.log.fatal(erro);
  process.exit(1);
}
