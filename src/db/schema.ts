import {
  type AnyPgColumn,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

const instante = (nome: string) => timestamp(nome, { withTimezone: true, mode: 'date' });

const criadoEm = () => instante('criado_em').notNull().defaultNow();

/** Id numérico gerado pelo banco. */
const idSerial = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

/** Chave estrangeira para usuário, apagando junto os dados dele. */
const refUsuario = (nome: string) =>
  uuid(nome)
    .notNull()
    .references((): AnyPgColumn => usuarios.id, { onDelete: 'cascade' });

export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Sempre em minúsculas e sem espaços (normalizado na entrada). */
  email: text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  tutor: text('tutor').notNull(),
  criadoEm: criadoEm(),
  ultimoAcessoEm: instante('ultimo_acesso_em'),
}).enableRLS();

/** Um pet por usuário por enquanto (é o que o front suporta); a tabela já permite mais. */
export const pets = pgTable('pets', {
  id: idSerial(),
  usuarioId: refUsuario('usuario_id').unique(),
  nome: text('nome').notNull(),
  especie: text('especie', { enum: ESPECIES }).notNull(),
  raca: text('raca').notNull().default(''),
  idadeAnos: integer('idade_anos').notNull().default(1),
  porte: text('porte', { enum: PORTES }).notNull(),
  bio: text('bio').notNull().default(''),
  metaSemanalKm: doublePrecision('meta_semanal_km').notNull().default(15),
}).enableRLS();

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
