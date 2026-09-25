// Conta do Demonstrativo de Faturamento — a MESMA para o PDF, o Word e a tela
// de /relacionamento-prestador/individual.
//
// Até aqui a conta vivia dentro de montarHtmlDocumentoFaturamento (documento.ts),
// misturada ao HTML: a tela só poderia mostrar "o que vai no PDF" refazendo a
// conta, e duas contas são duas respostas. Agora o documento só DESENHA as
// `linhas` daqui, e a prévia na tela desenha as mesmas — por construção os dois
// não divergem (snapshot em demonstrativo.test.ts, gravado antes da extração).
//
// Nada foi corrigido na extração, de propósito. O documento tem casos conhecidos
// em que as linhas não fecham com o próprio total:
//   • substituição inconsistente (sem valorPA): entra na linha de PA pelo PA de
//     fallback, mas não está em valorConfirmado;
//   • evolução duplicada: paga em calculo.ts, fora das linhas (o filtro só aceita
//     "Evolução normal");
//   • sessão administrativa do ETA: paga, fora das linhas.
// Mudar isso muda o documento que vai para o prestador — decisão à parte. Aqui
// a diferença é MEDIDA e EXPLICADA (`diferencas`): cada sessão é comparada
// entre o que o documento lista para ela e o que o cálculo paga por ela, e a
// diferença recebe o nome da causa. A tela mostra a causa, não "não confere".

import { ETA_ADMIN_NOMES } from "./constants"
import { abreviarNomePaciente } from "./pacientes"
import { parseDateBR } from "./datas"
import { fmt } from "./formatacao"
import { bucketDaSessao } from "./evolucao"
import { PA_TEXTO_BANCO_HORAS, type ProfRemunReal, type SessaoComPapel } from "./calculo"
import type { PepApuracaoMensal } from "@/types/pep"

// ─── Diferença entre os itens e o total ──────────────────────────────────────

export type CausaDiferenca =
  | "substituicaoEmConferencia"
  | "evolucaoDuplicada"
  | "horarioAdministrativo"
  | "semEspecialidade"
  | "outraPagaForaDosItens"
  | "outraListadaSemPagamento"
  | "pepSemItem"
  | "bonusEtaSemItem"
  | "diferencaSemCausa"

/** Uma sessão apontada como causa de diferença — o suficiente para achá-la na grade. */
export type SessaoDaDiferenca = {
  id: string
  data: string
  hora: string
  especialidade: string
  /** Quanto essa sessão, sozinha, pesa na diferença (mesmo sinal de `DiferencaDemonstrativo.valor`). */
  valor: number
}

export type DiferencaDemonstrativo = {
  causa: CausaDiferenca
  /** Sessões envolvidas (0 para as causas que não são de sessão: PEP, bônus, resto). */
  sessoes: number
  /**
   * Quanto esta causa empurra o total em relação à soma dos itens:
   * > 0 = o total impresso fica MAIOR (pago, mas não listado);
   * < 0 = a soma dos itens fica MAIOR (listado, mas não pago).
   * A soma de todas é exatamente `total − somaLinhas`.
   */
  valor: number
  /**
   * As sessões desta causa, uma a uma — para quem confere localizar exatamente
   * qual é qual na grade. Vazio para PEP, Bônus ETA e "sem causa identificada",
   * que não vêm de sessões específicas.
   */
  sessoesDetalhe: SessaoDaDiferenca[]
}

// Os textos falam só em duas coisas que quem confere entende sem explicação:
// o que o DOCUMENTO MOSTRA e o que VAI SER PAGO. Nada de "itens" ou "linhas".
const MOSTRA_MAIS = "o documento mostra um valor que não vai ser pago"
const PAGA_MAIS = "vai ser pago um valor que o documento não mostra"

/** Nome curto de cada causa e o que ela faz com o dinheiro, em uma frase. */
export const CAUSAS_DIFERENCA: Record<CausaDiferenca, { titulo: string; resumo: string }> = {
  substituicaoEmConferencia: {
    titulo: "Substituição em dúvida: aparece no documento, mas não é paga",
    resumo: MOSTRA_MAIS,
  },
  evolucaoDuplicada: {
    titulo: "Evolução duplicada: é paga, mas não aparece no documento",
    resumo: PAGA_MAIS,
  },
  horarioAdministrativo: {
    titulo: "Horário administrativo do ETA: é pago, mas não aparece no documento",
    resumo: PAGA_MAIS,
  },
  semEspecialidade: {
    titulo: "Sessão sem especialidade: é paga, mas não aparece no documento",
    resumo: PAGA_MAIS,
  },
  outraPagaForaDosItens: {
    titulo: "Sessão paga que não aparece no documento",
    resumo: PAGA_MAIS,
  },
  outraListadaSemPagamento: {
    titulo: "Sessão que aparece no documento, mas não é paga",
    resumo: MOSTRA_MAIS,
  },
  pepSemItem: {
    titulo: "PEP: é paga, mas não aparece no documento",
    resumo: PAGA_MAIS,
  },
  bonusEtaSemItem: {
    titulo: "Bônus ETA: é pago, mas não aparece no documento",
    resumo: PAGA_MAIS,
  },
  diferencaSemCausa: {
    titulo: "Diferença de valor sem causa identificada",
    resumo: "o valor mostrado no documento e o valor pago são diferentes",
  },
}

const qtd = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`

/**
 * A causa em linguagem de quem confere o documento: o que aconteceu (com
 * quantidade e valor) e para que lado isso puxa a conta.
 */
export function descreverDiferenca(x: DiferencaDemonstrativo): { titulo: string; explicacao: string; efeito: string } {
  const v = fmt(Math.abs(x.valor))
  const n = x.sessoes
  const um = n === 1
  const explicacao = {
    substituicaoEmConferencia:
      `${qtd(n, "substituição", "substituições")} em que duas pessoas registraram evolução do mesmo atendimento. ` +
      `Até confirmar quem atendeu, ${um ? "ela não é paga" : "elas não são pagas"} — mas o documento ` +
      `${um ? "a mostra" : "as mostra"} no PA, valendo ${v}.`,
    evolucaoDuplicada:
      `${qtd(n, "evolução registrada", "evoluções registradas")} duas vezes para o mesmo atendimento. ` +
      `${um ? "Está paga" : "Estão pagas"} (${v}), mas o documento não ${um ? "a" : "as"} mostra.`,
    horarioAdministrativo:
      `${qtd(n, "sessão", "sessões")} de “Horário Administrativo” ${um ? "está paga" : "estão pagas"} (${v}), ` +
      `mas o documento não ${um ? "a" : "as"} mostra.`,
    semEspecialidade:
      `${qtd(n, "sessão", "sessões")} sem especialidade na grade ${um ? "está paga" : "estão pagas"} (${v}), ` +
      `mas o documento só mostra sessões que têm especialidade.`,
    outraPagaForaDosItens:
      `${qtd(n, "sessão paga", "sessões pagas")} (${v}) não ${um ? "aparece" : "aparecem"} no documento.`,
    outraListadaSemPagamento:
      `${qtd(n, "sessão aparece", "sessões aparecem")} no documento (${v}), mas não ${um ? "é paga" : "são pagas"}.`,
    pepSemItem:
      `A PEP apurada (${v}) é paga, mas o documento só mostra a PEP de quem atende como ` +
      `Coordenador de Caso no mês — e este profissional não atendeu.`,
    bonusEtaSemItem:
      `O bônus ETA (${v}) é pago, mas o documento só mostra o bônus de quem atende como ` +
      `Especialista Técnico de Área no mês — e este profissional não atendeu.`,
    diferencaSemCausa:
      `Há ${v} de diferença entre o que o documento mostra e o que vai ser pago, e nenhuma das causas conhecidas explica.`,
  }[x.causa]
  const efeito = x.valor > 0
    ? `Vai ser pago ${v} que o documento não mostra.`
    : `O documento mostra ${v} que não vai ser pago.`
  return { titulo: CAUSAS_DIFERENCA[x.causa].titulo, explicacao, efeito }
}

export type TipoLinhaDemonstrativo = "pa" | "semPA" | "fixoBH" | "pep" | "ppd" | "eta"

export type LinhaDemonstrativo = {
  tipo: TipoLinhaDemonstrativo
  /** Componente, como sai em negrito no documento. */
  titulo: string
  /** Segunda linha do componente (especialidade, contratos…). */
  detalhe?: string
  /** "N × taxa": quantidade e taxa, quando a linha é uma multiplicação. */
  qtd?: number
  taxa?: number
  /** Coluna Cálculo quando ela é texto, e não "N × taxa". */
  calculoTexto?: string
  /** Total da linha; null = a linha não soma R$ (coberta por outro contrato, PEP pendente). */
  valor: number | null
  /** O que o documento escreve no lugar do valor quando `valor` é null. */
  valorTexto?: string
}

export type Demonstrativo = {
  isCC: boolean
  isETA: boolean
  /** Evoluções próprias + substituições realizadas — o terceiro card do documento. */
  totalSessoes: number
  rotuloTotalSessoes: string
  linhas: LinhaDemonstrativo[]
  /** TOTAL CONFIRMADO DO PERÍODO, como o documento imprime. */
  total: number
  /** Soma das linhas com valor — o que o leitor do documento soma de cabeça. */
  somaLinhas: number
  /** A soma dos itens é diferente do total impresso. */
  divergente: boolean
  /**
   * Cada causa de diferença entre itens e total, nomeada. Pode ter itens mesmo
   * com `divergente` falso, quando duas causas se anulam — o total bate, mas o
   * documento continua listando o que não paga e pagando o que não lista.
   */
  diferencas: DiferencaDemonstrativo[]
  pepTotal: number
  pepPacientes: number
  /** CC e o documento vai sair com "PEP ainda não apurada nesta competência". */
  pepPendente: boolean
  valorFixoBancoHoras: number
  /** Pacientes CC únicos, ordenados e já abreviados — como no documento. */
  pacientesCC: string[]
}

export type OpcoesDemonstrativo = {
  ccPA: number
  etaBonus: number
  taxasPA: Record<string, number>
  /**
   * PEP apurada do prestador na competência (pep_apuracao_mensal). A tela da
   * visão geral usa o resumo por prestador (total e sem contagem); o documento,
   * as linhas do prestador. null/vazio = não apurada.
   */
  pep: { total: number; pacientes: number } | null
}

/** Diferença menor que meio centavo é arredondamento de ponto flutuante. */
const CENTAVO = 0.005

export const TITULO_PA = "PA – Valor por Atendimento Realizado"
export const TITULO_PEP = "PEP – Parcela por Entregas por Paciente"

/** `pepApuracao` (linhas por paciente) → o resumo que o demonstrativo lê. */
export function pepDasLinhas(pepApuracao: PepApuracaoMensal[] | null | undefined): { total: number; pacientes: number } {
  return {
    total: (pepApuracao ?? []).reduce((s, a) => s + Number(a.valor_liquido || 0), 0),
    pacientes: pepApuracao?.length ?? 0,
  }
}

export function montarDemonstrativo(p: ProfRemunReal, o: OpcoesDemonstrativo): Demonstrativo {
  const { ccPA, etaBonus, taxasPA } = o
  const totalSessoes = p.evoluidasProprias + p.substituicoesRealizadas
  const isCC = p.sessoes.some(s => s.especialidade === "Coordenador de Caso")
  const isETA = p.sessoes.some(s => s.especialidade === "Especialista Técnico de Área")
  const hasDiaria = (p.diariaPeriodo ?? 0) > 0

  // PEP — Parcela por Entregas por Paciente. Apurada por competência na aba
  // Entregas PEP (calculoPEP.ts); aqui só lemos o resultado já persistido.
  const pepPacientes = o.pep?.pacientes ?? 0
  const pepTotal = o.pep?.total ?? 0
  // Valor fixo do contrato em banco de horas: não é apurado por sessão, então não
  // está em p.valorConfirmado — entra como linha própria e soma no total, senão o
  // demonstrativo do prestador sairia sem a parte principal do que ele recebe.
  const fixoBancoHoras = p.valorFixoBancoHoras ?? 0
  const total = p.valorConfirmado - (p.pe || 0) + pepTotal + fixoBancoHoras

  const paBreakdown: Record<string, { count: number, rate: number, total: number, explicacao: string }> = {}
  const outroContratoBreakdown: Record<string, { count: number, explicacao: string, bancoHoras: boolean }> = {}

  p.sessoes
    .filter(s => (s.papel === "Agenda" && s.classificacao === "Evolução normal") || (s.papel === "Substituição realizada"))
    .forEach(s => {
      if (!s.especialidade) return
      const isAdm = ETA_ADMIN_NOMES.some(n => (s.paciente || "").includes(n))
      if (isAdm) return

      if (s.semPA || s.valorPATexto) {
        const key = s.especialidade
        if (!outroContratoBreakdown[key]) outroContratoBreakdown[key] = {
          count: 0,
          explicacao: s.explicacaoPA || "",
          // "Tratado em outro contrato" e "Banco de Horas" zeram o PA por motivos
          // diferentes e não podem sair com o mesmo texto no demonstrativo.
          bancoHoras: s.valorPATexto === PA_TEXTO_BANCO_HORAS,
        }
        outroContratoBreakdown[key].count++
        return
      }

      const rate = s.valorPA ?? (s.especialidade === "Coordenador de Caso" ? ccPA : (taxasPA[s.especialidade] || 0))
      const key = s.funcaoPA || s.especialidade
      if (!paBreakdown[key]) paBreakdown[key] = { count: 0, rate, total: 0, explicacao: s.explicacaoPA || "" }
      paBreakdown[key].count++
      paBreakdown[key].total += rate
      paBreakdown[key].rate = rate
    })

  const linhas: LinhaDemonstrativo[] = []

  for (const [esp, d] of Object.entries(paBreakdown)) {
    linhas.push({
      tipo: "pa",
      titulo: TITULO_PA,
      detalhe: esp === "Coordenador de Caso" ? "Coordenação Técnica ABA de Caso" : esp,
      qtd: d.count, taxa: d.rate, valor: d.total,
    })
  }

  for (const [esp, d] of Object.entries(outroContratoBreakdown)) {
    linhas.push({
      tipo: "semPA",
      titulo: d.bancoHoras ? "Atendimento coberto pelo banco de horas" : "Atendimento tratado em outro contrato",
      detalhe: esp,
      qtd: d.count,
      valor: null,
      valorTexto: d.bancoHoras ? "Incluído no valor fixo" : "Tratado em outro contrato",
    })
  }

  if (fixoBancoHoras > 0) {
    const nums = (p.numerosBancoHoras ?? []).join(" / ")
    linhas.push({
      tipo: "fixoBH",
      titulo: "Banco de Horas – valor fixo do contrato",
      detalhe: nums || undefined,
      calculoTexto: "valor total do período (não por sessão)",
      valor: fixoBancoHoras,
    })
  }

  const pepPendente = isCC && !(pepTotal > 0)
  if (isCC && pepTotal > 0) {
    linhas.push({ tipo: "pep", titulo: TITULO_PEP, qtd: pepPacientes, valor: pepTotal })
  } else if (isCC) {
    linhas.push({ tipo: "pep", titulo: TITULO_PEP, calculoTexto: "Ainda não apurada nesta competência", valor: null, valorTexto: "—" })
  }

  if (hasDiaria && p.diariaDetalhe) {
    for (const d of p.diariaDetalhe) {
      linhas.push({ tipo: "ppd", titulo: "PPD – Pagamento por Diária", detalhe: d.esp, qtd: d.dias, taxa: d.rate, valor: d.total })
    }
  }

  if (isETA && (p.etaBonusPeriodo ?? 0) > 0) {
    linhas.push({ tipo: "eta", titulo: "Bônus ETA", qtd: p.etaWeeksPeriodo, taxa: etaBonus, valor: p.etaBonusPeriodo ?? 0 })
  }

  const somaLinhas = linhas.reduce((s, l) => s + (l.valor ?? 0), 0)

  // ── Por que os itens e o total diferem ──
  // Sessão a sessão: o que ela vale nas linhas acima (mesmo filtro e mesma taxa
  // de fallback do laço de PA) × o que calculo.ts pagou por ela (só os buckets
  // comEvolucao e substituicao somam PA — ver composicaoRP.ts).
  const porCausa = new Map<CausaDiferenca, { sessoes: number; valor: number; detalhe: SessaoDaDiferenca[] }>()
  const somar = (causa: CausaDiferenca, valor: number, sessoes = 1, sessao?: SessaoComPapel) => {
    const atual = porCausa.get(causa) ?? { sessoes: 0, valor: 0, detalhe: [] }
    const detalhe = sessao
      ? [...atual.detalhe, { id: sessao.id, data: sessao.data, hora: sessao.hora, especialidade: sessao.especialidade || "—", valor }]
      : atual.detalhe
    porCausa.set(causa, { sessoes: atual.sessoes + sessoes, valor: atual.valor + valor, detalhe })
  }
  for (const s of p.sessoes) {
    const noFiltro = (s.papel === "Agenda" && s.classificacao === "Evolução normal") || s.papel === "Substituição realizada"
    const isAdm = ETA_ADMIN_NOMES.some(n => (s.paciente || "").includes(n))
    const listada = noFiltro && !!s.especialidade && !isAdm
    const noItem = listada && !(s.semPA || s.valorPATexto)
      ? s.valorPA ?? (s.especialidade === "Coordenador de Caso" ? ccPA : (taxasPA[s.especialidade] || 0))
      : 0
    const b = bucketDaSessao(s)
    const pago = b === "comEvolucao" || b === "substituicao" ? (s.valorPA ?? 0) : 0
    const delta = pago - noItem
    if (Math.abs(delta) <= CENTAVO) continue
    const causa: CausaDiferenca =
      s.papel === "Substituição realizada" && b === "inconsistencia" ? "substituicaoEmConferencia"
      : isAdm ? "horarioAdministrativo"
      : s.classificacao === "Evolução duplicada" ? "evolucaoDuplicada"
      : !s.especialidade ? "semEspecialidade"
      : delta > 0 ? "outraPagaForaDosItens" : "outraListadaSemPagamento"
    somar(causa, delta, 1, s)
  }
  // Parcelas que entram no total sem linha correspondente no documento — não
  // vêm de uma sessão específica, então sem `sessoesDetalhe`.
  if (!isCC && pepTotal > 0) somar("pepSemItem", pepTotal, 0)
  const bonusEta = p.etaBonusPeriodo ?? 0
  if (!isETA && bonusEta > 0) somar("bonusEtaSemItem", bonusEta, 0)
  // O que sobrar, sobra dito — a soma das causas fecha com a diferença, sempre.
  const explicado = [...porCausa.values()].reduce((s, x) => s + x.valor, 0)
  const resto = total - somaLinhas - explicado
  if (Math.abs(resto) > CENTAVO) somar("diferencaSemCausa", resto, 0)
  const diferencas: DiferencaDemonstrativo[] = [...porCausa.entries()]
    .filter(([, x]) => Math.abs(x.valor) > CENTAVO)
    .map(([causa, x]) => ({ causa, sessoes: x.sessoes, valor: x.valor, sessoesDetalhe: x.detalhe }))

  const pacientesCC = isCC
    ? (Array.from(new Set(p.sessoes.filter(s => s.especialidade === "Coordenador de Caso" && s.paciente).map(s => String(s.paciente)))).sort()
        .map(abreviarNomePaciente).filter(Boolean) as string[])
    : []

  return {
    isCC, isETA,
    totalSessoes,
    rotuloTotalSessoes: p.modalidade === "banco_horas" ? "Cobertas pelo valor fixo" : "Total elegíveis ao PA",
    linhas,
    total,
    somaLinhas,
    divergente: Math.abs(somaLinhas - total) > CENTAVO,
    diferencas,
    pepTotal, pepPacientes, pepPendente,
    valorFixoBancoHoras: fixoBancoHoras,
    pacientesCC,
  }
}

// ─── Apuração das Sessões (exportResumoSessoesPdf) ───────────────────────────

export type DiaDoResumo = { data: string; diaSemana?: string; rows: SessaoComPapel[] }

/**
 * Linhas do PDF "Apuração das Sessões": só as confirmadas e evoluídas pelo
 * profissional (excluindo faltas, cancelamentos, ou sessões que ele não fez
 * tratativa), contadas por papel e agrupadas por dia em ordem cronológica.
 */
export function sessoesDoResumo(sessoes: SessaoComPapel[]): {
  rowsProf: SessaoComPapel[]; proprias: number; subs: number; sessoesPorDia: DiaDoResumo[]
} {
  const rowsProf = sessoes.filter(r => r.valorPA !== undefined)

  let proprias = 0
  let subs = 0
  for (const r of rowsProf) {
    if (r.papel === "Substituição realizada") {
      subs++
    } else if (r.papel === "Agenda") {
      proprias++
    }
  }

  const groups = rowsProf.reduce((acc, row) => {
    const k = row.data // ex: "01/06/2026"
    if (!acc[k]) acc[k] = []
    acc[k].push(row)
    return acc
  }, {} as Record<string, SessaoComPapel[]>)

  const sessoesPorDia = Object.keys(groups)
    .map(data => ({
      data,
      diaSemana: groups[data][0]?.diaSemana,
      rows: groups[data],
    }))
    .sort((a, b) => {
      const da = parseDateBR(a.data)
      const db = parseDateBR(b.data)
      return (da?.getTime() || 0) - (db?.getTime() || 0)
    })

  return { rowsProf, proprias, subs, sessoesPorDia }
}
