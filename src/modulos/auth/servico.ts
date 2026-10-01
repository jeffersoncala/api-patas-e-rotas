import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { pets, redefinicoesSenha, sessoes, usuarios } from '../../db/schema.js';
import { ErroApi, naoAutorizado } from '../../erros.js';
import { conferirSenha, gerarHashSenha } from './senha.js';
import { gerarTokenOpaco, hashToken } from './tokens.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const VALIDADE_REDEFINICAO_MS = 60 * 60 * 1000;

/**
 * Hash de uma senha qualquer, calculado uma vez: o login de e-mail inexistente também
 * roda o scrypt, para o tempo de resposta não revelar quais e-mails têm conta.
 */
let hashFalso: Promise<string> | undefined;

export interface DadosCadastro {
  email: string;
  password: string;
  tutor: string;
  pet: string;
  especie: (typeof pets.$inferInsert)['especie'];
  porte: (typeof pets.$inferInsert)['porte'];
}

type Usuario = typeof usuarios.$inferSelect;

export function usuarioPublico(u: Usuario) {
  return {
    id: u.id,
    email: u.email,
    tutor: u.tutor,
    role: 'authenticated' as const,
    criadoEm: u.criadoEm.toISOString(),
    ultimoAcessoEm: u.ultimoAcessoEm?.toISOString() ?? null,
  };
}

export class AuthServico {
  constructor(private readonly app: FastifyInstance) {}

  private get banco() {
    return this.app.banco;
  }

  async cadastrar(dados: DadosCadastro) {
    const existe = this.banco
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, dados.email))
      .get();
    if (existe) throw new ErroApi(409, 'Já existe uma conta com esse e-mail');

    const senhaHash = await gerarHashSenha(dados.password, this.app.custoSenha);
    const usuario = this.banco.transaction((tx) => {
      const criado = tx
        .insert(usuarios)
        .values({ email: dados.email, senhaHash, tutor: dados.tutor })
        .returning()
        .get();
      tx.insert(pets)
        .values({
          usuarioId: criado.id,
          nome: dados.pet,
          especie: dados.especie,
          porte: dados.porte,
        })
        .run();
      return criado;
    });
    return this.abrirSessao(usuario);
  }

  async entrar(email: string, senha: string) {
    const usuario = this.banco.select().from(usuarios).where(eq(usuarios.email, email)).get();
    const ok = usuario
      ? await conferirSenha(senha, usuario.senhaHash)
      : await conferirSenha(senha, await (hashFalso ??= gerarHashSenha('x', this.app.custoSenha)));
    if (!usuario || !ok) throw naoAutorizado('E-mail ou senha incorretos');
    return this.abrirSessao(usuario);
  }

  /** Troca o refresh token por um par novo; o antigo deixa de valer (rotação). */
  async renovar(refreshToken: string) {
    const agora = new Date();
    const sessao = this.banco
      .select()
      .from(sessoes)
      .where(
        and(
          eq(sessoes.refreshHash, hashToken(refreshToken)),
          isNull(sessoes.revogadaEm),
          gt(sessoes.expiraEm, agora),
        ),
      )
      .get();
    if (!sessao) throw naoAutorizado('Refresh token inválido ou expirado');

    const novoRefresh = gerarTokenOpaco();
    this.banco
      .update(sessoes)
      .set({
        refreshHash: hashToken(novoRefresh),
        expiraEm: new Date(agora.getTime() + this.app.config.refreshTokenTtlDias * DIA_MS),
      })
      .where(eq(sessoes.id, sessao.id))
      .run();

    const usuario = this.buscarUsuario(sessao.usuarioId);
    return this.resposta(usuario, sessao.id, novoRefresh);
  }

  encerrarSessao(sessaoId: string): void {
    this.banco
      .update(sessoes)
      .set({ revogadaEm: new Date() })
      .where(and(eq(sessoes.id, sessaoId), isNull(sessoes.revogadaEm)))
      .run();
  }

  buscarUsuario(id: string): Usuario {
    const usuario = this.banco.select().from(usuarios).where(eq(usuarios.id, id)).get();
    if (!usuario) throw naoAutorizado();
    return usuario;
  }

  /**
   * Sempre responde igual, exista ou não a conta, para não revelar e-mails cadastrados.
   * O link leva ao front, que chama `POST /auth/redefinir-senha` com o token.
   */
  async solicitarRedefinicao(email: string): Promise<void> {
    const usuario = this.banco.select().from(usuarios).where(eq(usuarios.email, email)).get();
    if (!usuario) return;

    const token = gerarTokenOpaco();
    this.banco
      .insert(redefinicoesSenha)
      .values({
        usuarioId: usuario.id,
        tokenHash: hashToken(token),
        expiraEm: new Date(Date.now() + VALIDADE_REDEFINICAO_MS),
      })
      .run();

    const link = `${this.app.config.urlFront}/redefinir-senha?token=${token}`;
    await this.app.enviarEmail({
      para: usuario.email,
      assunto: 'Redefinição de senha · Patas & Rotas',
      texto: `Olá, ${usuario.tutor}! Para criar uma nova senha, acesse ${link} (vale por 1 hora). Se não foi você, ignore este e-mail.`,
    });
  }

  /** Troca a senha e derruba todas as sessões abertas da conta. */
  async redefinirSenha(token: string, novaSenha: string): Promise<void> {
    const agora = new Date();
    const pedido = this.banco
      .select()
      .from(redefinicoesSenha)
      .where(
        and(
          eq(redefinicoesSenha.tokenHash, hashToken(token)),
          isNull(redefinicoesSenha.usadaEm),
          gt(redefinicoesSenha.expiraEm, agora),
        ),
      )
      .get();
    if (!pedido) throw new ErroApi(400, 'Link de redefinição inválido ou expirado');

    const senhaHash = await gerarHashSenha(novaSenha, this.app.custoSenha);
    this.banco.transaction((tx) => {
      tx.update(usuarios).set({ senhaHash }).where(eq(usuarios.id, pedido.usuarioId)).run();
      tx.update(redefinicoesSenha)
        .set({ usadaEm: agora })
        .where(eq(redefinicoesSenha.usuarioId, pedido.usuarioId))
        .run();
      tx.update(sessoes)
        .set({ revogadaEm: agora })
        .where(and(eq(sessoes.usuarioId, pedido.usuarioId), isNull(sessoes.revogadaEm)))
        .run();
    });
  }

  private async abrirSessao(usuario: Usuario) {
    const agora = new Date();
    const refresh = gerarTokenOpaco();
    const sessao = this.banco
      .insert(sessoes)
      .values({
        usuarioId: usuario.id,
        refreshHash: hashToken(refresh),
        expiraEm: new Date(agora.getTime() + this.app.config.refreshTokenTtlDias * DIA_MS),
      })
      .returning({ id: sessoes.id })
      .get();
    const atualizado = this.banco
      .update(usuarios)
      .set({ ultimoAcessoEm: agora })
      .where(eq(usuarios.id, usuario.id))
      .returning()
      .get();
    return this.resposta(atualizado, sessao.id, refresh);
  }

  private async resposta(usuario: Usuario, sessaoId: string, refreshToken: string) {
    const { token, expiraEm } = await this.app.tokens.emitirAcesso({
      sub: usuario.id,
      sid: sessaoId,
    });
    return {
      accessToken: token,
      tokenType: 'Bearer' as const,
      expiresEm: expiraEm.toISOString(),
      refreshToken,
      usuario: usuarioPublico(usuario),
    };
  }
}
