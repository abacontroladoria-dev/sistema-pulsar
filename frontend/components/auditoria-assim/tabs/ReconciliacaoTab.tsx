'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useImpersonation } from '@/contexts/ImpersonationContext'
import { useAnaliseReincidencia } from '@/hooks/useAnaliseReincidencia'
import { useGlosaCodigos } from '@/hooks/useGlosaCodigos'
import { JANELA_PADRAO, useReconciliacaoAssim } from '@/hooks/useReconciliacaoAssim'
import ModalConfirmarVinculo from '../ModalConfirmarVinculo'
import ModalReclassificarSituacao from '../ModalReclassificarSituacao'
import ListaPendencias from '../reconciliacao/ListaPendencias'
import PainelAvulsas from '../reconciliacao/PainelAvulsas'
import ModalSemanaPaciente from '../reconciliacao/ModalSemanaPaciente'
import { hojeLocal } from '../reconciliacao/datas'
import {
  desfazerReclassificacao,
  marcarSessaoAdiantada,
  reclassificarSituacao,
} from '@/services/reconciliacao-assim.service'
import type {
  AlvoAnalise, CandidataVinculo, CartaoGrade, GuiaOrfa, SituacaoReclassificavel,
} from '../types'

/** Os papéis que a RPC aceita para escrever. `diretoria` vê, mas não vincula. */
const PAPEIS_QUE_VINCULAM = new Set(['admin', 'autorizacao', 'recepcao'])

/**
 * Quem pode sobrepor a situação de uma sessão — mais estreito que quem vincula,
 * e a diferença é deliberada (espelha as RPCs `reclassificar_situacao` e
 * `desfazer_reclassificacao`).
 *
 * Vincular guia é apontar uma evidência que existe na ASSIM e que qualquer um
 * pode conferir. Reclassificar é sobrepor um julgamento à evidência, e muda o
 * que o faturamento considera pendente. Quem responde por isso é o setor de
 * Autorização — `recepcao` fica de fora.
 */
const PAPEIS_QUE_RECLASSIFICAM = new Set(['admin', 'autorizacao'])

/**
 * Os diálogos desta aba, sempre um só de cada vez.
 *
 * `grade` é a semana do paciente e `confirmar` é o aceite. Não empilham porque
 * cada um instala um focus trap próprio, e dois traps ativos ao mesmo tempo
 * brigam pelo Tab e fazem o Escape fechar os dois. A grade volta ao fim do
 * fluxo, já refletindo o vínculo.
 *
 * Havia um terceiro, `escolher` ("esta guia cobre qual sessão?"), removido em
 * 2026-08-24 junto com o `ModalEscolherSessao`. A escolha agora acontece DENTRO
 * da grade, sobre os cartões da própria semana — ver `ModoVinculo`. Ela não é
 * uma etapa porque não substitui a grade: ela a veste.
 */
type Etapa = 'grade' | 'confirmar'

type Props = {
  /** Alvo vindo da Conferência (linha em glosa). Nulo na navegação normal. */
  alvo: AlvoAnalise | null
  onAlvoConsumido: () => void
}

/**
 * Autorizações com pendências — a fila da semana, e a semana do paciente dentro dela.
 *
 * O problema que a aba resolve: quando a ASSIM glosa uma solicitação do Pulsar e
 * o setor consegue a liberação depois, direto no portal, o match posicional da
 * Conferência deixa a glosa casada com a sessão e a liberação órfã. A sessão fica
 * GLOSA para sempre e o faturamento vê pendência que não existe.
 *
 * O desenho segue a ordem em que a pergunta é feita de verdade. Primeiro "quem
 * precisa de mim nesta semana?" — a listagem, um paciente por linha, com as
 * cinco espécies de pendência lado a lado. Depois "o que aconteceu com esta
 * pessoa?" — a grade semanal no modal, terapias nas linhas e dias nas colunas,
 * onde a guia sem vínculo aparece no dia em que foi autorizada. E a ação mora na
 * evidência: clicar na guia âmbar é o que abre a escolha da sessão.
 *
 * Foi medido em produção (2026-08-20) que 39% das órfãs NÃO cobrem sessão
 * nenhuma — são autorizações extras. Por isso "sem sessão correspondente" é ação
 * de primeira classe, e não caso de borda: sem ela essas guias voltariam à fila
 * todo dia.
 */
export default function ReconciliacaoTab({ alvo, onAlvoConsumido }: Props) {
  const { effectiveRole } = useImpersonation()
  const podeVincular = PAPEIS_QUE_VINCULAM.has(effectiveRole ?? '')
  const podeReclassificar = PAPEIS_QUE_RECLASSIFICAM.has(effectiveRole ?? '')
  const codigosGlosa = useGlosaCodigos()

  const analise = useAnaliseReincidencia(alvo?.data ?? hojeLocal(), alvo?.pacienteNome ?? null)
  const { reabrirEm, escolherPaciente, recarregar: recarregarSemana } = analise

  const fila = useReconciliacaoAssim(recarregarSemana)
  const { selecionarGuia } = fila

  const [etapa, setEtapa] = useState<Etapa>('grade')
  const [candidataEscolhida, setCandidataEscolhida] = useState<CandidataVinculo | null>(null)

  /**
   * A guia em vínculo, guardada em ESTADO e não derivada de `orfasDaSemana`.
   *
   * A diferença importa por causa da janela de 7 dias: uma candidata pode cair
   * no mês anterior, e chegar até ela troca o mês da análise — o que recarrega
   * `orfasDaSemana` para o novo mês. Uma guia de agosto derivada desse mapa
   * viraria `null` no instante em que o operador navegasse para julho, e o modo
   * de vínculo se desmontaria no meio da escolha, sem dizer por quê.
   */
  const [guiaEmVinculo, setGuiaEmVinculo] = useState<GuiaOrfa | null>(null)

  /**
   * A sessão cuja situação está sendo reclassificada. Nula = o modal está fechado.
   *
   * Não entra em `Etapa`: as etapas são estágios de UM fluxo (escolher a sessão
   * de uma guia, depois confirmar), e a reclassificação não é estágio de nada —
   * ela abre e fecha sobre a grade, que continua atrás. Fazê-la uma etapa
   * obrigaria a grade a fechar para ela abrir, que é exatamente o defeito que
   * aposentou o `ModalEscolherSessao`.
   */
  const [cartaoEmReclassificacao, setCartaoEmReclassificacao] = useState<CartaoGrade | null>(null)
  const [salvandoReclassificacao, setSalvandoReclassificacao] = useState(false)


  // Haver paciente escolhido JÁ é "a semana está aberta" — não há um segundo
  // estado dizendo a mesma coisa, que é como as duas versões divergem. Durante a
  // escolha da sessão o paciente continua escolhido e só a `etapa` muda: é para
  // a grade dele que o fluxo volta.
  const semanaAberta = !!analise.pacienteNome

  // A ponte vinda da Conferência. Consome o alvo depois de aplicá-lo, senão
  // voltar para esta aba mais tarde ressuscitaria a semana antiga — o erro mais
  // fácil de não notar nesta tela. A `etapa` não precisa ser reposta aqui: o
  // Shell desmonta esta aba ao trocar de aba, então chegar da Conferência é
  // sempre um `grade` recém-nascido.
  useEffect(() => {
    if (!alvo) return
    reabrirEm(alvo.data, alvo.pacienteNome, alvo.carteirinha)
    onAlvoConsumido()
  }, [alvo, reabrirEm, onAlvoConsumido])

  const fecharSemana = useCallback(() => escolherPaciente(null), [escolherPaciente])

  /** Sai do modo de vínculo e larga a guia — usado pelo Cancelar e pelo Escape. */
  const cancelarVinculo = useCallback(() => {
    setGuiaEmVinculo(null)
    void selecionarGuia(null)
  }, [selecionarGuia])

  /**
   * Clique em "sem vínculo": busca as candidatas e liga o modo na própria grade.
   *
   * A guia sai de `orfasDaSemana` — a MESMA lista que classificou o cartão âmbar
   * que foi clicado, então as duas nunca podem discordar sobre o que precisa de
   * vínculo — e é copiada para o estado no ato, pela razão anotada em
   * `guiaEmVinculo`.
   */
  const orfas = analise.orfasDaSemana
  const vincularGuia = useCallback(
    (guia: string) => {
      const orfa = orfas.get(guia)
      if (!orfa) return
      setGuiaEmVinculo(orfa)
      void selecionarGuia(guia)
    },
    [orfas, selecionarGuia]
  )

  /**
   * A reclassificação ativa da sessão aberta no modal — o que decide se ele
   * pergunta "para o quê?" ou oferece o desfazer.
   *
   * Lida do mapa a cada render, e não copiada para o estado junto com o cartão:
   * depois de confirmar, `recarregarSemana()` traz o mapa novo e o modal precisa
   * refletir a decisão que acabou de ser tomada. Uma cópia congelada mostraria o
   * estado anterior até alguém fechar e reabrir.
   */
  const reclassificacaoAberta = cartaoEmReclassificacao
    ? (analise.reclassificacoesPorBloco.get(cartaoEmReclassificacao.chave) ?? null)
    : null

  const fecharReclassificacao = useCallback(() => setCartaoEmReclassificacao(null), [])

  /**
   * Confirma a reclassificação e recarrega — as CINCO cargas, pelo mesmo motivo
   * que o vínculo recarrega as quatro.
   *
   * Aqui a recarga não é opcional nem cosmética: a `situacao` reclassificada vem
   * da RPC da Conferência, então sem ela o cartão continuaria mostrando GLOSA
   * depois de o banco já ter aceitado a mudança — e o contador do cabeçalho
   * continuaria contando aquela glosa. Os dois lados envelhecem juntos.
   *
   * O erro NÃO é engolido: sobe para o modal, que o mostra ao lado do botão. As
   * mensagens da RPC são escritas para serem lidas ("Sessão X está coberta por
   * uma guia vinculada"), e um `catch` aqui as trocaria por um fechamento
   * silencioso que parece sucesso.
   */
  const confirmarReclassificacao = useCallback(
    async (situacao: SituacaoReclassificavel, justificativa: string) => {
      if (!cartaoEmReclassificacao) return
      setSalvandoReclassificacao(true)
      try {
        await reclassificarSituacao({
          blocoId: cartaoEmReclassificacao.chave,
          situacaoNova: situacao,
          justificativa,
        })
        recarregarSemana()
        setCartaoEmReclassificacao(null)
      } finally {
        setSalvandoReclassificacao(false)
      }
    },
    [cartaoEmReclassificacao, recarregarSemana]
  )

  const confirmarDesfazer = useCallback(
    async (motivo: string) => {
      if (!reclassificacaoAberta) return
      setSalvandoReclassificacao(true)
      try {
        await desfazerReclassificacao(reclassificacaoAberta.id, motivo)
        recarregarSemana()
        setCartaoEmReclassificacao(null)
      } finally {
        setSalvandoReclassificacao(false)
      }
    },
    [reclassificacaoAberta, recarregarSemana]
  )

  /**
   * Registra que a sessão aconteceu em outro dia.
   *
   * `recarregarSemana()` não é cosmético aqui, é o desfecho: a sessão sai da lista
   * de faltas e volta como bloco real da Conferência, e é esse bloco que a guia
   * órfã passa a poder cobrir. Sem a recarga a pessoa ficaria olhando o cartão de
   * falta que o banco acabou de aposentar.
   *
   * O erro sobe para o modal, como na reclassificação: as mensagens da RPC são
   * escritas para serem lidas, e um `catch` aqui as trocaria por um fechamento
   * silencioso que parece sucesso.
   */
  const confirmarAdiantamento = useCallback(
    async (dataReal: string, justificativa: string) => {
      // `fila_id` só vem preenchido nos cartões de FALTA, que são sintéticos.
      // Numa sessão real ele é nulo e o destino não se aplica — a RPC escreve na
      // linha da fila, e sem ela não há o que marcar.
      const filaId =
        cartaoEmReclassificacao?.tipo === 'sessao'
          ? cartaoEmReclassificacao.origem.fila_id
          : null
      if (!filaId) {
        throw new Error(
          'Esta sessão não tem uma linha de solicitação para marcar como adiantada.'
        )
      }
      setSalvandoReclassificacao(true)
      try {
        await marcarSessaoAdiantada({ filaId, dataReal, justificativa })
        recarregarSemana()
        setCartaoEmReclassificacao(null)
      } finally {
        setSalvandoReclassificacao(false)
      }
    },
    [cartaoEmReclassificacao, recarregarSemana]
  )

  const modoVinculo = useMemo(
    () =>
      guiaEmVinculo && podeVincular
        ? {
            guia: guiaEmVinculo,
            candidatas: fila.candidatas,
            carregando: fila.carregandoCandidatas,
            erro: fila.erroCandidatas,
            janelaDias: JANELA_PADRAO,
            onEscolher: (candidata: CandidataVinculo) => {
              setCandidataEscolhida(candidata)
              setEtapa('confirmar')
            },
            onSemSessao: () => {
              setCandidataEscolhida(null)
              setEtapa('confirmar')
            },
            onCancelar: cancelarVinculo,
          }
        : null,
    [
      guiaEmVinculo, podeVincular, fila.candidatas, fila.carregandoCandidatas,
      fila.erroCandidatas, cancelarVinculo,
    ]
  )

  return (
    <div className="flex flex-col gap-4">
      {!podeVincular && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          Seu perfil permite consultar a reconciliação, mas não vincular autorizações
          {!podeReclassificar && ' nem reclassificar situações'}.
        </p>
      )}
      {/* O caso do meio: `recepcao` vincula mas não reclassifica. Sem esta linha
          o botão da gaveta aparece desabilitado sem que nada na tela tenha dito
          por quê — e o `title` dele só é lido por quem tem mouse. */}
      {podeVincular && !podeReclassificar && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          Seu perfil permite vincular autorizações, mas não reclassificar a situação de
          uma sessão — isso é do setor de Autorização.
        </p>
      )}

      {/* Acima da listagem porque responde uma pergunta que a listagem provoca
          ("por que este paciente tem uma autorização a mais?"), e some sozinho
          quando não há avulsa no mês. */}
      <PainelAvulsas de={analise.mesRef} ate={analise.mesFimEfetivo} />

      <ListaPendencias
        pacientes={analise.pacientesDoMes}
        unidades={analise.unidadesDoMes}
        mesRef={analise.mesRef}
        mesFimEfetivo={analise.mesFimEfetivo}
        mesAtual={analise.mesAtual}
        podeAvancarMes={analise.podeAvancarMes}
        carregando={analise.loading}
        erro={analise.erro}
        onMes={analise.irParaMes}
        onIrParaMesData={analise.irParaMesData}
        onRecarregar={recarregarSemana}
        onAbrir={(paciente) => {
          // A última autorização do paciente no mês, quando existe, posiciona
          // o modal na semana onde a pendência de fato está.
          // `pacienteIds` vai junto porque o NOME não identifica: a linha pode
          // ter sido rotulada pelo nome truncado da ASSIM, e filtrar as sessões
          // por ele abriria a grade sem sessão nenhuma — toda guia viraria
          // "além do agendado" por não ter com o que parear.
          escolherPaciente(
            paciente.nome,
            paciente.carteirinhas,
            paciente.ultimaAutorizacao,
            paciente.pacienteIds
          )
          setEtapa('grade')
        }}
      />

      <ModalSemanaPaciente
        open={semanaAberta && etapa === 'grade'}
        onClose={fecharSemana}
        analise={analise}
        podeVincular={podeVincular}
        podeReclassificar={podeReclassificar}
        codigosGlosa={codigosGlosa}
        onVincularGuia={vincularGuia}
        onReclassificar={setCartaoEmReclassificacao}
        vinculo={modoVinculo}
      />

      {/* Por cima da grade, que continua atrás — a semana é o contexto que
          torna a decisão possível ("esta é mesmo a sessão em que ele faltou?").
          Não é uma `etapa` pelo motivo anotado em `cartaoEmReclassificacao`. */}
      <ModalReclassificarSituacao
        open={cartaoEmReclassificacao !== null}
        onClose={fecharReclassificacao}
        cartao={cartaoEmReclassificacao}
        reclassificacao={reclassificacaoAberta}
        salvando={salvandoReclassificacao}
        onReclassificar={confirmarReclassificacao}
        onAdiantar={confirmarAdiantamento}
        onDesfazer={confirmarDesfazer}
      />

      {/* O aceite continua sendo modal, e só ele. A escolha virou modo da grade
          porque o que ela pede é COMPARAR com a semana; a confirmação pede o
          oposto — uma decisão isolada, com um campo de observação, e nada mais
          na tela para distrair. */}
      <ModalConfirmarVinculo
        open={etapa === 'confirmar'}
        onClose={() => setEtapa('grade')}
        guia={guiaEmVinculo}
        candidata={candidataEscolhida}
        salvando={fila.salvando}
        onConfirmar={async (observacao) => {
          if (!guiaEmVinculo) return
          if (candidataEscolhida) await fila.confirmarVinculo(candidataEscolhida, observacao)
          else await fila.descartarGuia(guiaEmVinculo.guia, observacao)
          // Os dois lados envelhecem juntos, e a recarga é o que traz as
          // QUATRO cargas de volta em bloco — inclusive a das triagens, que é o
          // que faz a grade desenhar o depois: a guia aparece "Vinculada"
          // apontando a sessão, a sessão aparece "Coberta pela guia N", e o par
          // inteiro (mais a glosa que ele aposentou) sai das contagens do
          // cabeçalho e da listagem. Sem essa quarta carga a guia voltaria
          // rotulada "Outra semana", desmentindo a decisão recém-tomada.
          recarregarSemana()
          setCandidataEscolhida(null)
          setGuiaEmVinculo(null)
          setEtapa('grade')
        }}
      />
    </div>
  )
}
