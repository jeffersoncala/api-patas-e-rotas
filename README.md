# Patas & Rotas — API

Backend do Patas & Rotas, uma rede social para pets marcarem encontros e registrarem passeios.
Substitui a API Java anterior (`pataserotas-api`) e mantém o mesmo contrato de login.

**Stack:** Node.js 22 · TypeScript 7 · Fastify 5 · Zod 4 · Drizzle ORM · SQLite (better-sqlite3) · jose (JWT) · Vitest 5

## Como rodar

Requisito: Node.js 22.12 ou mais novo.

```bash
npm install
cp .env.example .env        # e preencha JWT_SECRET (veja o comando no próprio arquivo)
npm run db:seed             # opcional: cria os dados de exemplo do front
npm run dev                 # http://localhost:3000  ·  documentação em /docs
```

O banco é um arquivo SQLite em `dados/pataserotas.db` (fora do Git), criado na primeira execução.
As migrações rodam sozinhas ao subir a API.

Contas do seed (senha `segredo123`): `tutor@exemplo.com` (Jeff e Bolota), `ana@exemplo.com`,
`rafael@exemplo.com`, `julia@exemplo.com`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe em modo watch, com log colorido |
| `npm run build` / `npm start` | Compila para `dist/` e roda a versão compilada |
| `npm test` | Testes (cada teste usa um SQLite em memória, isolado) |
| `npm run typecheck` | Checagem de tipos sem gerar arquivos |
| `npm run db:generate` | Gera uma migração nova a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica as migrações sem subir o servidor |
| `npm run db:seed` | Popula com os dados de exemplo (`-- --reset` apaga tudo antes) |

## Endpoints

A documentação interativa (OpenAPI/Swagger) fica em **`/docs`**, gerada a partir dos mesmos
schemas Zod que validam as requisições. Resumo:

| Método e caminho | Descrição |
| --- | --- |
| `POST /auth/cadastro` | Cria conta + pet e já devolve os tokens |
| `POST /auth/login` | `{ email, password }` → `{ accessToken, tokenType, expiresEm, refreshToken, usuario }` |
| `POST /auth/refresh` | Troca o refresh token por um par novo (o antigo deixa de valer) |
| `GET /auth/me` | Usuário do token |
| `POST /auth/logout` | Encerra a sessão (204) |
| `POST /auth/recuperar-senha` | Envia o link de redefinição (sempre 202) |
| `POST /auth/redefinir-senha` | `{ token, password }` → troca a senha e derruba todas as sessões |
| `GET / PATCH / DELETE /perfil` | Dados do tutor e do pet; `DELETE` apaga a conta e tudo dela |
| `GET /perfil/resumo` | km da semana, total, passeios e encontros confirmados |
| `GET /encontros` · `POST /encontros` | Lista (`?filtro=todos\|vou&periodo=futuros\|todos`) e cria |
| `GET / PATCH / DELETE /encontros/:id` | Detalhe; alterar e apagar só o organizador |
| `PUT / DELETE /encontros/:id/presenca` | Confirma ou cancela presença |
| `GET /rotas` · `POST /rotas` | Lista (`?filtro=todas\|favoritas`) e cria |
| `GET / PATCH / DELETE /rotas/:id` | Detalhe; alterar e apagar só o autor |
| `PUT / DELETE /rotas/:id/favorita` | Favorita ou desfavorita |
| `GET /rotas/:id/passeios` | Passeios feitos na rota |
| `GET /passeios` · `POST /passeios` | Feed paginado (`?autor=todos\|eu&limite=&antesDe=`) e registro |
| `GET / DELETE /passeios/:id` | Detalhe; apagar só o autor |
| `PUT / DELETE /passeios/:id/curtida` | Curte ou descurte |

Tudo, fora cadastro, login, refresh e recuperação de senha, exige
`Authorization: Bearer <accessToken>`. Os formatos de `Encontro`, `Rota`, `Passeio` e `Perfil`
seguem as interfaces de `pataserotas-front/src/app/core/models.ts`.

### Erros

Mesmo corpo da API Java, para o front não precisar tratar dois formatos:

```json
{ "timestamp": "2026-09-30T12:00:00.000Z", "status": 400, "erro": "Bad Request",
  "mensagem": "Dados inválidos", "campos": { "email": "Formato do endereço de e-mail inválido" } }
```

| Status | Quando |
| --- | --- |
| 400 | Corpo, query ou parâmetro inválido (`campos` diz qual) |
| 401 | Sem token, token inválido/expirado, sessão encerrada, e-mail ou senha errados |
| 403 | Alterar algo que é de outro usuário |
| 404 | Recurso ou rota inexistente |
| 409 | E-mail já cadastrado |
| 429 | Muitas tentativas (login, cadastro, recuperação de senha) |

## Decisões

- **SQLite local.** Nada para instalar e roda em qualquer máquina. Para vários servidores em
  produção, o caminho é trocar o driver do Drizzle por PostgreSQL: o schema é quase todo portável.
- **Sessões no banco.** O access token (JWT HS256, 1 h) leva o id da sessão, e cada requisição
  confere se ela está ativa. Por isso o logout e a troca de senha valem **na hora**. Na API Java o
  token revogado continuava aceito até expirar.
- **Refresh token opaco e rotativo**, guardado só como hash (SHA-256). Cada uso gera um novo.
- **Senhas com scrypt** (`node:crypto`, N=2^16, r=8), sem dependência nativa extra.
- **Distâncias sempre calculadas no servidor** a partir dos pontos do trajeto.
- **Sem vazamento de conta:** login de e-mail inexistente leva o mesmo tempo, e a recuperação de
  senha responde igual exista a conta ou não.

## Diferenças em relação à API Java

- O login não depende do Supabase: não há confirmação de e-mail e os usuários do Supabase
  **não** foram migrados (quem tinha conta lá precisa se cadastrar de novo).
- O campo `usuario` ganhou `tutor`; `role` segue `"authenticated"` para manter o formato.
- `/auth/cadastro`, `/auth/recuperar-senha`, `/auth/redefinir-senha` e todo o domínio (perfil,
  encontros, rotas, passeios) são novos.

## Pendências

- **E-mail:** o link de redefinição de senha só vai para o log do servidor (`src/email.ts`).
  Antes de produção, ligar um provedor (SMTP, Resend, SES...).
- **`npm audit`:** acusa 4 vulnerabilidades moderadas no `drizzle-kit` (um esbuild antigo dentro
  dele). É ferramenta só de desenvolvimento, que gera migrações; não vai para o servidor.
- **Integração com o front:** o Angular ainda usa dados em memória. Os services de
  `src/app/core/` precisam passar a chamar esta API.
