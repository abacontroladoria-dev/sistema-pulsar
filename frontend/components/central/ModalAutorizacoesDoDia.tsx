'use client'

/**
 * "Autorizações de hoje" — o que a recepção vê ao clicar em "Última autorização"
 * no card da /solicitar.
 *
 * O recorte é o DIA VIGENTE da sessão clicada, e isso é a regra, não um detalhe
 * de layout: a recepcionista consulta este modal para decidir se pode solicitar
 * agora (a regra dos 30 min da ASSIM, ver lib/central/intervaloAssim.ts), e essa
 * decisão só olha as identificações de hoje. Histórico de outros dias aqui não
 * responderia pergunta nenhuma e ainda daria margem a ler uma autorização de
 * ontem como se fosse de agora.
 *
 * Por isso a consulta filtra `data_atendimento = <a data do card>` e o rodapé diz
 * em voz alta que é só do dia.
 */

import { useEffect, useState } from 'react'
import { X, CalendarDays, Info, Loader2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { horaDoTimestamp, minutosDesde } from '@/lib/central/intervaloAssim'

export type LinhaAutorizacaoDoDia = {
  id: string
  horario_autorizacao: string | null
  completed_at: string | null
  created_at: string | null
  status: string
  criado_por: string | null
  cancelado_por_nome: string | null
  horario: string | null
  terapia_nome: string | null
}

/**
 * O instante que a linha representa no relógio de parede de São Paulo.
 *
 * `horario_autorizacao` é wall time de SP e `completed_at` é UTC — a mesma
 * assimetria que a RPC listar_central_autorizacoes já trata. Aqui só se quer a
 * ordenação e o rótulo "HH:MM", então `horario_autorizacao` tem precedência e o
 * `created_at` (também wall time) fecha o caso das linhas que nunca concluíram.
 */
function instanteDaLinha(l: LinhaAutorizacaoDoDia): string | null {
  if (l.horario_autorizacao) return l.horario_autorizacao
  if (l.completed_at) {
    // Único campo em UTC: converte para SP antes de virar rótulo.
    const d = new Date(l.completed_at + (l.completed_at.endsWith('Z') ? '' : 'Z'))
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium',
      })
        .format(d)
        .replace(' ', 'T')
    }
  }
  return l.created_at
}

/** "há 23 min" / "há 1h 02min" — o formato que o mockup pede. */
function tempoRelativo(ts: string | null): string {
  const min = minutosDesde(ts)
  if (min === null) return ''
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${Math.floor(min)} min`

  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  return `há ${h}h ${String(m).padStart(2, '0')}min`
}

/**
 * Os status da fila traduzidos para o que a recepção precisa saber.
 *
 * Deliberadamente NÃO é o mapa completo de statusAutorizacao.ts: aqui a pergunta
 * é só "esta tentativa emitiu guia ou não", e nomes técnicos ('concluido_sem_guia')
 * não respondem isso para quem lê.
 */
const ROTULO_STATUS: Record<string, { texto: string; selo: string }> = {
  concluido:           { texto: 'Autorizado',  selo: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  concluido_sem_guia:  { texto: 'Autorizado',  selo: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  glosa:               { texto: 'Recusado',    selo: 'bg-red-50 text-red-600 border-red-100' },
  erro:                { texto: 'Erro',        selo: 'bg-red-50 text-red-600 border-red-100' },
  cancelado:           { texto: 'Cancelado',   selo: 'bg-slate-50 text-slate-600 border-slate-200' },
  processando:         { texto: 'Processando', selo: 'bg-blue-50 text-blue-700 border-blue-100' },
  pendente:            { texto: 'Na fila',     selo: 'bg-amber-50 text-amber-700 border-amber-100' },
}

function rotuloDe(status: string) {
  return (
    ROTULO_STATUS[status] ?? {
      texto: status,
      selo: 'bg-slate-50 text-slate-600 border-slate-200',
    }
  )
}

type Props = {
  /**
   * A sessão clicada — o mesmo objeto que a /solicitar já tem em mãos.
   *
   * Sem tipo porque as linhas da RPC `listar_central_autorizacoes` chegam assim
   * na página inteira; tipá-las de verdade é trabalho para quando a RPC ganhar
   * um contrato, e não algo a inventar só neste componente.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessao: any
  /** Número da sessão no dia ("4/6"), quando o paciente tem mais de uma. */
  sessaoInfo?: { index: number; total: number }
  cpfFormatado?: string
  dataNascimentoFormatada?: string
  onClose: () => void
}

export default function ModalAutorizacoesDoDia({
  sessao,
  sessaoInfo,
  cpfFormatado,
  dataNascimentoFormatada,
  onClose,
}: Props) {
  const supabase = getSupabaseClient()

  const [linhas, setLinhas] = useState<LinhaAutorizacaoDoDia[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    // O modal só existe enquanto aberto, então o controller do efeito basta para
    // não escrever estado em componente desmontado (fechar antes da resposta é o
    // caso comum: a recepção abre, bate o olho e fecha).
    let vivo = true

    // Volta ao estado de carregamento ANTES de buscar. Hoje o modal desmonta ao
    // fechar e o efeito raramente reroda com outra sessão, mas sem este reset um
    // reuso do componente mostraria o histórico (ou o erro) do paciente anterior
    // enquanto a nova consulta ainda está em voo — dado de um paciente sob o nome
    // de outro é o pior erro possível nesta tela.
    setLinhas(null)
    setErro(null)

    ;(async () => {
      const { data, error } = await supabase
        .from('fila_autorizacoes')
        .select(
          'id, horario_autorizacao, completed_at, created_at, status, criado_por, cancelado_por_nome, horario, terapia_nome'
        )
        .eq('paciente_id', String(sessao.paciente_id))
        // O recorte do dia vigente. É a regra do modal, não um filtro de conveniência.
        .eq('data_atendimento', sessao.data_atendimento)
        .order('created_at', { ascending: false })

      if (!vivo) return

      if (error) {
        setErro('Não foi possível carregar o histórico de hoje.')
        setLinhas([])
        return
      }

      setLinhas((data ?? []) as LinhaAutorizacaoDoDia[])
    })()

    return () => {
      vivo = false
    }
  }, [sessao.paciente_id, sessao.data_atendimento, supabase])

  const dataLegivel = String(sessao.data_atendimento || '')
    .slice(0, 10)
    .split('-')
    .reverse()
    .join('/')

  const horarioSessao = String(sessao.horario || '').slice(0, 5)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Autorizações de hoje"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.18)] border border-slate-200/60"
      >
        {/* CABEÇALHO */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          {/* O título do modal e o do painel da direita não podem ser a mesma
              frase — repetida a dois palmos de distância, ela deixa de informar.
              O painel é quem diz "Autorizações de hoje"; aqui o título nomeia o
              paciente, que é de quem se está falando, e a data faz o recorte. */}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-800 truncate">
              {sessao.paciente_nome}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Autorizações e agendamento de {dataLegivel}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* IDENTIFICAÇÃO
            Faixa de apoio, não bloco de destaque: o nome subiu para o título e
            aqui fica só o que o identifica no balcão (CPF e nascimento) mais o
            recorte do dia. Sem o nome repetido, a tarja deixou de precisar de
            avatar, gradiente e borda azul — era peso visual para um conteúdo de
            uma linha, e a leitura agora cai direto no que interessa. */}
        {(cpfFormatado || dataNascimentoFormatada) && (
          <div className="mx-6 mb-4 flex items-center justify-between gap-4 border-y border-slate-100 py-2.5">
            <p className="text-xs text-slate-500 truncate">
              {[
                cpfFormatado ? `CPF: ${cpfFormatado}` : null,
                dataNascimentoFormatada ? `Nasc.: ${dataNascimentoFormatada}` : null,
              ]
                .filter(Boolean)
                .join('   |   ')}
            </p>

            <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-[#2F7695]">
              <CalendarDays size={13} />
              Hoje, {dataLegivel}
            </span>
          </div>
        )}

        {/* AGENDAMENTO + HISTÓRICO
            Colunas desiguais de propósito. Antes eram duas caixas iguais lado a
            lado, e caixas iguais dizem "isto tem o mesmo peso" — só que não têm:
            o Agendamento é referência fixa e curta (seis campos que a recepção
            confere de relance), enquanto o histórico é o motivo de o modal
            existir e a única parte que cresce. Por isso o Agendamento vem antes,
            estreito e em tom neutro, e o histórico fica largo, em branco e com o
            respiro maior. A ordem de leitura passa a ser "de que sessão estamos
            falando" → "o que já aconteceu com ela". */}
        <div className="mx-6 grid gap-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:items-start">
          {/* AGENDAMENTO */}
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
            <h3 className="text-[13px] font-semibold text-slate-600 mb-3">Agendamento</h3>

            <dl className="space-y-2.5 text-xs">
              {[
                ['Horário', horarioSessao || '—'],
                ['Sessão', sessaoInfo ? `${sessaoInfo.index}/${sessaoInfo.total}` : '—'],
                ['Terapia', sessao.terapias?.join(' + ') || '—'],
                ['Convênio', sessao.convenio_nome || '—'],
                ['Sala', sessao.sala_nome || '—'],
                ['Terapeuta', sessao.profissionais?.join(' + ') || '—'],
              ].map(([rotulo, valor]) => (
                <div key={String(rotulo)} className="flex flex-col gap-0.5">
                  <dt className="text-[11px] text-slate-400">{rotulo}</dt>
                  <dd className="font-medium text-slate-700 leading-snug">{valor}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* HISTÓRICO */}
          <div className="rounded-xl border border-slate-200/70 bg-white p-5">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h3 className="text-[15px] font-semibold text-slate-800">
                Autorizações de hoje
              </h3>
              {linhas && linhas.length > 0 && (
                <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                  {linhas.length === 1 ? '1 tentativa' : `${linhas.length} tentativas`}
                </span>
              )}
            </div>

            {linhas === null ? (
              <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Carregando…
              </div>
            ) : erro ? (
              <p className="py-6 text-xs text-red-500">{erro}</p>
            ) : linhas.length === 0 ? (
              <p className="py-6 text-xs text-slate-400">
                Nenhuma autorização registrada hoje para este paciente.
              </p>
            ) : (
              <ul className="space-y-2">
                {linhas.map(l => {
                  const ts = instanteDaLinha(l)
                  const r = rotuloDe(l.status)

                  // Quem cancelou é quem agiu naquela linha — mostrar o solicitante
                  // original ali diria o nome errado.
                  const autor =
                    l.status === 'cancelado'
                      ? l.cancelado_por_nome || l.criado_por
                      : l.criado_por

                  return (
                    <li
                      key={l.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50/80 transition-colors"
                    >
                      {/* A hora é o primário da linha: é por ela que se conta o
                          intervalo de 30 min da ASSIM, que é a conta que trouxe a
                          recepção até aqui. Some o ponto colorido que existia
                          antes — dizia a mesma coisa que o selo ao lado, em
                          duplicidade. */}
                      <span className="shrink-0 w-11 text-[13px] font-semibold text-slate-700 tabular-nums">
                        {horaDoTimestamp(ts) || '--:--'}
                      </span>

                      <span
                        className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${r.selo}`}
                      >
                        {r.texto}
                      </span>

                      {/* O nome de quem solicitou. Quando `criado_por` está vazio
                          (linhas antigas, anteriores à coluna) dizer "—" é honesto;
                          inventar "Recepção" esconderia o buraco. */}
                      <span className="flex-1 min-w-0 truncate text-xs text-slate-600">
                        {autor || '—'}
                      </span>

                      <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                        {tempoRelativo(ts)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

        </div>

        {/* RECORTE EXPLÍCITO + FECHAR
            A regra continua dita, mas em nota de rodapé. Numa tarja azul de
            largura inteira ela era o elemento mais chamativo do modal, e o que
            ela carrega é uma ressalva sobre o que NÃO está aqui — abaixo do
            histórico, dos dados e do agendamento em importância. Na mesma linha
            do "Fechar" ela é lida ao sair, que é quando serve. */}
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-100 px-6 py-4">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Info size={13} className="shrink-0" />
            Apenas as autorizações de hoje são exibidas.
          </p>

          <button
            onClick={onClose}
            className="shrink-0 text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
