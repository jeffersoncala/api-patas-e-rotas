import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Todas as tabelas têm RLS ligado e nenhuma política (`.enableRLS()`): o Supabase expõe o schema
 * `public` pela Data API, e assim quem tiver a anon key não lê nem grava nada. A API conecta como
 * dona das tabelas, que não é afetada pelo RLS.
 */

/** Coordenada no formato [latitude, longitude], o mesmo usado pelo front (Leaflet). */
export type LatLng = [number, number];

export const ESPECIES = ['cachorro', 'gato', 'outro'] as const;
export const PORTES = ['pequeno', 'medio', 'grande'] as const;
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;

const instante = (nome: string) => timestamp(nome, { withTimezone: true, mode: 'date' });

const criadoEm = () => instante('criado_em').notNull().defaultNow();

/** Id numérico gerado pelo banco. */
const idSerial = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

/** Chave estrangeira para usuário, apagando junto os dados dele. */
const refUsuario = (nome: string) =>
  uuid(nome)
    .notNull()
    .references((): AnyPgColumn => usuarios.id, { onDelete: 'cascade' });

/** Foto do tutor ou de um pet; se a foto for apagada, quem a usava fica sem. */
const refFoto = () =>
  uuid('foto_id').references((): AnyPgColumn => fotos.id, { onDelete: 'set null' });

export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Sempre em minúsculas e sem espaços (normalizado na entrada). */
  email: text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  tutor: text('tutor').notNull(),
  fotoId: refFoto(),
  metaSemanalKm: doublePrecision('meta_semanal_km').notNull().default(15),
  criadoEm: criadoEm(),
  ultimoAcessoEm: instante('ultimo_acesso_em'),
}).enableRLS();

export const pets = pgTable(
  'pets',
  {
    id: idSerial(),
    usuarioId: refUsuario('usuario_id'),
    nome: text('nome').notNull(),
    especie: text('especie', { enum: ESPECIES }).notNull(),
    raca: text('raca').notNull().default(''),
    idadeAnos: integer('idade_anos').notNull().default(1),
    porte: text('porte', { enum: PORTES }).notNull(),
    bio: text('bio').notNull().default(''),
    fotoId: refFoto(),
  },
  (t) => [index('pets_usuario_idx').on(t.usuarioId)],
).enableRLS();

/**
 * Imagens já reduzidas pelo front, em base64. Ficam no Postgres para não depender de outro
 * serviço; são servidas em `GET /fotos/:id` sem autenticação (o id é um UUID aleatório) e
 * nunca mudam: trocar a foto cria outra linha e apaga a antiga.
 */
export const fotos = pgTable(
  'fotos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: refUsuario('usuario_id'),
    tipo: text('tipo', { enum: TIPOS_FOTO }).notNull(),
    dados: text('dados').notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index('fotos_usuario_idx').on(t.usuarioId)],
).enableRLS();

/**
 * Uma linha por login. O refresh token é guardado só como hash; a rotação troca o
 * hash, e o logout marca `revogada_em` — o access token daquela sessão para de valer na hora.
 */
export const sessoes = pgTable(
  'sessoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: refUsuario('usuario_id'),
    refreshHash: text('refresh_hash').notNull().unique(),
    expiraEm: instante('expira_em').notNull(),
    revogadaEm: instante('revogada_em'),
    criadoEm: criadoEm(),
  },
  (t) => [index('sessoes_usuario_idx').on(t.usuarioId)],
).enableRLS();

export const redefinicoesSenha = pgTable('redefinicoes_senha', {
  id: idSerial(),
  usuarioId: refUsuario('usuario_id'),
  tokenHash: text('token_hash').notNull().unique(),
  expiraEm: instante('expira_em').notNull(),
  usadaEm: instante('usada_em'),
  criadoEm: criadoEm(),
}).enableRLS();

export const encontros = pgTable(
  'encontros',
  {
    id: idSerial(),
    organizadorId: refUsuario('organizador_id'),
    titulo: text('titulo').notNull(),
    descricao: text('descricao').notNull().default(''),
    local: text('local').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    data: instante('data').notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index('encontros_data_idx').on(t.data)],
).enableRLS();

export const presencas = pgTable(
  'presencas',
  {
    encontroId: integer('encontro_id')
      .notNull()
      .references(() => encontros.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.encontroId, t.usuarioId] })],
).enableRLS();

export const rotas = pgTable('rotas', {
  id: idSerial(),
  autorId: refUsuario('autor_id'),
  nome: text('nome').notNull(),
  bairro: text('bairro').notNull(),
  descricao: text('descricao').notNull().default(''),
  pontos: jsonb('pontos').$type<LatLng[]>().notNull(),
  /** Calculada no servidor a partir dos pontos, nunca aceita do cliente. */
  distanciaKm: doublePrecision('distancia_km').notNull(),
  duracaoMin: integer('duracao_min').notNull(),
  criadoEm: criadoEm(),
}).enableRLS();

export const favoritas = pgTable(
  'favoritas',
  {
    rotaId: integer('rota_id')
      .notNull()
      .references(() => rotas.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.rotaId, t.usuarioId] })],
).enableRLS();

export const passeios = pgTable(
  'passeios',
  {
    id: idSerial(),
    usuarioId: refUsuario('usuario_id'),
    /** Se a rota for apagada o passeio fica, mas vira "passeio livre" com o nome guardado. */
    rotaId: integer('rota_id').references(() => rotas.id, { onDelete: 'set null' }),
    rotaNome: text('rota_nome').notNull().default(''),
    pontos: jsonb('pontos').$type<LatLng[]>().notNull(),
    distanciaKm: doublePrecision('distancia_km').notNull(),
    duracaoMin: integer('duracao_min').notNull(),
    texto: text('texto').notNull().default(''),
    data: instante('data').notNull(),
  },
  (t) => [
    index('passeios_data_idx').on(t.data),
    index('passeios_usuario_idx').on(t.usuarioId),
    index('passeios_rota_idx').on(t.rotaId),
  ],
).enableRLS();

/** Quais pets foram em cada passeio. */
export const passeioPets = pgTable(
  'passeio_pets',
  {
    passeioId: integer('passeio_id')
      .notNull()
      .references(() => passeios.id, { onDelete: 'cascade' }),
    petId: integer('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.passeioId, t.petId] }),
    index('passeio_pets_pet_idx').on(t.petId),
  ],
).enableRLS();

/** Fotos de cada passeio, na ordem em que o tutor escolheu. */
export const passeioFotos = pgTable(
  'passeio_fotos',
  {
    passeioId: integer('passeio_id')
      .notNull()
      .references(() => passeios.id, { onDelete: 'cascade' }),
    fotoId: uuid('foto_id')
      .notNull()
      .references(() => fotos.id, { onDelete: 'cascade' }),
    ordem: integer('ordem').notNull(),
  },
  (t) => [primaryKey({ columns: [t.passeioId, t.ordem] })],
).enableRLS();

export const curtidas = pgTable(
  'curtidas',
  {
    passeioId: integer('passeio_id')
      .notNull()
      .references(() => passeios.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.passeioId, t.usuarioId] })],
).enableRLS();

/**
 * Pets desaparecidos, com o último lugar onde foram vistos. Quem cadastrou marca como
 * encontrado (`encontrado_em`), e a partir daí ele sai da busca por raio.
 */
export const desaparecidos = pgTable(
  'desaparecidos',
  {
    id: idSerial(),
    usuarioId: refUsuario('usuario_id'),
    nome: text('nome').notNull(),
    especie: text('especie', { enum: ESPECIES }).notNull(),
    raca: text('raca').notNull().default(''),
    porte: text('porte', { enum: PORTES }).notNull(),
    descricao: text('descricao').notNull().default(''),
    /** Telefone, WhatsApp ou outro jeito de falar com o tutor. */
    contato: text('contato').notNull(),
    fotoId: refFoto(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    vistoEm: instante('visto_em').notNull(),
    encontradoEm: instante('encontrado_em'),
    criadoEm: criadoEm(),
  },
  (t) => [
    index('desaparecidos_latitude_idx').on(t.latitude),
    index('desaparecidos_usuario_idx').on(t.usuarioId),
  ],
).enableRLS();

export const TIPOS_SERVICO = ['passeador', 'anfitriao', 'petshop'] as const;

/** Item da tabela de preços do prestador, ex. "Passeio de 30 min": 2500 (R$ 25,00). */
export interface Preco {
  descricao: string;
  /** Em centavos, para não ter erro de arredondamento. */
  valorCentavos: number;
}

/**
 * Quem oferece um serviço: passeador, anfitrião (hospedagem) ou petshop (banho e tosa). Um
 * usuário pode ter um cadastro de cada tipo, e qualquer tutor pode contratá-lo.
 */
export const prestadores = pgTable(
  'prestadores',
  {
    id: idSerial(),
    usuarioId: refUsuario('usuario_id'),
    tipo: text('tipo', { enum: TIPOS_SERVICO }).notNull(),
    /** Nome que aparece na busca: o do tutor ou o do petshop. */
    nome: text('nome').notNull(),
    descricao: text('descricao').notNull().default(''),
    contato: text('contato').notNull(),
    bairro: text('bairro').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    precos: jsonb('precos').$type<Preco[]>().notNull().default([]),
    /** Pausado não aparece na busca nem recebe pedidos, mas os pedidos antigos ficam. */
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique('prestadores_usuario_tipo_unq').on(t.usuarioId, t.tipo),
    index('prestadores_tipo_latitude_idx').on(t.tipo, t.latitude),
  ],
).enableRLS();

/** Fotos do prestador (o ambiente da hospedagem, o petshop...), na ordem escolhida. */
export const prestadorFotos = pgTable(
  'prestador_fotos',
  {
    prestadorId: integer('prestador_id')
      .notNull()
      .references(() => prestadores.id, { onDelete: 'cascade' }),
    fotoId: uuid('foto_id')
      .notNull()
      .references(() => fotos.id, { onDelete: 'cascade' }),
    ordem: integer('ordem').notNull(),
  },
  (t) => [primaryKey({ columns: [t.prestadorId, t.ordem] })],
).enableRLS();

export const STATUS_CONTRATACAO = [
  'pendente',
  'aceita',
  'recusada',
  'cancelada',
  'concluida',
] as const;

/**
 * Pedido de um tutor (cliente) a um prestador. Começa `pendente`; o prestador aceita ou
 * recusa e, depois do serviço, marca como concluída. Só então o cliente pode avaliar.
 */
export const contratacoes = pgTable(
  'contratacoes',
  {
    id: idSerial(),
    prestadorId: integer('prestador_id')
      .notNull()
      .references(() => prestadores.id, { onDelete: 'cascade' }),
    clienteId: refUsuario('cliente_id'),
    inicio: instante('inicio').notNull(),
    /** Só na hospedagem: o dia de buscar o pet. */
    fim: instante('fim'),
    /** Telefone do cliente, para o prestador combinar os detalhes. */
    contato: text('contato').notNull(),
    mensagem: text('mensagem').notNull().default(''),
    status: text('status', { enum: STATUS_CONTRATACAO }).notNull().default('pendente'),
    criadoEm: criadoEm(),
    atualizadoEm: instante('atualizado_em').notNull().defaultNow(),
  },
  (t) => [
    index('contratacoes_prestador_idx').on(t.prestadorId),
    index('contratacoes_cliente_idx').on(t.clienteId),
  ],
).enableRLS();

/** Pets que vão no serviço contratado. */
export const contratacaoPets = pgTable(
  'contratacao_pets',
  {
    contratacaoId: integer('contratacao_id')
      .notNull()
      .references(() => contratacoes.id, { onDelete: 'cascade' }),
    petId: integer('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.contratacaoId, t.petId] })],
).enableRLS();

/**
 * Uma avaliação por contratação concluída, feita pelo cliente. Amarrar à contratação
 * impede avaliar quem nunca foi contratado e avaliar o mesmo serviço duas vezes.
 */
export const avaliacoes = pgTable(
  'avaliacoes',
  {
    contratacaoId: integer('contratacao_id')
      .primaryKey()
      .references(() => contratacoes.id, { onDelete: 'cascade' }),
    nota: integer('nota').notNull(),
    comentario: text('comentario').notNull().default(''),
    criadoEm: criadoEm(),
  },
  (t) => [check('avaliacoes_nota_chk', sql`${t.nota} between 1 and 5`)],
).enableRLS();
