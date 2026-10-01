import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app.js';
import type { LatLng } from '../src/db/schema.js';
import { distanciaTrajeto } from '../src/geo.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

type Headers = { authorization: string };

const PONTOS: LatLng[] = [
  [-22.9068, -43.1729],
  [-22.9102, -43.1755],
];

// Só o Date é falso: permite datas distintas e previsíveis sem travar os timers do Fastify.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Avança o relógio um minuto por passeio, para a ordem do feed ser determinística. */
async function registrar(app: App, headers: Headers, dados: Record<string, unknown> = {}) {
  vi.setSystemTime(Date.now() + 60_000);
  const resposta = await app.inject({
    method: 'POST',
    url: '/passeios',
    headers,
    payload: { pontos: PONTOS, duracaoMin: 25, ...dados },
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json<{ id: number; data: string }>();
}

describe('passeios', () => {
  it('registra um passeio livre com a distância calculada no servidor', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff', pet: 'Bolota' });

    const resposta = await app.inject({
      method: 'POST',
      url: '/passeios',
      headers,
      payload: { pontos: PONTOS, duracaoMin: 25, texto: ' Dia lindo ', distanciaKm: 50 },
    });
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({
      id: expect.any(Number),
      pet: 'Bolota',
      tutor: 'Jeff',
      data: '2026-09-01T12:00:00.000Z',
      rotaId: null,
      rotaNome: 'Passeio livre',
      pontos: PONTOS,
      distanciaKm: distanciaTrajeto(PONTOS),
      duracaoMin: 25,
      texto: 'Dia lindo',
      curtidas: 0,
      curtido: false,
      meu: true,
    });

    const nomeado = await registrar(app, headers, { rotaNome: 'Volta no quarteirão' });
    expect(nomeado).toMatchObject({ rotaNome: 'Volta no quarteirão', rotaId: null });
  });

  it('registra em uma rota copiando o nome dela; rota inexistente dá 400', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const rota = await app.inject({
      method: 'POST',
      url: '/rotas',
      headers,
      payload: { nome: 'Lagoa', bairro: 'Lagoa', pontos: PONTOS, duracaoMin: 30 },
    });

    const passeio = await registrar(app, headers, { rotaId: rota.json().id, rotaNome: 'Ignorado' });
    expect(passeio).toMatchObject({ rotaId: rota.json().id, rotaNome: 'Lagoa' });

    const inexistente = await app.inject({
      method: 'POST',
      url: '/passeios',
      headers,
      payload: { pontos: PONTOS, duracaoMin: 25, rotaId: 999 },
    });
    expect(inexistente.statusCode).toBe(400);
    expect(inexistente.json().campos).toEqual({ rotaId: 'Rota não encontrada' });

    const invalido = await app.inject({
      method: 'POST',
      url: '/passeios',
      headers,
      payload: { pontos: [PONTOS[0]], duracaoMin: 2000 },
    });
    expect(invalido.statusCode).toBe(400);
    expect(Object.keys(invalido.json().campos).sort()).toEqual(['duracaoMin', 'pontos']);
  });

  it('feed do mais recente para o mais antigo, com paginação por cursor e filtro autor=eu', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    const ids: number[] = [];
    for (const quem of [a, b, a, b, a]) {
      ids.push((await registrar(app, quem.headers)).id);
    }
    const esperados = [...ids].reverse();

    const pagina1 = await app.inject({ url: '/passeios?limite=2', headers: a.headers });
    expect(pagina1.statusCode).toBe(200);
    const p1 = pagina1.json();
    expect(p1.itens.map((p: { id: number }) => p.id)).toEqual(esperados.slice(0, 2));
    expect(p1.proximoCursor).toBe(`${Date.parse(p1.itens[1].data)}.${p1.itens[1].id}`);

    const vistos = [...p1.itens];
    let cursor: string | null = p1.proximoCursor;
    while (cursor) {
      const pagina = await app.inject({
        url: `/passeios?limite=2&antesDe=${encodeURIComponent(cursor)}`,
        headers: a.headers,
      });
      vistos.push(...pagina.json().itens);
      cursor = pagina.json().proximoCursor;
    }
    expect(vistos.map((p) => p.id)).toEqual(esperados);

    const meus = await app.inject({ url: '/passeios?autor=eu', headers: a.headers });
    expect(meus.json().itens.map((p: { id: number }) => p.id)).toEqual([ids[4], ids[2], ids[0]]);
    expect(meus.json().itens.every((p: { meu: boolean }) => p.meu)).toBe(true);
    expect(meus.json().proximoCursor).toBeNull();

    for (const url of ['/passeios?limite=0', '/passeios?limite=51', '/passeios?antesDe=ontem']) {
      expect((await app.inject({ url, headers: a.headers })).statusCode, url).toBe(400);
    }
  });

  it('não pula passeios com a mesma data na virada da página', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    // Relógio parado: os três passeios ficam com o mesmo milissegundo.
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/passeios',
        headers,
        payload: { pontos: PONTOS, duracaoMin: 10 },
      });
      ids.push(r.json().id);
    }

    const vistos: number[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/passeios?limite=1${cursor ? `&antesDe=${cursor}` : ''}`;
      const pagina = (await app.inject({ url, headers })).json();
      vistos.push(...pagina.itens.map((p: { id: number }) => p.id));
      cursor = pagina.proximoCursor;
    } while (cursor);
    expect(vistos).toEqual([...ids].reverse());
  });

  it('curte e descurte de forma idempotente, contando por usuário', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    const { id } = await registrar(app, a.headers);
    const url = `/passeios/${id}/curtida`;

    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'PUT', url, headers: b.headers });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ curtidas: 1, curtido: true, meu: false });
    }
    const doAutor = await app.inject({ method: 'PUT', url, headers: a.headers });
    expect(doAutor.json()).toMatchObject({ curtidas: 2, curtido: true, meu: true });

    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'DELETE', url, headers: b.headers });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ curtidas: 1, curtido: false });
    }
    const feed = await app.inject({ url: '/passeios', headers: a.headers });
    expect(feed.json().itens[0]).toMatchObject({ curtidas: 1, curtido: true });

    expect(
      (await app.inject({ method: 'PUT', url: '/passeios/999/curtida', headers: b.headers }))
        .statusCode,
    ).toBe(404);
  });

  it('só quem registrou apaga', async () => {
    const { app } = await criarAppTeste();
    const a = await cadastrar(app);
    const b = await cadastrar(app);
    const { id } = await registrar(app, a.headers);
    const url = `/passeios/${id}`;

    const alheio = await app.inject({ method: 'DELETE', url, headers: b.headers });
    expect(alheio.statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url, headers: a.headers })).statusCode).toBe(204);
    expect((await app.inject({ url, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ url: '/passeios' })).statusCode).toBe(401);
  });

  it('o resumo do perfil reflete os passeios registrados', async () => {
    const { app } = await criarAppTeste();
    const { corpo } = await cadastrar(app);
    const longo: LatLng[] = [
      [-23, -43],
      [-23.05, -43],
    ];
    const entrar = async (): Promise<Headers> => {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: corpo.email, password: corpo.password },
      });
      return { authorization: `Bearer ${login.json().accessToken}` };
    };

    await registrar(app, await entrar(), { pontos: longo });
    // Dez dias depois: o primeiro passeio sai da semana, mas segue no total
    // (novo login porque o access token expira antes disso).
    vi.setSystemTime(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const headers = await entrar();
    await registrar(app, headers);
    await registrar(app, (await cadastrar(app)).headers);

    const resumo = await app.inject({ url: '/perfil/resumo', headers });
    const arred = (km: number) => Math.round(km * 100) / 100;
    expect(resumo.json()).toMatchObject({
      kmSemana: arred(distanciaTrajeto(PONTOS)),
      passeiosSemana: 1,
      kmTotal: arred(distanciaTrajeto(longo) + distanciaTrajeto(PONTOS)),
      totalPasseios: 2,
    });
  });
});
