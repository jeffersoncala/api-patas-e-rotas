import { and, count, eq, gte, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import {
  encontros,
  ESPECIES,
  passeios,
  pets,
  PORTES,
  presencas,
  usuarios,
} from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { erros, semConteudo, seguranca, textoObrigatorio } from '../../esquemas.js';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/** Mesmo formato do `Perfil` do front. */
const esquemaPerfil = z
  .object({
    tutor: z.string(),
    email: z.email(),
    pet: z.string(),
    especie: z.enum(ESPECIES),
    raca: z.string(),
    idadeAnos: z.number().int(),
    porte: z.enum(PORTES),
    bio: z.string(),
    metaSemanalKm: z.number(),
  })
  .meta({ id: 'Perfil' });

const esquemaResumo = z
  .object({
    kmSemana: z.number(),
    passeiosSemana: z.number().int(),
    kmTotal: z.number(),
    totalPasseios: z.number().int(),
    encontrosConfirmados: z.number().int().describe('Encontros futuros com presença confirmada'),
  })
  .meta({ id: 'ResumoPerfil' });

function buscarPerfil(app: FastifyInstance, usuarioId: string) {
  const linha = app.banco
    .select({
      tutor: usuarios.tutor,
      email: usuarios.email,
      pet: pets.nome,
      especie: pets.especie,
      raca: pets.raca,
      idadeAnos: pets.idadeAnos,
      porte: pets.porte,
      bio: pets.bio,
      metaSemanalKm: pets.metaSemanalKm,
    })
    .from(usuarios)
    .innerJoin(pets, eq(pets.usuarioId, usuarios.id))
    .where(eq(usuarios.id, usuarioId))
    .get();
  if (!linha) throw naoEncontrado('Perfil');
  return linha;
}

const arredondar = (km: number) => Math.round(km * 100) / 100;

export const perfilEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);

  app.get(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Dados do tutor e do pet',
        security: seguranca,
        response: { 200: esquemaPerfil, ...erros(401, 404) },
      },
    },
    (req) => buscarPerfil(app, usuarioDe(req).id),
  );

  app.patch(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Atualiza só os campos enviados',
        security: seguranca,
        body: z
          .object({
            tutor: textoObrigatorio(80),
            pet: textoObrigatorio(60),
            especie: z.enum(ESPECIES),
            raca: z.string().trim().max(60),
            idadeAnos: z.number().int().min(0).max(40),
            porte: z.enum(PORTES),
            bio: z.string().trim().max(200),
            metaSemanalKm: z.number().min(1).max(200),
          })
          .partial(),
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    (req) => {
      const { id } = usuarioDe(req);
      const { tutor, pet, ...doPet } = req.body;
      app.banco.transaction((tx) => {
        if (tutor !== undefined) {
          tx.update(usuarios).set({ tutor }).where(eq(usuarios.id, id)).run();
        }
        const mudancasPet = { ...doPet, ...(pet !== undefined && { nome: pet }) };
        if (Object.keys(mudancasPet).length) {
          tx.update(pets).set(mudancasPet).where(eq(pets.usuarioId, id)).run();
        }
      });
      return buscarPerfil(app, id);
    },
  );

  app.delete(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Apaga a conta e todos os dados dela (pet, passeios, rotas, encontros)',
        security: seguranca,
        response: { 204: semConteudo, ...erros(401) },
      },
    },
    async (req, reply) => {
      app.banco
        .delete(usuarios)
        .where(eq(usuarios.id, usuarioDe(req).id))
        .run();
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
    (req) => {
      const { id } = usuarioDe(req);
      const agora = Date.now();
      const totais = (desde?: Date) =>
        app.banco
          .select({ km: sum(passeios.distanciaKm).mapWith(Number), quantidade: count() })
          .from(passeios)
          .where(and(eq(passeios.usuarioId, id), desde && gte(passeios.data, desde)))
          .get() ?? { km: 0, quantidade: 0 };

      const semana = totais(new Date(agora - SETE_DIAS_MS));
      const total = totais();
      const confirmados = app.banco
        .select({ quantidade: count() })
        .from(presencas)
        .innerJoin(encontros, eq(encontros.id, presencas.encontroId))
        .where(and(eq(presencas.usuarioId, id), gte(encontros.data, new Date(agora))))
        .get();

      return {
        kmSemana: arredondar(semana.km ?? 0),
        passeiosSemana: semana.quantidade,
        kmTotal: arredondar(total.km ?? 0),
        totalPasseios: total.quantidade,
        encontrosConfirmados: confirmados?.quantidade ?? 0,
      };
    },
  );
};
