'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  desvincularAutorizacao,
  listarCandidatasVinculo,
  marcarGuiaSemSessao,
  vincularAutorizacao,
  vincularAutorizacaoFalta,
  vincularAutorizacaoSubstituicao,
} from '@/services/reconciliacao-assim.service'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { CandidataVinculo } from '@/components/auditoria-assim/types'

/** Janela retroativa de busca de candidatas. O 7 saiu da medição — ver o service. */
export const JANELA_PADRAO = 7

/**
 * Quanto se espera, depois do último evento de realtime, antes de recarregar.
 *
 * O sync_assim_results insere em lote e cada linha vira um evento; a rajada
 * inteira chega em bem menos de 2,5 s, então este valor a colapsa numa recarga
 * só. Alto o bastante para não ser um por linha, baixo o bastante para quem está
 * olhando não perceber atraso.
 */
const ESPERA_RECARGA_MS = 2_500

/** Teto: mesmo sob gotejar contínuo, recarrega ao menos uma vez a cada 20 s. */
const TETO_RECARGA_MS = 20_000

/**
 * O ato de vincular uma guia a uma sessão — e só ele.
 *
 * Este hook já teve uma segunda responsabilidade: manter a fila de 30 dias de
 * guias órfãs que ocupava a coluna esquerda da tela. Ela saiu quando a tela
 * passou a ser dirigida pela SEMANA (2026-08-21): a listagem de pacientes com
 * pendências recorta as órfãs da própria semana exibida, vindas do mesmo
 * `get_guias_orfas` que a fila usava. Manter as duas cargas faria a mesma RPC
 * rodar duas vezes por navegação, com dois recortes diferentes, e o número da
 * fila discordaria do número da linha em silêncio.
 *
 * O que ficou é o que só existia aqui: as candidatas de uma guia, a escrita do
 * vínculo, o descarte da guia extra, e a assinatura de realtime que faz a tela
 * envelhecer junto com o robô.
 *
 * @param aoMudarExternamente chamado quando o realtime acusa mudança em
 * `autorizacoes_assim` / `autorizacoes_vinculos`. Sem ele o robô importa um lote
 * e a semana continua mostrando o estado anterior, calada.
 */
export function useReconciliacaoAssim(aoMudarExternamente?: () => void) {
  const [guiaSelecionada, setGuiaSelecionada] = useState<string | null>(null)
  const [candidatas, setCandidatas] = useState<CandidataVinculo[]>([])
  const [carregandoCandidatas, setCarregandoCandidatas] = useState(false)
  const [erroCandidatas, setErroCandidatas] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Guarda de corrida: o painel de candidatas leva alguns segundos (a RPC vai
  // dia a dia), então dois cliques rápidos em guias diferentes podem voltar fora
  // de ordem e pintar as candidatas da guia errada sob o cabeçalho certo.
  const requisicaoCandidatas = useRef(0)

  // Guardado num ref porque a identidade do callback muda a cada semana
  // navegada, e o canal do realtime não pode reassinar por causa disso.
  const aoMudarRef = useRef(aoMudarExternamente)
  useEffect(() => { aoMudarRef.current = aoMudarExternamente })

  // Estado do debounce de realtime. Em refs, e não em estado, porque nada disto
  // se pinta: mudar aqui não pode causar render nem reassinar o canal.
  const timerRecarga = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tetoRecarga = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Houve evento com a aba escondida — recarrega quando ela voltar. */
  const pendente = useRef(false)

  // O robô do relatório importa a cada ~5 min. Sem isto a tela de trabalho fica
  // velha justamente enquanto alguém trabalha nela.
  //
  // MAS o evento é por LINHA, e a recarga é cara. `recarregar()` dispara três
  // cargas (useAnaliseReincidencia:938-942), e `carregarMes` pede um par de
  // requisições por dia útil do mês: são ~47 chamadas, uma delas o
  // `get_guias_orfas` do mês inteiro. Ligado cru, um `insert` de 30 linhas do
  // sync_assim_results virava 30 recargas — 1.410 requisições em rajada contra um
  // pool de 10 conexões. É isso que travava a aba, e é o mesmo erro que a
  // central-pacientes já tinha corrigido com debounce.
  //
  // O contador de geração de useAnaliseReincidencia protege o DADO (resposta
  // atrasada não pinta a tela), não a REDE: as 1.410 requisições saíam do mesmo
  // jeito e só eram descartadas na volta.
  useEffect(() => {
    const supabase = getSupabaseClient()

    const recarregarAgora = () => {
      timerRecarga.current = null
      tetoRecarga.current = null
      pendente.current = false
      aoMudarRef.current?.()
    }

    const aoMudar = () => {
      // Aba escondida não recarrega: ninguém está lendo, e voltar o foco refaz a
      // carga de qualquer forma. Mesma guarda da Sidebar (Sidebar.tsx:293).
      if (document.visibilityState !== 'visible') { pendente.current = true; return }

      if (timerRecarga.current) clearTimeout(timerRecarga.current)
      timerRecarga.current = setTimeout(recarregarAgora, ESPERA_RECARGA_MS)

      // Teto: com o debounce sozinho, um gotejar de eventos mais rápido que a
      // espera adiaria a recarga para sempre e a tela envelheceria calada.
      if (!tetoRecarga.current) {
        tetoRecarga.current = setTimeout(() => {
          if (timerRecarga.current) clearTimeout(timerRecarga.current)
          recarregarAgora()
        }, TETO_RECARGA_MS)
      }
    }

    const aoVoltarAba = () => {
      if (document.visibilityState === 'visible' && pendente.current) aoMudar()
    }

    const canal = supabase
      .channel('reconciliacao-assim')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autorizacoes_assim' }, aoMudar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autorizacoes_vinculos' }, aoMudar)
      .subscribe()

    document.addEventListener('visibilitychange', aoVoltarAba)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltarAba)
      if (timerRecarga.current) clearTimeout(timerRecarga.current)
      if (tetoRecarga.current) clearTimeout(tetoRecarga.current)
      void supabase.removeChannel(canal)
    }
  }, [])

  const selecionarGuia = useCallback(async (guia: string | null) => {
    setGuiaSelecionada(guia)
    setCandidatas([])
    setErroCandidatas(null)
    if (!guia) return

    const meuTicket = ++requisicaoCandidatas.current
    setCarregandoCandidatas(true)
    try {
      const lista = await listarCandidatasVinculo(guia, JANELA_PADRAO)
      if (meuTicket !== requisicaoCandidatas.current) return
      setCandidatas(lista)
    } catch (e) {
      if (meuTicket !== requisicaoCandidatas.current) return
      setErroCandidatas(e instanceof Error ? e.message : 'Falha ao carregar as candidatas')
    } finally {
      if (meuTicket === requisicaoCandidatas.current) setCarregandoCandidatas(false)
    }
  }, [])

  /**
   * `houveSubstituto` só é lido quando a candidata é uma FALTA, e é a resposta
   * que a tela coleta no último passo do modal. É ela que escolhe entre os dois
   * desfechos possíveis de um slot de falta — e a escolha decide assiduidade,
   * então ela não tem padrão: `undefined` numa falta é erro de programação, não
   * um "não". Ver `TIPOS_QUE_COBREM` em `reconciliacao/cobertura.ts`.
   */
  const confirmarVinculo = useCallback(async (
    candidata: CandidataVinculo,
    observacao: string,
    houveSubstituto?: boolean
  ) => {
    if (!guiaSelecionada) return
    setSalvando(true)
    try {
      if (candidata.situacao === 'FALTA_TERAPEUTA') {
        // Roteia pela SITUAÇÃO, e não pelo prefixo `falta_` do bloco: a situação
        // é o dado do domínio, o prefixo é detalhe de serialização. A falta tem
        // RPC própria — ela não passa por `fn_blocos_assim` nem pelo parser do
        // bloco real, e sua identidade é o `fila_id`.
        if (!candidata.fila_id) {
          // A constraint da tabela e a RPC exigem `fila_id`; uma falta sem ele
          // não é vinculável. Falhar aqui, com o nome do caso, é melhor que
          // mandar `null` e receber um erro do banco que não diz o que houve.
          throw new Error('Esta falta não tem solicitação na fila — não é vinculável.')
        }
        if (houveSubstituto === undefined) {
          // Sem resposta não há desfecho certo: gravar 'falta_terapeuta' por
          // padrão afirmaria "ninguém cobriu", que é metade das vezes o oposto
          // do que aconteceu — e é uma afirmação sobre a assiduidade do
          // paciente, feita por omissão da tela.
          throw new Error('Responda se houve substituto antes de registrar esta autorização.')
        }
        const vincular = houveSubstituto
          ? vincularAutorizacaoSubstituicao
          : vincularAutorizacaoFalta
        await vincular({
          guia: guiaSelecionada,
          filaId: candidata.fila_id,
          observacao,
          janelaDias: JANELA_PADRAO,
        })
      } else {
        await vincularAutorizacao({
          guia: guiaSelecionada,
          blocoId: candidata.bloco_id,
          filaId: candidata.fila_id,
          observacao,
          janelaDias: JANELA_PADRAO,
        })
      }
      setGuiaSelecionada(null)
      setCandidatas([])
    } finally {
      setSalvando(false)
    }
  }, [guiaSelecionada])

  const descartarGuia = useCallback(async (guia: string, observacao: string) => {
    setSalvando(true)
    try {
      await marcarGuiaSemSessao(guia, observacao)
      if (guia === guiaSelecionada) {
        setGuiaSelecionada(null)
        setCandidatas([])
      }
    } finally {
      setSalvando(false)
    }
  }, [guiaSelecionada])

  return {
    guiaSelecionada, selecionarGuia,
    candidatas, carregandoCandidatas, erroCandidatas,
    salvando, confirmarVinculo, descartarGuia, desvincularAutorizacao,
  }
}
