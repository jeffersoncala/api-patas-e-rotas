import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { TIPOS_SERVICO } from '../../db/schema.js';
import {
  dataIso,
  erros,
  latLng,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
} from '../../esquemas.js';
import { esquemaImagem, fotoExistente } from '../fotos/servico.js';
import { PrestadoresServico } from './servico.js';

/** Raio máximo da busca; acima disso a lista deixa de ser "perto de você". */
export const MAX_RAIO_KM = 100;

export const MAX_FOTOS_PRESTADOR = 6;
export const MAX_PRECOS = 10;

/**
 * Fotos vêm no mesmo corpo. Fica abaixo dos 4,5 MB que a Vercel aceita; o front reduz as
 * fotos, então seis delas cabem com folga.
 */
const LIMITE_CORPO_PRESTADOR = 4_000_000;

const esquemaPreco = z
  .object({
    descricao: textoObrigatorio(60).describe('Ex.: "Passeio de 30 min", "Diária", "Banho porte P"'),
    valorCentavos: z.number().int().min(0).max(10_000_000).describe('Em centavos: 2500 = R$ 25,00'),
  })
  .meta({ id: 'Preco' });

/** Mesmo formato do `Prestador` do front. */
const esquemaPrestador = z
  .object({
    id: z.number().int(),
    tipo: z.enum(TIPOS_SERVICO),
    nome: z.string(),
    descricao: z.string(),
    contato: z.string(),
    bairro: z.string(),
    posicao: latLng.describe('Região de atendimento (não precisa ser o endereço exato)'),
    precos: z.array(esquemaPreco),
    fotos: z.array(z.string()).describe('Caminhos das fotos na API, na ordem'),
    fotoUsuario: z.string().nullable().describe('Foto de perfil de quem cadastrou, ou null'),
    ativo: z.boolean().describe('Pausado não aparece na busca nem recebe pedidos'),
    notaMedia: z.number().nullable().describe('De 1 a 5, com uma casa; null sem avaliações'),
    totalAvaliacoes: z.number().int(),
    meu: z.boolean().describe('Se o usuário da requisição cadastrou'),
  })
  .meta({ id: 'Prestador' });

const esquemaPrestadorProximo = esquemaPrestador
  .extend({ distanciaKm: z.number().describe('Distância até o ponto da busca') })
  .meta({ id: 'PrestadorProximo' });

const esquemaAvaliacao = z
  .object({
    nota: z.number().int().min(1).max(5),
    comentario: z.string(),
    data: dataIso,
    cliente: z.string().describe('Nome de quem avaliou'),
    fotoCliente: z.string().nullable(),
  })
  .meta({ id: 'Avaliacao' });

const coordenada = (min: number, max: number) => z.coerce.number().min(min).max(max);

const campos = {
  nome: textoObrigatorio(80),
  descricao: z.string().trim().max(1000),
  contato: textoObrigatorio(120),
  bairro: textoObrigatorio(80),
  posicao: latLng,
  precos: z.array(esquemaPreco).max(MAX_PRECOS, `Cadastre no máximo ${MAX_PRECOS} preços`),
};

export const prestadoresEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);
  const servico = new PrestadoresServico(app);

  app.get(
    '/',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Prestadores ativos dentro do raio, do mais perto para o mais longe',
        security: seguranca,
        querystring: z.object({
          tipo: z.enum(TIPOS_SERVICO).optional().describe('Sem tipo, traz todos'),
          lat: coordenada(-90, 90).describe('Latitude do centro da busca'),
          lng: coordenada(-180, 180).describe('Longitude do centro da busca'),
          raioKm: z.coerce
            .number()
            .positive()
            .max(MAX_RAIO_KM)
            .default(10)
            .describe(`Raio em km (até ${MAX_RAIO_KM})`),
        }),
        response: { 200: z.array(esquemaPrestadorProximo), ...erros(400, 401) },
      },
    },
    (req) => servico.listar(usuarioDe(req).id, req.query),
  );

  app.get(
    '/meus',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Serviços que o usuário oferece, inclusive os pausados',
        security: seguranca,
        response: { 200: z.array(esquemaPrestador), ...erros(401) },
      },
    },
    (req) => servico.meus(usuarioDe(req).id),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Detalhe de um prestador',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPrestador, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.buscar(usuarioDe(req).id, req.params.id),
  );

  app.get(
    '/:id/avaliacoes',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Avaliações do prestador, das mais novas para as mais antigas',
        security: seguranca,
        params: paramId,
        response: { 200: z.array(esquemaAvaliacao), ...erros(400, 401, 404) },
      },
    },
    (req) => servico.avaliacoes(req.params.id),
  );

  app.post(
    '/',
    {
      bodyLimit: LIMITE_CORPO_PRESTADOR,
      schema: {
        tags: ['servicos'],
        summary: 'Cadastra um serviço (um de cada tipo por usuário)',
        security: seguranca,
        body: z.object({
          ...campos,
          tipo: z.enum(TIPOS_SERVICO),
          descricao: campos.descricao.default(''),
          precos: campos.precos.default([]),
          fotos: z
            .array(esquemaImagem)
            .max(MAX_FOTOS_PRESTADOR, `Envie no máximo ${MAX_FOTOS_PRESTADOR} fotos`)
            .default([])
            .describe('Fotos do serviço (ex.: o ambiente da hospedagem), na ordem'),
        }),
        response: { 201: esquemaPrestador, ...erros(400, 401, 409) },
      },
    },
    async (req, reply) => reply.status(201).send(await servico.criar(usuarioDe(req).id, req.body)),
  );

  app.patch(
    '/:id',
    {
      bodyLimit: LIMITE_CORPO_PRESTADOR,
      schema: {
        tags: ['servicos'],
        summary: 'Atualiza só os campos enviados (apenas quem cadastrou)',
        security: seguranca,
        params: paramId,
        body: z
          .object({
            ...campos,
            ativo: z.boolean(),
            fotos: z
              .array(z.union([fotoExistente, esquemaImagem]))
              .max(MAX_FOTOS_PRESTADOR, `Envie no máximo ${MAX_FOTOS_PRESTADOR} fotos`)
              .describe(
                'Lista final, na ordem: caminhos (`/fotos/<id>`) das que ficam e data URLs das novas',
              ),
          })
          .partial(),
        response: { 200: esquemaPrestador, ...erros(400, 401, 403, 404) },
      },
    },
    (req) => servico.alterar(usuarioDe(req).id, req.params.id, req.body),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Apaga o serviço, com as fotos, pedidos e avaliações (apenas quem cadastrou)',
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
