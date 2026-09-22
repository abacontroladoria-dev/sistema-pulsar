import type { SupabaseClient } from '@supabase/supabase-js'
import type { TagDefinition } from '../types/central.types'

// ============================================================================
// TagDefinitionRepository
//
// central.tag_definitions — o catálogo de tags reutilizáveis da organização
// (migration 20260701010000). As tags aplicadas ficam em contacts.tags e
// conversations.tags como TEXT[] de `key`; esta tabela é o de-para de cada key
// para rótulo, cor e categoria.
//
// Só leitura. Cadastrar tag nova é ato de configuração da clínica, não de
// atendimento — quando essa tela existir, ela acrescenta a escrita aqui.
// ============================================================================

// Colunas explícitas, nunca '*': sob privilégio por coluna um select('*')
// responde 403, e o schema `central` está assim desde a 20260810120300.
const COLUNAS = 'id, organization_id, key, label, color, category, is_active, created_at, updated_at, '
  + 'grupo_key, grupo_ordem, cardinalidade, maia_pode_aplicar, automatico_sistema, requer_humano'

export class TagDefinitionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // Ordenado por categoria e rótulo porque é como a tela agrupa. Ordenar no
  // banco evita que cada consumidor invente a própria ordem e o mesmo catálogo
  // apareça diferente em dois lugares.
  async listarAtivas(orgId: string): Promise<TagDefinition[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tag_definitions')
      .select(COLUNAS)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('category', { ascending: true, nullsFirst: false })
      .order('label',    { ascending: true })

    if (error) throw error
    return (data ?? []) as TagDefinition[]
  }

  // Só as chaves, para validar o que a aplicação vai gravar no TEXT[]. A
  // migration deixou essa validação para cá de propósito (ver o comentário
  // dela): o banco aceita qualquer string na coluna.
  async chavesAtivas(orgId: string): Promise<Set<string>> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tag_definitions')
      .select('key')
      .eq('organization_id', orgId)
      .eq('is_active', true)

    if (error) throw error
    return new Set(((data ?? []) as { key: string }[]).map(t => t.key))
  }

  // O catálogo da taxonomia da Maia (20260922100000), agrupado por
  // `grupo_key` — é o formato que `agente/tags.ts` precisa para montar os
  // enums da ferramenta de classificação e que o executor de `ferramentas.ts`
  // precisa para saber a que grupo cada `key` pertence (merge por grupo).
  //
  // Tags fora dessa taxonomia (`grupo_key is null`, o seed genérico de
  // 20260701010500) não entram: não têm cardinalidade nem "quem aplica"
  // definidos, e misturá-las no mapa faria o chamador tratar `undefined`
  // como um grupo válido.
  async porGrupo(orgId: string): Promise<Map<string, TagDefinition[]>> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tag_definitions')
      .select(COLUNAS)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .not('grupo_key', 'is', null)
      .order('grupo_ordem', { ascending: true })
      .order('label',       { ascending: true })

    if (error) throw error

    const porGrupo = new Map<string, TagDefinition[]>()
    for (const tag of (data ?? []) as TagDefinition[]) {
      const lista = porGrupo.get(tag.grupo_key as string) ?? []
      lista.push(tag)
      porGrupo.set(tag.grupo_key as string, lista)
    }
    return porGrupo
  }
}
