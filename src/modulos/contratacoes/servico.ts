import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';
import {
  avaliacoes,
  contratacaoPets,
  contratacoes,
  pets,
  prestadores,
  type ESPECIES,
  type LatLng,
  type PORTES,
  usuarios,
  type STATUS_CONTRATACAO,
} from '../../db/schema.js';
import { ErroApi, naoEncontrado, proibido } from '../../erros.js';
import { distanciaTrajeto } from '../../geo.js';
import { urlFoto } from '../fotos/servico.js';
import { lerJson } from '../passeios/servico.js';

export type StatusContratacao = (typeof STATUS_CONTRATACAO)[number];
export type Papel = 'cliente' | 'prestador';

interface PetDoPedido {
  id: number;
  nome: string;
  foto: string | null;
  especie: (typeof ESPECIES)[number];
  porte: (typeof PORTES)[number];
}

export interface DadosContratacao {
  prestadorId: number;
  petIds: number[];
  /** ISO 8601 com fuso, já validado como futuro. */
  inicio: string;
  fim?: string;
  contato: string;
  mensagem: string;
}

/**
 * Quem pode levar o pedido de um status a outro. O prestador conduz o serviço; o cliente
 * só desiste. Recusada, cancelada e concluída são finais. `em_andamento` é só do passeio
 * (veja `mudarStatus`): começa quando o passeador pega o pet e termina quando ele devolve.
 */
const TRANSICOES: Record<StatusContratacao, Partial<Record<StatusContratacao, Papel[]>>> = {
  pendente: { aceita: ['prestador'], recusada: ['prestador'], cancelada: ['cliente', 'prestador'] },
  aceita: {
    em_andamento: ['prestador'],
    concluida: ['prestador'],
    cancelada: ['cliente', 'prestador'],
  },
  em_andamento: { concluida: ['prestador'] },
  recusada: {},
  cancelada: {},
  concluida: {},
};

const ROTULOS: Record<StatusContratacao, string> = {
  pendente: 'pendente',
  aceita: 'aceito',
  em_andamento: 'em andamento',
  recusada: 'recusado',
  cancelada: 'cancelado',
  concluida: 'concluído',
};

/** Teto do trajeto (o mesmo dos passeios): ~4 h de passeio com um ponto a cada 3 s. */
export const MAX_PONTOS_TRAJETO = 5000;

/** Pode começar o passeio um pouco antes do horário marcado. */
const ANTECEDENCIA_INICIO_MS = 2 * 60 * 60_000;

const donoDoServico = alias(usuarios, 'dono_do_servico');

function consultar(banco: Banco, onde: SQL | undefined) {
  return banco
    .select({
      id: contratacoes.id,
      status: contratacoes.status,
      inicio: contratacoes.inicio,
      fim: contratacoes.fim,
      contato: contratacoes.contato,
      mensagem: contratacoes.mensagem,
      criadoEm: contratacoes.criadoEm,
      iniciadoEm: contratacoes.iniciadoEm,
      finalizadoEm: contratacoes.finalizadoEm,
      clienteId: contratacoes.clienteId,
      cliente: usuarios.tutor,
      fotoCliente: usuarios.fotoId,
      prestadorId: prestadores.id,
      prestadorUsuarioId: prestadores.usuarioId,
      prestadorTipo: prestadores.tipo,
      prestadorNome: prestadores.nome,
      prestadorContato: prestadores.contato,
      prestadorFoto: donoDoServico.fotoId,
      pets: sql`coalesce((select json_agg(json_build_object('id', ${pets.id}, 'nome', ${pets.nome}, 'foto', ${pets.fotoId}, 'especie', ${pets.especie}, 'porte', ${pets.porte}) order by ${pets.id}) from ${contratacaoPets} inner join ${pets} on ${pets.id} = ${contratacaoPets.petId} where ${contratacaoPets.contratacaoId} = ${contratacoes.id}), '[]'::json)`.mapWith(
        (valor) => lerJson<PetDoPedido[]>(valor),
      ),
      nota: avaliacoes.nota,
      comentario: avaliacoes.comentario,
    })
    .from(contratacoes)
    .innerJoin(usuarios, eq(usuarios.id, contratacoes.clienteId))
    .innerJoin(prestadores, eq(prestadores.id, contratacoes.prestadorId))
    .innerJoin(donoDoServico, eq(donoDoServico.id, prestadores.usuarioId))
    .leftJoin(avaliacoes, eq(avaliacoes.contratacaoId, contratacoes.id))
    .where(onde);
}

type Linha = Awaited<ReturnType<typeof consultar>>[number];

/** Mesmo formato da `Contratacao` do front. */
function formatar(usuarioId: string, linha: Linha) {
  return {
    id: linha.id,
    status: linha.status,
    inicio: linha.inicio.toISOString(),
    fim: linha.fim?.toISOString() ?? null,
    contato: linha.contato,
    mensagem: linha.mensagem,
    criadoEm: linha.criadoEm.toISOString(),
    iniciadoEm: linha.iniciadoEm?.toISOString() ?? null,
    finalizadoEm: linha.finalizadoEm?.toISOString() ?? null,
    papel: (linha.clienteId === usuarioId ? 'cliente' : 'prestador') as Papel,
    cliente: { nome: linha.cliente, foto: urlFoto(linha.fotoCliente) },
    prestador: {
      id: linha.prestadorId,
      tipo: linha.prestadorTipo,
      nome: linha.prestadorNome,
      contato: linha.prestadorContato,
      foto: urlFoto(linha.prestadorFoto),
    },
    pets: linha.pets.map((pet) => ({ ...pet, foto: urlFoto(pet.foto) })),
    avaliacao:
      linha.nota === null ? null : { nota: linha.nota, comentario: linha.comentario ?? '' },
  };
}

export class ContratacoesServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  /** Os pedidos que o usuário fez (`cliente`) ou recebeu (`prestador`), os mais novos primeiro. */
  async listar(usuarioId: string, papel: Papel) {
    const linhas = await consultar(
      this.banco,
      papel === 'cliente'
        ? eq(contratacoes.clienteId, usuarioId)
        : eq(prestadores.usuarioId, usuarioId),
    ).orderBy(desc(contratacoes.inicio), desc(contratacoes.id));
    return linhas.map((linha) => formatar(usuarioId, linha));
  }

  /** Só as duas partes enxergam o pedido; para os outros ele não existe. */
  async buscar(usuarioId: string, id: number) {
    const [linha] = await consultar(this.banco, eq(contratacoes.id, id));
    if (!linha || (linha.clienteId !== usuarioId && linha.prestadorUsuarioId !== usuarioId)) {
      throw naoEncontrado('Pedido');
    }
    return formatar(usuarioId, linha);
  }

  async criar(usuarioId: string, { prestadorId, petIds, inicio, fim, ...dados }: DadosContratacao) {
    const [prestador] = await this.banco
      .select({
        usuarioId: prestadores.usuarioId,
        tipo: prestadores.tipo,
        ativo: prestadores.ativo,
      })
      .from(prestadores)
      .where(eq(prestadores.id, prestadorId));
    if (!prestador) throw naoEncontrado('Prestador');
    if (prestador.usuarioId === usuarioId) {
      throw new ErroApi(400, 'Você não pode contratar o seu próprio serviço');
    }
    if (!prestador.ativo) {
      throw new ErroApi(400, 'Este serviço está pausado e não recebe pedidos agora');
    }
    if (prestador.tipo === 'anfitriao' && !fim) {
      throw new ErroApi(400, 'Dados inválidos', { fim: 'Informe até quando é a hospedagem' });
    }

    const meus = await this.banco
      .select({ id: pets.id })
      .from(pets)
      .where(and(eq(pets.usuarioId, usuarioId), inArray(pets.id, petIds)));
    if (meus.length !== new Set(petIds).size) {
      throw new ErroApi(400, 'Dados inválidos', { petIds: 'Escolha pets do seu perfil' });
    }

    const id = await this.banco.transaction(async (tx) => {
      const [criada] = await tx
        .insert(contratacoes)
        .values({
          ...dados,
          prestadorId,
          clienteId: usuarioId,
          inicio: new Date(inicio),
          // Só a hospedagem tem fim; nos outros serviços ele é ignorado.
          fim: prestador.tipo === 'anfitriao' && fim ? new Date(fim) : null,
        })
        .returning({ id: contratacoes.id });
      await tx
        .insert(contratacaoPets)
        .values(meus.map((pet) => ({ contratacaoId: criada!.id, petId: pet.id })));
      return criada!.id;
    });
    return this.buscar(usuarioId, id);
  }

  async mudarStatus(usuarioId: string, id: number, novo: StatusContratacao) {
    const atual = await this.buscar(usuarioId, id);
    const permitidos = TRANSICOES[atual.status][novo];
    if (!permitidos) {
      throw new ErroApi(
        409,
        `Este pedido está ${ROTULOS[atual.status]} e não pode mudar para ${ROTULOS[novo]}`,
      );
    }
    if (!permitidos.includes(atual.papel)) {
      throw proibido(
        atual.papel === 'cliente'
          ? 'Só o prestador pode fazer isso'
          : 'Só quem fez o pedido pode fazer isso',
      );
    }
    const passeio = atual.prestador.tipo === 'passeador';
    if (novo === 'em_andamento') {
      if (!passeio) throw new ErroApi(409, 'Só o passeio tem acompanhamento ao vivo');
      if (Date.parse(atual.inicio) - Date.now() > ANTECEDENCIA_INICIO_MS) {
        throw new ErroApi(409, 'Ainda falta muito para o horário do passeio');
      }
    }
    if (novo === 'concluida' && atual.status === 'aceita') {
      // O passeio precisa passar pelo "em andamento": é o que o tutor acompanha.
      if (passeio) throw new ErroApi(409, 'Inicie o passeio quando pegar o pet');
      if (Date.parse(atual.inicio) > Date.now()) {
        throw new ErroApi(409, 'Só dá para concluir depois que o serviço começar');
      }
    }

    const agora = new Date();
    await this.banco
      .update(contratacoes)
      .set({
        status: novo,
        atualizadoEm: agora,
        ...(novo === 'em_andamento' && { iniciadoEm: agora }),
        ...(atual.status === 'em_andamento' && { finalizadoEm: agora }),
      })
      // O status atual na condição evita corrida entre as duas partes.
      .where(and(eq(contratacoes.id, id), eq(contratacoes.status, atual.status)));
    return this.buscar(usuarioId, id);
  }

  /** O passeador envia os pontos novos do GPS enquanto o passeio está em andamento. */
  async registrarPosicoes(usuarioId: string, id: number, pontos: LatLng[]) {
    const atual = await this.buscar(usuarioId, id);
    if (atual.papel !== 'prestador') throw proibido('Só o passeador envia a posição');
    if (atual.status !== 'em_andamento') {
      throw new ErroApi(409, 'O passeio não está em andamento');
    }
    const [atualizado] = await this.banco
      .update(contratacoes)
      .set({
        trajeto: sql`${contratacoes.trajeto} || ${JSON.stringify(pontos)}::jsonb`,
        posicaoEm: new Date(),
      })
      .where(
        and(
          eq(contratacoes.id, id),
          eq(contratacoes.status, 'em_andamento'),
          sql`jsonb_array_length(${contratacoes.trajeto}) + ${pontos.length} <= ${MAX_PONTOS_TRAJETO}`,
        ),
      )
      .returning({ id: contratacoes.id });
    if (!atualizado) {
      throw new ErroApi(409, 'O trajeto chegou ao limite de pontos. Encerre o passeio');
    }
  }

  /**
   * O que o tutor (e o passeador) vê no mapa. `desde` pula os pontos que quem pergunta já
   * tem, para a consulta repetida a cada poucos segundos ficar leve.
   */
  async acompanhamento(usuarioId: string, id: number, desde: number) {
    const atual = await this.buscar(usuarioId, id);
    const [linha] = await this.banco
      .select({ trajeto: contratacoes.trajeto, posicaoEm: contratacoes.posicaoEm })
      .from(contratacoes)
      .where(eq(contratacoes.id, id));
    const trajeto = linha!.trajeto;
    const fimOuAgora = atual.finalizadoEm ? Date.parse(atual.finalizadoEm) : Date.now();
    return {
      status: atual.status,
      iniciadoEm: atual.iniciadoEm,
      finalizadoEm: atual.finalizadoEm,
      posicaoEm: linha!.posicaoEm?.toISOString() ?? null,
      duracaoMin: atual.iniciadoEm
        ? Math.max(0, Math.round((fimOuAgora - Date.parse(atual.iniciadoEm)) / 60_000))
        : 0,
      distanciaKm: distanciaTrajeto(trajeto),
      totalPontos: trajeto.length,
      pontos: trajeto.slice(desde),
    };
  }

  /** O cliente avalia um serviço concluído; avaliar de novo substitui a nota. */
  async avaliar(usuarioId: string, id: number, nota: number, comentario: string) {
    const atual = await this.buscar(usuarioId, id);
    if (atual.papel !== 'cliente') throw proibido('Só quem contratou pode avaliar');
    if (atual.status !== 'concluida') {
      throw new ErroApi(409, 'Só dá para avaliar depois que o serviço for concluído');
    }
    await this.banco
      .insert(avaliacoes)
      .values({ contratacaoId: id, nota, comentario })
      .onConflictDoUpdate({
        target: avaliacoes.contratacaoId,
        set: { nota, comentario, criadoEm: new Date() },
      });
    return this.buscar(usuarioId, id);
  }
}
