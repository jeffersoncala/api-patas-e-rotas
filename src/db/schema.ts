import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/** Coordenada no formato [latitude, longitude], o mesmo usado pelo front (Leaflet). */
export type LatLng = [number, number];

export const ESPECIES = ['cachorro', 'gato', 'outro'] as const;
export const PORTES = ['pequeno', 'medio', 'grande'] as const;

const criadoEm = () =>
  integer('criado_em', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

/** Chave estrangeira para usuário, apagando junto os dados dele. */
const refUsuario = (nome: string) =>
  text(nome)
    .notNull()
    .references((): AnySQLiteColumn => usuarios.id, { onDelete: 'cascade' });

export const usuarios = sqliteTable('usuarios', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  /** Sempre em minúsculas e sem espaços (normalizado na entrada). */
  email: text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  tutor: text('tutor').notNull(),
  criadoEm: criadoEm(),
  ultimoAcessoEm: integer('ultimo_acesso_em', { mode: 'timestamp_ms' }),
});

/** Um pet por usuário por enquanto (é o que o front suporta); a tabela já permite mais. */
export const pets = sqliteTable('pets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  usuarioId: refUsuario('usuario_id').unique(),
  nome: text('nome').notNull(),
  especie: text('especie', { enum: ESPECIES }).notNull(),
  raca: text('raca').notNull().default(''),
  idadeAnos: integer('idade_anos').notNull().default(1),
  porte: text('porte', { enum: PORTES }).notNull(),
  bio: text('bio').notNull().default(''),
  metaSemanalKm: real('meta_semanal_km').notNull().default(15),
});

/**
 * Uma linha por login. O refresh token é guardado só como hash; a rotação troca o
 * hash, e o logout marca `revogada_em` — o access token daquela sessão para de valer na hora.
 */
export const sessoes = sqliteTable(
  'sessoes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    usuarioId: refUsuario('usuario_id'),
    refreshHash: text('refresh_hash').notNull().unique(),
    expiraEm: integer('expira_em', { mode: 'timestamp_ms' }).notNull(),
    revogadaEm: integer('revogada_em', { mode: 'timestamp_ms' }),
    criadoEm: criadoEm(),
  },
  (t) => [index('sessoes_usuario_idx').on(t.usuarioId)],
);

export const redefinicoesSenha = sqliteTable('redefinicoes_senha', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  usuarioId: refUsuario('usuario_id'),
  tokenHash: text('token_hash').notNull().unique(),
  expiraEm: integer('expira_em', { mode: 'timestamp_ms' }).notNull(),
  usadaEm: integer('usada_em', { mode: 'timestamp_ms' }),
  criadoEm: criadoEm(),
});

export const encontros = sqliteTable(
  'encontros',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizadorId: refUsuario('organizador_id'),
    titulo: text('titulo').notNull(),
    descricao: text('descricao').notNull().default(''),
    local: text('local').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    data: integer('data', { mode: 'timestamp_ms' }).notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index('encontros_data_idx').on(t.data)],
);

export const presencas = sqliteTable(
  'presencas',
  {
    encontroId: integer('encontro_id')
      .notNull()
      .references(() => encontros.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.encontroId, t.usuarioId] })],
);

export const rotas = sqliteTable('rotas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  autorId: refUsuario('autor_id'),
  nome: text('nome').notNull(),
  bairro: text('bairro').notNull(),
  descricao: text('descricao').notNull().default(''),
  pontos: text('pontos', { mode: 'json' }).$type<LatLng[]>().notNull(),
  /** Calculada no servidor a partir dos pontos, nunca aceita do cliente. */
  distanciaKm: real('distancia_km').notNull(),
  duracaoMin: integer('duracao_min').notNull(),
  criadoEm: criadoEm(),
});

export const favoritas = sqliteTable(
  'favoritas',
  {
    rotaId: integer('rota_id')
      .notNull()
      .references(() => rotas.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.rotaId, t.usuarioId] })],
);

export const passeios = sqliteTable(
  'passeios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    usuarioId: refUsuario('usuario_id'),
    /** Se a rota for apagada o passeio fica, mas vira "passeio livre" com o nome guardado. */
    rotaId: integer('rota_id').references(() => rotas.id, { onDelete: 'set null' }),
    rotaNome: text('rota_nome').notNull().default(''),
    pontos: text('pontos', { mode: 'json' }).$type<LatLng[]>().notNull(),
    distanciaKm: real('distancia_km').notNull(),
    duracaoMin: integer('duracao_min').notNull(),
    texto: text('texto').notNull().default(''),
    data: integer('data', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('passeios_data_idx').on(t.data),
    index('passeios_usuario_idx').on(t.usuarioId),
    index('passeios_rota_idx').on(t.rotaId),
  ],
);

export const curtidas = sqliteTable(
  'curtidas',
  {
    passeioId: integer('passeio_id')
      .notNull()
      .references(() => passeios.id, { onDelete: 'cascade' }),
    usuarioId: refUsuario('usuario_id'),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.passeioId, t.usuarioId] })],
);
