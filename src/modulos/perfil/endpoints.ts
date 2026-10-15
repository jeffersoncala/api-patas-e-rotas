import { and, asc, count, eq, gte, sum } from 'drizzle-orm';
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
import { ErroApi, naoEncontrado } from '../../erros.js';
import { erros, paramId, semConteudo, seguranca, textoObrigatorio } from '../../esquemas.js';
import {
  apagarFotos,
  esquemaImagem,
  LIMITE_CORPO_FOTO,
  salvarFoto,
  urlFoto,
} from '../fotos/servico.js';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/** Teto de pets por tutor, só para ninguém encher o banco. */
export const MAX_PETS = 10;

const foto = z.string().nullable().describe('Caminho da foto na API (`/fotos/<id>`), ou null');

/** Mesmo formato do `Pet` do front. */
const esquemaPet = z
  .object({
    id: z.number().int(),
    nome: z.string(),
    especie: z.enum(ESPECIES),
    raca: z.string(),
    idadeAnos: z.number().int(),
    porte: z.enum(PORTES),
    bio: z.string(),
    foto,
  })
  .meta({ id: 'Pet' });

/** Mesmo formato do `Perfil` do front. */
const esquemaPerfil = z
  .object({
    tutor: z.string(),
    email: z.email(),
    foto,
    metaSemanalKm: z.number(),
    pets: z.array(esquemaPet).describe('Na ordem em que foram cadastrados; vazio numa conta nova'),
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

const camposPet = {
  nome: textoObrigatorio(60),
  especie: z.enum(ESPECIES),
  raca: z.string().trim().max(60),
  idadeAnos: z.number().int().min(0).max(40),
  porte: z.enum(PORTES),
  bio: z.string().trim().max(200),
};

const corpoFoto = z.object({ imagem: esquemaImagem });

const paramPet = z.object({ petId: paramId.shape.id });

async function buscarPerfil(app: FastifyInstance, usuarioId: string) {
  const [usuario] = await app.banco
    .select({
      tutor: usuarios.tutor,
      email: usuarios.email,
      fotoId: usuarios.fotoId,
      metaSemanalKm: usuarios.metaSemanalKm,
    })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId));
  if (!usuario) throw naoEncontrado('Perfil');

  const lista = await app.banco
    .select()
    .from(pets)
    .where(eq(pets.usuarioId, usuarioId))
    .orderBy(asc(pets.id));

  const { fotoId, ...dados } = usuario;
  return {
    ...dados,
    foto: urlFoto(fotoId),
    pets: lista.map(({ usuarioId: _, fotoId, ...pet }) => ({ ...pet, foto: urlFoto(fotoId) })),
  };
}

const arredondar = (km: number) => Math.round(km * 100) / 100;

export const perfilEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);

  /** O pet, se for do usuário; de outro tutor é 404, como se não existisse. */
  const petDoUsuario = async (usuarioId: string, petId: number) => {
    const [pet] = await app.banco
      .select({ id: pets.id, fotoId: pets.fotoId })
      .from(pets)
      .where(and(eq(pets.id, petId), eq(pets.usuarioId, usuarioId)));
    if (!pet) throw naoEncontrado('Pet');
    return pet;
  };

  const quantosPets = async (usuarioId: string) => {
    const [linha] = await app.banco
      .select({ quantidade: count() })
      .from(pets)
      .where(eq(pets.usuarioId, usuarioId));
    return linha?.quantidade ?? 0;
  };

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
    (req) => buscarPerfil(app, usuarioDe(req).id),
  );

  app.patch(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Atualiza os dados do tutor (só os campos enviados)',
        security: seguranca,
        body: z
          .object({
            tutor: textoObrigatorio(80),
            metaSemanalKm: z.number().min(1).max(200),
          })
          .partial(),
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      if (Object.keys(req.body).length) {
        await app.banco.update(usuarios).set(req.body).where(eq(usuarios.id, id));
      }
      return buscarPerfil(app, id);
    },
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
      await app.banco.delete(usuarios).where(eq(usuarios.id, usuarioDe(req).id));
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/foto',
    {
      bodyLimit: LIMITE_CORPO_FOTO,
      schema: {
        tags: ['perfil'],
        summary: 'Troca a foto do tutor',
        security: seguranca,
        body: corpoFoto,
        response: { 200: esquemaPerfil, ...erros(400, 401, 404, 413) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      await app.banco.transaction(async (tx) => {
        const [atual] = await tx
          .select({ fotoId: usuarios.fotoId })
          .from(usuarios)
          .where(eq(usuarios.id, id));
        const fotoId = await salvarFoto(tx, id, req.body.imagem);
        await tx.update(usuarios).set({ fotoId }).where(eq(usuarios.id, id));
        await apagarFotos(tx, [atual?.fotoId ?? null]);
      });
      return buscarPerfil(app, id);
    },
  );

  app.delete(
    '/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove a foto do tutor',
        security: seguranca,
        response: { 200: esquemaPerfil, ...erros(401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const [atual] = await app.banco
        .select({ fotoId: usuarios.fotoId })
        .from(usuarios)
        .where(eq(usuarios.id, id));
      await apagarFotos(app.banco, [atual?.fotoId ?? null]);
      return buscarPerfil(app, id);
    },
  );

  app.post(
    '/pets',
    {
      schema: {
        tags: ['perfil'],
        summary: `Adiciona um pet (até ${MAX_PETS} por tutor)`,
        security: seguranca,
        body: z.object({
          ...camposPet,
          raca: camposPet.raca.default(''),
          idadeAnos: camposPet.idadeAnos.default(1),
          bio: camposPet.bio.default(''),
        }),
        response: { 201: esquemaPerfil, ...erros(400, 401, 404, 409) },
      },
    },
    async (req, reply) => {
      const { id } = usuarioDe(req);
      if ((await quantosPets(id)) >= MAX_PETS) {
        throw new ErroApi(409, `Cada tutor pode ter até ${MAX_PETS} pets`);
      }
      await app.banco.insert(pets).values({ ...req.body, usuarioId: id });
      return reply.status(201).send(await buscarPerfil(app, id));
    },
  );

  app.patch(
    '/pets/:petId',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Atualiza um pet (só os campos enviados)',
        security: seguranca,
        params: paramPet,
        body: z.object(camposPet).partial(),
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const pet = await petDoUsuario(id, req.params.petId);
      if (Object.keys(req.body).length) {
        await app.banco.update(pets).set(req.body).where(eq(pets.id, pet.id));
      }
      return buscarPerfil(app, id);
    },
  );

  app.delete(
    '/pets/:petId',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove um pet e a foto dele',
        security: seguranca,
        params: paramPet,
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const pet = await petDoUsuario(id, req.params.petId);
      await app.banco.transaction(async (tx) => {
        await tx.delete(pets).where(eq(pets.id, pet.id));
        await apagarFotos(tx, [pet.fotoId]);
      });
      return buscarPerfil(app, id);
    },
  );

  app.put(
    '/pets/:petId/foto',
    {
      bodyLimit: LIMITE_CORPO_FOTO,
      schema: {
        tags: ['perfil'],
        summary: 'Troca a foto de um pet',
        security: seguranca,
        params: paramPet,
        body: corpoFoto,
        response: { 200: esquemaPerfil, ...erros(400, 401, 404, 413) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const pet = await petDoUsuario(id, req.params.petId);
      await app.banco.transaction(async (tx) => {
        const fotoId = await salvarFoto(tx, id, req.body.imagem);
        await tx.update(pets).set({ fotoId }).where(eq(pets.id, pet.id));
        await apagarFotos(tx, [pet.fotoId]);
      });
      return buscarPerfil(app, id);
    },
  );

  app.delete(
    '/pets/:petId/foto',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Remove a foto de um pet',
        security: seguranca,
        params: paramPet,
        response: { 200: esquemaPerfil, ...erros(400, 401, 404) },
      },
    },
    async (req) => {
      const { id } = usuarioDe(req);
      const pet = await petDoUsuario(id, req.params.petId);
      await apagarFotos(app.banco, [pet.fotoId]);
      return buscarPerfil(app, id);
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
};
