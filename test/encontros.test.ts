import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { encontros, presencas } from '../src/db/schema.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const emDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString();

const novo = (extra: Record<string, unknown> = {}) => ({
  titulo: 'Encontro no parque',
  local: 'Parque Ibirapuera',
  posicao: [-23.587, -46.657],
  data: emDias(2),
  ...extra,
});

type Headers = { authorization: string };

async function criar(app: App, headers: Headers, extra: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/encontros',
    headers,
    payload: novo(extra),
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json<{ id: number }>();
}

describe('encontros', () => {
  it('cria no formato do front com o organizador já confirmado', async () => {
    const { app } = await criarAppTeste();
    const { headers, usuario } = await cadastrar(app, { tutor: 'Ana', pet: 'Mel' });
    const data = new Date(Date.now() + 3 * DIA_MS);

    const resposta = await app.inject({
      method: 'POST',
      url: '/encontros',
      headers,
      payload: novo({ titulo: '  Corrida  ', data: data.toISOString().replace('Z', '+00:00') }),
    });
    expect(resposta.statusCode).toBe(201);
    const encontro = resposta.json();
    expect(encontro).toEqual({
      id: expect.any(Number),
      titulo: 'Corrida',
      descricao: '',
      local: 'Parque Ibirapuera',
      posicao: [-23.587, -46.657],
      data: data.toISOString(),
      confirmados: 1,
      vou: true,
      organizador: 'Ana e Mel',
      organizadorId: usuario.id,
      meu: true,
    });

    const outro = await cadastrar(app);
    const visto = await app.inject({ url: `/encontros/${encontro.id}`, headers: outro.headers });
    expect(visto.statusCode).toBe(200);
    expect(visto.json()).toMatchObject({ confirmados: 1, vou: false, meu: false });
  });

  it('valida data no passado, posição e título', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const resposta = await app.inject({
      method: 'POST',
      url: '/encontros',
      headers,
      payload: novo({ titulo: '   ', posicao: [91, 0], data: emDias(-1) }),
    });
    expect(resposta.statusCode).toBe(400);
    expect(Object.keys(resposta.json().campos).sort()).toEqual(['data', 'posicao.0', 'titulo']);

    const semFuso = await app.inject({
      method: 'POST',
      url: '/encontros',
      headers,
      payload: novo({ data: '2099-01-01T10:00:00' }),
    });
    expect(semFuso.statusCode).toBe(400);
    expect(semFuso.json().campos).toHaveProperty('data');

    const { id } = await criar(app, headers);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/encontros/${id}`,
      headers,
      payload: { data: emDias(-1) },
    });
    expect(patch.statusCode).toBe(400);
    expect(Object.keys(patch.json().campos)).toEqual(['data']);
  });

  it('lista por data e aplica os filtros de presença e período', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);

    await criar(app, ana.headers, { titulo: 'Depois', data: emDias(5) });
    await criar(app, bia.headers, { titulo: 'Antes', data: emDias(1) });
    // Encontro que já passou: a API não deixa criar, então vai direto no banco.
    const [passado] = await app.banco
      .insert(encontros)
      .values({
        organizadorId: ana.usuario.id,
        titulo: 'Passado',
        local: 'Praça',
        latitude: 0,
        longitude: 0,
        data: new Date(Date.now() - DIA_MS),
      })
      .returning();
    await app.banco
      .insert(presencas)
      .values({ encontroId: passado!.id, usuarioId: ana.usuario.id });

    const titulos = async (url: string) =>
      (await app.inject({ url, headers: ana.headers }))
        .json<{ titulo: string }[]>()
        .map((e) => e.titulo);

    expect(await titulos('/encontros')).toEqual(['Antes', 'Depois']);
    expect(await titulos('/encontros?periodo=todos')).toEqual(['Passado', 'Antes', 'Depois']);
    expect(await titulos('/encontros?filtro=vou')).toEqual(['Depois']);
    expect(await titulos('/encontros?filtro=vou&periodo=todos')).toEqual(['Passado', 'Depois']);

    const invalido = await app.inject({ url: '/encontros?filtro=xyz', headers: ana.headers });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().campos).toHaveProperty('filtro');
  });

  it('confirma e cancela presença de forma idempotente', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const { id } = await criar(app, ana.headers);
    const presenca = (metodo: 'PUT' | 'DELETE', headers: Headers) =>
      app.inject({ method: metodo, url: `/encontros/${id}/presenca`, headers });

    for (let i = 0; i < 2; i++) {
      const r = await presenca('PUT', bia.headers);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ id, confirmados: 2, vou: true, meu: false });
    }

    for (let i = 0; i < 2; i++) {
      const r = await presenca('DELETE', bia.headers);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ confirmados: 1, vou: false });
    }

    const organizador = await presenca('DELETE', ana.headers);
    expect(organizador.statusCode).toBe(200);
    expect(organizador.json()).toMatchObject({ confirmados: 0, vou: false, meu: true });

    expect((await presenca('PUT', bia.headers)).json()).toMatchObject({ confirmados: 1 });
  });

  it('só o organizador altera ou apaga', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const { id } = await criar(app, ana.headers);
    const url = `/encontros/${id}`;

    const patchOutro = await app.inject({
      method: 'PATCH',
      url,
      headers: bia.headers,
      payload: { titulo: 'Invadido' },
    });
    expect(patchOutro.statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url, headers: bia.headers })).statusCode).toBe(
      403,
    );

    const patch = await app.inject({
      method: 'PATCH',
      url,
      headers: ana.headers,
      payload: { titulo: 'Novo título', posicao: [-22.9, -43.2], descricao: 'Tragam água' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({
      titulo: 'Novo título',
      posicao: [-22.9, -43.2],
      descricao: 'Tragam água',
      local: 'Parque Ibirapuera',
      confirmados: 1,
    });

    expect((await app.inject({ method: 'DELETE', url, headers: ana.headers })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ url, headers: ana.headers })).statusCode).toBe(404);
  });

  it('responde 404 para encontro inexistente', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const url = '/encontros/999';

    for (const [method, sufixo] of [
      ['GET', ''],
      ['PATCH', ''],
      ['DELETE', ''],
      ['PUT', '/presenca'],
      ['DELETE', '/presenca'],
    ] as const) {
      const r = await app.inject({
        method,
        url: url + sufixo,
        headers,
        ...(method === 'PATCH' && { payload: { titulo: 'x' } }),
      });
      expect(r.statusCode, `${method} ${sufixo}`).toBe(404);
      expect(r.json().mensagem).toBe('Encontro não encontrado');
    }
  });

  it('exige token', async () => {
    const { app } = await criarAppTeste();
    expect((await app.inject({ url: '/encontros' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/encontros', payload: novo() })).statusCode,
    ).toBe(401);
  });
});
