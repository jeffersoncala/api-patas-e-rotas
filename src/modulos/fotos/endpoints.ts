import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { fotos } from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { erros } from '../../esquemas.js';

export const fotosEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:id',
    {
      schema: {
        tags: ['fotos'],
        summary: 'A imagem em si. Pública, para funcionar direto num <img>',
        params: z.object({ id: z.uuid() }),
        response: {
          200: z.any().describe('Os bytes da imagem (JPEG, PNG ou WebP)'),
          ...erros(400, 404),
        },
      },
    },
    async (req, reply) => {
      const [foto] = await app.banco
        .select({ tipo: fotos.tipo, dados: fotos.dados })
        .from(fotos)
        .where(eq(fotos.id, req.params.id));
      if (!foto) throw naoEncontrado('Foto', 'f');
      return (
        reply
          .header('Content-Type', foto.tipo)
          // Trocar a foto gera outro id, então o conteúdo de um id nunca muda.
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          // O helmet só libera para a mesma origem; o front fica em outra.
          .header('Cross-Origin-Resource-Policy', 'cross-origin')
          .send(Buffer.from(foto.dados, 'base64'))
      );
    },
  );
};
