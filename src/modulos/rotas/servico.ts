import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { favoritas, rotas } from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { latLng } from '../../esquemas.js';

/** `Rota` do front mais distância, contagem de favoritos e autoria. */
export const esquemaRota = z
  .object({
    id: z.number().int(),
    nome: z.string(),
    bairro: z.string(),
    descricao: z.string(),
    pontos: z.array(latLng),
    distanciaKm: z.number().describe('Calculada no servidor a partir dos pontos'),
    duracaoMin: z.number().int(),
    favorita: z.boolean().describe('Se o usuário da requisição favoritou'),
    favoritadas: z.number().int().describe('Quantos usuários favoritaram'),
    autorId: z.string(),
    minha: z.boolean(),
  })
  .meta({ id: 'Rota' });

export type Rota = z.infer<typeof esquemaRota>;

/** `favorita` e `favoritadas` por subconsulta correlacionada: uma consulta só, sem N+1. */
const favoritaDe = (usuarioId: string) =>
  sql<boolean>`exists(select 1 from ${favoritas} where ${favoritas.rotaId} = ${rotas.id} and ${favoritas.usuarioId} = ${usuarioId})`;

function consultar(banco: Banco, usuarioId: string, filtro: SQL | undefined) {
  return banco
    .select({
      id: rotas.id,
      nome: rotas.nome,
      bairro: rotas.bairro,
      descricao: rotas.descricao,
      pontos: rotas.pontos,
      distanciaKm: rotas.distanciaKm,
      duracaoMin: rotas.duracaoMin,
      favorita: favoritaDe(usuarioId).mapWith(Boolean),
      favoritadas:
        sql<number>`(select count(*) from ${favoritas} where ${favoritas.rotaId} = ${rotas.id})`.mapWith(
          Number,
        ),
      autorId: rotas.autorId,
      minha: sql<boolean>`${rotas.autorId} = ${usuarioId}`.mapWith(Boolean),
    })
    .from(rotas)
    .where(filtro);
}

export function listarRotas(
  banco: Banco,
  usuarioId: string,
  soFavoritas: boolean,
): Promise<Rota[]> {
  return consultar(banco, usuarioId, soFavoritas ? favoritaDe(usuarioId) : undefined).orderBy(
    asc(rotas.nome),
    asc(rotas.id),
  );
}

export async function buscarRota(banco: Banco, usuarioId: string, id: number): Promise<Rota> {
  const [rota] = await consultar(banco, usuarioId, eq(rotas.id, id));
  if (!rota) throw naoEncontrado('Rota', 'f');
  return rota;
}
