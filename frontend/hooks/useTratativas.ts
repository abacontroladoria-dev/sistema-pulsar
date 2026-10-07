"use client"

// Hook da tela "Análise de Tratativas" (escopo Terapêutico). Espelha o fluxo de
// carga de useRemunRP (hooks/useRemuneracao.ts) — banco por padrão, upload como
// alternativa, "quem carregou por último vence" — MAS:
//   • nunca busca taxas/diárias/contratos/PE — só os feriados (useFeriados),
//     necessários apenas para a classificação de sessões;
//   • não faz upload de PE (relatório monetário) — apenas a grade;
//   • entrega ProfTratativas[] (só contagens, sem nenhum campo em R$).
// Ver lib/remuneracao/tratativas.ts para o porquê da segurança.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { normalizarGradeParaSessao, classificarSessaoReal, type CsvGradeRow } from "@/lib/remuneracao/relatorio"
import { buscarPresencaFilaAutorizacoes, presencaDaSessao, type PresencaIndice } from "@/lib/remuneracao/presencaReal"
import { dataParaISO } from "@/lib/remuneracao/datas"
import {
  buscarGradeParaTratativas, checarPisoDeExecucao, avaliarCoberturaGrade,
  type CoberturaGrade,
} from "@/lib/remuneracao/gradeRemuneracao"
import { periodoDoMes, type PeriodoRP } from "./useRemuneracao"
import { useFeriados } from "./useFeriados"
import { resumirTratativas, type ProfTratativas } from "@/lib/remuneracao/tratativas"

/** Fonte da grade em uso. Quem carregou por último vence — mesma regra do /rp. */
export type FonteGradeTratativas = "banco" | "upload"

/**
 * Por que o mês selecionado não tem grade do banco — o header trata os dois
 * casos com o mesmo layout compacto (só o botão de CSV), mas o modal muda de
 * tom: "piso" é esperado (o banco só existe a partir de 01/07/2026, nada
 * quebrou); "falha" é uma captura que deveria ter rodado e não rodou.
 */
export type MotivoSemGrade = "piso" | "falha"

/** Props dos controles injetados no header. Ver `controlesGrade` mais abaixo. */
export type ControlesGradeTratativas = ReturnType<typeof useTratativas>["controlesGrade"]

// Mesmo padrão do /rp: mês fechado anterior. O mês corrente ainda está em
// trânsito (evolução chega em até ~6 dias, ver DIAS_EVOLUCAO_EM_TRANSITO em
// gradeRemuneracao.ts), então abrir nele mostraria inconsistência/"não
// evoluído" que na verdade é só atraso normal de lançamento.
function mesFechadoAnterior(): PeriodoRP {
  const hoje = new Date()
  const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  return periodoDoMes(ref.getFullYear(), ref.getMonth() + 1)
}

const indicePresencaVazio = (): PresencaIndice => ({ porId: new Map(), porChave: new Map() })

function falhaDeGrade(e: unknown) {
  return {
    resumo: "Falha ao ler a grade",
    erro: e instanceof Error ? e.message : "Não consegui ler a grade do banco.",
    dica: "Nenhum dado foi alterado. Tente carregar de novo; se repetir, avise o time técnico "
      + "com a mensagem acima e use o CSV exportado do TiTa enquanto isso.",
  }
}

export function useTratativas() {
  const { feriados, loading: feriadosLoading, error: feriadosError } = useFeriados()

  // Guardamos as linhas CRUAS da grade (não a versão já normalizada): assim a
  // classificação é re-derivada sempre que os feriados chegarem/mudarem — sem
  // isso, uma carga feita antes dos feriados chegarem classificaria a grade sem
  // feriados e nunca mais reclassificaria. Ver Cadastros → Feriados.
  const [rawRows, setRawRows] = useState<CsvGradeRow[]>([])
  const [presencaIndice, setPresencaIndice] = useState<PresencaIndice>(indicePresencaVazio)
  const [csvName, setCsvName] = useState<string | null>(null)
  const [fonteGrade, setFonteGrade] = useState<FonteGradeTratativas | null>(null)
  const [periodo, setPeriodo] = useState<PeriodoRP>(mesFechadoAnterior)
  /** Período que a grade em uso de fato cobre — pode diferir do escolhido. */
  const [periodoCarregado, setPeriodoCarregado] = useState<PeriodoRP | null>(null)
  const [gradeLoading, setGradeLoading] = useState(false)
  const [gradeErro, setGradeErro] = useState<string | null>(null)
  const [gradeErroResumo, setGradeErroResumo] = useState<string | null>(null)
  const [gradeErroDica, setGradeErroDica] = useState<string | null>(null)
  const [gradeErroQtd, setGradeErroQtd] = useState<number | undefined>(undefined)
  const [gradeErroTipo, setGradeErroTipo] = useState<MotivoSemGrade | null>(null)
  const [gradeAviso, setGradeAviso] = useState<string | null>(null)
  const [coberturaGrade, setCoberturaGrade] = useState<CoberturaGrade | null>(null)

  // Os campos da reprovação andam juntos sempre — mesmo padrão do /rp.
  const limparReprovacao = useCallback(() => {
    setGradeErro(null)
    setGradeErroResumo(null)
    setGradeErroDica(null)
    setGradeErroQtd(undefined)
    setGradeErroTipo(null)
  }, [])

  const reprovar = useCallback((v: { erro: string; resumo: string; dica: string; quantidade?: number }, tipo: MotivoSemGrade) => {
    setGradeErro(v.erro)
    setGradeErroResumo(v.resumo)
    setGradeErroDica(v.dica)
    setGradeErroQtd(v.quantidade)
    setGradeErroTipo(tipo)
    setGradeAviso(null)
  }, [])

  // Serializa as cargas: um upload no meio de uma leitura do banco (ou dois
  // cliques seguidos em períodos diferentes) não pode terminar fora de ordem e
  // deixar a tela com a grade errada. Mesma regra do /rp.
  const cargaAtual = useRef(0)

  /** Upload manual: sobrepõe o que veio do banco. */
  const carregarGrade = useCallback((rows: CsvGradeRow[], nomeArquivo?: string) => {
    cargaAtual.current++
    setRawRows(rows)
    setFonteGrade("upload")
    setCoberturaGrade(null)
    setPeriodoCarregado(null)
    limparReprovacao()
    setGradeAviso(null)
    if (nomeArquivo !== undefined) setCsvName(nomeArquivo)
  }, [limparReprovacao])

  const limparGrade = useCallback(() => {
    // Invalida qualquer carga em voo: sem isto, a que estivesse a caminho
    // repovoaria a tela que a pessoa acabou de limpar.
    cargaAtual.current++
    setGradeLoading(false)
    setRawRows([])
    setPresencaIndice(indicePresencaVazio())
    setCsvName(null)
    setFonteGrade(null)
    setCoberturaGrade(null)
    setPeriodoCarregado(null)
    limparReprovacao()
    setGradeAviso(null)
  }, [limparReprovacao])

  const carregarGradeDoBanco = useCallback(async (alvo?: PeriodoRP) => {
    const p = alvo ?? periodo
    if (alvo) setPeriodo(alvo)

    const piso = checarPisoDeExecucao(p.de, "tratativas")
    if (!piso.ok) {
      reprovar(piso, "piso")
      return
    }

    const marca = ++cargaAtual.current
    setGradeLoading(true)
    limparReprovacao()
    setGradeAviso(null)
    try {
      const { linhas, ...cobertura } = await buscarGradeParaTratativas(p.de, p.ate)
      if (marca !== cargaAtual.current) return

      const veredicto = avaliarCoberturaGrade(cobertura, p, new Date(), "tratativas")
      if (!veredicto.ok) {
        // Nada do período reprovado entra no estado — se já havia uma grade boa
        // carregada, ela continua como está. Mesmo comportamento do /rp.
        reprovar(veredicto, "falha")
        return
      }
      setRawRows(linhas)
      setCoberturaGrade(cobertura)
      setFonteGrade("banco")
      setCsvName(null)
      setPeriodoCarregado(p)
      setGradeAviso(veredicto.aviso)
    } catch (err) {
      if (marca !== cargaAtual.current) return
      reprovar(falhaDeGrade(err), "falha")
    } finally {
      if (marca === cargaAtual.current) setGradeLoading(false)
    }
  }, [periodo, reprovar, limparReprovacao])

  // Primeira carga automática, guardada por ref (não por efeito com
  // dependências) — mesma razão do /rp: só deve disparar uma vez.
  const jaAutoCarregou = useRef(false)
  const carregarGradeAuto = useCallback(() => {
    if (jaAutoCarregou.current) return
    jaAutoCarregou.current = true
    void carregarGradeDoBanco()
  }, [carregarGradeDoBanco])

  // Normaliza/classifica a grade a partir das linhas cruas + feriados atuais.
  // Reage tanto a uma carga nova (banco ou upload) quanto à chegada dos feriados.
  const evoRowsBase = useMemo(
    () => normalizarGradeParaSessao(rawRows, feriados),
    [rawRows, feriados],
  )

  // Cruza a grade com fila_autorizacoes para saber a presença real registrada
  // pela recepção (mesma fonte de Reposição de Faltas) — não é dado monetário.
  useEffect(() => {
    const datasIso = evoRowsBase.map(r => dataParaISO(r.data)).filter(Boolean)
    if (datasIso.length === 0) {
      setPresencaIndice(indicePresencaVazio())
      return
    }
    let cancelled = false
    const dataMin = datasIso.reduce((a, b) => (b < a ? b : a))
    const dataMax = datasIso.reduce((a, b) => (b > a ? b : a))
    buscarPresencaFilaAutorizacoes(dataMin, dataMax)
      .then(indice => { if (!cancelled) setPresencaIndice(indice) })
      // Aqui não há dinheiro (esta aba só conta tratativas), mas índice vazio
      // faz toda falta parecer presença — então o erro precisa aparecer, e com
      // texto legível. Antes imprimia `{}`.
      .catch(err => {
        if (cancelled) return
        setPresencaIndice(indicePresencaVazio())
        console.error("Presença indisponível; contagens podem contar falta como presença:", err instanceof Error ? err.message : err)
      })
    return () => { cancelled = true }
  }, [evoRowsBase])

  const evoRows = useMemo(() => {
    if (presencaIndice.porId.size === 0 && presencaIndice.porChave.size === 0) return evoRowsBase
    return evoRowsBase.map(r => {
      const presente = presencaDaSessao(r.id, r.paciente, r.data, r.hora, presencaIndice)
      if (presente === undefined) return r
      const presencaOrbita = presente ? "Sim" : "Não"
      if (presencaOrbita === r.presencaOrbita) return r
      const atualizado = { ...r, presencaOrbita }
      atualizado.classificacao = classificarSessaoReal(atualizado, feriados)
      return atualizado
    })
  }, [evoRowsBase, presencaIndice, feriados])

  const resultado: ProfTratativas[] | null = useMemo(() => {
    if (!evoRows.length) return null
    return resumirTratativas(evoRows, feriados)
  }, [evoRows, feriados])

  /**
   * Tudo que os controles do header precisam, num objeto de identidade estável.
   * Vai por prop, e não por contexto, pela mesma razão do /rp: `setRightContent`
   * guarda o elemento em estado e quem o renderiza é o layout do dashboard,
   * fora do TratativasProvider.
   */
  const controlesGrade = useMemo(() => ({
    evoRows, csvName,
    carregarGrade, limparGrade,
    fonteGrade, periodo, setPeriodo, periodoCarregado, coberturaGrade,
    carregarGradeDoBanco, carregarGradeAuto,
    gradeLoading, gradeErro, gradeErroResumo, gradeErroDica, gradeErroQtd, gradeErroTipo, gradeAviso,
  }), [
    evoRows, csvName,
    carregarGrade, limparGrade,
    fonteGrade, periodo, periodoCarregado, coberturaGrade,
    carregarGradeDoBanco, carregarGradeAuto,
    gradeLoading, gradeErro, gradeErroResumo, gradeErroDica, gradeErroQtd, gradeErroTipo, gradeAviso,
  ])

  return {
    resultado,
    evoRows,
    csvName,
    controlesGrade,
    loading: feriadosLoading,
    error: feriadosError,
  }
}
