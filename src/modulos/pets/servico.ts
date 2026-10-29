import { and, asc, count, desc, eq, gt, lt, or, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { passeioFotos, passeioPets, passeios, pets, usuarios } from '../../db/schema.js';
import { naoEncontrado } from '../../erros.js';
import { dataIso, idNumerico } from '../../esquemas.js';
import { urlFoto } from '../fotos/servico.js';
import { esquemaPet } from '../perfil/endpoints.js';

/** O que qualquer tutor logado vê de um pet: nada de e-mail ou dados da conta. */
export const esquemaPerfilPet = z
  .object({
    pet: esquemaPet,
    tutor: z.string(),
    fotoTutor: z.string().nullable().describe('Caminho da foto do tutor na API, ou null'),
    meu: z.boolean().describe('Se o pet é do usuário da requisição'),
    totalPasseios: z.number().int(),
    kmTotal: z.number(),
    totalFotos: z.number().int().describe('Quantas fotos há no álbum'),
  })
  .meta({ id: 'PerfilPet' });

const esquemaFotoAlbum = z
  .object({
    foto: z.string().describe('Caminho da foto na API'),
    passeioId: z.number().int(),
    data: dataIso.describe('Data do passeio em que a foto foi tirada'),
  })
  .meta({ id: 'FotoAlbum' });

export const esquemaPaginaAlbum = z
  .object({
    itens: z.array(esquemaFotoAlbum),
    proximoCursor: z
      .string()
      .nullable()
      .describe('Mande como `antesDe` para a próxima página; null quando acabou'),
  })
  .meta({ id: 'PaginaAlbum' });

/**
 * Cursor opaco `<data em ms>.<id do passeio>.<ordem da foto>`: um passeio tem várias fotos,
 * então a página pode terminar no meio dele.
 */
export const esquemaCursorAlbum = z
  .string()
  .regex(/^\d{1,15}\.\d{1,10}\.\d{1,3}$/, 'Cursor inválido')
  .transform((c, ctx) => {
    const [ms, passeioId, ordem] = c.split('.').map(Number) as [number, number, number];
    const data = new Date(ms);
    if (Number.isNaN(data.getTime()) || !idNumerico.safeParse(passeioId).success) {
      ctx.addIssue({ code: 'custom', message: 'Cursor inválido' });
      return z.NEVER;
    }
    return { data, passeioId, ordem };
  });

type CursorAlbum = z.output<typeof esquemaCursorAlbum>;

export const esquemaLimiteAlbum = z.coerce.number().int().min(1).max(60).default(30);

const arredondar = (km: number) => Math.round(km * 100) / 100;

export async function buscarPerfilPet(banco: Banco, usuarioId: string, petId: number) {
  const [linha] = await banco
    .select({ pet: pets, tutor: usuarios.tutor, fotoTutor: usuarios.fotoId })
    .from(pets)
    .innerJoin(usuarios, eq(usuarios.id, pets.usuarioId))
    .where(eq(pets.id, petId));
  if (!linha) throw naoEncontrado('Pet');

  const [[totais], [fotos]] = await Promise.all([
    banco
      .select({ km: sum(passeios.distanciaKm).mapWith(Number), quantidade: count() })
      .from(passeioPets)
      .innerJoin(passeios, eq(passeios.id, passeioPets.passeioId))
      .where(eq(passeioPets.petId, petId)),
    banco
      .select({ quantidade: count() })
      .from(passeioFotos)
      .innerJoin(passeioPets, eq(passeioPets.passeioId, passeioFotos.passeioId))
      .where(eq(passeioPets.petId, petId)),
  ]);

  const { usuarioId: dono, fotoId, ...pet } = linha.pet;
  return {
    pet: { ...pet, foto: urlFoto(fotoId) },
    tutor: linha.tutor,
    fotoTutor: urlFoto(linha.fotoTutor),
    meu: dono === usuarioId,
    totalPasseios: totais?.quantidade ?? 0,
    kmTotal: arredondar(totais?.km ?? 0),
    totalFotos: fotos?.quantidade ?? 0,
  };
}

/**
 * Fotos dos passeios em que o pet foi (as mesmas que aparecem no feed), do passeio mais
 * recente para o mais antigo e, dentro de cada passeio, na ordem escolhida pelo tutor.
 */
export async function listarAlbum(
  banco: Banco,
  petId: number,
  filtro: { limite: number; antesDe?: CursorAlbum },
) {
  const [pet] = await banco.select({ id: pets.id }).from(pets).where(eq(pets.id, petId));
  if (!pet) throw naoEncontrado('Pet');

  const { antesDe } = filtro;
  const linhas = await banco
    .select({
      fotoId: passeioFotos.fotoId,
      ordem: passeioFotos.ordem,
      passeioId: passeios.id,
      data: passeios.data,
    })
    .from(passeioPets)
    .innerJoin(passeios, eq(passeios.id, passeioPets.passeioId))
    .innerJoin(passeioFotos, eq(passeioFotos.passeioId, passeios.id))
    .where(
      and(
        eq(passeioPets.petId, petId),
        antesDe &&
          or(
            lt(passeios.data, antesDe.data),
            and(eq(passeios.data, antesDe.data), lt(passeios.id, antesDe.passeioId)),
            and(
              eq(passeios.data, antesDe.data),
              eq(passeios.id, antesDe.passeioId),
              gt(passeioFotos.ordem, antesDe.ordem),
            ),
          ),
      ),
    )
    .orderBy(desc(passeios.data), desc(passeios.id), asc(passeioFotos.ordem))
    // Um a mais só para saber se existe próxima página.
    .limit(filtro.limite + 1);

  const pagina = linhas.slice(0, filtro.limite);
  const ultima = pagina.at(-1);
  return {
    itens: pagina.map((l) => ({
      foto: urlFoto(l.fotoId)!,
      passeioId: l.passeioId,
      data: l.data.toISOString(),
    })),
    proximoCursor:
      linhas.length > filtro.limite && ultima
        ? `${ultima.data.getTime()}.${ultima.passeioId}.${ultima.ordem}`
        : null,
  };
}
