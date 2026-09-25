import { getSupabaseClient } from '@/lib/supabase/client'
import type { PepAjusteLinha, PepApuracaoMensal } from '@/types/pep'
import { getCatalogoItens, getPlanejamentoSemestral, getRegistrosEntrega, getRegistrosSemestraisPorPacientes } from '@/services/pep.service'
import { getCalendarioCompetencia } from '@/services/pepCalendario.service'
import { getFeriados } from '@/services/feriados.service'
import { semanasEsperadas } from '@/lib/remuneracao/semanasCompetencia'
import { registrarAuditoria } from '@/services/pepAuditoria.service'
import {
  calcularPEPPaciente,
  COMPETENCIA_TESTE_PEP,
  type EntregaRecorrente,
  type PendenciaSemestral,
} from '@/lib/remuneracao/calculoPEP'

export function competenciaAnterior(competencia: string): string {
  const [y, m] = competencia.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// PRD Seção 11 — "Até dia 5: Clínica confere e informa o Faturamento
// Liberado." Congela a apuração da competência: recálculos futuros não
// tocam mais essas linhas (ver o guard em apurarESalvarPEP).
export async function liberarFaturamento(
  prestadorNome: string, competencia: string
): Promise<{ ok: boolean; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .update({ estado: 'liberado', liberado_em: new Date().toISOString(), liberado_por: user?.id ?? null })
    .eq('prestador_nome', prestadorNome)
    .eq('competencia', competencia)
    .eq('estado', 'apurado')
    .select('id')
  if (error) {
    console.error('Erro liberarFaturamento:', error)
    return { ok: false, error }
  }
  for (const row of data ?? []) {
    await registrarAuditoria({
      tabela: 'apuracao_mensal', registroId: row.id, acao: 'editar',
      prestadorNome, competencia, depois: { estado: 'liberado' },
      motivo: 'Faturamento liberado',
    })
  }
  return { ok: true, error: null }
}

// Reabrir é alteração manual (Seção 11.4) — exige motivo, fica em trilha de
// auditoria, e volta a competência para o fluxo normal de recálculo.
export async function reabrirFaturamento(
  prestadorNome: string, competencia: string, motivo: string
): Promise<{ ok: boolean; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .update({ estado: 'apurado', liberado_em: null, liberado_por: null })
    .eq('prestador_nome', prestadorNome)
    .eq('competencia', competencia)
    .eq('estado', 'liberado')
    .select('id')
  if (error) {
    console.error('Erro reabrirFaturamento:', error)
    return { ok: false, error }
  }
  for (const row of data ?? []) {
    await registrarAuditoria({
      tabela: 'apuracao_mensal', registroId: row.id, acao: 'editar',
      prestadorNome, competencia, antes: { estado: 'liberado' }, depois: { estado: 'apurado' },
      motivo,
    })
  }
  return { ok: true, error: null }
}

export async function getApuracaoMes(
  prestadorNome: string,
  competencia: string
): Promise<{ data: PepApuracaoMensal[] | null; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .select('*')
    .eq('prestador_nome', prestadorNome)
    .eq('competencia', competencia)
  if (error) {
    console.error('Erro getApuracaoMes:', error)
    return { data: null, error }
  }
  return { data: data as PepApuracaoMensal[], error: null }
}

// Resumo por prestador (soma de potencial/alcançado) numa competência — para
// indicadores read-only (ex.: card de /relacionamento-prestador/rp/), sem
// disparar novo cálculo/gravação. Se nunca apurado na aba Entregas PEP,
// simplesmente não aparece no mapa.
export async function getApuracaoResumoTodosPrestadores(
  competencia: string
): Promise<{ data: Map<string, { potencial: number; alcancado: number }>; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .select('prestador_nome, valor_bruto, valor_liquido')
    .eq('competencia', competencia)
  if (error) {
    console.error('Erro getApuracaoResumoTodosPrestadores:', error)
    return { data: new Map(), error }
  }
  const mapa = new Map<string, { potencial: number; alcancado: number }>()
  for (const row of data ?? []) {
    const atual = mapa.get(row.prestador_nome) ?? { potencial: 0, alcancado: 0 }
    mapa.set(row.prestador_nome, {
      potencial: atual.potencial + Number(row.valor_bruto),
      alcancado: atual.alcancado + Number(row.valor_liquido),
    })
  }
  return { data: mapa, error: null }
}

/** Uma linha de pep_apuracao_mensal, só com o que a visão geral do mês lê. */
export type PepApuracaoLinhaCompetencia = Pick<
  PepApuracaoMensal,
  | 'prestador_nome' | 'paciente_nome'
  | 'valor_bruto' | 'valor_liquido'
  | 'ajuste_recorrentes_valor' | 'ajuste_semestrais_valor' | 'devolucao_valor'
  | 'saldo_remanescente_anterior' | 'saldo_remanescente_novo'
  | 'estado' | 'modo_teste'
>

const PAGINA_APURACAO = 1000

// Todas as linhas de uma competência, de todos os prestadores — fonte da
// visão geral de Entregas PEP (antes de escolher um analista). SÓ LEITURA: não
// chama apurarESalvarPEP; "não apurado" é justamente a ausência de linha.
//
// Pagina de propósito: o PostgREST corta em 1000 linhas SEM erro, e uma
// competência tem uma linha por paciente — com a clínica crescendo, a soma do
// mês ficaria errada calada. `order('id')` deixa as páginas estáveis.
export async function getApuracaoCompetencia(
  competencia: string
): Promise<{ data: PepApuracaoLinhaCompetencia[]; error: unknown }> {
  const supabase = getSupabaseClient()
  const linhas: PepApuracaoLinhaCompetencia[] = []
  for (let de = 0; ; de += PAGINA_APURACAO) {
    const { data, error } = await supabase
      .from('pep_apuracao_mensal')
      .select('prestador_nome, paciente_nome, valor_bruto, valor_liquido, ajuste_recorrentes_valor, ajuste_semestrais_valor, devolucao_valor, saldo_remanescente_anterior, saldo_remanescente_novo, estado, modo_teste')
      .eq('competencia', competencia)
      .order('id')
      .range(de, de + PAGINA_APURACAO - 1)
    if (error) {
      console.error('Erro getApuracaoCompetencia:', error)
      return { data: [], error }
    }
    const pagina = (data ?? []) as PepApuracaoLinhaCompetencia[]
    linhas.push(...pagina)
    if (pagina.length < PAGINA_APURACAO) break
  }
  return { data: linhas, error: null }
}

// Lista de prestadores com pelo menos uma apuração — fonte do seletor da aba
// PEP - Histórico. Vem de pep_apuracao_mensal, não do roster da Grade: por
// isso continua listando prestadores que já saíram da clínica.
export async function getPrestadoresComApuracao(): Promise<{ data: string[]; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .select('prestador_nome')
  if (error) {
    console.error('Erro getPrestadoresComApuracao:', error)
    return { data: [], error }
  }
  const nomes = Array.from(new Set((data ?? []).map(r => r.prestador_nome as string))).sort((a, b) => a.localeCompare(b))
  return { data: nomes, error: null }
}

// Todas as competências apuradas de um paciente, mais antigas primeiro —
// serve tanto ao histórico (dashboard potencial × alcançado) quanto à busca
// de ajustes semestrais ainda não devolvidos (Seção 9.6).
export async function getApuracaoHistoricoPaciente(
  pacienteNome: string
): Promise<{ data: PepApuracaoMensal[] | null; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .select('*')
    .eq('paciente_nome', pacienteNome)
    .order('competencia', { ascending: true })
  if (error) {
    console.error('Erro getApuracaoHistoricoPaciente:', error)
    return { data: null, error }
  }
  return { data: data as PepApuracaoMensal[], error: null }
}

// Histórico agregado por prestador (soma de todos os pacientes em cada
// competência) — base do dashboard "potencial × alcançado" por profissional.
export async function getApuracaoHistoricoPrestador(
  prestadorNome: string
): Promise<{ data: PepApuracaoMensal[] | null; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('pep_apuracao_mensal')
    .select('*')
    .eq('prestador_nome', prestadorNome)
    .order('competencia', { ascending: true })
  if (error) {
    console.error('Erro getApuracaoHistoricoPrestador:', error)
    return { data: null, error }
  }
  return { data: data as PepApuracaoMensal[], error: null }
}

export type PontoEvolucaoMensal = { competencia: string; potencial: number; alcancado: number }

// Soma potencial/alcançado de todos os pacientes por competência — o ponto
// a ponto do gráfico de evolução mensal.
export async function getEvolucaoMensalPrestador(
  prestadorNome: string
): Promise<{ data: PontoEvolucaoMensal[]; error: unknown }> {
  const { data: linhas, error } = await getApuracaoHistoricoPrestador(prestadorNome)
  if (error || !linhas) return { data: [], error }

  const mapa = new Map<string, PontoEvolucaoMensal>()
  for (const linha of linhas) {
    const ponto = mapa.get(linha.competencia) ?? { competencia: linha.competencia, potencial: 0, alcancado: 0 }
    ponto.potencial += Number(linha.valor_bruto)
    ponto.alcancado += Number(linha.valor_liquido)
    mapa.set(linha.competencia, ponto)
  }
  return { data: Array.from(mapa.values()).sort((a, b) => a.competencia.localeCompare(b.competencia)), error: null }
}

// estado/liberado_em/liberado_por ficam de fora de propósito: não fazem parte
// do que o recálculo escreve (Postgres upsert só atualiza as colunas do
// payload) — assim uma competência "liberada" não é destravada por recálculo.
async function upsertApuracaoMensal(
  row: Omit<PepApuracaoMensal, 'id' | 'calculado_em' | 'estado' | 'liberado_em' | 'liberado_por'>
): Promise<{ error: unknown }> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('pep_apuracao_mensal')
    .upsert({
      paciente_nome: row.paciente_nome,
      paciente_cpf: row.paciente_cpf,
      prestador_nome: row.prestador_nome,
      competencia: row.competencia,
      valor_bruto: row.valor_bruto,
      ajuste_recorrentes: row.ajuste_recorrentes,
      ajuste_semestrais: row.ajuste_semestrais,
      ajuste_recorrentes_valor: row.ajuste_recorrentes_valor,
      ajuste_semestrais_valor: row.ajuste_semestrais_valor,
      saldo_remanescente_anterior: row.saldo_remanescente_anterior,
      devolucao_valor: row.devolucao_valor,
      valor_liquido: row.valor_liquido,
      saldo_remanescente_novo: row.saldo_remanescente_novo,
      modo_teste: row.modo_teste,
      calculado_em: new Date().toISOString(),
      calculado_por: user?.id ?? null,
    }, { onConflict: 'paciente_nome,competencia' })
  if (error) console.error('Erro upsertApuracaoMensal:', error)
  return { error }
}

// Seção 9.6 — devolução integral: soma os ajustes semestrais desse item já
// aplicados em competências anteriores e ainda não devolvidos, marca-os como
// devolvidos, e retorna o total a creditar na competência atual.
async function creditarDevolucaoRetroativa(
  pacienteNome: string,
  itemCodigo: string,
  antesDe: string
): Promise<number> {
  const { data: historico } = await getApuracaoHistoricoPaciente(pacienteNome)
  if (!historico) return 0

  let total = 0
  for (const apuracao of historico) {
    if (apuracao.competencia >= antesDe) continue
    const linhas = apuracao.ajuste_semestrais as PepAjusteLinha[]
    let mudou = false
    const novasLinhas = linhas.map(l => {
      if (l.itemCodigo === itemCodigo && !l.devolvido) {
        total += l.valor
        mudou = true
        return { ...l, devolvido: true }
      }
      return l
    })
    if (mudou) {
      const supabase = getSupabaseClient()
      await supabase
        .from('pep_apuracao_mensal')
        .update({ ajuste_semestrais: novasLinhas })
        .eq('id', apuracao.id)
    }
  }
  return Math.round((total + Number.EPSILON) * 100) / 100
}

export type ResultadoApuracaoPaciente = PepApuracaoMensal

// Apura a PEP de todos os pacientes de um prestador numa competência e
// persiste o resultado (pep_apuracao_mensal). valorMensalPorPaciente é V —
// hoje um valor único por prestador (cc_pe_default), igual à PE atual; o PRD
// prevê parametrização por paciente/contrato como item pendente (Seção 13.3).
export async function apurarESalvarPEP(input: {
  prestadorNome: string
  competencia: string
  pacientes: Array<{ nome: string; cpf?: string | null }>
  valorMensalPorPaciente: number
}): Promise<{ resultados: ResultadoApuracaoPaciente[]; totalPrestador: number; error?: unknown }> {
  const pacientesNomes = input.pacientes.map(p => p.nome)
  const [
    { data: catalogo, error: errCatalogo },
    { data: registros, error: errRegistros },
    { data: planejamento, error: errPlano },
    { data: registrosSemestrais, error: errRegSemestrais },
  ] = await Promise.all([
    getCatalogoItens(),
    getRegistrosEntrega(input.prestadorNome, input.competencia),
    getPlanejamentoSemestral(pacientesNomes),
    // Histórico COMPLETO (sem escopo de mês nem de prestador) — checar se um
    // item semestral já foi entregue não pode olhar só a competência sendo
    // apurada agora, senão uma entrega no prazo/atrasada (que não dispara
    // reprogramação automática) faria o ajuste ser reaplicado todo mês para
    // sempre, mesmo já entregue.
    getRegistrosSemestraisPorPacientes(pacientesNomes),
  ])

  const erro = errCatalogo || errRegistros || errPlano || errRegSemestrais
  if (erro || !catalogo || !registros || !planejamento || !registrosSemestrais) {
    return { resultados: [], totalPrestador: 0, error: erro ?? new Error('Falha ao carregar dados da PEP') }
  }

  const itensRecorrentes = catalogo.filter(i => i.classe === 'recorrente')
  const itensSemestrais = catalogo.filter(i => i.classe === 'semestral')

  // PRD Seção 9.11: só os itens semanais (Supervisão/Estudo) variam com o
  // calendário — mês de recesso espera 3 unidades em vez de 4. Um override
  // publicado em pep_calendario_competencias (§13.8) tem prioridade; na
  // ausência dele, calcula automaticamente a partir dos feriados cadastrados
  // (mesma função que a tela usa — apuração e tela nunca podem divergir).
  const [{ data: calendario }, { data: feriados }] = await Promise.all([
    getCalendarioCompetencia(input.competencia),
    getFeriados(),
  ])
  const semanasCalendario = calendario?.semanas_supervisao_estudo ?? semanasEsperadas(input.competencia, feriados)

  const registrosGerais = registros.filter(r => r.paciente_nome === null)
  const entregasGerais: EntregaRecorrente[] = itensRecorrentes
    .filter(i => i.tipo_registro === 'GERAL')
    .map(item => {
      const registro = registrosGerais.find(r => r.item_id === item.id)
      return {
        itemCodigo: item.codigo,
        pesoMensal: item.peso_mensal,
        quantidadeEsperada: item.periodicidade === 'semanal' ? semanasCalendario : (item.qtd_referencia_mes ?? 1),
        quantidadeEntregue: registro?.quantidade_entregue ?? 0,
      }
    })

  const { data: apuracaoAnteriorRows } = await getApuracaoMes(input.prestadorNome, competenciaAnterior(input.competencia))
  const saldoAnteriorPorPaciente = new Map((apuracaoAnteriorRows ?? []).map(a => [a.paciente_nome, a.saldo_remanescente_novo]))

  // PRD Seção 11 — competência com Faturamento Liberado fica congelada: novos
  // registros/edições não recalculam o que já foi liberado (referência da
  // Nota Fiscal). Reabrir é ação manual explícita (reabrirFaturamento).
  const { data: apuracaoAtualRows } = await getApuracaoMes(input.prestadorNome, input.competencia)
  const apuracaoAtualPorPaciente = new Map((apuracaoAtualRows ?? []).map(a => [a.paciente_nome, a]))

  const modoTeste = input.competencia === COMPETENCIA_TESTE_PEP
  const resultados: ResultadoApuracaoPaciente[] = []

  for (const paciente of input.pacientes) {
    const existenteLiberado = apuracaoAtualPorPaciente.get(paciente.nome)
    if (existenteLiberado?.estado === 'liberado') {
      resultados.push(existenteLiberado)
      continue
    }

    const registrosPaciente = registros.filter(r => r.paciente_nome === paciente.nome)
    const registrosSemestraisPaciente = registrosSemestrais.filter(r => r.paciente_nome === paciente.nome)

    const entregasPorPaciente: EntregaRecorrente[] = itensRecorrentes
      .filter(i => i.tipo_registro === 'POR_PACIENTE')
      .map(item => {
        const registro = registrosPaciente.find(r => r.item_id === item.id)
        return {
          itemCodigo: item.codigo,
          pesoMensal: item.peso_mensal,
          quantidadeEsperada: item.qtd_referencia_mes ?? 1,
          quantidadeEntregue: registro?.quantidade_entregue ?? 0,
        }
      })

    const pendenciasSemestrais: PendenciaSemestral[] = []
    let devolucaoValor = 0
    for (const item of itensSemestrais) {
      const plano = planejamento.find(p => p.paciente_nome === paciente.nome && p.item_id === item.id)
      if (!plano) continue
      // Um paciente pode acumular mais de um registro histórico do mesmo item
      // semestral (um por ciclo de 6 meses, quando a entrega antecipada
      // reprograma automaticamente o próximo ciclo) — pega sempre o mais
      // recente por competência, mesmo critério de registroSemestralDe em
      // usePepEntregas.ts, para o motor de cálculo nunca divergir da tela.
      const registro = registrosSemestraisPaciente
        .filter(r => r.item_id === item.id)
        .sort((a, b) => b.competencia.localeCompare(a.competencia))[0]
      const entregue = registro?.status === 'entregue'
      // Seção 9.6 (aceite normal) e 11.4-iii (aceite de REP-) — ambos podem
      // estornar ajustes já aplicados em competências anteriores. Idempotente:
      // creditarDevolucaoRetroativa só credita entradas ainda não marcadas.
      if (entregue || plano.origem === 'reprogramacao_impedimento') {
        devolucaoValor += await creditarDevolucaoRetroativa(paciente.nome, item.codigo, input.competencia)
      }
      if (entregue) continue
      if (plano.competencia_planejada <= input.competencia) {
        pendenciasSemestrais.push({ itemCodigo: item.codigo, percentualAjuste: item.peso_mensal })
      }
    }

    const resultado = calcularPEPPaciente({
      valorBruto: input.valorMensalPorPaciente,
      entregasRecorrentes: [...entregasGerais, ...entregasPorPaciente],
      pendenciasSemestrais,
      saldoRemanescenteAnterior: saldoAnteriorPorPaciente.get(paciente.nome) ?? 0,
      modoTeste,
    })

    const valorLiquidoComDevolucao = Math.round((resultado.valorLiquido + devolucaoValor + Number.EPSILON) * 100) / 100

    const linha: Omit<PepApuracaoMensal, 'id' | 'calculado_em' | 'estado' | 'liberado_em' | 'liberado_por'> = {
      paciente_nome: paciente.nome,
      paciente_cpf: paciente.cpf ?? null,
      prestador_nome: input.prestadorNome,
      competencia: input.competencia,
      valor_bruto: resultado.valorBruto,
      ajuste_recorrentes: resultado.ajusteRecorrentes,
      ajuste_semestrais: resultado.ajusteSemestrais,
      ajuste_recorrentes_valor: resultado.ajusteRecorrentesValor,
      ajuste_semestrais_valor: resultado.ajusteSemestraisValor,
      saldo_remanescente_anterior: resultado.saldoRemanescenteAnteriorAplicado,
      devolucao_valor: devolucaoValor,
      valor_liquido: valorLiquidoComDevolucao,
      saldo_remanescente_novo: resultado.saldoRemanescenteNovo,
      modo_teste: resultado.modoTeste,
    }

    await upsertApuracaoMensal(linha)
    resultados.push({
      ...linha, id: '', calculado_em: new Date().toISOString(),
      estado: 'apurado', liberado_em: null, liberado_por: null,
    })
  }

  const totalPrestador = Math.round((resultados.reduce((s, r) => s + r.valor_liquido, 0) + Number.EPSILON) * 100) / 100
  return { resultados, totalPrestador }
}
