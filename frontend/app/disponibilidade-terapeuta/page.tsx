'use client'

import type { StatusDisponibilidade } from '@/hooks/useControleDisponibilidade'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Search, LogOut } from 'lucide-react'
import toast from 'react-hot-toast'
import { useControleDisponibilidade } from '@/hooks/useControleDisponibilidade'
import StatusModal from '@/components/controle-disponibilidade/StatusModal'
import DisponibilidadeTerapeutaCard from '@/components/controle-disponibilidade/DisponibilidadeTerapeutaCard'
import {
  getHorarioInicial,
  getPaciente,
  getTerapia,
  getTerapeuta,
  getUnidade,
  normalizarStatus,
  terapiaDeveAparecer,
  unidadesControle,
} from '@/components/central-terapeutas/helpers'
import CoberturaModal from '@/components/central-terapeutas/CoberturaModal'
import type {
  ControleFilters,
  ControleTerapeuticoItem,
  GrupoTerapeutaMobile,
  StatusDisponibilidadeGrupo,
} from '@/components/central-terapeutas/types'
import { listarCentralTerapeutica } from '@/services/central-terapeutas.service'
import { getSupabaseClient } from '@/lib/supabase/client'

const supabase = getSupabaseClient()

type Ordenacao = 'alfabetica' | 'sala' | 'horario'

function getHojeLocal() {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = String(hoje.getMonth() + 1).padStart(2, '0')
  const dia = String(hoje.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

function calcularStatusAtual(
  atendimentos: ControleTerapeuticoItem[]
): StatusDisponibilidadeGrupo {
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

  return (normalizarStatus(
    [...atendimentos].sort((a, b) =>
      String(a.hora_inicial).localeCompare(String(b.hora_inicial))
    ).at(-1)?.status
  ) as StatusDisponibilidadeGrupo) || 'pendente'
}

export default function RegistroDisponibilidadePage() {
  const hoje = getHojeLocal()
  const router = useRouter()

  const [dados, setDados] = useState<ControleTerapeuticoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [filters, setFilters] = useState<ControleFilters>({
    data: hoje,
    busca: '',
    horario: '',
    unidade: '',
    terapia: '',
    statusFiltro: [],
  })

  const [autenticado, setAutenticado] = useState<boolean | null>(null)
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('alfabetica')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | StatusDisponibilidadeGrupo>('todos')
  const [grupoCobertura, setGrupoCobertura] = useState<GrupoTerapeutaMobile | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

  async function carregarDados() {
    setLoading(true)
    setErro(null)
    try {
      const response = await listarCentralTerapeutica(filters.data)
      console.log('[disponibilidade] carregarDados:', response?.length ?? 0, 'sessões para', filters.data)
      setDados(response || [])
    } catch {
      setErro('Não foi possível carregar os dados. Verifique sua conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setLoading(false)
        router.replace('/disponibilidade-terapeuta/login/')
        return
      }
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('role')
        .eq('id', data.session.user.id)
        .single()
      if (perfil?.role !== 'disponibilidade_terapeuta') {
        console.warn('[disponibilidade] role inválido:', perfil?.role, '→ redirecionando para /login/')
        setLoading(false)
        router.replace('/login/')
        return
      }
      console.log('[disponibilidade] auth OK, role:', perfil?.role)
      setAutenticado(true)
    })
  }, [])

  const {
    modalStatus,
    setModalStatus,
    horariosEdicao,
    novoStatusModal,
    salvandoStatus,
    erroStatus,
    abrirModalStatus: abrirModalStatusOriginal,
    atualizarStatusDireto,
    atualizarStatusSelecionado,
    toggleHorario,
  } = useControleDisponibilidade({
    getPaciente,
    onSuccess: carregarDados,
  })

  useEffect(() => {
    if (autenticado !== true) return

    carregarDados()

    const channel = supabase
      .channel(`controle-terapeutico-disponibilidade-${filters.data}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'controle_terapeutico',
        },
        () => {
          carregarDados()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [filters.data, autenticado])

  function obterTodosAtendimentosDoTerapeuta(terapeuta: string) {
    return dados.filter((item) => getTerapeuta(item) === terapeuta)
  }

  const filtrados = useMemo(() => {
    return dados
      // terapiaDeveAparecer já descarta as contas de teste por lista de nomes
      // (helpers). Antes havia um includes('teste') aqui, que derrubava junto
      // qualquer pessoa real com "teste" no nome.
      .filter(terapiaDeveAparecer)
      .filter((item) => {
        if (!filters.unidade) return true
        return getUnidade(item) === filters.unidade
      })
      .filter((item) => {
        if (!filters.busca) return true
        return getTerapeuta(item).toLowerCase().includes(filters.busca.toLowerCase())
      })
  }, [dados, filters.unidade, filters.busca])

  const grupos = useMemo(() => {
    const gruposMap: Record<string, GrupoTerapeutaMobile> = {}

    filtrados.forEach((item) => {
      const terapeuta = getTerapeuta(item)

      if (!gruposMap[terapeuta]) {
        gruposMap[terapeuta] = {
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
          sala: item.sala || item.numero_sala || '',
          atendimentos: [],
          primeiroHorario: getHorarioInicial(item),
          status: 'pendente',
          substituto: item.profissional_substituto_nome || undefined,
        }
      }

      gruposMap[terapeuta].atendimentos.push(item)

      if (!gruposMap[terapeuta].substituto && item.profissional_substituto_nome) {
        gruposMap[terapeuta].substituto = item.profissional_substituto_nome
      }
    })

    Object.values(gruposMap).forEach((grupo) => {
      grupo.status = calcularStatusAtual(grupo.atendimentos)

      const comAlteracao = grupo.atendimentos
        .filter((a) => a.confirmado_em && a.confirmado_por_nome)
        .sort((a, b) => (b.confirmado_em! > a.confirmado_em! ? 1 : -1))
      if (comAlteracao.length > 0) {
        grupo.ultimaAlteracaoPor = comAlteracao[0].confirmado_por_nome ?? null
        grupo.ultimaAlteracaoEm  = comAlteracao[0].confirmado_em ?? null
      }
    })

    let lista = Object.values(gruposMap)

    if (filtroStatus !== 'todos') {
      lista = lista.filter((grupo) => grupo.status === filtroStatus)
    }

    if (ordenacao === 'alfabetica') {
      lista.sort((a, b) => a.terapeuta.localeCompare(b.terapeuta, 'pt-BR'))
    } else if (ordenacao === 'sala') {
      lista.sort((a, b) => a.sala.localeCompare(b.sala))
    } else if (ordenacao === 'horario') {
      lista.sort((a, b) => a.primeiroHorario.localeCompare(b.primeiroHorario))
    }

    return lista
  }, [filtrados, filtroStatus, ordenacao])

  const anuncioResultado = loading
    ? 'Carregando profissionais...'
    : erro
      ? 'Erro ao carregar dados.'
      : grupos.length === 0
        ? 'Nenhum profissional encontrado.'
        : `${grupos.length} profissional${grupos.length !== 1 ? 'is' : ''} encontrado${grupos.length !== 1 ? 's' : ''}.`

  async function handleLogout() {
    setLogoutLoading(true)
    try {
      await supabase.auth.signOut()
      router.replace('/disponibilidade-terapeuta/login/')
    } catch (error) {
      console.error('[disponibilidade] logout error:', error)
      toast.error('Falha ao fazer logout. Tente novamente.')
      setLogoutLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-brand-bg pb-28">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-slate-200 overflow-hidden bg-white flex items-center justify-center">
              {/* Glifo isolado: o tile do header tem 40px. Ver o comentário
                  da tela de login deste mesmo app. */}
              <img
                src="/icon.png"
                alt="Pulsar"
                className="h-9 w-9 object-contain"
              />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800">Clínica Universo ABA</h1>
              <p className="text-sm font-semibold text-brand-fg">Registro de Disponibilidade</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-50"
            aria-label="Fazer logout"
            title="Fazer logout"
          >
            <LogOut size={18} strokeWidth={2} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      <section className="p-3 space-y-3" aria-label="Filtros e lista de profissionais">
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200 space-y-3" role="search" aria-label="Filtros">
          <label className="sr-only" htmlFor="filtro-data">Data</label>
          <input
            id="filtro-data"
            type="date"
            value={filters.data}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, data: e.target.value }))
            }
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
          />

          <div className="relative">
            <label className="sr-only" htmlFor="filtro-ordenacao">Ordenar por</label>
            <select
              id="filtro-ordenacao"
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
              className="w-full appearance-none border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            >
              <option value="alfabetica">Ordem alfabética</option>
              <option value="sala">Número da sala</option>
              <option value="horario">Horário inicial</option>
            </select>
            <ChevronDown className="absolute right-4 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
          </div>

          <div className="relative">
            <label className="sr-only" htmlFor="filtro-unidade">Filtrar por unidade</label>
            <select
              id="filtro-unidade"
              value={filters.unidade}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, unidade: e.target.value }))
              }
              className="w-full appearance-none border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            >
              <option value="">Todas as unidades</option>
              {unidadesControle.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
          </div>

          <div className="relative">
            <label className="sr-only" htmlFor="filtro-status">Filtrar por status</label>
            <select
              id="filtro-status"
              value={filtroStatus}
              onChange={(e) =>
                setFiltroStatus(e.target.value as 'todos' | StatusDisponibilidadeGrupo)
              }
              className="w-full appearance-none border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            >
              <option value="todos">Todos os status</option>
              <option value="pendente">Pendentes</option>
              <option value="disponivel">Disponíveis</option>
              <option value="indisponivel">Indisponíveis</option>
            </select>
            <ChevronDown className="absolute right-4 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
            <label className="sr-only" htmlFor="busca-terapeuta">Buscar terapeuta</label>
            <input
              id="busca-terapeuta"
              value={filters.busca}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, busca: e.target.value }))
              }
              placeholder="Buscar terapeuta..."
              className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            />
          </div>
        </div>

        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {anuncioResultado}
        </div>

        {loading && (
          <div
            role="status"
            aria-label="Carregando profissionais"
            className="bg-white rounded-2xl p-10 text-center text-slate-500"
          >
            <span aria-hidden="true">Carregando profissionais...</span>
          </div>
        )}

        {!loading && erro && (
          <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
            <p className="text-sm text-rose-700 mb-3">{erro}</p>
            <button
              type="button"
              onClick={carregarDados}
              className="text-sm font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500 rounded"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !erro && grupos.length === 0 && (
          <div className="bg-white rounded-2xl p-10 text-center text-slate-500">
            Nenhum profissional encontrado
          </div>
        )}

        {!loading && !erro &&
          grupos.map((grupo) => (
            <DisponibilidadeTerapeutaCard
              key={grupo.terapeuta}
              grupo={grupo}
              onStatusChanged={carregarDados}
              abrirModalStatus={(g, status) => {
                const grupoCompleto = {
                  ...g,
                  status: g.status as StatusDisponibilidade,
                  atendimentos: obterTodosAtendimentosDoTerapeuta(g.terapeuta),
                }

                if (status === 'disponivel' || status === 'indisponivel') {
                  abrirModalStatusOriginal(grupoCompleto, status)
                }
              }}
              atualizarStatusDireto={(g, status) => {
                void atualizarStatusDireto(g as any, status as any)
              }}
              onAbrirCobertura={(g) => {
                const grupoCompleto = grupos.find((gr) => gr.terapeuta === g.terapeuta)
                if (grupoCompleto) {
                  setGrupoCobertura({
                    ...grupoCompleto,
                    atendimentos: obterTodosAtendimentosDoTerapeuta(grupoCompleto.terapeuta),
                  })
                }
              }}
              salvandoStatus={salvandoStatus}
            />
          ))}
      </section>

      <StatusModal
        data={filters.data}
        modalStatus={modalStatus}
        horariosEdicao={horariosEdicao}
        novoStatusModal={novoStatusModal}
        salvandoStatus={salvandoStatus}
        erroStatus={erroStatus}
        toggleHorario={toggleHorario}
        atualizarStatusSelecionado={atualizarStatusSelecionado}
        setModalStatus={setModalStatus}
      />

      <CoberturaModal
        grupo={grupoCobertura}
        data={filters.data}
        onClose={() => setGrupoCobertura(null)}
        onSuccess={carregarDados}
      />
    </main>
  )
}
