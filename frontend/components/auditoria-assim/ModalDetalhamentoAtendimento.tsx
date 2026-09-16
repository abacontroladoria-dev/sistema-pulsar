'use client'

import { useCallback, useEffect, useState } from 'react'
import { useModalDialog } from '@/hooks/useModalDialog'
import {
  AlertOctagon,
  Bot,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarSearch,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  Hash,
  KeySquare,
  Layers,
  Link2,
  Loader2,
  MessageSquare,
  Save,
  Send,
  ShieldCheck,
  User,
  UserX,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { salvarMotivoGlosa, salvarObservacaoManual } from '@/services/auditoria-assim.service'
import { rotuloOrigemGuia, rotuloSolicitadoPor } from '@/lib/guiaOrigem'
import type { AuditoriaAssimItem } from './types'
import SituacaoBadge, { SITUACAO_CONFIG, SITUACAO_FALLBACK } from './SituacaoBadge'
import { ehGlosa } from './situacoes'
import { rotuloForma } from './formaValidacao'

type Props = {
  item: AuditoriaAssimItem | null
  open: boolean
  onClose: () => void
  onSalvo: () => void
  /** Leva para a aba Reconciliação, na semana deste paciente. */
  onAnalisarSemana: (item: AuditoriaAssimItem) => void
}

function formatarData(data: string | null) {
  if (!data) return null
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

function formatarDataHora(data: string | null) {
  if (!data) return null
  const d = new Date(data)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * `autorizacoes_assim.data_execucao` — o instante em que a ASSIM registrou a
 * guia. É `timestamp without time zone` guardando hora de São Paulo, e chega do
 * PostgREST sem sufixo de fuso ("2026-08-10T11:23:00"). Passar por `new Date()`
 * entrega o horário à interpretação do navegador; formatar por fatia é o que
 * mantém 11:23 sendo 11:23. Mesma disciplina do resto do módulo.
 */
function formatarExecucaoAssim(valor: string | null) {
  if (!valor) return null
  const [data, hora] = valor.split('T')
  const [ano, mes, dia] = (data ?? '').split('-')
  if (!ano || !mes || !dia) return null
  return `${dia}/${mes}/${ano}${hora ? ` ${hora.slice(0, 5)}` : ''}`
}

/**
 * Estados que uma célula de fato pode carregar.
 *
 * Só a conferência de filipeta usa isto, e de propósito: é o par emerald/amber
 * que a TabelaAuditoria já pinta no botão de conferir, então a mesma dimensão
 * tem a mesma aparência na lista e no detalhe. Âmbar aqui significa o que
 * significa em toda a tela — esperando alguém. Rótulo e valor continuam em
 * texto; a cor confirma, não informa sozinha.
 */
const FACT_STATE = {
  neutro: { box: 'border-slate-200/80 bg-slate-50/70', dt: 'text-slate-600', dd: 'text-slate-800' },
  ok: { box: 'border-emerald-200 bg-emerald-50/70', dt: 'text-emerald-700', dd: 'text-emerald-800' },
  espera: { box: 'border-amber-200 bg-amber-50/70', dt: 'text-amber-700', dd: 'text-amber-800' },
} as const

/** Ficha compacta: uma célula de fato (rótulo + valor), não uma linha de lista. */
function Fact({
  icon: Icon,
  label,
  value,
  mono,
  full,
  state = 'neutro',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: React.ReactNode
  mono?: boolean
  full?: boolean
  state?: keyof typeof FACT_STATE
}) {
  const tom = FACT_STATE[state]
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tom.box} ${full ? 'col-span-2' : ''}`}>
      <dt className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${tom.dt}`}>
        <Icon size={11} className="shrink-0" />
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm font-medium leading-snug wrap-break-word ${mono ? 'font-mono tabular-nums text-[13px]' : ''} ${tom.dd}`}
      >
        {value ?? <span className="font-normal text-slate-500">—</span>}
      </dd>
    </div>
  )
}

/**
 * Rótulo estrutural das seções — a única aparição do steel da marca na ficha.
 *
 * Steel aqui e em mais nenhum lugar: é o que dá identidade à superfície sem
 * disputar com os matizes de situação, que são os que carregam significado. Se
 * ele descesse para os 16 rótulos de campo deixaria de ser sinal e viraria a
 * cor do texto do modal.
 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-fg">
      {children}
    </h3>
  )
}

export default function ModalDetalhamentoAtendimento({ item, open, onClose, onSalvo, onAnalisarSemana }: Props) {
  const [motivo, setMotivo] = useState('')
  const [salvandoMotivo, setSalvandoMotivo] = useState(false)

  const [observacao, setObservacao] = useState('')
  const [salvandoObservacao, setSalvandoObservacao] = useState(false)

  const soLeituraGlosa = Boolean(item?.motivo_glosa)

  useEffect(() => {
    if (open && item) {
      setMotivo(item.motivo_glosa ?? '')
      setObservacao(item.observacao_manual ?? '')
    }
  }, [open, item])

  // Mesmo hook do ModalTokenMensal: semântica de diálogo, Escape, foco preso e
  // devolvido ao gatilho, e trava de rolagem do fundo. Passou a importar mais
  // aqui depois que o "Fechar" do rodapé saiu — sem Escape, quem usa teclado
  // dependia de tabular até o X.
  const fechar = useCallback(() => onClose(), [onClose])
  const { refDialogo, propsDialogo } = useModalDialog(
    open && Boolean(item),
    fechar,
    'titulo-detalhamento-atendimento'
  )

  if (!open || !item) return null

  async function handleSalvarMotivo() {
    if (!item?.bloco_id || !motivo.trim()) return
    setSalvandoMotivo(true)
    try {
      await salvarMotivoGlosa(item.bloco_id, motivo.trim())
      onSalvo()
    } catch {
      toast.error('Erro ao salvar motivo da glosa. Tente novamente.')
    } finally {
      setSalvandoMotivo(false)
    }
  }

  async function handleSalvarObservacao() {
    if (!item?.bloco_id) return
    setSalvandoObservacao(true)
    try {
      await salvarObservacaoManual(item.bloco_id, observacao)
      toast.success('Observação salva.')
      onSalvo()
    } catch {
      toast.error('Erro ao salvar observação. Tente novamente.')
    } finally {
      setSalvandoObservacao(false)
    }
  }

  const atualizadoObservacao = formatarDataHora(item.observacao_manual_atualizado_em)
  // O cabeçalho inteiro veste o matiz da situação, no lugar da lombada de 4px
  // que existia antes: a faixa era cor sem contato com conteúdo nenhum, e a
  // severidade só se lia mesmo no badge. Tingindo a superfície, o estado chega
  // junto com o nome do paciente. Continua sendo tinta -50 sob texto slate — a
  // cor reforça o badge, nunca substitui o rótulo.
  const superficieSituacao =
    (item.situacao && SITUACAO_CONFIG[item.situacao]?.surface) || SITUACAO_FALLBACK.surface
  const temErro = Boolean(item.codigo_erro || item.descricao_erro)

  // O que a ASSIM respondeu ao recusar. Vem decomposto da RPC: do relatório
  // (autorizacoes_assim) ou, horas antes dele, do recibo que o robô leu no ato
  // do envio — nos dois casos no mesmo vocabulário, "1013" + "CADASTRO DO
  // BENEFICIARIO COM PROBLEMAS".
  const respostaAssim: { codigo: string | null; descricao: string } | null = item.descricao_erro
    ? { codigo: item.codigo_erro, descricao: item.descricao_erro }
    : item.codigo_erro
      ? { codigo: item.codigo_erro, descricao: 'Motivo não informado pela ASSIM.' }
      : null

  // A reclassificação manual ativa deste bloco, quando houver. Existe porque
  // `ehGlosa(item.situacao)` deixa de ser true assim que uma glosa vira FALTA
  // (a própria mudança que a reclassificação promove), e a seção "Motivo da
  // glosa" — a única que mostrava o motivo original — some junto. Sem esta
  // seção o que sobrava era o rodapé cru da Autorização ASSIM, sem estrutura
  // nenhuma sobre quem decidiu, quando e por quê.
  const reclassificacao = item.reclassificacao_por
    ? {
        situacaoAnterior: item.reclassificacao_situacao_anterior,
        justificativa: item.reclassificacao_justificativa,
        por: item.reclassificacao_por,
        em: item.reclassificacao_em,
      }
    : null

  // O adiantamento, quando houver. `data_atendimento_real` era predicado e nunca
  // valor: ela traz a sessão de volta como bloco (20260916120200) e a remove dos
  // cartões de falta, mas nada dizia de onde a sessão veio nem quem a moveu.
  const adiantamento = item.data_atendimento_real
    ? {
        real: item.data_atendimento_real,
        justificativa: item.adiantada_justificativa,
        por: item.adiantada_por_nome,
        em: item.adiantada_em,
      }
    : null

  // O que a recepção escreveu ao registrar a falta. Distinto de `observacao`,
  // que nas linhas de falta é a frase sintetizada de QUEM faltou: estes dizem o
  // que houve, e só existem porque alguém sentou e escreveu.
  const textoFalta = item.justificativa_falta?.trim() || null
  const categoriaFalta = item.motivo_falta?.trim() || null
  const temObservacaoFalta = textoFalta !== null || categoriaFalta !== null

  // Numa recusa, o rodapé desta coluna diria o MESMO que o bloco "Resposta da
  // ASSIM" da coluna ao lado — e diria pior: `status_assim` chega truncado da
  // origem ("1601-REINCIDENCIA NO ATEN"), então a linha saía
  // "1601-REINCIDENCIA NO ATEN — 1601: REINCIDENCIA NO ATENDIMENTO": o mesmo
  // fato duas vezes, uma delas pela metade. O motivo tem um lugar só no modal,
  // e é o lado onde se age sobre ele. Fora da glosa o rodapé segue intacto —
  // ali ele carrega 'Liberado', o token e a observação, que não repetem nada.
  // `ehGlosa`: em GLOSA_RESOLVIDA a coluna ao lado continua mostrando a resposta
  // da ASSIM, então o rodapé repetiria o motivo do mesmo jeito. O segundo termo
  // cobre o caso em que `situacao` NÃO é mais glosa por causa da própria
  // reclassificação: a seção "Reclassificação manual" (coluna da direita) já
  // mostra `respostaAssim` e a frase inteira que `observacao` carregaria aqui.
  const motivoJaMostradoAoLado = (ehGlosa(item.situacao) && respostaAssim !== null) || reclassificacao !== null

  // A cobertura vinda da aba Reconciliação. Não sai da RPC: ela reflete o
  // vínculo na `situacao` e o narra no fim de `observacao`, mas a coluna `guia`
  // continua sendo a recusada. Ver `AuditoriaAssimItem.vinculo`.
  const vinculo = item.vinculo
  // Numa sessão que nunca foi glosada, a observação da RPC é a frase do vínculo
  // e nada mais ("Autorização confirmada pela ASSIM (guia 118001, vínculo por
  // Fulano)"). Com a seção estruturada logo abaixo, deixá-la também no rodapé
  // diria o mesmo fato duas vezes — e a pior das duas seria a prosa.
  const rodapeSoFalaDoVinculo = vinculo !== null && !item.status_assim && !temErro

  // A recusa por cota estourada. O código é o sinal confiável; o texto entra
  // porque a ASSIM o corta em 25 caracteres ("1601-REINCIDENCIA NO ATEN") e nem
  // toda linha chega com o código separado.
  const ehReincidencia =
    item.codigo_erro === '1601' ||
    /reincidencia|reincidência/i.test(`${item.descricao_erro ?? ''} ${item.status_assim ?? ''}`)

  // De onde veio a guia. Nulo quando não há guia, ou quando a sessão é anterior ao
  // registro de procedência — nos dois casos a célula não aparece, em vez de afirmar
  // algo que ninguém apurou.
  const origemGuia = rotuloOrigemGuia(item.guia_origem, item.guia)
  // "Solicitado por" vira "Solicitação aberta por" quando a guia veio de fora. É o
  // conserto direto do engano de 25/08/2026: ali o nome na linha era de quem tentou
  // solicitar pelo Pulsar, não de quem tirou a guia no portal, e o rótulo antigo
  // convidava justamente à leitura errada.
  const rotuloOrigemCriadoPor = rotuloSolicitadoPor(item.guia_origem, item.guia)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — a superfície é o sinal de severidade */}
        <div className={`flex items-start justify-between border-b px-6 pt-4 pb-3 ${superficieSituacao}`}>
          <div className="min-w-0">
            <h2
              id="titulo-detalhamento-atendimento"
              className="truncate text-lg font-semibold text-slate-900"
            >
              {item.paciente_nome ?? 'Detalhamento do atendimento'}
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-600">{item.terapias ?? 'Sem terapia'}</p>
            <div className="mt-2">
              <SituacaoBadge situacao={item.situacao} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-lg p-1 text-slate-500 transition hover:bg-white/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content — duas colunas lado a lado: leitura à esquerda, ação à
            direita. Cada painel rola de forma independente só como rede de
            segurança para conteúdo excepcionalmente longo; no caso comum as
            duas colunas cabem inteiras em 90dvh e o corpo do modal não rola. */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row md:divide-x md:divide-slate-200">

          {/* Coluna esquerda — dados do atendimento, somente leitura */}
          <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4 md:w-1/2 md:shrink-0">

            {/* Sessão */}
            <section>
              <SectionTitle>Sessão</SectionTitle>
              <dl className="grid grid-cols-2 gap-1.5">
                <Fact icon={Calendar} label="Data" value={formatarData(item.data_atendimento)} />
                <Fact icon={Clock} label="Hora" value={item.hora_inicial ? item.hora_inicial.slice(0, 5) : null} />
                <Fact icon={Hash} label="Código TUSS" value={item.codigo_tuss} mono />
                <Fact icon={Layers} label="Qtd. sessões" value={item.quantidade_sessoes} mono />
                <Fact icon={Users} label="Profissional" value={item.profissionais} full />
              </dl>
            </section>

            {/* Autorização ASSIM — grade + rodapé de retorno, um único bloco */}
            <section>
              <SectionTitle>Autorização ASSIM</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <dl className="grid grid-cols-2 gap-1.5 p-1.5">
                  <Fact icon={FileText} label="Guia" value={item.guia} mono />
                  <Fact icon={CreditCard} label="Convênio" value={item.convenio_nome} />
                  {/* Procedência da guia, imediatamente depois dela e ANTES de quem
                      solicitou. A ordem é o argumento: quem lê de cima para baixo
                      encontra "Direto na ASSIM" antes de encontrar um nome, e não
                      depois — foi ler o nome primeiro que produziu o engano de
                      25/08/2026. Some quando não há procedência conhecida, em vez de
                      ocupar a grade com um travessão que não diz nada. */}
                  {origemGuia && (
                    <Fact
                      icon={origemGuia.foraDoPulsar ? ExternalLink : Bot}
                      label="Origem da guia"
                      value={
                        <span className={origemGuia.chip} title={origemGuia.detalhe}>
                          {origemGuia.foraDoPulsar && (
                            <ExternalLink size={11} className="shrink-0" />
                          )}
                          {origemGuia.texto}
                        </span>
                      }
                    />
                  )}
                  <Fact icon={User} label={rotuloOrigemCriadoPor} value={item.criado_por} />
                  <Fact icon={Send} label="Forma" value={rotuloForma(item.forma_autorizacao)} />
                  <Fact icon={Clock} label="Autorizado em" value={formatarDataHora(item.horario_autorizacao)} />
                  <Fact icon={CalendarCheck} label="Executado em" value={formatarDataHora(item.data_execucao)} />
                  {item.teve_token && <Fact icon={KeySquare} label="Token" value={item.token} mono />}
                  {item.teve_token && (
                    <Fact
                      icon={ShieldCheck}
                      label="Filipeta conferida"
                      value={
                        item.token_conferido
                          ? `Sim${item.token_conferido_por_nome ? ` · ${item.token_conferido_por_nome}` : ''}`
                          : 'Ainda não'
                      }
                      state={item.token_conferido ? 'ok' : 'espera'}
                    />
                  )}
                </dl>

                {!motivoJaMostradoAoLado && !rodapeSoFalaDoVinculo && (item.status_assim || temErro || item.observacao) && (
                  <div
                    className={`flex items-start gap-2 border-t px-3 py-2 text-xs ${
                      temErro
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    {temErro ? (
                      <AlertOctagon size={13} className="mt-0.5 shrink-0" />
                    ) : (
                      <ShieldCheck size={13} className="mt-0.5 shrink-0 text-slate-500" />
                    )}
                    <span>
                      {item.status_assim && <span className="font-semibold">{item.status_assim} — </span>}
                      {item.codigo_erro && <span className="font-semibold">{item.codigo_erro}: </span>}
                      {item.descricao_erro || item.observacao}
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* Cobertura por vínculo — a resposta para "quem resolveu isto?"

                Seção própria, e não uma linha dentro do bloco acima, porque é
                OUTRA autorização: a de cima é a que a ASSIM casou com a sessão
                (a recusada, quando houve glosa), esta é a que o setor conseguiu
                por fora e que a Reconciliação apontou. Misturá-las na mesma
                grade faria parecer que a guia mudou de número — e ela não muda:
                vincular não reescreve o pareamento posicional.

                Esmeralda porque é o matiz de "coberto" em toda a tela, o mesmo
                de GLOSA_RESOLVIDA e LIBERADA. A seção de glosa segue violeta
                logo ao lado, e as duas convivem de propósito: o vínculo não
                apaga a recusa, e é da recusa que sai o número da contestação. */}
            {vinculo && (
              <section>
                <SectionTitle>Cobertura por vínculo</SectionTitle>
                <div className="overflow-hidden rounded-xl border border-emerald-200">
                  <dl className="grid grid-cols-2 gap-1.5 p-1.5">
                    <Fact icon={Link2} label="Guia que cobriu" value={vinculo.guia} mono state="ok" />
                    <Fact
                      icon={CalendarCheck}
                      label="Autorizada em"
                      value={formatarExecucaoAssim(vinculo.data_execucao)}
                      state="ok"
                    />
                  </dl>

                  {/* Autoria como frase, no mesmo idioma do "Atualizado por X em
                      Y" das Observações. Vira rodapé em vez de duas células
                      porque é uma coisa só — quem decidiu, e quando. */}
                  <div className="border-t border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs leading-relaxed text-emerald-800">
                    <p className="wrap-break-word">
                      {vinculo.guia_original && vinculo.guia_original !== vinculo.guia && (
                        <>
                          No lugar da guia{' '}
                          <span className="font-mono font-semibold tabular-nums">{vinculo.guia_original}</span>
                          {' · '}
                        </>
                      )}
                      Vinculado por{' '}
                      <span className="font-semibold">{vinculo.vinculado_por ?? 'Usuário'}</span>
                      {vinculo.vinculado_em ? ` em ${formatarDataHora(vinculo.vinculado_em)}` : ''}
                    </p>
                    {vinculo.observacao && (
                      <p className="mt-1 wrap-break-word text-emerald-900">“{vinculo.observacao}”</p>
                    )}
                  </div>
                </div>
              </section>
            )}

          </div>

          {/* Coluna direita — o que fazer a respeito do atendimento */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">

            {/* Reclassificação manual — independente de `ehGlosa(situacao)` de
                propósito: reclassificar É a ação que tira o bloco do grupo
                glosa (GLOSA -> FALTA, por exemplo), e a seção abaixo (que
                escreve o motivo original) só aparece PARA glosa ativa. Sem
                esta seção própria, reclassificar uma glosa apagava da tela o
                único lugar que mostrava o motivo — sobrava a resposta da ASSIM
                crua no rodapé, sem nenhum sinal de que alguém decidiu outra
                coisa sobre o que aconteceu.

                Âmbar porque é o matiz de "decisão humana registrada" que o
                resto do módulo já usa para "aguardando conferência"; aqui o
                significado é próximo — uma pessoa afirmou algo que o sistema
                sozinho não deduziria. Fica ACIMA do motivo original: quem lê
                de cima para baixo vê primeiro o desfecho vigente (o "para
                onde"), depois a explicação de origem (o "o que a ASSIM
                disse"), na mesma ordem que a `observacao` da RPC já narra. */}
            {/* ── Sessão adiantada. Sky, e não emerald: emerald está travado em
                LIBERADA pelo Status Lock Rule do DESIGN.md, e adiantar não
                libera nada — quem libera é o vínculo com a guia, que é o passo
                seguinte. Sky já significa "em trânsito", que é o que a sessão
                passa a estar. Mesma escolha, pela mesma razão, que
                ModalReclassificarSituacao fez para o destino "Adiantada". */}
            {adiantamento && (
              <section className="shrink-0 rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-sky-900">
                  <CalendarClock size={14} />
                  Sessão adiantada
                </h3>

                <p className="mb-2 text-sm text-sky-900">
                  Agendada para{' '}
                  <span className="font-semibold tabular-nums">
                    {formatarData(item.data_atendimento)}
                  </span>
                  , atendida em{' '}
                  <span className="font-semibold tabular-nums">
                    {formatarData(adiantamento.real)}
                  </span>
                  .
                </p>

                {adiantamento.justificativa && (
                  <div className="mb-2 rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                      Justificativa
                    </p>
                    <p className="mt-0.5 text-sm leading-snug wrap-break-word text-sky-900">
                      {adiantamento.justificativa}
                    </p>
                  </div>
                )}

                {adiantamento.por && (
                  <p className="text-xs leading-relaxed text-sky-800">
                    Registrado por <span className="font-semibold">{adiantamento.por}</span>
                    {adiantamento.em ? ` em ${formatarDataHora(adiantamento.em)}` : ''}
                  </p>
                )}
              </section>
            )}

            {/* ── O que a recepção escreveu ao dar a falta. Stone é a régua das
                faltas em SituacaoBadge ("não aconteceu"), então a seção que
                explica uma falta se veste com ela. Sem ícone de alerta: não há
                nada a decidir aqui, só um fato a ler. */}
            {temObservacaoFalta && (
              <section className="shrink-0 rounded-xl border border-stone-200 bg-stone-50/60 p-3.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-stone-800">
                  <UserX size={14} />
                  Observação da falta
                </h3>

                {categoriaFalta && (
                  <p className="mb-2 text-sm font-medium text-stone-700">{categoriaFalta}</p>
                )}

                {textoFalta && (
                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                    <p className="text-sm leading-snug wrap-break-word text-stone-800">
                      {textoFalta}
                    </p>
                  </div>
                )}
              </section>
            )}

            {reclassificacao && (
              <section className="shrink-0 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                  <AlertOctagon size={14} />
                  Reclassificação manual
                </h3>

                <div className="mb-2 flex items-center gap-2 text-sm">
                  <SituacaoBadge situacao={reclassificacao.situacaoAnterior} />
                  <span className="text-amber-700">→</span>
                  <SituacaoBadge situacao={item.situacao} />
                </div>

                {reclassificacao.justificativa && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Justificativa
                    </p>
                    <p className="mt-0.5 text-sm leading-snug wrap-break-word text-amber-900">
                      {reclassificacao.justificativa}
                    </p>
                  </div>
                )}

                {/* O motivo original da glosa, preservado aqui — é a única
                    seção que continua exibindo `respostaAssim` quando a
                    situação atual já não é mais glosa. */}
                {respostaAssim && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {respostaAssim.codigo ? 'Resposta da ASSIM (motivo original)' : 'Retorno da solicitação (original)'}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug font-medium wrap-break-word text-amber-900">
                      {respostaAssim.codigo && (
                        <span className="font-mono tabular-nums text-amber-700">
                          {respostaAssim.codigo} ·{' '}
                        </span>
                      )}
                      {respostaAssim.descricao}
                    </p>
                  </div>
                )}

                <p className="text-xs leading-relaxed text-amber-800">
                  Reclassificado por <span className="font-semibold">{reclassificacao.por}</span>
                  {reclassificacao.em ? ` em ${formatarDataHora(reclassificacao.em)}` : ''}
                </p>
              </section>
            )}

            {/* Motivo da glosa — em GLOSA e também em GLOSA_RESOLVIDA: o vínculo
                não apaga a recusa, e é aqui que o motivo é lido e anotado.
                Esconder a seção depois de resolvida jogaria fora justamente o
                histórico que o vínculo se comprometeu a preservar. */}
            {ehGlosa(item.situacao) && (
              <section className="shrink-0 rounded-xl border border-violet-200 bg-violet-50/40 p-3.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-violet-900">
                  <AlertOctagon size={14} />
                  Motivo da glosa
                </h3>

                {/* O que o convênio respondeu — o fato que a contestação
                    precisa citar, e que antes só existia depois do relatório.
                    Fica acima do campo de tratativa de propósito: primeiro o
                    que a ASSIM disse, depois o que a clínica vai fazer.

                    Violeta e não rose: violeta é o matiz de GLOSA e a seção
                    inteira já é dele. Um bloco rose aqui estaria dizendo "erro"
                    dentro de um painel que já diz "glosa" — duas cores para o
                    mesmo fato. O destaque vem da superfície branca sobre o
                    violeta-50 da seção.

                    O rótulo depende do código: com ele, o texto é o vocabulário
                    do convênio e pode ser creditado à ASSIM sem ressalva. Sem
                    ele, o que sobrou pode ser a perícia do próprio robô
                    (`error_message`), e atribuí-la ao convênio seria mentira. */}
                {respostaAssim && (
                  <div className="mb-3 rounded-lg border border-violet-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                      {respostaAssim.codigo ? 'Resposta da ASSIM' : 'Retorno da solicitação'}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug font-medium wrap-break-word text-violet-900">
                      {respostaAssim.codigo && (
                        <span className="font-mono tabular-nums text-violet-700">
                          {respostaAssim.codigo} ·{' '}
                        </span>
                      )}
                      {respostaAssim.descricao}
                    </p>
                  </div>
                )}

                {/* A ponte para a única tela que consegue conferir a recusa — a
                    aba Reconciliação, posicionada na semana deste paciente. Vai
                    embora desta tela, então o modal fecha antes (quem fecha é a
                    TabelaAuditoria, ao repassar o callback).

                    Fica em Brand Outline, não em steel cheio: "Salvar motivo" já
                    é a ação primária desta seção, e conferir a cota é o passo
                    ANTES de escrever a tratativa — subordinado a ela, não par.

                    Aparece em toda glosa, não só na 1601: a cota da semana é o
                    contexto que qualquer contestação usa. Quando o código É o da
                    reincidência, o rótulo diz por quê. */}
                <button
                  type="button"
                  onClick={() => onAnalisarSemana(item)}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-white px-4 py-2 text-sm font-semibold text-brand-fg transition hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <CalendarSearch size={15} />
                  {ehReincidencia ? 'Conferir a cota da semana' : 'Analisar cota da semana'}
                </button>

                {soLeituraGlosa ? (
                  <p className="text-sm whitespace-pre-wrap text-violet-900">{item.motivo_glosa}</p>
                ) : (
                  <>
                    <textarea
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value.slice(0, 1000))}
                      placeholder="Ex.: Beneficiário inativo — carteirinha vencida em 15/08."
                      rows={2}
                      className="w-full resize-none rounded-xl border border-violet-200 bg-white p-3 text-sm text-slate-700 transition placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                    <div className="mt-1 mb-1.5 flex justify-between">
                      <span className="text-xs text-violet-700">Campo obrigatório.</span>
                      <span className="text-xs tabular-nums text-slate-500">{motivo.length} / 1000</span>
                    </div>
                    {/* Steel, não violeta: violeta é o matiz de GLOSA e ação
                        primária usa a marca. Fosse violeta, o mesmo tom estaria
                        dizendo "este bloco é glosa" e "clique aqui" na mesma
                        seção — e os dois botões de salvar do modal não seriam o
                        mesmo botão. */}
                    <button
                      onClick={handleSalvarMotivo}
                      disabled={salvandoMotivo || !motivo.trim()}
                      className="flex items-center gap-2 rounded-xl bg-brand-fg px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {salvandoMotivo ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      {salvandoMotivo ? 'Salvando...' : 'Salvar motivo'}
                    </button>
                  </>
                )}
              </section>
            )}

            {/* Observações — livre, qualquer status, sempre editável. Cresce
                para preencher o restante da coluna, então o textarea usa o
                espaço vertical que sobra em vez de ficar minúsculo. */}
            <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 p-3.5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <MessageSquare size={14} className="text-brand" />
                Observações
              </h3>
              <textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value.slice(0, 1000))}
                placeholder="Registre um lembrete ou combinado sobre este atendimento."
                className="w-full min-h-20 flex-1 resize-none rounded-xl border border-slate-200 p-3 text-sm text-slate-700 transition placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <div className="mt-1 mb-1.5 flex justify-between gap-4">
                <span className="truncate text-xs text-slate-500">
                  {item.observacao_manual_atualizado_por_nome && atualizadoObservacao
                    ? `Atualizado por ${item.observacao_manual_atualizado_por_nome} em ${atualizadoObservacao}`
                    : ''}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">{observacao.length} / 1000</span>
              </div>
              <button
                onClick={handleSalvarObservacao}
                disabled={salvandoObservacao || observacao.trim() === (item.observacao_manual ?? '')}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-fg px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {salvandoObservacao ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {salvandoObservacao ? 'Salvando...' : 'Salvar observação'}
              </button>
            </section>

          </div>

        </div>

      </div>
    </div>
  )
}
