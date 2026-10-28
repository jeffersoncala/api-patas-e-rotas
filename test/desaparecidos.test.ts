import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { fotos } from '../src/db/schema.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const HORA_MS = 60 * 60 * 1000;
const haHoras = (horas: number) => new Date(Date.now() - horas * HORA_MS).toISOString();

/** Botafogo, no Rio; os outros pontos ficam a distâncias conhecidas daqui. */
const CENTRO = [-22.9468, -43.1823] as const;
/** ~1,1 km ao norte (0,01° de latitude). */
const PERTO = [-22.9368, -43.1823];
/** ~5,6 km ao norte. */
const MEIO = [-22.8968, -43.1823];
/** ~350 km (São Paulo). */
const LONGE = [-23.5505, -46.6333];

const novo = (extra: Record<string, unknown> = {}) => ({
  nome: 'Mel',
  especie: 'cachorro',
  porte: 'medio',
  contato: '(21) 99999-0000',
  posicao: PERTO,
  vistoEm: haHoras(2),
  ...extra,
});

type Headers = { authorization: string };

async function criar(app: App, headers: Headers, extra: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/desaparecidos',
    headers,
    payload: novo(extra),
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json<{ id: number; foto: string | null }>();
}

const buscar = (raioKm?: number) =>
  `/desaparecidos?lat=${CENTRO[0]}&lng=${CENTRO[1]}${raioKm === undefined ? '' : `&raioKm=${raioKm}`}`;

describe('desaparecidos', () => {
  it('cadastra no formato do front, com foto', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Ana' });
    const vistoEm = haHoras(3);

    const resposta = await app.inject({
      method: 'POST',
      url: '/desaparecidos',
      headers,
      payload: novo({
        nome: '  Thor ',
        raca: 'Vira-lata',
        descricao: 'Coleira azul',
        vistoEm: vistoEm.replace('Z', '+00:00'),
        foto: PNG,
      }),
    });
    expect(resposta.statusCode).toBe(201);
    const criado = resposta.json();
    expect(criado).toEqual({
      id: expect.any(Number),
      nome: 'Thor',
      especie: 'cachorro',
      raca: 'Vira-lata',
      porte: 'medio',
      descricao: 'Coleira azul',
      contato: '(21) 99999-0000',
      foto: expect.stringMatching(/^\/fotos\/[0-9a-f-]{36}$/),
      posicao: PERTO,
      vistoEm,
      encontrado: false,
      tutor: 'Ana',
      meu: true,
    });

    const foto = await app.inject({ url: criado.foto });
    expect(foto.statusCode).toBe(200);
    expect(foto.headers['content-type']).toBe('image/png');

    const outro = await cadastrar(app);
    const visto = await app.inject({ url: `/desaparecidos/${criado.id}`, headers: outro.headers });
    expect(visto.json()).toMatchObject({ id: criado.id, meu: false, tutor: 'Ana' });
  });

  it('valida campos obrigatórios, data no futuro e foto', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const resposta = await app.inject({
      method: 'POST',
      url: '/desaparecidos',
      headers,
      payload: novo({
        nome: ' ',
        contato: '',
        especie: 'dragao',
        posicao: [0, 181],
        vistoEm: new Date(Date.now() + 2 * HORA_MS).toISOString(),
        foto: 'data:image/png;base64,AAAA',
      }),
    });
    expect(resposta.statusCode).toBe(400);
    expect(Object.keys(resposta.json().campos).sort()).toEqual([
      'contato',
      'especie',
      'foto',
      'nome',
      'posicao.1',
      'vistoEm',
    ]);
  });

  it('lista só os que estão dentro do raio, do mais perto para o mais longe', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);

    await criar(app, ana.headers, { nome: 'Meio', posicao: MEIO });
    await criar(app, bia.headers, { nome: 'Perto', posicao: PERTO });
    await criar(app, ana.headers, { nome: 'Longe', posicao: LONGE });

    const listar = async (raioKm?: number) => {
      const r = await app.inject({ url: buscar(raioKm), headers: ana.headers });
      expect(r.statusCode).toBe(200);
      return r.json<{ nome: string; distanciaKm: number; meu: boolean }[]>();
    };

    // Sem raio, usa 5 km.
    expect((await listar()).map((d) => d.nome)).toEqual(['Perto']);
    const dez = await listar(10);
    expect(dez.map((d) => d.nome)).toEqual(['Perto', 'Meio']);
    expect(dez[0]!.distanciaKm).toBeCloseTo(1.112, 2);
    expect(dez[1]!.distanciaKm).toBeCloseTo(5.56, 1);
    expect(dez.map((d) => d.meu)).toEqual([false, true]);
    expect((await listar(0.5)).length).toBe(0);
    expect((await listar(100)).map((d) => d.nome)).toEqual(['Perto', 'Meio']);
  });

  it('valida os parâmetros da busca', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const semCentro = await app.inject({ url: '/desaparecidos', headers });
    expect(semCentro.statusCode).toBe(400);
    expect(Object.keys(semCentro.json().campos).sort()).toEqual(['lat', 'lng']);

    for (const raio of [0, -1, 101, 'abc']) {
      const r = await app.inject({ url: buscar(raio as number), headers });
      expect(r.statusCode, `raio ${raio}`).toBe(400);
      expect(r.json().campos).toHaveProperty('raioKm');
    }
  });

  it('quem cadastrou marca como encontrado e ele sai da busca', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const { id } = await criar(app, ana.headers);
    const url = `/desaparecidos/${id}/encontrado`;

    const deOutro = await app.inject({ method: 'PUT', url, headers: bia.headers });
    expect(deOutro.statusCode).toBe(403);

    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'PUT', url, headers: ana.headers });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ id, encontrado: true });
    }

    const lista = await app.inject({ url: buscar(), headers: ana.headers });
    expect(lista.json()).toEqual([]);
  });

  it('quem cadastrou apaga, levando a foto junto', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const { id, foto } = await criar(app, ana.headers, { foto: PNG });
    const url = `/desaparecidos/${id}`;

    expect((await app.inject({ method: 'DELETE', url, headers: bia.headers })).statusCode).toBe(
      403,
    );
    expect((await app.inject({ method: 'DELETE', url, headers: ana.headers })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ url, headers: ana.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: foto! })).statusCode).toBe(404);
    expect(await app.banco.select().from(fotos)).toEqual([]);
  });

  it('responde 404 para cadastro inexistente e exige token', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    for (const [method, url] of [
      ['GET', '/desaparecidos/999'],
      ['PUT', '/desaparecidos/999/encontrado'],
      ['DELETE', '/desaparecidos/999'],
    ] as const) {
      const r = await app.inject({ method, url, headers });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().mensagem).toBe('Pet desaparecido não encontrado');
    }

    expect((await app.inject({ url: buscar() })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/desaparecidos', payload: novo() })).statusCode,
    ).toBe(401);
  });
});
