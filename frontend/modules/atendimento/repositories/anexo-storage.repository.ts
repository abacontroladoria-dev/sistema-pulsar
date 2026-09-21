import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// O bucket dos anexos do atendimento
//
// Único lugar do repositório que conhece o nome do bucket e a convenção de
// path. Espalhar `'central-anexos'` por service e rota faria renomeá-lo virar
// uma caçada — e faria a convenção de path divergir da policy que a valida, que
// é a forma de erro mais difícil de diagnosticar: o upload falha com "new row
// violates row-level security policy" e nada diz que o problema é o formato do
// nome.
//
// PRIVADO. Quem exibe é uma URL assinada de curta duração, emitida depois de a
// rota conferir sessão e organização. Ver a migration 20260921160000 para por
// que público não era opção aqui.
// ============================================================================

const BUCKET = 'central-anexos'

// 5 minutos. A URL assinada só precisa sobreviver ao <img> que a consome, e
// quanto menor a janela, menor o estrago de uma URL que vaze num print ou num
// log de proxy. Quem deixar a conversa aberta por muito tempo recebe uma nova
// no próximo poll.
const VALIDADE_URL_S = 300

// ----------------------------------------------------------------------------
// A convenção de path, que a policy de INSERT valida:
//
//   {organization_id}/{conversation_id}/{message_id}/{arquivo}
//
// A organização como PRIMEIRO segmento é o que permite isolar org na policy
// sem consultar tabela nenhuma. Os dois seguintes tornam triviais a limpeza por
// conversa e o atendimento a um pedido de exclusão da LGPD.
//
// O NOME É GERADO, NUNCA O ORIGINAL. "laudo-joao-silva.pdf" num log de storage
// ou numa URL assinada vaza o nome de um paciente para quem só deveria ver um
// identificador. O nome original vive em `message_attachments.file_name`, que
// está sob RLS.
// ----------------------------------------------------------------------------
export function montarPath(
  orgId: string,
  conversationId: string,
  messageId: string,
  mimeType: string,
): string {
  return `${orgId}/${conversationId}/${messageId}/${Date.now()}${extensaoDe(mimeType)}`
}

// A extensão existe para o navegador e o sistema operacional de quem baixa
// acertarem o aplicativo. É derivada do MIME, nunca do nome enviado: um nome
// pode dizer `.pdf` e trazer outra coisa.
const EXTENSAO: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'audio/aac':  '.aac',
  'audio/amr':  '.amr',
  'audio/mpeg': '.mp3',
  'audio/mp4':  '.m4a',
  'audio/ogg':  '.ogg',
  'audio/opus': '.opus',
  'video/mp4':  '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv':   '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
}

export function extensaoDe(mimeType: string): string {
  // O WhatsApp manda `audio/ogg; codecs=opus`; a parte depois do `;` é
  // parâmetro, não tipo.
  const limpo = mimeType.split(';')[0].trim().toLowerCase()
  return EXTENSAO[limpo] ?? ''
}

export class AnexoStorageRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async salvar(path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mimeType,
        // `upsert` para uma retentativa sobre o mesmo path não falhar — dois
        // atendentes podem clicar no mesmo áudio ao mesmo tempo, e o download é
        // sob demanda. Não há risco de sobrescrever conteúdo alheio: o path
        // carrega o id da mensagem, e cada mensagem tem o seu.
        upsert: true,
      })

    if (error) throw error
  }

  // A URL que a bolha consome. Assinada, curta, emitida só depois de a rota
  // conferir a sessão — o path nunca chega ao cliente.
  async urlAssinada(path: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, VALIDADE_URL_S)

    if (error) throw error
    if (!data?.signedUrl) {
      throw new Error(`o storage aceitou a assinatura mas não devolveu URL para ${path}`)
    }
    return data.signedUrl
  }

  async baixar(path: string): Promise<ArrayBuffer> {
    const { data, error } = await this.supabase.storage.from(BUCKET).download(path)
    if (error) throw error
    return data.arrayBuffer()
  }
}
