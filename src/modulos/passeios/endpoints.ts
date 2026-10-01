import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { curtidas, passeios, rotas } from '../../db/schema.js';
import { ErroApi, naoEncontrado, proibido } from '../../erros.js';
import {
  dataIso,
  erros,
  idNumerico,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
  trajeto,
} from '../../esquemas.js';
import { distanciaTrajeto } from '../../geo.js';
import {
  buscarPasseio,
  esquemaCursor,
  esquemaLimite,
  esquemaPaginaPasseios,
  esquemaPasseio,
  listarPasseios,
} from './servico.js';

const PASSEIO_LIVRE = 'Passeio livre';

export const passeiosEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);

  /** 404 se o passeio não existir; devolve o dono para checar permissão. */
  const autorDoPasseio = async (id: number) => {
    const [passeio] = await app.banco
      .select({ usuarioId: passeios.usuarioId })
      .from(passeios)
      .where(eq(passeios.id, id));
    if (!passeio) throw naoEncontrado('Passeio');
    return passeio.usuarioId;
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Feed de passeios, do mais recente para o mais antigo',
        security: seguranca,
        querystring: z.object({
          autor: z.enum(['todos', 'eu']).default('todos'),
          limite: esquemaLimite,
          antesDe: esquemaCursor.optional().describe('Cursor: `proximoCursor` da página anterior'),
        }),
        response: { 200: esquemaPaginaPasseios, ...erros(400, 401) },
      },
    },
    (req) => {
      const { id } = usuarioDe(req);
      const { autor, limite, antesDe } = req.query;
      return listarPasseios(app.banco, id, {
        limite,
        ...(autor === 'eu' && { autorId: id }),
        ...(antesDe && { antesDe }),
      });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Um passeio',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPasseio, ...erros(400, 401, 404) },
      },
    },
    (req) => buscarPasseio(app.banco, usuarioDe(req).id, req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Registra um passeio (livre ou numa rota); a distância é calculada aqui',
        security: seguranca,
        body: z.object({
          pontos: trajeto,
          duracaoMin: z.number().int().min(1).max(1440),
          texto: z.string().trim().max(500).default(''),
          rotaId: idNumerico.optional(),
          rotaNome: textoObrigatorio(60)
            .optional()
            .describe(`Só quando não há rotaId; padrão "${PASSEIO_LIVRE}"`),
        }),
        response: { 201: esquemaPasseio, ...erros(400, 401) },
      },
    },
    async (req, reply) => {
      const { id: usuarioId } = usuarioDe(req);
      const { pontos, duracaoMin, texto, rotaId } = req.body;

      let rotaNome = req.body.rotaNome ?? PASSEIO_LIVRE;
      if (rotaId !== undefined) {
        const [rota] = await app.banco
          .select({ nome: rotas.nome })
          .from(rotas)
          .where(eq(rotas.id, rotaId));
        if (!rota) {
          throw new ErroApi(400, 'Dados inválidos', { rotaId: 'Rota não encontrada' });
        }
        rotaNome = rota.nome;
      }

      const [criado] = await app.banco
        .insert(passeios)
        .values({
          usuarioId,
          rotaId: rotaId ?? null,
          rotaNome,
          pontos,
          distanciaKm: distanciaTrajeto(pontos),
          duracaoMin,
          texto,
          data: new Date(),
        })
        .returning({ id: passeios.id });
      return reply.status(201).send(await buscarPasseio(app.banco, usuarioId, criado!.id));
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Apaga um passeio (só quem registrou)',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      if ((await autorDoPasseio(id)) !== usuarioDe(req).id) {
        throw proibido('Só quem registrou pode apagar o passeio');
      }
      await app.banco.delete(passeios).where(eq(passeios.id, id));
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/:id/curtida',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Curte o passeio (idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPasseio, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      await autorDoPasseio(id);
      await app.banco.insert(curtidas).values({ passeioId: id, usuarioId }).onConflictDoNothing();
      return buscarPasseio(app.banco, usuarioId, id);
    },
  );

  app.delete(
    '/:id/curtida',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Desfaz a curtida (idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPasseio, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      await autorDoPasseio(id);
      await app.banco
        .delete(curtidas)
        .where(and(eq(curtidas.passeioId, id), eq(curtidas.usuarioId, usuarioId)));
      return buscarPasseio(app.banco, usuarioId, id);
    },
  );
};
