import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { erros, paramId, seguranca } from '../../esquemas.js';
import {
  buscarPerfilPet,
  esquemaCursorAlbum,
  esquemaLimiteAlbum,
  esquemaPaginaAlbum,
  esquemaPerfilPet,
  listarAlbum,
} from './servico.js';

/** Perfil público de qualquer pet, para quem estiver logado (o próprio pet se edita em /perfil). */
export const petsEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);

  app.get(
    '/:id',
    {
      schema: {
        tags: ['pets'],
        summary: 'Perfil público de um pet: dados, tutor e números dos passeios',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaPerfilPet, ...erros(400, 401, 404) },
      },
    },
    (req) => buscarPerfilPet(app.banco, usuarioDe(req).id, req.params.id),
  );

  app.get(
    '/:id/album',
    {
      schema: {
        tags: ['pets'],
        summary: 'Álbum do pet: fotos dos passeios em que ele foi, das mais recentes às antigas',
        security: seguranca,
        params: paramId,
        querystring: z.object({
          limite: esquemaLimiteAlbum,
          antesDe: esquemaCursorAlbum
            .optional()
            .describe('Cursor: `proximoCursor` da página anterior'),
        }),
        response: { 200: esquemaPaginaAlbum, ...erros(400, 401, 404) },
      },
    },
    (req) => {
      const { limite, antesDe } = req.query;
      return listarAlbum(app.banco, req.params.id, { limite, ...(antesDe && { antesDe }) });
    },
  );
};
