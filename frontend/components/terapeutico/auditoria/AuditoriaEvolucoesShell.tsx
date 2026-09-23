'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Sparkles,
  Search,
  RefreshCw,
  AlertTriangle,
  Users,
  FileSearch,
  ScrollText,
  History
} from 'lucide-react'
import { useToneColor } from '@/hooks/useToneColor'
import type { Tone } from '@/hooks/useToneColor'
import { TONE_CHIP, TONE_PANEL } from '@/components/ui/tones'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import type { AtalhoPeriodo } from '@/components/ui/date-range-picker'
import {
  buscarEvolucoesComAuditoria,
  calcularResumoProfissionais
} from '@/services/auditoriaEvolucoes.service'
import { buscarCriteriosVigentes } from '@/services/auditoriaCriterios.service'
import type {
  EvolucaoPendenteAuditoria,
  ResumoProfissionalAuditoria,
  StatusRiscoEvolucao,
  StatusCobrancaEvolucao
} from '@/types/auditoriaEvolucoes'
import { ProfissionaisCobrancaTab } from './ProfissionaisCobrancaTab'
import { EvolucoesFeedTab } from './EvolucoesFeedTab'
import { ModalDetalheEvolucao } from './ModalDetalheEvolucao'
import { ModalCriterios } from './ModalCriterios'
import { ModalCobrancaWhatsApp } from './ModalCobrancaWhatsApp'
import {
  tomDaConformidade,
  tomSeHouver,
  CARTAO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  FOCO
} from './vocabulario'

/** Marco em que a auditoria de evoluções entrou em operação. */
const PISO_PERIODO = '2026-09-01'

/**
 * Data no fuso de QUEM OLHA, não em UTC. `toISOString()` converte para UTC, e
 * em UTC-3 isso vira o dia seguinte a partir das 21h — a tela é usada pelas
 * atendentes à noite, então "Hoje" traria o dia errado e o campo "Até"
 * apareceria com uma data futura.
 */
const diaLocalISO = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]

const hojeISO = () => diaLocalISO(new Date())

const diasAtrasISO = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return diaLocalISO(d)
}

const ontemISO = () => diasAtrasISO(1)

/**
 * Atalhos de período — dentro do calendário, não na faixa de filtros.
 *
 * Como botões soltos ao lado dos campos, eles eram um segundo widget
 * escrevendo a mesma variável, e ao digitar uma data ficavam visíveis e sem
 * sentido. Dentro do popover são o que sempre foram: um jeito rápido de
 * preencher o intervalo, fechado logo em seguida.
 *
 * O intervalo é função e não valor: "hoje" mudaria se a tela ficasse aberta
 * pela virada do dia — e ela fica, porque a recepção usa isto à noite.
 */
const ATALHOS_PERIODO: AtalhoPeriodo[] = [
  { rotulo: 'Ontem', intervalo: () => ({ inicio: ontemISO(), fim: ontemISO() }) },
  { rotulo: 'Hoje', intervalo: () => ({ inicio: hojeISO(), fim: hojeISO() }) },
  { rotulo: 'Últimos 7 dias', intervalo: () => ({ inicio: diasAtrasISO(6), fim: hojeISO() }) }
  // "Desde o início" saiu: é exatamente o que o "Limpar" do calendário faz, e
  // dois botões com o mesmo efeito lado a lado é a duplicação que esta tela
  // vem perdendo.
]

/** Recorte que a tela mostra. Vive na URL, não em `useState`. */
interface Recorte {
  dataInicio: string
  dataFim: string
  busca: string
  statusRisco: StatusRiscoEvolucao | 'todos'
  statusCobranca: StatusCobrancaEvolucao | 'todos'
  aba: 'profissionais' | 'feed'
}

const RISCOS_VALIDOS: readonly string[] = ['sem_risco', 'risco_especifico', 'risco_relevante']
const COBRANCAS_VALIDAS: readonly string[] = [
  'pendente', 'cobrado', 'aguardando_correcao', 'corrigido_tita', 'ignorado'
]

/** `YYYY-MM-DD` e nada mais — a URL é entrada de fora, não estado confiável. */
const dataValida = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Lê o recorte da query string.
 *
 * Valor ausente ou inválido cai no padrão em silêncio: um link velho ou torto
 * deve abrir a tela no estado normal, nunca numa tela quebrada.
 */
function lerRecorte(sp: URLSearchParams): Recorte {
  const risco = sp.get('risco')
  const cobranca = sp.get('cobranca')
  const de = sp.get('de')
  const ate = sp.get('ate')
  return {
    dataInicio: dataValida(de) ? de : PISO_PERIODO,
    dataFim: dataValida(ate) ? ate : hojeISO(),
    busca: sp.get('q') ?? '',
    statusRisco: RISCOS_VALIDOS.includes(risco ?? '')
      ? (risco as StatusRiscoEvolucao)
      : 'todos',
    statusCobranca: COBRANCAS_VALIDAS.includes(cobranca ?? '')
      ? (cobranca as StatusCobrancaEvolucao)
      : 'todos',
    aba: sp.get('aba') === 'feed' ? 'feed' : 'profissionais'
  }
}

/**
 * Só o que difere do padrão entra na URL.
 *
 * Sem isso, a barra de endereços viraria um paredão de parâmetros no estado
 * inicial — e o link que a pessoa copia para um colega deve carregar a
 * intenção dela, não o default da tela.
 */
function escreverRecorte(r: Recorte): string {
  const sp = new URLSearchParams()
  if (r.dataInicio !== PISO_PERIODO) sp.set('de', r.dataInicio)
  if (r.dataFim !== hojeISO()) sp.set('ate', r.dataFim)
  if (r.busca) sp.set('q', r.busca)
  if (r.statusRisco !== 'todos') sp.set('risco', r.statusRisco)
  if (r.statusCobranca !== 'todos') sp.set('cobranca', r.statusCobranca)
  if (r.aba !== 'profissionais') sp.set('aba', r.aba)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function AuditoriaEvolucoesShell() {
  const toneColor = useToneColor()
  const router = useRouter()
  const searchParams = useSearchParams()

  /*
   * O recorte é derivado da URL a cada render — a URL é a fonte única.
   *
   * Isso resolve três coisas de uma vez: F5 não perde mais o que a pessoa
   * escolheu, o botão Voltar do navegador desfaz um filtro, e o link copiado
   * abre o mesmo recorte no outro computador. O custo é que toda mudança de
   * filtro passa por `router.replace`.
   */
  const recorte = React.useMemo(
    () => lerRecorte(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )
  const { dataInicio, dataFim, statusRisco, statusCobranca, aba: abaAtiva } = recorte

  /*
   * `replace` e não `push`: cada tecla digitada na busca criaria uma entrada no
   * histórico, e voltar exigiria um Voltar por caractere. `scroll: false`
   * porque trocar filtro não é navegar — a pessoa continua olhando o mesmo
   * ponto da tela.
   */
  const pathname = usePathname()

  const aplicar = useCallback(
    (mudanca: Partial<Recorte>) => {
      // O caminho vai junto: `router.replace('')` é destino vazio e não
      // navega, então voltar o recorte ao padrão — que produz query vazia —
      // deixava a tela congelada no filtro anterior.
      router.replace(`${pathname}${escreverRecorte({ ...recorte, ...mudanca })}`, { scroll: false })
    },
    [router, pathname, recorte]
  )

  /*
   * A busca é a exceção: digitar precisa de resposta imediata no input, e
   * `router.replace` a cada tecla engasgaria. O campo é controlado por estado
   * local e a URL recebe o valor depois de 350ms parado.
   */
  const [buscaLocal, setBuscaLocal] = useState(recorte.busca)

  // A URL mandando de volta no campo: acontece quando o recorte veio de fora
  // (link colado, Voltar do navegador, ou o "Ver evoluções" de um card).
  useEffect(() => {
    setBuscaLocal(recorte.busca)
  }, [recorte.busca])

  useEffect(() => {
    if (buscaLocal === recorte.busca) return
    const t = setTimeout(() => aplicar({ busca: buscaLocal }), 350)
    return () => clearTimeout(t)
  }, [buscaLocal, recorte.busca, aplicar])

  const busca = recorte.busca

  const [evolucoes, setEvolucoes] = useState<EvolucaoPendenteAuditoria[]>([])
  // `carregouUmaVez` separa a primeira carga (skeleton) da recarga (a lista fica
  // onde está e só aparece "Atualizando…"). Ver §3.9 do padrão: esconder o que a
  // pessoa está lendo é pior que esperar.
  const [carregando, setCarregando] = useState(true)
  const [carregouUmaVez, setCarregouUmaVez] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [auditandoLote, setAuditandoLote] = useState(false)
  const [progressoLote, setProgressoLote] = useState<{ atual: number; total: number } | null>(null)
  /*
   * O aviso carrega o próprio tom, em vez de a UI adivinhá-lo pelo texto.
   * "N não puderam ser auditadas" e "todas já foram auditadas" dividiam o mesmo
   * cinza mudo — duas mensagens de significado oposto com a mesma aparência.
   */
  const [avisoLote, setAvisoLote] = useState<{ texto: string; falha: boolean } | null>(null)
  const falhaNoLote = avisoLote?.falha ?? false

  const [criteriosAberto, setCriteriosAberto] = useState(false)
  // Versão vigente dos critérios, para saber quais auditorias ficaram para trás.
  const [versaoCriteriosVigente, setVersaoCriteriosVigente] = useState<number | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<EvolucaoPendenteAuditoria | null>(null)
  const [profSelecionadoCobranca, setProfSelecionadoCobranca] = useState<ResumoProfissionalAuditoria | null>(null)

  /*
   * A busca NÃO vai para o servidor.
   *
   * Antes ela era mandada na requisição e também aplicada no cliente, mas não
   * entrava nas dependências do efeito — então o recorte do servidor só mudava
   * na próxima recarga por outro motivo, e no meio tempo valia o filtro local.
   * Dois significados no mesmo campo. Agora há um: o servidor traz o período e
   * os status, a busca recorta em memória.
   */
  const carregarDados = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const { data, error } = await buscarEvolucoesComAuditoria({
        dataInicio,
        dataFim: dataFim || undefined,
        statusRisco,
        statusCobranca
      })
      if (error) {
        setErro(error)
      } else {
        setEvolucoes(data)
      }
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar dados')
    } finally {
      setCarregando(false)
      setCarregouUmaVez(true)
    }
  }, [dataInicio, dataFim, statusRisco, statusCobranca])

  // Intervalo invertido não é recorte, é erro de digitação — e buscar com ele
  // devolveria zero linhas, que a tela mostraria como "nenhuma evolução".
  const periodoInvertido = Boolean(dataInicio && dataFim && dataInicio > dataFim)

  useEffect(() => {
    if (periodoInvertido) return
    void carregarDados()
  }, [carregarDados, periodoInvertido])

  const carregarVersaoVigente = async () => {
    const { versao } = await buscarCriteriosVigentes()
    setVersaoCriteriosVigente(versao)
  }

  useEffect(() => {
    void carregarVersaoVigente()
  }, [])

  const evolucoesFiltradas = React.useMemo(() => {
    if (!busca) return evolucoes
    const b = busca.toLowerCase()
    return evolucoes.filter(r =>
      r.paciente_nome.toLowerCase().includes(b) ||
      r.profissional_nome.toLowerCase().includes(b) ||
      (r.terapia_nome && r.terapia_nome.toLowerCase().includes(b)) ||
      (r.texto_original && r.texto_original.toLowerCase().includes(b))
    )
  }, [evolucoes, busca])

  // A busca vale nas DUAS abas: os resumos saem da lista já filtrada, senão
  // digitar um nome em "Por profissional" não mudava nada na tela.
  const resumosProfissionais = React.useMemo(() => {
    return calcularResumoProfissionais(evolucoesFiltradas)
  }, [evolucoesFiltradas])

  // KPIs — sobre a lista filtrada, para não contradizerem o que está na tela
  // quando a busca recorta um terapeuta.
  const totalEvolucoes = evolucoesFiltradas.length
  const totalAuditadas = evolucoesFiltradas.filter(e => e.auditoria !== null).length
  const totalPendentesIA = totalEvolucoes - totalAuditadas
  const totalSemRisco = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'sem_risco').length
  const totalRiscoEspecifico = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'risco_especifico').length
  const totalRiscoRelevante = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'risco_relevante').length
  const totalPendentesCobranca = evolucoesFiltradas.filter(
    e => e.auditoria && e.auditoria.status_risco !== 'sem_risco' && e.auditoria.status_cobranca === 'pendente'
  ).length
  // Sem denominador não há percentual — "—", nunca 0% (§4 do padrão).
  const taxaConformidadeGeral = totalAuditadas > 0
    ? Math.round((totalSemRisco / totalAuditadas) * 100)
    : null

  /**
   * Processa um conjunto de evoluções em lotes.
   *
   * Serve aos dois botões: "Auditar novas" (só o que nunca foi auditado) e
   * "Reauditar com os critérios atuais" (o que ficou numa versão antiga da
   * régua). O que muda é a lista de entrada e a flag `reauditar`.
   */
  const processarEmLotes = async (
    alvos: EvolucaoPendenteAuditoria[],
    opcoes: { reauditar: boolean }
  ) => {
    setAvisoLote(null)
    setAuditandoLote(true)
    setProgressoLote({ atual: 0, total: alvos.length })

    const TAMANHO_LOTE = 5
    let processados = 0
    let falharam = 0

    for (let i = 0; i < alvos.length; i += TAMANHO_LOTE) {
      const chunk = alvos.slice(i, i + TAMANHO_LOTE)
      const ids = chunk.map(c => c.grade_id)

      try {
        const res = await fetch('/api/terapeutico/auditoria-evolucoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gradeIds: ids,
            dataInicio,
            dataFim: dataFim || undefined,
            limite: TAMANHO_LOTE,
            reauditar: opcoes.reauditar
          })
        })

        const json = await res.json()
        if (json.success) {
          processados += json.processados || chunk.length
          falharam += Array.isArray(json.falhas) ? json.falhas.length : 0
          setProgressoLote({ atual: Math.min(processados, alvos.length), total: alvos.length })
        } else {
          // 401/403 ou erro de servidor: o lote inteiro não passou.
          falharam += chunk.length
          console.error('Lote recusado:', json.error)
        }
      } catch (e) {
        falharam += chunk.length
        console.error('Erro no lote de auditoria:', e)
      }
    }

    setAuditandoLote(false)
    setProgressoLote(null)

    // Falha de IA não pode passar despercebida: antes, o item sumia do lote sem
    // que ninguém soubesse que ele não chegou a ser auditado.
    if (falharam > 0) {
      setAvisoLote({
        texto: `${falharam} ${falharam === 1 ? 'evolução não pôde' : 'evoluções não puderam'} ser ${falharam === 1 ? 'auditada' : 'auditadas'}. Tente novamente; se persistir, avise a tecnologia.`,
        falha: true
      })
    }

    await carregarDados()
  }

  const handleAuditarLote = async () => {
    /*
     * Parte de `evolucoesFiltradas`, não de `evolucoes`: o botão agora anuncia
     * a quantidade, e os KPIs já contam sobre a lista filtrada. Auditando o
     * conjunto inteiro, "Auditar 3 novas evoluções" processaria 40 — o rótulo
     * mentiria sempre que houvesse busca ativa.
     */
    const pendentes = evolucoesFiltradas.filter(e => !e.auditoria)
    if (pendentes.length === 0) {
      setAvisoLote({ texto: 'Todas as evoluções deste período já foram auditadas.', falha: false })
      return
    }
    await processarEmLotes(pendentes, { reauditar: false })
  }

  /**
   * Evoluções julgadas por uma versão anterior dos critérios.
   *
   * Publicar novos critérios NÃO reprocessa nada — reescrever veredito em cima
   * de cobrança já enviada seria um estrago. Reaplicar a régua é decisão
   * explícita de quem opera, e é este botão.
   */
  const desatualizadas = React.useMemo(() => {
    if (versaoCriteriosVigente === null) return []
    return evolucoesFiltradas.filter(
      e =>
        e.auditoria &&
        (e.auditoria.criterios_versao_numero ?? 0) < versaoCriteriosVigente
    )
  }, [evolucoesFiltradas, versaoCriteriosVigente])

  const handleReauditarDesatualizadas = async () => {
    if (desatualizadas.length === 0) return
    if (
      !window.confirm(
        `Reauditar ${desatualizadas.length} ${desatualizadas.length === 1 ? 'evolução' : 'evoluções'} com os critérios atuais?\n\nO veredito anterior será substituído.`
      )
    ) {
      return
    }
    await processarEmLotes(desatualizadas, { reauditar: true })
  }

  const handleReauditarItem = async (gradeId: string) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gradeIds: [gradeId],
        reauditar: true,
        limite: 1
      })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
      const atualizado = evolucoes.find(e => e.grade_id === gradeId)
      if (atualizado) {
        setItemSelecionado(atualizado)
      }
    }
  }

  const handleAtualizarStatusCobranca = async (
    auditoriaId: string,
    novoStatus: StatusCobrancaEvolucao,
    observacao?: string
  ) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditoriaId, novoStatus, observacao })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

  const handleConfirmarCobrancaWhatsApp = async (auditoriaIds: string[], observacao: string) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditoriaIds, novoStatus: 'cobrado', observacao })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

  /**
   * Só a busca é limpa ao voltar: ela foi posta pelo "Ver evoluções" para
   * isolar UM terapeuta, então sobrevivendo faria a visão geral reabrir com um
   * profissional só, sem nada na tela explicando o sumiço dos outros.
   *
   * Período, risco e cobrança FICAM — são o recorte que a pessoa escolheu, e
   * valem igual nas duas abas.
   */
  const voltarParaProfissionais = () => {
    aplicar({ busca: '', aba: 'profissionais' })
  }

  /**
   * Cinco cards, cinco recortes — e clicar num card É o filtro.
   *
   * Os dois <select> de risco e cobrança ofereciam exatamente estes mesmos
   * cortes, sem o número que motiva o clique. Mesma decisão já documentada em
   * auditoria-assim/FiltrosAuditoria.tsx: quando o card e o seletor escrevem o
   * mesmo campo, o seletor é a porta que ninguém usa.
   *
   * `alvo` null = o card Total, que limpa os dois filtros.
   */
  const cardAtivo = (alvo: { risco?: StatusRiscoEvolucao; cobranca?: StatusCobrancaEvolucao } | null) => {
    if (alvo === null) return statusRisco === 'todos' && statusCobranca === 'todos'
    if (alvo.cobranca) return statusCobranca === alvo.cobranca
    return statusRisco === alvo.risco
  }

  const alternarCard = (alvo: { risco?: StatusRiscoEvolucao; cobranca?: StatusCobrancaEvolucao } | null) => {
    if (alvo === null) {
      aplicar({ statusRisco: 'todos', statusCobranca: 'todos' })
      return
    }
    // Re-clicar desfaz: um filtro que só liga é uma armadilha.
    if (cardAtivo(alvo)) {
      aplicar(alvo.cobranca ? { statusCobranca: 'todos' } : { statusRisco: 'todos' })
      return
    }
    // Os dois eixos são independentes no banco, mas oferecer os dois ao mesmo
    // tempo produziria interseções vazias sem explicação. Um card = um recorte.
    aplicar(
      alvo.cobranca
        ? { statusCobranca: alvo.cobranca, statusRisco: 'todos' }
        : { statusRisco: alvo.risco!, statusCobranca: 'todos' }
    )
  }

  const primeiraCarga = carregando && !carregouUmaVez

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col">

      {/*
        A lede da tela: o que está pendente. Os botões desceram para a linha de
        abas e filtros, então aqui fica só o estado — o número que motiva a
        ação, e não mais o `title` escondido que ele era antes.
      */}
      <div className="min-w-0 space-y-0.5">
          <p className="text-sm text-foreground">
            {primeiraCarga ? (
              <span className="inline-block h-4 w-56 rounded bg-muted align-middle motion-safe:animate-pulse" />
            ) : totalPendentesIA > 0 ? (
              <>
                <strong className="font-bold tabular-nums">{totalPendentesIA}</strong>{' '}
                {totalPendentesIA === 1 ? 'evolução aguardando' : 'evoluções aguardando'} auditoria
              </>
            ) : totalEvolucoes > 0 ? (
              'Todas as evoluções do período já foram auditadas.'
            ) : (
              'Nenhuma evolução neste período.'
            )}
          </p>

          <p className="text-xs text-muted-foreground">
            {versaoCriteriosVigente !== null && (
              <span className="tabular-nums">Critérios v{versaoCriteriosVigente}</span>
            )}
            {/*
              A reauditoria sai da fileira de botões e vem morar junto do fato
              que a motiva. Era o rótulo mais longo da região e quebrava todo
              cálculo de quebra de linha; e sendo destrutiva, não devia ser
              irmã visual de "Atualizar".
            */}
            {desatualizadas.length > 0 && (
              <>
                {versaoCriteriosVigente !== null && ' · '}
                <span className="tabular-nums">{desatualizadas.length}</span>{' '}
                {desatualizadas.length === 1 ? 'auditada' : 'auditadas'} com a versão anterior —{' '}
                <button
                  onClick={handleReauditarDesatualizadas}
                  disabled={auditandoLote || carregando}
                  className={`rounded font-semibold text-brand-fg underline underline-offset-2 transition hover:text-brand-dark disabled:opacity-40 ${FOCO}`}
                >
                  <History className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                  reaplicar critérios atuais
                </button>
              </>
            )}
          </p>
      </div>

      {/*
        Falha não é recado neutro. Antes os dois casos — "N não puderam ser
        auditadas" e "todas já foram auditadas" — dividiam o mesmo cinza, o que
        contraria o próprio motivo de existir do aviso.
      */}
      {avisoLote && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
            falhaNoLote
              ? `${TONE_PANEL.amber.bg} ring-1 ${TONE_PANEL.amber.ring} ${TONE_CHIP.amber.text}`
              : 'border border-border bg-muted/40 text-muted-foreground'
          }`}
        >
          {falhaNoLote && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
          {avisoLote.texto}
        </p>
      )}

      {/* KPIs — e os KPIs SÃO o filtro de risco/cobrança. */}
      {primeiraCarga ? (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`rounded-2xl border-2 border-border bg-card p-5 shadow-sm ${
                i === 4 ? 'col-span-2 lg:col-span-1' : ''
              }`}
            >
              <div className="h-3 w-24 rounded bg-muted motion-safe:animate-pulse" />
              <div className="mt-2 h-7 w-12 rounded bg-muted motion-safe:animate-pulse" />
              <div className="mt-2 h-2.5 w-28 rounded bg-muted motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi
            rotulo="Evoluções no período"
            valor={totalEvolucoes}
            nota={totalPendentesIA > 0
              ? `${totalAuditadas} auditadas · ${totalPendentesIA} aguardando IA`
              : `${totalAuditadas} auditadas`}
            ativo={cardAtivo(null)}
            onClick={() => alternarCard(null)}
            rotuloFiltro="Mostrar tudo"
          />
          <Kpi
            rotulo="Conformidade"
            valor={taxaConformidadeGeral === null ? '—' : `${taxaConformidadeGeral}%`}
            tom={tomDaConformidade(taxaConformidadeGeral)}
            cor={toneColor(tomDaConformidade(taxaConformidadeGeral))}
            nota={`${totalSemRisco} sem risco de glosa`}
            ativo={cardAtivo({ risco: 'sem_risco' })}
            onClick={() => alternarCard({ risco: 'sem_risco' })}
            desabilitado={totalSemRisco === 0}
            rotuloFiltro="Ver as sem risco"
          />
          <Kpi
            rotulo="Ponto específico"
            valor={totalRiscoEspecifico}
            tom={tomSeHouver(totalRiscoEspecifico, 'amber')}
            cor={toneColor(tomSeHouver(totalRiscoEspecifico, 'amber'))}
            nota="Ajustes pontuais de redação"
            ativo={cardAtivo({ risco: 'risco_especifico' })}
            onClick={() => alternarCard({ risco: 'risco_especifico' })}
            desabilitado={totalRiscoEspecifico === 0}
            rotuloFiltro="Ver só estas"
          />
          <Kpi
            rotulo="Risco relevante"
            valor={totalRiscoRelevante}
            tom={tomSeHouver(totalRiscoRelevante, 'red')}
            cor={toneColor(tomSeHouver(totalRiscoRelevante, 'red'))}
            nota="Incompletas ou termos vedados"
            ativo={cardAtivo({ risco: 'risco_relevante' })}
            onClick={() => alternarCard({ risco: 'risco_relevante' })}
            desabilitado={totalRiscoRelevante === 0}
            rotuloFiltro="Ver só estas"
          />
          <Kpi
            rotulo="A cobrar"
            valor={totalPendentesCobranca}
            tom={tomSeHouver(totalPendentesCobranca, 'blue')}
            cor={toneColor(tomSeHouver(totalPendentesCobranca, 'blue'))}
            nota="Terapeuta ainda não avisado"
            ativo={cardAtivo({ cobranca: 'pendente' })}
            onClick={() => alternarCard({ cobranca: 'pendente' })}
            desabilitado={totalPendentesCobranca === 0}
            rotuloFiltro="Ver quem falta cobrar"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      )}

      {/*
        Uma linha só: abas, período e busca — nesta ordem.
        Abas e filtros voltaram a dividir a faixa por decisão de quem usa a
        tela. O que os separa agora não é a linha, é o peso: as abas ficam no
        grupo com fundo (`bg-muted/60`), os filtros ficam soltos.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">

        <div role="tablist" className="flex w-fit shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-1">
          <button
            role="tab"
            aria-selected={abaAtiva === 'profissionais'}
            onClick={voltarParaProfissionais}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition ${FOCO} ${
              abaAtiva === 'profissionais'
                ? 'bg-card font-bold text-foreground shadow-sm'
                : 'font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-4 w-4" />
            Por profissional
            {totalPendentesCobranca > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>
                {totalPendentesCobranca}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={abaAtiva === 'feed'}
            onClick={() => aplicar({ aba: 'feed' })}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition ${FOCO} ${
              abaAtiva === 'feed'
                ? 'bg-card font-bold text-foreground shadow-sm'
                : 'font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileSearch className="h-4 w-4" />
            Todas as evoluções
            <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${TONE_CHIP.gray.bg} ${TONE_CHIP.gray.text}`}>
              {totalEvolucoes}
            </span>
          </button>
        </div>

        {/*
          O período é o filtro que importa, e é o único aqui que pede presença:
          data em peso maior e ícone na cor da marca. Eram dois campos
          `type="date"` — duas portas para uma variável, e no celular duas
          tomadas de tela do seletor nativo para definir um intervalo.
        */}
        <DateRangePicker
          inicio={dataInicio}
          fim={dataFim}
          onChange={({ inicio, fim }) => aplicar({ dataInicio: inicio, dataFim: fim })}
          atalhos={ATALHOS_PERIODO}
          // Limpar = voltar ao recorte com que a tela abre. Como é o padrão,
          // os parâmetros saem da URL e o link volta a ser o endereço limpo.
          padrao={() => ({ inicio: PISO_PERIODO, fim: hojeISO() })}
        />

        {/*
          A busca é auxiliar e se comporta como tal: sem moldura em repouso,
          só um fundo sutil. Antes era `flex-1` com borda — ocupava metade da
          linha e pesava mais que os dois controles que mandam na tela.
          A borda aparece no foco, quando ela vira o objeto da atenção.
        */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            aria-label="Buscar paciente ou terapeuta"
            placeholder="Buscar paciente ou terapeuta"
            value={buscaLocal}
            onChange={e => setBuscaLocal(e.target.value)}
            className={`h-9 w-44 rounded-lg border border-transparent bg-muted/50 pl-8 pr-2.5 text-xs
              xl:w-56
              text-foreground placeholder:text-muted-foreground/70 transition
              hover:bg-muted focus:border-border focus:bg-background
              focus:outline-none focus:ring-2 focus:ring-ring`}
          />
        </div>

        {/*
          As ações fecham a linha, encostadas à direita pelo `ml-auto`.
          A ordem segue o peso: referência (Critérios), utilitário (Atualizar,
          só ícone) e por último a ação que cria estado.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/*
            Rótulo só a partir de `xl`. Abaixo disso a linha não comporta os
            sete controles, e "Critérios" é referência consultada de vez em
            quando — o primeiro rótulo a ceder espaço, não o último.
          */}
          <button
            onClick={() => setCriteriosAberto(true)}
            className={`${BOTAO_SECUNDARIO} w-9 justify-center px-0 xl:w-auto xl:px-2.5`}
            title="Ver os critérios que a IA aplica"
            aria-label="Critérios"
          >
            <ScrollText className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Critérios</span>
          </button>

          <button
            onClick={carregarDados}
            disabled={carregando}
            aria-label="Atualizar"
            title="Atualizar"
            className={`${BOTAO_SECUNDARIO} w-9 justify-center px-0`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? 'motion-safe:animate-spin' : ''}`} />
          </button>

          {/*
            O progresso do lote é o próprio botão: como bloco separado, ele
            empurrava a grade de KPIs para baixo exatamente no instante em que
            a pessoa observava os números mudarem.
          */}
          <button
            onClick={handleAuditarLote}
            disabled={auditandoLote || carregando || totalPendentesIA === 0}
            title={
              totalPendentesIA > 0
                ? `Auditar ${totalPendentesIA} ${totalPendentesIA === 1 ? 'nova evolução' : 'novas evoluções'} com IA`
                : 'Nenhuma evolução nova para auditar'
            }
            /*
             * Rótulo curto e `min-w` menor: com sete controles na linha, o
             * texto por extenso era o que estourava a largura disponível. A
             * frase completa vive no `title`, e o `min-w` segura a contagem
             * mudando sem o botão encolher a cada lote.
             */
            className={`${BOTAO_PRIMARIO} relative min-w-36 justify-center overflow-hidden`}
          >
            {auditandoLote && progressoLote && progressoLote.total > 0 && (
              <span
                aria-hidden
                className="absolute inset-0 bg-brand-dark"
                style={{
                  clipPath: `inset(0 ${100 - Math.round((progressoLote.atual / progressoLote.total) * 100)}% 0 0)`,
                  transition: 'clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)'
                }}
              />
            )}
            <Sparkles className={`relative h-4 w-4 ${auditandoLote ? 'motion-safe:animate-spin' : ''}`} />
            <span className="relative tabular-nums">
              {auditandoLote && progressoLote
                ? `${progressoLote.atual} de ${progressoLote.total}…`
                : totalPendentesIA > 0
                  ? `Auditar ${totalPendentesIA}`
                  : 'Auditar'}
            </span>
          </button>
        </div>
      </div>

      {/*
        Intervalo invertido: a busca nem sai, porque devolveria zero linhas e a
        tela diria "nenhuma evolução" — culpando o período por um erro de
        digitação.
      */}
      {periodoInvertido && (
        <p className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${TONE_PANEL.amber.bg} ring-1 ${TONE_PANEL.amber.ring} ${TONE_CHIP.amber.text}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          A data inicial está depois da final. Corrija o intervalo para ver as evoluções.
        </p>
      )}

      {/* Recarga com dado na tela: a lista fica, o aviso é discreto (§3.9). */}
      {carregando && carregouUmaVez && (
        <p className="mt-2 text-xs text-muted-foreground">Atualizando…</p>
      )}

      {/*
        O espaçamento carrega o agrupamento: `mt-1.5` para o que pertence à
        linha acima (a legenda), `mt-3`/`mt-4` entre grupos. Antes tudo era um
        `gap-4` uniforme — e espaçamento uniforme é a ausência de agrupamento.
      */}
      <div className="mt-4">
        {erro ? (
          <div className={`${CARTAO} space-y-2 p-6 text-center ${TONE_PANEL.red.bg}`}>
            <AlertTriangle className={`mx-auto h-8 w-8 ${TONE_CHIP.red.text}`} />
            <h3 className="text-sm font-semibold text-foreground">Não foi possível carregar as evoluções</h3>
            <p className="text-xs text-muted-foreground">{erro}</p>
            <button onClick={carregarDados} className={`${BOTAO_SECUNDARIO} mx-auto mt-1`}>
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar de novo
            </button>
          </div>
        ) : primeiraCarga ? (
          <ListaSkeleton aba={abaAtiva} />
        ) : abaAtiva === 'profissionais' ? (
          <ProfissionaisCobrancaTab
            resumos={resumosProfissionais}
            onCobrarProfissional={prof => setProfSelecionadoCobranca(prof)}
            onVerEvolucoesProfissional={prof => {
              aplicar({ busca: prof.profissional_nome, aba: 'feed' })
            }}
          />
        ) : (
          <EvolucoesFeedTab
            evolucoes={evolucoesFiltradas}
            onSelecionarEvolucao={item => setItemSelecionado(item)}
          />
        )}
      </div>

      {/*
        §3.12 do padrão: estado nasce limpo por `key`, não por efeito. Sem isto,
        abrir outra evolução carregava o status de cobrança e a observação já
        digitados na anterior — e a pessoa salvaria isso sem perceber.
      */}
      <ModalDetalheEvolucao
        key={itemSelecionado?.grade_id ?? 'fechado'}
        item={itemSelecionado}
        isOpen={Boolean(itemSelecionado)}
        onClose={() => setItemSelecionado(null)}
        onReauditar={handleReauditarItem}
        onAtualizarStatusCobranca={handleAtualizarStatusCobranca}
      />

      <ModalCobrancaWhatsApp
        profissional={profSelecionadoCobranca}
        isOpen={Boolean(profSelecionadoCobranca)}
        onClose={() => setProfSelecionadoCobranca(null)}
        onConfirmarCobranca={handleConfirmarCobrancaWhatsApp}
      />

      <ModalCriterios
        isOpen={criteriosAberto}
        onClose={() => setCriteriosAberto(false)}
        // Publicou: a Shell precisa saber para o botão "Reauditar com critérios
        // atuais" aparecer sem depender de um F5.
        onPublicou={carregarVersaoVigente}
      />

    </div>
  )
}

/**
 * Borda do card selecionado, por tom.
 *
 * Escrita por extenso porque o Tailwind varre o código em busca de classes
 * literais — montar `border-${tom}-300` em tempo de execução produziria classes
 * que nunca chegam ao CSS. Espelha `TONE_PANEL.ring` de components/ui/tones.
 */
const BORDA_ATIVA: Record<Tone, string> = {
  green: 'border-emerald-300 dark:border-emerald-700',
  amber: 'border-amber-300 dark:border-amber-700',
  red: 'border-rose-300 dark:border-rose-700',
  purple: 'border-purple-300 dark:border-purple-700',
  blue: 'border-sky-300 dark:border-sky-700',
  gray: 'border-slate-300 dark:border-slate-600'
}

/**
 * Cartão de KPI que também é o filtro daquele recorte.
 *
 * Era um `<div>` inerte enquanto dois `<select>` ofereciam os mesmos cortes sem
 * o número que motiva o clique — a porta interessante estava pintada na parede.
 * O padrão de card-como-filtro (`border-2` + tint no ativo) vem de
 * central-terapeutas/ControleFiltersBar e auditoria-assim/FiltrosAuditoria; a
 * diferença aqui é usar os tokens semânticos em vez da paleta crua.
 *
 * Card com zero fica desabilitado: oferecer um filtro que não devolve nada é
 * prometer uma porta para um cômodo vazio.
 */
function Kpi({
  rotulo, valor, nota, cor, tom = 'gray', ativo = false,
  desabilitado = false, onClick, rotuloFiltro, className = ''
}: {
  rotulo: string
  valor: number | string
  nota: string
  cor?: string
  tom?: Tone
  ativo?: boolean
  desabilitado?: boolean
  onClick?: () => void
  rotuloFiltro?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-pressed={ativo}
      title={desabilitado ? undefined : rotuloFiltro}
      className={`
        rounded-2xl border-2 p-5 text-left shadow-sm transition
        ${FOCO}
        ${ativo
          ? `${TONE_PANEL[tom].bg} ${BORDA_ATIVA[tom]}`
          : 'border-border bg-card'}
        ${desabilitado
          ? 'cursor-default opacity-60'
          : 'cursor-pointer hover:-translate-y-px hover:shadow-md'}
        ${className}
      `}
    >
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <div
        className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground"
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </div>
      <span className="mt-1.5 block text-[11px] text-muted-foreground">{nota}</span>
    </button>
  )
}

/** Skeleton no formato do layout real — §3.9: o vazio só aparece depois da carga. */
function ListaSkeleton({ aba }: { aba: 'profissionais' | 'feed' }) {
  if (aba === 'profissionais') {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted motion-safe:animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-2.5 w-20 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-muted motion-safe:animate-pulse" />
            <div className="mt-4 h-14 rounded-lg bg-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
          <div className="h-5 w-24 rounded-full bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 flex-1 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}
