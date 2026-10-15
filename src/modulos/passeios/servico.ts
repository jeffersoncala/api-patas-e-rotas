import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { curtidas, passeioPets, passeios, pets, usuarios } from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { dataIso, idNumerico, latLng } from '../../esquemas.js';
import { urlFoto } from '../fotos/servico.js';

const esquemaPetDoPasseio = z
  .object({
    id: z.number().int(),
    nome: z.string(),
    foto: z.string().nullable().describe('Caminho da foto na API, ou null'),
  })
  .meta({ id: 'PetDoPasseio' });

type PetDoPasseio = z.infer<typeof esquemaPetDoPasseio>;

/** Mesmo formato do `Passeio` do front. */
export const esquemaPasseio = z
  .object({
    id: z.number().int(),
    pets: z
      .array(esquemaPetDoPasseio)
      .describe('Pets que foram no passeio; vazio se todos já foram removidos do perfil'),
    tutor: z.string(),
    fotoTutor: z.string().nullable().describe('Caminho da foto do tutor na API, ou null'),
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
  .regex(/^\d{1,15}\.\d{1,10}$/, 'Cursor inválido')
  .transform((c, ctx) => {
    const [ms, idCursor] = c.split('.').map(Number) as [number, number];
    const data = new Date(ms);
    if (Number.isNaN(data.getTime()) || !idNumerico.safeParse(idCursor).success) {
      ctx.addIssue({ code: 'custom', message: 'Cursor inválido' });
      return z.NEVER;
    }
    return { data, id: idCursor };
  });

type Cursor = z.output<typeof esquemaCursor>;

const cursorDe = (p: Passeio) => `${Date.parse(p.data)}.${p.id}`;

export const esquemaLimite = z.coerce.number().int().min(1).max(50).default(20);

/** O PGlite já devolve o JSON interpretado; outros drivers podem devolver texto. */
const lerJson = <T>(valor: unknown): T =>
  (typeof valor === 'string' ? JSON.parse(valor) : valor) as T;

/**
 * Colunas do `Passeio` já com pets e curtidas agregados por subconsulta correlacionada
 * (uma consulta só para a lista inteira, sem N+1).
 */
function colunas(usuarioId: string) {
  return {
    id: passeios.id,
    pets: sql`coalesce((select json_agg(json_build_object('id', ${pets.id}, 'nome', ${pets.nome}, 'foto', ${pets.fotoId}) order by ${pets.id}) from ${passeioPets} inner join ${pets} on ${pets.id} = ${passeioPets.petId} where ${passeioPets.passeioId} = ${passeios.id}), '[]'::json)`.mapWith(
      (valor) => lerJson<{ id: number; nome: string; foto: string | null }[]>(valor),
    ),
    tutor: usuarios.tutor,
    fotoTutor: usuarios.fotoId,
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
    .where(filtro);
}

type Linha = Awaited<ReturnType<typeof consultar>>[number];

const paraPasseio = (linha: Linha): Passeio => ({
  ...linha,
  pets: linha.pets.map((pet): PetDoPasseio => ({ ...pet, foto: urlFoto(pet.foto) })),
  fotoTutor: urlFoto(linha.fotoTutor),
  data: linha.data.toISOString(),
});

export interface FiltroPasseios {
  limite: number;
  autorId?: string;
  rotaId?: number;
  antesDe?: Cursor;
}

/** Mais recentes primeiro, paginado por cursor (data e id do último item). */
export async function listarPasseios(banco: Banco, usuarioId: string, filtro: FiltroPasseios) {
  const linhas = await consultar(
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
    .limit(filtro.limite + 1);

  const itens = linhas.slice(0, filtro.limite).map(paraPasseio);
  const temMais = linhas.length > filtro.limite;
  return { itens, proximoCursor: temMais ? cursorDe(itens.at(-1)!) : null };
}

export async function buscarPasseio(banco: Banco, usuarioId: string, id: number): Promise<Passeio> {
  const [linha] = await consultar(banco, usuarioId, eq(passeios.id, id));
  if (!linha) throw naoEncontrado('Passeio');
  return paraPasseio(linha);
}
