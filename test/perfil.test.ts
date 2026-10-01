import { describe, expect, it } from 'vitest';
import { cadastrar, criarAppTeste } from './ajuda.js';

describe('perfil', () => {
  it('devolve o perfil no formato do front', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { tutor: 'Jeff', pet: 'Bolota' });

    const resposta = await app.inject({ url: '/perfil', headers });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      tutor: 'Jeff',
      email: expect.stringContaining('@'),
      pet: 'Bolota',
      especie: 'cachorro',
      raca: '',
      idadeAnos: 1,
      porte: 'medio',
      bio: '',
      metaSemanalKm: 15,
    });
  });

  it('atualiza só os campos enviados e valida os limites', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app, { pet: 'Bolota' });

    const invalido = await app.inject({
      method: 'PATCH',
      url: '/perfil',
      headers,
      payload: { idadeAnos: 99, metaSemanalKm: 0 },
    });
    expect(invalido.statusCode).toBe(400);
    expect(Object.keys(invalido.json().campos)).toEqual(['idadeAnos', 'metaSemanalKm']);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/perfil',
      headers,
      payload: { pet: 'Bolinha', raca: ' Vira-lata ', metaSemanalKm: 20 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      pet: 'Bolinha',
      raca: 'Vira-lata',
      metaSemanalKm: 20,
      porte: 'medio',
    });
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
