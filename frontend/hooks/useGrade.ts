"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  GradeNaoInstaladaError, listarAgendamentos, listarBloqueios, listarFaixas, listarFeriados, listarPacientes,
  listarProfissionais, ultimaImportacao, type ImportacaoResumo, type PacienteGrade,
} from "@/services/grade.service"
import type { AgendamentoGrade, BloqueioGrade, FaixaGrade, FeriadoGrade, ProfissionalGrade } from "@/types/grade"

// Dados da Grade. Nada aqui lê o TiTa: só as tabelas/RPCs grade_* do Pulsar.

export type DadosPeriodo = {
  faixas: FaixaGrade[]
  agendamentos: AgendamentoGrade[]
  bloqueios: BloqueioGrade[]
  feriados: FeriadoGrade[]
}

const VAZIO: DadosPeriodo = { faixas: [], agendamentos: [], bloqueios: [], feriados: [] }

/** Profissionais, pacientes (sob demanda) e a última importação. */
export function useGradeBase(precisaPacientes: boolean) {
  const [profissionais, setProfissionais] = useState<ProfissionalGrade[]>([])
  const [pacientes, setPacientes] = useState<PacienteGrade[] | null>(null)
  const [importacao, setImportacao] = useState<ImportacaoResumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [naoInstalada, setNaoInstalada] = useState(false)

  const recarregar = useCallback(async () => {
    try {
      const [p, imp] = await Promise.all([listarProfissionais(), ultimaImportacao()])
      setProfissionais(p)
      setImportacao(imp)
      setErro(null)
    } catch (e) {
      if (e instanceof GradeNaoInstaladaError) setNaoInstalada(true)
      else setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void recarregar() }, [recarregar])

  const pedidos = useRef(false)
  useEffect(() => {
    if (!precisaPacientes || pedidos.current) return
    pedidos.current = true
    listarPacientes()
      .then(setPacientes)
      .catch(e => { pedidos.current = false; setErro(e instanceof Error ? e.message : String(e)) })
  }, [precisaPacientes])

  return { profissionais, pacientes, importacao, carregando, erro, naoInstalada, recarregar }
}

/**
 * Faixas, sessões, bloqueios e feriados de um período. `ativo = false` não
 * busca nada (ex.: o mês só é lido na visão Mês).
 */
export function useDadosPeriodo(args: {
  de: string
  ate: string
  profissionais?: number[]
  pacienteId?: number | null
  incluirFaixas?: boolean
  ativo?: boolean
}) {
  const { de, ate, pacienteId = null, incluirFaixas = true, ativo = true } = args
  const chaveProfs = args.profissionais?.join(",") ?? ""
  const [dados, setDados] = useState<DadosPeriodo>(VAZIO)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [naoInstalada, setNaoInstalada] = useState(false)
  const ultimo = useRef(0)

  const carregar = useCallback(async () => {
    if (!ativo) return
    const n = ++ultimo.current
    setCarregando(true)
    try {
      const profs = chaveProfs ? chaveProfs.split(",").map(Number) : undefined
      const [faixas, agendamentos, bloqueios, feriados] = await Promise.all([
        incluirFaixas ? listarFaixas(de, ate, profs) : Promise.resolve([] as FaixaGrade[]),
        listarAgendamentos({ de, ate, profissionais: profs, pacienteId: pacienteId ?? undefined }),
        listarBloqueios(de, ate, profs),
        listarFeriados(de, ate),
      ])
      if (n !== ultimo.current) return // resposta velha (o período mudou no meio)
      setDados({ faixas, agendamentos, bloqueios, feriados })
      setErro(null)
    } catch (e) {
      if (n !== ultimo.current) return
      if (e instanceof GradeNaoInstaladaError) setNaoInstalada(true)
      else setErro(e instanceof Error ? e.message : String(e))
    } finally {
      if (n === ultimo.current) setCarregando(false)
    }
  }, [ativo, de, ate, chaveProfs, pacienteId, incluirFaixas])

  useEffect(() => { void carregar() }, [carregar])

  return { ...dados, carregando, erro, naoInstalada, recarregar: carregar }
}
