// Visão geral de /relacionamento-prestador/individual — o que a tela mostra
// ANTES de alguém ser escolhido no seletor.
//
// Decisão do usuário (25/09/2026): os NÚMEROS agregados (total do mês, faixas
// de valor, especialidade) continuam sem nome de pessoa — ver as duas travas de
// anonimato abaixo. Mas a lista de PENDÊNCIAS DE DOCUMENTO (cadastro incompleto,
// PEP não apurada, causa de diferença entre o documento e o pagamento) é
// detalhável: quem confere o mês precisa achar a pessoa e a sessão exatas ali
// mesmo, sem precisar adivinhar o nome no seletor primeiro. `ocorrenciasPendencia`
// carrega esse detalhe; os blocos de dinheiro e especialidade não o usam.
//
// Duas travas de anonimato NOS NÚMEROS AGREGADOS, porque "sem nome" não basta:
//   • especialidade com menos de K_MINIMO pessoas não aparece sozinha — vai para
//     "Outras especialidades" (senão "Fonoaudiologia · 1 prof. · R$ 4.800"
//     é o salário de alguém, identificado por exclusão);
//   • se o próprio "Outras" ainda fica pequeno, o valor dele some E o do menor
//     grupo visível também (supressão secundária): com o total do mês na tela,
//     esconder um valor só é inútil — ele sai por subtração.
//
// Números em R$ vêm de montarDemonstrativo (demonstrativo.ts): a "soma dos
// demonstrativos" é a soma do que cada PDF vai imprimir. Os valores por
// especialidade vêm de calcularTotalPorEspecialidade (dashboardRP.ts), a mesma
// régua do dashboard de /rp — as duas telas não podem contar diferente.

import type { ProfRemunReal } from "./calculo"
import { composicaoRP } from "./composicaoRP"
import type { EspecialidadeTotal } from "./dashboardRP"
import { CAUSAS_DIFERENCA, type CausaDiferenca, type Demonstrativo, type SessaoDaDiferenca } from "./demonstrativo"
import type { DocInfo } from "./documento"

/** Menor grupo que pode aparecer com valor próprio. */
export const K_MINIMO = 3

export const ROTULO_OUTRAS = "Outras especialidades"

// ─── Prontidão de um documento ───────────────────────────────────────────────

/**
 * Dado provisório no cadastro, PEP não apurada, ou uma das causas nomeadas de
 * diferença entre os itens e o total (CausaDiferenca, demonstrativo.ts) — cada
 * causa é uma pendência própria, para a tela dizer QUAL é o problema.
 */
export type PendenciaDocumento = "semDocumento" | "semRazao" | "semContrato" | "pepPendente" | CausaDiferenca

const CAUSAS = Object.keys(CAUSAS_DIFERENCA) as CausaDiferenca[]

/**
 * O que faz o documento sair com texto provisório ou com item que não bate com
 * o pagamento. Pendentes e inconsistências de sessão que não mexem no documento
 * NÃO entram: são leitura operacional do mês, e o documento sai correto com elas.
 */
export function pendenciasDocumento(d: Demonstrativo, info: DocInfo): PendenciaDocumento[] {
  const lista: PendenciaDocumento[] = []
  if (info.docProvisorio) lista.push("semDocumento")
  if (info.razaoProvisoria) lista.push("semRazao")
  if (info.contratoProvisorio) lista.push("semContrato")
  if (d.pepPendente) lista.push("pepPendente")
  for (const x of d.diferencas) lista.push(x.causa)
  return lista
}

/**
 * Uma ocorrência de pendência, já com quem é: para as de cadastro só o nome
 * basta; para as causas de diferença que vêm de sessão específica (PA,
 * evolução duplicada…), uma entrada por SESSÃO, para achar cada uma na grade;
 * para as que não vêm de sessão (PEP, Bônus ETA, sem causa), uma por
 * profissional com o valor dela.
 */
export type OcorrenciaPendencia = {
  profissional: string
  sessao?: SessaoDaDiferenca
  valor?: number
}

// ─── Faixas de valor ─────────────────────────────────────────────────────────

export type FaixaValor = { de: number; ate: number; qtd: number }

/** Menor degrau "redondo" (1, 2, 2,5 ou 5 × 10^k) que cobre `alvo`. */
export function degrauRedondo(alvo: number): number {
  if (alvo <= 0) return 1
  const pot = 10 ** Math.floor(Math.log10(alvo))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pot >= alvo) return m * pot
  return 10 * pot
}

/**
 * `n` faixas de largura redonda cobrindo de 0 ao maior valor. Só contagem por
 * faixa — a soma por faixa de uma faixa com uma pessoa só seria o valor dela.
 */
export function faixasDeValor(valores: number[], n = 5): FaixaValor[] {
  const max = Math.max(0, ...valores)
  if (valores.length === 0 || max <= 0) return []
  const passo = degrauRedondo(max / n)
  const faixas: FaixaValor[] = Array.from({ length: n }, (_, i) => ({ de: i * passo, ate: (i + 1) * passo, qtd: 0 }))
  for (const v of valores) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(v / passo)))
    faixas[i].qtd++
  }
  // Faixas vazias no topo não dizem nada; as do meio ficam (o buraco é informação).
  while (faixas.length > 1 && faixas[faixas.length - 1].qtd === 0) faixas.pop()
  return faixas
}

export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0
  const o = [...valores].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

// ─── Especialidades anonimizadas ─────────────────────────────────────────────

export type EspecialidadeAnonima = {
  nome: string
  profissionais: number
  /** null = oculto (grupo pequeno, ou supressão secundária). */
  valor: number | null
  motivoOculto?: "grupoPequeno" | "protegeOutras"
}

export function especialidadesAnonimas(porEspecialidade: EspecialidadeTotal[], k = K_MINIMO): EspecialidadeAnonima[] {
  const visiveis: EspecialidadeAnonima[] = []
  const outrasNomes = new Set<string>()
  let outrasValor = 0
  let temOutras = false

  for (const e of porEspecialidade) {
    if (e.especialidade !== ROTULO_OUTRAS && new Set(e.profissionais).size >= k) {
      visiveis.push({ nome: e.especialidade, profissionais: new Set(e.profissionais).size, valor: e.valor })
    } else {
      temOutras = true
      e.profissionais.forEach(n => outrasNomes.add(n))
      outrasValor += e.valor
    }
  }

  visiveis.sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
  if (!temOutras) return visiveis

  const outras: EspecialidadeAnonima = { nome: ROTULO_OUTRAS, profissionais: outrasNomes.size, valor: outrasValor }
  if (outrasNomes.size < k) {
    outras.valor = null
    outras.motivoOculto = "grupoPequeno"
    // Supressão secundária: o menor valor visível some junto, para "Outras" não
    // sair por subtração do total.
    const menor = visiveis.reduce<EspecialidadeAnonima | null>((m, e) => (m === null || (e.valor ?? 0) < (m.valor ?? 0) ? e : m), null)
    if (menor) {
      menor.valor = null
      menor.motivoOculto = "protegeOutras"
    }
  }
  return [...visiveis, outras]
}

// ─── Resumo geral ────────────────────────────────────────────────────────────

export type ResumoGeralIndividual = {
  profissionais: number
  pj: number
  pf: number
  modalidade: { atendimento: number; banco_horas: number; hibrido: number }
  documentos: {
    prontos: number
    comPendencia: number
    porPendencia: Record<PendenciaDocumento, number>
    /**
     * O detalhe por trás de cada número de `porPendencia` — quem é, e a sessão
     * exata quando a pendência vem de uma. Decisão do usuário: esta tela é
     * geral, mas NÃO anônima — quem confere o mês precisa achar a pessoa e o
     * atendimento, sem esperar escolher um nome primeiro.
     */
    ocorrenciasPendencia: Record<PendenciaDocumento, OcorrenciaPendencia[]>
    /** Quantos são Coordenador de Caso — a base do "PEP não apurada". */
    cc: number
  }
  dinheiro: { total: number; media: number; mediana: number; faixas: FaixaValor[] }
  sessoes: {
    remuneradas: number
    substituicoes: number
    pendentes: number
    inconsistencias: number
    baseRemuneravel: number
    /** Σ remuneradas ÷ Σ base, em %. */
    coberturaGeral: number
    faixasCobertura: { alta: number; media: number; baixa: number; semBase: number }
  }
  especialidades: EspecialidadeAnonima[]
}

export function resumoGeralIndividual(
  resultado: ProfRemunReal[],
  deps: {
    demonstrativoDe: (p: ProfRemunReal) => Demonstrativo
    infoDe: (p: ProfRemunReal) => DocInfo
    porEspecialidade: EspecialidadeTotal[]
  }
): ResumoGeralIndividual {
  const porPendencia = {
    semDocumento: 0, semRazao: 0, semContrato: 0, pepPendente: 0,
    ...Object.fromEntries(CAUSAS.map(c => [c, 0])),
  } as Record<PendenciaDocumento, number>
  const TODAS_PENDENCIAS: PendenciaDocumento[] = ["semDocumento", "semRazao", "semContrato", "pepPendente", ...CAUSAS]
  const ocorrenciasPendencia = Object.fromEntries(
    TODAS_PENDENCIAS.map(id => [id, [] as OcorrenciaPendencia[]])
  ) as Record<PendenciaDocumento, OcorrenciaPendencia[]>
  const modalidade = { atendimento: 0, banco_horas: 0, hibrido: 0 }
  const faixasCobertura = { alta: 0, media: 0, baixa: 0, semBase: 0 }
  const totais: number[] = []
  let pj = 0, prontos = 0, cc = 0
  let remuneradas = 0, substituicoes = 0, pendentes = 0, inconsistencias = 0, baseRemuneravel = 0

  for (const p of resultado) {
    const d = deps.demonstrativoDe(p)
    const info = deps.infoDe(p)
    const c = composicaoRP(p)

    totais.push(d.total)
    if (info.tipo === "pj") pj++
    if (d.isCC) cc++
    modalidade[p.modalidade] = (modalidade[p.modalidade] ?? 0) + 1

    const pend = pendenciasDocumento(d, info)
    if (pend.length === 0) prontos++
    pend.forEach(x => { porPendencia[x]++ })

    if (info.docProvisorio) ocorrenciasPendencia.semDocumento.push({ profissional: p.prof })
    if (info.razaoProvisoria) ocorrenciasPendencia.semRazao.push({ profissional: p.prof })
    if (info.contratoProvisorio) ocorrenciasPendencia.semContrato.push({ profissional: p.prof })
    if (d.pepPendente) ocorrenciasPendencia.pepPendente.push({ profissional: p.prof })
    for (const x of d.diferencas) {
      if (x.sessoesDetalhe.length > 0) {
        for (const s of x.sessoesDetalhe) ocorrenciasPendencia[x.causa].push({ profissional: p.prof, sessao: s })
      } else {
        ocorrenciasPendencia[x.causa].push({ profissional: p.prof, valor: x.valor })
      }
    }

    remuneradas += c.remuneradas
    substituicoes += c.substituicoes
    pendentes += c.pendentes
    inconsistencias += c.inconsistencias
    baseRemuneravel += c.baseRemuneravel
    if (c.baseRemuneravel === 0) faixasCobertura.semBase++
    else if (c.pct >= 80) faixasCobertura.alta++
    else if (c.pct >= 50) faixasCobertura.media++
    else faixasCobertura.baixa++
  }

  const n = resultado.length
  const total = totais.reduce((s, v) => s + v, 0)

  return {
    profissionais: n,
    pj,
    pf: n - pj,
    modalidade,
    documentos: { prontos, comPendencia: n - prontos, porPendencia, ocorrenciasPendencia, cc },
    dinheiro: { total, media: n > 0 ? total / n : 0, mediana: mediana(totais), faixas: faixasDeValor(totais) },
    sessoes: {
      remuneradas, substituicoes, pendentes, inconsistencias, baseRemuneravel,
      coberturaGeral: baseRemuneravel > 0 ? (remuneradas / baseRemuneravel) * 100 : 0,
      faixasCobertura,
    },
    especialidades: especialidadesAnonimas(deps.porEspecialidade),
  }
}
