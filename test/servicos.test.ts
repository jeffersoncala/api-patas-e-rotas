import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { fotos } from '../src/db/schema.js';
import { cadastrar, criarAppTeste } from './ajuda.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const HORA_MS = 60 * 60 * 1000;
const daquiHoras = (horas: number) => new Date(Date.now() + horas * HORA_MS).toISOString();

/** Botafogo, no Rio; os outros pontos ficam a distâncias conhecidas daqui. */
const CENTRO = [-22.9468, -43.1823] as const;
/** ~1,1 km ao norte. */
const PERTO = [-22.9368, -43.1823];
/** ~5,6 km ao norte. */
const MEIO = [-22.8968, -43.1823];
/** ~350 km (São Paulo). */
const LONGE = [-23.5505, -46.6333];

type Headers = { authorization: string };

const novoPrestador = (extra: Record<string, unknown> = {}) => ({
  tipo: 'passeador',
  nome: 'Ana Passeios',
  contato: '(21) 98888-0000',
  bairro: 'Botafogo',
  posicao: PERTO,
  ...extra,
});

async function criarPrestador(app: App, headers: Headers, extra: Record<string, unknown> = {}) {
  const r = await app.inject({
    method: 'POST',
    url: '/prestadores',
    headers,
    payload: novoPrestador(extra),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: number; fotos: string[] }>();
}

/** Primeiro pet do perfil (o `cadastrar` cria um). */
async function petDe(app: App, headers: Headers) {
  const perfil = await app.inject({ url: '/perfil', headers });
  return perfil.json<{ pets: { id: number }[] }>().pets[0]!.id;
}

async function pedir(
  app: App,
  headers: Headers,
  prestadorId: number,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/contratacoes',
    headers,
    payload: {
      prestadorId,
      petIds: [await petDe(app, headers)],
      inicio: daquiHoras(24),
      contato: '(21) 97777-0000',
      ...extra,
    },
  });
}

const mudarStatus = (app: App, headers: Headers, id: number, status: string) =>
  app.inject({ method: 'PUT', url: `/contratacoes/${id}/status`, headers, payload: { status } });

const buscar = (query = '') => `/prestadores?lat=${CENTRO[0]}&lng=${CENTRO[1]}${query}`;

describe('prestadores', () => {
  it('cadastra no formato do front, com fotos e preços', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const r = await app.inject({
      method: 'POST',
      url: '/prestadores',
      headers,
      payload: novoPrestador({
        tipo: 'anfitriao',
        nome: '  Casa da Ana ',
        descricao: 'Quintal grande e telado',
        precos: [{ descricao: 'Diária', valorCentavos: 8000 }],
        fotos: [PNG, PNG],
      }),
    });
    expect(r.statusCode, r.body).toBe(201);
    const criado = r.json();
    expect(criado).toEqual({
      id: expect.any(Number),
      tipo: 'anfitriao',
      nome: 'Casa da Ana',
      descricao: 'Quintal grande e telado',
      contato: '(21) 98888-0000',
      bairro: 'Botafogo',
      posicao: PERTO,
      precos: [{ descricao: 'Diária', valorCentavos: 8000 }],
      fotos: [
        expect.stringMatching(/^\/fotos\/[0-9a-f-]{36}$/),
        expect.stringMatching(/^\/fotos\/[0-9a-f-]{36}$/),
      ],
      fotoUsuario: null,
      ativo: true,
      notaMedia: null,
      totalAvaliacoes: 0,
      meu: true,
    });

    const outro = await cadastrar(app);
    const visto = await app.inject({ url: `/prestadores/${criado.id}`, headers: outro.headers });
    expect(visto.json()).toMatchObject({ id: criado.id, meu: false });
  });

  it('aceita um cadastro de cada tipo por usuário', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    await criarPrestador(app, headers);
    await criarPrestador(app, headers, { tipo: 'petshop', nome: 'Banho da Ana' });
    const repetido = await app.inject({
      method: 'POST',
      url: '/prestadores',
      headers,
      payload: novoPrestador(),
    });
    expect(repetido.statusCode).toBe(409);

    const meus = await app.inject({ url: '/prestadores/meus', headers });
    expect(meus.json().map((p: { tipo: string }) => p.tipo)).toEqual(['passeador', 'petshop']);
  });

  it('valida os campos', async () => {
    const { app } = await criarAppTeste();
    const { headers } = await cadastrar(app);

    const r = await app.inject({
      method: 'POST',
      url: '/prestadores',
      headers,
      payload: novoPrestador({
        tipo: 'veterinario',
        nome: ' ',
        contato: '',
        precos: [{ descricao: 'Banho', valorCentavos: -1 }],
        fotos: Array(7).fill(PNG),
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().campos).sort()).toEqual([
      'contato',
      'fotos',
      'nome',
      'precos.0.valorCentavos',
      'tipo',
    ]);
  });

  it('busca os ativos dentro do raio, filtrando pelo tipo', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const caio = await cadastrar(app);

    await criarPrestador(app, ana.headers, { nome: 'Meio', posicao: MEIO });
    await criarPrestador(app, bia.headers, { nome: 'Perto', posicao: PERTO });
    await criarPrestador(app, bia.headers, { nome: 'Pet Perto', tipo: 'petshop', posicao: PERTO });
    await criarPrestador(app, caio.headers, { nome: 'Longe', posicao: LONGE });
    const pausado = await criarPrestador(app, caio.headers, {
      nome: 'Pausado',
      tipo: 'petshop',
      posicao: PERTO,
    });
    await app.inject({
      method: 'PATCH',
      url: `/prestadores/${pausado.id}`,
      headers: caio.headers,
      payload: { ativo: false },
    });

    const listar = async (query: string) => {
      const r = await app.inject({ url: buscar(query), headers: ana.headers });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<{ nome: string; distanciaKm: number }[]>();
    };

    // Sem raio, usa 10 km; sem tipo, traz todos.
    expect((await listar('')).map((p) => p.nome)).toEqual(['Perto', 'Pet Perto', 'Meio']);
    expect((await listar('&tipo=passeador&raioKm=3')).map((p) => p.nome)).toEqual(['Perto']);
    expect((await listar('&tipo=petshop')).map((p) => p.nome)).toEqual(['Pet Perto']);
    const [perto] = await listar('&tipo=passeador');
    expect(perto!.distanciaKm).toBeCloseTo(1.112, 2);

    const invalido = await app.inject({
      url: buscar('&tipo=vet&raioKm=500'),
      headers: ana.headers,
    });
    expect(Object.keys(invalido.json().campos).sort()).toEqual(['raioKm', 'tipo']);
  });

  it('quem cadastrou altera as fotos e apaga, levando as fotos junto', async () => {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app);
    const bia = await cadastrar(app);
    const {
      id,
      fotos: [primeira, segunda],
    } = await criarPrestador(app, ana.headers, {
      fotos: [PNG, PNG],
    });
    const url = `/prestadores/${id}`;

    const deOutro = await app.inject({
      method: 'PATCH',
      url,
      headers: bia.headers,
      payload: { nome: 'Invasor' },
    });
    expect(deOutro.statusCode).toBe(403);

    const alterado = await app.inject({
      method: 'PATCH',
      url,
      headers: ana.headers,
      payload: { fotos: [segunda, PNG], bairro: 'Urca', posicao: MEIO },
    });
    expect(alterado.statusCode, alterado.body).toBe(200);
    const novas = alterado.json().fotos;
    expect(novas).toHaveLength(2);
    expect(novas[0]).toBe(segunda);
    expect(alterado.json()).toMatchObject({ bairro: 'Urca', posicao: MEIO });
    expect((await app.inject({ url: primeira! })).statusCode).toBe(404);

    expect((await app.inject({ method: 'DELETE', url, headers: ana.headers })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ url, headers: ana.headers })).statusCode).toBe(404);
    expect(await app.banco.select().from(fotos)).toEqual([]);
  });
});

describe('contratações', () => {
  /** Ana oferece o serviço; Bia contrata. */
  async function cenario(tipo = 'passeador') {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app, { tutor: 'Ana' });
    const bia = await cadastrar(app, { tutor: 'Bia', pet: 'Thor' });
    const prestador = await criarPrestador(app, ana.headers, { tipo });
    return { app, ana, bia, prestador };
  }

  it('o cliente pede e as duas partes enxergam o pedido', async () => {
    const { app, ana, bia, prestador } = await cenario();
    const inicio = daquiHoras(24);

    const r = await pedir(app, bia.headers, prestador.id, { inicio, mensagem: 'Ele puxa' });
    expect(r.statusCode, r.body).toBe(201);
    const pedido = r.json();
    expect(pedido).toEqual({
      id: expect.any(Number),
      status: 'pendente',
      inicio,
      fim: null,
      contato: '(21) 97777-0000',
      mensagem: 'Ele puxa',
      criadoEm: expect.any(String),
      iniciadoEm: null,
      finalizadoEm: null,
      papel: 'cliente',
      cliente: { nome: 'Bia', foto: null },
      prestador: {
        id: prestador.id,
        tipo: 'passeador',
        nome: 'Ana Passeios',
        contato: '(21) 98888-0000',
        foto: null,
      },
      pets: [
        { id: expect.any(Number), nome: 'Thor', foto: null, especie: 'cachorro', porte: 'medio' },
      ],
      avaliacao: null,
    });

    const recebidos = await app.inject({
      url: '/contratacoes?papel=prestador',
      headers: ana.headers,
    });
    expect(recebidos.json()).toEqual([{ ...pedido, papel: 'prestador' }]);
    const feitos = await app.inject({ url: '/contratacoes', headers: bia.headers });
    expect(feitos.json().map((c: { id: number }) => c.id)).toEqual([pedido.id]);
    expect((await app.inject({ url: '/contratacoes', headers: ana.headers })).json()).toEqual([]);

    // Quem não participa não enxerga.
    const caio = await cadastrar(app);
    const alheio = await app.inject({ url: `/contratacoes/${pedido.id}`, headers: caio.headers });
    expect(alheio.statusCode).toBe(404);
  });

  it('recusa pedidos inválidos', async () => {
    const { app, ana, bia, prestador } = await cenario();

    const proprio = await pedir(app, ana.headers, prestador.id);
    expect(proprio.statusCode).toBe(400);
    expect(proprio.json().mensagem).toContain('próprio serviço');

    const petAlheio = await pedir(app, bia.headers, prestador.id, {
      petIds: [await petDe(app, ana.headers)],
    });
    expect(petAlheio.json().campos).toEqual({ petIds: 'Escolha pets do seu perfil' });

    const passado = await pedir(app, bia.headers, prestador.id, { inicio: daquiHoras(-2) });
    expect(passado.json().campos).toHaveProperty('inicio');

    expect((await pedir(app, bia.headers, 999)).statusCode).toBe(404);

    await app.inject({
      method: 'PATCH',
      url: `/prestadores/${prestador.id}`,
      headers: ana.headers,
      payload: { ativo: false },
    });
    const pausado = await pedir(app, bia.headers, prestador.id);
    expect(pausado.json().mensagem).toContain('pausado');
  });

  it('a hospedagem exige o fim, depois do início', async () => {
    const { app, bia, prestador } = await cenario('anfitriao');

    const semFim = await pedir(app, bia.headers, prestador.id);
    expect(semFim.json().campos).toEqual({ fim: 'Informe até quando é a hospedagem' });

    const invertido = await pedir(app, bia.headers, prestador.id, {
      inicio: daquiHoras(48),
      fim: daquiHoras(24),
    });
    expect(invertido.json().campos).toEqual({ fim: 'O fim deve ser depois do início' });

    const fim = daquiHoras(72);
    const ok = await pedir(app, bia.headers, prestador.id, { fim });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().fim).toBe(fim);
  });

  it('segue o fluxo: o prestador aceita e conclui, e só então o cliente avalia', async () => {
    const { app, ana, bia, prestador } = await cenario('petshop');
    // Começou há um minuto (dentro da tolerância), para já poder concluir.
    const { id } = (
      await pedir(app, bia.headers, prestador.id, { inicio: daquiHoras(-1 / 60) })
    ).json();
    const avaliar = (headers: Headers, nota: number, comentario = '') =>
      app.inject({
        method: 'PUT',
        url: `/contratacoes/${id}/avaliacao`,
        headers,
        payload: { nota, comentario },
      });

    expect((await mudarStatus(app, bia.headers, id, 'aceita')).statusCode).toBe(403);
    expect((await mudarStatus(app, ana.headers, id, 'concluida')).statusCode).toBe(409);
    expect((await avaliar(bia.headers, 5)).statusCode).toBe(409);

    const aceita = await mudarStatus(app, ana.headers, id, 'aceita');
    expect(aceita.json()).toMatchObject({ status: 'aceita', papel: 'prestador' });
    expect((await mudarStatus(app, bia.headers, id, 'concluida')).statusCode).toBe(403);
    expect((await mudarStatus(app, ana.headers, id, 'concluida')).json().status).toBe('concluida');

    expect((await avaliar(ana.headers, 5)).statusCode).toBe(403);
    expect((await avaliar(bia.headers, 6)).statusCode).toBe(400);
    const avaliada = await avaliar(bia.headers, 4, '  Pontual ');
    expect(avaliada.statusCode, avaliada.body).toBe(200);
    expect(avaliada.json().avaliacao).toEqual({ nota: 4, comentario: 'Pontual' });

    // Avaliar de novo substitui.
    await avaliar(bia.headers, 5, 'Excelente');
    const perfil = await app.inject({ url: `/prestadores/${prestador.id}`, headers: bia.headers });
    expect(perfil.json()).toMatchObject({ notaMedia: 5, totalAvaliacoes: 1 });
    const lista = await app.inject({
      url: `/prestadores/${prestador.id}/avaliacoes`,
      headers: bia.headers,
    });
    expect(lista.json()).toEqual([
      {
        nota: 5,
        comentario: 'Excelente',
        data: expect.any(String),
        cliente: 'Bia',
        fotoCliente: null,
      },
    ]);

    // Concluído é final.
    expect((await mudarStatus(app, bia.headers, id, 'cancelada')).statusCode).toBe(409);
  });

  it('não deixa concluir antes do início; recusa e cancelamento são finais', async () => {
    const { app, ana, bia, prestador } = await cenario('petshop');
    const pedido = async () => (await pedir(app, bia.headers, prestador.id)).json().id as number;

    const futuro = await pedido();
    await mudarStatus(app, ana.headers, futuro, 'aceita');
    const cedo = await mudarStatus(app, ana.headers, futuro, 'concluida');
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().mensagem).toContain('depois que o serviço começar');
    expect((await mudarStatus(app, bia.headers, futuro, 'cancelada')).json().status).toBe(
      'cancelada',
    );

    const recusado = await pedido();
    expect((await mudarStatus(app, ana.headers, recusado, 'recusada')).json().status).toBe(
      'recusada',
    );
    const reaberto = await mudarStatus(app, ana.headers, recusado, 'aceita');
    expect(reaberto.statusCode).toBe(409);
    expect(reaberto.json().mensagem).toBe('Este pedido está recusado e não pode mudar para aceito');
  });

  it('a média junta as avaliações de clientes diferentes', async () => {
    const { app, ana, bia, prestador } = await cenario('petshop');
    const caio = await cadastrar(app, { tutor: 'Caio' });

    for (const [cliente, nota] of [
      [bia, 5],
      [caio, 2],
    ] as const) {
      const { id } = (
        await pedir(app, cliente.headers, prestador.id, { inicio: daquiHoras(-1 / 60) })
      ).json();
      await mudarStatus(app, ana.headers, id, 'aceita');
      await mudarStatus(app, ana.headers, id, 'concluida');
      await app.inject({
        method: 'PUT',
        url: `/contratacoes/${id}/avaliacao`,
        headers: cliente.headers,
        payload: { nota },
      });
    }

    const r = await app.inject({ url: buscar('&tipo=petshop'), headers: bia.headers });
    expect(r.json()[0]).toMatchObject({ notaMedia: 3.5, totalAvaliacoes: 2 });
  });
});

describe('passeio ao vivo', () => {
  /** Ana é passeadora e já aceitou o pedido de Bia, marcado para daqui a uma hora. */
  async function passeioAceito(tipo = 'passeador') {
    const { app } = await criarAppTeste();
    const ana = await cadastrar(app, { tutor: 'Ana' });
    const bia = await cadastrar(app, { tutor: 'Bia' });
    const prestador = await criarPrestador(app, ana.headers, { tipo });
    const { id } = (await pedir(app, bia.headers, prestador.id, { inicio: daquiHoras(1) })).json();
    await mudarStatus(app, ana.headers, id, 'aceita');
    return { app, ana, bia, id };
  }

  const enviarPontos = (app: App, headers: Headers, id: number, pontos: unknown) =>
    app.inject({
      method: 'POST',
      url: `/contratacoes/${id}/posicoes`,
      headers,
      payload: { pontos },
    });

  const acompanhar = (app: App, headers: Headers, id: number, desde?: number) =>
    app.inject({
      url: `/contratacoes/${id}/acompanhamento${desde === undefined ? '' : `?desde=${desde}`}`,
      headers,
    });

  it('o passeador inicia, envia o trajeto e o tutor acompanha só os pontos novos', async () => {
    const { app, ana, bia, id } = await passeioAceito();

    // Antes de iniciar, não recebe posição.
    expect((await enviarPontos(app, ana.headers, id, [PERTO])).statusCode).toBe(409);

    const iniciado = await mudarStatus(app, ana.headers, id, 'em_andamento');
    expect(iniciado.json()).toMatchObject({
      status: 'em_andamento',
      iniciadoEm: expect.any(String),
      finalizadoEm: null,
    });

    expect((await enviarPontos(app, ana.headers, id, [CENTRO, PERTO])).statusCode).toBe(204);
    expect((await enviarPontos(app, bia.headers, id, [MEIO])).statusCode).toBe(403);

    const primeira = (await acompanhar(app, bia.headers, id)).json();
    expect(primeira).toMatchObject({
      status: 'em_andamento',
      totalPontos: 2,
      pontos: [CENTRO, PERTO],
      posicaoEm: expect.any(String),
      duracaoMin: 0,
    });
    expect(primeira.distanciaKm).toBeCloseTo(1.112, 2);

    await enviarPontos(app, ana.headers, id, [MEIO]);
    const segunda = (await acompanhar(app, bia.headers, id, primeira.totalPontos)).json();
    expect(segunda).toMatchObject({ totalPontos: 3, pontos: [MEIO] });
    expect(segunda.distanciaKm).toBeCloseTo(5.56, 1);

    // Quem não participa não acompanha.
    const caio = await cadastrar(app);
    expect((await acompanhar(app, caio.headers, id)).statusCode).toBe(404);
  });

  it('o passeio só termina depois de iniciado, e o trajeto fica para depois', async () => {
    const { app, ana, bia, id } = await passeioAceito();

    const direto = await mudarStatus(app, ana.headers, id, 'concluida');
    expect(direto.statusCode).toBe(409);
    expect(direto.json().mensagem).toBe('Inicie o passeio quando pegar o pet');
    expect((await mudarStatus(app, bia.headers, id, 'em_andamento')).statusCode).toBe(403);

    await mudarStatus(app, ana.headers, id, 'em_andamento');
    await enviarPontos(app, ana.headers, id, [CENTRO, PERTO]);
    // Em andamento ninguém cancela: o pet está com o passeador.
    expect((await mudarStatus(app, bia.headers, id, 'cancelada')).statusCode).toBe(409);

    const fim = await mudarStatus(app, ana.headers, id, 'concluida');
    expect(fim.json()).toMatchObject({ status: 'concluida', finalizadoEm: expect.any(String) });
    expect((await enviarPontos(app, ana.headers, id, [MEIO])).statusCode).toBe(409);

    const depois = (await acompanhar(app, bia.headers, id)).json();
    expect(depois).toMatchObject({ status: 'concluida', totalPontos: 2 });

    // Concluído pelo caminho certo, o tutor avalia normalmente.
    const avaliada = await app.inject({
      method: 'PUT',
      url: `/contratacoes/${id}/avaliacao`,
      headers: bia.headers,
      payload: { nota: 5 },
    });
    expect(avaliada.statusCode).toBe(200);
  });

  it('valida os pontos e só vale para passeio, perto do horário marcado', async () => {
    const { app, ana, id } = await passeioAceito();
    await mudarStatus(app, ana.headers, id, 'em_andamento');

    expect((await enviarPontos(app, ana.headers, id, [])).statusCode).toBe(400);
    expect((await enviarPontos(app, ana.headers, id, [[91, 0]])).statusCode).toBe(400);
    expect((await enviarPontos(app, ana.headers, id, Array(201).fill(PERTO))).statusCode).toBe(400);

    const petshop = await passeioAceito('petshop');
    const naoPasseio = await mudarStatus(
      petshop.app,
      petshop.ana.headers,
      petshop.id,
      'em_andamento',
    );
    expect(naoPasseio.statusCode).toBe(409);

    const cedo = await criarAppTeste();
    const ana2 = await cadastrar(cedo.app);
    const bia2 = await cadastrar(cedo.app);
    const p = await criarPrestador(cedo.app, ana2.headers);
    const pedido = (await pedir(cedo.app, bia2.headers, p.id, { inicio: daquiHoras(5) })).json();
    await mudarStatus(cedo.app, ana2.headers, pedido.id, 'aceita');
    const antes = await mudarStatus(cedo.app, ana2.headers, pedido.id, 'em_andamento');
    expect(antes.json().mensagem).toBe('Ainda falta muito para o horário do passeio');
  });
});
