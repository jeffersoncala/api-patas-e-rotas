import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { favoritas, passeios, rotas } from '../../db/schema.js';
import { naoEncontrado, proibido } from '../../erros.js';
import {
  erros,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
  trajeto,
} from '../../esquemas.js';
import { distanciaTrajeto } from '../../geo.js';
import { esquemaLimite, esquemaPasseio, listarPasseios } from '../passeios/servico.js';
import { buscarRota, esquemaRota, listarRotas } from './servico.js';

const esquemaNovaRota = z.object({
  nome: textoObrigatorio(60),
  bairro: textoObrigatorio(60),
  descricao: z.string().trim().max(300).default(''),
  pontos: trajeto,
  duracaoMin: z.number().int().min(1).max(600),
});

export const rotasEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);

  /** 404 se a rota não existir; 403 se quem pede não for o autor. */
  const exigirAutor = (id: number, usuarioId: string) => {
    const rota = app.banco
      .select({ autorId: rotas.autorId })
      .from(rotas)
      .where(eq(rotas.id, id))
      .get();
    if (!rota) throw naoEncontrado('Rota', 'f');
    if (rota.autorId !== usuarioId) throw proibido('Só quem criou pode alterar a rota');
  };

  const exigirRota = (id: number) => {
    const rota = app.banco.select({ id: rotas.id }).from(rotas).where(eq(rotas.id, id)).get();
    if (!rota) throw naoEncontrado('Rota', 'f');
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Rotas por nome; `filtro=favoritas` traz só as favoritas do usuário',
        security: seguranca,
        querystring: z.object({ filtro: z.enum(['todas', 'favoritas']).default('todas') }),
        response: { 200: z.array(esquemaRota), ...erros(400, 401) },
      },
    },
    (req) => listarRotas(app.banco, usuarioDe(req).id, req.query.filtro === 'favoritas'),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Uma rota',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaRota, ...erros(400, 401, 404) },
      },
    },
    (req) => buscarRota(app.banco, usuarioDe(req).id, req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Cria uma rota (já favoritada por quem criou); a distância é calculada aqui',
        security: seguranca,
        body: esquemaNovaRota,
        response: { 201: esquemaRota, ...erros(400, 401) },
      },
    },
    async (req, reply) => {
      const { id: usuarioId } = usuarioDe(req);
      const id = app.banco.transaction((tx) => {
        const { id } = tx
          .insert(rotas)
          .values({
            ...req.body,
            autorId: usuarioId,
            distanciaKm: distanciaTrajeto(req.body.pontos),
          })
          .returning({ id: rotas.id })
          .get();
        tx.insert(favoritas).values({ rotaId: id, usuarioId }).run();
        return id;
      });
      return reply.status(201).send(buscarRota(app.banco, usuarioId, id));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Atualiza só os campos enviados (só quem criou)',
        security: seguranca,
        params: paramId,
        // Sem `default` no parcial, senão a descrição seria apagada quando não enviada.
        body: esquemaNovaRota.extend({ descricao: z.string().trim().max(300) }).partial(),
        response: { 200: esquemaRota, ...erros(400, 401, 403, 404) },
      },
    },
    (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      exigirAutor(id, usuarioId);

      const mudancas = {
        ...req.body,
        ...(req.body.pontos && { distanciaKm: distanciaTrajeto(req.body.pontos) }),
      };
      if (Object.keys(mudancas).length) {
        app.banco.transaction((tx) => {
          tx.update(rotas).set(mudancas).where(eq(rotas.id, id)).run();
          // O nome é copiado nos passeios (para sobreviver à rota); mantém em dia.
          if (req.body.nome !== undefined) {
            tx.update(passeios)
              .set({ rotaNome: req.body.nome })
              .where(eq(passeios.rotaId, id))
              .run();
          }
        });
      }
      return buscarRota(app.banco, usuarioId, id);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Apaga a rota (só quem criou); os passeios nela viram passeios livres',
        security: seguranca,
        params: paramId,
        response: { 204: semConteudo, ...erros(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      exigirAutor(id, usuarioDe(req).id);
      app.banco.delete(rotas).where(eq(rotas.id, id)).run();
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/:id/favorita',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Favorita a rota (idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaRota, ...erros(400, 401, 404) },
      },
    },
    (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      exigirRota(id);
      app.banco.insert(favoritas).values({ rotaId: id, usuarioId }).onConflictDoNothing().run();
      return buscarRota(app.banco, usuarioId, id);
    },
  );

  app.delete(
    '/:id/favorita',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Tira a rota das favoritas (idempotente)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaRota, ...erros(400, 401, 404) },
      },
    },
    (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      exigirRota(id);
      app.banco
        .delete(favoritas)
        .where(and(eq(favoritas.rotaId, id), eq(favoritas.usuarioId, usuarioId)))
        .run();
      return buscarRota(app.banco, usuarioId, id);
    },
  );

  app.get(
    '/:id/passeios',
    {
      schema: {
        tags: ['rotas'],
        summary: 'Passeios feitos nesta rota, mais recentes primeiro',
        security: seguranca,
        params: paramId,
        querystring: z.object({ limite: esquemaLimite }),
        response: { 200: z.array(esquemaPasseio), ...erros(400, 401, 404) },
      },
    },
    (req) => {
      const { id } = req.params;
      exigirRota(id);
      return listarPasseios(app.banco, usuarioDe(req).id, {
        rotaId: id,
        limite: req.query.limite,
      }).itens;
    },
  );
};
