import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Erro de negócio com status HTTP. A mensagem vai para o cliente, então nada de detalhe interno. */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Erros por campo, no mesmo formato da validação de schema (vai em `campos`). */
    readonly campos?: Record<string, string>,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export const naoEncontrado = (recurso: string, genero: 'm' | 'f' = 'm') =>
  new ErroApi(404, `${recurso} não ${genero === 'f' ? 'encontrada' : 'encontrado'}`);
export const proibido = (mensagem = 'Você não pode alterar isto') => new ErroApi(403, mensagem);
export const naoAutorizado = (mensagem = 'Token ausente, inválido ou expirado') =>
  new ErroApi(401, mensagem);

/**
 * Corpo de erro igual ao da API Java anterior, para o front não precisar mudar:
 * `{ timestamp, status, erro, mensagem, campos? }`.
 */
export const esquemaErro = z
  .object({
    timestamp: z.string(),
    status: z.number().int(),
    erro: z.string(),
    mensagem: z.string(),
    campos: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: 'Erro' });

export type CorpoErro = z.infer<typeof esquemaErro>;

export function corpoErro(status: number, mensagem: string, campos?: Record<string, string>) {
  return {
    timestamp: new Date().toISOString(),
    status,
    erro: STATUS_CODES[status] ?? 'Error',
    mensagem,
    ...(campos && { campos }),
  } satisfies CorpoErro;
}

export function registrarTratamentoDeErros(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(corpoErro(404, `Rota ${req.method} ${req.url} não existe`));
  });

  app.setErrorHandler((erro: FastifyError, req, reply) => {
    if (erro instanceof ErroApi) {
      return reply.status(erro.status).send(corpoErro(erro.status, erro.message, erro.campos));
    }

    if (hasZodFastifySchemaValidationErrors(erro)) {
      // "/pet/nome" -> "pet.nome"; erro no objeto inteiro (sem caminho) vira "corpo".
      const campos: Record<string, string> = {};
      for (const falha of erro.validation) {
        const campo = falha.instancePath.slice(1).replaceAll('/', '.') || 'corpo';
        campos[campo] ??= falha.message ?? 'inválido';
      }
      return reply.status(400).send(corpoErro(400, 'Dados inválidos', campos));
    }

    // Erros do próprio Fastify com status 4xx (JSON malformado, corpo grande demais, 429...).
    const status = erro.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send(corpoErro(status, erro.message));
    }

    req.log.error({ err: erro }, 'Erro inesperado');
    return reply.status(500).send(corpoErro(500, 'Erro interno. Tente novamente em instantes'));
  });
}
