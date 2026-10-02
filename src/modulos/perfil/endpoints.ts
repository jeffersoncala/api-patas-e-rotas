import { and, count, eq, gte, sum } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { encontros, ESPECIES, passeios, PORTES, presencas } from '../../db/schema.js';
import { erros, paramId, semConteudo, seguranca, textoObrigatorio } from '../../esquemas.js';
import { MAX_PETS, PerfilServico } from './servico.js';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

const fotoUrl = z.url().nullable().describe('URL temporária (24 h) da foto, ou null sem foto');

const esquemaPet = z
  .object({
    id: z.number().int(),
    nome: z.string(),
    especie: z.enum(ESPECIES),
    raca: z.string(),
    idadeAnos: z.number().int(),
    porte: z.enum(PORTES),
    bio: z.string(),
    fotoUrl,
  })
  .meta({ id: 'Pet' });

/** Um tutor e os pets dele (de 1 a 10, na ordem de cadastro). */
const esquemaPerfil = z
  .object({
    tutor: z.string(),
    email: z.email(),
    metaSemanalKm: z.number(),
    fotoUrl,
    pets: z.array(esquemaPet),
  })
  .meta({ id: 'Perfil' });

const camposPet = z.object({
  nome: textoObrigatorio(60),
  especie: z.enum(ESPECIES),
  porte: z.enum(PORTES),
  raca: z.string().trim().max(60),
  idadeAnos: z.number().int().min(0).max(40),
  bio: z.string().trim().max(200),
});

const esquemaUpload = z
  .object({ urlUpload: z.url(), caminho: z.string() })
  .meta({ id: 'UploadFoto' });

const descricaoUpload = (confirmacao: string) =>
  'Passo 1 de 2. Envie o arquivo com `PUT <urlUpload>` (o arquivo no corpo e o ' +
  '`Content-Type` da imagem; até 25 MB, só `image/*`). Depois confirme com ' +
  `\`${confirmacao}\` passando o \`caminho\`. A URL vale por 2 horas.`;

/** Gerar URL de upload não custa nada para o cliente, então tem limite. */
const limiteUpload = { rateLimit: { max: 30, timeWindow: '1 hour' } };

const esquemaResumo = z
  .object({
    kmSemana: z.number(),
    passeiosSemana: z.number().int(),
    kmTotal: z.number(),
    totalPasseios: z.number().int(),
    encontrosConfirmados: z.number().int().describe('Encontros futuros com presença confirmada'),
  })
  .meta({ id: 'ResumoPerfil' });

const arredondar = (km: number) => Math.round(km * 100) / 100;

export const perfilEndpoints: FastifyPluginAsyncZod = async (app) => {
  const servico = new PerfilServico(app);
  app.addHook('onRequest', autenticar);

  app.get(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Dados do tutor e dos pets',
        security: seguranca,
        response: { 200: esquemaPerfil, ...erros(401, 404) },
      },
    },
    (req) => servico.buscar(usuarioDe(req).id),
  );

  app.patch(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Atualiza só os campos enviados do tutor (os pets têm rotas próprias)',
        security: seguranca,
        body: z
          .object({ tutor: textoObrigatorio(80), metaSemanalKm: z.number().min(1).max(200) })
          .partial(),
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.atualizarTutor(usuarioDe(req).id, req.body),
  );

  app.delete(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Apaga a conta e todos os dados dela (pets, fotos, passeios, rotas, encontros)',
        security: seguranca,
        response: { 204: semConteudo, ...erros(401) },
      },
    },
    async (req, reply) => {
      await servico.apagarConta(usuarioDe(req).id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/resumo',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Números da home e do perfil: distância da semana, total e encontros',
        security: seguranca,
        response: { 200: esquemaResumo, ...erros(401) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const agora = Date.now();
      const totais = async (desde?: Date) => {
        const [linha] = await app.banco
          .select({ km: sum(passeios.distanciaKm).mapWith(Number), quantidade: count() })
          .from(passeios)
          .where(and(eq(passeios.usuarioId, id), desde && gte(passeios.data, desde)));
        return linha ?? { km: 0, quantidade: 0 };
      };

      const [semana, total, [confirmados]] = await Promise.all([
        totais(new Date(agora - SETE_DIAS_MS)),
        totais(),
        app.banco
          .select({ quantidade: count() })
          .from(presencas)
          .innerJoin(encontros, eq(encontros.id, presencas.encontroId))
          .where(and(eq(presencas.usuarioId, id), gte(encontros.data, new Date(agora)))),
      ]);

      return {
        kmSemana: arredondar(semana.km ?? 0),
        passeiosSemana: semana.quantidade,
        kmTotal: arredondar(total.km ?? 0),
        totalPasseios: total.quantidade,
        encontrosConfirmados: confirmados?.quantidade ?? 0,
      };
    },
  );

  // Foto do tutor

  app.post(
    '/foto/upload',
    {
      config: limiteUpload,
      schema: {
        tags: ['perfil'],
        summary: 'Gera a URL para enviar a foto do tutor direto ao storage',
        description: descricaoUpload('PUT /perfil/foto'),
        security: seguranca,
        response: { 200: esquemaUpload, ...erros(401, 429, 503) },
      },
    },
    (req) => servico.uploadFotoTutor(usuarioDe(req).id),
  );

  app.put(
    '/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Confirma a foto enviada e troca a foto do tutor',
        description: 'Passo 2 de 2. A foto anterior, se houver, é apagada do storage.',
        security: seguranca,
        body: z.object({ caminho: z.string() }),
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      await servico.trocarFotoTutor(id, req.body.caminho);
      return servico.buscar(id);
    },
  );

  app.delete(
    '/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove a foto do tutor',
        security: seguranca,
        response: { 204: semConteudo, ...erros(401) },
      },
    },
    async (req, reply) => {
      await servico.trocarFotoTutor(usuarioDe(req).id, null);
      return reply.status(204).send(null);
    },
  );

  // Pets

  app.post(
    '/pets',
    {
      schema: {
        tags: ['perfil'],
        summary: `Adiciona um pet ao perfil (até ${MAX_PETS})`,
        security: seguranca,
        body: camposPet.partial({ raca: true, idadeAnos: true, bio: true }),
        response: { 201: esquemaPet, ...erros(400, 401, 409) },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await servico.criarPet(usuarioDe(req).id, req.body)),
  );

  app.get(
    '/pets/:id',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Um pet do perfil',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPet, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.buscarPet(usuarioDe(req).id, req.params.id),
  );

  app.patch(
    '/pets/:id',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Atualiza só os campos enviados do pet',
        security: seguranca,
        params: paramId,
        body: camposPet.partial(),
        response: { 200: esquemaPet, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.atualizarPet(usuarioDe(req).id, req.params.id, req.body),
  );

  app.delete(
    '/pets/:id',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove o pet e a foto dele (o perfil precisa manter ao menos um)',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 404, 409) },
      },
    },
    async (req, reply) => {
      await servico.apagarPet(usuarioDe(req).id, req.params.id);
      return reply.status(204).send(null);
    },
  );

  // Foto do pet

  app.post(
    '/pets/:id/foto/upload',
    {
      config: limiteUpload,
      schema: {
        tags: ['perfil'],
        summary: 'Gera a URL para enviar a foto do pet direto ao storage',
        description: descricaoUpload('PUT /perfil/pets/{id}/foto'),
        security: seguranca,
        params: paramId,
        response: { 200: esquemaUpload, ...erros(400, 401, 404, 429, 503) },
      },
    },
    (req) => servico.uploadFotoPet(usuarioDe(req).id, req.params.id),
  );

  app.put(
    '/pets/:id/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Confirma a foto enviada e troca a foto do pet',
        description: 'Passo 2 de 2. A foto anterior, se houver, é apagada do storage.',
        security: seguranca,
        params: paramId,
        body: z.object({ caminho: z.string() }),
        response: { 200: esquemaPet, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      await servico.trocarFotoPet(id, req.params.id, req.body.caminho);
      return servico.buscarPet(id, req.params.id);
    },
  );

  app.delete(
    '/pets/:id/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove a foto do pet',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 404) },
      },
    },
    async (req, reply) => {
      await servico.trocarFotoPet(usuarioDe(req).id, req.params.id, null);
      return reply.status(204).send(null);
    },
  );
};
