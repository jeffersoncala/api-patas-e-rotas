import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { curtidas, passeios, pets, usuarios } from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { dataIso, latLng } from '../../esquemas.js';

/** Mesmo formato do `Passeio` do front. */
export const esquemaPasseio = z
  .object({
    id: z.number().int(),
    pet: z.string().describe('Nome do pet de quem registrou'),
    tutor: z.string(),
    data: dataIso,
    rotaId: z.number().int().nullable().describe('null em passeio livre ou se a rota foi apagada'),
    rotaNome: z.string(),
    pontos: z.array(latLng),
    distanciaKm: z.number().describe('Calculada no servidor a partir dos pontos'),
    duracaoMin: z.number().int(),
    texto: z.string(),
    curtidas: z.number().int(),
    curtido: z.boolean().describe('Se o usuário da requisição curtiu'),
    meu: z.boolean(),
  })
  .meta({ id: 'Passeio' });

export type Passeio = z.infer<typeof esquemaPasseio>;

export const esquemaPaginaPasseios = z
  .object({
    itens: z.array(esquemaPasseio),
    proximoCursor: z
      .string()
      .nullable()
      .describe('Mande como `antesDe` para a próxima página; null quando acabou'),
  })
  .meta({ id: 'PaginaPasseios' });

/**
 * Cursor opaco `<data em ms>.<id>`. Só a data não basta: dois passeios no mesmo
 * milissegundo na virada da página fariam o segundo ser pulado.
 */
export const esquemaCursor = z
  .string()
  .regex(/^\d+\.\d+$/, 'Cursor inválido')
  .transform((c) => {
    const [ms, id] = c.split('.').map(Number) as [number, number];
    return { data: new Date(ms), id };
  });

type Cursor = z.output<typeof esquemaCursor>;

const cursorDe = (p: Passeio) => `${Date.parse(p.data)}.${p.id}`;

export const esquemaLimite = z.coerce.number().int().min(1).max(50).default(20);

/**
 * Colunas do `Passeio` já com curtidas agregadas por subconsulta correlacionada
 * (uma consulta só para a lista inteira, sem N+1).
 */
function colunas(usuarioId: string) {
  return {
    id: passeios.id,
    pet: sql<string>`coalesce(${pets.nome}, '')`,
    tutor: usuarios.tutor,
    data: passeios.data,
    rotaId: passeios.rotaId,
    rotaNome: passeios.rotaNome,
    pontos: passeios.pontos,
    distanciaKm: passeios.distanciaKm,
    duracaoMin: passeios.duracaoMin,
    texto: passeios.texto,
    curtidas:
      sql<number>`(select count(*) from ${curtidas} where ${curtidas.passeioId} = ${passeios.id})`.mapWith(
        Number,
      ),
    curtido:
      sql<boolean>`exists(select 1 from ${curtidas} where ${curtidas.passeioId} = ${passeios.id} and ${curtidas.usuarioId} = ${usuarioId})`.mapWith(
        Boolean,
      ),
    meu: sql<boolean>`${passeios.usuarioId} = ${usuarioId}`.mapWith(Boolean),
  };
}

function consultar(banco: Banco, usuarioId: string, filtro: SQL | undefined) {
  return banco
    .select(colunas(usuarioId))
    .from(passeios)
    .innerJoin(usuarios, eq(usuarios.id, passeios.usuarioId))
    .leftJoin(pets, eq(pets.usuarioId, passeios.usuarioId))
    .where(filtro);
}

type Linha = ReturnType<ReturnType<typeof consultar>['all']>[number];

const paraPasseio = (linha: Linha): Passeio => ({ ...linha, data: linha.data.toISOString() });

export interface FiltroPasseios {
  limite: number;
  autorId?: string;
  rotaId?: number;
  antesDe?: Cursor;
}

/** Mais recentes primeiro, paginado por cursor (data e id do último item). */
export function listarPasseios(banco: Banco, usuarioId: string, filtro: FiltroPasseios) {
  const linhas = consultar(
    banco,
    usuarioId,
    and(
      filtro.autorId !== undefined ? eq(passeios.usuarioId, filtro.autorId) : undefined,
      filtro.rotaId !== undefined ? eq(passeios.rotaId, filtro.rotaId) : undefined,
      filtro.antesDe &&
        or(
          lt(passeios.data, filtro.antesDe.data),
          and(eq(passeios.data, filtro.antesDe.data), lt(passeios.id, filtro.antesDe.id)),
        ),
    ),
  )
    .orderBy(desc(passeios.data), desc(passeios.id))
    // Um a mais só para saber se existe próxima página.
    .limit(filtro.limite + 1)
    .all();

  const itens = linhas.slice(0, filtro.limite).map(paraPasseio);
  const temMais = linhas.length > filtro.limite;
  return { itens, proximoCursor: temMais ? cursorDe(itens.at(-1)!) : null };
}

export function buscarPasseio(banco: Banco, usuarioId: string, id: number): Passeio {
  const linha = consultar(banco, usuarioId, eq(passeios.id, id)).get();
  if (!linha) throw naoEncontrado('Passeio');
  return paraPasseio(linha);
}
