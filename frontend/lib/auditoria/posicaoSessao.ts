import type { SupabaseClient } from '@supabase/supabase-js'

export interface PosicaoNoDia {
  ordem: number
  total: number
}

export interface SessaoDoDia {
  id: string
  paciente_id: number | null
  data: string
  terapia_nome: string | null
  hora_inicial: string | null
}

const chaveDoDia = (s: Pick<SessaoDoDia, 'paciente_id' | 'data' | 'terapia_nome'>) =>
  `${s.paciente_id}|${s.data}|${s.terapia_nome ?? ''}`

/**
 * Posição de cada sessão entre as do mesmo paciente, no mesmo dia e na mesma
 * terapia, por horário. Existe para a regra do Aplicador ABA Escola ("chegada
 * e saída só na primeira e na última sessão do dia"): sem isso a IA não tem
 * como saber em qual das sessões do dia a evolução está.
 */
export function calcularPosicoes(sessoes: SessaoDoDia[]): Map<string, PosicaoNoDia> {
  const grupos = new Map<string, SessaoDoDia[]>()
  for (const s of sessoes) {
    if (s.paciente_id == null) continue
    const k = chaveDoDia(s)
    const g = grupos.get(k)
    if (g) g.push(s)
    else grupos.set(k, [s])
  }
  const posicoes = new Map<string, PosicaoNoDia>()
  for (const g of grupos.values()) {
    g.sort((a, b) => (a.hora_inicial ?? '').localeCompare(b.hora_inicial ?? '') || a.id.localeCompare(b.id))
    g.forEach((s, i) => posicoes.set(s.id, { ordem: i + 1, total: g.length }))
  }
  return posicoes
}

/**
 * Busca as sessões irmãs dos itens do lote e devolve a posição de cada item.
 * Cancelada não conta: a "primeira do dia" é a primeira que aconteceu. O `or`
 * mantém `status_execucao` NULL, que um `.neq` sozinho descartaria em silêncio.
 * Falha de leitura devolve mapa vazio: a auditoria segue sem a posição, como
 * era antes, em vez de parar.
 */
export async function carregarPosicoesNoDia(
  supabase: SupabaseClient,
  itens: Pick<SessaoDoDia, 'id' | 'paciente_id' | 'data' | 'terapia_nome'>[]
): Promise<Map<string, PosicaoNoDia>> {
  const validos = itens.filter(i => i.paciente_id != null)
  if (validos.length === 0) return new Map()

  const pacientes = [...new Set(validos.map(i => i.paciente_id as number))]
  const datas = validos.map(i => i.data).sort()
  const querem = new Set(validos.map(chaveDoDia))

  const sessoes: SessaoDoDia[] = []
  // PostgREST corta cada resposta em 1000 linhas.
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('csv_grades_profissionais')
      .select('id, paciente_id, data, terapia_nome, hora_inicial')
      .in('paciente_id', pacientes)
      .gte('data', datas[0])
      .lte('data', datas[datas.length - 1])
      .eq('ativo', true)
      .or('status_execucao.is.null,status_execucao.neq.Cancelado')
      .order('id')
      .range(de, de + 999)
    if (error) {
      console.error('[auditoria] falha ao ler posição das sessões no dia:', error.message)
      return new Map()
    }
    sessoes.push(...(data as SessaoDoDia[]).filter(s => querem.has(chaveDoDia(s))))
    if (data.length < 1000) break
  }
  return calcularPosicoes(sessoes)
}

export function descreverPosicao(p: PosicaoNoDia): string {
  // A leitura "não é a primeira nem a última" vai por extenso: só com
  // "(intermediária)" a IA não ligava a posição à regra que depende dela.
  if (p.total === 1) return 'única sessão do paciente nesta terapia no dia (é a primeira e a última do dia)'
  const papel =
    p.ordem === 1 ? 'é a primeira do dia' : p.ordem === p.total ? 'é a última do dia' : 'NÃO é a primeira nem a última do dia'
  return `${p.ordem}ª de ${p.total} sessões do paciente nesta terapia no dia (${papel})`
}
