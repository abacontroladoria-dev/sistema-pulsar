"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual"
import {
  GradeNaoInstaladaError, listarAgendamentos, listarBloqueios, listarFaixas, listarFeriados, listarPacientes,
  listarProfissionais, listarResumoEvolucoesPeriodo, meuAcessoEvolucao, ultimaImportacao,
  type ImportacaoResumo, type PacienteGrade,
} from "@/services/grade.service"
import type {
  AcessoEvolucaoGrade, AgendamentoGrade, BloqueioGrade, FaixaGrade, FeriadoGrade,
  ProfissionalGrade, ResumoEvolucaoGrade,
} from "@/types/grade"

// Dados da Grade. Nada aqui lê o TiTa: só as tabelas/RPCs grade_* do Pulsar.

export type DadosPeriodo = {
  faixas: FaixaGrade[]
  agendamentos: AgendamentoGrade[]
  bloqueios: BloqueioGrade[]
  feriados: FeriadoGrade[]
  evolucoes: Map<string, ResumoEvolucaoGrade>
}

const VAZIO: DadosPeriodo = {
  faixas: [],
  agendamentos: [],
  bloqueios: [],
  feriados: [],
  evolucoes: new Map(),
}

const ACESSO_INICIAL: AcessoEvolucaoGrade = {
  eh_admin: false,
  pode_evoluir: false,
  usuario_id: null,
  usuario_nome: "Usuário do Pulsar",
  profissional_id: null,
}

/** Profissionais, pacientes (sob demanda), última importação e acesso de evolução. */
export function useGradeBase(precisaPacientes: boolean) {
  const { realRole, effectiveRole, canImpersonate } = useImpersonation()
  const usuarioAtual = useUsuarioAtual()
  const [profissionais, setProfissionais] = useState<ProfissionalGrade[]>([])
  const [pacientes, setPacientes] = useState<PacienteGrade[] | null>(null)
  const [importacao, setImportacao] = useState<ImportacaoResumo | null>(null)
  const [acessoBruto, setAcessoBruto] = useState<AcessoEvolucaoGrade>(ACESSO_INICIAL)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [naoInstalada, setNaoInstalada] = useState(false)

  const recarregar = useCallback(async () => {
    try {
      const [p, imp, ac] = await Promise.all([
        listarProfissionais(),
        ultimaImportacao(),
        meuAcessoEvolucao(),
      ])
      setProfissionais(p)
      setImportacao(imp)
      setAcessoBruto(ac)
      setErro(null)
    } catch (e) {
      if (e instanceof GradeNaoInstaladaError) setNaoInstalada(true)
      else setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void recarregar() }, [recarregar])

  const acessoEvolucao = useMemo<AcessoEvolucaoGrade>(() => {
    const ehAdminCtx = Boolean(
      acessoBruto.eh_admin ||
      realRole === "admin" ||
      effectiveRole === "admin" ||
      canImpersonate ||
      usuarioAtual.role === "admin" ||
      usuarioAtual.gruposLabel?.split(",").some(g => g.trim().toLowerCase() === "administrador"),
    )
    const nome =
      (acessoBruto.usuario_nome && acessoBruto.usuario_nome !== "Usuário do Pulsar"
        ? acessoBruto.usuario_nome
        : null) ||
      usuarioAtual.nomeCompleto ||
      acessoBruto.usuario_nome ||
      "Usuário do Pulsar"
    return {
      eh_admin: ehAdminCtx,
      pode_evoluir: Boolean(acessoBruto.pode_evoluir || ehAdminCtx),
      usuario_id: acessoBruto.usuario_id ?? usuarioAtual.userId,
      usuario_nome: nome,
      profissional_id: acessoBruto.profissional_id,
    }
  }, [acessoBruto, realRole, effectiveRole, canImpersonate, usuarioAtual])

  const pedidos = useRef(false)
  useEffect(() => {
    if (!precisaPacientes || pedidos.current) return
    pedidos.current = true
    listarPacientes()
      .then(setPacientes)
      .catch(e => { pedidos.current = false; setErro(e instanceof Error ? e.message : String(e)) })
  }, [precisaPacientes])

  return { profissionais, pacientes, importacao, acessoEvolucao, carregando, erro, naoInstalada, recarregar }
}

/**
 * Faixas, sessões, bloqueios, feriados e (na visão Profissional) o resumo das
 * evoluções/faltas de um período. `ativo = false` não busca nada.
 */
export function useDadosPeriodo(args: {
  de: string
  ate: string
  profissionais?: number[]
  pacienteId?: number | null
  incluirFaixas?: boolean
  incluirEvolucoes?: boolean
  ativo?: boolean
}) {
  const {
    de,
    ate,
    pacienteId = null,
    incluirFaixas = true,
    incluirEvolucoes = false,
    ativo = true,
  } = args
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
      const [faixas, agendamentos, bloqueios, feriados, listaEvolucoes] = await Promise.all([
        incluirFaixas ? listarFaixas(de, ate, profs) : Promise.resolve([] as FaixaGrade[]),
        listarAgendamentos({ de, ate, profissionais: profs, pacienteId: pacienteId ?? undefined }),
        listarBloqueios(de, ate, profs),
        listarFeriados(de, ate),
        incluirEvolucoes ? listarResumoEvolucoesPeriodo(de, ate, profs) : Promise.resolve([] as ResumoEvolucaoGrade[]),
      ])
      if (n !== ultimo.current) return // resposta velha (o período mudou no meio)
      const evolucoes = new Map<string, ResumoEvolucaoGrade>()
      for (const ev of listaEvolucoes) {
        evolucoes.set(ev.agendamento_id, ev)
      }
      setDados({ faixas, agendamentos, bloqueios, feriados, evolucoes })
      setErro(null)
    } catch (e) {
      if (n !== ultimo.current) return
      if (e instanceof GradeNaoInstaladaError) setNaoInstalada(true)
      else setErro(e instanceof Error ? e.message : String(e))
    } finally {
      if (n === ultimo.current) setCarregando(false)
    }
  }, [ativo, de, ate, chaveProfs, pacienteId, incluirFaixas, incluirEvolucoes])

  useEffect(() => { void carregar() }, [carregar])

  return { ...dados, carregando, erro, naoInstalada, recarregar: carregar }
}

