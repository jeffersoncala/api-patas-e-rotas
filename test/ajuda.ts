import { afterEach } from 'vitest';
import { criarApp, type App } from '../src/app.js';
import { carregarConfig } from '../src/config.js';
import { abrirBanco } from '../src/db/cliente.js';
import type { Email } from '../src/email.js';

const abertos: App[] = [];
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((app) => app.close()));
});

/** App com banco SQLite em memória, novo e vazio a cada chamada. */
export async function criarAppTeste() {
  const emails: Email[] = [];
  const app = await criarApp({
    config: carregarConfig({ NODE_ENV: 'test' }),
    banco: abrirBanco(':memory:'),
    enviarEmail: async (email) => {
      emails.push(email);
    },
  });
  abertos.push(app);
  return { app, emails };
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
