import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  armazenamentoIndisponivel,
  armazenamentoSupabase,
  type Armazenamento,
} from './armazenamento.js';
import type { Config } from './config.js';
import type { Banco } from './db/cliente.js';
import { registrarTratamentoDeErros } from './erros.js';
import { enviarEmailNoLog, type EnviarEmail } from './email.js';
import { CUSTO_PADRAO, CUSTO_TESTE } from './modulos/auth/senha.js';
import { Tokens } from './modulos/auth/tokens.js';
import { authEndpoints } from './modulos/auth/endpoints.js';
import { encontrosEndpoints } from './modulos/encontros/endpoints.js';
import { passeiosEndpoints } from './modulos/passeios/endpoints.js';
import { perfilEndpoints } from './modulos/perfil/endpoints.js';
import { rotasEndpoints } from './modulos/rotas/endpoints.js';

// Mensagens de validação do Zod em português (vão no campo `campos` das respostas 400).
z.config(z.locales.pt());

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    banco: Banco;
    tokens: Tokens;
    enviarEmail: EnviarEmail;
    armazenamento: Armazenamento;
    /** Custo do scrypt: menor nos testes. */
    custoSenha: number;
  }
}

export interface OpcoesApp {
  config: Config;
  banco: Banco;
  /** Por padrão só registra o e-mail no log; os testes trocam para capturar o link. */
  enviarEmail?: EnviarEmail;
  /** Por padrão usa o Supabase Storage da config; os testes trocam por um em memória. */
  armazenamento?: Armazenamento;
  logger?: FastifyServerOptions['logger'];
}

export async function criarApp({ config, banco, enviarEmail, armazenamento, logger }: OpcoesApp) {
  const app = Fastify({
    logger: logger ?? false,
    // Atrás de proxy/load balancer o IP real vem no X-Forwarded-For (usado pelo rate limit).
    trustProxy: config.ambiente === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('banco', banco);
  app.decorate('tokens', new Tokens(config.jwtSegredo, config.accessTokenTtlSegundos));
  app.decorate('enviarEmail', enviarEmail ?? enviarEmailNoLog(app.log));
  app.decorate(
    'armazenamento',
    armazenamento ??
      (config.storage
        ? armazenamentoSupabase(
            config.storage.url,
            config.storage.chave,
            config.storage.bucketFotos,
          )
        : armazenamentoIndisponivel),
  );
  app.decorate('custoSenha', config.ambiente === 'test' ? CUSTO_TESTE : CUSTO_PADRAO);
  app.decorateRequest('usuario', null);

  registrarTratamentoDeErros(app);

  await app.register(helmet, {
    // A documentação (Swagger UI) carrega scripts e estilos inline.
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.origensCors,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  // Desligado por padrão; ligado só nas rotas sensíveis (login, cadastro, recuperação).
  await app.register(rateLimit, { global: false });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Patas & Rotas API',
        description: 'Encontros entre pets, rotas de passeio e o registro dos passeios.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Cadastro, login e sessão' },
        { name: 'perfil', description: 'Dados do tutor e do pet' },
        { name: 'encontros', description: 'Encontros entre pets' },
        { name: 'rotas', description: 'Rotas de passeio' },
        { name: 'passeios', description: 'Passeios registrados e feed' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/saude', { schema: { hide: true } }, () => ({ status: 'ok' }));

  await app.register(authEndpoints, { prefix: '/auth' });
  await app.register(perfilEndpoints, { prefix: '/perfil' });
  await app.register(encontrosEndpoints, { prefix: '/encontros' });
  await app.register(rotasEndpoints, { prefix: '/rotas' });
  await app.register(passeiosEndpoints, { prefix: '/passeios' });

  return app;
}

export type App = Awaited<ReturnType<typeof criarApp>>;
