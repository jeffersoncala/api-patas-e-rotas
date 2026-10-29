import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticar, usuarioDe } from '../../autenticacao.js';
import { ESPECIES, PORTES, STATUS_CONTRATACAO, TIPOS_SERVICO } from '../../db/schema.js';
import {
  dataIso,
  erros,
  idNumerico,
  latLng,
  paramId,
  semConteudo,
  seguranca,
  textoObrigatorio,
} from '../../esquemas.js';
import { ContratacoesServico, MAX_PONTOS_TRAJETO } from './servico.js';

/** Folga para relógio de celular atrasado. */
const TOLERANCIA_PASSADO_MS = 5 * 60_000;

/** Até onde dá para agendar. */
const MAX_ANTECEDENCIA_MS = 365 * 24 * 60 * 60_000;

/** Hospedagem mais longa que isso é outro tipo de acordo. */
const MAX_DIAS_HOSPEDAGEM = 60;

const dataFutura = z.iso
  .datetime({ offset: true })
  .refine(
    (data) => new Date(data).getTime() >= Date.now() - TOLERANCIA_PASSADO_MS,
    'A data não pode ser no passado',
  )
  .refine(
    (data) => new Date(data).getTime() <= Date.now() + MAX_ANTECEDENCIA_MS,
    'Agende com no máximo um ano de antecedência',
  )
  .describe('ISO 8601 com fuso, ex. 2026-10-01T18:00:00-03:00');

const esquemaPessoa = z.object({
  nome: z.string(),
  foto: z.string().nullable().describe('Caminho da foto na API, ou null'),
});

/** Mesmo formato da `Contratacao` do front. */
const esquemaContratacao = z
  .object({
    id: z.number().int(),
    status: z.enum(STATUS_CONTRATACAO),
    inicio: dataIso,
    fim: dataIso.nullable().describe('Só na hospedagem'),
    contato: z.string().describe('Telefone do cliente'),
    mensagem: z.string(),
    criadoEm: dataIso,
    iniciadoEm: dataIso.nullable().describe('Passeio: quando o passeador pegou o pet'),
    finalizadoEm: dataIso.nullable().describe('Passeio: quando o passeador devolveu o pet'),
    papel: z
      .enum(['cliente', 'prestador'])
      .describe('Se o usuário da requisição fez ou recebeu o pedido'),
    cliente: esquemaPessoa,
    prestador: z.object({
      id: z.number().int(),
      tipo: z.enum(TIPOS_SERVICO),
      nome: z.string(),
      contato: z.string(),
      foto: z.string().nullable(),
    }),
    pets: z.array(
      z.object({
        id: z.number().int(),
        nome: z.string(),
        foto: z.string().nullable(),
        especie: z.enum(ESPECIES),
        porte: z.enum(PORTES),
      }),
    ),
    avaliacao: z
      .object({ nota: z.number().int(), comentario: z.string() })
      .nullable()
      .describe('A avaliação do cliente, depois de concluído'),
  })
  .meta({ id: 'Contratacao' });

/** Um envio a cada ~10 s com um ponto a cada ~3 s dá bem menos que isso. */
const MAX_PONTOS_POR_ENVIO = 200;

const esquemaAcompanhamento = z
  .object({
    status: z.enum(STATUS_CONTRATACAO),
    iniciadoEm: dataIso.nullable(),
    finalizadoEm: dataIso.nullable(),
    posicaoEm: dataIso.nullable().describe('Quando chegou o último ponto'),
    duracaoMin: z.number().int().describe('Do início até agora, ou até o fim'),
    distanciaKm: z.number().describe('Do trajeto inteiro, calculada no servidor'),
    totalPontos: z.number().int().describe('Mande como `desde` na próxima consulta'),
    pontos: z.array(latLng).describe('Os pontos a partir de `desde`'),
  })
  .meta({ id: 'Acompanhamento' });

export const contratacoesEndpoints: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticar);
  const servico = new ContratacoesServico(app);

  app.get(
    '/',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Pedidos que o usuário fez ou recebeu, os mais novos primeiro',
        security: seguranca,
        querystring: z.object({
          papel: z
            .enum(['cliente', 'prestador'])
            .default('cliente')
            .describe('`cliente`: os que fiz; `prestador`: os que recebi'),
        }),
        response: { 200: z.array(esquemaContratacao), ...erros(400, 401) },
      },
    },
    (req) => servico.listar(usuarioDe(req).id, req.query.papel),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Detalhe de um pedido (só o cliente e o prestador enxergam)',
        security: seguranca,
        params: paramId,
        response: { 200: esquemaContratacao, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.buscar(usuarioDe(req).id, req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Pede um serviço; começa pendente, esperando o prestador aceitar',
        security: seguranca,
        body: z
          .object({
            prestadorId: idNumerico,
            petIds: z.array(idNumerico).min(1, 'Escolha pelo menos um pet').max(10),
            inicio: dataFutura,
            fim: dataFutura.optional().describe('Obrigatório na hospedagem'),
            contato: textoObrigatorio(120),
            mensagem: z.string().trim().max(1000).default(''),
          })
          .superRefine(({ inicio, fim }, ctx) => {
            if (!fim) return;
            const dias = (Date.parse(fim) - Date.parse(inicio)) / (24 * 60 * 60_000);
            if (dias <= 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['fim'],
                message: 'O fim deve ser depois do início',
              });
            } else if (dias > MAX_DIAS_HOSPEDAGEM) {
              ctx.addIssue({
                code: 'custom',
                path: ['fim'],
                message: `A hospedagem pode ter no máximo ${MAX_DIAS_HOSPEDAGEM} dias`,
              });
            }
          }),
        response: { 201: esquemaContratacao, ...erros(400, 401, 404) },
      },
    },
    async (req, reply) => reply.status(201).send(await servico.criar(usuarioDe(req).id, req.body)),
  );

  app.put(
    '/:id/status',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Aceita, recusa, inicia o passeio, conclui ou cancela um pedido',
        description:
          'O prestador aceita ou recusa um pedido pendente e conclui um aceito (depois do início). ' +
          'No passeio, o passeador marca `em_andamento` ao pegar o pet (até 2 h antes do horário) ' +
          'e `concluida` ao devolver; o passeio não pode ser concluído sem ter sido iniciado. ' +
          'Qualquer das partes cancela enquanto está pendente ou aceito.',
        security: seguranca,
        params: paramId,
        body: z.object({
          status: z.enum(['aceita', 'recusada', 'em_andamento', 'cancelada', 'concluida']),
        }),
        response: { 200: esquemaContratacao, ...erros(400, 401, 403, 404, 409) },
      },
    },
    (req) => servico.mudarStatus(usuarioDe(req).id, req.params.id, req.body.status),
  );

  app.put(
    '/:id/avaliacao',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Avalia um serviço concluído (só o cliente; de novo substitui)',
        security: seguranca,
        params: paramId,
        body: z.object({
          nota: z.number().int().min(1).max(5),
          comentario: z.string().trim().max(500).default(''),
        }),
        response: { 200: esquemaContratacao, ...erros(400, 401, 403, 404, 409) },
      },
    },
    (req) => servico.avaliar(usuarioDe(req).id, req.params.id, req.body.nota, req.body.comentario),
  );

  app.post(
    '/:id/posicoes',
    {
      schema: {
        tags: ['servicos'],
        summary: 'O passeador envia os pontos novos do GPS (só com o passeio em andamento)',
        description:
          'Chamado a cada poucos segundos com os pontos acumulados desde o último envio. ' +
          `O trajeto inteiro tem no máximo ${MAX_PONTOS_TRAJETO} pontos.`,
        security: seguranca,
        params: paramId,
        body: z.object({ pontos: z.array(latLng).min(1).max(MAX_PONTOS_POR_ENVIO) }),
        response: { 204: semConteudo, ...erros(400, 401, 403, 404, 409) },
      },
    },
    async (req, reply) => {
      await servico.registrarPosicoes(usuarioDe(req).id, req.params.id, req.body.pontos);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/:id/acompanhamento',
    {
      schema: {
        tags: ['servicos'],
        summary: 'Trajeto do passeio para acompanhar ao vivo (só o cliente e o passeador)',
        description:
          'Feito para ser consultado a cada poucos segundos: mande em `desde` o `totalPontos` ' +
          'da resposta anterior e venham só os pontos novos.',
        security: seguranca,
        params: paramId,
        querystring: z.object({
          desde: z.coerce.number().int().min(0).default(0).describe('Pula os primeiros N pontos'),
        }),
        response: { 200: esquemaAcompanhamento, ...erros(400, 401, 404) },
      },
    },
    (req) => servico.acompanhamento(usuarioDe(req).id, req.params.id, req.query.desde),
  );
};
