"use client"

import { useEffect, useSyncExternalStore } from "react"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import { listarSituacaoGrades } from "@/services/profissionalDisponibilidade.service"
import { listarHabilitadas, listarProfissionais, listarTerapiasDaGrade } from "@/services/profissionais.service"
import type { SituacaoGradeProfissional } from "@/types/disponibilidadeProfissional"
import type { ProfissionalLista } from "@/types/profissional"

// Cache de módulo da lista de profissionais (mesmo padrão de usePacientes): a
// lista e o detalhe compartilham a carga, e salvar no detalhe atualiza o card ao
// voltar sem refazer a consulta inteira por navegação.

type Estado = {
  profissionais: ProfissionalLista[]
  /** profissional.id → ids de terapia habilitadas */
  habilitadas: Map<number, number[]>
  /** tita_profissional_id → terapias vistas na grade */
  grade: Map<number, { terapia: string; horarios: number }[]>
  /** A grade é complemento: se falhar, a lista abre do mesmo jeito. */
  gradeIndisponivel: boolean
  /** profissional.id → situação da disponibilidade hoje. Sem entrada = sem grade. */
  situacaoGrade: Map<number, SituacaoGradeProfissional>
  /** A migration da disponibilidade pode ainda não estar aplicada. */
  situacaoIndisponivel: boolean
  loading: boolean
  error: string | null
  migrationPendente: boolean
}

let estado: Estado = {
  profissionais: [],
  habilitadas: new Map(),
  grade: new Map(),
  gradeIndisponivel: false,
  situacaoGrade: new Map(),
  situacaoIndisponivel: false,
  loading: true,
  error: null,
  migrationPendente: false,
}
let carregado = false
let emVoo: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function publicar(novo: Partial<Estado>) {
  estado = { ...estado, ...novo }
  for (const f of ouvintes) f()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

const ler = () => estado

export function refetchProfissionais(): Promise<void> {
  if (emVoo) return emVoo
  publicar({ loading: !carregado, error: null })
  emVoo = (async () => {
    try {
      const [profissionais, habilitadas, grade, situacao] = await Promise.all([
        listarProfissionais(),
        listarHabilitadas(),
        listarTerapiasDaGrade().catch(() => null),
        listarSituacaoGrades().catch(() => null),
      ])
      carregado = true
      publicar({
        profissionais,
        habilitadas,
        grade: grade ?? new Map(),
        gradeIndisponivel: grade === null,
        situacaoGrade: situacao ?? new Map(),
        situacaoIndisponivel: situacao === null,
        loading: false,
        error: null,
        migrationPendente: false,
      })
    } catch (e) {
      publicar({
        loading: false,
        error: String((e as Error)?.message ?? e),
        migrationPendente: e instanceof MigrationPendenteError,
      })
    } finally {
      emVoo = null
    }
  })()
  return emVoo
}

export function useProfissionais() {
  const s = useSyncExternalStore(assinar, ler, ler)

  useEffect(() => {
    if (!carregado) void refetchProfissionais()
  }, [])

  return { ...s, recarregar: refetchProfissionais }
}
