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

type Linha = ReturnType<ReturnType<typeof consultar>['all']>[number];

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

  listar(usuarioId: string, { filtro, periodo }: FiltrosEncontros) {
    const onde = and(
      periodo === 'futuros' ? gte(encontros.data, new Date()) : undefined,
      filtro === 'vou' ? confirmouPresenca(usuarioId) : undefined,
    );
    return consultar(this.banco, usuarioId, onde)
      .all()
      .map((linha) => formatar(usuarioId, linha));
  }

  buscar(usuarioId: string, id: number) {
    const linha = consultar(this.banco, usuarioId, eq(encontros.id, id)).get();
    if (!linha) throw naoEncontrado('Encontro');
    return formatar(usuarioId, linha);
  }

  criar(usuarioId: string, dados: DadosEncontro) {
    const id = this.banco.transaction((tx) => {
      const { id } = tx
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
        .returning({ id: encontros.id })
        .get();
      tx.insert(presencas).values({ encontroId: id, usuarioId }).run();
      return id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Garante que o encontro existe e que o usuário é o organizador. */
  private exigirOrganizador(usuarioId: string, id: number) {
    const encontro = this.banco
      .select({ organizadorId: encontros.organizadorId })
      .from(encontros)
      .where(eq(encontros.id, id))
      .get();
    if (!encontro) throw naoEncontrado('Encontro');
    if (encontro.organizadorId !== usuarioId) {
      throw proibido('Só o organizador pode alterar este encontro');
    }
  }

  atualizar(usuarioId: string, id: number, dados: Partial<DadosEncontro>) {
    this.exigirOrganizador(usuarioId, id);
    const mudancas = colunas(dados);
    if (Object.keys(mudancas).length) {
      this.banco.update(encontros).set(mudancas).where(eq(encontros.id, id)).run();
    }
    return this.buscar(usuarioId, id);
  }

  apagar(usuarioId: string, id: number) {
    this.exigirOrganizador(usuarioId, id);
    this.banco.delete(encontros).where(eq(encontros.id, id)).run();
  }

  private exigirExistente(id: number) {
    const existe = this.banco
      .select({ id: encontros.id })
      .from(encontros)
      .where(eq(encontros.id, id))
      .get();
    if (!existe) throw naoEncontrado('Encontro');
  }

  confirmar(usuarioId: string, id: number) {
    this.exigirExistente(id);
    this.banco.insert(presencas).values({ encontroId: id, usuarioId }).onConflictDoNothing().run();
    return this.buscar(usuarioId, id);
  }

  cancelar(usuarioId: string, id: number) {
    this.exigirExistente(id);
    this.banco
      .delete(presencas)
      .where(and(eq(presencas.encontroId, id), eq(presencas.usuarioId, usuarioId)))
      .run();
    return this.buscar(usuarioId, id);
  }
}
