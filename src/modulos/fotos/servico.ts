import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { fotos, TIPOS_FOTO } from '../../db/schema.js';

/** O front reduz as fotos antes de enviar; isto é só o teto. */
export const MAX_BYTES_FOTO = 1_500_000;

/** Base64 ocupa 4/3 do tamanho, mais o prefixo do data URL. */
export const LIMITE_CORPO_FOTO = Math.ceil((MAX_BYTES_FOTO * 4) / 3) + 1024;

type TipoFoto = (typeof TIPOS_FOTO)[number];

/** Primeiros bytes de cada formato, para não aceitar outra coisa com o rótulo de imagem. */
const ASSINATURAS: Record<TipoFoto, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Data URL (`data:image/jpeg;base64,...`) já validado: formato, assinatura e tamanho. */
export const esquemaImagem = z
  .string()
  .max(LIMITE_CORPO_FOTO)
  .describe('Data URL de uma imagem JPEG, PNG ou WebP de até 1,5 MB')
  .transform((valor, ctx) => {
    const [, tipo, dados] = DATA_URL.exec(valor) ?? [];
    if (!tipo || !dados || !TIPOS_FOTO.includes(tipo as TipoFoto)) {
      ctx.addIssue({ code: 'custom', message: 'Envie uma imagem JPEG, PNG ou WebP' });
      return z.NEVER;
    }
    const bytes = Buffer.from(dados, 'base64');
    if (!ASSINATURAS[tipo as TipoFoto](bytes)) {
      ctx.addIssue({ code: 'custom', message: 'O arquivo não é uma imagem válida' });
      return z.NEVER;
    }
    if (bytes.length > MAX_BYTES_FOTO) {
      ctx.addIssue({ code: 'custom', message: 'A imagem pode ter no máximo 1,5 MB' });
      return z.NEVER;
    }
    return { tipo: tipo as TipoFoto, dados };
  });

export type Imagem = z.output<typeof esquemaImagem>;

/** Foto que o registro já tem, pelo caminho que a API devolve; vira o id. */
export const fotoExistente = z
  .string()
  .regex(/^\/fotos\/[0-9a-f-]{36}$/i, 'Caminho de foto inválido')
  .transform((caminho) => ({ id: caminho.slice('/fotos/'.length).toLowerCase() }));

/** Caminho público da foto (relativo à API), ou `null` sem foto. */
export const urlFoto = (id: string | null) => (id ? `/fotos/${id}` : null);

export async function salvarFoto(banco: Banco, usuarioId: string, imagem: Imagem): Promise<string> {
  const [foto] = await banco
    .insert(fotos)
    .values({ usuarioId, ...imagem })
    .returning({ id: fotos.id });
  return foto!.id;
}

export async function apagarFotos(banco: Banco, ids: (string | null)[]): Promise<void> {
  const existentes = ids.filter((id): id is string => id !== null);
  if (existentes.length) await banco.delete(fotos).where(inArray(fotos.id, existentes));
}
