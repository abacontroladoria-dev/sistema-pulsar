'use client'

import { memo, useEffect, useState } from 'react'
import { Repeat2, ChevronDown, ExternalLink, RotateCcw } from 'lucide-react'

import Timeline from './Timeline'
import StatusBadge from './StatusBadge'
import { ReverteFaltaModal } from './ReverteFaltaModal'
import { Button } from '@/components/ui/button'
import { buscarLogsFila } from '@/services/logs.service'
import {
  resolverStatus,
  SEVERIDADE_UI,
  realizouPor,
  houveSubstituicao,
} from '@/lib/central/severity'
import { completarMotivoGlosa, motivoGlosaDaSessao } from '@/lib/glosa'
import { rotuloOrigemGuia, rotuloSolicitadoPor } from '@/lib/guiaOrigem'
import { rotuloForma } from '@/components/auditoria-assim/formaValidacao'
import { useGlosaCodigos } from '@/hooks/useGlosaCodigos'

interface Props {
  atendimento: any
  onReverterFalta?: (atendimento: any) => Promise<void>
}

/** Frase de situação por severidade — o coração da ficha. */
function fraseSituacao(item: any): string {
  const token = resolverStatus(item)
  switch (token.key) {
    case 'autorizado':
      return 'Atendimento autorizado. Nenhuma ação necessária.'
    case 'falta_terapeuta':
      return 'Terapeuta não compareceu. Verifique cobertura.'
    case 'falta_paciente':
      return 'Paciente faltou. Avaliar remarcação.'
    case 'erro':
      return 'Atendimento sem autorização. Requer ação manual.'
    // Frase própria, e não a de 'erro': 'erro' é o robô que não terminou
    // (refazer); glosa é a ASSIM que respondeu recusando (contestar). Sem este
    // caso a ficha caía no `default` e repetia o rótulo do badge — "Glosa" — sem
    // dizer o que fazer a respeito.
    case 'glosa':
      return 'A ASSIM recusou a autorização. Requer contestação.'
    // A recusa continua sendo verdade — e o motivo dela segue logo abaixo desta
    // frase. O que mudou é que existe guia liberada cobrindo o atendimento, e
    // por isso não há o que contestar. A guia sai nomeada na seção Autorização.
    case 'glosa_resolvida':
      return 'Glosa coberta por autorização externa. Nenhuma ação necessária.'
    case 'processando':
      return 'Autorização em processamento pelo sistema.'
    case 'concluido_sem_guia':
      return 'Concluído, aguardando guia do convênio.'
    case 'pendente':
      return 'Aguardando processamento.'
    default:
      return token.label
  }
}

function SidePanel({ atendimento, onReverterFalta }: Props) {
  const [logs, setLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logsAbertos, setLogsAbertos] = useState(false)
  const [modalReverterAberto, setModalReverterAberto] = useState(false)
  const [loadingReverter, setLoadingReverter] = useState(false)
  // Antes do early return de "nenhum atendimento": hook não pode ficar atrás de
  // condicional.
  const codigosGlosa = useGlosaCodigos()

  useEffect(() => {
    async function carregarLogs() {
      if (!atendimento?.id) {
        setLogs([])
        return
      }
      setLoadingLogs(true)
      const response = await buscarLogsFila(atendimento.id)
      setLogs(response || [])
      setLoadingLogs(false)
    }
    carregarLogs()
  }, [atendimento?.id])

  const handleReverterConfirm = async () => {
    if (!onReverterFalta) return
    try {
      setLoadingReverter(true)
      await onReverterFalta(atendimento)
    } finally {
      setLoadingReverter(false)
      setModalReverterAberto(false)
    }
  }

  if (!atendimento) {
    return (
      <div className="sticky top-0 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-500">Nenhum atendimento</p>
        <p className="text-xs text-slate-400 mt-1">
          Selecione uma linha para ver a ficha operacional.
        </p>
      </div>
    )
  }

  const token = resolverStatus(atendimento)
  const ui = SEVERIDADE_UI[token.severidade]
  const realizou = realizouPor(atendimento)
  const subbed = houveSubstituicao(atendimento)
  // Motivo por extenso da recusa. Só existe em sessão glosada — nas demais,
  // `status_assim` é 'Liberado' e afins. O de-para entra porque a coluna pode
  // ter vindo do relatório, onde a ASSIM corta o texto em 25 caracteres.
  const motivoGlosa = completarMotivoGlosa(motivoGlosaDaSessao(atendimento), codigosGlosa)

  // A guia que resolveu a glosa (aba Reconciliação). Ela NÃO substitui o campo
  // Guia: aquele continua sendo a autorização recusada, porque vincular não
  // reescreve o pareamento. São dois números diferentes contando a mesma
  // história, e esconder um deles apaga metade dela.
  const vinculo = atendimento.vinculo
  const procedenciaVinculo = vinculo
    ? [
        vinculo.vinculado_por ? `vínculo por ${vinculo.vinculado_por}` : null,
        vinculo.data_execucao
          ? new Date(vinculo.data_execucao).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  // De onde veio a guia: o robô a capturou no recibo, ou ela foi tirada direto no
  // portal da ASSIM. Nulo quando não há guia (inclusive nas linhas de presença, que
  // gravam 'N/A') ou quando a sessão é anterior ao registro de procedência — nesses
  // casos a Row não aparece, em vez de afirmar o que ninguém apurou.
  const origemGuia = rotuloOrigemGuia(
    atendimento.numero_autorizacao_origem,
    atendimento.numero_autorizacao
  )

  const unidade =
    atendimento.unidade?.replace('Unid. ', '')?.split(' - ')[0] ||
    atendimento.sala_nome?.replace('Unid. ', '')?.split(' - ')[0]

  const horarioFim = atendimento.hora_final?.slice(0, 5)
  const horarioIni =
    atendimento.horario?.slice(0, 5) || atendimento.hora_inicial?.slice(0, 5)

  const confirmadoEm = atendimento.confirmado_em
    ? (() => {
        const d = new Date(atendimento.confirmado_em)
        const data = d.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
        })
        const hora = d.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
        return atendimento.confirmado_por_nome
          ? `${data} ${hora} · ${atendimento.confirmado_por_nome}`
          : `${data} ${hora}`
      })()
    : null

  return (
    <div className="sticky top-0 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white">
      {/* CABEÇALHO */}
      <div className="p-5 border-b border-slate-100">
        <h2 className="text-xl font-semibold leading-tight text-slate-900">
          {atendimento.paciente_nome}
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {atendimento.classificacao_terapia ||
            atendimento.terapia_nome ||
            'Sem terapia'}
        </p>
        <div className="mt-3">
          <StatusBadge item={atendimento} variant="pill" />
        </div>
      </div>

      {/* SITUAÇÃO ATUAL */}
      <div className={`px-5 py-4 ${ui.soft} border-b border-slate-100`}>
        <SectionTitle>Situação atual</SectionTitle>
        <p className={`text-sm font-medium ${ui.text}`}>{fraseSituacao(atendimento)}</p>
        {/* O motivo é o que a coordenação precisa para contestar, então fica na
            frase de situação e não numa Row lá embaixo. Herda o `ui.text` da
            severidade — mesma tinta da frase que ele completa. O código sai em
            fonte tabular por ser número de protocolo, que se lê dígito a
            dígito. */}
        {motivoGlosa && (
          <p className={`mt-1.5 text-sm ${ui.text} opacity-90 wrap-break-word`}>
            {motivoGlosa.codigo && (
              <span className="font-mono tabular-nums">{motivoGlosa.codigo} · </span>
            )}
            {motivoGlosa.descricao}
          </p>
        )}
        {/* O que a recepção escreveu ao dar a falta. Mesmo tratamento do motivo
            da glosa logo acima, e pela mesma razão: é a explicação em prosa do
            desfecho, e quem precisa dela precisa dela AQUI, não numa Row de par
            rótulo/valor lá embaixo, onde texto livre quebra mal.

            Vem antes do botão "Reverter falta" de propósito: explica a falta que
            o botão desfaz, e ler o porquê antes de decidir desfazer é a ordem
            natural. Herda o `ui.text` da severidade, como a frase que completa. */}
        {(atendimento.justificativa_falta || atendimento.motivo_falta) && (
          <p className={`mt-1.5 text-sm ${ui.text} opacity-90 wrap-break-word`}>
            {atendimento.motivo_falta && (
              <span className="font-medium">{atendimento.motivo_falta}</span>
            )}
            {atendimento.motivo_falta && atendimento.justificativa_falta && ' · '}
            {atendimento.justificativa_falta}
          </p>
        )}

        {/* A sessão adiantada. Sem ela, a Central mostra uma sessão que não
            aconteceu no dia em que está listada e não diz que aconteceu noutro.
            `data_atendimento_real` existe desde 20260916120000 e até aqui era
            só predicado — nunca chegou a uma tela. */}
        {atendimento.data_atendimento_real && (
          <p className={`mt-1.5 text-sm ${ui.text} opacity-90 wrap-break-word`}>
            Sessão adiantada — atendida em{' '}
            <span className="font-semibold tabular-nums">
              {new Date(`${atendimento.data_atendimento_real}T00:00:00`).toLocaleDateString('pt-BR')}
            </span>
            {atendimento.adiantada_justificativa ? ` · ${atendimento.adiantada_justificativa}` : ''}
            {atendimento.adiantada_por_nome ? ` (${atendimento.adiantada_por_nome})` : ''}
          </p>
        )}

        {atendimento.status_operacional === 'falta_paciente' && onReverterFalta && (
          <Button
            size="sm"
            onClick={() => setModalReverterAberto(true)}
            className="mt-3 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
          >
            <RotateCcw className="w-4 h-4 mr-1.5" />
            Reverter falta
          </Button>
        )}
      </div>

      <div className="p-5 space-y-6">
        {/* AUTORIZAÇÃO */}
        <section>
          <SectionTitle>Autorização</SectionTitle>
          <dl className="space-y-2.5">
            <Row
              label="Guia"
              value={
                atendimento.completion_type !== 'automated'
                  ? 'N/A — fora ASSIM'
                  : atendimento.numero_autorizacao
              }
              mono
            />
            {/* Procedência, logo abaixo da guia que ela descreve — e ANTES de "Coberta
                pela guia", que é outro número e ganharia a leitura errada se a linha
                caísse depois dele. `completion_type` no gate porque a Row acima já
                trocou o valor por 'N/A — fora ASSIM' nesse caso: anotar a origem de uma
                guia que a tela não está mostrando não diria nada. */}
            {origemGuia && atendimento.completion_type === 'automated' && (
              <Row
                label="Origem da guia"
                value={
                  <span className={origemGuia.chip} title={origemGuia.detalhe}>
                    {origemGuia.foraDoPulsar && (
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    )}
                    {origemGuia.texto}
                  </span>
                }
              />
            )}
            {vinculo && (
              <Row
                label="Coberta pela guia"
                value={
                  <span className="inline-flex flex-col items-end gap-0.5">
                    <span className="tabular-nums text-emerald-700">
                      {vinculo.guia}
                    </span>
                    {procedenciaVinculo && (
                      <span className="text-xs text-slate-400">
                        {procedenciaVinculo}
                      </span>
                    )}
                  </span>
                }
              />
            )}
            {/* O rótulo muda quando a guia veio de fora: ali este nome é de quem abriu
                a solicitação, não de quem conseguiu a autorização. Ver lib/guiaOrigem.ts. */}
            <Row
              label={rotuloSolicitadoPor(
                atendimento.numero_autorizacao_origem,
                atendimento.numero_autorizacao
              )}
              value={atendimento.criado_por}
            />
            <Row label="Forma" value={rotuloForma(atendimento.forma_autorizacao)} />
            <Row
              label="Convênio"
              value={atendimento.convenio || atendimento.convenio_nome}
            />
            <Row
              label="Autorizado em"
              value={
                atendimento.horario_autorizacao
                  ? new Date(atendimento.horario_autorizacao).toLocaleTimeString(
                      'pt-BR',
                      { hour: '2-digit', minute: '2-digit' }
                    )
                  : null
              }
            />
          </dl>
        </section>

        {/* ATENDIMENTO */}
        <section>
          <SectionTitle>Atendimento</SectionTitle>
          <dl className="space-y-2.5">
            <Row label="Agendado" value={atendimento.profissional_nome} />
            <Row
              label="Realizado por"
              value={
                realizou ? (
                  <span className="inline-flex items-center gap-1.5">
                    {realizou}
                    {subbed && (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                        <Repeat2 className="w-3 h-3" /> substituto
                      </span>
                    )}
                  </span>
                ) : null
              }
            />
            <Row
              label="Horário"
              value={
                horarioIni
                  ? horarioFim
                    ? `${horarioIni}–${horarioFim}`
                    : horarioIni
                  : null
              }
            />
            <Row label="Unidade" value={unidade} />
            <Row label="Confirmado em" value={confirmadoEm} />
          </dl>
        </section>

        {/* TIMELINE */}
        <section>
          <SectionTitle>Linha do tempo</SectionTitle>
          {loadingLogs ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <Timeline logs={logs} />
          )}
        </section>

        {/* LOGS TÉCNICOS — colapsados */}
        {logs.length > 0 && (
          <section>
            <button
              onClick={() => setLogsAbertos((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <SectionTitle className="mb-0">
                Logs técnicos · {logs.length}
              </SectionTitle>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform ${
                  logsAbertos ? 'rotate-180' : ''
                }`}
              />
            </button>
            {logsAbertos && (
              <div className="mt-3 space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"
                  >
                    <span className="text-slate-700">{log.descricao}</span>
                    {log.erro && (
                      <span className="block text-rose-600 mt-1">{log.erro}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <ReverteFaltaModal
        open={modalReverterAberto}
        atendimento={atendimento}
        onCancel={() => setModalReverterAberto(false)}
        onConfirm={handleReverterConfirm}
        loading={loadingReverter}
      />
    </div>
  )
}

function SectionTitle({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h3
      className={`text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-3 ${className}`}
    >
      {children}
    </h3>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-slate-400 shrink-0">{label}</dt>
      <dd
        className={`text-sm text-right text-slate-700 wrap-break-word ${
          mono ? 'tabular-nums' : ''
        }`}
      >
        {value || <span className="text-slate-300">—</span>}
      </dd>
    </div>
  )
}

export default memo(SidePanel)
