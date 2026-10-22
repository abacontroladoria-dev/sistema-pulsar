import type { NextRequest } from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok, badRequest }    from '@/lib/central/response'
import { numerosDaClinica }  from '@/modules/atendimento/services/numeros-da-clinica'
import { variantesBr }       from '@/modules/atendimento/utils/telefone-br'

// GET /api/central/contacts/por-telefone?tel=5521991913429
// O que o Pulsar sabe de um número que chegou num cartão de contato:
//   • daClinica  — nome do canal, quando o número é da própria clínica;
//   • contato    — o contato já cadastrado com esse WhatsApp;
//   • conversaId — a conversa mais recente com ele, para "Abrir conversa".
//
// Contato e conversa são lidos com o client do usuário: a RLS decide, e quem
// não atende aquele número não fica sabendo que a conversa existe.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const tel = (request.nextUrl.searchParams.get('tel') ?? '').replace(/\D/g, '')
    if (tel.length < 10 || tel.length > 15) return badRequest('Telefone inválido', 'tel')
    const variantes = variantesBr(tel)

    const [numeros, identificador] = await Promise.all([
      numerosDaClinica(user.orgId),
      supabase
        .schema('central')
        .from('contact_identifiers')
        .select('contact_id')
        .eq('organization_id', user.orgId)
        .eq('identifier_type', 'wa_id')
        .in('identifier_value', variantes)
        .limit(1)
        .maybeSingle(),
    ])
    if (identificador.error) throw identificador.error

    const daClinica = variantes.map(v => numeros.get(v)).find(Boolean) ?? null

    let contato: { id: string; name: string | null; contact_type: string; is_provisional: boolean } | null = null
    let conversaId: string | null = null
    const contactId = (identificador.data as { contact_id: string } | null)?.contact_id
    if (contactId) {
      const [c, conv] = await Promise.all([
        supabase
          .schema('central')
          .from('contacts')
          .select('id, name, contact_type, is_provisional')
          .eq('id', contactId)
          .is('deleted_at', null)
          .is('merged_into_contact_id', null)
          .maybeSingle(),
        supabase
          .schema('central')
          .from('conversations')
          .select('id')
          .eq('organization_id', user.orgId)
          .eq('contact_id', contactId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (c.error) throw c.error
      if (conv.error) throw conv.error
      contato = c.data
      conversaId = (conv.data as { id: string } | null)?.id ?? null
    }

    return ok({ daClinica, contato, conversaId })
  } catch (err) {
    return mapCentralError(err)
  }
}
