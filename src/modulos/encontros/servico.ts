import { and, asc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';
import { encontros, pets, presencas, usuarios, type LatLng } from '../../db/schema.js';
import { naoEncontrado, proibido } from '../../erros.js';

export interface DadosEncontro {
  titulo: string;
  descricao: string;
  local: string;
  posicao: LatLng;
  /** ISO 8601 com fuso, já validado como futuro. */
  data: string;
}

export interface FiltrosEncontros {
  filtro: 'todos' | 'vou';
  periodo: 'futuros' | 'todos';
}

/** Colunas do encontro no banco a partir dos dados de entrada (só os enviados). */
function colunas(dados: Partial<DadosEncontro>) {
  const { posicao, data, ...resto } = dados;
  return {
    ...resto,
    ...(posicao && { latitude: posicao[0], longitude: posicao[1] }),
    ...(data !== undefined && { data: new Date(data) }),
  };
}

/** Verdadeiro se o usuário confirmou presença no encontro da linha atual. */
const confirmouPresenca = (usuarioId: string) =>
  sql<boolean>`exists(select 1 from ${presencas} where ${presencas.encontroId} = ${encontros.id} and ${presencas.usuarioId} = ${usuarioId})`;

/**
 * Uma consulta só: organizador via join e presenças via subconsultas correlacionadas
 * (a PK de `presencas` começa por `encontro_id`, então cada uma é uma busca no índice).
 */
function consultar(banco: Banco, usuarioId: string, onde?: SQL) {
  return banco
    .select({
      id: encontros.id,
      titulo: encontros.titulo,
      descricao: encontros.descricao,
      local: encontros.local,
      latitude: encontros.latitude,
      longitude: encontros.longitude,
      data: encontros.data,
      organizadorId: encontros.organizadorId,
      tutor: usuarios.tutor,
      pet: pets.nome,
      confirmados:
        sql<number>`(select count(*) from ${presencas} where ${presencas.encontroId} = ${encontros.id})`.mapWith(
          Number,
        ),
      vou: confirmouPresenca(usuarioId).mapWith(Boolean),
    })
    .from(encontros)
    .innerJoin(usuarios, eq(usuarios.id, encontros.organizadorId))
    .leftJoin(pets, eq(pets.usuarioId, encontros.organizadorId))
    .where(onde)
    .orderBy(asc(encontros.data), asc(encontros.id));
}

type Linha = Awaited<ReturnType<typeof consultar>>[number];

/** Mesmo formato do `Encontro` do front. */
function formatar(usuarioId: string, linha: Linha) {
  return {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    local: linha.local,
    posicao: [linha.latitude, linha.longitude] as LatLng,
    data: linha.data.toISOString(),
    confirmados: linha.confirmados,
    vou: linha.vou,
    organizador: linha.pet ? `${linha.tutor} e ${linha.pet}` : linha.tutor,
    organizadorId: linha.organizadorId,
    meu: linha.organizadorId === usuarioId,
  };
}

export class EncontrosServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  async listar(usuarioId: string, { filtro, periodo }: FiltrosEncontros) {
    const onde = and(
      periodo === 'futuros' ? gte(encontros.data, new Date()) : undefined,
      filtro === 'vou' ? confirmouPresenca(usuarioId) : undefined,
    );
    const linhas = await consultar(this.banco, usuarioId, onde);
    return linhas.map((linha) => formatar(usuarioId, linha));
  }

  async buscar(usuarioId: string, id: number) {
    const [linha] = await consultar(this.banco, usuarioId, eq(encontros.id, id));
    if (!linha) throw naoEncontrado('Encontro');
    return formatar(usuarioId, linha);
  }

  async criar(usuarioId: string, dados: DadosEncontro) {
    const id = await this.banco.transaction(async (tx) => {
      const [criado] = await tx
        .insert(encontros)
        .values({
          organizadorId: usuarioId,
          titulo: dados.titulo,
          descricao: dados.descricao,
          local: dados.local,
          latitude: dados.posicao[0],
          longitude: dados.posicao[1],
          data: new Date(dados.data),
        })
        .returning({ id: encontros.id });
      await tx.insert(presencas).values({ encontroId: criado!.id, usuarioId });
      return criado!.id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Garante que o encontro existe e que o usuário é o organizador. */
  private async exigirOrganizador(usuarioId: string, id: number) {
    const [encontro] = await this.banco
      .select({ organizadorId: encontros.organizadorId })
      .from(encontros)
      .where(eq(encontros.id, id));
    if (!encontro) throw naoEncontrado('Encontro');
    if (encontro.organizadorId !== usuarioId) {
      throw proibido('Só o organizador pode alterar este encontro');
    }
  }

  async atualizar(usuarioId: string, id: number, dados: Partial<DadosEncontro>) {
    await this.exigirOrganizador(usuarioId, id);
    const mudancas = colunas(dados);
    if (Object.keys(mudancas).length) {
      await this.banco.update(encontros).set(mudancas).where(eq(encontros.id, id));
    }
    return this.buscar(usuarioId, id);
  }

  async apagar(usuarioId: string, id: number) {
    await this.exigirOrganizador(usuarioId, id);
    await this.banco.delete(encontros).where(eq(encontros.id, id));
  }

  private async exigirExistente(id: number) {
    const [existe] = await this.banco
      .select({ id: encontros.id })
      .from(encontros)
      .where(eq(encontros.id, id));
    if (!existe) throw naoEncontrado('Encontro');
  }

  async confirmar(usuarioId: string, id: number) {
    await this.exigirExistente(id);
    await this.banco.insert(presencas).values({ encontroId: id, usuarioId }).onConflictDoNothing();
    return this.buscar(usuarioId, id);
  }

  async cancelar(usuarioId: string, id: number) {
    await this.exigirExistente(id);
    await this.banco
      .delete(presencas)
      .where(and(eq(presencas.encontroId, id), eq(presencas.usuarioId, usuarioId)));
    return this.buscar(usuarioId, id);
  }
}
