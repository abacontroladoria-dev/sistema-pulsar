'use client'

import type { GrupoTerapeutaMobile } from '@/components/central-terapeutas/types'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useHeader } from '@/contexts/HeaderContext'
import ControleFiltersBar from '@/components/central-terapeutas/ControleFiltersBar'
import ControleTerapeutaMobileCard from '@/components/central-terapeutas/ControleTerapeutaMobileCard'
import CoberturaModal from '@/components/central-terapeutas/CoberturaModal'
import RelatorioModal from '@/components/central-terapeutas/RelatorioModal'
import {
  useControleDisponibilidade,
  type StatusDisponibilidade,
} from '@/hooks/useControleDisponibilidade'

import StatusModal from '@/components/controle-disponibilidade/StatusModal'
import {
  getHorarioInicial,
  getPaciente,
  getTerapia,
  getTerapeuta,
  getUnidade,
  normalizarStatus,
  terapiaDeveAparecer,
} from '@/components/central-terapeutas/helpers'
import type {
  ControleFilters,
  ControleTerapeuticoItem,
} from '@/components/central-terapeutas/types'
import { listarCentralTerapeutica } from '@/services/central-terapeutas.service'
import { sincronizarDados as sincronizar } from '@/services/controle-terapeutico.service'
import { getSupabaseClient } from '@/lib/supabase/client'

const supabase = getSupabaseClient()

const POR_PAGINA = 25

function getHojeLocal() {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = String(hoje.getMonth() + 1).padStart(2, '0')
  const dia = String(hoje.getDate()).padStart(2, '0')

  return `${ano}-${mes}-${dia}`
}

function calcularStatusAtual(
  atendimentos: ControleTerapeuticoItem[]
) {
  const statuses = atendimentos.map((a) => normalizarStatus(a.status))

  const temDisponivel   = statuses.some((s) => s === 'disponivel')
  const temIndisponivel = statuses.some((s) => s === 'indisponivel')
  const temSubstituido  = statuses.some((s) => s === 'substituido')
  const todosPendente   = statuses.every((s) => s === 'pendente')

  if (temDisponivel && temIndisponivel) return 'parcial'
  if (temIndisponivel && !temDisponivel) return 'indisponivel'
  if (temSubstituido && !temIndisponivel && !temDisponivel) return 'substituido'
  if (temDisponivel && !temIndisponivel) return 'disponivel'
  if (todosPendente) return 'pendente'

  // atendimentos chega pré-ordenado por hora_inicial (via filtrados)
  return normalizarStatus(atendimentos.at(-1)?.status) || 'pendente'
}

export default function ControleTerapeuticoPage() {
  const { setHeader } = useHeader()
  const hoje = getHojeLocal()

  const [dados, setDados] = useState<ControleTerapeuticoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [grupoCobertura, setGrupoCobertura] = useState<GrupoTerapeutaMobile | null>(null)
  const [pagina, setPagina] = useState(0)
  const [relatorioAberto, setRelatorioAberto] = useState(false)

  const [filters, setFilters] = useState<ControleFilters>({
    data: hoje,
    busca: '',
    horario: '',
    unidade: '',
    terapia: '',
    statusFiltro: [],
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setHeader(
      'Operação Clínica',
      'Gerencie disponibilidade, indisponibilidade e cobertura dos terapeutas.'
    )
  }, [setHeader])

  const carregarDados = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const response = await listarCentralTerapeutica(filters.data)
      setDados(response || [])
      setErro(null)
    } catch (e) {
      console.error('Erro ao carregar central terapêutica:', e)
      // Só bloqueia a tela com o estado de erro no carregamento em primeiro
      // plano. Falha em refresh de fundo (realtime) mantém os dados na tela.
      if (showLoading) {
        setErro('Não foi possível carregar os atendimentos. Verifique sua conexão e tente novamente.')
      }
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [filters.data])

  const {
	  modalStatus,
	  setModalStatus,

	  horariosEdicao,

	  novoStatusModal,

	  salvandoStatus,
	  salvandoTerapeutas,

	  erroStatus,

	  atualizarStatusDireto,

	  atualizarStatusSelecionado,

	  toggleHorario,

	} = useControleDisponibilidade({
	  getPaciente,
	  onSuccess: carregarDados,
	})

  useEffect(() => {
    carregarDados(true)

    const channel = supabase
      .channel(`controle-terapeutico-central-${filters.data}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'controle_terapeutico',
        },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => carregarDados(false), 400)
        }
      )
      .subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [filters.data])

  const handleSincronizar = useCallback(async () => {
    setSincronizando(true)
    try {
      await sincronizar()
      toast.success('✓ Sincronização concluída com sucesso')
      await carregarDados(true)
    } catch (err) {
      console.error('Erro ao sincronizar:', err)
      toast.error('Erro ao sincronizar dados operacionais')
    } finally {
      setSincronizando(false)
    }
  }, [carregarDados])

  // Deferred busca: keypresses stay responsive while filter results update asynchronously
  const deferredBusca = useDeferredValue(filters.busca)

  const horarios = useMemo(() => {
    const seen = new Set<string>()
    for (const item of dados) {
      if (!terapiaDeveAparecer(item)) continue
      const h = getHorarioInicial(item)
      if (h) seen.add(h)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [dados])

  const terapias = useMemo(() => {
    const seen = new Set<string>()
    for (const item of dados) {
      if (!terapiaDeveAparecer(item)) continue
      const t = item.terapia_exibicao || item.terapia_exibicao_nome || getTerapia(item)
      if (t) seen.add(t)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [dados])

  const atendimentosPorTerapeuta = useMemo(() => {
    const map: Record<string, ControleTerapeuticoItem[]> = {}
    for (const item of dados) {
      const t = getTerapeuta(item)
      if (!map[t]) map[t] = []
      map[t].push(item)
    }
    return map
  }, [dados])

  const filtrados = useMemo(() => {
    const q = deferredBusca.toLowerCase()
    const unidadeLower = filters.unidade.toLowerCase()
    const result: ControleTerapeuticoItem[] = []

    for (const item of dados) {
      if (!terapiaDeveAparecer(item)) continue
      // O descarte de contas de teste mora em terapiaDeveAparecer (helpers),
      // por lista de nomes. Antes era includes('teste') aqui, que derrubava
      // junto qualquer pessoa real com "teste" no nome.
      const terapeuta = getTerapeuta(item)
      if (q && !terapeuta.toLowerCase().includes(q) && !getPaciente(item).toLowerCase().includes(q)) continue
      if (filters.horario && getHorarioInicial(item) !== filters.horario) continue
      if (unidadeLower && !getUnidade(item).toLowerCase().includes(unidadeLower)) continue
      if (filters.terapia) {
        const t = item.terapia_exibicao || item.terapia_exibicao_nome || getTerapia(item)
        if (t !== filters.terapia) continue
      }
      result.push(item)
    }

    return result.sort((a, b) => {
      const horario = getHorarioInicial(a).localeCompare(getHorarioInicial(b))
      if (horario !== 0) return horario
      return getPaciente(a).localeCompare(getPaciente(b))
    })
  }, [
    dados,
    deferredBusca,
    filters.horario,
    filters.unidade,
    filters.terapia,
  ])

  const gruposPorTerapeuta = useMemo(() => {
    const grupos: Record<string, GrupoTerapeutaMobile> = {}

    filtrados.forEach((item) => {
      const terapeuta = getTerapeuta(item)

      if (!grupos[terapeuta]) {
        grupos[terapeuta] = {
		  terapeuta,

		  terapia:
			item.terapia_exibicao ||
			item.terapia_exibicao_nome ||
			getTerapia(item),

		  terapiaExibicao:
			item.terapia_exibicao ||
			item.terapia_exibicao_nome ||
			'',

		  unidade: getUnidade(item),

		  sala:
			item.sala ||
			item.numero_sala ||
			'',

		  atendimentos: [],

		  primeiroHorario:
			getHorarioInicial(item),

		  status: 'pendente',

		  substituto:
			item.profissional_substituto_nome ||
			undefined,
		}
      }

      grupos[terapeuta].atendimentos.push(item)

      if (!grupos[terapeuta].substituto && item.profissional_substituto_nome) {
        grupos[terapeuta].substituto = item.profissional_substituto_nome
      }
    })

Object.values(grupos).forEach(
  (grupo) => {

    grupo.status =
      calcularStatusAtual(
        grupo.atendimentos
      ) as
        | 'pendente'
        | 'disponivel'
        | 'indisponivel'
        | 'parcial'
        | 'substituido'

    const comAlteracao = grupo.atendimentos
      .filter((a) => a.confirmado_em && a.confirmado_por_nome)
      .sort((a, b) => (b.confirmado_em! > a.confirmado_em! ? 1 : -1))
    if (comAlteracao.length > 0) {
      grupo.ultimaAlteracaoPor = comAlteracao[0].confirmado_por_nome ?? null
      grupo.ultimaAlteracaoEm  = comAlteracao[0].confirmado_em ?? null
    }
  }
)

    return Object.values(grupos).sort((a, b) =>
	  a.terapeuta.localeCompare(b.terapeuta, 'pt-BR')
	)
  }, [filtrados])

  const statusContagem = useMemo(() => {
    const contagem = { disponivel: 0, indisponivel: 0, substituido: 0, parcial: 0, pendente: 0 }
    for (const g of gruposPorTerapeuta) {
      let temDisp = false, temIndisp = false, temSubst = false, temPend = false
      for (const a of g.atendimentos) {
        const s = String(a.status ?? '').toLowerCase()
        if (!temDisp   && s === 'disponivel')   temDisp   = true
        if (!temIndisp && s === 'indisponivel') temIndisp = true
        if (!temSubst  && s === 'substituido')  temSubst  = true
        if (!temPend   && s === 'pendente')     temPend   = true
      }
      if (temDisp)            contagem.disponivel++
      if (temIndisp)          contagem.indisponivel++
      if (temSubst)           contagem.substituido++
      if (g.status === 'parcial') contagem.parcial++
      if (temPend)            contagem.pendente++
    }
    return contagem
  }, [gruposPorTerapeuta])

  const gruposFiltradosPorStatus = useMemo(() => {
    if (!filters.statusFiltro || filters.statusFiltro.length === 0) return gruposPorTerapeuta
    return gruposPorTerapeuta.filter((g) =>
      filters.statusFiltro.some((s) => {
        if (s === 'parcial') return g.status === 'parcial'
        return g.atendimentos.some((a) =>
          String(a.status ?? '').toLowerCase() === s
        )
      })
    )
  }, [gruposPorTerapeuta, filters.statusFiltro])

  const totalPaginas = Math.ceil(gruposFiltradosPorStatus.length / POR_PAGINA)

  const gruposPaginados = useMemo(
    () => gruposFiltradosPorStatus.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA),
    [gruposFiltradosPorStatus, pagina]
  )

  useEffect(() => { setPagina(0) }, [gruposFiltradosPorStatus])

  const handleAbrirModalStatus = useCallback(
    (grupo: GrupoTerapeutaMobile, status: string) => {
      const grupoCompleto = {
        ...grupo,
        atendimentos: atendimentosPorTerapeuta[grupo.terapeuta] ?? [],
      } as GrupoTerapeutaMobile
      if (status === 'disponivel' || status === 'indisponivel') {
        setGrupoCobertura(grupoCompleto)
      }
    },
    [atendimentosPorTerapeuta]
  )

  const handleAtualizarStatus = useCallback(
    (grupo: GrupoTerapeutaMobile, status: string) => {
      void atualizarStatusDireto(grupo, status as StatusDisponibilidade)
    },
    [atualizarStatusDireto]
  )

return (
  <div className="bg-card rounded-2xl">

    <div className="flex flex-col gap-4 overflow-hidden">

      <ControleFiltersBar
        filters={filters}
        horarios={horarios}
        terapias={terapias}
        totalGrupos={gruposPorTerapeuta.length}
        statusContagem={statusContagem}
        onChange={setFilters}
        onSincronizar={handleSincronizar}
        onRelatorio={() => setRelatorioAberto(true)}
        sincronizando={sincronizando}
        loading={loading}
      />

      <div className="space-y-3">

        {loading && (
          <div className="bg-white rounded-2xl p-10 text-center text-slate-400">
            Carregando atendimentos...
          </div>
        )}

        {!loading && erro && (
          <div className="bg-white rounded-2xl p-10 text-center space-y-4">
            <p className="text-rose-600 font-medium">{erro}</p>
            <button
              type="button"
              onClick={() => carregarDados(true)}
              className="px-4 h-9 rounded-lg bg-[#3A8FB7] text-white text-sm font-semibold hover:bg-[#327ea1] transition"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !erro &&
          filtrados.length === 0 && (
            <div className="bg-white rounded-2xl p-10 text-center text-slate-400">
              Nenhum atendimento encontrado
            </div>
          )}

        {!loading && !erro &&
          gruposPaginados.map((grupo) => (
            <ControleTerapeutaMobileCard
              key={grupo.terapeuta}
              grupo={grupo}
              abrirModalStatus={handleAbrirModalStatus}
              atualizarStatusDireto={handleAtualizarStatus}
              salvandoStatus={salvandoTerapeutas.has(grupo.terapeuta)}
            />
          ))}

        {!loading && !erro && totalPaginas > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2 pb-1">
            <button
              disabled={pagina === 0}
              onClick={() => setPagina((p) => p - 1)}
              className="px-3 h-9 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              ← Anterior
            </button>
            <span className="text-sm text-slate-500 font-medium select-none">
              {pagina + 1} / {totalPaginas}
            </span>
            <button
              disabled={pagina >= totalPaginas - 1}
              onClick={() => setPagina((p) => p + 1)}
              className="px-3 h-9 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Próximo →
            </button>
          </div>
        )}

      </div>

    </div>

	<StatusModal
	  data={filters.data}
	  modalStatus={modalStatus}
	  horariosEdicao={horariosEdicao}
	  novoStatusModal={novoStatusModal}
	  salvandoStatus={salvandoStatus}
	  erroStatus={erroStatus}
	  toggleHorario={toggleHorario}
	  atualizarStatusSelecionado={
		atualizarStatusSelecionado
	  }
	  setModalStatus={setModalStatus}
	/>

	<CoberturaModal
	  grupo={grupoCobertura}
	  data={filters.data}
	  onClose={() => setGrupoCobertura(null)}
	  onSuccess={carregarDados}
	/>

	<RelatorioModal
	  aberto={relatorioAberto}
	  dataPadrao={filters.data}
	  onClose={() => setRelatorioAberto(false)}
	/>

  </div>
)

}
