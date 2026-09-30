'use client'

import { useEffect, useState } from 'react'
import { Check, Circle, Loader2, X } from 'lucide-react'
import { ETAPAS, segundos } from '@/lib/roboSharepoint/rotulos'
import type { RoboEtapa, RoboExecucao } from '@/types/roboSharepoint'

// A execução contada etapa por etapa. É a tela que responde "o que o robô
// está fazendo agora e quanto tempo levou": cada etapa chega pelo Realtime no
// momento em que o robô a registra, e a que está rodando ganha um cronômetro
// local (o banco só recebe o tempo quando ela termina).
//
// Cor = estado da etapa, sempre com ícone e texto junto (DESIGN.md: sky em
// trânsito, emerald concluída, rose falhou, slate ainda não começou).

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ativo) return
    const id = setInterval(() => setAgora(Date.now()), 200)
    return () => clearInterval(id)
  }, [ativo])
  return agora
}

function resumoDetalhe(etapa: RoboEtapa): string | null {
  const d = etapa.detalhe as Record<string, unknown> | null | undefined
  if (!d) return null
  if (typeof d.erro === 'string') return d.erro
  switch (etapa.etapa) {
    case 'autenticar':
      return d.certificado_dias_restantes != null ? `Certificado vence em ${d.certificado_dias_restantes} dias` : null
    case 'listar':
      return `${d.leitura === 'completa' ? 'Leitura completa' : 'Só o que mudou'} · ${d.arquivos_novos_ou_alterados ?? 0} arquivo(s) · ${d.pastas ?? 0} pastas`
    case 'classificar':
      return `${d.evidencias ?? 0} evidência(s) · ${d.planilhas ?? 0} planilha(s) · ${d.fora_padrao ?? 0} fora do padrão`
    case 'planilhas':
      return `${d.lidas ?? 0} lida(s) · ${d.pacientes_nas_planilhas ?? 0} pacientes · ${d.cpfs_invalidos ?? 0} CPF inválido`
    case 'enviar':
      return d.sem_banco
        ? 'Banco desligado (demonstração)'
        : `${d.novos ?? 0} novo(s) · ${d.sugeridos ?? 0} sugestão(ões) · ${d.ms_banco ?? '—'} ms no banco`
    default:
      return null
  }
}

export function LinhaDoTempo({ execucao }: { execucao: RoboExecucao | null }) {
  const rodando = execucao?.status === 'executando'
  const agora = useAgora(rodando)

  if (!execucao) {
    return (
      <p className="text-sm text-slate-500">
        Nenhuma execução ainda. Quando o robô rodar, cada etapa aparece aqui, com o tempo que levou.
      </p>
    )
  }

  const porEtapa = new Map(execucao.etapas.map(e => [e.etapa, e]))
  const totalMs = rodando
    ? agora - new Date(execucao.iniciado_em).getTime()
    : execucao.duracao_ms ?? execucao.metricas?.duracao_ms ?? null

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">
          {rodando ? 'Executando agora' : execucao.status === 'erro' ? 'Última execução falhou' : 'Última execução'}
        </p>
        <p className="text-sm text-slate-600" aria-live="polite">
          Tempo total <strong className="text-2xl font-bold tabular-nums text-slate-800">{segundos(totalMs)}</strong>
        </p>
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {ETAPAS.map(({ etapa, rotulo, explica }) => {
          const e = porEtapa.get(etapa)
          const estado = e?.status ?? (rodando ? 'pendente' : execucao.status === 'erro' ? 'pulada' : 'pendente')
          const ms = e?.status === 'executando' && e.inicio ? agora - new Date(e.inicio).getTime() : e?.duracao_ms ?? null
          const detalhe = e ? resumoDetalhe(e) : null

          const estilo =
            estado === 'concluida' ? 'border-emerald-200 bg-emerald-50/60'
              : estado === 'executando' ? 'border-sky-300 bg-sky-50'
                : estado === 'erro' ? 'border-rose-200 bg-rose-50/70'
                  : 'border-slate-200 bg-white'
          const icone =
            estado === 'concluida' ? <Check className="h-4 w-4 text-emerald-700" aria-hidden />
              : estado === 'executando' ? <Loader2 className="h-4 w-4 animate-spin text-sky-700 motion-reduce:animate-none" aria-hidden />
                : estado === 'erro' ? <X className="h-4 w-4 text-rose-700" aria-hidden />
                  : <Circle className="h-4 w-4 text-slate-300" aria-hidden />
          const textoEstado =
            estado === 'concluida' ? 'concluída' : estado === 'executando' ? 'em andamento' : estado === 'erro' ? 'falhou' : 'aguardando'

          return (
            <li key={etapa} className={`rounded-xl border p-3 transition-colors ${estilo}`}>
              <div className="flex items-center gap-2">
                {icone}
                <span className="text-sm font-semibold text-slate-800">{rotulo}</span>
                <span className="sr-only">— {textoEstado}</span>
              </div>
              <p className="mt-2 text-xl font-bold tabular-nums text-slate-800">
                {ms != null ? segundos(ms, 2) : <span className="text-slate-300">—</span>}
              </p>
              <p className="mt-1 text-xs leading-snug text-slate-500">{detalhe ?? explica}</p>
            </li>
          )
        })}
      </ol>

      {execucao.status === 'erro' && execucao.erro && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {execucao.erro}
        </p>
      )}
    </div>
  )
}
