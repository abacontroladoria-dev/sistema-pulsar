import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactIntake, CampoFicha, OrigemCampo } from '../types/central.types'

// ============================================================================
// FichaRepository
//
// central.contact_intake (20260921180000) — o que a conversa revelou sobre o
// paciente de um contato ainda não vinculado ao TiTa.
//
// A tabela guarda SÓ o que a Maia (ou o atendente) coletou. O cadastro do TiTa
// nunca é copiado para cá; o merge acontece na leitura, em ficha.service.ts.
// ============================================================================

const COLUNAS = `
  contact_id, organization_id,
  patient_name, birth_date, guardian_name, shift, health_plan,
  fontes, coleta_concluida, created_at, updated_at
`

// O patch que uma escrita aplica. Parcial de propósito: a Maia grava UM campo
// por vez, conforme o responsável responde. `undefined` significa "não mexe
// neste campo"; `null` significa "apaga" (só o atendente faz isso, corrigindo
// um erro da IA).
export type PatchFicha = Partial<Record<CampoFicha, string | null>>

export class FichaRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async buscar(orgId: string, contactId: string): Promise<ContactIntake | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_intake')
      .select(COLUNAS)
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as ContactIntake | null
  }

  // ------------------------------------------------------------------------
  // Grava um patch parcial, preservando o que já estava lá.
  //
  // POR QUE LER-E-ESCREVER, E NÃO UM UPSERT DIRETO
  //
  // `fontes` é um jsonb que precisa ser MESCLADO, não substituído: se a Maia
  // gravou o turno e depois o atendente corrige o nome, o mapa final tem que
  // dizer `{"shift":"ia","patient_name":"atendente"}`. Um upsert com o objeto
  // novo apagaria a procedência do campo anterior, e a coluna existe
  // exatamente para não perder isso.
  //
  // A corrida (duas escritas simultâneas no mesmo contato) é aceitável aqui: as
  // duas fontes possíveis são a Maia, que escreve no máximo uma vez por turno, e
  // o atendente, que escreve quando clica. O pior caso é uma procedência
  // sobrescrita por outra igualmente verdadeira — não há perda de dado do
  // paciente, que é o que importaria.
  // ------------------------------------------------------------------------
  async aplicar(
    orgId: string,
    contactId: string,
    patch: PatchFicha,
    fonte: Exclude<OrigemCampo, 'cadastro'>,
  ): Promise<ContactIntake> {
    const atual = await this.buscar(orgId, contactId)

    const campos: Record<string, unknown> = {}
    const fontes: Record<string, string> = { ...((atual?.fontes ?? {}) as Record<string, string>) }

    for (const [campo, valor] of Object.entries(patch)) {
      if (valor === undefined) continue
      campos[campo] = valor
      // Campo apagado perde a procedência junto: manter "quem disse" de um valor
      // que não existe mais faria a tela atribuir a alguém um dado em branco.
      if (valor === null) delete fontes[campo]
      else fontes[campo] = fonte
    }

    const linha = {
      contact_id:       contactId,
      organization_id:  orgId,
      ...((atual ?? {}) as Record<string, unknown>),
      ...campos,
      fontes,
      coleta_concluida: concluida({ ...(atual ?? {}), ...campos }),
    }

    // `created_at`/`updated_at` saem do payload: o default e o trigger cuidam
    // deles, e reenviar o `updated_at` lido faria a linha carimbar a si mesma
    // com a hora da leitura anterior.
    delete (linha as Record<string, unknown>).created_at
    delete (linha as Record<string, unknown>).updated_at

    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_intake')
      .upsert(linha, { onConflict: 'contact_id' })
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as ContactIntake
  }
}

// A coleta está completa quando os cinco campos têm valor. `shift` conta como
// preenchido quando vale 'indiferente' — a pessoa respondeu, e a resposta foi
// "tanto faz".
function concluida(linha: Record<string, unknown>): boolean {
  const campos: CampoFicha[] = [
    'patient_name', 'birth_date', 'guardian_name', 'shift', 'health_plan',
  ]
  return campos.every((c) => {
    const v = linha[c]
    return v !== null && v !== undefined && String(v).trim() !== ''
  })
}
