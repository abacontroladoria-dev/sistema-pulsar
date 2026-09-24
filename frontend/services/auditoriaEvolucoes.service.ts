import { getSupabaseClient } from '@/lib/supabase/client'
import type { 
  RegistroAuditoriaEvolucao,
  EvolucaoPendenteAuditoria,
  ResumoProfissionalAuditoria,
  StatusCobrancaEvolucao,
  StatusRiscoEvolucao
} from '@/types/auditoriaEvolucoes'

export interface FiltrosAuditoriaEvolucoes {
  dataInicio?: string
  dataFim?: string
  profissionalId?: number | null
  unidadeId?: number | null
  /** 'com_risco' junta risco_especifico + risco_relevante — os dois KPIs de risco viraram um só. */
  statusRisco?: StatusRiscoEvolucao | 'todos' | 'com_risco'
  statusCobranca?: StatusCobrancaEvolucao | 'todos'
  apenasComEvolucao?: boolean
  busca?: string
}

const DATA_CORTE_PADRAO = '2026-09-01'

/**
 * O PostgREST corta QUALQUER resposta em `max_rows` (1000 nesta base), e sem
 * `Range` ele corta calado — nada no retorno diz que faltou linha. Em 22/09/2026
 * isso deixava a tela cega: as 5.099 sessões do período viravam as 1.000 mais
 * recentes (16/09 a 21/09), e como as 155 auditorias eram todas de sessões
 * anteriores, NENHUMA aparecia. Os filtros de risco/cobrança rodam em memória,
 * então filtravam uma fatia sem auditoria alguma e devolviam sempre vazio.
 */
const TAMANHO_PAGINA = 1000

/**
 * Quantas consultas em voo ao mesmo tempo. Em sequência, a abertura da tela
 * levava ~12s (6 páginas de grade + 30 blocos de auditoria, um após o outro).
 * Não é "tudo de uma vez": o PostgREST tem pool de 10 conexões, e saturá-lo já
 * derrubou o sistema inteiro em 504 (incidente de 24/08). 4 deixa folga.
 */
const CONSULTAS_SIMULTANEAS = 4

/** Roda as tarefas com no máximo `limite` em voo; devolve na ordem de entrada. */
async function emParalelo<T>(tarefas: (() => PromiseLike<T>)[], limite = CONSULTAS_SIMULTANEAS): Promise<T[]> {
  const resultados = new Array<T>(tarefas.length)
  let proxima = 0
  await Promise.all(
    Array.from({ length: Math.min(limite, tarefas.length) }, async () => {
      while (proxima < tarefas.length) {
        const i = proxima++
        resultados[i] = await tarefas[i]()
      }
    })
  )
  return resultados
}

/**
 * Pagina em rodadas de `limite` páginas simultâneas, até a primeira página
 * incompleta. Sem contar antes: um `count: 'exact'` seria mais uma consulta cara
 * sobre a grade inteira só para saber quantas páginas pedir.
 */
async function paginarEmParalelo<T>(
  buscarPagina: (pagina: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ linhas: T[] } | { erro: string }> {
  const linhas: T[] = []
  for (let inicio = 0; ; inicio += CONSULTAS_SIMULTANEAS) {
    const paginas = await Promise.all(
      Array.from({ length: CONSULTAS_SIMULTANEAS }, (_, k) => buscarPagina(inicio + k))
    )
    for (const { data, error } of paginas) {
      if (error) return { erro: error.message }
      const lote = data ?? []
      linhas.push(...lote)
      if (lote.length < TAMANHO_PAGINA) return { linhas }
    }
  }
}

const COLUNAS_GRADE = `
  id,
  tita_agendamento_id,
  data,
  profissional_id,
  profissional_nome,
  paciente_id,
  paciente_nome,
  terapia_nome,
  unidade_id,
  unidade_nome,
  descricao_evolucao,
  status_execucao
`

/**
 * Busca evoluções de `csv_grades_profissionais` e seus resultados de auditoria em `auditoria_evolucoes`
 * Restrito por padrão a partir de 01/09/2026.
 *
 * Dois caminhos, porque o volume manda:
 * - COM filtro de risco/cobrança: parte de `auditoria_evolucoes` (centenas de
 *   linhas, filtradas no banco) e busca só as sessões correspondentes.
 * - SEM filtro: pagina a grade inteira, para o total e a taxa de conformidade
 *   valerem sobre todo o período, não sobre a primeira página.
 */
export async function buscarEvolucoesComAuditoria(
  filtros: FiltrosAuditoriaEvolucoes = {}
): Promise<{ data: EvolucaoPendenteAuditoria[]; error: string | null }> {
  const supabase = getSupabaseClient()

  const dataInicio = filtros.dataInicio || DATA_CORTE_PADRAO
  const filtraRisco = Boolean(filtros.statusRisco && filtros.statusRisco !== 'todos')
  const filtraCobranca = Boolean(filtros.statusCobranca && filtros.statusCobranca !== 'todos')

  try {
    const gradeRows = filtraRisco || filtraCobranca
      ? await buscarGradePelaAuditoria(supabase, dataInicio, filtros)
      : await buscarGradePaginada(supabase, dataInicio, filtros)

    if ('erro' in gradeRows) {
      return { data: [], error: gradeRows.erro }
    }

    if (gradeRows.linhas.length === 0) {
      return { data: [], error: null }
    }

    // 2. Buscar registros de auditoria correspondentes
    const gradeIds = gradeRows.linhas.map(r => r.id)

    // Chunking to prevent URL length limits if gradeIds is huge
    const chunkSize = 200
    const auditoriaMap = new Map<string, RegistroAuditoriaEvolucao>()

    const blocos: string[][] = []
    for (let i = 0; i < gradeIds.length; i += chunkSize) blocos.push(gradeIds.slice(i, i + chunkSize))
    const respostas = await emParalelo(
      blocos.map(chunk => () => supabase.from('auditoria_evolucoes').select('*').in('grade_id', chunk))
    )

    for (const { data: audRows, error: audErr } of respostas) {
      if (audErr) {
        return { data: [], error: `Erro ao buscar auditorias: ${audErr.message}` }
      }
      for (const a of audRows ?? []) {
        auditoriaMap.set(a.grade_id, a as unknown as RegistroAuditoriaEvolucao)
      }
    }

    // 3. Mesclar resultados
    let resultado: EvolucaoPendenteAuditoria[] = gradeRows.linhas.map(r => {
      const auditoria = auditoriaMap.get(r.id) || null
      return {
        grade_id: r.id,
        tita_agendamento_id: r.tita_agendamento_id,
        data_sessao: r.data,
        profissional_id: r.profissional_id,
        profissional_nome: r.profissional_nome || 'Profissional não identificado',
        paciente_id: r.paciente_id,
        paciente_nome: r.paciente_nome || 'Paciente não identificado',
        terapia_nome: r.terapia_nome,
        unidade_id: r.unidade_id,
        unidade_nome: r.unidade_nome,
        texto_original: r.descricao_evolucao || '',
        status_execucao: r.status_execucao,
        auditoria
      }
    })

    // Os filtros de risco/cobrança já foram aplicados NO BANCO quando ativos
    // (ver buscarGradePelaAuditoria). Reaplicar aqui é de graça e protege contra
    // uma sessão que tenha perdido a auditoria entre as duas consultas.
    if (filtraRisco) {
      resultado = filtros.statusRisco === 'com_risco'
        ? resultado.filter(r => r.auditoria && r.auditoria.status_risco !== 'sem_risco')
        : resultado.filter(r => r.auditoria?.status_risco === filtros.statusRisco)
    }

    if (filtraCobranca) {
      resultado = resultado.filter(r => r.auditoria?.status_cobranca === filtros.statusCobranca)
    }

    if (filtros.busca) {
      const b = filtros.busca.toLowerCase()
      resultado = resultado.filter(r => 
        r.paciente_nome.toLowerCase().includes(b) ||
        r.profissional_nome.toLowerCase().includes(b) ||
        (r.terapia_nome && r.terapia_nome.toLowerCase().includes(b)) ||
        (r.texto_original && r.texto_original.toLowerCase().includes(b))
      )
    }

    return { data: resultado, error: null }
  } catch (err: unknown) {
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Erro inesperado ao buscar auditorias'
    }
  }
}

type LinhaGrade = {
  id: string
  tita_agendamento_id: number | null
  data: string
  profissional_id: number | null
  profissional_nome: string | null
  paciente_id: number | null
  paciente_nome: string | null
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  descricao_evolucao: string | null
  status_execucao: string | null
}

type ResultadoGrade = { linhas: LinhaGrade[] } | { erro: string }

/**
 * Percorre a grade em páginas de 1000 até a última, para o período inteiro
 * caber no resultado. Sem isto o PostgREST devolve só a primeira página e não
 * avisa — ver o comentário de TAMANHO_PAGINA.
 */
async function buscarGradePaginada(
  supabase: ReturnType<typeof getSupabaseClient>,
  dataInicio: string,
  filtros: FiltrosAuditoriaEvolucoes
): Promise<ResultadoGrade> {
  const r = await paginarEmParalelo<LinhaGrade>(pagina => {
    let query = supabase
      .from('csv_grades_profissionais')
      .select(COLUNAS_GRADE)
      .gte('data', dataInicio)
      .eq('ativo', true)
      .not('descricao_evolucao', 'is', null)
      .neq('descricao_evolucao', '')
      .order('data', { ascending: false })
      .order('id', { ascending: false }) // desempate estável entre páginas
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1)

    if (filtros.dataFim) query = query.lte('data', filtros.dataFim)
    if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
    return query as unknown as PromiseLike<{ data: LinhaGrade[] | null; error: { message: string } | null }>
  })

  return 'erro' in r ? { erro: `Erro ao buscar grade: ${r.erro}` } : r
}

/**
 * Caminho invertido: com filtro de risco/cobrança ativo, quem manda é a
 * auditoria. Filtrar no banco (centenas de linhas) e só então buscar as sessões
 * correspondentes evita arrastar milhares de linhas para descartar quase todas
 * — e, principalmente, não deixa o corte de 1000 esconder a auditoria que a
 * pessoa está justamente procurando.
 */
async function buscarGradePelaAuditoria(
  supabase: ReturnType<typeof getSupabaseClient>,
  dataInicio: string,
  filtros: FiltrosAuditoriaEvolucoes
): Promise<ResultadoGrade> {
  const alvos = await paginarEmParalelo<{ grade_id: string }>(pagina => {
    let query = supabase
      .from('auditoria_evolucoes')
      .select('grade_id')
      .gte('data_sessao', dataInicio)
      .order('data_sessao', { ascending: false })
      .order('grade_id', { ascending: false })
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1)

    if (filtros.dataFim) query = query.lte('data_sessao', filtros.dataFim)
    if (filtros.statusRisco === 'com_risco') {
      query = query.neq('status_risco', 'sem_risco')
    } else if (filtros.statusRisco && filtros.statusRisco !== 'todos') {
      query = query.eq('status_risco', filtros.statusRisco)
    }
    if (filtros.statusCobranca && filtros.statusCobranca !== 'todos') {
      query = query.eq('status_cobranca', filtros.statusCobranca)
    }
    if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
    return query as unknown as PromiseLike<{ data: { grade_id: string }[] | null; error: { message: string } | null }>
  })
  if ('erro' in alvos) return { erro: `Erro ao buscar auditorias: ${alvos.erro}` }
  const idsAlvo = alvos.linhas.map(a => a.grade_id)

  if (idsAlvo.length === 0) return { linhas: [] }

  // Buscar as sessões dessas auditorias, em blocos para não estourar a URL.
  const linhas: LinhaGrade[] = []
  const blocos: string[][] = []
  for (let i = 0; i < idsAlvo.length; i += 200) blocos.push(idsAlvo.slice(i, i + 200))

  const respostas = await emParalelo(
    blocos.map(chunk => () => {
      let query = supabase
        .from('csv_grades_profissionais')
        .select(COLUNAS_GRADE)
        .in('id', chunk)
        .eq('ativo', true)
      if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
      if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
      return query
    })
  )
  for (const { data, error } of respostas) {
    if (error) return { erro: `Erro ao buscar grade: ${error.message}` }
    if (data) linhas.push(...(data as unknown as LinhaGrade[]))
  }

  linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
  return { linhas }
}

/**
 * Agrupa as auditorias por profissional para a visão de cobrança / ranking.
 *
 * `grupos`: os grupos de duplicadas já calculados sobre a MESMA lista de
 * `evolucoes` (ver `detectarEvolucoesDuplicadasEntrePacientes`) — passa-los
 * aqui evita recalcular a detecção, que já roda uma vez na Shell.
 */
export function calcularResumoProfissionais(
  evolucoes: EvolucaoPendenteAuditoria[],
  grupos: GrupoEvolucaoDuplicada[] = []
): ResumoProfissionalAuditoria[] {
  const mapa = new Map<string, ResumoProfissionalAuditoria>()

  const duplicadasPorGradeId = new Set<string>()
  for (const grupo of grupos) {
    for (const item of grupo.itens) duplicadasPorGradeId.add(item.grade_id)
  }

  for (const item of evolucoes) {
    const key = item.profissional_id ? String(item.profissional_id) : item.profissional_nome

    if (!mapa.has(key)) {
      mapa.set(key, {
        profissional_id: item.profissional_id,
        profissional_nome: item.profissional_nome,
        terapia_nome: item.terapia_nome,
        unidade_nome: item.unidade_nome,
        total_evolucoes: 0,
        total_auditadas: 0,
        sem_risco: 0,
        risco_especifico: 0,
        risco_relevante: 0,
        pendentes_cobranca: 0,
        taxa_conformidade: 0,
        evolucoes_com_risco: [],
        duplicadas: 0
      })
    }

    const resumo = mapa.get(key)!
    resumo.total_evolucoes++

    if (duplicadasPorGradeId.has(item.grade_id)) {
      resumo.duplicadas++
    }

    if (item.auditoria) {
      resumo.total_auditadas++
      if (item.auditoria.status_risco === 'sem_risco') {
        resumo.sem_risco++
      } else if (item.auditoria.status_risco === 'risco_especifico') {
        resumo.risco_especifico++
        resumo.evolucoes_com_risco.push(item.auditoria)
      } else if (item.auditoria.status_risco === 'risco_relevante') {
        resumo.risco_relevante++
        resumo.evolucoes_com_risco.push(item.auditoria)
      }

      // "Ok e sem duplicidade" não precisa de cobrança — mesmo sem risco de
      // glosa, uma evolução duplicada ainda exige contato com o terapeuta.
      if (
        item.auditoria.status_cobranca === 'pendente' &&
        (item.auditoria.status_risco !== 'sem_risco' || duplicadasPorGradeId.has(item.grade_id))
      ) {
        resumo.pendentes_cobranca++
      }
    }
  }

  const lista = Array.from(mapa.values())

  for (const r of lista) {
    r.taxa_conformidade = r.total_auditadas > 0 
      ? Math.round((r.sem_risco / r.total_auditadas) * 100) 
      : 0
  }

  // Ordenar prioritariamente quem tem mais riscos relevantes e pendências de cobrança
  return lista.sort((a, b) => {
    if (b.risco_relevante !== a.risco_relevante) {
      return b.risco_relevante - a.risco_relevante
    }
    if (b.risco_especifico !== a.risco_especifico) {
      return b.risco_especifico - a.risco_especifico
    }
    return a.taxa_conformidade - b.taxa_conformidade
  })
}

/**
 * Normaliza o texto para comparação: minúsculas, sem acento, espaços e
 * pontuação colapsados. Duas evoluções copiadas raramente ficam byte-a-byte
 * idênticas — um espaço duplo ou uma vírgula a mais não pode esconder a cópia.
 */
function normalizarTextoEvolucao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Conjunto de trigramas de caracteres — a unidade que a similaridade compara. */
function trigramas(texto: string): Set<string> {
  const t = `  ${texto} `
  const set = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) {
    set.add(t.slice(i, i + 3))
  }
  return set
}

/**
 * Coeficiente de Dice sobre trigramas: 1 = idêntico, 0 = nada em comum.
 * Robusto a pequenas edições (uma frase trocada, uma data diferente) que o
 * texto normalizado exato deixaria passar — é justamente o copy-paste com
 * retoque que se quer pescar.
 */
function similaridade(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersecao = 0
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a]
  for (const tri of menor) {
    if (maior.has(tri)) intersecao++
  }
  return (2 * intersecao) / (a.size + b.size)
}

export interface GrupoEvolucaoDuplicada {
  chave: string
  profissional_id: number | null
  profissional_nome: string
  /** Menor similaridade entre qualquer par do grupo — o "pior caso", não a média. */
  similaridadeMinima: number
  itens: EvolucaoPendenteAuditoria[]
}

/**
 * Evoluções PARECIDAS ou IDÊNTICAS, do MESMO profissional, lançadas em
 * pacientes DIFERENTES — a assinatura de quem copia e cola a evolução de um
 * atendimento para preencher outro, com ou sem retoque. Mesmo paciente com o
 * texto repetido em duas sessões não entra aqui: isso é rotina de terapia,
 * não a falha que se quer pescar.
 *
 * Comparação par a par dentro de cada profissional (O(n²) por profissional,
 * não no total) e agrupamento por componente conexo: se A~B e B~C acima do
 * limiar, os três formam um grupo mesmo que A e C sozinhos fiquem abaixo.
 */
export function detectarEvolucoesDuplicadasEntrePacientes(
  evolucoes: EvolucaoPendenteAuditoria[],
  limiarSimilaridade = 0.75
): GrupoEvolucaoDuplicada[] {
  const TAMANHO_MINIMO = 20 // texto curto ("Sessão realizada.") coincide por ser curto, não por ser cópia

  const porProfissional = new Map<string, EvolucaoPendenteAuditoria[]>()
  for (const item of evolucoes) {
    const texto = item.texto_original?.trim()
    if (!texto || texto.length < TAMANHO_MINIMO) continue
    const profKey = item.profissional_id ? String(item.profissional_id) : item.profissional_nome
    if (!porProfissional.has(profKey)) porProfissional.set(profKey, [])
    porProfissional.get(profKey)!.push(item)
  }

  const grupos: GrupoEvolucaoDuplicada[] = []

  for (const [profKey, itensProf] of porProfissional) {
    const normalizados = itensProf.map(i => normalizarTextoEvolucao(i.texto_original!.trim()))
    const trigramasPorItem = normalizados.map(trigramas)

    // Union-find simples: cada item começa isolado, pares acima do limiar se fundem.
    const pai = itensProf.map((_, i) => i)
    const encontrar = (i: number): number => (pai[i] === i ? i : (pai[i] = encontrar(pai[i])))
    const unir = (i: number, j: number) => {
      const ri = encontrar(i)
      const rj = encontrar(j)
      if (ri !== rj) pai[ri] = rj
    }

    // Menor similaridade observada em CADA ARESTA que uniu o par — não a do grupo final.
    const piorArestaPorPar = new Map<string, number>()

    for (let i = 0; i < itensProf.length; i++) {
      for (let j = i + 1; j < itensProf.length; j++) {
        const pacienteI = itensProf[i].paciente_id ? String(itensProf[i].paciente_id) : itensProf[i].paciente_nome
        const pacienteJ = itensProf[j].paciente_id ? String(itensProf[j].paciente_id) : itensProf[j].paciente_nome
        if (pacienteI === pacienteJ) continue // mesmo paciente: repetição é rotina, não o caso

        const sim = similaridade(trigramasPorItem[i], trigramasPorItem[j])
        if (sim < limiarSimilaridade) continue

        unir(i, j)
        const raiz = encontrar(i)
        piorArestaPorPar.set(String(raiz), Math.min(piorArestaPorPar.get(String(raiz)) ?? 1, sim))
      }
    }

    const porRaiz = new Map<number, number[]>()
    for (let i = 0; i < itensProf.length; i++) {
      const raiz = encontrar(i)
      if (!porRaiz.has(raiz)) porRaiz.set(raiz, [])
      porRaiz.get(raiz)!.push(i)
    }

    for (const [raiz, indices] of porRaiz) {
      if (indices.length < 2) continue // grupo de 1 = não achou par acima do limiar

      const pacientesDistintos = new Set(
        indices.map(i => (itensProf[i].paciente_id ? String(itensProf[i].paciente_id) : itensProf[i].paciente_nome))
      )
      if (pacientesDistintos.size < 2) continue

      grupos.push({
        chave: `${profKey}::${raiz}`,
        profissional_id: itensProf[indices[0]].profissional_id,
        profissional_nome: itensProf[indices[0]].profissional_nome,
        similaridadeMinima: piorArestaPorPar.get(String(raiz)) ?? limiarSimilaridade,
        itens: indices
          .map(i => itensProf[i])
          .sort((a, b) => (a.data_sessao < b.data_sessao ? 1 : -1))
      })
    }
  }

  return grupos.sort((a, b) => b.similaridadeMinima - a.similaridadeMinima)
}

/** Trechos de um texto marcados como coincidentes (`true`) ou não com o outro lado. */
export interface TrechoComparado {
  texto: string
  coincide: boolean
}

/**
 * Marca, em cada um dos dois textos, as palavras que fazem parte da MAIOR
 * sequência comum entre eles (LCS por palavra) — o miolo que se repete de um
 * paciente para o outro, para o olho ir direto ao que foi copiado sem reler
 * o texto inteiro em busca da coincidência.
 */
export function compararTextosParaDestaque(
  textoA: string,
  textoB: string
): { a: TrechoComparado[]; b: TrechoComparado[] } {
  // Cada "palavra" carrega o espaço/pontuação que a segue, para a junção não
  // perder a formatação original do texto.
  const tokenizar = (t: string) => t.match(/\S+\s*/g) || []
  const normalizarToken = (tok: string) => normalizarTextoEvolucao(tok.trim())

  const tokensA = tokenizar(textoA)
  const tokensB = tokenizar(textoB)
  const normA = tokensA.map(normalizarToken)
  const normB = tokensB.map(normalizarToken)

  const n = normA.length
  const m = normB.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = normA[i] && normA[i] === normB[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const marcaA = new Array(n).fill(false)
  const marcaB = new Array(m).fill(false)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (normA[i] && normA[i] === normB[j]) {
      marcaA[i] = true
      marcaB[j] = true
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }

  // Junta tokens vizinhos com a mesma marcação num único trecho, para o
  // realce virar poucos <mark> em vez de um por palavra.
  const agrupar = (tokens: string[], marcas: boolean[]): TrechoComparado[] => {
    const trechos: TrechoComparado[] = []
    for (let k = 0; k < tokens.length; k++) {
      const ultimo = trechos[trechos.length - 1]
      if (ultimo && ultimo.coincide === marcas[k]) {
        ultimo.texto += tokens[k]
      } else {
        trechos.push({ texto: tokens[k], coincide: marcas[k] })
      }
    }
    return trechos
  }

  return { a: agrupar(tokensA, marcaA), b: agrupar(tokensB, marcaB) }
}

/**
 * Atualiza o status de cobrança de uma evolução auditada
 */
export async function atualizarStatusCobranca(params: {
  auditoriaId: string
  novoStatus: StatusCobrancaEvolucao
  usuarioNome: string
  observacao?: string
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabaseClient()
  
  try {
    // Buscar histórico atual
    const { data: atual, error: buscaErr } = await supabase
      .from('auditoria_evolucoes')
      .select('historico_cobranca, status_cobranca')
      .eq('id', params.auditoriaId)
      .single()

    if (buscaErr) {
      return { ok: false, error: buscaErr.message }
    }

    const historico = Array.isArray(atual.historico_cobranca) ? [...atual.historico_cobranca] : []
    
    historico.push({
      data: new Date().toISOString(),
      usuario: params.usuarioNome || 'Usuário do sistema',
      acao: `Alterou status para ${params.novoStatus}`,
      observacao: params.observacao || undefined
    })

    const updatePayload: any = {
      status_cobranca: params.novoStatus,
      historico_cobranca: historico,
      updated_at: new Date().toISOString()
    }

    if (params.novoStatus === 'cobrado') {
      updatePayload.cobrado_em = new Date().toISOString()
      updatePayload.cobrado_por_nome = params.usuarioNome
    }

    const { error: updErr } = await supabase
      .from('auditoria_evolucoes')
      .update(updatePayload)
      .eq('id', params.auditoriaId)

    if (updErr) {
      return { ok: false, error: updErr.message }
    }

    return { ok: true, error: null }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Erro ao atualizar cobrança' }
  }
}
