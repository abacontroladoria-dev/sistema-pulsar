'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { loadAceites } from '@/lib/cronograma/reposicaoStorage'
import type { CategoriaReposicao, PacienteSemana } from '@/types/reposicao'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fimSemana(inicio: string): string {
  const d = new Date(`${inicio}T12:00:00`)
  d.setDate(d.getDate() + 4)
  return d.toISOString().slice(0, 10)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVisaoGeralFaltas(semanaInicio: string) {
  const [pacientes, setPacientes] = useState<PacienteSemana[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const semanaFim = useMemo(() => fimSemana(semanaInicio), [semanaInicio])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function carregar() {
      const sb = getSupabaseClient()

      // Q1: todas as faltas elegíveis da semana (sem filtro de paciente)
      const { data: faltasRaw, error: e1 } = await sb
        .from('fila_autorizacoes')
        .select('id, paciente_id, paciente_nome, tita_agendamento_id, data_atendimento')
        .eq('status', 'falta')
        // Feriado, ponto facultativo, falta de energia: a clínica não abriu.
        // Não é falta a repor de uma pessoa específica — é dia sem operação, e
        // listar isso como pendência de reposição enche a tela de trabalho que
        // não existe. `or` com `is.null` porque tipo_falta é NULL nas faltas
        // antigas, e um filtro `neq` sozinho descartaria todas elas.
        .or('tipo_falta.is.null,tipo_falta.neq.unidade')
        .is('falta_revertida_em', null)
        .gte('data_atendimento', semanaInicio)
        .lte('data_atendimento', semanaFim)

      if (e1 || cancelled) {
        if (!cancelled) setError(e1?.message ?? 'Erro ao carregar faltas')
        if (!cancelled) setLoading(false)
        return
      }

      // Todas as faltas (status='falta', não canceladas/revertidas) são elegíveis
      // para reposição, independente do motivo (indisponibilidade do profissional
      // ou não comparecimento do paciente) — ver useReposicaoFaltas.ts.
      const faltasElegiveis = faltasRaw ?? []

      // Carrega aceites do localStorage
      const aceites = loadAceites()

      // Agrupa por paciente e categoriza
      const porPaciente = new Map<string, { nome: string; total: number; resolvidas: number; repostas: number; irrecuperaveis: number }>()

      for (const f of faltasElegiveis) {
        const pid = String(f.paciente_id)
        if (!porPaciente.has(pid)) {
          porPaciente.set(pid, { nome: f.paciente_nome ?? '', total: 0, resolvidas: 0, repostas: 0, irrecuperaveis: 0 })
        }
        const entry = porPaciente.get(pid)!
        entry.total++
        // Irrecuperável: falta na sexta (semanaFim) — sem dias restantes na semana
        if (f.data_atendimento === semanaFim) entry.irrecuperaveis++
        const aceite = aceites[f.id]
        // "Resolvida" inclui aceito + recusado (usado na categorização); "reposta" conta só
        // aceito — uma falta recusada não foi reposta, só deixou de estar pendente.
        if (aceite?.status === 'aceito' || aceite?.status === 'recusado') {
          entry.resolvidas++
        }
        if (aceite?.status === 'aceito') {
          entry.repostas++
        }
      }

      // Pacientes sem nenhuma falta elegível na semana → todos_comparecidos
      // Para isso precisamos da lista de todos os pacientes com sessões na semana.
      // Limitamos aqui a quem tem falta: pacientes sem falta não aparecem na visão.
      // (Os "todos comparecidos" seriam pacientes do csv_grades_profissionais sem faltas —
      //  isso requer uma query extra e é opt-in futuro.)

      const resultado: PacienteSemana[] = []

      for (const [pacienteId, { nome, total, resolvidas, repostas, irrecuperaveis }] of porPaciente) {
        let categoria: CategoriaReposicao

        if (total === 0) {
          categoria = 'todos_comparecidos'
        } else if (resolvidas === 0) {
          categoria = 'sem_reposicao'
        } else if (resolvidas < total) {
          categoria = 'reposicao_parcial'
        } else {
          categoria = 'reposicao_completa'
        }

        resultado.push({
          pacienteId,
          pacienteNome: nome,
          categoria,
          totalFaltas: total,
          totalResolvidas: resolvidas,
          totalRepostas: repostas,
          totalIrrecuperaveis: irrecuperaveis,
        })
      }

      // Ordena: sem_reposicao primeiro, parcial, completo
      const ORDER: CategoriaReposicao[] = ['sem_reposicao', 'reposicao_parcial', 'reposicao_completa', 'todos_comparecidos']
      resultado.sort((a, b) => ORDER.indexOf(a.categoria) - ORDER.indexOf(b.categoria))

      if (!cancelled) {
        setPacientes(resultado)
        setLoading(false)
      }
    }

    carregar().catch(err => {
      if (!cancelled) {
        setError(err?.message ?? 'Erro inesperado')
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [semanaInicio])

  return { pacientes, loading, error }
}
