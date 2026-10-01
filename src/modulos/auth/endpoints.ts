import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { ESPECIES, PORTES } from '../../db/schema.js';
import { dataIso, email, erros, semConteudo, seguranca, textoObrigatorio } from '../../esquemas.js';
import { AuthServico, usuarioPublico } from './servico.js';

/** Espaço pode fazer parte da senha, então ela não é aparada. */
const senha = z.string().min(6).max(128);

const esquemaUsuario = z
  .object({
    id: z.uuid(),
    email: z.email(),
    tutor: z.string(),
    role: z.literal('authenticated'),
    criadoEm: dataIso,
    ultimoAcessoEm: dataIso.nullable(),
  })
  .meta({ id: 'Usuario' });

const esquemaLogin = z
  .object({
    accessToken: z.string().describe('Vai no header Authorization: Bearer <accessToken>'),
    tokenType: z.literal('Bearer'),
    expiresEm: dataIso,
    refreshToken: z.string().describe('Só para POST /auth/refresh. Guarde como uma senha'),
    usuario: esquemaUsuario,
  })
  .meta({ id: 'Login' });

/** Limite por IP nas rotas que aceitam senha ou disparam e-mail. */
const limite = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

export const authEndpoints: FastifyPluginAsyncZod = async (app) => {
  const servico = new AuthServico(app);

  app.post(
    '/cadastro',
    {
      config: limite(5),
      schema: {
        tags: ['auth'],
        summary: 'Cria a conta do tutor e o perfil do pet, já com a sessão aberta',
        body: z.object({
          email,
          password: senha,
          tutor: textoObrigatorio(80),
          pet: textoObrigatorio(60),
          especie: z.enum(ESPECIES),
          porte: z.enum(PORTES),
        }),
        response: { 201: esquemaLogin, ...erros(400, 409, 429) },
      },
    },
    async (req, reply) => reply.status(201).send(await servico.cadastrar(req.body)),
  );

  app.post(
    '/login',
    {
      config: limite(10),
      schema: {
        tags: ['auth'],
        summary: 'Entra com e-mail e senha',
        body: z.object({ email, password: z.string().min(1) }),
        response: { 200: esquemaLogin, ...erros(400, 401, 429) },
      },
    },
    (req) => servico.entrar(req.body.email, req.body.password),
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Troca o refresh token por um novo par (o antigo deixa de valer)',
        body: z.object({ refreshToken: z.string().trim().min(1) }),
        response: { 200: esquemaLogin, ...erros(400, 401) },
      },
    },
    (req) => servico.renovar(req.body.refreshToken),
  );

  app.get(
    '/me',
    {
      onRequest: autenticar,
      schema: {
        tags: ['auth'],
        summary: 'Usuário do token',
        security: seguranca,
        response: { 200: esquemaUsuario, ...erros(401) },
      },
    },
    (req) => usuarioPublico(servico.buscarUsuario(usuarioDe(req).id)),
  );

  app.post(
    '/logout',
    {
      onRequest: autenticar,
      schema: {
        tags: ['auth'],
        summary: 'Encerra a sessão: o access token e o refresh token param de valer na hora',
        security: seguranca,
        response: { 204: semConteudo, ...erros(401) },
      },
    },
    async (req, reply) => {
      servico.encerrarSessao(usuarioDe(req).sessaoId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/recuperar-senha',
    {
      config: limite(5),
      schema: {
        tags: ['auth'],
        summary: 'Envia o link de redefinição (responde 202 exista ou não a conta)',
        body: z.object({ email }),
        response: { 202: z.object({ mensagem: z.string() }), ...erros(400, 429) },
      },
    },
    async (req, reply) => {
      await servico.solicitarRedefinicao(req.body.email);
      return reply.status(202).send({
        mensagem: 'Se o e-mail tiver conta, enviamos um link para criar uma nova senha.',
      });
    },
  );

  app.post(
    '/redefinir-senha',
    {
      config: limite(10),
      schema: {
        tags: ['auth'],
        summary: 'Define a nova senha com o token do e-mail e encerra todas as sessões',
        body: z.object({ token: z.string().trim().min(1), password: senha }),
        response: { 204: semConteudo, ...erros(400, 429) },
      },
    },
    async (req, reply) => {
      await servico.redefinirSenha(req.body.token, req.body.password);
      return reply.status(204).send(null);
    },
  );
};
