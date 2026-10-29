import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { curtidas, passeioFotos, passeioPets, passeios, pets, rotas } from '../../db/schema.js';
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
import { apagarFotos, esquemaImagem, fotoExistente, salvarFoto } from '../fotos/servico.js';
import {
  buscarPasseio,
  esquemaCursor,
  esquemaLimite,
  esquemaPaginaPasseios,
  esquemaPasseio,
  listarPasseios,
} from './servico.js';

const PASSEIO_LIVRE = 'Passeio livre';

export const MAX_FOTOS_PASSEIO = 4;

/**
 * Trajeto e fotos vêm no mesmo corpo. Fica abaixo dos 4,5 MB que a Vercel aceita; o front
 * reduz as fotos, então quatro delas cabem com folga.
 */
const LIMITE_CORPO_PASSEIO = 4_000_000;

const esquemaFotos = z
  .array(esquemaImagem)
  .max(MAX_FOTOS_PASSEIO, `Envie no máximo ${MAX_FOTOS_PASSEIO} fotos`);

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
      bodyLimit: LIMITE_CORPO_PASSEIO,
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
          petIds: z
            .array(idNumerico)
            .min(1)
            .max(20)
            .optional()
            .describe('Pets do tutor que foram no passeio; sem o campo, vão todos'),
          fotos: esquemaFotos.default([]).describe('Fotos do passeio, na ordem em que aparecem'),
        }),
        response: { 201: esquemaPasseio, ...erros(400, 401) },
      },
    },
    async (req, reply) => {
      const { id: usuarioId } = usuarioDe(req);
      const { pontos, duracaoMin, texto, rotaId, petIds, fotos } = req.body;

      const meusPets = await app.banco
        .select({ id: pets.id })
        .from(pets)
        .where(eq(pets.usuarioId, usuarioId));
      const idsMeus = new Set(meusPets.map((p) => p.id));
      if (petIds?.some((id) => !idsMeus.has(id))) {
        throw new ErroApi(400, 'Dados inválidos', { petIds: 'Escolha só pets do seu perfil' });
      }
      const petsDoPasseio = petIds ? [...new Set(petIds)] : [...idsMeus];

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

      const id = await app.banco.transaction(async (tx) => {
        const [criado] = await tx
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
        if (petsDoPasseio.length) {
          await tx
            .insert(passeioPets)
            .values(petsDoPasseio.map((petId) => ({ passeioId: criado!.id, petId })));
        }
        for (const [ordem, imagem] of fotos.entries()) {
          const fotoId = await salvarFoto(tx, usuarioId, imagem);
          await tx.insert(passeioFotos).values({ passeioId: criado!.id, fotoId, ordem });
        }
        return criado!.id;
      });
      return reply.status(201).send(await buscarPasseio(app.banco, usuarioId, id));
    },
  );

  app.patch(
    '/:id',
    {
      bodyLimit: LIMITE_CORPO_PASSEIO,
      schema: {
        tags: ['passeios'],
        summary: 'Atualiza só os campos enviados (só quem registrou)',
        security: seguranca,
        params: paramId,
        body: z
          .object({
            duracaoMin: z.number().int().min(1).max(1440),
            texto: z.string().trim().max(500),
            fotos: z
              .array(z.union([fotoExistente, esquemaImagem]))
              .max(MAX_FOTOS_PASSEIO, `Envie no máximo ${MAX_FOTOS_PASSEIO} fotos`)
              .describe(
                'Lista final, na ordem: caminhos (`/fotos/<id>`) das que ficam e data URLs das novas',
              ),
          })
          .partial(),
        response: { 200: esquemaPasseio, ...erros(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const { id: usuarioId } = usuarioDe(req);
      const { id } = req.params;
      if ((await autorDoPasseio(id)) !== usuarioId) {
        throw proibido('Só quem registrou pode alterar o passeio');
      }
      const { fotos, ...campos } = req.body;

      await app.banco.transaction(async (tx) => {
        if (Object.keys(campos).length) {
          await tx.update(passeios).set(campos).where(eq(passeios.id, id));
        }
        if (!fotos) return;

        const atuais = await tx
          .select({ id: passeioFotos.fotoId })
          .from(passeioFotos)
          .where(eq(passeioFotos.passeioId, id));
        const idsAtuais = new Set(atuais.map((f) => f.id));
        const mantidas = new Set<string>();
        const final: string[] = [];
        for (const foto of fotos) {
          if ('id' in foto) {
            if (!idsAtuais.has(foto.id) || mantidas.has(foto.id)) {
              throw new ErroApi(400, 'Dados inválidos', { fotos: 'Foto não é deste passeio' });
            }
            mantidas.add(foto.id);
            final.push(foto.id);
          } else {
            final.push(await salvarFoto(tx, usuarioId, foto));
          }
        }

        await tx.delete(passeioFotos).where(eq(passeioFotos.passeioId, id));
        if (final.length) {
          await tx
            .insert(passeioFotos)
            .values(final.map((fotoId, ordem) => ({ passeioId: id, fotoId, ordem })));
        }
        await apagarFotos(
          tx,
          [...idsAtuais].filter((f) => !mantidas.has(f)),
        );
      });
      return buscarPasseio(app.banco, usuarioId, id);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['passeios'],
        summary: 'Apaga um passeio e as fotos dele (só quem registrou)',
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
      await app.banco.transaction(async (tx) => {
        const fotos = await tx
          .select({ id: passeioFotos.fotoId })
          .from(passeioFotos)
          .where(eq(passeioFotos.passeioId, id));
        await tx.delete(passeios).where(eq(passeios.id, id));
        await apagarFotos(
          tx,
          fotos.map((f) => f.id),
        );
      });
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
