import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app.js';
import type { LatLng } from '../src/db/schema.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

type Headers = { authorization: string };

/** PNG de 1x1 pixel. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const PONTOS: LatLng[] = [
  [-22.9068, -43.1729],
  [-22.9102, -43.1755],
];

interface FotoAlbum {
  foto: string;
  passeioId: number;
  data: string;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

async function primeiroPet(app: App, headers: Headers) {
  const perfil = await app.inject({ url: '/perfil', headers });
  return perfil.json<{ pets: { id: number }[] }>().pets[0]!.id;
}

/** Avança o relógio um minuto por passeio, para a ordem do álbum ser determinística. */
async function registrar(app: App, headers: Headers, dados: Record<string, unknown> = {}) {
  vi.setSystemTime(Date.now() + 60_000);
  const resposta = await app.inject({
    method: 'POST',
    url: '/passeios',
    headers,
    payload: { pontos: PONTOS, duracaoMin: 25, ...dados },
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json<{ id: number; fotos: string[]; distanciaKm: number }>();
}

describe('pets', () => {
  it('mostra o perfil público do pet de outro tutor, sem dados da conta', async () => {
    const { app } = await criarAppTeste();
    const dono = await cadastrar(app, { tutor: 'Jeff', pet: 'Bolota' });
    const visitante = await cadastrar(app);
    const petId = await primeiroPet(app, dono.headers);
    const passeio = await registrar(app, dono.headers, { fotos: [PNG, PNG] });

    const resposta = await app.inject({ url: `/pets/${petId}`, headers: visitante.headers });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      pet: {
        id: petId,
        nome: 'Bolota',
        especie: 'cachorro',
        raca: '',
        idadeAnos: 1,
        porte: 'medio',
        bio: '',
        foto: null,
      },
      tutor: 'Jeff',
      fotoTutor: null,
      meu: false,
      totalPasseios: 1,
      kmTotal: Math.round(passeio.distanciaKm * 100) / 100,
      totalFotos: 2,
    });
    expect(resposta.body).not.toContain('@');

    const proprio = await app.inject({ url: `/pets/${petId}`, headers: dono.headers });
    expect(proprio.json().meu).toBe(true);
  });

  it('o álbum traz só as fotos dos passeios em que o pet foi, das mais recentes às antigas', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { pet: 'Bolota' });
    const bolota = await primeiroPet(app, headers);
    const criado = await app.inject({
      method: 'POST',
      url: '/perfil/pets',
      headers,
      payload: { nome: 'Mingau', especie: 'gato', porte: 'pequeno' },
    });
    const mingau = criado.json<{ pets: { id: number }[] }>().pets[1]!.id;

    const antigo = await registrar(app, headers, { petIds: [bolota], fotos: [PNG, PNG] });
    await registrar(app, headers, { petIds: [mingau], fotos: [PNG] });
    await registrar(app, headers, { petIds: [bolota] });
    const recente = await registrar(app, headers, { fotos: [PNG] });

    const album = await app.inject({ url: `/pets/${bolota}/album`, headers });
    expect(album.statusCode).toBe(200);
    expect(album.json<{ itens: FotoAlbum[] }>().itens.map((f) => f.foto)).toEqual([
      ...recente.fotos,
      ...antigo.fotos,
    ]);
    expect(album.json().itens[0]).toEqual({
      foto: recente.fotos[0],
      passeioId: recente.id,
      data: expect.any(String),
    });
    expect(album.json().proximoCursor).toBeNull();
  });

  it('pagina o álbum por cursor, mesmo no meio de um passeio', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const petId = await primeiroPet(app, headers);
    const a = await registrar(app, headers, { fotos: [PNG, PNG, PNG] });
    const b = await registrar(app, headers, { fotos: [PNG, PNG] });
    const esperado = [...b.fotos, ...a.fotos];

    type Pagina = { itens: FotoAlbum[]; proximoCursor: string | null };
    const buscar = async (cursor: string | null): Promise<Pagina> => {
      const query = cursor ? `&antesDe=${cursor}` : '';
      const pagina = await app.inject({ url: `/pets/${petId}/album?limite=2${query}`, headers });
      expect(pagina.statusCode).toBe(200);
      return pagina.json<Pagina>();
    };

    const vistas: string[] = [];
    let cursor: string | null = null;
    do {
      const corpo = await buscar(cursor);
      vistas.push(...corpo.itens.map((f) => f.foto));
      cursor = corpo.proximoCursor;
    } while (cursor);
    expect(vistas).toEqual(esperado);

    const invalido = await app.inject({ url: `/pets/${petId}/album?antesDe=abc`, headers });
    expect(invalido.statusCode).toBe(400);
  });

  it('404 para pet que não existe e 401 sem login', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const petId = await primeiroPet(app, headers);

    expect((await app.inject({ url: '/pets/999999', headers })).statusCode).toBe(404);
    expect((await app.inject({ url: '/pets/999999/album', headers })).statusCode).toBe(404);
    expect((await app.inject({ url: `/pets/${petId}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/pets/${petId}/album` })).statusCode).toBe(401);
  });
});
