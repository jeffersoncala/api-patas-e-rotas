import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { MAX_BYTES_FOTO } from '../src/modulos/fotos/servico.js';
import { MAX_PETS } from '../src/modulos/perfil/endpoints.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

type Headers = { authorization: string };

/** PNG de 1x1 pixel. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface Pet {
  id: number;
  nome: string;
  foto: string | null;
}

async function adicionarPet(app: App, headers: Headers, dados: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/perfil/pets',
    headers,
    payload: { nome: 'Mingau', especie: 'gato', porte: 'pequeno', ...dados },
  });
  return resposta;
}

describe('perfil', () => {
  it('devolve o tutor e os pets no formato do front', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff', pet: 'Bolota' });

    const resposta = await app.inject({ url: '/perfil', headers });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      tutor: 'Jeff',
      email: expect.stringContaining('@'),
      foto: null,
      metaSemanalKm: 15,
      pets: [
        {
          id: expect.any(Number),
          nome: 'Bolota',
          especie: 'cachorro',
          raca: '',
          idadeAnos: 1,
          porte: 'medio',
          bio: '',
          foto: null,
        },
      ],
    });
  });

  it('atualiza só os dados enviados do tutor e valida os limites', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff' });

    const invalido = await app.inject({
      method: 'PATCH',
      url: '/perfil',
      headers,
      payload: { tutor: '  ', metaSemanalKm: 0 },
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

  it('adiciona, altera e remove pets, até ficar sem nenhum', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { pet: 'Bolota' });

    const criado = await adicionarPet(app, headers, { raca: ' Siamês ' });
    expect(criado.statusCode).toBe(201);
    const [bolota, mingau] = criado.json<{ pets: Pet[] }>().pets;
    expect(mingau).toMatchObject({ nome: 'Mingau', especie: 'gato', raca: 'Siamês', idadeAnos: 1 });

    const invalido = await app.inject({
      method: 'PATCH',
      url: `/perfil/pets/${mingau!.id}`,
      headers,
      payload: { idadeAnos: 99 },
    });
    expect(invalido.statusCode).toBe(400);

    const alterado = await app.inject({
      method: 'PATCH',
      url: `/perfil/pets/${mingau!.id}`,
      headers,
      payload: { nome: 'Mingauzinho', bio: 'Dorme o dia todo.' },
    });
    expect(alterado.json().pets[1]).toMatchObject({
      nome: 'Mingauzinho',
      bio: 'Dorme o dia todo.',
      especie: 'gato',
    });

    const removido = await app.inject({
      method: 'DELETE',
      url: `/perfil/pets/${bolota!.id}`,
      headers,
    });
    expect(removido.statusCode).toBe(200);
    expect(removido.json().pets.map((p: Pet) => p.nome)).toEqual(['Mingauzinho']);

    const ultimo = await app.inject({
      method: 'DELETE',
      url: `/perfil/pets/${mingau!.id}`,
      headers,
    });
    expect(ultimo.statusCode).toBe(200);
    expect(ultimo.json().pets).toEqual([]);
  });

  it('não deixa mexer no pet de outro tutor', async () => {
    const { app } = await criarAppTeste();
    const dono = await cadastrar(app);
    const outro = await cadastrar(app);
    const petDoDono = (await app.inject({ url: '/perfil', headers: dono.headers })).json().pets[0];

    for (const [method, url] of [
      ['PATCH', `/perfil/pets/${petDoDono.id}`],
      ['DELETE', `/perfil/pets/${petDoDono.id}`],
      ['PUT', `/perfil/pets/${petDoDono.id}/foto`],
    ] as const) {
      const resposta = await app.inject({
        method,
        url,
        headers: outro.headers,
        payload: method === 'PUT' ? { imagem: PNG } : { nome: 'Invasor' },
      });
      expect(resposta.statusCode).toBe(404);
    }
  });

  it(`limita a ${MAX_PETS} pets por tutor`, async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    for (let i = 1; i < MAX_PETS; i++) {
      expect((await adicionarPet(app, headers)).statusCode).toBe(201);
    }
    expect((await adicionarPet(app, headers)).statusCode).toBe(409);
  });

  it('troca e remove a foto do tutor, servindo a imagem sem autenticação', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const comFoto = await app.inject({
      method: 'PUT',
      url: '/perfil/foto',
      headers,
      payload: { imagem: PNG },
    });
    expect(comFoto.statusCode).toBe(200);
    const caminho: string = comFoto.json().foto;
    expect(caminho).toMatch(/^\/fotos\/[0-9a-f-]{36}$/);

    const imagem = await app.inject({ url: caminho });
    expect(imagem.statusCode).toBe(200);
    expect(imagem.headers['content-type']).toBe('image/png');
    expect(imagem.headers['cache-control']).toContain('immutable');
    expect(imagem.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(imagem.rawPayload.equals(Buffer.from(PNG.split(',')[1]!, 'base64'))).toBe(true);

    // Trocar a foto cria outra e apaga a anterior.
    const trocada = await app.inject({
      method: 'PUT',
      url: '/perfil/foto',
      headers,
      payload: { imagem: PNG },
    });
    expect(trocada.json().foto).not.toBe(caminho);
    expect((await app.inject({ url: caminho })).statusCode).toBe(404);

    const semFoto = await app.inject({ method: 'DELETE', url: '/perfil/foto', headers });
    expect(semFoto.json().foto).toBeNull();
    expect((await app.inject({ url: trocada.json().foto })).statusCode).toBe(404);
  });

  it('troca a foto de um pet e apaga junto quando o pet é removido', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const [, mingau] = (await adicionarPet(app, headers)).json<{ pets: Pet[] }>().pets;

    const comFoto = await app.inject({
      method: 'PUT',
      url: `/perfil/pets/${mingau!.id}/foto`,
      headers,
      payload: { imagem: PNG },
    });
    expect(comFoto.statusCode).toBe(200);
    const [primeiro, segundo] = comFoto.json<{ pets: Pet[] }>().pets;
    expect(primeiro!.foto).toBeNull();
    expect(segundo!.foto).toMatch(/^\/fotos\//);

    await app.inject({ method: 'DELETE', url: `/perfil/pets/${mingau!.id}`, headers });
    expect((await app.inject({ url: segundo!.foto! })).statusCode).toBe(404);
  });

  it('recusa o que não é imagem e imagens grandes demais', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);
    const enviar = (imagem: string) =>
      app.inject({ method: 'PUT', url: '/perfil/foto', headers, payload: { imagem } });

    const html = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    const gif = `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`;
    const grande = Buffer.alloc(MAX_BYTES_FOTO + 1);
    grande.set([0xff, 0xd8, 0xff]);

    expect((await enviar(html)).json().campos).toEqual({
      imagem: 'O arquivo não é uma imagem válida',
    });
    expect((await enviar(gif)).statusCode).toBe(400);
    expect((await enviar('não é data url')).statusCode).toBe(400);
    expect((await enviar(`data:image/jpeg;base64,${grande.toString('base64')}`)).statusCode).toBe(
      400,
    );
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

  it('apaga a conta e invalida o token', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    expect((await app.inject({ method: 'DELETE', url: '/perfil', headers })).statusCode).toBe(204);
    expect((await app.inject({ url: '/perfil', headers })).statusCode).toBe(401);
  });
});
