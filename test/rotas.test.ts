import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import type { LatLng } from '../src/db/schema.js';
import { distanciaTrajeto } from '../src/geo.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

type Headers = { authorization: string };

const PONTOS: LatLng[] = [
  [-22.9068, -43.1729],
  [-22.9102, -43.1755],
  [-22.9135, -43.1801],
];

const novaRota = (dados: Record<string, unknown> = {}) => ({
  nome: 'Orla',
  bairro: 'Copacabana',
  descricao: 'Beira-mar',
  pontos: PONTOS,
  duracaoMin: 40,
  ...dados,
});

async function criarRota(app: App, headers: Headers, dados: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/rotas',
    headers,
    payload: novaRota(dados),
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json<{ id: number }>();
}

describe('rotas', () => {
  it('cria com a distância calculada no servidor e já favoritada pelo autor', async () => {
    const { app } = await criarAppTeste();
    const { headers, usuario } = await cadastrar(app);

    const resposta = await app.inject({
      method: 'POST',
      url: '/rotas',
      headers,
      payload: { ...novaRota({ descricao: undefined }), distanciaKm: 999 },
    });
    expect(resposta.statusCode).toBe(201);
    const rota = resposta.json();
    expect(rota).toEqual({
      id: expect.any(Number),
      nome: 'Orla',
      bairro: 'Copacabana',
      descricao: '',
      pontos: PONTOS,
      distanciaKm: distanciaTrajeto(PONTOS),
      duracaoMin: 40,
      favorita: true,
      favoritadas: 1,
      autorId: usuario.id,
      minha: true,
    });

    const outro = await cadastrar(app);
    const vista = await app.inject({ url: `/rotas/${rota.id}`, headers: outro.headers });
    expect(vista.json()).toMatchObject({ favorita: false, favoritadas: 1, minha: false });
  });

  it('lista por nome e filtra as favoritas do usuário', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    await criarRota(app, a.headers, { nome: 'Parque' });
    await criarRota(app, b.headers, { nome: 'Aterro' });

    const todas = await app.inject({ url: '/rotas', headers: a.headers });
    expect(todas.json().map((r: { nome: string }) => r.nome)).toEqual(['Aterro', 'Parque']);

    const favoritas = await app.inject({ url: '/rotas?filtro=favoritas', headers: a.headers });
    expect(favoritas.json().map((r: { nome: string }) => r.nome)).toEqual(['Parque']);

    const invalido = await app.inject({ url: '/rotas?filtro=outras', headers: a.headers });
    expect(invalido.statusCode).toBe(400);
  });

  it('favorita e desfavorita de forma idempotente, contando por usuário', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    const { id } = await criarRota(app, a.headers);
    const url = `/rotas/${id}/favorita`;

    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'PUT', url, headers: b.headers });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ favorita: true, favoritadas: 2 });
    }
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'DELETE', url, headers: b.headers });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ favorita: false, favoritadas: 1 });
    }
    const doAutor = await app.inject({ url: `/rotas/${id}`, headers: a.headers });
    expect(doAutor.json()).toMatchObject({ favorita: true, favoritadas: 1 });
  });

  it('só o autor altera e apaga', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    const { id } = await criarRota(app, a.headers);
    const url = `/rotas/${id}`;

    const alheio = await app.inject({
      method: 'PATCH',
      url,
      headers: b.headers,
      payload: { nome: 'X' },
    });
    expect(alheio.statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url, headers: b.headers })).statusCode).toBe(403);

    const novosPontos: LatLng[] = [
      [-23, -43],
      [-23.01, -43],
    ];
    const ok = await app.inject({
      method: 'PATCH',
      url,
      headers: a.headers,
      payload: { nome: ' Orla nova ', pontos: novosPontos },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      nome: 'Orla nova',
      descricao: 'Beira-mar',
      bairro: 'Copacabana',
      distanciaKm: distanciaTrajeto(novosPontos),
    });

    expect((await app.inject({ method: 'DELETE', url, headers: a.headers })).statusCode).toBe(204);
    expect((await app.inject({ url, headers: a.headers })).statusCode).toBe(404);
  });

  it('apagar a rota mantém os passeios feitos nela, com o nome guardado', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const { id } = await criarRota(app, headers, { nome: 'Lagoa' });

    const passeio = await app.inject({
      method: 'POST',
      url: '/passeios',
      headers,
      payload: { pontos: PONTOS, duracaoMin: 30, rotaId: id },
    });
    expect(passeio.statusCode).toBe(201);

    const daRota = await app.inject({ url: `/rotas/${id}/passeios`, headers });
    expect(daRota.json()).toHaveLength(1);
    expect(daRota.json()[0]).toMatchObject({ rotaId: id, rotaNome: 'Lagoa', meu: true });

    await app.inject({ method: 'DELETE', url: `/rotas/${id}`, headers });
    const depois = await app.inject({ url: `/passeios/${passeio.json().id}`, headers });
    expect(depois.statusCode).toBe(200);
    expect(depois.json()).toMatchObject({ rotaId: null, rotaNome: 'Lagoa' });
  });

  it('responde 404 para rota inexistente e 401 sem token', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    for (const [method, url] of [
      ['GET', '/rotas/999'],
      ['PATCH', '/rotas/999'],
      ['DELETE', '/rotas/999'],
      ['PUT', '/rotas/999/favorita'],
      ['GET', '/rotas/999/passeios'],
    ] as const) {
      const r = await app.inject({
        method,
        url,
        headers,
        ...(method === 'PATCH' && { payload: {} }),
      });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().mensagem).toBe('Rota não encontrada');
    }

    expect((await app.inject({ url: '/rotas' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/rotas', payload: novaRota() })).statusCode,
    ).toBe(401);
  });

  it('valida os pontos e os limites', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const poucos = await app.inject({
      method: 'POST',
      url: '/rotas',
      headers,
      payload: novaRota({ pontos: [[-22.9, -43.1]] }),
    });
    expect(poucos.statusCode).toBe(400);
    expect(Object.keys(poucos.json().campos)).toEqual(['pontos']);

    const foraDoMapa = await app.inject({
      method: 'POST',
      url: '/rotas',
      headers,
      payload: novaRota({
        pontos: [
          [91, -43.1],
          [-22.9, -43.1],
        ],
      }),
    });
    expect(foraDoMapa.statusCode).toBe(400);
    expect(Object.keys(foraDoMapa.json().campos)).toEqual(['pontos.0.0']);

    const campos = await app.inject({
      method: 'POST',
      url: '/rotas',
      headers,
      payload: novaRota({ nome: '  ', duracaoMin: 0 }),
    });
    expect(campos.statusCode).toBe(400);
    expect(Object.keys(campos.json().campos).sort()).toEqual(['duracaoMin', 'nome']);
  });
});
