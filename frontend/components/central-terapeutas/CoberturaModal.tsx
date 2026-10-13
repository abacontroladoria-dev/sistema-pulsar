'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  MapPin,
  Search,
  Users,
  X,
} from 'lucide-react'
import {
  listarModalSubstituicao,
  listarTodosProfissionaisModal,
  atualizarStatusAtendimentosEmLote,
  terapiasCompativeis,
  ABA_GROUP,
  COORD_CASO,
  type SlotModalSubstituicao,
} from '@/services/controle-terapeutico.service'
import {
  registrarSubstituicao,
  buscarCriteriosRecomendacao,
  calcularRecomendacaoAutomatica,
} from '@/services/substituicoes.service'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { GrupoTerapeutaMobile, ControleTerapeuticoItem } from './types'
import { getIniciais, getPaciente, getProfissionaisUnicos, getStatusProfNaHora, terapiasIgnoradas } from './helpers'
import ProfissionaisVerMaisModal from './ProfissionaisVerMaisModal'
import SeletorTerapeutaForaEspecialidade from './SeletorTerapeutaForaEspecialidade'

type SessaoCobertura = {
  id: number
  atendimento: ControleTerapeuticoItem
  disponivel: boolean | null   // null = não decidido (pendente)
  substitutoId: number | null
  substitutoNome: string | null
  substitutoTerapiaNome: string | null // terapia_nome real do substituto — usado p/ calcForaDaEspecialidade
  recomendadoId: number | null // profissional pré-selecionado pelo algoritmo
  buscaOutraEspecialidade: boolean     // toggle "Buscar em outra especialidade" ativo nesta sessão
  motivoExcecao: string                // motivo obrigatório quando fora da especialidade
}

/**
 * Deriva se o substituto atual da sessão está fora da matriz terapiasCompativeis
 * da Terapia Real da sessão. Não assume que toda seleção via o seletor de "outra
 * especialidade" seja necessariamente fora — compara de fato.
 */
function calcForaDaEspecialidade(sessao: SessaoCobertura): boolean {
  if (!sessao.substitutoId || !sessao.substitutoTerapiaNome) return false
  const terapiaSessao = String((sessao.atendimento as any)?.terapia_nome || '')
  return !terapiasCompativeis(terapiaSessao).includes(sessao.substitutoTerapiaNome)
}

type Props = {
  grupo: GrupoTerapeutaMobile | null
  data: string
  onClose: () => void
  onSuccess: () => void
}

export default function CoberturaModal({ grupo, data, onClose, onSuccess }: Props) {
  const [etapa, setEtapa] = useState<'motivo' | 'cobertura'>('motivo')
  const [tipoOcorrencia, setTipoOcorrencia] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const motivoCompleto = tipoOcorrencia && justificativa
    ? `${tipoOcorrencia} — ${justificativa}`
    : ''
  const [sessoes, setSessoes] = useState<SessaoCobertura[]>([])
  const [profissionais, setProfissionais] = useState<SlotModalSubstituicao[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [abaAtiva, setAbaAtiva] = useState<'manha' | 'tarde'>('manha')
  const [verMaisSessao, setVerMaisSessao] = useState<SessaoCobertura | null>(null)
  const [confirmandoExcecao, setConfirmandoExcecao] = useState(false)
  const [todosProfissionais, setTodosProfissionais] = useState<SlotModalSubstituicao[] | null>(null)
  const [carregandoTodos, setCarregandoTodos] = useState(false)
  const todosProfissionaisFetchedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Busca sob demanda: só quando algum toggle "outra especialidade" é ativado.
  // A busca é por unidade/dia (não por sessão), então uma única chamada serve todas.
  const garantirTodosProfissionaisCarregados = useCallback(() => {
    if (todosProfissionaisFetchedRef.current || !grupo) return
    todosProfissionaisFetchedRef.current = true
    setCarregandoTodos(true)
    listarTodosProfissionaisModal({ unidade: grupo.unidade, dataAtendimento: data })
      .then((todos) => {
        setTodosProfissionais(
          todos.filter(
            (p) => p.profissional_nome !== grupo.terapeuta && !terapiasIgnoradas.includes(p.terapia_nome)
          )
        )
      })
      .finally(() => setCarregandoTodos(false))
  }, [grupo, data])

  // Assim que todosProfissionais carrega, resolve sessões com substituto ainda sem
  // ID (substitutoNome preenchido mas fora da lista filtrada por especialidade) e
  // reabre o toggle "outra especialidade" para elas.
  useEffect(() => {
    if (!todosProfissionais) return
    setSessoes((prev) => prev.map((s) => {
      if (s.substitutoNome && !s.substitutoId) {
        const prof = todosProfissionais.find((p) => p.profissional_nome === s.substitutoNome)
        if (prof != null) {
          return {
            ...s,
            substitutoId: prof.profissional_id,
            substitutoTerapiaNome: prof.terapia_nome,
            buscaOutraEspecialidade: true,
          }
        }
      }
      return s
    }))
  }, [todosProfissionais])

  useEffect(() => {
    if (!grupo) return

    const jaIndisponivel = grupo.atendimentos.some((a) => {
      const s = String(a.status ?? '').toLowerCase()
      return s === 'indisponivel' || s === 'substituido'
    })
    setEtapa(jaIndisponivel ? 'cobertura' : 'motivo')
    setTipoOcorrencia('')
    setJustificativa('')
    todosProfissionaisFetchedRef.current = false
    setTodosProfissionais(null)
    document.body.style.overflow = 'hidden'

    const ordenados = [...grupo.atendimentos].sort((a, b) =>
      String(a.hora_inicial).localeCompare(String(b.hora_inicial))
    )

    setSessoes(
      ordenados.map((a) => {
        const s = String(a.status ?? '').toLowerCase()
        const isSubstituido = s === 'substituido'
        return {
          id: a.tita_agendamento_id as number,
          atendimento: a,
          disponivel: s === 'disponivel' ? true : s === 'indisponivel' ? false : null,
          substitutoId: isSubstituido
            ? (a.profissional_substituto_id as number | null) ?? null
            : null,
          substitutoNome: isSubstituido
            ? a.profissional_substituto_nome ?? null
            : null,
          substitutoTerapiaNome: null,
          recomendadoId: null,
          buscaOutraEspecialidade: false,
          motivoExcecao: '',
        }
      })
    )

    // Compatibilidade usa Terapia Real (terapia_nome), não Terapia de Exibição
    const terapiaNome = String(
      (grupo.atendimentos[0] as any)?.terapia_nome || ''
    )

    setCarregando(true)
    listarModalSubstituicao({ terapiaNome, unidade: grupo.unidade, dataAtendimento: data })
      .then(async (profData) => {
        const semTerapeuta = profData.filter((p) => p.profissional_nome !== grupo.terapeuta)
        setProfissionais(semTerapeuta)

        // Resolve substitutoId por nome para sessões pré-carregadas sem ID
        const profByName = new Map(semTerapeuta.map((p) => [p.profissional_nome, p]))
        setSessoes((prev) => prev.map((s) => {
          if (s.substitutoNome && !s.substitutoId) {
            const prof = profByName.get(s.substitutoNome)
            if (prof != null) {
              return { ...s, substitutoId: prof.profissional_id, substitutoTerapiaNome: prof.terapia_nome }
            }
          }
          return s
        }))

        // Sessão já substituída por alguém fora da matriz de especialidade (persistida
        // por uma exceção anterior) não casa contra semTerapeuta — carrega todos os
        // profissionais da unidade/dia para resolver esses casos (ver efeito abaixo).
        const temSubstitutoForaDaLista = ordenados.some((a) => {
          const st = String(a.status ?? '').toLowerCase()
          return st === 'substituido' && a.profissional_substituto_nome && !profByName.has(a.profissional_substituto_nome)
        })
        if (temSubstitutoForaDaLista) garantirTodosProfissionaisCarregados()

        // ── Recomendação automática ──────────────────────────────────
        // Apenas profissionais Livres participam da pré-seleção (spec).
        const livres = semTerapeuta.filter((p) => p.status_slot === 'livre')
        if (livres.length === 0) return

        const profIds = [...new Set(livres.map((p) => p.profissional_id))]
        const competencia = `${data.slice(0, 4)}-${data.slice(5, 7)}`

        // Coleta paciente_id distintos das sessões sem decisão
        const pacienteIds = [
          ...new Set(
            ordenados
              .filter((a) => {
                const st = String(a.status ?? '').toLowerCase()
                return st !== 'disponivel' && st !== 'indisponivel'
              })
              .map((a) => (a as any).paciente_id as number | null)
              .filter((id): id is number => id != null)
          ),
        ]

        const criteria = await buscarCriteriosRecomendacao({
          pacienteIds,
          data,
          competencia,
          profIds,
        })

        setSessoes((prev) =>
          prev.map((s) => {
            // Não sobrescreve sessões que já têm decisão ou substituto definido
            if (s.disponivel !== null || s.substitutoId !== null) return s

            const hora = String(s.atendimento.hora_inicial || '').slice(0, 5)
            const sessaoTerapiaNome = String((s.atendimento as any)?.terapia_nome || '')
            const pacId = (s.atendimento as any).paciente_id as number | null

            // Profissionais livres disponíveis neste horário específico
            const livresNaHoraBase = semTerapeuta.filter(
              (p) => p.status_slot === 'livre' && p.hora.slice(0, 5) === hora
            )
            // Regra do Coordenador: mesma lógica do SessionRow — exclui Coordenador de Caso
            // quando há pelo menos um Livre ABA, alinhando o algoritmo com o que o UI exibe.
            const isAbaRec = (ABA_GROUP as readonly string[]).includes(sessaoTerapiaNome)
            const hasLivreAbaRec = isAbaRec && livresNaHoraBase.some(
              (p) => (ABA_GROUP as readonly string[]).includes(p.terapia_nome)
            )
            const livresNaHora = hasLivreAbaRec
              ? livresNaHoraBase.filter((p) => p.terapia_nome !== COORD_CASO)
              : livresNaHoraBase

            const recId = calcularRecomendacaoAutomatica(
              livresNaHora,
              sessaoTerapiaNome,
              pacId,
              criteria
            )
            if (!recId) return s

            const prof = semTerapeuta.find((p) => p.profissional_id === recId)
            return {
              ...s,
              disponivel: false,
              substitutoId: recId,
              substitutoNome: prof?.profissional_nome ?? null,
              recomendadoId: recId,
            }
          })
        )
      })
      .finally(() => setCarregando(false))

    const temManha = ordenados.some((a) => String(a.hora_inicial).slice(0, 5) < '13:00')
    setAbaAtiva(temManha ? 'manha' : 'tarde')

    return () => {
      document.body.style.overflow = 'auto'
    }
  }, [grupo])

  useEffect(() => {
    if (grupo) {
      previousFocusRef.current = document.activeElement as HTMLElement
      requestAnimationFrame(() => { dialogRef.current?.focus() })
    } else {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [grupo])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }, [onClose])

  const slotsMap = useMemo(() => {
    const map = new Map<number, SlotModalSubstituicao[]>()
    for (const s of profissionais) {
      if (!map.has(s.profissional_id)) map.set(s.profissional_id, [])
      map.get(s.profissional_id)!.push(s)
    }
    return map
  }, [profissionais])

  const profsUnicosModal = useMemo(() => getProfissionaisUnicos(profissionais), [profissionais])

  const sessoesManha = useMemo(
    () => sessoes.filter((s) => String(s.atendimento.hora_inicial).slice(0, 5) < '13:00'),
    [sessoes]
  )
  const sessoesTarde = useMemo(
    () => sessoes.filter((s) => String(s.atendimento.hora_inicial).slice(0, 5) >= '13:00'),
    [sessoes]
  )
  const sessoesExibidas = abaAtiva === 'manha' ? sessoesManha : sessoesTarde
  const semCobertura = sessoes.filter((s) => s.disponivel === false && !s.substitutoId).length
  const totalDisponiveis = sessoes.filter((s) => s.disponivel).length

  const sessoesForaEspecialidade = useMemo(() => sessoes.filter(calcForaDaEspecialidade), [sessoes])
  const sessoesForaSemMotivo = useMemo(
    () => sessoesForaEspecialidade.filter((s) => !s.motivoExcecao.trim()),
    [sessoesForaEspecialidade]
  )

  const horaInicial = sessoes[0]?.atendimento.hora_inicial
    ? String(sessoes[0].atendimento.hora_inicial).slice(0, 5)
    : ''
  const horaFinal = sessoes[sessoes.length - 1]?.atendimento.hora_final
    ? String(sessoes[sessoes.length - 1].atendimento.hora_final).slice(0, 5)
    : ''

  function selecionarSubstituto(
    sessaoId: number,
    profId: number | null,
    profNome: string | null,
    profTerapiaNome: string | null = null
  ) {
    setSessoes((prev) =>
      prev.map((s) =>
        s.id === sessaoId
          ? { ...s, disponivel: false, substitutoId: profId, substitutoNome: profNome, substitutoTerapiaNome: profTerapiaNome }
          : s
      )
    )
  }

  function marcarDisponivel(sessaoId: number) {
    setSessoes((prev) =>
      prev.map((s) =>
        s.id === sessaoId
          ? { ...s, disponivel: true, substitutoId: null, substitutoNome: null,
              substitutoTerapiaNome: null, buscaOutraEspecialidade: false, motivoExcecao: '' }
          : s
      )
    )
  }

  function marcarTodosDisponiveis() {
    setSessoes((prev) =>
      prev.map((s) => ({ ...s, disponivel: true, substitutoId: null, substitutoNome: null,
        substitutoTerapiaNome: null, buscaOutraEspecialidade: false, motivoExcecao: '' }))
    )
  }

  function marcarTodosIndisponiveis() {
    setSessoes((prev) =>
      prev.map((s) => ({ ...s, disponivel: false, substitutoId: null, substitutoNome: null,
        substitutoTerapiaNome: null, buscaOutraEspecialidade: false, motivoExcecao: '' }))
    )
  }

  function toggleBuscaOutraEspecialidade(sessaoId: number, ativo: boolean) {
    if (ativo) garantirTodosProfissionaisCarregados()
    setSessoes((prev) =>
      prev.map((s) => {
        if (s.id !== sessaoId) return s
        if (ativo) return { ...s, buscaOutraEspecialidade: true }
        // Desligou o toggle com um substituto fora da especialidade selecionado → desfaz o pick
        if (calcForaDaEspecialidade(s)) {
          return {
            ...s,
            buscaOutraEspecialidade: false,
            substitutoId: null,
            substitutoNome: null,
            substitutoTerapiaNome: null,
            disponivel: false,
            motivoExcecao: '',
          }
        }
        return { ...s, buscaOutraEspecialidade: false }
      })
    )
  }

  function setMotivoExcecaoSessao(sessaoId: number, motivo: string) {
    setSessoes((prev) => prev.map((s) => (s.id === sessaoId ? { ...s, motivoExcecao: motivo } : s)))
  }

  function handleClickConfirmar() {
    if (sessoesForaEspecialidade.length > 0) {
      setConfirmandoExcecao(true)
      return
    }
    handleConfirmar()
  }

  async function handleConfirmar() {
    if (!grupo) return
    setSalvando(true)
    try {
      const promessas: Promise<any>[] = []

      const disponiveisIds = sessoes.filter((s) => s.disponivel).map((s) => s.id)
      if (disponiveisIds.length > 0) {
        promessas.push(
          atualizarStatusAtendimentosEmLote({
            tita_agendamento_ids: disponiveisIds,
            status: 'disponivel',
          })
        )
      }

      const semSubstituto = sessoes
        .filter((s) => s.disponivel === false && !s.substitutoId && !s.substitutoNome)
        .map((s) => s.id)
      if (semSubstituto.length > 0) {
        promessas.push(
          atualizarStatusAtendimentosEmLote({
            tita_agendamento_ids: semSubstituto,
            status: 'indisponivel',
            observacao: motivoCompleto || null,
          })
        )
      }

      // Agrupa por substituto (ID + nome) para também passar profissional_substituto_id
      type SubstKey = { id: number; nome: string; ids: number[] }
      const bySubst = new Map<string, SubstKey>()
      for (const s of sessoes.filter((s) => s.substitutoId)) {
        const key = `${s.substitutoId}|${s.substitutoNome}`
        if (!bySubst.has(key)) {
          bySubst.set(key, { id: s.substitutoId!, nome: s.substitutoNome!, ids: [] })
        }
        bySubst.get(key)!.ids.push(s.id)
      }

      // Executa upserts de substituídos rastreando qual batch salvou com sucesso.
      // Histórico só é gravado para sessões cujo upsert retornou dados (não null).
      const substResultados = await Promise.all(
        [...bySubst.values()].map(async (batch) => {
          const res = await atualizarStatusAtendimentosEmLote({
            tita_agendamento_ids: batch.ids,
            status: 'substituido',
            profissional_substituto_id: batch.id,
            profissional_substituto_nome: batch.nome,
            observacao: motivoCompleto || null,
          })
          return res !== null ? batch : null
        })
      )

      await Promise.all(promessas)

      // ── Registro histórico (somente substituições efetivamente salvas) ────
      const idsComSucesso = new Set(
        substResultados.filter(Boolean).flatMap((b) => b!.ids)
      )
      const sessoesSub = sessoes.filter(
        (s) => s.substitutoId && s.substitutoNome && idsComSucesso.has(s.id)
      )
      if (sessoesSub.length > 0) {
        const competencia = `${data.slice(0, 4)}-${data.slice(5, 7)}`
        const supabase = getSupabaseClient()
        const { data: { user } } = await supabase.auth.getUser()
        const usuarioResponsavel = user?.email ?? null

        const profOriginalId =
          typeof grupo.atendimentos[0]?.profissional_id === 'number'
            ? (grupo.atendimentos[0].profissional_id as number)
            : null

        await Promise.all(
          sessoesSub.map((s) => {
            const fora = calcForaDaEspecialidade(s)
            return registrarSubstituicao({
              sessao_id:                    s.id,
              paciente_id:                  (s.atendimento as any).paciente_id ?? null,
              paciente_nome:                ((s.atendimento as any).paciente_nome ?? null) as string | null,
              unidade_nome:                 grupo.unidade,
              terapia_real:                 String((s.atendimento as any).terapia_nome || ''),
              data_sessao:                  data,
              horario_inicio:               s.atendimento.hora_inicial ? String(s.atendimento.hora_inicial).slice(0, 5) : null,
              horario_fim:                  s.atendimento.hora_final ? String(s.atendimento.hora_final).slice(0, 5) : null,
              profissional_original_id:     profOriginalId,
              profissional_original_nome:   grupo.terapeuta,
              profissional_substituto_id:   s.substitutoId!,
              profissional_substituto_nome: s.substitutoNome!,
              competencia,
              motivo:                       motivoCompleto || null,
              usuario_responsavel:          usuarioResponsavel,
              fora_da_especialidade:        fora,
              motivo_excecao:               fora ? (s.motivoExcecao.trim() || null) : null,
            })
          })
        )
      }

      onSuccess()
      onClose()
    } finally {
      setSalvando(false)
    }
  }

  if (!grupo) return null

  const iniciais = getIniciais(grupo.terapeuta)
  const dataFormatada = formatarData(data)

  // ── Step 1: Motivo ──────────────────────────────────────────────
  if (etapa === 'motivo') {
    return (
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cobertura-modal-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          className="bg-white w-full max-w-lg rounded-2xl flex flex-col overflow-hidden shadow-2xl outline-none"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center font-bold text-base shrink-0 select-none">
                {iniciais}
              </div>
              <div className="min-w-0">
                <h2 id="cobertura-modal-title" className="text-lg font-bold text-slate-800 leading-tight truncate">{grupo.terapeuta}</h2>
                <p className="text-sm text-[#3A8FB7] font-medium">{grupo.terapia}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Fechar modal" className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-4">
            {/* Tipo de Ocorrência */}
            <div>
              <label htmlFor="tipo-ocorrencia" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Tipo de Ocorrência
              </label>
              <div className="relative">
                <select
                  id="tipo-ocorrencia"
                  value={tipoOcorrencia}
                  onChange={(e) => setTipoOcorrencia(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm font-medium text-slate-700 outline-none focus:ring-4 focus:ring-[#3A8FB7]/20 focus:border-[#3A8FB7] transition cursor-pointer"
                >
                  <option value="">Selecione o tipo...</option>
                  <option value="Atraso">Atraso</option>
                  <option value="Falta Parcial">Falta Parcial</option>
                  <option value="Falta Integral">Falta Integral</option>
                  <option value="Falta programada (futuro)">Falta programada (futuro)</option>
                  <option value="Saída antecipada">Saída antecipada</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Justificativa */}
            <div>
              <label htmlFor="justificativa" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Justificativa
              </label>
              <div className="relative">
                <select
                  id="justificativa"
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm font-medium text-slate-700 outline-none focus:ring-4 focus:ring-[#3A8FB7]/20 focus:border-[#3A8FB7] transition cursor-pointer"
                >
                  <option value="">Selecione a justificativa...</option>
                  <option value="Saúde do profissional">Saúde do profissional</option>
                  <option value="Saúde de familiar">Saúde de familiar</option>
                  <option value="Compromissos pessoais">Compromissos pessoais</option>
                  <option value="Consulta médica">Consulta médica</option>
                  <option value="Cursos/congressos">Cursos/congressos</option>
                  <option value="Viagem">Viagem</option>
                  <option value="Sem justificativa">Sem justificativa</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Preview em tempo real */}
            {tipoOcorrencia && justificativa && (
              <div className="rounded-xl bg-blue-50 border border-[#3A8FB7]/20 px-4 py-3 flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={14} className="text-[#3A8FB7]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#3A8FB7] uppercase tracking-wide mb-0.5">Registro selecionado</p>
                  <p className="text-sm font-bold text-slate-800">{tipoOcorrencia}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{justificativa}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-5 h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none"
            >
              Cancelar
            </button>
            <button
              onClick={() => setEtapa('cobertura')}
              disabled={!tipoOcorrencia || !justificativa}
              className="px-5 h-10 rounded-xl bg-[#3A8FB7] text-white text-sm font-semibold hover:bg-[#2d7a9b] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              Continuar
              <Check size={15} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 2: Cobertura ───────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cobertura-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="bg-white w-full max-w-[96vw] max-h-[96vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl outline-none"
      >
        {/* ── Cabeçalho ── */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center font-bold text-xl shrink-0 select-none">
              {iniciais}
            </div>
            <div className="min-w-0">
              <h2 id="cobertura-modal-title" className="text-2xl font-bold text-slate-800 leading-tight">{grupo.terapeuta}</h2>
              <p className="text-base text-[#3A8FB7] font-medium mt-0.5">{grupo.terapia}</p>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-500 flex-wrap">
                <CalendarDays size={14} />
                <span>{dataFormatada}</span>
                {horaInicial && horaFinal && (
                  <>
                    <span>·</span>
                    <Clock size={14} />
                    <span className="font-semibold">{horaInicial} às {horaFinal}</span>
                  </>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                <Users size={14} className="text-slate-400" />
                <span>
                  <b>{sessoes.length}</b> sessões afetadas
                </span>
              </div>
              {motivoCompleto && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-1 leading-tight">
                    Motivo: {motivoCompleto}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3 shrink-0">
            {/* Status da cobertura */}
            <div
              className={`rounded-xl px-4 py-3 min-w-50 border ${
                semCobertura === 0
                  ? 'bg-emerald-50 border-emerald-100'
                  : 'bg-rose-50 border-rose-100'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={14} className={semCobertura === 0 ? 'text-emerald-500' : 'text-rose-500'} />
                <span className={`text-xs font-semibold ${semCobertura === 0 ? 'text-[var(--status-ok)]' : 'text-rose-600'}`}>
                  Status da cobertura
                </span>
              </div>
              <p className={`text-base font-bold ${semCobertura === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {semCobertura === 0 ? 'Cobertura completa' : `${semCobertura} sem cobertura`}
              </p>
              <p className={`text-xs mt-0.5 ${semCobertura === 0 ? 'text-emerald-500' : 'text-rose-400'}`}>
                {totalDisponiveis > 0 && `${totalDisponiveis} disponível · `}
                {sessoes.filter((s) => s.substitutoId).length} com substituto
              </p>
            </div>

            <button
              onClick={onClose}
              aria-label="Fechar modal"
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Abas ── */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => setAbaAtiva('manha')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-base font-semibold transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none ${
              abaAtiva === 'manha'
                ? 'bg-[#eef5fb] text-[#3A8FB7] border border-[#3A8FB7]/30'
                : 'text-slate-500 hover:bg-slate-50 border border-transparent'
            }`}
          >
            ☀ Manhã ({sessoesManha.length})
          </button>
          <button
            onClick={() => setAbaAtiva('tarde')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-base font-semibold transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none ${
              abaAtiva === 'tarde'
                ? 'bg-[#eef5fb] text-[#3A8FB7] border border-[#3A8FB7]/30'
                : 'text-slate-500 hover:bg-slate-50 border border-transparent'
            }`}
          >
            🌙 Tarde ({sessoesTarde.length})
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={marcarTodosDisponiveis}
              className="h-8 px-3 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 transition focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
            >
              Todos disponíveis
            </button>
            <button
              type="button"
              onClick={marcarTodosIndisponiveis}
              className="h-8 px-3 rounded-lg border border-rose-300 text-rose-600 text-xs font-semibold hover:bg-rose-50 transition focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
            >
              Todos indisponíveis
            </button>
          </div>
        </div>

        {/* ── Lista de sessões ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {carregando ? (
            <div className="py-20 text-center text-slate-400 text-sm">
              Carregando profissionais compatíveis...
            </div>
          ) : sessoesExibidas.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">
              Nenhuma sessão neste período.
            </div>
          ) : (
            <div className="space-y-3">
              {sessoesExibidas.map((sessao) => (
                <SessionRow
                  key={sessao.id}
                  sessao={sessao}
                  profissionais={profissionais}
                  profsUnicos={profsUnicosModal}
                  slotsMap={slotsMap}
                  recomendadoId={sessao.recomendadoId}
                  todosProfissionais={todosProfissionais}
                  carregandoTodos={carregandoTodos}
                  onSelecionar={selecionarSubstituto}
                  onMarcarDisponivel={marcarDisponivel}
                  onVerMais={() => setVerMaisSessao(sessao)}
                  onToggleForaEspecialidade={toggleBuscaOutraEspecialidade}
                  onMotivoExcecaoChange={setMotivoExcecaoSessao}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Rodapé ── */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-base text-slate-500">
            <Users size={17} className="text-slate-400 shrink-0" />
            {sessoesForaSemMotivo.length > 0 ? (
              <span>
                <b className="text-amber-700">{sessoesForaSemMotivo.length} {sessoesForaSemMotivo.length === 1 ? 'sessão fora da especialidade' : 'sessões fora da especialidade'}</b>{' '}
                sem motivo da exceção preenchido.
              </span>
            ) : semCobertura > 0 ? (
              <span>
                <b className="text-slate-700">{semCobertura} {semCobertura === 1 ? 'sessão' : 'sessões'}</b>{' '}
                ainda sem cobertura. Selecione um substituto ou deixe como{' '}
                <span className="font-semibold">Sem substituição</span>.
              </span>
            ) : (
              <span className="text-[var(--status-ok)] font-semibold">
                Todas as sessões com cobertura definida.
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-6 h-11 rounded-xl border border-rose-200 bg-rose-50 text-base font-semibold text-rose-700 hover:bg-rose-100 transition focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:outline-none"
            >
              Cancelar
            </button>
            <button
              disabled={salvando || sessoesForaSemMotivo.length > 0}
              onClick={handleClickConfirmar}
              className="px-6 h-11 rounded-xl bg-[#059669] text-white text-base font-semibold hover:bg-[#047857] disabled:opacity-50 transition flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-[#059669]/50 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              {salvando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {salvando ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Overlay de confirmação: substituição fora da especialidade ── */}
      {confirmandoExcecao && (
        <div
          onClick={() => setConfirmandoExcecao(false)}
          className="fixed inset-0 z-70 bg-black/60 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
          >
            <div className="px-6 py-5 flex items-start gap-3 border-b border-amber-100 bg-amber-50">
              <AlertTriangle size={22} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-slate-800">Confirmar substituição fora da especialidade?</h3>
                <p className="text-sm text-slate-600 mt-1">
                  {sessoesForaEspecialidade.length} {sessoesForaEspecialidade.length === 1 ? 'sessão será coberta' : 'sessões serão cobertas'}{' '}
                  por profissional de outra especialidade. A exceção será registrada no histórico com o motivo informado.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 space-y-2 max-h-48 overflow-y-auto">
              {sessoesForaEspecialidade.map((s) => (
                <div key={s.id} className="text-xs text-slate-600 flex items-center justify-between gap-2">
                  <span className="truncate">{String(s.atendimento.hora_inicial).slice(0, 5)} · {getPaciente(s.atendimento)}</span>
                  <span className="font-semibold text-amber-700 truncate">{s.substitutoNome}</span>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex justify-end gap-2">
              <button
                onClick={() => setConfirmandoExcecao(false)}
                className="px-5 h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none"
              >
                Voltar e revisar
              </button>
              <button
                onClick={() => { setConfirmandoExcecao(false); handleConfirmar() }}
                className="px-5 h-10 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 focus-visible:outline-none"
              >
                Sim, confirmar exceção
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Ver mais ── */}
      {verMaisSessao && (
        <ProfissionaisVerMaisModal
          profissionais={profissionaisDoTurno(
            profissionais,
            String(verMaisSessao.atendimento.hora_inicial).slice(0, 5),
            String((verMaisSessao.atendimento as any)?.terapia_nome || '')
          )}
          sessaoContext={{
            horario: `${String(verMaisSessao.atendimento.hora_inicial).slice(0, 5)} – ${String(verMaisSessao.atendimento.hora_final).slice(0, 5)}`,
            horaInicial: String(verMaisSessao.atendimento.hora_inicial).slice(0, 5),
            paciente: getPaciente(verMaisSessao.atendimento),
            terapia: String(
              (verMaisSessao.atendimento as any).terapia_exibicao_nome ||
              (verMaisSessao.atendimento as any).terapia_exibicao ||
              grupo.terapia
            ),
          }}
          substitutoAtualId={verMaisSessao.substitutoId}
          onSelect={(id, nome) => {
            const prof = profissionais.find((p) => p.profissional_id === id)
            selecionarSubstituto(verMaisSessao.id, id, nome, prof?.terapia_nome ?? null)
            setVerMaisSessao(null)
          }}
          onClose={() => setVerMaisSessao(null)}
        />
      )}
    </div>
  )
}

// ── SessionRow ──────────────────────────────────────────────────

const SessionRow = memo(function SessionRow({
  sessao,
  profissionais,
  profsUnicos,
  slotsMap,
  recomendadoId,
  todosProfissionais,
  carregandoTodos,
  onSelecionar,
  onMarcarDisponivel,
  onVerMais,
  onToggleForaEspecialidade,
  onMotivoExcecaoChange,
}: {
  sessao: SessaoCobertura
  profissionais: SlotModalSubstituicao[]
  profsUnicos: { id: number; nome: string; unidade: string; terapia_nome: string }[]
  slotsMap: Map<number, SlotModalSubstituicao[]>
  recomendadoId: number | null
  todosProfissionais: SlotModalSubstituicao[] | null
  carregandoTodos: boolean
  onSelecionar: (id: number, profId: number | null, nome: string | null, terapiaNome?: string | null) => void
  onMarcarDisponivel: (id: number) => void
  onVerMais: () => void
  onToggleForaEspecialidade: (sessaoId: number, ativo: boolean) => void
  onMotivoExcecaoChange: (sessaoId: number, motivo: string) => void
}) {
  const hora = String(sessao.atendimento.hora_inicial).slice(0, 5)
  const horaFim = String(sessao.atendimento.hora_final).slice(0, 5)
  const paciente = getPaciente(sessao.atendimento)
  const terapia = String(
    (sessao.atendimento as any).terapia_exibicao_nome ||
    (sessao.atendimento as any).terapia_exibicao ||
    ''
  )
  const sala = String(
    (sessao.atendimento as any).sala ||
    (sessao.atendimento as any).sala_nome ||
    (sessao.atendimento as any).numero_sala ||
    ''
  )
  const iniciaisPaciente = getIniciais(paciente)

  const profsComStatus = useMemo(() => {
    const turnoSessao = hora < '13:00' ? 'manha' : 'tarde'
    const ordemStatus: Record<string, number> = { livre: 0, ocupado: 1, sem_agenda_hoje: 2 }

    const profsDoTurno = profsUnicos.filter((p) => {
      const todosSlots = slotsMap.get(p.id) ?? []
      const slotsDoDia = todosSlots.filter((s) => s.status_slot !== 'sem_agenda_hoje')

      // Tem slots hoje: incluir somente se há slot no horário exato da sessão
      if (slotsDoDia.length > 0) {
        return slotsDoDia.some((s) => s.hora.slice(0, 5) === hora)
      }

      // Sem agenda hoje: incluir se turno_semana bate com o turno da sessão
      const semAgenda = todosSlots.find((s) => s.status_slot === 'sem_agenda_hoje')
      if (!semAgenda?.turno_semana) return false
      return semAgenda.turno_semana === 'ambos' || semAgenda.turno_semana === turnoSessao
    })

    const profsComStatusRaw = profsDoTurno
      .map((p) => ({ ...p, ...getStatusProfNaHora(slotsMap.get(p.id) ?? [], hora) }))

    // Regra Coordenador de Caso (spec): só exibir quando não houver nenhum ABA Livre
    const sessaoTerapiaNome = String((sessao.atendimento as any)?.terapia_nome || '')
    const isAbaSession = (ABA_GROUP as readonly string[]).includes(sessaoTerapiaNome)

    let profsFinais = profsComStatusRaw
    if (isAbaSession) {
      const hasLivreAba = profsComStatusRaw.some(
        (p) => p.status === 'livre' && (ABA_GROUP as readonly string[]).includes(p.terapia_nome)
      )
      if (hasLivreAba) {
        profsFinais = profsComStatusRaw.filter((p) => p.terapia_nome !== COORD_CASO)
      }
    }

    return profsFinais.sort((a, b) => (ordemStatus[a.status] ?? 3) - (ordemStatus[b.status] ?? 3))
  }, [profsUnicos, slotsMap, hora])

  // Garante que o profissional recomendado seja sempre o primeiro card visível
  const profsOrdenados = useMemo(() => {
    if (!recomendadoId) return profsComStatus
    const idx = profsComStatus.findIndex((p) => p.id === recomendadoId)
    if (idx <= 0) return profsComStatus
    const lista = [...profsComStatus]
    lista.unshift(lista.splice(idx, 1)[0])
    return lista
  }, [profsComStatus, recomendadoId])

  const top3 = profsOrdenados.slice(0, 5)
  const restante = Math.max(0, profsOrdenados.length - 5)
  const selecionadoId = sessao.substitutoId
  const temSubstituto = !!selecionadoId || !!sessao.substitutoNome
  const foraDaEspecialidadeAtual = calcForaDaEspecialidade(sessao)
  const toggleManualRef = useRef<HTMLButtonElement>(null)

  // Esc no campo de busca cancela a substituição manual e devolve o foco ao botão
  // que a abriu — assim um 2º Esc (agora capturado pelo diálogo) fecha o modal.
  function cancelarSubstituicaoManual() {
    onToggleForaEspecialidade(sessao.id, false)
    toggleManualRef.current?.focus()
  }

  return (
    <div className="flex flex-col md:flex-row md:items-stretch bg-white border border-slate-100 rounded-xl overflow-hidden hover:border-slate-200 transition">
      {/* Col 1 – Horário */}
      <div className="md:w-24 md:shrink-0 flex md:flex-col items-center md:justify-center gap-3 md:gap-1 py-3 md:py-4 px-4 md:px-2 bg-slate-50/60 border-b border-slate-100 md:border-b-0 md:border-r">
        <Clock size={15} className="text-[#3A8FB7]" />
        <span className="text-sm font-bold text-[#3A8FB7] tabular-nums">{hora}</span>
        <span className="text-xs text-slate-400 tabular-nums">{horaFim}</span>
        <span className="hidden md:block text-xs text-slate-400 md:mt-0.5">40 min</span>
      </div>

      {/* Col 2 – Paciente + decisão */}
      <div className="md:w-64 md:shrink-0 flex flex-col justify-between px-3 py-4 border-b border-slate-100 md:border-b-0 md:border-r">
        <div className="flex items-start gap-2">
          <div className="w-10 h-10 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 select-none">
            {iniciaisPaciente}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-800 leading-tight truncate">{paciente}</p>
            <p className="text-sm text-[#3A8FB7] font-medium mt-0.5 truncate">{terapia}</p>
            {sala ? (
              <div className="flex items-center gap-1 mt-1">
                <MapPin size={12} className="text-slate-400 shrink-0" />
                <span className="text-xs text-slate-400">{sala}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Botões de decisão */}
        <div className="mt-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onMarcarDisponivel(sessao.id)}
            className={`flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none ${
              sessao.disponivel
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 hover:border-emerald-300 bg-white text-slate-600'
            }`}
          >
            <Check size={12} className={sessao.disponivel ? 'text-emerald-600' : 'text-slate-400'} />
            Disponível
          </button>
          <button
            type="button"
            onClick={() => onSelecionar(sessao.id, null, null)}
            className={`flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none ${
              sessao.disponivel === false && !temSubstituto
                ? 'border-rose-500 bg-rose-50 text-rose-700'
                : 'border-slate-200 hover:border-rose-300 bg-white text-slate-600'
            }`}
          >
            <Clock size={12} className={sessao.disponivel === false && !temSubstituto ? 'text-rose-500' : 'text-slate-400'} />
            Indisponível
          </button>
        </div>
      </div>

      {/* Col 3 – Profissionais substitutos */}
      <div className="flex-1 min-w-0 px-3 py-4 border-b border-slate-100 md:border-b-0 md:border-r">
        <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
          Profissionais compatíveis da semana
        </p>

        <div className="flex flex-nowrap md:flex-wrap gap-2 items-start overflow-x-auto pb-1 md:pb-0">
          {/* Profissionais */}
          {top3.map((prof) => (
            <ProfMiniCard
              key={prof.id}
              prof={prof}
              selecionado={selecionadoId === prof.id}
              recomendado={recomendadoId === prof.id}
              onClick={() => onSelecionar(sessao.id, prof.id, prof.nome, prof.terapia_nome)}
            />
          ))}

          {/* Ver mais */}
          {restante > 0 && (
            <button
              type="button"
              onClick={onVerMais}
              className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-[#3A8FB7]/50 transition shrink-0 w-25 min-h-22 focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none"
            >
              <span className="text-base font-bold text-slate-500">+{restante}</span>
              <span className="text-xs text-slate-400 text-center leading-tight">Ver mais</span>
            </button>
          )}

          {/* Substituição manual — fora da matriz de especialidade */}
          <button
            ref={toggleManualRef}
            type="button"
            role="switch"
            aria-checked={sessao.buscaOutraEspecialidade}
            onClick={() => onToggleForaEspecialidade(sessao.id, !sessao.buscaOutraEspecialidade)}
            className={`flex flex-col items-center justify-center gap-1 p-2 rounded-xl border-2 transition shrink-0 w-25 min-h-22 ml-auto focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${
              sessao.buscaOutraEspecialidade
                ? 'border-amber-500 bg-amber-50'
                : 'border-dashed border-amber-300 hover:border-amber-500 bg-white'
            }`}
          >
            <Search size={16} className="text-amber-500" />
            <span className="text-[11px] font-semibold text-amber-700 text-center leading-tight">
              Substituição Manual
            </span>
          </button>
        </div>

        {sessao.buscaOutraEspecialidade && (
          <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-2">
            <SeletorTerapeutaForaEspecialidade
              todosProfissionais={todosProfissionais ?? []}
              carregando={carregandoTodos}
              hora={hora}
              valorSelecionadoId={foraDaEspecialidadeAtual ? sessao.substitutoId : null}
              onSelect={(id, nome, terapiaNome) => onSelecionar(sessao.id, id, nome, terapiaNome)}
              onCancel={cancelarSubstituicaoManual}
            />
            {foraDaEspecialidadeAtual && (
              <div>
                <label className="block text-[11px] font-semibold text-amber-700 mb-1">
                  Motivo da exceção (obrigatório)
                </label>
                <input
                  type="text"
                  value={sessao.motivoExcecao}
                  onChange={(e) => onMotivoExcecaoChange(sessao.id, e.target.value)}
                  placeholder="Ex.: nenhum terapeuta da especialidade disponível neste horário"
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Col 4 – Seleção atual */}
      <div className="md:w-52 md:shrink-0 px-3 py-4 flex items-center">
        {sessao.disponivel === true ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 w-full">
            <div className="flex items-center gap-1.5 mb-1">
              <Check size={13} className="text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700">Seleção atual</span>
            </div>
            <p className="text-sm font-bold text-emerald-700 leading-snug">Terapeuta disponível</p>
            <p className="text-xs text-emerald-500 mt-0.5 leading-tight">Atenderá normalmente</p>
          </div>
        ) : temSubstituto ? (
          <div className="bg-[#f0f8fd] border border-[#3A8FB7]/30 rounded-xl p-3 w-full">
            <div className="flex items-center gap-1.5 mb-1">
              <Check size={13} className="text-[#3A8FB7]" />
              <span className="text-xs font-semibold text-[#3A8FB7]">Seleção atual</span>
            </div>
            <p className="text-sm font-bold text-slate-800 leading-snug">{sessao.substitutoNome}</p>
            {foraDaEspecialidadeAtual && (
              <span className="inline-block mt-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                Fora da especialidade
              </span>
            )}
          </div>
        ) : sessao.disponivel === false ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 w-full">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={13} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-500">Seleção atual</span>
            </div>
            <p className="text-sm font-semibold text-slate-600">Sem substituição</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-tight">
              Paciente ficará sem cobertura
            </p>
          </div>
        ) : (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3 w-full">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={13} className="text-slate-300" />
              <span className="text-xs font-semibold text-slate-400">Aguarda decisão</span>
            </div>
            <p className="text-sm text-slate-400">Sessão pendente</p>
          </div>
        )}
      </div>
    </div>
  )
})

// ── ProfMiniCard ────────────────────────────────────────────────

const ProfMiniCard = memo(function ProfMiniCard({
  prof,
  selecionado,
  recomendado,
  onClick,
}: {
  prof: { id: number; nome: string; status: string; paciente: string | null }
  selecionado: boolean
  recomendado: boolean
  onClick: () => void
}) {
  const iniciais = getIniciais(prof.nome)

  const label =
    prof.status === 'livre'
      ? 'Livre'
      : prof.status === 'sem_agenda_hoje'
        ? 'Não trab. hoje'
        : 'Ocupado'

  const badgeClass =
    prof.status === 'livre'
      ? 'bg-emerald-100 text-emerald-700'
      : prof.status === 'sem_agenda_hoje'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-amber-100 text-amber-700'

  return (
    <button
      type="button"
      onClick={onClick}
      title={prof.nome}
      className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/50 focus-visible:outline-none shrink-0 w-25 min-h-24 ${
        selecionado
          ? 'border-[#3A8FB7] bg-[#f0f8fd]'
          : recomendado
            ? 'border-amber-400 bg-amber-50 hover:border-amber-500'
            : 'border-slate-200 hover:border-[#3A8FB7]/50 bg-white'
      }`}
    >
      <div className="relative w-10 h-10 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center text-xs font-bold select-none shrink-0">
        {iniciais}
        {selecionado && (
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#3A8FB7] flex items-center justify-center">
            <Check size={9} className="text-white" />
          </div>
        )}
      </div>
      <span className="text-[11px] font-bold text-slate-700 text-center leading-tight w-full truncate px-0.5">
        {prof.nome}
      </span>
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badgeClass}`}>
        {label}
      </span>
      {recomendado && !selecionado && (
        <span className="text-[10px] font-semibold text-[var(--status-atencao)] whitespace-nowrap">
          Recomendado
        </span>
      )}
      {prof.status === 'ocupado' && prof.paciente && !recomendado && (
        <span className="text-[10px] text-slate-400 text-center leading-tight truncate w-full px-0.5">
          {prof.paciente.split(' ')[0]}
        </span>
      )}
    </button>
  )
})

// ── Helpers ─────────────────────────────────────────────────────

function profissionaisDoTurno(
  slots: SlotModalSubstituicao[],
  hora: string,
  sessaoTerapiaNome: string
): SlotModalSubstituicao[] {
  const turno = hora < '13:00' ? 'manha' : 'tarde'
  const idsDoTurno = new Set<number>()
  for (const s of slots) {
    if (s.status_slot === 'sem_agenda_hoje') {
      if (s.turno_semana === 'ambos' || s.turno_semana === turno) {
        idsDoTurno.add(s.profissional_id)
      }
      continue
    }
    if (s.hora.slice(0, 5) === hora) {
      idsDoTurno.add(s.profissional_id)
    }
  }

  const elegiveis = slots.filter((s) => idsDoTurno.has(s.profissional_id))

  // Regra CC: para sessões ABA, ocultar CC quando houver ABA Livre
  const isAba = (ABA_GROUP as readonly string[]).includes(sessaoTerapiaNome)
  if (!isAba) return elegiveis

  const hasLivreAba = elegiveis.some(
    (s) => s.status_slot === 'livre' && (ABA_GROUP as readonly string[]).includes(s.terapia_nome)
  )
  return hasLivreAba
    ? elegiveis.filter((s) => s.terapia_nome !== COORD_CASO)
    : elegiveis
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ]
  const diasSemana = [
    'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado',
  ]
  const date = new Date(ano, mes - 1, dia)
  return `${dia} de ${meses[mes - 1]} de ${ano} (${diasSemana[date.getDay()]})`
}

