import type { FastifyBaseLogger } from 'fastify';

export interface Email {
  para: string;
  assunto: string;
  texto: string;
}

export type EnviarEmail = (email: Email) => Promise<void>;

/**
 * Enquanto não há provedor de e-mail, a mensagem vai para o log do servidor
 * (é de lá que se copia o link de redefinição de senha em desenvolvimento).
 * TODO: trocar por um provedor real (SMTP, Resend, SES...) antes de produção.
 */
export function enviarEmailNoLog(log: FastifyBaseLogger): EnviarEmail {
  return async (email) => {
    log.info({ email }, `E-mail para ${email.para}: ${email.assunto}`);
  };
}
