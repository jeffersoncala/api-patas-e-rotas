import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { ESPECIES, PORTES } from '../../db/schema.js';
import {
  dataIso,
  erros,
  latLng,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
} from '../../esquemas.js';
import { esquemaImagem, LIMITE_CORPO_FOTO } from '../fotos/servico.js';
import { DesaparecidosServico } from './servico.js';

/** Raio máximo da busca; acima disso a lista deixa de ser "perto de você". */
export const MAX_RAIO_KM = 100;

/** Folga para relógio de celular adiantado. */
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

/** Mesmo formato do `Desaparecido` do front. */
const esquemaDesaparecido = z
  .object({
    id: z.number().int(),
    nome: z.string(),
    especie: z.enum(ESPECIES),
    raca: z.string(),
    porte: z.enum(PORTES),
    descricao: z.string(),
    contato: z.string(),
    foto: z.string().nullable().describe('Caminho da foto na API, ou null'),
    posicao: latLng.describe('Onde o pet foi visto pela última vez'),
    vistoEm: dataIso,
    encontrado: z.boolean(),
    tutor: z.string().describe('Quem cadastrou'),
    meu: z.boolean().describe('Se o usuário da requisição cadastrou'),
  })
  .meta({ id: 'Desaparecido' });

const esquemaDesaparecidoProximo = esquemaDesaparecido
  .extend({ distanciaKm: z.number().describe('Distância até o ponto da busca') })
  .meta({ id: 'DesaparecidoProximo' });

const dataPassada = z.iso
  .datetime({ offset: true })
  .refine(
    (data) => new Date(data).getTime() <= Date.now() + TOLERANCIA_FUTURO_MS,
    'A data não pode ser no futuro',
  )
  .describe('ISO 8601 com fuso, ex. 2026-10-01T18:00:00-03:00');

const coordenada = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const desaparecidosEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);
  const servico = new DesaparecidosServico(app);

  app.get(
    '/',
    {
      schema: {
        tags: ['desaparecidos'],
        summary: 'Pets ainda desaparecidos dentro do raio, do mais perto para o mais longe',
        security: seguranca,
        querystring: z.object({
          lat: coordenada(-90, 90).describe('Latitude do centro da busca'),
          lng: coordenada(-180, 180).describe('Longitude do centro da busca'),
          raioKm: z.coerce
            .number()
            .positive()
            .max(MAX_RAIO_KM)
            .default(5)
            .describe(`Raio em km (até ${MAX_RAIO_KM})`),
        }),
        response: { 200: z.array(esquemaDesaparecidoProximo), ...erros(400, 401) },
      },
    },
    (req) => servico.listar(usuarioDe(req).id, req.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['desaparecidos'],
        summary: 'Detalhe de um pet desaparecido',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaDesaparecido, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.buscar(usuarioDe(req).id, req.params.id),
  );

  app.post(
    '/',
    {
      // A foto vem no mesmo corpo; os outros campos são pequenos.
      bodyLimit: LIMITE_CORPO_FOTO + 8192,
      schema: {
        tags: ['desaparecidos'],
        summary: 'Cadastra um pet desaparecido',
        security: seguranca,
        body: z.object({
          nome: textoObrigatorio(60),
          especie: z.enum(ESPECIES),
          raca: z.string().trim().max(60).default(''),
          porte: z.enum(PORTES),
          descricao: z.string().trim().max(500).default(''),
          contato: textoObrigatorio(120),
          posicao: latLng,
          vistoEm: dataPassada,
          foto: esquemaImagem.optional(),
        }),
        response: { 201: esquemaDesaparecido, ...erros(400, 401) },
      },
    },
    async (req, reply) => reply.status(201).send(await servico.criar(usuarioDe(req).id, req.body)),
  );

  app.put(
    '/:id/encontrado',
    {
      schema: {
        tags: ['desaparecidos'],
        summary: 'Marca como encontrado (apenas quem cadastrou; idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaDesaparecido, ...erros(400, 401, 403, 404) },
      },
    },
    (req) => servico.marcarEncontrado(usuarioDe(req).id, req.params.id),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['desaparecidos'],
        summary: 'Apaga o cadastro (apenas quem cadastrou)',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      await servico.apagar(usuarioDe(req).id, req.params.id);
      return reply.status(204).send(null);
    },
  );
};
