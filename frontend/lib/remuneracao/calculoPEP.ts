// Motor de cálculo da PEP (Parcela por Entregas por Paciente) — Analista do
// Comportamento, conforme Seção 9 do PRD "Sistema de Faturamento de
// Prestadores (PA/PEP) v2.7". Funções puras, sem I/O — a apuração real por
// paciente/competência (Fase 3.2) monta este input a partir de
// pep_registros_entrega / pep_planejamento_semestral e persiste o resultado.
//
// Não mexe em PA (resolverPARow em calculo.ts) nem depende dele.

// Seção 13.7 do PRD: agosto/2026 apura e demonstra a PEP, mas sem efeito no
// faturamento; setembro/2026 marca o início da apuração com efeito.
export const COMPETENCIA_TESTE_PEP = "2026-08"

export function arredondar(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export type EntregaRecorrente = {
  itemCodigo: string
  pesoMensal: number       // fração de V, ex.: 0.30 (Supervisão)
  quantidadeEsperada: number // já ajustada pelo calendário parametrizado (Seção 9.11)
  quantidadeEntregue: number
  // Quantas das entregues o robô SharePoint marcou (pep_registros_entrega.
  // quantidade_robo). Só divide o crédito entre robô e pessoa — não muda o
  // valor apurado.
  quantidadeRobo?: number
}

export type PendenciaSemestral = {
  itemCodigo: string
  percentualAjuste: number // 0.10 / 0.20 / 0.20 (Seção 7.2)
  // Reprogramação por impedimento terapêutico vigente (REP-, Seção 9.7):
  // suspende o ajuste enquanto a reprogramação estiver em vigor.
  suspensaPorReprogramacao?: boolean
}

export type AjusteLinha = { itemCodigo: string; percentual: number; valor: number }

export type ResultadoPEPPaciente = {
  valorBruto: number                 // V, valor mensal integral do paciente
  ajusteRecorrentes: AjusteLinha[]
  ajusteSemestrais: AjusteLinha[]
  ajusteRecorrentesValor: number
  ajusteSemestraisValor: number
  // Valor das entregas recorrentes (V − ajusteRecorrentesValor) dividido por
  // quem marcou cada unidade. valorRobo + valorHumano = V − ajusteRecorrentesValor.
  valorRobo: number
  valorHumano: number
  saldoRemanescenteAnteriorAplicado: number
  valorLiquido: number
  saldoRemanescenteNovo: number
  modoTeste: boolean
}

// Seção 9.2 — cada recorrente não entregue reduz seu peso unitário
// (peso mensal ÷ quantidade esperada no mês, Seção 7.1/9.11).
export function calcularAjusteRecorrentes(entregas: EntregaRecorrente[], valorBruto: number): AjusteLinha[] {
  return entregas.map(e => {
    const pesoUnitario = e.quantidadeEsperada > 0 ? e.pesoMensal / e.quantidadeEsperada : 0
    const faltantes = Math.max(0, e.quantidadeEsperada - e.quantidadeEntregue)
    const percentual = Math.min(e.pesoMensal, faltantes * pesoUnitario)
    return { itemCodigo: e.itemCodigo, percentual, valor: arredondar(percentual * valorBruto) }
  })
}

// Crédito por unidade (decisão do usuário, 01/10/2026): cada unidade entregue
// vale peso ÷ esperado × V e é creditada a quem a marcou. As unidades do robô
// contam primeiro até o esperado; o resto do valor das entregas é da pessoa —
// assim robô + pessoa fecha exatamente com V − ajuste dos recorrentes.
export function calcularCreditoPorOrigem(entregas: EntregaRecorrente[], valorBruto: number): { valorRobo: number; valorHumano: number } {
  const valorEntregas = arredondar(valorBruto - calcularAjusteRecorrentes(entregas, valorBruto).reduce((s, a) => s + a.valor, 0))
  const robo = entregas.reduce((soma, e) => {
    if (e.quantidadeEsperada <= 0) return soma
    const unidades = Math.min(e.quantidadeRobo ?? 0, e.quantidadeEntregue, e.quantidadeEsperada)
    return soma + Math.max(0, unidades) * (e.pesoMensal / e.quantidadeEsperada) * valorBruto
  }, 0)
  const valorRobo = Math.min(arredondar(robo), valorEntregas)
  return { valorRobo, valorHumano: arredondar(valorEntregas - valorRobo) }
}

// Seção 9.3/9.5 — cada semestral vencido e não entregue aplica seu % sobre V,
// reaplicado em toda competência subsequente enquanto pendente. Uma
// reprogramação por impedimento terapêutico vigente (9.7) suspende o ajuste.
export function calcularAjusteSemestrais(pendencias: PendenciaSemestral[], valorBruto: number): AjusteLinha[] {
  return pendencias
    .filter(p => !p.suspensaPorReprogramacao)
    .map(p => ({
      itemCodigo: p.itemCodigo,
      percentual: p.percentualAjuste,
      valor: arredondar(p.percentualAjuste * valorBruto),
    }))
}

// Seção 9.6 — devolução integral: soma dos ajustes já aplicados a um item
// em competências anteriores, a estornar quando o item é aceito.
export function calcularDevolucaoRetroativa(
  historicoAjustesAplicados: Array<{ itemCodigo: string; valor: number }>,
  itemCodigo: string
): number {
  return arredondar(
    historicoAjustesAplicados
      .filter(a => a.itemCodigo === itemCodigo)
      .reduce((soma, a) => soma + a.valor, 0)
  )
}

// Seção 9.8/9.9/9.10 — valor líquido do paciente no mês, com piso zero e
// saldo remanescente carregado para a competência seguinte. Seção 13.7 —
// competência de teste apura e demonstra, mas não aplica ajuste.
export function calcularPEPPaciente(input: {
  valorBruto: number
  entregasRecorrentes: EntregaRecorrente[]
  pendenciasSemestrais: PendenciaSemestral[]
  saldoRemanescenteAnterior?: number
  modoTeste?: boolean
}): ResultadoPEPPaciente {
  const { valorBruto } = input
  const modoTeste = input.modoTeste ?? false
  const saldoRemanescenteAnteriorAplicado = input.saldoRemanescenteAnterior ?? 0

  const ajusteRecorrentes = calcularAjusteRecorrentes(input.entregasRecorrentes, valorBruto)
  const ajusteSemestrais = calcularAjusteSemestrais(input.pendenciasSemestrais, valorBruto)

  const ajusteRecorrentesValor = arredondar(ajusteRecorrentes.reduce((s, a) => s + a.valor, 0))
  const ajusteSemestraisValor = arredondar(ajusteSemestrais.reduce((s, a) => s + a.valor, 0))
  const { valorRobo, valorHumano } = calcularCreditoPorOrigem(input.entregasRecorrentes, valorBruto)

  if (modoTeste) {
    return {
      valorBruto, ajusteRecorrentes, ajusteSemestrais,
      ajusteRecorrentesValor, ajusteSemestraisValor,
      valorRobo, valorHumano,
      saldoRemanescenteAnteriorAplicado: 0,
      valorLiquido: arredondar(valorBruto),
      saldoRemanescenteNovo: 0,
      modoTeste: true,
    }
  }

  const bruto = valorBruto - ajusteRecorrentesValor - ajusteSemestraisValor - saldoRemanescenteAnteriorAplicado
  const valorLiquido = arredondar(Math.max(0, bruto))
  const saldoRemanescenteNovo = bruto < 0 ? arredondar(-bruto) : 0

  return {
    valorBruto, ajusteRecorrentes, ajusteSemestrais,
    ajusteRecorrentesValor, ajusteSemestraisValor,
    valorRobo, valorHumano,
    saldoRemanescenteAnteriorAplicado,
    valorLiquido,
    saldoRemanescenteNovo,
    modoTeste: false,
  }
}

// Seção 9.9 — PEP total do prestador no mês.
export function calcularPEPTotalPrestador(resultadosPorPaciente: ResultadoPEPPaciente[]): number {
  return arredondar(resultadosPorPaciente.reduce((s, r) => s + r.valorLiquido, 0))
}
