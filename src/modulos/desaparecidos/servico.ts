import { and, asc, between, desc, eq, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';
import { desaparecidos, usuarios, type LatLng } from '../../db/schema.js';
import { naoEncontrado, proibido } from '../../erros.js';
import { apagarFotos, salvarFoto, urlFoto, type Imagem } from '../fotos/servico.js';

/** Teto da busca, para a lista não crescer sem limite numa região cheia. */
const MAX_RESULTADOS = 200;

/** Um grau de latitude tem ~111 km em qualquer ponto do globo. */
const KM_POR_GRAU_LAT = 111.32;

export interface DadosDesaparecido {
  nome: string;
  especie: (typeof desaparecidos.especie.enumValues)[number];
  raca: string;
  porte: (typeof desaparecidos.porte.enumValues)[number];
  descricao: string;
  contato: string;
  posicao: LatLng;
  /** ISO 8601 com fuso, já validado como não futuro. */
  vistoEm: string;
  foto?: Imagem;
}

export interface FiltrosDesaparecidos {
  lat: number;
  lng: number;
  raioKm: number;
}

/** Distância em km (haversine) entre o ponto dado e o local onde o pet foi visto. */
function distanciaAte([lat, lng]: LatLng) {
  return sql<number>`2 * 6371 * asin(sqrt(power(sin(radians(${desaparecidos.latitude} - ${lat}::float8) / 2), 2) + cos(radians(${lat}::float8)) * cos(radians(${desaparecidos.latitude})) * power(sin(radians(${desaparecidos.longitude} - ${lng}::float8) / 2), 2)))`;
}

function consultar(banco: Banco, onde: SQL | undefined, origem?: LatLng) {
  return banco
    .select({
      id: desaparecidos.id,
      nome: desaparecidos.nome,
      especie: desaparecidos.especie,
      raca: desaparecidos.raca,
      porte: desaparecidos.porte,
      descricao: desaparecidos.descricao,
      contato: desaparecidos.contato,
      fotoId: desaparecidos.fotoId,
      latitude: desaparecidos.latitude,
      longitude: desaparecidos.longitude,
      vistoEm: desaparecidos.vistoEm,
      encontradoEm: desaparecidos.encontradoEm,
      usuarioId: desaparecidos.usuarioId,
      tutor: usuarios.tutor,
      distanciaKm: (origem ? distanciaAte(origem) : sql`null`).mapWith((valor) =>
        valor === null ? null : Number(valor),
      ),
    })
    .from(desaparecidos)
    .innerJoin(usuarios, eq(usuarios.id, desaparecidos.usuarioId))
    .where(onde);
}

type Linha = Awaited<ReturnType<typeof consultar>>[number];

/** Mesmo formato do `Desaparecido` do front. */
function formatar(usuarioId: string, linha: Linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    especie: linha.especie,
    raca: linha.raca,
    porte: linha.porte,
    descricao: linha.descricao,
    contato: linha.contato,
    foto: urlFoto(linha.fotoId),
    posicao: [linha.latitude, linha.longitude] as LatLng,
    vistoEm: linha.vistoEm.toISOString(),
    encontrado: linha.encontradoEm !== null,
    tutor: linha.tutor,
    meu: linha.usuarioId === usuarioId,
  };
}

export class DesaparecidosServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  /**
   * Os ainda não encontrados dentro do raio, do mais perto para o mais longe. A faixa de
   * latitude usa o índice e descarta quase tudo antes de calcular a distância exata.
   */
  async listar(usuarioId: string, { lat, lng, raioKm }: FiltrosDesaparecidos) {
    const origem: LatLng = [lat, lng];
    const distancia = distanciaAte(origem);
    const faixa = raioKm / KM_POR_GRAU_LAT;
    const linhas = await consultar(
      this.banco,
      and(
        isNull(desaparecidos.encontradoEm),
        between(desaparecidos.latitude, lat - faixa, lat + faixa),
        lte(distancia, raioKm),
      ),
      origem,
    )
      .orderBy(asc(distancia), desc(desaparecidos.vistoEm), asc(desaparecidos.id))
      .limit(MAX_RESULTADOS);
    return linhas.map((linha) => ({
      ...formatar(usuarioId, linha),
      // Em metros: o bastante para "350 m" ou "2,4 km" no front.
      distanciaKm: Math.round(linha.distanciaKm! * 1000) / 1000,
    }));
  }

  async buscar(usuarioId: string, id: number) {
    const [linha] = await consultar(this.banco, eq(desaparecidos.id, id));
    if (!linha) throw naoEncontrado('Pet desaparecido');
    return formatar(usuarioId, linha);
  }

  async criar(usuarioId: string, { foto, posicao, vistoEm, ...dados }: DadosDesaparecido) {
    const id = await this.banco.transaction(async (tx) => {
      const fotoId = foto ? await salvarFoto(tx, usuarioId, foto) : null;
      const [criado] = await tx
        .insert(desaparecidos)
        .values({
          ...dados,
          usuarioId,
          fotoId,
          latitude: posicao[0],
          longitude: posicao[1],
          vistoEm: new Date(vistoEm),
        })
        .returning({ id: desaparecidos.id });
      return criado!.id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Garante que o cadastro existe e é do usuário; devolve a foto para limpeza. */
  private async exigirAutor(usuarioId: string, id: number) {
    const [linha] = await this.banco
      .select({ usuarioId: desaparecidos.usuarioId, fotoId: desaparecidos.fotoId })
      .from(desaparecidos)
      .where(eq(desaparecidos.id, id));
    if (!linha) throw naoEncontrado('Pet desaparecido');
    if (linha.usuarioId !== usuarioId) {
      throw proibido('Só quem cadastrou pode alterar este pet desaparecido');
    }
    return linha;
  }

  /** Idempotente: marcar de novo mantém a data da primeira vez. */
  async marcarEncontrado(usuarioId: string, id: number) {
    await this.exigirAutor(usuarioId, id);
    await this.banco
      .update(desaparecidos)
      .set({ encontradoEm: new Date() })
      .where(and(eq(desaparecidos.id, id), isNull(desaparecidos.encontradoEm)));
    return this.buscar(usuarioId, id);
  }

  async apagar(usuarioId: string, id: number) {
    const { fotoId } = await this.exigirAutor(usuarioId, id);
    await this.banco.transaction(async (tx) => {
      await tx.delete(desaparecidos).where(eq(desaparecidos.id, id));
      await apagarFotos(tx, [fotoId]);
    });
  }
}
