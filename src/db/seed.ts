import { sql } from 'drizzle-orm';
import { carregarConfig } from '../config.js';
import { distanciaTrajeto } from '../geo.js';
import { gerarHashSenha } from '../modulos/auth/senha.js';
import { abrirBanco } from './cliente.js';
import {
  curtidas,
  encontros,
  favoritas,
  passeios,
  pets,
  presencas,
  rotas,
  usuarios,
  type LatLng,
} from './schema.js';

/**
 * Popula o banco com os mesmos dados de exemplo do front (Rio de Janeiro).
 *   npm run db:seed            -> só roda com o banco vazio
 *   npm run db:seed -- --reset -> apaga tudo antes
 * Todos os tutores entram com a senha "segredo123".
 */

// Trajetos a pé gerados com o roteador gratuito do OpenStreetMap (routing.openstreetmap.de).
const ORLA_BOTAFOGO: LatLng[] = [
  [-22.93854, -43.17603],
  [-22.93927, -43.1747],
  [-22.93947, -43.17449],
  [-22.94115, -43.17648],
  [-22.94135, -43.17677],
  [-22.94197, -43.17754],
  [-22.94194, -43.17784],
  [-22.94256, -43.17953],
  [-22.94316, -43.18036],
  [-22.9435, -43.18079],
  [-22.9434, -43.18071],
  [-22.9437, -43.18053],
  [-22.94382, -43.18077],
  [-22.94453, -43.18124],
  [-22.94518, -43.18151],
  [-22.94584, -43.18166],
  [-22.94672, -43.18168],
  [-22.94754, -43.18154],
  [-22.94767, -43.18149],
  [-22.94693, -43.18167],
  [-22.94613, -43.18169],
  [-22.9454, -43.18157],
  [-22.94472, -43.18133],
  [-22.94405, -43.18094],
  [-22.94372, -43.18057],
  [-22.94361, -43.18045],
  [-22.94349, -43.18081],
  [-22.94337, -43.18058],
  [-22.9427, -43.17977],
  [-22.942, -43.17812],
  [-22.94205, -43.17761],
  [-22.94185, -43.17738],
  [-22.94118, -43.17652],
  [-22.93999, -43.17508],
  [-22.9393, -43.17467],
  [-22.93891, -43.17537],
  [-22.93854, -43.17603],
];

const PARQUE_GUINLE: LatLng[] = [
  [-22.93599, -43.18588],
  [-22.93643, -43.18538],
  [-22.9365, -43.18539],
  [-22.93655, -43.18544],
  [-22.9368, -43.18589],
  [-22.9374, -43.18711],
  [-22.93746, -43.18714],
  [-22.93837, -43.18776],
  [-22.93868, -43.18798],
  [-22.93894, -43.18819],
  [-22.93912, -43.18833],
  [-22.93929, -43.18847],
  [-22.93912, -43.18833],
  [-22.93894, -43.18819],
  [-22.93868, -43.18798],
  [-22.93837, -43.18776],
  [-22.93746, -43.18714],
  [-22.9374, -43.18711],
  [-22.9368, -43.18589],
  [-22.93658, -43.18547],
  [-22.93653, -43.18542],
  [-22.93644, -43.18535],
  [-22.93642, -43.1854],
  [-22.93599, -43.18588],
];

const PRACA_FLAMENGO: LatLng[] = [
  [-22.9306, -43.1788],
  [-22.93074, -43.17879],
  [-22.9308, -43.17884],
  [-22.93088, -43.17884],
  [-22.93098, -43.17916],
  [-22.93114, -43.17912],
  [-22.93124, -43.1792],
  [-22.93135, -43.17922],
  [-22.93142, -43.17929],
  [-22.93154, -43.17933],
  [-22.93245, -43.17898],
  [-22.93288, -43.17888],
  [-22.93273, -43.17778],
  [-22.93262, -43.17765],
  [-22.93247, -43.17755],
  [-22.93229, -43.17756],
  [-22.9318, -43.17759],
  [-22.93148, -43.17762],
  [-22.93131, -43.17756],
  [-22.93133, -43.17744],
  [-22.93115, -43.17666],
  [-22.93074, -43.17672],
  [-22.93076, -43.17688],
  [-22.93055, -43.17675],
  [-22.93046, -43.17679],
  [-22.93044, -43.17686],
  [-22.93049, -43.17748],
  [-22.93053, -43.17759],
  [-22.93065, -43.17766],
  [-22.9307, -43.17828],
  [-22.9308, -43.17857],
  [-22.93073, -43.17863],
  [-22.93071, -43.17871],
  [-22.9306, -43.1788],
];

const ATERRO: LatLng[] = [
  [-22.92039, -43.17271],
  [-22.92042, -43.17259],
  [-22.92056, -43.17247],
  [-22.92086, -43.17234],
  [-22.92108, -43.17211],
  [-22.92108, -43.1719],
  [-22.92112, -43.17176],
  [-22.92132, -43.17173],
  [-22.92147, -43.17166],
  [-22.92192, -43.17135],
  [-22.92166, -43.17065],
  [-22.92243, -43.17056],
  [-22.92274, -43.17056],
  [-22.92286, -43.17045],
  [-22.92294, -43.17016],
  [-22.92302, -43.17006],
  [-22.92326, -43.1701],
  [-22.92329, -43.16996],
  [-22.92337, -43.16986],
  [-22.92373, -43.1698],
  [-22.92388, -43.16964],
  [-22.92469, -43.16966],
  [-22.92659, -43.17045],
  [-22.92838, -43.17117],
  [-22.92961, -43.17166],
  [-22.93081, -43.17197],
  [-22.93185, -43.17211],
  [-22.93271, -43.17211],
  [-22.93376, -43.17201],
  [-22.93432, -43.17187],
  [-22.93465, -43.17175],
  [-22.93504, -43.17147],
  [-22.93534, -43.17112],
  [-22.9357, -43.17133],
  [-22.93585, -43.17105],
  [-22.93635, -43.17066],
  [-22.93682, -43.17041],
  [-22.93693, -43.17053],
  [-22.93708, -43.17069],
  [-22.93727, -43.17118],
  [-22.93672, -43.17197],
];

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

/** Data relativa a agora, para os exemplos parecerem sempre recentes. */
function emRelacaoAAgora(ms: number, hora?: number, minuto = 0): Date {
  const data = new Date(Date.now() + ms);
  if (hora !== undefined) data.setHours(hora, minuto, 0, 0);
  return data;
}

type Usuario = typeof usuarios.$inferSelect;
type Rota = typeof rotas.$inferSelect;

const TUTORES = [
  {
    email: 'ana@exemplo.com',
    tutor: 'Ana',
    pet: 'Mel',
    especie: 'cachorro',
    porte: 'pequeno',
    raca: 'Shih-tzu',
    idadeAnos: 3,
    bio: 'Coleciona gravetos maiores que ela.',
  },
  {
    email: 'rafael@exemplo.com',
    tutor: 'Rafael',
    pet: 'Thor',
    especie: 'cachorro',
    porte: 'grande',
    raca: 'Labrador',
    idadeAnos: 2,
    bio: 'Aprendendo a não puxar a guia.',
  },
  {
    email: 'julia@exemplo.com',
    tutor: 'Júlia',
    pet: 'Pipoca',
    especie: 'cachorro',
    porte: 'pequeno',
    raca: 'Beagle',
    idadeAnos: 1,
    bio: 'Faz amizade com todo mundo no caminho.',
  },
  {
    email: 'tutor@exemplo.com',
    tutor: 'Jeff',
    pet: 'Bolota',
    especie: 'cachorro',
    porte: 'medio',
    raca: 'Vira-lata caramelo',
    idadeAnos: 4,
    bio: 'Especialista em cheirar postes e fazer amizade com qualquer um que tenha petisco.',
  },
] as const;

const config = carregarConfig();
const banco = abrirBanco(config.urlBanco);
const resetar = process.argv.includes('--reset');

const [algum] = await banco.select({ id: usuarios.id }).from(usuarios).limit(1);
if (!resetar && algum) {
  console.error(
    'O banco já tem dados. Use "npm run db:seed -- --reset" para apagar e popular de novo.',
  );
  await banco.$client.end();
  process.exit(1);
}

const senhaHash = await gerarHashSenha('segredo123');

await banco.transaction(async (tx) => {
  if (resetar) {
    // Apagar os usuários leva todo o resto junto (CASCADE); os ids voltam a começar do 1.
    await tx.execute(sql`truncate ${usuarios} restart identity cascade`);
  }

  const criados: Usuario[] = [];
  for (const { email, tutor, pet, ...doPet } of TUTORES) {
    const [u] = await tx.insert(usuarios).values({ email, tutor, senhaHash }).returning();
    await tx.insert(pets).values({ usuarioId: u!.id, nome: pet, ...doPet });
    criados.push(u!);
  }
  const [ana, rafael, julia, jeff] = criados as [Usuario, Usuario, Usuario, Usuario];
  await tx.insert(pets).values({
    usuarioId: jeff.id,
    nome: 'Nina',
    especie: 'gato',
    porte: 'pequeno',
    raca: 'Siamês',
    idadeAnos: 6,
    bio: 'Não passeia, mas fiscaliza o Bolota da janela.',
  });

  const novaRota = async (
    autor: Usuario,
    nome: string,
    bairro: string,
    descricao: string,
    pontos: LatLng[],
    duracaoMin: number,
  ) => {
    const [rota] = await tx
      .insert(rotas)
      .values({
        autorId: autor.id,
        nome,
        bairro,
        descricao,
        pontos,
        duracaoMin,
        distanciaKm: distanciaTrajeto(pontos),
      })
      .returning();
    return rota!;
  };

  const orla = await novaRota(
    ana,
    'Volta da orla',
    'Botafogo',
    'Plana, com vista para o Pão de Açúcar. Leve água: tem pouca sombra.',
    ORLA_BOTAFOGO,
    45,
  );
  const guinle = await novaRota(
    rafael,
    'Trilha das sombras',
    'Laranjeiras',
    'Circuito arborizado no Parque Guinle, ótimo para os dias quentes.',
    PARQUE_GUINLE,
    25,
  );
  const praca = await novaRota(
    julia,
    'Circuito da praça',
    'Flamengo',
    'Voltinha rápida para o xixi da manhã, com bebedouro para pets.',
    PRACA_FLAMENGO,
    15,
  );
  const aterro = await novaRota(
    jeff,
    'Reta do Aterro',
    'Flamengo',
    'Trecho longo e gramado, bom para cães com muita energia.',
    ATERRO,
    40,
  );

  const favoritos: [Rota, Usuario][] = [
    [orla, ana],
    [guinle, rafael],
    [praca, julia],
    [aterro, jeff],
    [orla, jeff],
    [guinle, jeff],
    [praca, jeff],
    [orla, rafael],
    [guinle, julia],
  ];
  for (const [rota, u] of favoritos) {
    await tx.insert(favoritas).values({ rotaId: rota.id, usuarioId: u.id });
  }

  const novoEncontro = async (
    organizador: Usuario,
    titulo: string,
    descricao: string,
    local: string,
    [latitude, longitude]: LatLng,
    data: Date,
    confirmados: Usuario[],
  ) => {
    const [e] = await tx
      .insert(encontros)
      .values({
        organizadorId: organizador.id,
        titulo,
        descricao,
        local,
        latitude,
        longitude,
        data,
      })
      .returning();
    for (const u of confirmados) {
      await tx.insert(presencas).values({ encontroId: e!.id, usuarioId: u.id });
    }
  };

  await novoEncontro(
    ana,
    'Rolê dos vira-latas',
    'Encontro mensal dos SRDs da região. Traga petiscos para dividir!',
    'Parque do Flamengo',
    [-22.9276, -43.1719],
    emRelacaoAAgora(3 * DIA, 8, 30),
    [ana, rafael, julia, jeff],
  );
  await novoEncontro(
    rafael,
    'Corrida leve com a turma',
    'Volta completa na Lagoa em ritmo tranquilo. Ideal para cães de porte médio e grande.',
    'Parque dos Patins, Lagoa',
    [-22.9712, -43.2166],
    emRelacaoAAgora(4 * DIA, 7),
    [rafael, ana],
  );
  await novoEncontro(
    julia,
    'Socialização de filhotes',
    'Espaço seguro para filhotes com as vacinas em dia aprenderem a brincar.',
    'Praça São Salvador',
    [-22.934, -43.1803],
    emRelacaoAAgora(7 * DIA, 17, 30),
    [julia],
  );

  const novoPasseio = async (
    autor: Usuario,
    rota: Rota,
    duracaoMin: number,
    texto: string,
    data: Date,
    curtiram: Usuario[],
  ) => {
    const [p] = await tx
      .insert(passeios)
      .values({
        usuarioId: autor.id,
        rotaId: rota.id,
        rotaNome: rota.nome,
        pontos: rota.pontos,
        distanciaKm: rota.distanciaKm,
        duracaoMin,
        texto,
        data,
      })
      .returning();
    for (const u of curtiram) {
      await tx.insert(curtidas).values({ passeioId: p!.id, usuarioId: u.id });
    }
  };

  await novoPasseio(
    ana,
    orla,
    48,
    'Achou um graveto do tamanho dela e não largou até em casa.',
    emRelacaoAAgora(-20 * MINUTO),
    [rafael, julia],
  );
  await novoPasseio(
    rafael,
    guinle,
    27,
    'Primeiro passeio sem puxar a guia. Orgulho define!',
    emRelacaoAAgora(-60 * MINUTO),
    [ana, julia, jeff],
  );
  await novoPasseio(
    julia,
    praca,
    16,
    'Fez três amigos novos e cheirou todos os postes do caminho.',
    emRelacaoAAgora(-3 * 60 * MINUTO),
    [ana],
  );
  await novoPasseio(
    jeff,
    aterro,
    42,
    'Correu atrás de todos os pombos do Aterro. Nenhum foi pego.',
    emRelacaoAAgora(-DIA),
    [ana, rafael],
  );
  await novoPasseio(
    jeff,
    orla,
    50,
    'Dia de sol na orla e muita água no bebedouro.',
    emRelacaoAAgora(-3 * DIA),
    [julia],
  );
});

console.log(
  'Banco populado. Entre com tutor@exemplo.com / segredo123 (ou ana@, rafael@, julia@exemplo.com).',
);
await banco.$client.end();
