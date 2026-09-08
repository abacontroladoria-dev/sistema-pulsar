"use client"

import { useEffect, useMemo, useState } from "react"
import { listarSalas, listarAlocacoes, buscarLinhasAgendaParaSalas, buscarTurnosBloqueioAdministrativo, listarExclusividadesTerapia, listarTodosProfissionaisSalas, type ProfissionalOpcao } from "@/services/salas.service"
import { listarTerapiasFiltro } from "@/services/agenda.service"
import { calcularOcupacaoDaSala, calcularResumoUnidades, construirNomeDaSalaPorId } from "@/lib/cronograma/salas"
import { construirIndiceExclusividadeTerapia } from "@/lib/cronograma/exclusividadeTerapia"
import { calcularDashboardPacientes } from "@/lib/cronograma/pacientesDashboard"
import { getRefWeek } from "@/lib/cronograma/helpers"
import { normTxt } from "@/lib/cronograma/constants"
import type { Sala, SalaComOcupacao, ResumoUnidadeSalas, AgendaSalaRow, AlocacaoSala, SalaTerapiaExclusiva, DashboardPacientesGeral } from "@/lib/cronograma/salasTypes"

/**
 * Período padrão de análise. `csv_grades_profissionais` é sincronizado pelo TITA
 * em janelas específicas (não necessariamente cobrindo a semana-calendário
 * corrente) — o resto do módulo Cronograma já usa `getRefWeek()` (primeira
 * segunda-feira do mês seguinte) como "semana de referência" com dados
 * garantidamente sincronizados. Reaproveitado aqui para não cair numa janela
 * vazia por coincidência de data.
 */
export function semanaCorrenteRange(): { inicio: string; fim: string } {
  const { inicio, fim } = getRefWeek()
  // getRefWeek() é Seg-Sex por design (várias outras telas — Previsão de
  // Receitas, Comparativo de Sessões etc. — dependem dessa janela exata pra
  // amostragem estatística, ver comentário em getRefWeekDoMes/helpers.ts) —
  // não mexer nela. Só aqui, na Ocupação de Salas, o fim é estendido em +1
  // dia (sábado) porque agora existem salas com `dias_disponiveis` incluindo
  // sábado (ex.: Equoterapia em Movimento) — sem isso, a busca de agenda real
  // (buscarLinhasAgendaParaSalas) nunca chega a trazer sessão nenhuma de
  // sábado, e o cruzamento fica sempre "sem cruzamento no CSV" mesmo com o
  // parser correto.
  const [y, m, d] = fim.split("-").map(Number)
  const fimComSabado = new Date(y, m - 1, d + 1).toISOString().slice(0, 10)
  return { inicio, fim: fimComSabado }
}

/** Onde uma alocação (profissional) já se encontra — usado para detectar conflito ao mover. */
export interface AlocacaoAtual {
  alocacao: AlocacaoSala
  sala: Sala
}

export interface UseOcupacaoSalasResult {
  salas: Sala[]
  alocacoes: AlocacaoSala[]
  linhas: AgendaSalaRow[]
  turnosBloqueioAdmin: AgendaSalaRow[]
  exclusividades: SalaTerapiaExclusiva[]
  /** Todos os profissionais distintos da grade + terapias vistas na agenda — carregados uma vez aqui (não a cada abertura do modal de alocação) para o AlocarSessaoModal abrir sem round-trip. */
  profissionaisTodos: ProfissionalOpcao[]
  terapiasTodas: string[]
  salasComOcupacao: SalaComOcupacao[]
  resumoUnidades: ResumoUnidadeSalas[]
  dashboardPacientes: DashboardPacientesGeral
  loading: boolean
  error: string | null
  recarregar: () => void
  /** Recarrega só `cronograma_salas` (rápido) — usado após criar/editar/excluir sala, que não afeta alocações nem agenda. */
  recarregarSalas: () => Promise<void>
  /** Recarrega só `cronograma_salas_alocacoes` (rápido) — usado após alocar/mover/excluir alocação, que não afeta salas nem agenda. Evita re-paginar `csv_grades_profissionais` (a busca mais cara) numa ação que não muda esses dados. */
  recarregarAlocacoes: () => Promise<void>
  /** Encontra onde um profissional já está alocado (dow+turno específicos), exceto a própria alocação (se informada). */
  encontrarAlocacaoDoProfissional: (profissionalNome: string, dow: number, turno: "Manhã" | "Tarde", excetoAlocacaoId?: string) => AlocacaoAtual | null
}

export function useOcupacaoSalas(inicio?: string, fim?: string): UseOcupacaoSalasResult {
  const periodo = useMemo(() => {
    if (inicio && fim) return { inicio, fim }
    return semanaCorrenteRange()
  }, [inicio, fim])

  const [salas, setSalas] = useState<Sala[]>([])
  const [alocacoes, setAlocacoes] = useState<AlocacaoSala[]>([])
  const [linhas, setLinhas] = useState<AgendaSalaRow[]>([])
  const [turnosBloqueioAdmin, setTurnosBloqueioAdmin] = useState<AgendaSalaRow[]>([])
  const [exclusividades, setExclusividades] = useState<SalaTerapiaExclusiva[]>([])
  const [profissionaisTodos, setProfissionaisTodos] = useState<ProfissionalOpcao[]>([])
  const [terapiasTodas, setTerapiasTodas] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      listarSalas(),
      listarAlocacoes(),
      buscarLinhasAgendaParaSalas(periodo.inicio, periodo.fim),
      buscarTurnosBloqueioAdministrativo(periodo.inicio, periodo.fim),
      listarExclusividadesTerapia(),
    ])
      .then(([salasData, alocacoesData, linhasData, turnosBloqueioAdminData, exclusividadesData]) => {
        if (cancelled) return
        setSalas(salasData)
        setAlocacoes(alocacoesData)
        setLinhas(linhasData)
        setTurnosBloqueioAdmin(turnosBloqueioAdminData)
        setExclusividades(exclusividadesData)
        setLoading(false)
        // Profissionais/terapias do modal de alocação são carregados só depois
        // que a grade (as consultas pesadas acima) já terminou — disparar as
        // duas junto com o resto sobrecarregava o banco a ponto de um dos
        // statements exceder o timeout ("canceling statement due to statement
        // timeout"). Não bloqueiam `loading`: a grade aparece na hora, essas
        // listas só precisam estar prontas antes do usuário abrir o modal.
        listarTodosProfissionaisSalas().then(data => { if (!cancelled) setProfissionaisTodos(data) })
        listarTerapiasFiltro().then(data => { if (!cancelled) setTerapiasTodas(data) })
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err?.message ?? err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [periodo.inicio, periodo.fim, refreshKey])

  async function recarregarSalas() {
    try {
      const [salasData, exclusividadesData] = await Promise.all([listarSalas(), listarExclusividadesTerapia()])
      setSalas(salasData)
      setExclusividades(exclusividadesData)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    }
  }

  async function recarregarAlocacoes() {
    try {
      setAlocacoes(await listarAlocacoes())
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    }
  }

  const indiceExclusividade = useMemo(() => construirIndiceExclusividadeTerapia(exclusividades), [exclusividades])
  const nomeDaSalaPorId = useMemo(() => construirNomeDaSalaPorId(salas), [salas])

  const salasComOcupacao = useMemo(
    () => salas.map(sala => calcularOcupacaoDaSala(sala, alocacoes, linhas, indiceExclusividade, nomeDaSalaPorId)),
    [salas, alocacoes, linhas, indiceExclusividade, nomeDaSalaPorId],
  )

  const resumoUnidades = useMemo(
    () => calcularResumoUnidades(salas, alocacoes, linhas, exclusividades),
    [salas, alocacoes, linhas, exclusividades],
  )

  const dashboardPacientes = useMemo(
    () => calcularDashboardPacientes(linhas),
    [linhas],
  )

  const encontrarAlocacaoDoProfissional = useMemo(() => {
    return (profissionalNome: string, dow: number, turno: "Manhã" | "Tarde", excetoAlocacaoId?: string): AlocacaoAtual | null => {
      const alvo = normTxt(profissionalNome)
      const encontrada = alocacoes.find(a =>
        a.id !== excetoAlocacaoId
        && a.dow === dow
        && a.turno === turno
        && normTxt(a.profissional_nome) === alvo,
      )
      if (!encontrada) return null
      const sala = salas.find(s => s.id === encontrada.sala_id)
      if (!sala) return null
      return { alocacao: encontrada, sala }
    }
  }, [alocacoes, salas])

  return {
    salas,
    alocacoes,
    linhas,
    turnosBloqueioAdmin,
    exclusividades,
    profissionaisTodos,
    terapiasTodas,
    salasComOcupacao,
    resumoUnidades,
    dashboardPacientes,
    loading,
    error,
    recarregar: () => setRefreshKey(k => k + 1),
    recarregarSalas,
    recarregarAlocacoes,
    encontrarAlocacaoDoProfissional,
  }
}