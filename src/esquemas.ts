import { z } from 'zod';
import { esquemaErro } from './erros.js';

/** Texto obrigatório: sem espaços nas pontas e não pode ficar vazio. */
export const textoObrigatorio = (max: number) => z.string().trim().min(1).max(max);

export const email = z.string().trim().toLowerCase().pipe(z.email());

export const latLng = z
  .tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
  .describe('[latitude, longitude]');

export const trajeto = z.array(latLng).min(2).max(5000);

/** Ids numéricos são `integer` (32 bits) no Postgres: acima disso a consulta daria erro. */
export const idNumerico = z.number().int().positive().max(2_147_483_647);

export const paramId = z.object({ id: z.coerce.number().pipe(idNumerico) });

/** Datas saem sempre em ISO 8601 (UTC). */
export const dataIso = z.iso.datetime();

/** Respostas de erro documentadas no OpenAPI (todas com o mesmo corpo). */
export function erros<const S extends readonly number[]>(...status: S) {
  return Object.fromEntries(status.map((s) => [s, esquemaErro])) as {
    [K in S[number]]: typeof esquemaErro;
  };
}

export const semConteudo = z.null().describe('Sem conteúdo');

export const seguranca = [{ bearer: [] }];
