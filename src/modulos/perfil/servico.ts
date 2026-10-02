import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';
import { pets, usuarios } from '../../db/schema.js';
import { ErroApi, naoEncontrado } from '../../erros.js';

export const MAX_PETS = 10;

type LinhaPet = typeof pets.$inferSelect;

export type DadosPet = Pick<
  typeof pets.$inferInsert,
  'nome' | 'especie' | 'porte' | 'raca' | 'idadeAnos' | 'bio'
>;

export interface DadosTutor {
  tutor?: string;
  metaSemanalKm?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pastas no bucket: o caminho já diz de quem é a foto, e assim uma não serve no lugar da outra. */
const pastaTutor = (usuarioId: string) => `${usuarioId}/tutor/`;
const pastaPet = (usuarioId: string, petId: number) => `${usuarioId}/pets/${petId}/`;

/** Nomes dos pets do usuário na ordem de cadastro ("Mel, Thor"), ou '' se não tiver nenhum. */
export const nomesDosPets = (usuarioId: AnyPgColumn) =>
  sql<string>`coalesce((select string_agg(${pets.nome}, ', ' order by ${pets.id}) from ${pets} where ${pets.usuarioId} = ${usuarioId}), '')`;

function formatarPet({ fotoCaminho: _, usuarioId: __, ...pet }: LinhaPet, fotoUrl: string | null) {
  return { ...pet, fotoUrl };
}

/** Trava a linha do usuário até o fim da transação: serializa quem conta e altera os pets. */
async function travarUsuario(tx: Banco, usuarioId: string) {
  await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId))
    .for('update');
}

async function contarPets(tx: Banco, usuarioId: string) {
  const [linha] = await tx
    .select({ total: count() })
    .from(pets)
    .where(eq(pets.usuarioId, usuarioId));
  return linha?.total ?? 0;
}

export class PerfilServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  async buscar(usuarioId: string) {
    const [usuario] = await this.banco
      .select({
        tutor: usuarios.tutor,
        email: usuarios.email,
        metaSemanalKm: usuarios.metaSemanalKm,
        fotoCaminho: usuarios.fotoCaminho,
      })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    if (!usuario) throw naoEncontrado('Perfil');
    const linhasPets = await this.banco
      .select()
      .from(pets)
      .where(eq(pets.usuarioId, usuarioId))
      .orderBy(asc(pets.id));

    const [fotoTutor, ...fotosPets] = await this.urlsDasFotos([
      usuario.fotoCaminho,
      ...linhasPets.map((p) => p.fotoCaminho),
    ]);
    const { fotoCaminho: _, ...tutor } = usuario;
    return {
      ...tutor,
      fotoUrl: fotoTutor ?? null,
      pets: linhasPets.map((p, i) => formatarPet(p, fotosPets[i] ?? null)),
    };
  }

  async atualizarTutor(usuarioId: string, dados: DadosTutor) {
    if (Object.keys(dados).length) {
      await this.banco.update(usuarios).set(dados).where(eq(usuarios.id, usuarioId));
    }
    return this.buscar(usuarioId);
  }

  /** Apaga a conta (o banco leva pets, passeios etc. em cascata) e depois as fotos do storage. */
  async apagarConta(usuarioId: string) {
    const [usuario] = await this.banco
      .select({ fotoCaminho: usuarios.fotoCaminho })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    const fotosPets = await this.banco
      .select({ fotoCaminho: pets.fotoCaminho })
      .from(pets)
      .where(eq(pets.usuarioId, usuarioId));
    await this.banco.delete(usuarios).where(eq(usuarios.id, usuarioId));
    await this.removerFotos([usuario?.fotoCaminho, ...fotosPets.map((p) => p.fotoCaminho)]);
  }

  async buscarPet(usuarioId: string, petId: number) {
    const pet = await this.exigirPet(usuarioId, petId);
    const [fotoUrl] = await this.urlsDasFotos([pet.fotoCaminho]);
    return formatarPet(pet, fotoUrl ?? null);
  }

  async criarPet(usuarioId: string, dados: DadosPet) {
    const pet = await this.banco.transaction(async (tx) => {
      await travarUsuario(tx, usuarioId);
      if ((await contarPets(tx, usuarioId)) >= MAX_PETS) {
        throw new ErroApi(409, `O perfil pode ter no máximo ${MAX_PETS} pets`);
      }
      const [criado] = await tx
        .insert(pets)
        .values({ ...dados, usuarioId })
        .returning();
      return criado!;
    });
    return formatarPet(pet, null);
  }

  async atualizarPet(usuarioId: string, petId: number, dados: Partial<DadosPet>) {
    await this.exigirPet(usuarioId, petId);
    if (Object.keys(dados).length) {
      await this.banco.update(pets).set(dados).where(eq(pets.id, petId));
    }
    return this.buscarPet(usuarioId, petId);
  }

  async apagarPet(usuarioId: string, petId: number) {
    const apagado = await this.banco.transaction(async (tx) => {
      await travarUsuario(tx, usuarioId);
      const [linha] = await tx
        .delete(pets)
        .where(and(eq(pets.id, petId), eq(pets.usuarioId, usuarioId)))
        .returning({ fotoCaminho: pets.fotoCaminho });
      if (!linha) throw naoEncontrado('Pet');
      // Lançar aqui desfaz o delete.
      if ((await contarPets(tx, usuarioId)) === 0) {
        throw new ErroApi(409, 'O perfil precisa ter ao menos um pet');
      }
      return linha;
    });
    await this.removerFotos([apagado.fotoCaminho]);
  }

  // Fotos: o front pede a URL de upload, envia o arquivo direto ao storage e confirma o caminho.

  uploadFotoTutor(usuarioId: string) {
    return this.novoUpload(pastaTutor(usuarioId));
  }

  async uploadFotoPet(usuarioId: string, petId: number) {
    await this.exigirPet(usuarioId, petId);
    return this.novoUpload(pastaPet(usuarioId, petId));
  }

  async trocarFotoTutor(usuarioId: string, caminho: string | null) {
    if (caminho !== null) await this.exigirFotoEnviada(caminho, pastaTutor(usuarioId));
    const [anterior] = await this.banco
      .select({ fotoCaminho: usuarios.fotoCaminho })
      .from(usuarios)
      .where(eq(usuarios.id, usuarioId));
    await this.banco
      .update(usuarios)
      .set({ fotoCaminho: caminho })
      .where(eq(usuarios.id, usuarioId));
    if (anterior?.fotoCaminho !== caminho) await this.removerFotos([anterior?.fotoCaminho]);
  }

  async trocarFotoPet(usuarioId: string, petId: number, caminho: string | null) {
    const pet = await this.exigirPet(usuarioId, petId);
    if (caminho !== null) await this.exigirFotoEnviada(caminho, pastaPet(usuarioId, petId));
    await this.banco.update(pets).set({ fotoCaminho: caminho }).where(eq(pets.id, petId));
    if (pet.fotoCaminho !== caminho) await this.removerFotos([pet.fotoCaminho]);
  }

  private async exigirPet(usuarioId: string, petId: number) {
    const [pet] = await this.banco
      .select()
      .from(pets)
      .where(and(eq(pets.id, petId), eq(pets.usuarioId, usuarioId)));
    // Pet de outro tutor também dá 404, para não revelar que o id existe.
    if (!pet) throw naoEncontrado('Pet');
    return pet;
  }

  private async novoUpload(pasta: string) {
    const caminho = `${pasta}${randomUUID()}`;
    return { urlUpload: await this.app.armazenamento.urlDeUpload(caminho), caminho };
  }

  /** O caminho tem que ser um dos gerados para esta foto, e o arquivo já tem que ter sido enviado. */
  private async exigirFotoEnviada(caminho: string, pasta: string) {
    if (!caminho.startsWith(pasta) || !UUID.test(caminho.slice(pasta.length))) {
      throw new ErroApi(400, 'Caminho de foto inválido', { caminho: 'não pertence a esta foto' });
    }
    if (!(await this.app.armazenamento.existe(caminho))) {
      throw new ErroApi(400, 'A foto ainda não foi enviada', { caminho: 'arquivo não encontrado' });
    }
  }

  /** Se o storage falhar, o perfil ainda carrega, só que sem as fotos. */
  private async urlsDasFotos(caminhos: (string | null)[]) {
    const existentes = caminhos.filter((c): c is string => c !== null);
    if (!existentes.length) return caminhos.map(() => null);
    let urls: (string | null)[];
    try {
      urls = await this.app.armazenamento.urlsDeLeitura(existentes);
    } catch (erro) {
      this.app.log.error({ err: erro }, 'Falha ao gerar URLs das fotos');
      return caminhos.map(() => null);
    }
    const porCaminho = new Map(existentes.map((c, i) => [c, urls[i] ?? null]));
    return caminhos.map((c) => (c === null ? null : (porCaminho.get(c) ?? null)));
  }

  /** Apagar foto antiga não pode derrubar a requisição: no pior caso sobra um arquivo órfão. */
  private async removerFotos(caminhos: (string | null | undefined)[]) {
    const existentes = caminhos.filter((c): c is string => !!c);
    if (!existentes.length) return;
    try {
      await this.app.armazenamento.remover(existentes);
    } catch (erro) {
      this.app.log.error({ err: erro, caminhos: existentes }, 'Falha ao apagar fotos do storage');
    }
  }
}
