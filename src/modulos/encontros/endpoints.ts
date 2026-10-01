import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import {
  dataIso,
  erros,
  latLng,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
} from '../../esquemas.js';
import { EncontrosServico } from './servico.js';

/** Mesmo formato do `Encontro` do front. */
const esquemaEncontro = z
  .object({
    id: z.number().int(),
    titulo: z.string(),
    descricao: z.string(),
    local: z.string(),
    posicao: latLng,
    data: dataIso,
    confirmados: z.number().int().describe('Total de presenças confirmadas'),
    vou: z.boolean().describe('Se o usuário da requisição confirmou presença'),
    organizador: z.string().describe('"<tutor> e <pet>", ex. "Ana e Mel"'),
    organizadorId: z.uuid(),
    meu: z.boolean().describe('Se o usuário da requisição é o organizador'),
  })
  .meta({ id: 'Encontro' });

const dataFutura = z.iso
  .datetime({ offset: true })
  .refine((data) => new Date(data).getTime() > Date.now(), 'A data precisa ser no futuro')
  .describe('ISO 8601 com fuso, ex. 2026-10-01T18:00:00-03:00');

const campos = {
  titulo: textoObrigatorio(80),
  descricao: z.string().trim().max(500),
  local: textoObrigatorio(120),
  posicao: latLng,
  data: dataFutura,
};

export const encontrosEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);
  const servico = new EncontrosServico(app);

  app.get(
    '/',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Lista os encontros por data (mais próximos primeiro)',
        security: seguranca,
        querystring: z.object({
          filtro: z
            .enum(['todos', 'vou'])
            .default('todos')
            .describe('"vou": só os que o usuário confirmou'),
          periodo: z
            .enum(['futuros', 'todos'])
            .default('futuros')
            .describe('"futuros": só os de agora em diante'),
        }),
        response: { 200: z.array(esquemaEncontro), ...erros(400, 401) },
      },
    },
    (req) => servico.listar(usuarioDe(req).id, req.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Detalhe de um encontro',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaEncontro, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.buscar(usuarioDe(req).id, req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Marca um encontro (o organizador já entra como confirmado)',
        security: seguranca,
        body: z.object({ ...campos, descricao: campos.descricao.default('') }),
        response: { 201: esquemaEncontro, ...erros(400, 401) },
      },
    },
    async (req, reply) => reply.status(201).send(servico.criar(usuarioDe(req).id, req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Atualiza só os campos enviados (apenas o organizador)',
        security: seguranca,
        params: paramId,
        body: z.object(campos).partial(),
        response: { 200: esquemaEncontro, ...erros(400, 401, 403, 404) },
      },
    },
    (req) => servico.atualizar(usuarioDe(req).id, req.params.id, req.body),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Cancela o encontro (apenas o organizador)',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      servico.apagar(usuarioDe(req).id, req.params.id);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/:id/presenca',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Confirma presença (idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaEncontro, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.confirmar(usuarioDe(req).id, req.params.id),
  );

  app.delete(
    '/:id/presenca',
    {
      schema: {
        tags: ['encontros'],
        summary: 'Cancela a presença (idempotente; vale também para o organizador)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaEncontro, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.cancelar(usuarioDe(req).id, req.params.id),
  );
};
