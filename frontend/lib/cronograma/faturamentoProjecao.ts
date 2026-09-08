// ─── PROJEÇÃO DE RECEITA MENSAL ───────────────────────────────────────────────
// Cruza as sessões já classificadas em pacientesDashboard.ts (Multidisciplinar
// vs Processo Diagnóstico) com os valores cadastrados em
// cronograma_convenio_valores/cronograma_convenio_valores_paciente pra projetar
// receita semanal/mensal por convênio. Mesma separação MESMA separação do
// Dashboard de Pacientes (calcularDashboardPacientes): um paciente cuja agenda
// é feita só de Avaliação Neuropsicológica/Psiquiatra/Triagem só conta no
// segmento "Processo Diagnóstico", nunca no "Multidisciplinar" — por isso a
// projeção de receita também é separada em dois segmentos, senão os números
// de "pacientes" de cada convênio aqui não batem com os da aba Pacientes.
//
// A projeção mensal NÃO é "receita da semana de referência × 4,33" (isso erra
// pra mais ou pra menos dependendo de quantas segundas/terças/etc. o mês em
// questão realmente tem). Em vez disso, segue o mesmo padrão de "Dias
// trabalhados" já usado em relacionamento-prestador/analise
// (calcularAnaliseFutura, lib/remuneracao/calculo.ts): pra cada dia da semana,
// `Receita/mês = Receita/sem(daquele dia) × quantas vezes esse dia da semana
// ocorre no mês de referência` (getCalendario, lib/remuneracao/datas.ts) — e a
// receita mensal do convênio é a soma dos 5 dias úteis.

import { cleanTxt } from "./helpers"
import { normTxt, EXIB_ID } from "./constants"
import { isAgendadoAtivo, isTerapiaDiagnostico, semanasNoPeriodo } from "./pacientesDashboard"
import { normalizarUnidadeOcupacao } from "./ocupacaoProf"
import { getCalendario, type CalendarioResult } from "../remuneracao/datas"
import type { FeriadoInfo } from "@/types/feriados"
import type { AgendaSalaRow } from "./salasTypes"
import { TERAPIAS_PACOTE, type ConvenioValor, type ConvenioValorPaciente, type ConvenioPacoteAvaliacao } from "./convenioValoresTypes"

const DOW_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex" }

/** IDs das terapias de TERAPIAS_PACOTE (convenioValoresTypes.ts) — cobradas em BLOCO (pacote/consulta avulsa), não por sessão. */
const TERAPIAS_PACOTE_IDS = new Set(TERAPIAS_PACOTE.map(t => t.terapia_id))

export type OrigemValor = "paciente" | "criterio_aba" | "terapia" | "geral" | "pacote_avaliacao" | "sem_valor"

export interface ValorResolvido {
  valor: number | null
  origem: OrigemValor
}

function normEq(a: string, b: string): boolean {
  return normTxt(a) === normTxt(b)
}

/** Chave estável de paciente — por paciente_id quando disponível, nome normalizado como fallback. */
function pacienteKey(pacienteId: number | null, paciente: string): string {
  return pacienteId !== null ? `id:${pacienteId}` : `nome:${normTxt(paciente)}`
}

function valorDaRegra(regra: { valor_sessao: number | null }): number | null {
  return regra.valor_sessao
}

/**
 * Resolve o valor de uma sessão, na ordem de prioridade: exceção por paciente
 * > regra por critério ABA do convênio (vale pra QUALQUER terapia do paciente,
 * conforme o cronograma dele conter Psicologia ABA ou não — ex.: SEGUROS
 * UNIMED) > regra por terapia do convênio > regra geral do convênio.
 *
 * Toda sessão (inclusive Processo Diagnóstico) é precificada só por
 * valor_sessao — o sistema não trabalha mais com valor por hora.
 *
 * O casamento da exceção por paciente é por paciente_id, e o da regra por
 * terapia é por terapia_id — chaves estáveis (nome de paciente/terapia pode
 * ser renomeado ou digitado com pequenas diferenças de acento/pontuação sem o
 * id mudar). Só cai pra comparação por nome quando o lado cadastrado ainda não
 * tem id (registro antigo, cadastrado antes desses campos existirem, e ainda
 * não resalvo pelo formulário atual) ou quando a sessão em si não trouxe
 * nenhum id da fonte.
 */
export function resolverValorSessao(
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  params: { convenio: string; pacienteId: number | null; paciente: string; terapiaId: number | null; terapiaNome: string; temPsicologiaAba: boolean },
): ValorResolvido {
  const { convenio, pacienteId, paciente, terapiaId, terapiaNome, temPsicologiaAba } = params

  const excecao = excecoesPaciente.find(e => {
    if (!normEq(e.convenio_nome, convenio)) return false
    if (e.paciente_id !== null) return pacienteId !== null && e.paciente_id === pacienteId
    return normEq(e.paciente_nome, paciente)
  })
  if (excecao) {
    const valor = valorDaRegra(excecao)
    if (valor !== null) return { valor, origem: "paciente" }
  }

  const criterioEsperado = temPsicologiaAba ? "com_aba" : "sem_aba"
  const regraCriterioAba = regrasGerais.find(r => r.criterio_aba === criterioEsperado && normEq(r.convenio_nome, convenio))
  if (regraCriterioAba) {
    const valor = valorDaRegra(regraCriterioAba)
    if (valor !== null) return { valor, origem: "criterio_aba" }
  }

  const regraTerapia = regrasGerais.find(r => {
    if (!normEq(r.convenio_nome, convenio)) return false
    if (r.terapia_id !== null) return terapiaId !== null && r.terapia_id === terapiaId
    return !!r.terapia_nome && normEq(r.terapia_nome, terapiaNome)
  })
  if (regraTerapia) {
    const valor = valorDaRegra(regraTerapia)
    if (valor !== null) return { valor, origem: "terapia" }
  }

  const regraGeral = regrasGerais.find(r => r.terapia_id === null && !r.terapia_nome && r.criterio_aba === null && normEq(r.convenio_nome, convenio))
  if (regraGeral) {
    const valor = valorDaRegra(regraGeral)
    if (valor !== null) return { valor, origem: "geral" }
  }

  return { valor: null, origem: "sem_valor" }
}

export interface PrevisaoReceitaDia {
  dow: 1 | 2 | 3 | 4 | 5
  diaLabel: string
  /** Sessões observadas nesse dia da semana, normalizado pra 1 semana (se a janela buscada cobrisse mais de uma). */
  sessoesSemana: number
  /** Quantas vezes esse dia da semana ocorre no mês de referência (ex.: nº de segundas em agosto/2026). */
  ocorrenciasMes: number
  sessoesMesProjetadas: number
  receitaSemana: number
  receitaMesProjetada: number
}

export interface PrevisaoReceitaTerapia {
  terapiaId: number | null
  terapiaNome: string
  sessoesSemana: number
  sessoesSemValor: number
  receitaSemana: number
  /** Valor médio efetivamente cobrado por sessão dessa terapia (exclui sessões sem valor do denominador) — prova visual de que terapias diferentes (ou o mesmo paciente por critério ABA/exceção) podem gerar valores diferentes dentro do mesmo convênio. */
  valorMedioPorSessao: number | null
  /** De onde veio o valor de cada sessão dessa terapia — mais de um item aqui indica que sessões da MESMA terapia tiveram origem diferente (ex.: uma exceção por paciente ou critério ABA se sobrepôs à regra por terapia pra alguns casos). */
  origens: OrigemValor[]
}

export interface PrevisaoReceitaSessao {
  /** ID real do agendamento na fonte (tita_agendamento_id) — único de verdade, diferente de paciente+terapia+dia+hora, que podem colidir se o mesmo horário tiver mais de uma sessão idêntica cadastrada. */
  agendamentoId: number | null
  pacienteId: number | null
  pacienteNome: string
  terapiaId: number | null
  terapiaNome: string
  diaLabel: string
  data: string
  /** Hora de início (ex.: "08:00") — paciente pode ter 2 sessões da mesma terapia no mesmo dia (manhã/tarde), então isso entra na chave de unicidade da linha. */
  horaInicial: string | null
  valor: number | null
  origem: OrigemValor
  /** true se esta sessão (pelo tita_agendamento_id) está marcada como falta em fila_autorizacoes (e não revertida) — preenchido por enriquecerComDeducaoFalta. */
  emFalta: boolean
  /**
   * true se esta sessão conta em `sessoesSemValor` — NÃO é o mesmo que
   * `valor === null`: sessão de pacote (Avaliação Neuropsicológica/Psiquiatra)
   * com valor à vista cadastrado tem valor nulo POR SESSÃO mas não é "sem
   * valor" (ver o comentário em agregarSegmento). Gravado aqui pra quem
   * precisa reproduzir a contagem — sobretudo o export XLSX — não ter que
   * duplicar a regra e divergir.
   */
  semValor?: boolean
  /**
   * Campos abaixo: contexto da linha de origem (`AgendaSalaRow`) que a
   * projeção não usa em nenhum cálculo, mas que o export XLSX precisa
   * mostrar em coluna própria. OPCIONAIS de propósito —
   * `PrevisaoReceitaSessaoHistorico` estende esta interface e o retrato
   * congelado (`previsao_receitas_historico`, escrito pela Edge Function
   * snapshot-previsao-receitas) não guarda nenhum deles: em modo histórico
   * ficam legitimamente vazios, nunca preenchidos com valor adivinhado.
   */
  profissionalId?: number | null
  profissionalNome?: string | null
  salaNome?: string | null
  /** Unidade física derivada de `sala_nome` — `unidade_nome` na fonte é sempre "CLÍNICA UNIVERSO ABA". */
  unidade?: string | null
  horaFinal?: string | null
}

export interface PrevisaoReceitaConvenio {
  convenio: string
  pacientesUnicos: number
  sessoesTotal: number
  /** Projeção de sessões no mês inteiro — soma de porDia[].sessoesMesProjetadas (sessões/semana de cada dia × ocorrências daquele dia no mês, já descontando feriados). Mesma lógica de receitaMensalProjetada, só que em contagem de sessões em vez de receita. */
  sessoesMesProjetadas: number
  sessoesSemValor: number
  receitaSemanal: number
  receitaMensalProjetada: number
  /**
   * Quanto seria deduzido da receita mensal projetada por sessões REAIS do mês
   * (não a amostra semanal) marcadas como falta em fila_autorizacoes — só
   * calculado no segmento Multidisciplinar (ver enriquecerComDeducaoFalta).
   * Sempre 0 até enriquecerComDeducaoFalta ser chamado.
   */
  deducaoFalta: number
  /** receitaMensalProjetada − deducaoFalta. Igual a receitaMensalProjetada até enriquecerComDeducaoFalta ser chamado. */
  receitaMensalComDeducao: number
  /** Detalhe dia a dia (Seg a Sex) — a base do cálculo de receitaMensalProjetada, pra exibir "o que está sendo calculado". */
  porDia: PrevisaoReceitaDia[]
  /** Detalhe por terapia — prova visual de que a mesma terapia pode ter valores diferentes por regra (ex.: ASSIM Saúde: Fono/TO a R$120, demais a R$100). */
  porTerapia: PrevisaoReceitaTerapia[]
  /** Toda sessão individual da semana de referência, com paciente/terapia/valor/origem — pra auditoria linha a linha. */
  porSessao: PrevisaoReceitaSessao[]
  /**
   * Pacotes de terapias de TERAPIAS_PACOTE (Avaliação Neuropsicológica,
   * Psiquiatra/Neurologista) — só existe no segmento Processo Diagnóstico
   * (sempre vazio no Multidisciplinar). Cobrado UMA vez por paciente com
   * aquela terapia no cronograma, não por sessão — por isso não tem "por
   * semana": entra direto na receita mensal projetada, sem passar pela
   * lógica de ocorrências por dia da semana.
   */
  pacotesTerapia: PrevisaoReceitaPacote[]
}

export interface PrevisaoReceitaPacote {
  terapiaId: number
  terapiaNome: string
  pacientes: number
  valorAVista: number | null
  receita: number
}

export interface PrevisaoReceitaSegmento {
  sessoesTotal: number
  sessoesSemValor: number
  receitaSemanalTotal: number
  receitaMensalProjetadaTotal: number
  /** Soma de receitaMensalComDeducao de todos os convênios. Igual a receitaMensalProjetadaTotal até enriquecerComDeducaoFalta ser chamado. */
  receitaMensalComDeducaoTotal: number
  porConvenio: PrevisaoReceitaConvenio[]
}

export interface PrevisaoReceitaGeral {
  /** Mês/ano usado pra contar as ocorrências de cada dia da semana — derivado da menor data entre as sessões da semana de referência. Null se não houver nenhuma sessão. Compartilhado pelos dois segmentos (mesma janela de dados). */
  mesReferencia: { ano: number; mes: number; label: string } | null
  /** Toda sessão que NÃO é Processo Diagnóstico — mesma separação do Dashboard de Pacientes. */
  multidisciplinar: PrevisaoReceitaSegmento
  /** Só sessões de Avaliação Neuropsicológica / Psiquiatra-Neurologista / Triagem. */
  processoDiagnostico: PrevisaoReceitaSegmento
}

/**
 * Rótulo legível de cada origem de valor — compartilhado pela tela e pelo
 * export XLSX. Nome com "VALOR" no meio de propósito: existe outro
 * ORIGEM_LABEL, privado e com semântica diferente, em
 * lib/remuneracao/pepAuditoriaFormat.ts.
 */
export const ORIGEM_VALOR_LABEL: Record<string, string> = {
  paciente: "Exceção paciente",
  criterio_aba: "Critério ABA",
  terapia: "Regra por terapia",
  geral: "Regra geral",
  pacote_avaliacao: "Pacote de sessões",
  sem_valor: "Sem valor",
}

export interface PrevisaoReceitaPacienteAgregado {
  chave: string
  pacienteId: number | null
  pacienteNome: string
  sessoesCount: number
  /** Quantas dessas sessões do mês estão marcadas como falta em fila_autorizacoes (não revertida). */
  faltasCount: number
  /** Soma de todos os valores das sessões desse paciente no mês (sessões sem valor não entram na soma; inclui as sessões em falta, ver deducaoFalta). */
  valorSemDeducao: number
  /** Soma do valor só das sessões em falta desse paciente — o mesmo critério usado na dedução por convênio. */
  deducaoFalta: number
  /** valorSemDeducao − deducaoFalta. */
  valorComDeducao: number
  sessoes: PrevisaoReceitaSessao[]
}

/**
 * Aglutina as sessões do mês por paciente — ID Paciente, Nome, sessões/faltas/valor do mês.
 *
 * `aplicaDeducaoFalta` deve ser true SÓ no segmento Multidisciplinar — no
 * Processo Diagnóstico (cobrado em bloco/pacote, ver enriquecerComDeducaoFalta
 * abaixo) uma falta pontual não reduz nada, então deducaoFalta/valorComDeducao
 * ficam neutros mesmo com sessões emFalta, pra não divergir do total do
 * convênio (que nunca deduz nesse segmento). faltasCount continua contando
 * normalmente — é só informativo.
 */
export function agregarPrevisaoPorPaciente(sessoes: PrevisaoReceitaSessao[], aplicaDeducaoFalta: boolean): PrevisaoReceitaPacienteAgregado[] {
  const map = new Map<string, PrevisaoReceitaPacienteAgregado>()
  for (const s of sessoes) {
    const chave = s.pacienteId !== null ? `id:${s.pacienteId}` : `nome:${s.pacienteNome}`
    let entry = map.get(chave)
    if (!entry) {
      entry = {
        chave, pacienteId: s.pacienteId, pacienteNome: s.pacienteNome,
        sessoesCount: 0, faltasCount: 0, valorSemDeducao: 0, deducaoFalta: 0, valorComDeducao: 0,
        sessoes: [],
      }
      map.set(chave, entry)
    }
    entry.sessoesCount += 1
    entry.valorSemDeducao += s.valor ?? 0
    if (s.emFalta) {
      entry.faltasCount += 1
      if (aplicaDeducaoFalta) entry.deducaoFalta += s.valor ?? 0
    }
    entry.sessoes.push(s)
  }
  for (const entry of map.values()) entry.valorComDeducao = entry.valorSemDeducao - entry.deducaoFalta
  return Array.from(map.values())
}

function mesReferenciaDeDatas(datas: string[]): { ano: number; mes: number; label: string } | null {
  const validas = datas.filter(Boolean).sort()
  if (!validas.length) return null
  const [ano, mes] = validas[0].split("-").map(Number)
  if (!ano || !mes) return null
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(ano, mes - 1, 1))
  return { ano, mes, label: label.charAt(0).toUpperCase() + label.slice(1) }
}

/** Agrega um segmento (Multidisciplinar OU Processo Diagnóstico) por convênio/dia/terapia/sessão. */
function agregarSegmento(
  rowsSegmento: AgendaSalaRow[],
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  pacientesComAba: Set<string>,
  cal: CalendarioResult | null,
  pacotesAvaliacao: ConvenioPacoteAvaliacao[] = [],
): PrevisaoReceitaSegmento {
  const datas = rowsSegmento.map(r => cleanTxt(r.data)).filter(Boolean)
  const semanas = semanasNoPeriodo(datas)

  type Acc = { sessoes: number; semValor: number; receita: number }
  const porConvenioPorDia = new Map<string, Partial<Record<1 | 2 | 3 | 4 | 5, Acc>>>()

  type AccTerapia = { terapiaId: number | null; terapiaNome: string; sessoes: number; semValor: number; receita: number; origens: Set<OrigemValor> }
  const porConvenioPorTerapia = new Map<string, Map<string, AccTerapia>>()

  const porConvenioSessoes = new Map<string, PrevisaoReceitaSessao[]>()
  const porConvenioPacientes = new Map<string, Set<string>>()

  rowsSegmento.forEach(r => {
    const data = cleanTxt(r.data)
    const dow = data ? new Date(`${data}T12:00:00`).getDay() : NaN
    if (!Number.isFinite(dow) || dow < 1 || dow > 5) return // só seg-sex, mesmo critério de getCalendario/calcularAnaliseFutura

    const convenio = cleanTxt(r.convenio_nome) || "Não informado"
    const pacienteId = r.paciente_id ?? null
    const paciente = cleanTxt(r.paciente_nome)
    const terapiaId = r.terapia_id ?? r.terapia_exibicao_id ?? null
    const terapiaNome = cleanTxt(r.terapia_nome) || cleanTxt(r.terapia_exibicao_nome) || "Não informado"
    const temPsicologiaAba = pacientesComAba.has(pacienteKey(pacienteId, paciente))

    const resolvido = resolverValorSessao(regrasGerais, excecoesPaciente, { convenio, pacienteId, paciente, terapiaId, terapiaNome, temPsicologiaAba })
    const { valor } = resolvido
    // Terapias de TERAPIAS_PACOTE (Avaliação Neuropsicológica, Psiquiatra/
    // Neurologista) não têm valor POR SESSÃO de propósito — são cobradas em
    // bloco (pacote/consulta avulsa), uma vez por paciente (ver
    // enriquecerComPacotesTerapia/cronograma_convenio_pacote_avaliacao). Sem
    // essa origem específica, a sessão apareceria como "sem valor" na UI, o
    // que é enganoso — o valor existe, só não é por sessão individual.
    const origem: OrigemValor = terapiaId !== null && TERAPIAS_PACOTE_IDS.has(terapiaId) ? "pacote_avaliacao" : resolvido.origem
    // Uma sessão de pacote só "já tem receita" (via enriquecerComPacotesTerapia,
    // calculada à parte) se o convênio realmente tiver um valor à vista
    // cadastrado pra essa terapia — senão ela é "sem valor" de verdade, igual
    // qualquer outra sessão sem regra cadastrada.
    const pacoteSemRegistro = origem === "pacote_avaliacao" &&
      !pacotesAvaliacao.some(p => p.terapia_id === terapiaId && normEq(p.convenio_nome, convenio))

    if (!porConvenioPacientes.has(convenio)) porConvenioPacientes.set(convenio, new Set())
    porConvenioPacientes.get(convenio)!.add(pacienteKey(pacienteId, paciente))

    if (!porConvenioPorDia.has(convenio)) porConvenioPorDia.set(convenio, {})
    const porDia = porConvenioPorDia.get(convenio)!
    const dowKey = dow as 1 | 2 | 3 | 4 | 5
    if (!porDia[dowKey]) porDia[dowKey] = { sessoes: 0, semValor: 0, receita: 0 }
    const acc = porDia[dowKey]!
    acc.sessoes += 1
    // Pacote de sessões (Avaliação Neuropsicológica/Psiquiatra-Neurologista)
    // não é "sem valor" quando o convênio tem valor à vista cadastrado — só
    // não é precificado POR SESSÃO (a receita é somada à parte em
    // enriquecerComPacotesTerapia). Sem cadastro nenhum, conta como sem valor
    // igual a qualquer outra sessão.
    if ((valor === null && origem !== "pacote_avaliacao") || pacoteSemRegistro) acc.semValor += 1
    else if (valor !== null) acc.receita += valor

    if (!porConvenioPorTerapia.has(convenio)) porConvenioPorTerapia.set(convenio, new Map())
    const porTerapia = porConvenioPorTerapia.get(convenio)!
    const terapiaKey = terapiaId !== null ? `id:${terapiaId}` : `nome:${normTxt(terapiaNome)}`
    if (!porTerapia.has(terapiaKey)) porTerapia.set(terapiaKey, { terapiaId, terapiaNome, sessoes: 0, semValor: 0, receita: 0, origens: new Set() })
    const accT = porTerapia.get(terapiaKey)!
    accT.sessoes += 1
    accT.origens.add(origem)
    if ((valor === null && origem !== "pacote_avaliacao") || pacoteSemRegistro) accT.semValor += 1
    else if (valor !== null) accT.receita += valor

    if (!porConvenioSessoes.has(convenio)) porConvenioSessoes.set(convenio, [])
    porConvenioSessoes.get(convenio)!.push({
      agendamentoId: r.tita_agendamento_id ?? null,
      pacienteId, pacienteNome: paciente || "Não informado",
      terapiaId, terapiaNome,
      diaLabel: DOW_LABEL[dowKey], data,
      horaInicial: cleanTxt(r.hora_inicial) || null,
      valor, origem,
      emFalta: false,
      semValor: (valor === null && origem !== "pacote_avaliacao") || pacoteSemRegistro,
      profissionalId: r.profissional_id ?? null,
      profissionalNome: cleanTxt(r.profissional_nome) || null,
      salaNome: cleanTxt(r.sala_nome) || null,
      unidade: normalizarUnidadeOcupacao(r.sala_nome || ""),
      horaFinal: cleanTxt(r.hora_final) || null,
    })
  })

  const porConvenio: PrevisaoReceitaConvenio[] = [...porConvenioPorDia.entries()]
    .map(([convenio, porDiaAcc]) => {
      let sessoesTotal = 0
      let semValorTotal = 0
      let receitaSemanalTotal = 0
      let receitaMensalProjetada = 0
      let sessoesMesProjetadasTotal = 0

      const porDia: PrevisaoReceitaDia[] = ([1, 2, 3, 4, 5] as const)
        .filter(dow => porDiaAcc[dow])
        .map(dow => {
          const acc = porDiaAcc[dow]!
          sessoesTotal += acc.sessoes
          semValorTotal += acc.semValor

          const ocorrenciasMes = cal?.counts[dow] ?? 0
          const sessoesSemana = acc.sessoes / semanas
          const receitaSemana = acc.receita / semanas
          const receitaMes = receitaSemana * ocorrenciasMes
          const sessoesMes = sessoesSemana * ocorrenciasMes

          receitaSemanalTotal += receitaSemana
          receitaMensalProjetada += receitaMes
          sessoesMesProjetadasTotal += sessoesMes

          return {
            dow,
            diaLabel: DOW_LABEL[dow],
            sessoesSemana,
            ocorrenciasMes,
            sessoesMesProjetadas: sessoesMes,
            receitaSemana,
            receitaMesProjetada: receitaMes,
          }
        })

      const porTerapia: PrevisaoReceitaTerapia[] = [...(porConvenioPorTerapia.get(convenio)?.values() ?? [])]
        .map(t => ({
          terapiaId: t.terapiaId,
          terapiaNome: t.terapiaNome,
          sessoesSemana: t.sessoes / semanas,
          sessoesSemValor: t.semValor,
          receitaSemana: t.receita / semanas,
          valorMedioPorSessao: t.sessoes - t.semValor > 0 ? t.receita / (t.sessoes - t.semValor) : null,
          origens: [...t.origens],
        }))
        .sort((a, b) => b.receitaSemana - a.receitaSemana)

      const porSessao = [...(porConvenioSessoes.get(convenio) ?? [])]
        .sort((a, b) => a.pacienteNome.localeCompare(b.pacienteNome) || a.data.localeCompare(b.data))

      return {
        convenio,
        pacientesUnicos: porConvenioPacientes.get(convenio)?.size ?? 0,
        sessoesTotal,
        sessoesMesProjetadas: sessoesMesProjetadasTotal,
        sessoesSemValor: semValorTotal,
        receitaSemanal: receitaSemanalTotal,
        receitaMensalProjetada,
        deducaoFalta: 0,
        receitaMensalComDeducao: receitaMensalProjetada,
        porDia,
        porTerapia,
        porSessao,
        // Preenchido só pra Processo Diagnóstico, depois de agregarSegmento
        // (calcularPrevisaoReceita chama enriquecerComPacotesTerapia) — aqui
        // fica sempre vazio.
        pacotesTerapia: [],
      }
    })
    .sort((a, b) => b.receitaMensalProjetada - a.receitaMensalProjetada)

  return {
    sessoesTotal: porConvenio.reduce((s, c) => s + c.sessoesTotal, 0),
    sessoesSemValor: porConvenio.reduce((s, c) => s + c.sessoesSemValor, 0),
    receitaSemanalTotal: porConvenio.reduce((s, c) => s + c.receitaSemanal, 0),
    receitaMensalProjetadaTotal: porConvenio.reduce((s, c) => s + c.receitaMensalProjetada, 0),
    receitaMensalComDeducaoTotal: porConvenio.reduce((s, c) => s + c.receitaMensalComDeducao, 0),
    porConvenio,
  }
}

/**
 * Soma os pacotes de terapia (TERAPIAS_PACOTE) na receita mensal de cada
 * convênio do segmento (só faz sentido pro Processo Diagnóstico). Cada pacote
 * é cobrado UMA vez por paciente com aquela terapia no cronograma — não
 * entra na receitaSemanal (não é recorrente toda semana) nem passa pela
 * lógica de "ocorrências por dia da semana" usada pra sessão normal.
 */
function enriquecerComPacotesTerapia(
  segmento: PrevisaoReceitaSegmento,
  pacotesPorConvenioTerapia: Map<string, Map<number, Set<string>>>,
  pacotesAvaliacao: ConvenioPacoteAvaliacao[],
): PrevisaoReceitaSegmento {
  const porConvenio = segmento.porConvenio.map(c => {
    const porTerapia = pacotesPorConvenioTerapia.get(c.convenio)
    const pacotesTerapia: PrevisaoReceitaPacote[] = TERAPIAS_PACOTE
      .map(t => {
        const pacientes = porTerapia?.get(t.terapia_id)?.size ?? 0
        if (!pacientes) return null
        const regra = pacotesAvaliacao.find(p => p.terapia_id === t.terapia_id && normEq(p.convenio_nome, c.convenio))
        const valorAVista = regra?.valor_a_vista ?? null
        const receita = valorAVista !== null ? pacientes * valorAVista : 0
        return { terapiaId: t.terapia_id, terapiaNome: t.terapia_nome, pacientes, valorAVista, receita }
      })
      .filter((x): x is PrevisaoReceitaPacote => x !== null)

    const receitaPacoteTotal = pacotesTerapia.reduce((s, p) => s + p.receita, 0)

    const receitaMensalProjetada = c.receitaMensalProjetada + receitaPacoteTotal
    return {
      ...c,
      pacotesTerapia,
      receitaMensalProjetada,
      // deducaoFalta ainda é 0 aqui (Processo Diagnóstico não tem dedução por
      // falta — ver enriquecerComDeducaoFalta), então com/sem dedução seguem iguais.
      receitaMensalComDeducao: receitaMensalProjetada - c.deducaoFalta,
    }
  })

  return {
    ...segmento,
    porConvenio,
    receitaMensalProjetadaTotal: porConvenio.reduce((s, c) => s + c.receitaMensalProjetada, 0),
    receitaMensalComDeducaoTotal: porConvenio.reduce((s, c) => s + c.receitaMensalComDeducao, 0),
  }
}

/** Marca emFalta em toda sessão (dos dois segmentos) cujo agendamentoId está no conjunto de faltas — só um flag de exibição, não afeta nenhum total. */
function marcarSessoesEmFalta(segmento: PrevisaoReceitaSegmento, faltasSet: Set<number>): PrevisaoReceitaSegmento {
  if (!faltasSet.size) return segmento
  return {
    ...segmento,
    porConvenio: segmento.porConvenio.map(c => ({
      ...c,
      porSessao: c.porSessao.map(s => (
        s.agendamentoId !== null && faltasSet.has(s.agendamentoId) ? { ...s, emFalta: true } : s
      )),
    })),
  }
}

/**
 * Calcula quanto cada convênio (segmento Multidisciplinar) perderia de receita
 * mensal projetada por sessões REAIS do mês marcadas como falta em
 * fila_autorizacoes, e devolve `previsao` com deducaoFalta/receitaMensalComDeducao
 * preenchidos (e emFalta marcado nas sessões da semana de referência exibidas
 * em "Por sessão").
 *
 * Só o segmento Multidisciplinar tem dedução: Processo Diagnóstico
 * (Avaliação Neuropsicológica/Psiquiatra/Triagem) é cobrado em BLOCO por
 * paciente (pacotesTerapia), não por sessão — uma falta pontual numa sessão
 * do processo não reduz o valor do pacote já fechado com o convênio.
 *
 * `rowsMesInteiro` precisa ser o mês inteiro (não a semana de referência) —
 * "falta" só existe pra dias já ocorridos, e a projeção por amostragem não
 * enumera as datas reais do mês.
 */
export function enriquecerComDeducaoFalta(
  previsao: PrevisaoReceitaGeral,
  rowsMesInteiro: AgendaSalaRow[],
  faltasSet: Set<number>,
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
): PrevisaoReceitaGeral {
  const multidisciplinarComEmFalta = marcarSessoesEmFalta(previsao.multidisciplinar, faltasSet)
  const processoDiagnosticoComEmFalta = marcarSessoesEmFalta(previsao.processoDiagnostico, faltasSet)

  if (!faltasSet.size) {
    return { ...previsao, multidisciplinar: multidisciplinarComEmFalta, processoDiagnostico: processoDiagnosticoComEmFalta }
  }

  const ativosMes = (rowsMesInteiro || []).filter(isAgendadoAtivo)

  const pacientesComAbaMes = new Set<string>()
  ativosMes.forEach(r => {
    if (r.terapia_exibicao_id !== EXIB_ID.PSICOLOGIA_ABA) return
    pacientesComAbaMes.add(pacienteKey(r.paciente_id ?? null, cleanTxt(r.paciente_nome)))
  })

  const deducaoPorConvenio = new Map<string, number>()
  ativosMes
    .filter(r => !isTerapiaDiagnostico(r))
    .forEach(r => {
      const agendamentoId = r.tita_agendamento_id ?? null
      if (agendamentoId === null || !faltasSet.has(agendamentoId)) return

      const data = cleanTxt(r.data)
      const dow = data ? new Date(`${data}T12:00:00`).getDay() : NaN
      if (!Number.isFinite(dow) || dow < 1 || dow > 5) return

      const convenio = cleanTxt(r.convenio_nome) || "Não informado"
      const pacienteId = r.paciente_id ?? null
      const paciente = cleanTxt(r.paciente_nome)
      const terapiaId = r.terapia_id ?? r.terapia_exibicao_id ?? null
      const terapiaNome = cleanTxt(r.terapia_nome) || cleanTxt(r.terapia_exibicao_nome) || "Não informado"
      const temPsicologiaAba = pacientesComAbaMes.has(pacienteKey(pacienteId, paciente))

      const { valor } = resolverValorSessao(regrasGerais, excecoesPaciente, {
        convenio, pacienteId, paciente, terapiaId, terapiaNome, temPsicologiaAba,
      })
      if (valor === null) return

      deducaoPorConvenio.set(convenio, (deducaoPorConvenio.get(convenio) ?? 0) + valor)
    })

  const porConvenio = multidisciplinarComEmFalta.porConvenio.map(c => {
    const deducaoFalta = deducaoPorConvenio.get(c.convenio) ?? 0
    return { ...c, deducaoFalta, receitaMensalComDeducao: c.receitaMensalProjetada - deducaoFalta }
  })

  const multidisciplinar: PrevisaoReceitaSegmento = {
    ...multidisciplinarComEmFalta,
    porConvenio,
    receitaMensalComDeducaoTotal: porConvenio.reduce((s, c) => s + c.receitaMensalComDeducao, 0),
  }

  return { ...previsao, multidisciplinar, processoDiagnostico: processoDiagnosticoComEmFalta }
}

/**
 * Sessões REAIS do mês inteiro (não a amostra semanal), agrupadas por
 * convênio — usadas pela aba "Por paciente" da Previsão de Receitas pra
 * mostrar TODAS as sessões/faltas do mês de cada paciente, não só as que
 * caem na semana de referência. "Por dia da semana" e "Por terapia"
 * continuam usando a amostra semanal (`PrevisaoReceitaConvenio.porSessao`) —
 * só "Por paciente" troca de fonte.
 *
 * Não passa pelas mesmas etapas de `calcularPrevisaoReceita` que não fazem
 * sentido aqui: sem `cal` (não projeta mês, só lista sessões reais) e sem
 * `enriquecerComPacotesTerapia` (a soma de pacotes já é mostrada a partir da
 * amostra semanal — aqui só precisamos da lista de sessões individuais,
 * que `agregarSegmento` já classifica como "pacote_avaliacao" sozinha).
 */
export function calcularSessoesMensaisPorConvenio(
  rowsMesInteiro: AgendaSalaRow[],
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  pacotesAvaliacao: ConvenioPacoteAvaliacao[] = [],
  faltasSet: Set<number> = new Set(),
): { multidisciplinar: Map<string, PrevisaoReceitaSessao[]>; processoDiagnostico: Map<string, PrevisaoReceitaSessao[]> } {
  const ativos = (rowsMesInteiro || []).filter(isAgendadoAtivo)

  const pacientesComAba = new Set<string>()
  ativos.forEach(r => {
    if (r.terapia_exibicao_id !== EXIB_ID.PSICOLOGIA_ABA) return
    pacientesComAba.add(pacienteKey(r.paciente_id ?? null, cleanTxt(r.paciente_nome)))
  })

  const rowsMultidisciplinar = ativos.filter(r => !isTerapiaDiagnostico(r))
  const rowsDiagnostico = ativos.filter(isTerapiaDiagnostico)

  const multidisciplinar = agregarSegmento(rowsMultidisciplinar, regrasGerais, excecoesPaciente, pacientesComAba, null, pacotesAvaliacao)
  const processoDiagnostico = agregarSegmento(rowsDiagnostico, [], [], pacientesComAba, null, pacotesAvaliacao)

  const paraMapa = (segmento: PrevisaoReceitaSegmento): Map<string, PrevisaoReceitaSessao[]> =>
    new Map(marcarSessoesEmFalta(segmento, faltasSet).porConvenio.map(c => [c.convenio, c.porSessao]))

  return {
    multidisciplinar: paraMapa(multidisciplinar),
    processoDiagnostico: paraMapa(processoDiagnostico),
  }
}

/** Uma linha de previsao_receitas_historico (Etapa 4) — sessão já resolvida (valor/origem calculados no snapshot), com o convênio junto (a tabela é "achatada", não agrupada). */
export interface PrevisaoReceitaSessaoHistorico extends PrevisaoReceitaSessao {
  convenio: string
}

/**
 * Reconstrói um PrevisaoReceitaSegmento a partir de sessões JÁ RESOLVIDAS de
 * um snapshot histórico (previsao_receitas_historico) — diferente de
 * agregarSegmento, que resolve `valor`/`origem` a partir de regras/exceções
 * sobre linhas brutas do mês. Aqui os números de "por dia"/"por terapia" são
 * REAIS (soma das sessões que realmente ocorreram naquele mês, não uma
 * projeção por amostragem) — não faz sentido projetar um mês que já
 * aconteceu e já foi todo capturado.
 */
export function agregarSegmentoHistorico(
  sessoesComConvenio: PrevisaoReceitaSessaoHistorico[],
  aplicaDeducaoFalta: boolean,
): PrevisaoReceitaSegmento {
  const porConvenioSessoes = new Map<string, PrevisaoReceitaSessaoHistorico[]>()
  sessoesComConvenio.forEach(s => {
    if (!porConvenioSessoes.has(s.convenio)) porConvenioSessoes.set(s.convenio, [])
    porConvenioSessoes.get(s.convenio)!.push(s)
  })

  const porConvenio: PrevisaoReceitaConvenio[] = [...porConvenioSessoes.entries()]
    .map(([convenio, sessoes]) => {
      const semanas = semanasNoPeriodo(sessoes.map(s => s.data))
      const pacientes = new Set<string>()

      type AccDia = { sessoes: number; semValor: number; receita: number; datas: Set<string> }
      const porDiaAcc = new Map<1 | 2 | 3 | 4 | 5, AccDia>()

      type AccTerapia = { terapiaId: number | null; terapiaNome: string; sessoes: number; semValor: number; receita: number; origens: Set<OrigemValor> }
      const porTerapiaAcc = new Map<string, AccTerapia>()

      let sessoesSemValorTotal = 0
      let receitaTotal = 0
      let deducaoFalta = 0

      sessoes.forEach(s => {
        pacientes.add(pacienteKey(s.pacienteId, s.pacienteNome))
        const semValor = s.valor === null && s.origem !== "pacote_avaliacao"
        if (semValor) sessoesSemValorTotal += 1
        else if (s.valor !== null) receitaTotal += s.valor
        if (aplicaDeducaoFalta && s.emFalta && s.valor !== null) deducaoFalta += s.valor

        const dow = new Date(`${s.data}T12:00:00`).getDay()
        if (dow >= 1 && dow <= 5) {
          const dowKey = dow as 1 | 2 | 3 | 4 | 5
          if (!porDiaAcc.has(dowKey)) porDiaAcc.set(dowKey, { sessoes: 0, semValor: 0, receita: 0, datas: new Set() })
          const acc = porDiaAcc.get(dowKey)!
          acc.sessoes += 1
          acc.datas.add(s.data)
          if (semValor) acc.semValor += 1
          else if (s.valor !== null) acc.receita += s.valor
        }

        const terapiaKey = s.terapiaId !== null ? `id:${s.terapiaId}` : `nome:${normTxt(s.terapiaNome)}`
        if (!porTerapiaAcc.has(terapiaKey)) porTerapiaAcc.set(terapiaKey, { terapiaId: s.terapiaId, terapiaNome: s.terapiaNome, sessoes: 0, semValor: 0, receita: 0, origens: new Set() })
        const accT = porTerapiaAcc.get(terapiaKey)!
        accT.sessoes += 1
        accT.origens.add(s.origem)
        if (semValor) accT.semValor += 1
        else if (s.valor !== null) accT.receita += s.valor
      })

      const porDia: PrevisaoReceitaDia[] = ([1, 2, 3, 4, 5] as const)
        .filter(dow => porDiaAcc.has(dow))
        .map(dow => {
          const acc = porDiaAcc.get(dow)!
          // ocorrenciasMes real = quantos dias distintos daquele dia da semana
          // realmente tiveram sessão nesse convênio no mês (não uma contagem
          // de calendário/feriado — o mês já aconteceu, os dados já refletem isso).
          const ocorrenciasMes = acc.datas.size
          return {
            dow,
            diaLabel: DOW_LABEL[dow],
            sessoesSemana: ocorrenciasMes > 0 ? acc.sessoes / ocorrenciasMes : 0,
            ocorrenciasMes,
            sessoesMesProjetadas: acc.sessoes,
            receitaSemana: ocorrenciasMes > 0 ? acc.receita / ocorrenciasMes : 0,
            receitaMesProjetada: acc.receita,
          }
        })

      const porTerapia: PrevisaoReceitaTerapia[] = [...porTerapiaAcc.values()]
        .map(t => ({
          terapiaId: t.terapiaId,
          terapiaNome: t.terapiaNome,
          sessoesSemana: t.sessoes,
          sessoesSemValor: t.semValor,
          receitaSemana: t.receita,
          valorMedioPorSessao: t.sessoes - t.semValor > 0 ? t.receita / (t.sessoes - t.semValor) : null,
          origens: [...t.origens],
        }))
        .sort((a, b) => b.receitaSemana - a.receitaSemana)

      const porSessao = [...sessoes].sort((a, b) => a.pacienteNome.localeCompare(b.pacienteNome) || a.data.localeCompare(b.data))

      return {
        convenio,
        pacientesUnicos: pacientes.size,
        sessoesTotal: sessoes.length,
        sessoesMesProjetadas: sessoes.length,
        sessoesSemValor: sessoesSemValorTotal,
        receitaSemanal: receitaTotal / semanas,
        receitaMensalProjetada: receitaTotal,
        deducaoFalta,
        receitaMensalComDeducao: receitaTotal - deducaoFalta,
        porDia,
        porTerapia,
        porSessao,
        pacotesTerapia: [],
      }
    })
    .sort((a, b) => b.receitaMensalProjetada - a.receitaMensalProjetada)

  return {
    sessoesTotal: porConvenio.reduce((s, c) => s + c.sessoesTotal, 0),
    sessoesSemValor: porConvenio.reduce((s, c) => s + c.sessoesSemValor, 0),
    receitaSemanalTotal: porConvenio.reduce((s, c) => s + c.receitaSemanal, 0),
    receitaMensalProjetadaTotal: porConvenio.reduce((s, c) => s + c.receitaMensalProjetada, 0),
    receitaMensalComDeducaoTotal: porConvenio.reduce((s, c) => s + c.receitaMensalComDeducao, 0),
    porConvenio,
  }
}

export function calcularPrevisaoReceita(
  rows: AgendaSalaRow[],
  regrasGerais: ConvenioValor[],
  excecoesPaciente: ConvenioValorPaciente[],
  pacotesAvaliacao: ConvenioPacoteAvaliacao[] = [],
  feriados: Record<string, FeriadoInfo> = {},
): PrevisaoReceitaGeral {
  const ativos = (rows || []).filter(isAgendadoAtivo)
  const mesReferencia = mesReferenciaDeDatas(ativos.map(r => cleanTxt(r.data)).filter(Boolean))
  // Mesmos feriados cadastrados em Cadastros → Feriados (usados também em
  // Relacionamento Prestador) — dias de feriado não contam como "Ocorr. no
  // mês" para nenhum convênio, já que não há recebimento nesses dias.
  const cal = mesReferencia ? getCalendario(mesReferencia.ano, mesReferencia.mes, feriados) : null

  // Pré-passo: quais pacientes têm Psicologia ABA em algum lugar do cronograma
  // (semana de referência INTEIRA, dos dois segmentos juntos) — determina a
  // regra por "critério ABA" (ex.: SEGUROS UNIMED), que vale pra TODAS as
  // sessões do paciente, não só a que efetivamente é ABA.
  const pacientesComAba = new Set<string>()
  ativos.forEach(r => {
    if (r.terapia_exibicao_id !== EXIB_ID.PSICOLOGIA_ABA) return
    pacientesComAba.add(pacienteKey(r.paciente_id ?? null, cleanTxt(r.paciente_nome)))
  })

  // Mesma separação do Dashboard de Pacientes (calcularDashboardPacientes,
  // pacientesDashboard.ts) — replicada aqui pra a Previsão de Receitas bater
  // com os números de "pacientes" já mostrados na aba Pacientes.
  const rowsMultidisciplinar = ativos.filter(r => !isTerapiaDiagnostico(r))
  const rowsDiagnostico = ativos.filter(isTerapiaDiagnostico)

  // Quais pacientes têm alguma terapia de TERAPIAS_PACOTE no cronograma, por
  // convênio e por terapia — cobrança em BLOCO (uma vez por paciente),
  // independente de quantas sessões/consultas dessa terapia caem na semana
  // de referência.
  const pacotesPorConvenioTerapia = new Map<string, Map<number, Set<string>>>()
  ativos.forEach(r => {
    const terapiaIdReal = r.terapia_id ?? r.terapia_exibicao_id ?? null
    if (terapiaIdReal === null || !TERAPIAS_PACOTE_IDS.has(terapiaIdReal)) return
    const convenio = cleanTxt(r.convenio_nome) || "Não informado"
    if (!pacotesPorConvenioTerapia.has(convenio)) pacotesPorConvenioTerapia.set(convenio, new Map())
    const porTerapia = pacotesPorConvenioTerapia.get(convenio)!
    if (!porTerapia.has(terapiaIdReal)) porTerapia.set(terapiaIdReal, new Set())
    porTerapia.get(terapiaIdReal)!.add(pacienteKey(r.paciente_id ?? null, cleanTxt(r.paciente_nome)))
  })

  const processoDiagnostico = agregarSegmento(rowsDiagnostico, [], [], pacientesComAba, cal, pacotesAvaliacao)

  return {
    mesReferencia,
    multidisciplinar: agregarSegmento(rowsMultidisciplinar, regrasGerais, excecoesPaciente, pacientesComAba, cal),
    // Processo Diagnóstico (Avaliação Neuropsicológica/Psiquiatra/Triagem) NÃO
    // usa as regras de valor_sessao cadastradas em Cadastro de Valores — essas
    // foram desenhadas pra sessão fixa de 40min (Multidisciplinar). A exceção
    // são as terapias de TERAPIAS_PACOTE (enriquecerComPacotesTerapia acima),
    // cobradas uma vez por paciente. Triagem continua "sem valor" até existir
    // cadastro próprio pra ela também.
    processoDiagnostico: enriquecerComPacotesTerapia(processoDiagnostico, pacotesPorConvenioTerapia, pacotesAvaliacao),
  }
}
