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
  Copy
} from 'lucide-react'
import { useToneColor } from '@/hooks/useToneColor'
import type { Tone } from '@/hooks/useToneColor'
import { TONE_CHIP, TONE_PANEL } from '@/components/ui/tones'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import type { AtalhoPeriodo } from '@/components/ui/date-range-picker'
import {
  buscarEvolucoesComAuditoria,
  calcularResumoProfissionais,
  detectarEvolucoesDuplicadasEntrePacientes
} from '@/services/auditoriaEvolucoes.service'
import type { GrupoEvolucaoDuplicada } from '@/services/auditoriaEvolucoes.service'
import { buscarCriteriosVigentes } from '@/services/auditoriaCriterios.service'
import type {
  EvolucaoPendenteAuditoria,
  ResumoProfissionalAuditoria,
  StatusRiscoEvolucao,
  StatusCobrancaEvolucao
} from '@/types/auditoriaEvolucoes'
import { ProfissionaisCobrancaTab } from './ProfissionaisCobrancaTab'
import { EvolucoesFeedTab } from './EvolucoesFeedTab'
import { EvolucoesDuplicadasTab } from './EvolucoesDuplicadasTab'
import { ModalComparadorDuplicadas } from './ModalComparadorDuplicadas'
import { ModalDetalheEvolucao } from './ModalDetalheEvolucao'
import { ModalCriterios } from './ModalCriterios'
import { ModalConfirmacao } from './ModalConfirmacao'
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
  statusRisco: StatusRiscoEvolucao | 'todos' | 'com_risco'
  statusCobranca: StatusCobrancaEvolucao | 'todos'
  aba: 'profissionais' | 'feed' | 'duplicadas'
}

const RISCOS_VALIDOS: readonly string[] = ['sem_risco', 'risco_especifico', 'risco_relevante', 'com_risco']

const ROTULO_STATUS_RISCO: Record<StatusRiscoEvolucao | 'com_risco', string> = {
  sem_risco: 'Sem risco',
  risco_especifico: 'Ponto específico',
  risco_relevante: 'Risco relevante',
  com_risco: 'Com risco'
}

const ROTULO_STATUS_COBRANCA: Record<StatusCobrancaEvolucao, string> = {
  pendente: 'A cobrar',
  cobrado: 'Cobrado',
  aguardando_correcao: 'Aguardando correção',
  corrigido_tita: 'Corrigido no TiTa',
  ignorado: 'Ignorado'
}
const COBRANCAS_VALIDAS: readonly string[] = [
  'pendente', 'cobrado', 'aguardando_correcao', 'corrigido_tita', 'ignorado'
]

/** `YYYY-MM-DD` e nada mais — a URL é entrada de fora, não estado confiável. */
const dataValida = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

// Barra final: trailingSlash está ligado no next.config; sem ela o POST passa
// por um 308 antes de chegar.
const URL_FILA = '/api/terapeutico/auditoria-evolucoes/fila/'

/** Espelha public.resumo_fila_reauditoria(). */
interface ResumoFila {
  em_andamento: boolean
  lotes: string[]
  total: number
  feitos: number
  falharam: number
  cancelados: number
  pendentes: number
  concluido_em: string | null
}

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
    aba: sp.get('aba') === 'feed' ? 'feed' : sp.get('aba') === 'duplicadas' ? 'duplicadas' : 'profissionais'
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

  // A auditoria em massa roda no servidor (fila); a tela só enfileira e
  // acompanha. Fechar a aba não para mais nada.
  const [fila, setFila] = useState<ResumoFila | null>(null)
  const [enfileirando, setEnfileirando] = useState(false)
  const auditandoLote = enfileirando || Boolean(fila?.em_andamento)
  const progressoLote = fila?.em_andamento
    ? { atual: fila.total - fila.pendentes, total: fila.total }
    : null
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
  const [comparacaoDuplicada, setComparacaoDuplicada] = useState<{
    grupo: GrupoEvolucaoDuplicada
    item: EvolucaoPendenteAuditoria
  } | null>(null)

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
      // Sem statusRisco/statusCobranca aqui: o servidor sempre traz o período
      // inteiro. Os KPIs precisam do total do período mesmo com outro KPI
      // ativo — mandando o filtro para o servidor, "Evoluções no período" e
      // os demais KPIs encolhiam junto com o card clicado, e nenhum deles
      // sobrava para mostrar "de quanto" aquele recorte era uma fatia.
      const { data, error } = await buscarEvolucoesComAuditoria({
        dataInicio,
        dataFim: dataFim || undefined
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
  }, [dataInicio, dataFim])

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

  // Só a busca — os KPIs saem daqui, então precisam do período inteiro para
  // continuar mostrando "de quanto" um card de risco/cobrança é uma fatia.
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

  // Busca + o card de risco/cobrança ativo — é o que as abas efetivamente listam.
  const evolucoesDaLista = React.useMemo(() => {
    let lista = evolucoesFiltradas
    if (statusRisco === 'com_risco') {
      lista = lista.filter(e => e.auditoria && e.auditoria.status_risco !== 'sem_risco')
    } else if (statusRisco !== 'todos') {
      lista = lista.filter(e => e.auditoria?.status_risco === statusRisco)
    }
    if (statusCobranca !== 'todos') {
      lista = lista.filter(e => e.auditoria?.status_cobranca === statusCobranca)
    }
    return lista
  }, [evolucoesFiltradas, statusRisco, statusCobranca])

  // Mesmo texto, mesmo profissional, pacientes diferentes: a assinatura de
  // quem copia e cola a evolução de um atendimento para preencher outro.
  // Sobre o período INTEIRO (evolucoesFiltradas), não sobre a lista com o
  // card de risco/cobrança já aplicado — senão o próprio KPI "Duplicadas"
  // encolheria ao clicar em outro card, o mesmo bug que motivou essa troca.
  const gruposDuplicados = React.useMemo(() => {
    return detectarEvolucoesDuplicadasEntrePacientes(evolucoesFiltradas)
  }, [evolucoesFiltradas])
  const totalDuplicadas = gruposDuplicados.reduce((acc, g) => acc + g.itens.length, 0)

  // A busca vale nas DUAS abas: os resumos saem da lista já filtrada, senão
  // digitar um nome em "Por profissional" não mudava nada na tela.
  const resumosProfissionais = React.useMemo(() => {
    return calcularResumoProfissionais(evolucoesDaLista, gruposDuplicados)
  }, [evolucoesDaLista, gruposDuplicados])

  // KPIs — sobre a lista filtrada, para não contradizerem o que está na tela
  // quando a busca recorta um terapeuta.
  const totalEvolucoes = evolucoesFiltradas.length
  const totalAuditadas = evolucoesFiltradas.filter(e => e.auditoria !== null).length
  const totalPendentesIA = totalEvolucoes - totalAuditadas
  const totalSemRisco = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'sem_risco').length
  const totalRiscoEspecifico = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'risco_especifico').length
  const totalRiscoRelevante = evolucoesFiltradas.filter(e => e.auditoria?.status_risco === 'risco_relevante').length
  const duplicadasPorGradeId = React.useMemo(() => {
    const s = new Set<string>()
    for (const g of gruposDuplicados) for (const item of g.itens) s.add(item.grade_id)
    return s
  }, [gruposDuplicados])
  // "Ok e sem duplicidade" não precisa de cobrança — mesmo sem risco de
  // glosa, uma evolução duplicada ainda exige contato com o terapeuta.
  const totalPendentesCobranca = evolucoesFiltradas.filter(
    e =>
      e.auditoria &&
      e.auditoria.status_cobranca === 'pendente' &&
      (e.auditoria.status_risco !== 'sem_risco' || duplicadasPorGradeId.has(e.grade_id))
  ).length
  // Sem denominador não há percentual — "—", nunca 0% (§4 do padrão).
  const taxaConformidadeGeral = totalAuditadas > 0
    ? Math.round((totalSemRisco / totalAuditadas) * 100)
    : null

  /**
   * Chama a fila e devolve o resumo. Serve a enfileirar, repetir falhas,
   * cancelar e consultar — todos respondem com o mesmo `resumo`.
   */
  const chamarFila = async (
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>
  ): Promise<ResumoFila | null> => {
    try {
      const res = await fetch(URL_FILA, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      })
      const json = await res.json()
      if (!json.success) {
        setAvisoLote({
          texto:
            res.status === 401
              ? 'Sua sessão expirou. Recarregue a página e faça login novamente.'
              : json.error || 'Não foi possível falar com a fila de auditoria.',
          falha: true
        })
        return null
      }
      setFila(json.resumo)
      return json.resumo
    } catch {
      setAvisoLote({ texto: 'Falha de rede ao falar com a fila de auditoria.', falha: true })
      return null
    }
  }

  /**
   * Serve aos dois botões: "Auditar novas" (só o que nunca foi auditado) e
   * "Reauditar com os critérios atuais" (o que ficou numa versão antiga da
   * régua). Os dois viram a mesma coisa na fila: auditar e gravar o veredito.
   */
  const enfileirar = async (alvos: EvolucaoPendenteAuditoria[]) => {
    setAvisoLote(null)
    setEnfileirando(true)
    await chamarFila('POST', { gradeIds: alvos.map(a => a.grade_id) })
    setEnfileirando(false)
  }

  // Acompanha a fila: consulta ao abrir e a cada 5s enquanto houver trabalho.
  // Polling e não Realtime: o Realtime já é ~26% do orçamento de disco do banco,
  // e aqui a consulta é um agregado barato que só roda com a fila ativa.
  const emAndamento = Boolean(fila?.em_andamento)
  const estavaEmAndamento = React.useRef(false)
  useEffect(() => {
    void chamarFila('GET')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!emAndamento) {
      // Acabou enquanto a tela olhava: os vereditos mudaram.
      if (estavaEmAndamento.current) void carregarDados()
      estavaEmAndamento.current = false
      return
    }
    estavaEmAndamento.current = true
    const id = setInterval(() => void chamarFila('GET'), 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emAndamento])

  // Falhas do último lote ficam visíveis por 24h, mesmo que ninguém estivesse
  // olhando quando ele terminou — o worker roda sem a tela aberta.
  const falhasRecentes =
    fila && !fila.em_andamento && fila.falharam > 0 && fila.concluido_em &&
    Date.now() - new Date(fila.concluido_em).getTime() < 24 * 3600_000
      ? fila.falharam
      : 0

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
    await enfileirar(pendentes)
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

  const [confirmarReauditar, setConfirmarReauditar] = useState(false)

  const handleReauditarDesatualizadas = () => {
    if (desatualizadas.length === 0) return
    setConfirmarReauditar(true)
  }

  const confirmarEExecutarReauditar = async () => {
    setConfirmarReauditar(false)
    await enfileirar(desatualizadas)
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
  const cardAtivo = (alvo: { risco?: StatusRiscoEvolucao | 'com_risco'; cobranca?: StatusCobrancaEvolucao } | null) => {
    if (alvo === null) return statusRisco === 'todos' && statusCobranca === 'todos'
    if (alvo.cobranca) return statusCobranca === alvo.cobranca
    return statusRisco === alvo.risco
  }

  const alternarCard = (alvo: { risco?: StatusRiscoEvolucao | 'com_risco'; cobranca?: StatusCobrancaEvolucao } | null) => {
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

      {fila?.em_andamento && (
        <p
          role="status"
          className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <span>
            Auditando no servidor: <strong className="tabular-nums text-foreground">{fila.total - fila.pendentes} de {fila.total}</strong>.
            Pode fechar esta página — o processamento continua.
          </span>
          <button
            onClick={() => void chamarFila('DELETE')}
            className={`shrink-0 rounded px-1.5 py-0.5 font-bold underline-offset-2 hover:underline ${FOCO}`}
          >
            Cancelar o restante
          </button>
        </p>
      )}

      {falhasRecentes > 0 && (
        <p
          className={`mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${TONE_PANEL.amber.bg} ring-1 ${TONE_PANEL.amber.ring} ${TONE_CHIP.amber.text}`}
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            {falhasRecentes} {falhasRecentes === 1 ? 'evolução não pôde' : 'evoluções não puderam'} ser{' '}
            {falhasRecentes === 1 ? 'auditada' : 'auditadas'} depois de 3 tentativas. Se persistir, avise a tecnologia.
          </span>
          <button
            onClick={() => void chamarFila('POST', { repetirFalhasDosLotes: fila?.lotes ?? [] })}
            className={`shrink-0 rounded px-1.5 py-0.5 font-bold underline-offset-2 hover:underline ${FOCO}`}
          >
            Tentar de novo
          </button>
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
            rotulo="Com risco"
            valor={totalRiscoEspecifico + totalRiscoRelevante}
            tom={tomSeHouver(totalRiscoEspecifico + totalRiscoRelevante, totalRiscoRelevante > 0 ? 'red' : 'amber')}
            cor={toneColor(tomSeHouver(totalRiscoEspecifico + totalRiscoRelevante, totalRiscoRelevante > 0 ? 'red' : 'amber'))}
            nota={totalRiscoRelevante > 0
              ? `${totalRiscoRelevante} relevante · ${totalRiscoEspecifico} específico`
              : 'Ajustes pontuais de redação'}
            ativo={cardAtivo({ risco: 'com_risco' })}
            onClick={() => alternarCard({ risco: 'com_risco' })}
            desabilitado={totalRiscoEspecifico + totalRiscoRelevante === 0}
            rotuloFiltro="Ver as com risco"
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
          />
          <Kpi
            rotulo="Duplicadas"
            valor={totalDuplicadas}
            tom={tomSeHouver(totalDuplicadas, 'purple')}
            cor={toneColor(tomSeHouver(totalDuplicadas, 'purple'))}
            nota="Mesmo texto em 2+ pacientes"
            ativo={abaAtiva === 'duplicadas'}
            onClick={() => aplicar({ aba: 'duplicadas' })}
            desabilitado={totalDuplicadas === 0}
            rotuloFiltro="Ver as duplicadas"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      )}

      {/*
        Abas de verdade, em linha própria: uma borda inferior contínua sob os
        três rótulos, com o ativo ganhando sua própria borda na cor da marca —
        o padrão clássico de aba de painel. Precisa da própria linha porque a
        borda tem de atravessar a largura toda; dividindo com os filtros
        embaixo ela ficaria cortada no meio por eles.
      */}
      <div role="tablist" className="mt-4 flex w-full items-center gap-5 border-b border-border">
          <button
            role="tab"
            aria-selected={abaAtiva === 'profissionais'}
            onClick={voltarParaProfissionais}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 pt-1 text-xs transition ${FOCO} ${
              abaAtiva === 'profissionais'
                ? 'border-brand-fg font-bold text-foreground'
                : 'border-transparent font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-4 w-4" />
            Por profissional
          </button>

          <button
            role="tab"
            aria-selected={abaAtiva === 'feed'}
            onClick={() => aplicar({ aba: 'feed' })}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 pt-1 text-xs transition ${FOCO} ${
              abaAtiva === 'feed'
                ? 'border-brand-fg font-bold text-foreground'
                : 'border-transparent font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileSearch className="h-4 w-4" />
            Todas as evoluções
          </button>

          <button
            role="tab"
            aria-selected={abaAtiva === 'duplicadas'}
            onClick={() => aplicar({ aba: 'duplicadas' })}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 pt-1 text-xs transition ${FOCO} ${
              abaAtiva === 'duplicadas'
                ? 'border-brand-fg font-bold text-foreground'
                : 'border-transparent font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <Copy className="h-4 w-4" />
            Duplicadas
          </button>
      </div>

      {/*
        Filtros e ações, na linha abaixo das abas: período e busca à esquerda,
        Critérios/Atualizar/Auditar à direita. Ficaram fora da linha das abas
        de propósito — ações que disparam lote (Auditar) não devem competir
        visualmente com navegação passiva (as abas), risco real de mis-click
        com o botão primário logo ao lado de "Duplicadas".
      */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">

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
          só um fundo sutil. A borda aparece no foco, quando ela vira o
          objeto da atenção. `flex-1` para ocupar o espaço vago da linha
          em vez de deixá-lo ocioso entre o período e o resto.
        */}
        <div className="relative min-w-32 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            aria-label="Buscar paciente ou terapeuta"
            placeholder="Buscar paciente ou terapeuta"
            value={buscaLocal}
            onChange={e => setBuscaLocal(e.target.value)}
            className={`h-9 w-full rounded-lg border border-transparent bg-muted/50 pl-8 pr-2.5 text-xs
              text-foreground placeholder:text-muted-foreground/70 transition
              hover:bg-muted focus:border-border focus:bg-background
              focus:outline-none focus:ring-2 focus:ring-ring`}
          />
        </div>

        {/*
          Ações à direita, separadas das abas: Critérios/Atualizar/Auditar
          disparam efeito (rede, lote), então ficam junto dos filtros que
          também mudam o que a tela mostra — não coladas na navegação passiva
          das abas, onde um botão primário ao lado de "Duplicadas" convidava
          ao mis-click.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => setCriteriosAberto(true)}
            className={`${BOTAO_SECUNDARIO} w-9 justify-center px-0 xl:w-auto xl:px-2.5`}
            title={
              desatualizadas.length > 0
                ? `Ver os critérios que a IA aplica — ${desatualizadas.length} ${desatualizadas.length === 1 ? 'evolução auditada' : 'evoluções auditadas'} com versão anterior`
                : 'Ver os critérios que a IA aplica'
            }
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
             * Rótulo curto e `min-w` menor: o texto por extenso é o que
             * estouraria a largura disponível. A frase completa vive no
             * `title`, e o `min-w` segura a contagem mudando sem o botão
             * encolher a cada lote.
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

      {/*
        Um card de risco/cobrança pode ficar ativo sem que a pessoa tenha
        clicado nele nesta visita — "Ver evoluções" de um card de profissional
        chega direto num recorte filtrado. Sem isto, o único jeito de descobrir
        e desfazer o filtro era achar o card "Evoluções no período" no topo.
      */}
      {(statusRisco !== 'todos' || statusCobranca !== 'todos') && (
        <p className={`mt-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${TONE_PANEL.blue.bg} ring-1 ${TONE_PANEL.blue.ring} ${TONE_CHIP.blue.text}`}>
          <span>
            Filtro ativo: {statusRisco !== 'todos' ? ROTULO_STATUS_RISCO[statusRisco] : ROTULO_STATUS_COBRANCA[statusCobranca as StatusCobrancaEvolucao]}
          </span>
          <button
            onClick={() => aplicar({ statusRisco: 'todos', statusCobranca: 'todos' })}
            className={`shrink-0 rounded px-1.5 py-0.5 font-bold underline-offset-2 hover:underline ${FOCO}`}
          >
            Limpar
          </button>
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
            onVerMetricaProfissional={(prof, metrica) => {
              if (metrica === 'duplicadas') {
                aplicar({ busca: prof.profissional_nome, aba: 'duplicadas' })
                return
              }
              const statusRisco =
                metrica === 'sem_risco' ? 'sem_risco' : metrica === 'com_risco' ? 'com_risco' : 'todos'
              aplicar({ busca: prof.profissional_nome, aba: 'feed', statusRisco })
            }}
          />
        ) : abaAtiva === 'feed' ? (
          <EvolucoesFeedTab
            evolucoes={evolucoesDaLista}
            onSelecionarEvolucao={item => setItemSelecionado(item)}
          />
        ) : (
          <EvolucoesDuplicadasTab
            grupos={gruposDuplicados}
            onCompararItem={(grupo, item) => setComparacaoDuplicada({ grupo, item })}
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
        totalDesatualizadas={desatualizadas.length}
        onReauditarDesatualizadas={handleReauditarDesatualizadas}
        auditandoLote={auditandoLote || carregando}
      />

      <ModalConfirmacao
        isOpen={confirmarReauditar}
        titulo="Reauditar com os critérios atuais?"
        descricao={`${desatualizadas.length} ${desatualizadas.length === 1 ? 'evolução' : 'evoluções'} ${desatualizadas.length === 1 ? 'será reauditada' : 'serão reauditadas'}. O veredito anterior de cada uma será substituído.`}
        rotuloConfirmar="Reauditar"
        onConfirmar={confirmarEExecutarReauditar}
        onCancelar={() => setConfirmarReauditar(false)}
      />

      <ModalComparadorDuplicadas
        grupo={comparacaoDuplicada?.grupo ?? null}
        item={comparacaoDuplicada?.item ?? null}
        isOpen={Boolean(comparacaoDuplicada)}
        onClose={() => setComparacaoDuplicada(null)}
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
function ListaSkeleton({ aba }: { aba: 'profissionais' | 'feed' | 'duplicadas' }) {
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
