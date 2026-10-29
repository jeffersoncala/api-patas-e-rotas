import { and, asc, between, desc, eq, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';
import {
  avaliacoes,
  contratacoes,
  prestadores,
  prestadorFotos,
  usuarios,
  type LatLng,
  type Preco,
  type TIPOS_SERVICO,
} from '../../db/schema.js';
import { ErroApi, naoEncontrado, proibido } from '../../erros.js';
import { distanciaSql, KM_POR_GRAU_LAT } from '../../geo.js';
import { apagarFotos, salvarFoto, urlFoto, type Imagem } from '../fotos/servico.js';
import { lerJson } from '../passeios/servico.js';

/** Teto da busca, para a lista não crescer sem limite numa região cheia. */
const MAX_RESULTADOS = 200;

/** Avaliações mostradas no perfil do prestador, das mais novas para as mais antigas. */
const MAX_AVALIACOES = 50;

export type TipoServico = (typeof TIPOS_SERVICO)[number];

export interface DadosPrestador {
  tipo: TipoServico;
  nome: string;
  descricao: string;
  contato: string;
  bairro: string;
  posicao: LatLng;
  precos: Preco[];
  fotos: Imagem[];
}

/** Na edição, as fotos vêm como a lista final: as que ficam (pelo id) e as novas. */
export type AlteracaoPrestador = Partial<Omit<DadosPrestador, 'tipo' | 'fotos'>> & {
  ativo?: boolean;
  fotos?: ({ id: string } | Imagem)[];
};

export interface FiltrosPrestadores {
  tipo?: TipoServico;
  lat: number;
  lng: number;
  raioKm: number;
}

const distanciaAte = (origem: LatLng) =>
  distanciaSql(prestadores.latitude, prestadores.longitude, origem);

/** Avaliações do prestador, pela contratação em que foram feitas. */
const avaliacoesDoPrestador = sql`${avaliacoes} inner join ${contratacoes} on ${contratacoes.id} = ${avaliacoes.contratacaoId} where ${contratacoes.prestadorId} = ${prestadores.id}`;

/** Fotos, nota e total de avaliações agregados por subconsulta (uma consulta para a lista toda). */
function consultar(banco: Banco, onde: SQL | undefined, origem?: LatLng) {
  return banco
    .select({
      id: prestadores.id,
      usuarioId: prestadores.usuarioId,
      tipo: prestadores.tipo,
      nome: prestadores.nome,
      descricao: prestadores.descricao,
      contato: prestadores.contato,
      bairro: prestadores.bairro,
      latitude: prestadores.latitude,
      longitude: prestadores.longitude,
      precos: prestadores.precos,
      ativo: prestadores.ativo,
      fotoUsuario: usuarios.fotoId,
      fotos:
        sql`coalesce((select json_agg(${prestadorFotos.fotoId} order by ${prestadorFotos.ordem}) from ${prestadorFotos} where ${prestadorFotos.prestadorId} = ${prestadores.id}), '[]'::json)`.mapWith(
          (valor) => lerJson<string[]>(valor),
        ),
      notaMedia: sql`(select avg(${avaliacoes.nota}) from ${avaliacoesDoPrestador})`.mapWith(
        (valor) => (valor === null ? null : Math.round(Number(valor) * 10) / 10),
      ),
      totalAvaliacoes: sql<number>`(select count(*) from ${avaliacoesDoPrestador})`.mapWith(Number),
      distanciaKm: (origem ? distanciaAte(origem) : sql`null`).mapWith((valor) =>
        valor === null ? null : Number(valor),
      ),
    })
    .from(prestadores)
    .innerJoin(usuarios, eq(usuarios.id, prestadores.usuarioId))
    .where(onde);
}

type Linha = Awaited<ReturnType<typeof consultar>>[number];

/** Mesmo formato do `Prestador` do front. */
function formatar(usuarioId: string, linha: Linha) {
  return {
    id: linha.id,
    tipo: linha.tipo,
    nome: linha.nome,
    descricao: linha.descricao,
    contato: linha.contato,
    bairro: linha.bairro,
    posicao: [linha.latitude, linha.longitude] as LatLng,
    precos: linha.precos,
    fotos: linha.fotos.map((id) => urlFoto(id)!),
    fotoUsuario: urlFoto(linha.fotoUsuario),
    ativo: linha.ativo,
    notaMedia: linha.notaMedia,
    totalAvaliacoes: linha.totalAvaliacoes,
    meu: linha.usuarioId === usuarioId,
  };
}

export class PrestadoresServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  /**
   * Os ativos dentro do raio, do mais perto para o mais longe. A faixa de latitude usa o
   * índice e descarta quase tudo antes de calcular a distância exata.
   */
  async listar(usuarioId: string, { tipo, lat, lng, raioKm }: FiltrosPrestadores) {
    const origem: LatLng = [lat, lng];
    const distancia = distanciaAte(origem);
    const faixa = raioKm / KM_POR_GRAU_LAT;
    const linhas = await consultar(
      this.banco,
      and(
        eq(prestadores.ativo, true),
        tipo && eq(prestadores.tipo, tipo),
        between(prestadores.latitude, lat - faixa, lat + faixa),
        lte(distancia, raioKm),
      ),
      origem,
    )
      .orderBy(asc(distancia), asc(prestadores.id))
      .limit(MAX_RESULTADOS);
    return linhas.map((linha) => ({
      ...formatar(usuarioId, linha),
      distanciaKm: Math.round(linha.distanciaKm! * 1000) / 1000,
    }));
  }

  /** Os cadastros de quem está logado, inclusive os pausados. */
  async meus(usuarioId: string) {
    const linhas = await consultar(this.banco, eq(prestadores.usuarioId, usuarioId)).orderBy(
      asc(prestadores.id),
    );
    return linhas.map((linha) => formatar(usuarioId, linha));
  }

  async buscar(usuarioId: string, id: number) {
    const [linha] = await consultar(this.banco, eq(prestadores.id, id));
    if (!linha) throw naoEncontrado('Prestador');
    return formatar(usuarioId, linha);
  }

  async avaliacoes(id: number) {
    await this.exigir(id);
    const linhas = await this.banco
      .select({
        nota: avaliacoes.nota,
        comentario: avaliacoes.comentario,
        data: avaliacoes.criadoEm,
        cliente: usuarios.tutor,
        fotoCliente: usuarios.fotoId,
      })
      .from(avaliacoes)
      .innerJoin(contratacoes, eq(contratacoes.id, avaliacoes.contratacaoId))
      .innerJoin(usuarios, eq(usuarios.id, contratacoes.clienteId))
      .where(eq(contratacoes.prestadorId, id))
      .orderBy(desc(avaliacoes.criadoEm), desc(avaliacoes.contratacaoId))
      .limit(MAX_AVALIACOES);
    return linhas.map((a) => ({
      ...a,
      data: a.data.toISOString(),
      fotoCliente: urlFoto(a.fotoCliente),
    }));
  }

  async criar(usuarioId: string, { fotos, posicao, ...dados }: DadosPrestador) {
    const [repetido] = await this.banco
      .select({ id: prestadores.id })
      .from(prestadores)
      .where(and(eq(prestadores.usuarioId, usuarioId), eq(prestadores.tipo, dados.tipo)));
    if (repetido) {
      throw new ErroApi(409, 'Você já oferece esse serviço. Edite o cadastro que já existe');
    }

    const id = await this.banco.transaction(async (tx) => {
      const [criado] = await tx
        .insert(prestadores)
        .values({ ...dados, usuarioId, latitude: posicao[0], longitude: posicao[1] })
        .returning({ id: prestadores.id });
      const ids = [];
      for (const foto of fotos) ids.push(await salvarFoto(tx, usuarioId, foto));
      if (ids.length) {
        await tx
          .insert(prestadorFotos)
          .values(ids.map((fotoId, ordem) => ({ prestadorId: criado!.id, fotoId, ordem })));
      }
      return criado!.id;
    });
    return this.buscar(usuarioId, id);
  }

  async alterar(usuarioId: string, id: number, { fotos, posicao, ...campos }: AlteracaoPrestador) {
    await this.exigirDono(usuarioId, id);

    await this.banco.transaction(async (tx) => {
      const valores = {
        ...campos,
        ...(posicao && { latitude: posicao[0], longitude: posicao[1] }),
      };
      if (Object.keys(valores).length) {
        await tx.update(prestadores).set(valores).where(eq(prestadores.id, id));
      }
      if (!fotos) return;

      const atuais = await tx
        .select({ id: prestadorFotos.fotoId })
        .from(prestadorFotos)
        .where(eq(prestadorFotos.prestadorId, id));
      const idsAtuais = new Set(atuais.map((f) => f.id));
      const mantidas = new Set<string>();
      const final: string[] = [];
      for (const foto of fotos) {
        if ('id' in foto) {
          if (!idsAtuais.has(foto.id) || mantidas.has(foto.id)) {
            throw new ErroApi(400, 'Dados inválidos', { fotos: 'Foto não é deste cadastro' });
          }
          mantidas.add(foto.id);
          final.push(foto.id);
        } else {
          final.push(await salvarFoto(tx, usuarioId, foto));
        }
      }

      await tx.delete(prestadorFotos).where(eq(prestadorFotos.prestadorId, id));
      if (final.length) {
        await tx
          .insert(prestadorFotos)
          .values(final.map((fotoId, ordem) => ({ prestadorId: id, fotoId, ordem })));
      }
      await apagarFotos(
        tx,
        [...idsAtuais].filter((f) => !mantidas.has(f)),
      );
    });
    return this.buscar(usuarioId, id);
  }

  /** Apaga o cadastro, as fotos e, junto, os pedidos e avaliações dele. */
  async apagar(usuarioId: string, id: number) {
    await this.exigirDono(usuarioId, id);
    await this.banco.transaction(async (tx) => {
      const fotos = await tx
        .select({ id: prestadorFotos.fotoId })
        .from(prestadorFotos)
        .where(eq(prestadorFotos.prestadorId, id));
      await tx.delete(prestadores).where(eq(prestadores.id, id));
      await apagarFotos(
        tx,
        fotos.map((f) => f.id),
      );
    });
  }

  private async exigir(id: number) {
    const [linha] = await this.banco
      .select({ usuarioId: prestadores.usuarioId })
      .from(prestadores)
      .where(eq(prestadores.id, id));
    if (!linha) throw naoEncontrado('Prestador');
    return linha;
  }

  private async exigirDono(usuarioId: string, id: number) {
    const linha = await this.exigir(id);
    if (linha.usuarioId !== usuarioId) {
      throw proibido('Só quem cadastrou pode alterar este serviço');
    }
  }
}
