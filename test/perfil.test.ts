import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

type Headers = { authorization: string };

const novoPet = (app: App, headers: Headers, nome: string) =>
  app.inject({
    method: 'POST',
    url: '/perfil/pets',
    headers,
    payload: { nome, especie: 'gato', porte: 'pequeno' },
  });

/** Faz os dois passos do upload: pede a URL, "envia" o arquivo e confirma. */
async function trocarFoto(
  app: App,
  headers: Headers,
  enviar: (caminho: string) => void,
  url: string,
) {
  const pedido = await app.inject({ method: 'POST', url: `${url}/upload`, headers });
  expect(pedido.statusCode).toBe(200);
  const { caminho, urlUpload } = pedido.json<{ caminho: string; urlUpload: string }>();
  expect(urlUpload).toContain(caminho);
  enviar(caminho);
  const confirmado = await app.inject({ method: 'PUT', url, headers, payload: { caminho } });
  expect(confirmado.statusCode).toBe(200);
  return { caminho, corpo: confirmado.json() };
}

describe('perfil', () => {
  it('devolve o tutor e os pets', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff', pet: 'Bolota' });

    const resposta = await app.inject({ url: '/perfil', headers });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      tutor: 'Jeff',
      email: expect.stringContaining('@'),
      metaSemanalKm: 15,
      fotoUrl: null,
      pets: [
        {
          id: expect.any(Number),
          nome: 'Bolota',
          especie: 'cachorro',
          raca: '',
          idadeAnos: 1,
          porte: 'medio',
          bio: '',
          fotoUrl: null,
        },
      ],
    });
  });

  it('atualiza o tutor só nos campos enviados e valida os limites', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff' });

    const invalido = await app.inject({
      method: 'PATCH',
      url: '/perfil',
      headers,
      payload: { tutor: ' ', metaSemanalKm: 0 },
    });
    expect(invalido.statusCode).toBe(400);
    expect(Object.keys(invalido.json().campos)).toEqual(['tutor', 'metaSemanalKm']);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/perfil',
      headers,
      payload: { metaSemanalKm: 20 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tutor: 'Jeff', metaSemanalKm: 20 });
  });

  it('adiciona, edita e remove pets', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { pet: 'Bolota' });

    const criado = await novoPet(app, headers, ' Nina ');
    expect(criado.statusCode).toBe(201);
    const nina = criado.json();
    expect(nina).toMatchObject({ nome: 'Nina', especie: 'gato', raca: '', fotoUrl: null });

    const invalido = await app.inject({
      method: 'PATCH',
      url: `/perfil/pets/${nina.id}`,
      headers,
      payload: { idadeAnos: 99 },
    });
    expect(invalido.statusCode).toBe(400);

    const editado = await app.inject({
      method: 'PATCH',
      url: `/perfil/pets/${nina.id}`,
      headers,
      payload: { raca: ' Siamês ', idadeAnos: 6 },
    });
    expect(editado.json()).toMatchObject({ nome: 'Nina', raca: 'Siamês', idadeAnos: 6 });

    const perfil = await app.inject({ url: '/perfil', headers });
    expect(perfil.json().pets.map((p: { nome: string }) => p.nome)).toEqual(['Bolota', 'Nina']);

    const apagar = await app.inject({ method: 'DELETE', url: `/perfil/pets/${nina.id}`, headers });
    expect(apagar.statusCode).toBe(204);
    expect((await app.inject({ url: `/perfil/pets/${nina.id}`, headers })).statusCode).toBe(404);
  });

  it('limita o perfil a 10 pets e não deixa ficar sem nenhum', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    for (let i = 2; i <= 10; i++) {
      expect((await novoPet(app, headers, `Pet ${i}`)).statusCode).toBe(201);
    }
    const decimoPrimeiro = await novoPet(app, headers, 'Sobrando');
    expect(decimoPrimeiro.statusCode).toBe(409);

    const ids: number[] = (await app.inject({ url: '/perfil', headers }))
      .json()
      .pets.map((p: { id: number }) => p.id);
    expect(ids).toHaveLength(10);
    for (const id of ids.slice(1)) {
      await app.inject({ method: 'DELETE', url: `/perfil/pets/${id}`, headers });
    }
    const ultimo = await app.inject({ method: 'DELETE', url: `/perfil/pets/${ids[0]}`, headers });
    expect(ultimo.statusCode).toBe(409);
    expect((await app.inject({ url: '/perfil', headers })).json().pets).toHaveLength(1);
  });

  it('não mexe nos pets de outro tutor', async () => {
    const { app } = await criarAppTeste();
    const dono = await cadastrar(app);
    const outro = await cadastrar(app);
    const petId = (await app.inject({ url: '/perfil', headers: dono.headers })).json().pets[0].id;

    for (const [method, url] of [
      ['GET', `/perfil/pets/${petId}`],
      ['PATCH', `/perfil/pets/${petId}`],
      ['DELETE', `/perfil/pets/${petId}`],
      ['POST', `/perfil/pets/${petId}/foto/upload`],
    ] as const) {
      const r = await app.inject({ method, url, headers: outro.headers, payload: {} });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('começa com o resumo zerado', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const resumo = await app.inject({ url: '/perfil/resumo', headers });
    expect(resumo.json()).toEqual({
      kmSemana: 0,
      passeiosSemana: 0,
      kmTotal: 0,
      totalPasseios: 0,
      encontrosConfirmados: 0,
    });
  });

  it('troca a foto do tutor em dois passos e apaga a anterior', async () => {
    const { app, storage } = await criarAppTeste();
    const { headers, usuario } = await cadastrar(app);

    // Sem o arquivo no storage, não confirma.
    const { caminho: naoEnviado } = (
      await app.inject({ method: 'POST', url: '/perfil/foto/upload', headers })
    ).json();
    const semArquivo = await app.inject({
      method: 'PUT',
      url: '/perfil/foto',
      headers,
      payload: { caminho: naoEnviado },
    });
    expect(semArquivo.statusCode).toBe(400);

    const primeira = await trocarFoto(app, headers, storage.enviar, '/perfil/foto');
    expect(primeira.caminho.startsWith(`${usuario.id}/tutor/`)).toBe(true);
    expect(primeira.corpo.fotoUrl).toContain(primeira.caminho);

    const segunda = await trocarFoto(app, headers, storage.enviar, '/perfil/foto');
    expect([...storage.arquivos]).toEqual([segunda.caminho]);

    expect((await app.inject({ method: 'DELETE', url: '/perfil/foto', headers })).statusCode).toBe(
      204,
    );
    expect(storage.arquivos.size).toBe(0);
    expect((await app.inject({ url: '/perfil', headers })).json().fotoUrl).toBeNull();
  });

  it('cada pet tem a própria foto', async () => {
    const { app, storage } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const bolota = (await app.inject({ url: '/perfil', headers })).json().pets[0];
    const nina = (await novoPet(app, headers, 'Nina')).json();

    const fotoBolota = await trocarFoto(
      app,
      headers,
      storage.enviar,
      `/perfil/pets/${bolota.id}/foto`,
    );
    expect(fotoBolota.corpo).toMatchObject({ id: bolota.id, fotoUrl: expect.any(String) });

    // A foto gerada para um pet não serve para outro, nem para o tutor.
    for (const url of [`/perfil/pets/${nina.id}/foto`, '/perfil/foto']) {
      const r = await app.inject({
        method: 'PUT',
        url,
        headers,
        payload: { caminho: fotoBolota.caminho },
      });
      expect(r.statusCode, url).toBe(400);
    }

    const perfil = (await app.inject({ url: '/perfil', headers })).json();
    expect(perfil.fotoUrl).toBeNull();
    expect(perfil.pets.map((p: { fotoUrl: string | null }) => p.fotoUrl)).toEqual([
      expect.stringContaining(fotoBolota.caminho),
      null,
    ]);

    // Remover o pet leva a foto dele junto.
    await trocarFoto(app, headers, storage.enviar, `/perfil/pets/${nina.id}/foto`);
    await app.inject({ method: 'DELETE', url: `/perfil/pets/${nina.id}`, headers });
    expect([...storage.arquivos]).toEqual([fotoBolota.caminho]);

    const remover = await app.inject({
      method: 'DELETE',
      url: `/perfil/pets/${bolota.id}/foto`,
      headers,
    });
    expect(remover.statusCode).toBe(204);
    expect(storage.arquivos.size).toBe(0);
  });

  it('não aceita foto de outro usuário', async () => {
    const { app, storage } = await criarAppTeste();
    const dono = await cadastrar(app);
    const outro = await cadastrar(app);
    const { caminho } = await trocarFoto(app, dono.headers, storage.enviar, '/perfil/foto');

    for (const tentativa of [caminho, `${outro.usuario.id}/tutor/../../${caminho}`]) {
      const r = await app.inject({
        method: 'PUT',
        url: '/perfil/foto',
        headers: outro.headers,
        payload: { caminho: tentativa },
      });
      expect(r.statusCode).toBe(400);
    }
  });

  it('apaga a conta, as fotos e invalida o token', async () => {
    const { app, storage } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const petId = (await app.inject({ url: '/perfil', headers })).json().pets[0].id;
    await trocarFoto(app, headers, storage.enviar, '/perfil/foto');
    await trocarFoto(app, headers, storage.enviar, `/perfil/pets/${petId}/foto`);

    expect((await app.inject({ method: 'DELETE', url: '/perfil', headers })).statusCode).toBe(204);
    expect(storage.arquivos.size).toBe(0);
    expect((await app.inject({ url: '/perfil', headers })).statusCode).toBe(401);
  });
});
