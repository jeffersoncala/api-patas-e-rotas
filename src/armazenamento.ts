import { ErroApi } from './erros.js';

/** Arquivos guardados fora do banco (hoje, as fotos de perfil no Supabase Storage). */
export interface Armazenamento {
  /** URL assinada para o cliente enviar o arquivo direto ao storage (PUT com o arquivo no corpo). */
  urlDeUpload(caminho: string): Promise<string>;
  existe(caminho: string): Promise<boolean>;
  /**
   * URLs temporárias de leitura, na mesma ordem dos caminhos (null se o arquivo não existe).
   * Funcionam com bucket público ou privado.
   */
  urlsDeLeitura(caminhos: string[]): Promise<(string | null)[]>;
  remover(caminhos: string[]): Promise<void>;
}

/** Validade das URLs de leitura: um dia, para o front poder guardar a imagem em cache. */
const VALIDADE_LEITURA_SEGUNDOS = 24 * 60 * 60;

/**
 * Supabase Storage pela API REST, com a service role key (ignora as políticas do bucket).
 * Tamanho máximo e tipos aceitos ficam na configuração do próprio bucket.
 */
export function armazenamentoSupabase(url: string, chave: string, bucket: string): Armazenamento {
  const base = `${url.replace(/\/$/, '')}/storage/v1`;
  const headers = { authorization: `Bearer ${chave}`, apikey: chave };
  const objeto = (caminho: string) => `${encodeURIComponent(bucket)}/${caminho}`;

  async function chamar(metodo: string, rota: string, corpo?: unknown) {
    const resposta = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: corpo === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!resposta.ok) {
      throw new Error(
        `Supabase Storage ${metodo} ${rota}: ${resposta.status} ${await resposta.text()}`,
      );
    }
    return resposta;
  }

  return {
    async urlDeUpload(caminho) {
      const resposta = await chamar('POST', `/object/upload/sign/${objeto(caminho)}`);
      const { url: assinada } = (await resposta.json()) as { url: string };
      return `${base}${assinada}`;
    },
    async existe(caminho) {
      const resposta = await fetch(`${base}/object/${objeto(caminho)}`, {
        method: 'HEAD',
        headers,
      });
      if (resposta.status === 400 || resposta.status === 404) return false;
      if (!resposta.ok) throw new Error(`Supabase Storage HEAD: ${resposta.status}`);
      return true;
    },
    async urlsDeLeitura(caminhos) {
      if (!caminhos.length) return [];
      // Uma chamada só para todas as fotos do perfil.
      const resposta = await chamar('POST', `/object/sign/${encodeURIComponent(bucket)}`, {
        expiresIn: VALIDADE_LEITURA_SEGUNDOS,
        paths: caminhos,
      });
      const assinadas = (await resposta.json()) as { path: string; signedURL: string | null }[];
      const porCaminho = new Map(assinadas.map((a) => [a.path, a.signedURL]));
      return caminhos.map((c) => {
        const assinada = porCaminho.get(c);
        return assinada ? `${base}${assinada}` : null;
      });
    },
    async remover(caminhos) {
      if (!caminhos.length) return;
      await chamar('DELETE', `/object/${encodeURIComponent(bucket)}`, { prefixes: caminhos });
    },
  };
}

/** Usado quando o Supabase Storage não está configurado: o upload responde 503. */
export const armazenamentoIndisponivel: Armazenamento = {
  urlDeUpload: async () => {
    throw new ErroApi(503, 'Upload de fotos não está configurado no servidor');
  },
  existe: async () => false,
  urlsDeLeitura: async (caminhos) => caminhos.map(() => null),
  remover: async () => {},
};
