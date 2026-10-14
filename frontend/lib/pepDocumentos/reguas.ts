import 'server-only'

// Réguas vigentes (pep_reguas_versoes, 20261015100000): a maior versão de cada
// sigla. Sigla sem versão = sem leitura pela IA (só as conferências fixas).
// Sem a tabela no ambiente (migration não aplicada): o texto da v1 que vive
// no código (REGUAS_PADRAO), como "v1" — o mesmo papel de CRITERIOS_FALLBACK
// na auditoria de evoluções.

import type { SupabaseClient } from '@supabase/supabase-js'
import { REGUAS_PADRAO, type Regua } from './ia'

export async function reguasVigentes(db: SupabaseClient): Promise<Map<string, Regua>> {
  const { data, error } = await db.from('pep_reguas_versoes')
    .select('sigla, versao, conteudo')
    .order('versao', { ascending: false })
  if (error) {
    const padrao = new Map<string, Regua>()
    for (const [sigla, r] of Object.entries(REGUAS_PADRAO)) padrao.set(sigla, { sigla, versao: 1, conteudo: r.regua })
    return padrao
  }
  const vigentes = new Map<string, Regua>()
  for (const r of (data ?? []) as Regua[]) {
    const sigla = r.sigla.toUpperCase()
    if (!vigentes.has(sigla)) vigentes.set(sigla, { sigla, versao: r.versao, conteudo: r.conteudo })
  }
  return vigentes
}
