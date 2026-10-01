import { describe, expect, it } from 'vitest';
import { cadastrar, criarAppTeste } from './ajuda.js';

describe('auth', () => {
  it('cadastra, devolve tokens e o usuário sem dados sensíveis', async () => {
    const { app } = await criarAppTeste();
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/cadastro',
      payload: {
        email: '  Ana@Exemplo.com ',
        password: 'segredo123',
        tutor: 'Ana',
        pet: 'Mel',
        especie: 'cachorro',
        porte: 'pequeno',
      },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo).toMatchObject({
      tokenType: 'Bearer',
      usuario: { email: 'ana@exemplo.com', tutor: 'Ana', role: 'authenticated' },
    });
    expect(corpo.accessToken).toMatch(/^ey/);
    expect(corpo.refreshToken).toBeTypeOf('string');
    expect(JSON.stringify(corpo)).not.toMatch(/senha|scrypt/i);
  });

  it('recusa e-mail repetido com 409', async () => {
    const { app } = await criarAppTeste();
    await cadastrar(app, { email: 'dup@exemplo.com' });
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/cadastro',
      payload: {
        email: 'DUP@exemplo.com',
        password: 'outrasenha',
        tutor: 'Outro',
        pet: 'Rex',
        especie: 'gato',
        porte: 'grande',
      },
    });
    expect(resposta.statusCode).toBe(409);
  });

  it('responde 400 com os campos inválidos no formato da API anterior', async () => {
    const { app } = await criarAppTeste();
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/cadastro',
      payload: { email: 'nao-e-email', password: '123', tutor: ' ', especie: 'dragão' },
    });

    expect(resposta.statusCode).toBe(400);
    const corpo = resposta.json();
    expect(corpo).toMatchObject({ status: 400, erro: 'Bad Request', mensagem: 'Dados inválidos' });
    expect(Object.keys(corpo.campos)).toEqual(
      expect.arrayContaining(['email', 'password', 'tutor', 'pet', 'especie', 'porte']),
    );
  });

  it('entra com e-mail e senha e recusa senha errada ou conta inexistente', async () => {
    const { app } = await criarAppTeste();
    await cadastrar(app, { email: 'jeff@exemplo.com', password: 'segredo123' });

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'JEFF@exemplo.com ', password: 'segredo123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().usuario.ultimoAcessoEm).not.toBeNull();

    for (const payload of [
      { email: 'jeff@exemplo.com', password: 'errada' },
      { email: 'ninguem@exemplo.com', password: 'segredo123' },
    ]) {
      const falha = await app.inject({ method: 'POST', url: '/auth/login', payload });
      expect(falha.statusCode).toBe(401);
      expect(falha.json().mensagem).toBe('E-mail ou senha incorretos');
    }
  });

  it('protege /auth/me e aceita só o Bearer válido', async () => {
    const { app } = await criarAppTeste();
    const { headers, usuario } = await cadastrar(app);

    expect((await app.inject({ url: '/auth/me' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/auth/me', headers: { authorization: 'Bearer lixo' } })).statusCode,
    ).toBe(401);

    const me = await app.inject({ url: '/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(usuario.id);
  });

  it('rotaciona o refresh token: o antigo deixa de valer', async () => {
    const { app } = await criarAppTeste();
    const { refreshToken } = await cadastrar(app);

    const primeira = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: ` ${refreshToken} ` },
    });
    expect(primeira.statusCode).toBe(200);
    expect(primeira.json().refreshToken).not.toBe(refreshToken);

    const repetida = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(repetida.statusCode).toBe(401);
  });

  it('logout derruba o access token e o refresh token na hora', async () => {
    const { app } = await criarAppTeste();
    const { headers, refreshToken } = await cadastrar(app);

    const saida = await app.inject({ method: 'POST', url: '/auth/logout', headers });
    expect(saida.statusCode).toBe(204);

    expect((await app.inject({ url: '/auth/me', headers })).statusCode).toBe(401);
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('redefine a senha pelo link do e-mail e encerra as sessões abertas', async () => {
    const { app, emails } = await criarAppTeste();
    const { headers } = await cadastrar(app, { email: 'esqueci@exemplo.com' });

    const pedido = await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: 'esqueci@exemplo.com' },
    });
    expect(pedido.statusCode).toBe(202);
    const token = emails[0]?.texto.match(/token=([\w-]+)/)?.[1];
    expect(token).toBeDefined();

    const troca = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, password: 'novasenha456' },
    });
    expect(troca.statusCode).toBe(204);

    expect((await app.inject({ url: '/auth/me', headers })).statusCode).toBe(401);
    const login = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'esqueci@exemplo.com', password },
      });
    expect((await login('segredo123')).statusCode).toBe(401);
    expect((await login('novasenha456')).statusCode).toBe(200);

    // O mesmo link não serve duas vezes.
    const reuso = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, password: 'outra789' },
    });
    expect(reuso.statusCode).toBe(400);
  });

  it('não revela se o e-mail tem conta ao pedir redefinição', async () => {
    const { app, emails } = await criarAppTeste();
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: 'nao-existe@exemplo.com' },
    });
    expect(resposta.statusCode).toBe(202);
    expect(emails).toHaveLength(0);
  });

  it('limita tentativas de login por IP', async () => {
    const { app } = await criarAppTeste();
    const tentativas = await Promise.all(
      Array.from({ length: 11 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'a@exemplo.com', password: 'x' },
        }),
      ),
    );
    expect(tentativas.map((t) => t.statusCode)).toContain(429);
    expect(tentativas.find((t) => t.statusCode === 429)?.json().status).toBe(429);
  });
});
