'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Ban, Link2, Loader2, X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import SituacaoBadge from './SituacaoBadge'
import type { CandidataVinculo, GuiaOrfa } from './types'

type Props = {
  open: boolean
  onClose: () => void
  guia: GuiaOrfa | null
  /** Nula = o modal está confirmando o descarte ("sem sessão correspondente"). */
  candidata: CandidataVinculo | null
  salvando: boolean
  onConfirmar: (observacao: string) => Promise<void>
}

function dataHora(valor: string | null) {
  if (!valor) return '—'
  const [data, hora] = valor.split('T')
  const [a, m, d] = data.split('-')
  return `${d}/${m}/${a} ${(hora ?? '').slice(0, 5)}`
}

function dia(valor: string | null) {
  if (!valor) return '—'
  const [a, m, d] = valor.split('-')
  return `${d}/${m}/${a}`
}

function distancia(horas: number | null) {
  if (horas == null) return null
  const abs = Math.abs(horas)
  const texto = abs < 24
    ? `${abs.toFixed(1)} h`
    : `${Math.floor(abs / 24)} d ${Math.round(abs % 24)} h`
  return horas < 0 ? `${texto} ANTES da sessão` : `${texto} depois da sessão`
}

/** Um lado do "de → para". Dois painéis idênticos em forma, diferentes em conteúdo. */
function Painel({
  titulo,
  tom,
  children,
}: {
  titulo: string
  tom: 'origem' | 'destino'
  children: React.ReactNode
}) {
  // Degraus -200/-50/-700 de propósito: são os que o shim de tema escuro de
  // globals.css remapeia. -400/-800 atravessariam inteiros para o escuro.
  const cor = tom === 'origem'
    ? 'border-emerald-200 bg-emerald-50/60'
    : 'border-slate-200 bg-slate-50'
  return (
    <div className={`flex-1 rounded-xl border p-4 ${cor}`}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </p>
      <dl className="space-y-1.5 text-[13px]">{children}</dl>
    </div>
  )
}

function Campo({ rotulo, valor, forte }: { rotulo: string; valor: React.ReactNode; forte?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{rotulo}</dt>
      <dd className={`min-w-0 flex-1 ${forte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {valor ?? '—'}
      </dd>
    </div>
  )
}

/**
 * Confirmação do vínculo (ou do descarte), no formato largo com linhas
 * horizontais — o mesmo da Conferência de Filipetas.
 *
 * O modal existe porque o vínculo muda o que o faturamento considera coberto e
 * não há desfazer implícito: precisa de um passo onde a pessoa LÊ as duas
 * pontas juntas. Daí os dois painéis lado a lado em vez de um resumo em texto —
 * a comparação beneficiário/TUSS/data é justamente o que evita vincular na
 * sessão errada, e ela é visual.
 */
export default function ModalConfirmarVinculo({
  open,
  onClose,
  guia,
  candidata,
  salvando,
  onConfirmar,
}: Props) {
  const idTitulo = 'titulo-confirmar-vinculo'
  const { refDialogo, propsDialogo } = useModalDialog(open, onClose, idTitulo)
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Reabrir para outra guia não deve herdar o texto (nem o erro) da anterior.
  useEffect(() => {
    if (open) { setObservacao(''); setErro(null) }
  }, [open, guia?.guia, candidata?.bloco_id])

  if (!open || !guia) return null

  const ehDescarte = candidata === null
  /**
   * O destino é uma FALTA DE TERAPEUTA, e não uma sessão.
   *
   * Muda o vocabulário inteiro deste modal, porque "cobertura" é a palavra
   * errada ali: não houve atendimento a cobrir. O que se registra é de onde veio
   * a autorização — a falta continua falta.
   */
  const ehFalta = !ehDescarte && candidata.situacao === 'FALTA_TERAPEUTA'

  async function confirmar() {
    setErro(null)
    try {
      await onConfirmar(observacao.trim())
    } catch (e) {
      // O erro vem das validações da RPC, com mensagem escrita para ser lida por
      // uma pessoa ("TUSS divergente: guia X é ..., bloco é ..."). Mostrar aqui
      // dentro, e não num toast, porque é aqui que a decisão está sendo tomada.
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        onClick={(e) => e.stopPropagation()}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitulo} className="flex items-center gap-2 text-base font-semibold text-slate-900">
              {ehDescarte
                ? <><Ban size={17} className="text-slate-500" aria-hidden /> Marcar como sem sessão correspondente</>
                : ehFalta
                  ? <><Link2 size={17} className="text-amber-600" aria-hidden /> Registrar a autorização desta falta</>
                  : <><Link2 size={17} className="text-emerald-600" aria-hidden /> Confirmar cobertura da sessão</>}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {ehDescarte
                ? 'A guia sai da fila de trabalho sem afirmar que cobre alguma sessão.'
                : ehFalta
                  ? 'A falta continua registrada como falta. O que passa a existir é a relação entre as duas.'
                  : 'A glosa continua registrada. O que passa a existir é a relação entre as duas.'}
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
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Painel titulo="Autorização externa" tom="origem">
              <Campo rotulo="Guia" valor={guia.guia} forte />
              <Campo rotulo="Autorizada em" valor={dataHora(guia.data_execucao)} />
              <Campo rotulo="TUSS" valor={guia.codigo_tuss} />
              <Campo rotulo="Carteirinha" valor={guia.carteirinha} />
              <Campo rotulo="Paciente" valor={guia.paciente_nome} />
            </Painel>

            {!ehDescarte && (
              <>
                <ArrowRight size={20} className="mx-auto shrink-0 rotate-90 text-slate-400 sm:rotate-0" aria-hidden />
                <Painel titulo={ehFalta ? 'Falta autorizada' : 'Sessão coberta'} tom="destino">
                  <Campo rotulo="Data" valor={dia(candidata.data_atendimento)} forte />
                  <Campo rotulo="Horário" valor={(candidata.hora_inicial ?? '').slice(0, 5) || '—'} forte />
                  <Campo rotulo="TUSS" valor={candidata.codigo_tuss} />
                  <Campo rotulo="Terapia" valor={candidata.terapias} />
                  <Campo rotulo="Profissional" valor={candidata.profissionais} />
                  <Campo rotulo="Situação" valor={<SituacaoBadge situacao={candidata.situacao} />} />
                  {/* Uma falta não tem guia anterior a substituir: ela nunca foi
                      autorizada, é isso que a torna falta. Imprimir o campo ali
                      só pediria uma explicação que não existe. */}
                  {!ehFalta && (
                    <Campo
                      rotulo="Guia original"
                      valor={
                        candidata.guia_atual
                          ? <span className="tabular-nums">{candidata.guia_atual}</span>
                          : <span className="text-slate-400">sem solicitação no Pulsar</span>
                      }
                    />
                  )}
                  {candidata.motivo_glosa_descricao && (
                    <Campo
                      rotulo="Motivo"
                      valor={
                        <span>
                          {candidata.motivo_glosa_codigo && (
                            <span className="mr-1 font-semibold tabular-nums">{candidata.motivo_glosa_codigo}</span>
                          )}
                          {candidata.motivo_glosa_descricao}
                        </span>
                      }
                    />
                  )}
                </Painel>
              </>
            )}
          </div>

          {!ehDescarte && candidata.distancia_horas != null && (
            <p className="mt-3 text-[12px] text-slate-500">
              A autorização saiu <strong className="font-semibold text-slate-700">{distancia(candidata.distancia_horas)}</strong>
              {candidata.distancia_horas < 0 && (
                <> — confira se é mesmo esta a sessão, o normal é a autorização vir depois.</>
              )}
            </p>
          )}

          {!ehDescarte && !ehFalta && candidata.fila_id == null && (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              Esta sessão não tem solicitação no Pulsar, então o vínculo fica sem rastro de
              solicitação original. A cobertura funciona igual.
            </p>
          )}

          {/* O que este registro FAZ e o que ele não faz.
              Dito por extenso e no último clique porque "vincular" é a palavra
              que a tela usa para cobrir uma sessão, e aqui ela significa outra
              coisa — deixar isso implícito seria deixar o operador concluir que
              a falta foi resolvida. */}
          {ehFalta && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
              <p>
                <strong className="font-semibold">A falta continua sendo falta.</strong> Nenhuma
                sessão é criada, e assiduidade, cota e glosa não mudam. O que este registro faz é
                tirar a guia da fila de autorizações sem vínculo e mostrar, no slot da falta, de
                onde veio a autorização.
              </p>
              {/* O efeito colateral real, anunciado antes de acontecer. Sem esta
                  frase ele acontece igual, e é descoberto pela grade. */}
              <p className="mt-1.5">
                Esta guia também deixa de disputar posição no pareamento automático de{' '}
                <span className="tabular-nums">{dia(guia.data_execucao?.slice(0, 10) ?? null)}</span>.
                Se ela estava casada com alguma sessão daquele dia por posição, essa sessão volta a
                aparecer sem cobertura.
              </p>
            </div>
          )}

          <label className="mt-4 block">
            <span className="text-[12px] font-medium text-slate-600">
              Observação {ehDescarte ? '' : '(opcional)'}
            </span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
              rows={2}
              placeholder={ehDescarte
                ? 'Por que esta guia não corresponde a nenhuma sessão'
                : ehFalta
                  ? 'Ex.: autorizada antes de o terapeuta avisar a falta'
                  : 'Ex.: reautorizada no portal pelo setor de autorização'}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">{observacao.length}/500</span>
          </label>

          {erro && (
            <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
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
            disabled={salvando}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60 ${
              ehDescarte
                ? 'bg-slate-700 hover:bg-slate-800'
                : ehFalta
                  ? // Âmbar, e não esmeralda: o verde desta tela significa
                    // "coberto", e aqui nada foi coberto. O matiz da falta é o
                    // que o botão deve prometer.
                    'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {salvando && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {ehDescarte ? 'Marcar sem sessão' : ehFalta ? 'Registrar autorização' : 'Confirmar vínculo'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
