'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, CalendarClock, Loader2, ShieldAlert, Undo2, X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import SituacaoBadge, { resolverConfig } from './SituacaoBadge'
import {
  DESTINO_ADIANTADA,
  SITUACOES_RECLASSIFICAVEIS,
  type CartaoGrade,
  type DestinoSituacao,
  type ReclassificacaoSituacao,
  type SituacaoReclassificavel,
} from './types'

/** O mínimo que a RPC aceita. Repetido aqui só para o contador não mentir. */
const MINIMO_JUSTIFICATIVA = 10

/** O teto de `marcar_sessao_adiantada`: adiantamento é de dias, não de meses. */
const MAXIMO_DIAS_ADIANTAMENTO = 14

/** `YYYY-MM-DD` somado em dias, sem fuso: a data da agenda é dia civil puro. */
function deslocar(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const base = new Date(Date.UTC(a, m - 1, d))
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

function formatarBR(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/**
 * O que cada destino significa em português de operação, não em vocabulário de
 * banco.
 *
 * O rótulo do `SituacaoBadge` diz o ESTADO ("Falta"); esta linha diz o que a
 * pessoa está afirmando ao escolhê-lo. A diferença importa porque a escolha é
 * irreversível na contabilidade do mês: FALTA some do card de Glosas e some do
 * total, NAO_SOLICITADA continua sendo trabalho a fazer. Quem lê só "Falta" e
 * "Não Solicitada" não tem como saber qual das duas some da conta.
 */
const EXPLICACAO: Record<DestinoSituacao, string> = {
  ADIANTADA:
    'A sessão aconteceu, em outro dia. Deixa de contar como falta em todo o sistema.',
  FALTA: 'O paciente não compareceu. A sessão sai da contagem de pendências.',
  FALTA_TERAPEUTA: 'O terapeuta não compareceu. A sessão sai da contagem de pendências.',
  CANCELADA: 'O atendimento foi desfeito. A sessão sai da contagem de pendências.',
  NAO_SOLICITADA:
    'A sessão aconteceu e segue sem autorização — continua como pendência a resolver.',
}

/**
 * Reclassificar a situação de uma sessão — a glosa que na verdade foi falta.
 *
 * ── Por que este modal existe, e por que ele é pesado de propósito ──────────
 *
 * Esta é a única ação do sistema em que uma pessoa sobrepõe o que a ASSIM
 * respondeu. Ela não maquia a tela: a situação nova entra na RPC da Conferência
 * e atravessa os KPIs, o resumo mensal e os alertas — uma glosa reclassificada
 * como falta deixa de ser pendência de faturamento. Por isso a justificativa é
 * obrigatória (e curta demais é recusada pelo banco, não só por aqui), e por
 * isso o "de → para" aparece nos mesmos dois painéis do vínculo: a comparação é
 * o que evita reclassificar a linha errada, e ela é visual.
 *
 * O que este modal NÃO oferece, e a ausência é o desenho: `LIBERADA`. Afirmar
 * que o convênio autorizou exige uma guia, e o caminho para isso é o vínculo
 * desta mesma aba. O banco recusa o valor; a tela nem o mostra, para não ensinar
 * um gesto que sempre falha.
 *
 * Quando já existe uma reclassificação ativa, o modal troca de assunto e passa a
 * oferecer o desfazer — não há reclassificar por cima. É a mesma disciplina do
 * vínculo: uma decisão ativa por sessão, e trocar de ideia é desfazer e refazer,
 * com as duas coisas no log.
 */
export default function ModalReclassificarSituacao({
  open,
  onClose,
  cartao,
  reclassificacao,
  salvando,
  onReclassificar,
  onAdiantar,
  onDesfazer,
}: {
  open: boolean
  onClose: () => void
  /** A sessão em questão. Só cartão de sessão chega aqui — guia não tem situação. */
  cartao: CartaoGrade | null
  /** A reclassificação ativa desta sessão, quando já houver. Liga o modo desfazer. */
  reclassificacao: ReclassificacaoSituacao | null
  salvando: boolean
  onReclassificar: (situacao: SituacaoReclassificavel, justificativa: string) => Promise<void>
  /**
   * Registra a data real do atendimento. Separado de `onReclassificar` porque o
   * destino não é uma reclassificação: escreve em `fila_autorizacoes`, pede um
   * segundo dado (a data) e vale além da Conferência. Ver `DESTINO_ADIANTADA`.
   */
  onAdiantar: (dataReal: string, justificativa: string) => Promise<void>
  onDesfazer: (motivo: string) => Promise<void>
}) {
  const idTitulo = 'titulo-reclassificar-situacao'
  const { refDialogo, propsDialogo } = useModalDialog(open, onClose, idTitulo)
  const [destino, setDestino] = useState<DestinoSituacao | null>(null)
  const [dataReal, setDataReal] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  /**
   * Reabrir para outra sessão não herda escolha, texto nem erro da anterior.
   *
   * Ajustado durante o render e não num efeito — mesmo padrão de
   * `ModalSemanaPaciente`: é o que o React recomenda para "resetar estado quando
   * uma prop muda", e um efeito com setState síncrono aqui causaria renderização
   * em cascata (o lint deste repositório recusa a versão com `useEffect`).
   *
   * O `recorte` inclui `open` porque fechar e reabrir sobre a MESMA sessão
   * também tem de limpar: quem cancelou no meio de um texto não quer encontrá-lo
   * de volta na próxima abertura, muito menos um erro de uma tentativa anterior.
   */
  const recorte = `${open}|${cartao?.chave ?? ''}`
  const [recorteAnterior, setRecorteAnterior] = useState(recorte)
  if (recorteAnterior !== recorte) {
    setRecorteAnterior(recorte)
    setDestino(null)
    setDataReal('')
    setJustificativa('')
    setErro(null)
  }

  if (!open || !cartao || cartao.tipo !== 'sessao') return null

  const desfazendo = reclassificacao !== null
  const suficiente = justificativa.trim().length >= MINIMO_JUSTIFICATIVA

  const agendada = cartao.origem.data_atendimento
  const adiantando = destino === DESTINO_ADIANTADA
  // A data real é o segundo dado que só o adiantamento pede, e precisa diferir da
  // agendada — a RPC recusa iguais, e um botão que sempre falha ensina a
  // desconfiar dos que funcionam.
  const dataRealValida = dataReal !== '' && dataReal !== agendada

  // No desfazer o motivo é opcional — a RPC o aceita nulo. Reclassificar é que
  // exige justificativa: é a ação que muda a contabilidade, e desfazer só a
  // devolve ao que o banco já derivava sozinho.
  const podeConfirmar = desfazendo
    ? true
    : destino !== null && suficiente && (!adiantando || dataRealValida)

  async function confirmar() {
    setErro(null)
    try {
      if (desfazendo) await onDesfazer(justificativa.trim())
      else if (adiantando) await onAdiantar(dataReal, justificativa.trim())
      else if (destino) await onReclassificar(destino, justificativa.trim())
    } catch (e) {
      // A mensagem vem das validações da RPC, já escrita para ser lida por uma
      // pessoa ("Sessão X está coberta por uma guia vinculada. Desfaça o vínculo
      // antes de reclassificar."). Aqui dentro e não num toast, porque é aqui que
      // a decisão está sendo tomada.
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir')
    }
  }

  const atual = cartao.situacao
  const configAtual = atual ? resolverConfig(atual) : null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        onClick={(e) => e.stopPropagation()}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2
              id={idTitulo}
              className="flex items-center gap-2 text-base font-semibold text-slate-900"
            >
              {desfazendo ? (
                <>
                  <Undo2 size={17} className="text-slate-500" aria-hidden />
                  Desfazer a reclassificação
                </>
              ) : (
                <>
                  <ShieldAlert size={17} className="text-amber-600" aria-hidden />
                  Reclassificar a situação
                </>
              )}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {desfazendo
                ? 'A sessão volta a valer o que a ASSIM respondeu, e o registro continua no histórico.'
                : 'A resposta da ASSIM continua registrada. O que muda é como esta sessão é contada.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* A sessão, dita por inteiro. Reclassificar a linha errada é o erro
              caro desta tela, e o que o evita é reconhecer o atendimento —
              data, hora, terapia — antes de escolher qualquer coisa. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Sessão
            </p>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-900">
              {cartao.origem.data_atendimento ?? 'sem data'}
              <span className="tabular-nums"> · {cartao.hora}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-slate-600">
              {cartao.terapia ?? 'terapia não informada'}
              {cartao.codigo_tuss && (
                <span className="tabular-nums"> · TUSS {cartao.codigo_tuss}</span>
              )}
              {cartao.guia && <span className="tabular-nums"> · guia {cartao.guia}</span>}
            </p>
          </div>

          {desfazendo ? (
            /* ── Modo desfazer: o que foi decidido, e por quem ─────────────── */
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <SituacaoBadge situacao={reclassificacao.situacao_anterior} />
                <ArrowRight size={15} className="text-slate-400" aria-hidden />
                <SituacaoBadge situacao={reclassificacao.situacao_nova} />
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-slate-700">
                {reclassificacao.justificativa}
              </p>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {reclassificacao.reclassificado_por}
                {reclassificacao.reclassificado_em && (
                  <> · {new Date(reclassificacao.reclassificado_em).toLocaleString('pt-BR')}</>
                )}
              </p>
            </div>
          ) : (
            /* ── Modo reclassificar: de onde, para onde ────────────────────── */
            <>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Hoje está como
                  </p>
                  <div className="mt-1.5">
                    <SituacaoBadge situacao={atual} />
                  </div>
                  {cartao.origem.observacao && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      {cartao.origem.observacao}
                    </p>
                  )}
                </div>
              </div>

              <fieldset className="mt-4">
                <legend className="text-[12px] font-medium text-slate-600">
                  Passa a ser
                </legend>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {SITUACOES_RECLASSIFICAVEIS.map((s) => {
                    // A situação que a sessão já tem não pode ser destino — a RPC
                    // recusa, e oferecer um botão que sempre falha ensina a
                    // desconfiar dos que funcionam.
                    if (s === atual) return null
                    const escolhida = destino === s
                    const config = resolverConfig(s)
                    const Icone = config.icon
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDestino(s)}
                        aria-pressed={escolhida}
                        className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                          escolhida
                            ? 'border-brand bg-brand-surface'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${config.strong}`}
                        >
                          <Icone size={14} aria-hidden />
                          {config.label}
                        </span>
                        <span className="text-[11px] leading-relaxed text-slate-500">
                          {EXPLICACAO[s]}
                        </span>
                      </button>
                    )
                  })}

                  {/* O quinto destino. Fora do `.map` porque não é um
                      `SituacaoReclassificavel`: não tem `SituacaoBadge` (a
                      sessão não passa a ter uma situação nova — ela passa a ter
                      uma DATA nova), e é o único que abre um segundo campo. */}
                  <button
                    type="button"
                    onClick={() => setDestino(DESTINO_ADIANTADA)}
                    aria-pressed={adiantando}
                    className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                      adiantando
                        ? 'border-brand bg-brand-surface'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
                      <CalendarClock size={14} aria-hidden />
                      Adiantada
                    </span>
                    <span className="text-[11px] leading-relaxed text-slate-500">
                      {EXPLICACAO[DESTINO_ADIANTADA]}
                    </span>
                  </button>
                </div>

                {adiantando && (
                  <label className="mt-3 block">
                    <span className="text-[12px] font-medium text-slate-600">
                      Atendida de fato em
                    </span>
                    <input
                      type="date"
                      value={dataReal}
                      onChange={(e) => setDataReal(e.target.value)}
                      min={agendada ? deslocar(agendada, -MAXIMO_DIAS_ADIANTAMENTO) : undefined}
                      max={agendada ? deslocar(agendada, MAXIMO_DIAS_ADIANTAMENTO) : undefined}
                      className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] tabular-nums text-slate-800 focus:border-slate-400 focus:outline-none sm:w-52"
                    />
                    {dataReal !== '' && dataReal === agendada && (
                      <span className="mt-1 block text-[11px] text-amber-700">
                        · precisa ser diferente da data agendada
                      </span>
                    )}
                  </label>
                )}
              </fieldset>
            </>
          )}

          <label className="mt-4 block">
            <span className="text-[12px] font-medium text-slate-600">
              {desfazendo ? 'Motivo (opcional)' : 'Justificativa'}
            </span>
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value.slice(0, 500))}
              rows={3}
              placeholder={
                desfazendo
                  ? 'Por que a reclassificação está sendo desfeita'
                  : 'O que de fato aconteceu — ex.: paciente não compareceu, confirmado com a recepção'
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">
              {justificativa.length}/500
              {!desfazendo && !suficiente && (
                <span className="ml-1 text-amber-700">
                  · mínimo {MINIMO_JUSTIFICATIVA} caracteres
                </span>
              )}
            </span>
          </label>

          {/* Dito antes de confirmar, e não depois: é a consequência que a
              pessoa precisa ter em mente ao decidir, e ela não é óbvia — a
              palavra "reclassificar" não sugere que um número do mês muda. */}
          {!desfazendo && destino && (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
              {adiantando ? (
                <>
                  Esta sessão deixa de contar como falta em todo o sistema —
                  assiduidade, reposição e remuneração — e volta à Conferência
                  {dataRealValida && (
                    <span className="tabular-nums"> de {formatarBR(dataReal)}</span>
                  )}
                  , onde a autorização pode ser vinculada a ela.
                </>
              ) : destino === 'NAO_SOLICITADA' ? (
                <>
                  Esta sessão continua contando como pendência — muda o motivo, não o
                  fato de haver trabalho a fazer.
                </>
              ) : (
                <>
                  Esta sessão deixa de contar como pendência: sai dos indicadores do
                  período e o alerta correspondente é encerrado no próximo ciclo.
                  {configAtual?.label === 'Glosa' && ' A glosa continua registrada e visível.'}
                </>
              )}
            </p>
          )}

          {erro && (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
            >
              {erro}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando || !podeConfirmar}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60 ${
              desfazendo
                ? 'bg-slate-700 hover:bg-slate-800'
                : adiantando
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {salvando && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {desfazendo
              ? 'Desfazer reclassificação'
              : adiantando
                ? 'Registrar adiantamento'
                : 'Reclassificar'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
