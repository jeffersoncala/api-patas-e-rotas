# Patas & Rotas — API

Backend do Patas & Rotas, uma rede social para pets marcarem encontros e registrarem passeios.
Substitui a API Java anterior (`pataserotas-api`) e mantém o mesmo contrato de login.

**Stack:** Node.js 24 · TypeScript 7 · Fastify 5 · Zod 4 · Drizzle ORM · PostgreSQL (Supabase) · jose (JWT) · Vitest 5

## Como rodar

Requisitos: Node.js 24. O Postgres local vem pelo npm (PGlite); não precisa instalar nada.

```bash
npm install
cp .env.example .env        # com DATABASE_URL vazio, usa o Postgres local
npm run db:local            # em outro terminal: Postgres local na porta 5432 (deixe rodando)
npm run db:migrate          # cria as tabelas
npm run db:seed             # opcional: cria os dados de exemplo do front
npm run dev                 # http://localhost:3000  ·  documentação em /docs
```

Sem `DATABASE_URL`, o desenvolvimento usa `postgres://postgres:postgres@localhost:5432/pataserotas`,
que é o banco do `npm run db:local` (os dados ficam em `.pglite/`; apague a pasta para zerar).
As migrações **não** rodam sozinhas ao subir a API: localmente, rode `npm run db:migrate` sempre que
o schema mudar (na Vercel elas rodam no build de produção).
Os testes não precisam de banco nenhum: usam PGlite (Postgres em memória).

Contas do seed (senha `segredo123`): `tutor@exemplo.com` (Jeff e Bolota), `ana@exemplo.com`,
`rafael@exemplo.com`, `julia@exemplo.com`.

## Scripts

| Comando                       | O que faz                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                 | Sobe em modo watch, com log colorido                             |
| `npm run build` / `npm start` | Compila para `dist/` e roda a versão compilada                   |
| `npm test`                    | Testes (cada teste usa um Postgres em memória, PGlite, isolado)  |
| `npm run typecheck`           | Checagem de tipos sem gerar arquivos                             |
| `npm run db:generate`         | Gera uma migração nova a partir de `src/db/schema.ts`            |
| `npm run db:local`            | Postgres local (PGlite) em `localhost:5432`, dados em `.pglite/` |
| `npm run db:migrate`          | Aplica as migrações pendentes no banco do `DATABASE_URL`         |
| `npm run db:seed`             | Popula com os dados de exemplo (`-- --reset` apaga tudo antes)   |

## Deploy (Vercel + Supabase)

A API roda como uma função serverless (`api/index.js` → `src/vercel.ts`); o `vercel.json` manda
todas as rotas para ela.

1. No Supabase, copie a connection string do **Transaction pooler** (porta 6543) em
   _Project Settings → Database_.
2. Na Vercel, em _Settings → Environment Variables_, defina `NODE_ENV=production`,
   `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` (URL do front) e `FRONT_URL`.
3. As migrações rodam sozinhas no build dos deploys de **produção** (`VERCEL_ENV=production`,
   veja o `buildCommand` do `vercel.json`). Se uma falhar, o deploy falha e a versão anterior
   continua no ar. Deploys de preview não mexem no banco.

Todas as tabelas têm RLS ligado e nenhuma política: a Data API do Supabase (anon key) não
enxerga nada, e a API, que conecta como dona das tabelas, não é afetada.

## Endpoints

A documentação interativa (OpenAPI/Swagger) fica em **`/docs`**, gerada a partir dos mesmos
schemas Zod que validam as requisições. Resumo:

| Método e caminho                        | Descrição                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /auth/cadastro`                   | Cria a conta do tutor (foto opcional em `fotoTutor`) e já devolve os tokens                         |
| `POST /auth/login`                      | `{ email, password }` → `{ accessToken, tokenType, expiresEm, refreshToken, usuario }`              |
| `POST /auth/refresh`                    | Troca o refresh token por um par novo (o antigo deixa de valer)                                     |
| `GET /auth/me`                          | Usuário do token                                                                                    |
| `POST /auth/logout`                     | Encerra a sessão (204)                                                                              |
| `POST /auth/recuperar-senha`            | Envia o link de redefinição (sempre 202)                                                            |
| `POST /auth/redefinir-senha`            | `{ token, password }` → troca a senha e derruba todas as sessões                                    |
| `GET / PATCH / DELETE /perfil`          | Tutor (nome, foto, meta semanal) e pets; `DELETE` apaga a conta e tudo dela                         |
| `PUT / DELETE /perfil/foto`             | Troca (`{ imagem: <data URL> }`) ou remove a foto do tutor                                          |
| `POST /perfil/pets`                     | Adiciona um pet (até 10 por tutor)                                                                  |
| `PATCH / DELETE /perfil/pets/:petId`    | Altera ou remove um pet                                                                             |
| `PUT / DELETE /perfil/pets/:petId/foto` | Troca ou remove a foto de um pet                                                                    |
| `GET /fotos/:id`                        | A imagem em si, pública e com cache imutável (para usar direto em `<img>`)                          |
| `GET /perfil/resumo`                    | km da semana, total, passeios e encontros confirmados                                               |
| `GET /encontros` · `POST /encontros`    | Lista (`?filtro=todos\|vou&periodo=futuros\|todos`) e cria                                          |
| `GET / PATCH / DELETE /encontros/:id`   | Detalhe; alterar e apagar só o organizador                                                          |
| `PUT / DELETE /encontros/:id/presenca`  | Confirma ou cancela presença                                                                        |
| `GET /rotas` · `POST /rotas`            | Lista (`?filtro=todas\|favoritas`) e cria                                                           |
| `GET / PATCH / DELETE /rotas/:id`       | Detalhe; alterar e apagar só o autor                                                                |
| `PUT / DELETE /rotas/:id/favorita`      | Favorita ou desfavorita                                                                             |
| `GET /rotas/:id/passeios`               | Passeios feitos na rota                                                                             |
| `GET /passeios` · `POST /passeios`      | Feed paginado (`?autor=todos\|eu&limite=&antesDe=`) e registro (`petIds` e até 4 `fotos` opcionais) |
| `GET / PATCH / DELETE /passeios/:id`    | Detalhe; alterar (texto, duração, `fotos`) e apagar só o autor                                      |
| `PUT / DELETE /passeios/:id/curtida`    | Curte ou descurte                                                                                   |
| `GET /prestadores`                      | Serviços ativos no raio (`?lat=&lng=&raioKm=&tipo=passeador\|anfitriao\|petshop`)                   |
| `GET /prestadores/meus`                 | Serviços que o usuário oferece, inclusive os pausados                                               |
| `POST /prestadores`                     | Oferece um serviço (um de cada tipo por usuário), com preços e até 6 `fotos`                        |
| `GET / PATCH / DELETE /prestadores/:id` | Detalhe; alterar (inclusive `ativo` e `fotos`) e apagar só quem cadastrou                           |
| `GET /prestadores/:id/avaliacoes`       | Avaliações, das mais novas para as mais antigas                                                     |
| `GET /contratacoes` · `POST`            | Pedidos feitos (`?papel=cliente`) ou recebidos (`?papel=prestador`); pedir um serviço               |
| `GET /contratacoes/:id`                 | Detalhe (só o cliente e o prestador enxergam)                                                       |
| `PUT /contratacoes/:id/status`          | `aceita`, `recusada`, `concluida` (prestador) ou `cancelada` (qualquer das partes)                  |
| `PUT /contratacoes/:id/avaliacao`       | `{ nota: 1-5, comentario }`, só o cliente e só depois de concluída; de novo substitui               |

Tudo, fora cadastro, login, refresh e recuperação de senha, exige
`Authorization: Bearer <accessToken>`. Os formatos de `Encontro`, `Rota`, `Passeio` e `Perfil`
seguem as interfaces de `pataserotas-front/src/app/core/models.ts`.

### Erros

Mesmo corpo da API Java, para o front não precisar tratar dois formatos:

```json
{
  "timestamp": "2026-09-30T12:00:00.000Z",
  "status": 400,
  "erro": "Bad Request",
  "mensagem": "Dados inválidos",
  "campos": { "email": "Formato do endereço de e-mail inválido" }
}
```

| Status | Quando                                                                        |
| ------ | ----------------------------------------------------------------------------- |
| 400    | Corpo, query ou parâmetro inválido (`campos` diz qual)                        |
| 401    | Sem token, token inválido/expirado, sessão encerrada, e-mail ou senha errados |
| 403    | Alterar algo que é de outro usuário                                           |
| 404    | Recurso ou rota inexistente                                                   |
| 409    | E-mail já cadastrado                                                          |
| 429    | Muitas tentativas (login, cadastro, recuperação de senha)                     |

## Decisões

- **PostgreSQL no Supabase**, via `postgres.js` no pooler de transações (sem prepared
  statements), que aguenta as muitas conexões curtas das funções serverless.
- **Sessões no banco.** O access token (JWT HS256, 1 h) leva o id da sessão, e cada requisição
  confere se ela está ativa. Por isso o logout e a troca de senha valem **na hora**. Na API Java o
  token revogado continuava aceito até expirar.
- **Refresh token opaco e rotativo**, guardado só como hash (SHA-256). Cada uso gera um novo.
- **Senhas com scrypt** (`node:crypto`, N=2^16, r=8), sem dependência nativa extra.
- **Distâncias sempre calculadas no servidor** a partir dos pontos do trajeto.
- **Fotos no próprio Postgres** (tabela `fotos`, em base64), para não depender de outro serviço.
  O front reduz a imagem para 512 px antes de enviar; a API aceita JPEG, PNG e WebP de até
  1,5 MB e confere os primeiros bytes do arquivo. Toda mudança no perfil devolve o perfil inteiro.
- **Serviços sem pagamento no app.** O pedido segue `pendente → aceita → concluida` (ou
  `recusada`/`cancelada`), e o pagamento é combinado direto entre as partes. A avaliação é
  amarrada à contratação concluída: só avalia quem contratou, uma vez por serviço.
- **Sem vazamento de conta:** login de e-mail inexistente leva o mesmo tempo, e a recuperação de
  senha responde igual exista a conta ou não.

## Diferenças em relação à API Java

- O login não depende do Supabase: não há confirmação de e-mail e os usuários do Supabase
  **não** foram migrados (quem tinha conta lá precisa se cadastrar de novo).
- O campo `usuario` ganhou `tutor`; `role` segue `"authenticated"` para manter o formato.
- `/auth/cadastro`, `/auth/recuperar-senha`, `/auth/redefinir-senha` e todo o domínio (perfil,
  encontros, rotas, passeios) são novos.

## Pendências

- **Rate limit:** fica na memória de cada instância da função, então na Vercel ele é só um freio
  parcial. Para valer de verdade, guardar os contadores num store compartilhado (ex.: Redis).

- **E-mail:** o link de redefinição de senha só vai para o log do servidor (`src/email.ts`).
  Antes de produção, ligar um provedor (SMTP, Resend, SES...).
- **`npm audit`:** acusa 4 vulnerabilidades moderadas no `drizzle-kit` (um esbuild antigo dentro
  dele). É ferramenta só de desenvolvimento, que gera migrações; não vai para o servidor.
- **Integração com o front:** o Angular ainda usa dados em memória. Os services de
  `src/app/core/` precisam passar a chamar esta API.
