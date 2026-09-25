'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Check, ExternalLink, KeySquare, Link2, Loader2, UserX, X } from 'lucide-react'
import SituacaoBadge from '@/components/auditoria-assim/SituacaoBadge'
import { formatarDiaComNome } from '@/components/auditoria-assim/reconciliacao/datas'
import { useModalDialog } from '@/hooks/useModalDialog'
import {
  divergenciasDa,
  filipetaDaSessao,
  guiaDaSessao,
  idDaSessao,
  type LinhaFolha,
  type SessaoConferencia,
} from './folhas'
import { EvolucaoBadge, formatarCarimbo } from './vocabulario'

type Props = {
  linha: LinhaFolha | null
  agora: Date
  onFechar: () => void
  onSalvarObservacao: (sessao: SessaoConferencia, texto: string) => Promise<void>
  onFilipeta: (linha: LinhaFolha) => void
  /** Uma gravação desta sessão em curso. */
  ocupado: boolean
  /** Links para as telas onde cada divergência se resolve; nulos sem permissão. */
  hrefConferenciaAssim: ((s: SessaoConferencia) => string) | null
  hrefEvolucoes: ((s: SessaoConferencia) => string) | null
  onAbrirReconciliacao: ((s: SessaoConferencia) => void) | null
}

const ROTULO_DIVERGENCIA = {
  sem_assinatura: 'Responsável não assinou',
  sem_autorizacao: 'Sem autorização liberada',
  sem_evolucao: 'Sem evolução',
} as const

/** Parcial (dois profissionais, um escreveu) não é "sem evolução": diz quantas faltam. */
function rotuloDivergencia(d: keyof typeof ROTULO_DIVERGENCIA, s: SessaoConferencia) {
  if (d === 'sem_evolucao' && s.grade_com_evolucao > 0) {
    const faltam = s.grade_total - s.grade_com_evolucao
    return `Falta${faltam > 1 ? 'm' : ''} ${faltam} das ${s.grade_total} evoluções`
  }
  return ROTULO_DIVERGENCIA[d]
}

/**
 * O detalhe da sessão em painel lateral — o padrão do sistema para não abrir
 * página nova. Tudo o que a linha resume, por extenso, mais a observação livre
 * e os atalhos para as três telas onde cada problema se resolve.
 */
export default function PainelSessao({
  linha,
  agora,
  onFechar,
  onSalvarObservacao,
  onFilipeta,
  ocupado,
  hrefConferenciaAssim,
  hrefEvolucoes,
  onAbrirReconciliacao,
}: Props) {
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  const aberto = Boolean(linha)
  const fechar = useCallback(() => onFechar(), [onFechar])
  const { refDialogo, propsDialogo } = useModalDialog(aberto && montado, fechar, 'titulo-painel-sessao')

  const s = linha?.sessao ?? null
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  // Pela identidade da sessão, não pelo objeto: a recarga silenciosa (a aba
  // voltando a ter foco) troca o objeto e apagaria o que ela digitou sem salvar.
  const chave = s ? idDaSessao(s) : null
  const salva = s?.observacao_conferencia ?? ''
  useEffect(() => setTexto(salva), [chave, salva])

  if (!montado || !linha || !s) return null
  const divergencias = divergenciasDa(s, agora)
  const alterado = (texto.trim() || null) !== (s.observacao_conferencia ?? null)

  async function salvar() {
    if (!s) return
    setSalvando(true)
    try {
      await onSalvarObservacao(s, texto)
    } finally {
      setSalvando(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onMouseDown={(e) => e.target === e.currentTarget && fechar()}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-xl outline-none sm:rounded-l-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">
              Linha {linha.linha} · {formatarDiaComNome(s.data_atendimento)} às {s.hora_inicial.slice(0, 5)}
            </p>
            <h2 id="titulo-painel-sessao" className="mt-1 text-lg leading-tight font-bold text-slate-800">
              {s.paciente_nome ?? '—'}
            </h2>
            {s.carteirinha && <p className="text-xs text-slate-500 tabular-nums">{s.carteirinha}</p>}
          </div>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {divergencias.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">
              {divergencias.map((d) => (
                <li key={d} className="text-xs font-semibold">
                  {rotuloDivergencia(d, s)}
                </li>
              ))}
              {s.recepcao_avisada_em && (
                <li className="pt-1 text-xs text-slate-600">
                  Com a recepção: aviso de {formatarCarimbo(s.recepcao_avisada_por_nome, s.recepcao_avisada_em)}
                </li>
              )}
            </ul>
          )}

          <Secao titulo="Sessão">
            <Campo rotulo="Terapia" valor={s.terapias} />
            <Campo rotulo="Profissional" valor={s.profissionais} />
            {s.data_atendimento_real && (
              <Campo rotulo="Atendida em" valor={formatarDiaComNome(s.data_atendimento_real)} />
            )}
          </Secao>

          {s.falta ? (
            // A falta não tem autorização, evolução nem assinatura: só o fato e o porquê.
            <Secao titulo="Falta">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-slate-700">
                <UserX size={14} aria-hidden="true" className="shrink-0 text-slate-500" />
                {s.falta === 'terapeuta' ? 'Falta do terapeuta' : 'Falta do paciente'}
              </p>
              <Campo rotulo="Motivo" valor={s.motivo_falta?.trim() || null} />
              <Campo rotulo="Justificativa" valor={s.justificativa_falta?.trim() || null} />
              <p className="text-xs text-slate-600">
                Na folha, a recepção escreve &ldquo;falta&rdquo; nesta linha. Assinatura aqui é engano: avise a
                recepção.
              </p>
            </Secao>
          ) : (
            <>
              <Secao titulo="Autorização">
                <div className="flex flex-wrap items-center gap-2">
                  <SituacaoBadge situacao={s.situacao} />
                  {guiaDaSessao(s) && (
                    <span className="text-xs text-slate-600 tabular-nums">
                      Guia {guiaDaSessao(s)}
                      {s.tipo_vinculo === 'substituicao'
                        ? ' (substituição)'
                        : s.tipo_vinculo === 'vinculo'
                          ? ' (vínculo)'
                          : ''}
                    </span>
                  )}
                </div>
                {s.observacao && <p className="text-xs text-slate-600">{s.observacao}</p>}
                <LinhaFilipeta
                  sessao={s}
                  futura={linha.futura}
                  ocupado={ocupado}
                  onFilipeta={() => onFilipeta(linha)}
                />
              </Secao>

              <Secao titulo="Evolução">
                <EvolucaoBadge sessao={s} />
              </Secao>

              <Secao titulo="Assinatura">
                <p className="text-xs text-slate-600">
                  {s.status_conferencia === 'assinada'
                    ? `Assinada — ${formatarCarimbo(s.conferido_por_nome, s.conferido_em)}`
                    : s.status_conferencia === 'sem_assinatura'
                      ? `Não assinou — ${formatarCarimbo(s.conferido_por_nome, s.conferido_em)}`
                      : linha.futura
                        ? 'A sessão ainda não aconteceu.'
                        : 'Ainda não conferida.'}
                </p>
              </Secao>

              <Secao titulo="Observação">
                <label htmlFor="obs-conferencia" className="sr-only">
                  Observação da conferência
                </label>
                <textarea
                  id="obs-conferencia"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  placeholder="Ex.: responsável assinou na linha errada; recepção vai colher amanhã"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={salvar}
                    disabled={!alterado || salvando}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 text-xs font-semibold text-white transition hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-50"
                  >
                    {salvando && <Loader2 size={12} className="animate-spin" />}
                    Salvar observação
                  </button>
                </div>
              </Secao>
            </>
          )}

          {(hrefConferenciaAssim || hrefEvolucoes || onAbrirReconciliacao) && (
            <Secao titulo="Resolver em">
              <div className="flex flex-col gap-1">
                {hrefConferenciaAssim && <Atalho href={hrefConferenciaAssim(s)} rotulo="Conferência ASSIM do dia" />}
                {onAbrirReconciliacao && (
                  <button
                    type="button"
                    onClick={() => onAbrirReconciliacao(s)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                  >
                    <Link2 size={14} className="shrink-0 text-slate-500" />
                    Semana do paciente na Reconciliação
                  </button>
                )}
                {hrefEvolucoes && <Atalho href={hrefEvolucoes(s)} rotulo="Evoluções do paciente na semana" />}
              </div>
            </Secao>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Quando a sessão deixou papel: qual, se já foi conferida, e o check para conferir. */
function LinhaFilipeta({
  sessao: s,
  futura,
  ocupado,
  onFilipeta,
}: {
  sessao: SessaoConferencia
  futura: boolean
  ocupado: boolean
  onFilipeta: () => void
}) {
  const f = filipetaDaSessao(s)
  if (!f) return null
  const papel = f.numero
    ? `Filipeta com token ${f.numero}`
    : f.motivo === 'dispositivo_indisponivel'
      ? 'Filipeta sem token (dispositivo indisponível)'
      : 'Filipeta sem token (erro no reconhecimento facial)'
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-1.5 text-xs text-slate-600">
        <KeySquare size={13} aria-hidden="true" className="mt-px shrink-0 text-slate-500" />
        <span>
          {papel}.{' '}
          {f.conferida
            ? `Conferida — ${formatarCarimbo(s.filipeta_conferida_por_nome ?? null, s.filipeta_conferida_em ?? null)}.`
            : 'Ainda não conferida.'}
        </span>
      </p>
      {!futura && s.bloco_id && (
        <button
          type="button"
          onClick={onFilipeta}
          disabled={ocupado}
          className={`inline-flex min-h-10 items-center gap-2 self-start rounded-lg border px-3 text-[13px] font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60 ${
            f.conferida
              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {ocupado ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            !f.conferida && <Check size={14} strokeWidth={2.75} aria-hidden="true" />
          )}
          {f.conferida ? 'Desmarcar filipeta' : 'Filipeta conferida'}
        </button>
      )}
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{titulo}</h3>
      {children}
    </section>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <p className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{rotulo}</span>
      <span className="min-w-0 text-slate-800">{valor ?? '—'}</span>
    </p>
  )
}

function Atalho({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
    >
      <ExternalLink size={14} className="shrink-0 text-slate-500" />
      {rotulo}
    </Link>
  )
}
