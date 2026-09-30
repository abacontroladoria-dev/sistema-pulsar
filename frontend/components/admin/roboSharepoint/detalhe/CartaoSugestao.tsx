'use client'

import Link from 'next/link'
import { ArrowUpRight, Check, ExternalLink, FileText } from 'lucide-react'
import { TONE_CHIP } from '@/components/ui/tones'
import { dataHora, ITENS_PEP } from '@/lib/roboSharepoint/rotulos'
import type { SituacaoReconhecimento } from '@/types/roboSharepoint'

// Uma sugestão para a PEP, com tudo o que a tornou possível: o arquivo, o
// paciente e o prestador que o banco reconheceu, e os três sinais que
// precisaram concordar. Nada vira entrega sem o RP confirmar na PEP.

type Sugestao = SituacaoReconhecimento['sugestoes'][number]

const mesBR = (c: string | null) => (c ? c.split('-').reverse().join('/') : '—')

export function CartaoSugestao({ s }: { s: Sugestao }) {
  const item = ITENS_PEP.find(i => i.sigla === s.sigla)
  const geral = s.sigla === 'STC' || s.sigla === 'ETC'
  const sinais = [
    { r: 'Prestador', n: 'CNPJ da planilha está em Contratos' },
    { r: geral ? 'Item Geral' : 'Paciente', n: geral ? 'não precisa de paciente' : 'CPF da planilha + nome conferem' },
    { r: 'Sessão no mês', n: geral ? 'prestador ativo na competência' : 'Coordenador de Caso com o paciente' },
  ]
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-foreground/25">
      <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#3aaa5c,#2A92C0)' }} />
      <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>
            <span className="text-xl font-black leading-none">{s.sigla}</span>
            <span className="mt-1 text-[9px] font-bold uppercase tracking-wide">sugestão</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-foreground">{s.paciente_nome ?? 'Geral (sem paciente)'}</p>
            <p className="truncate text-xs text-muted-foreground">{item?.nome} · {s.prestador_nome}</p>
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-foreground">
              <FileText className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
              <span className="truncate">{s.nome}</span>
              <span className="shrink-0 text-muted-foreground">· enviado {dataHora(s.criado_em_sp)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 xl:border-l xl:border-border xl:pl-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Competência</p>
            <p className="text-2xl font-black leading-none tabular-nums text-foreground">{mesBR(s.competencia)}</p>
          </div>
          <ul className="grid gap-1">
            {sinais.map(x => (
              <li key={x.r} className="flex items-center gap-1.5 text-[11px]" title={x.n}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full ${TONE_CHIP.green.bg} ${TONE_CHIP.green.text}`}><Check className="h-3 w-3" aria-hidden /></span>
                <span className="font-semibold text-foreground">{x.r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 gap-1.5 xl:flex-col">
          {s.prestador_nome && s.competencia && (
            <Link href={`/relacionamento-prestador/pep?competencia=${s.competencia}&prestador=${encodeURIComponent(s.prestador_nome)}`}
              className="inline-flex h-11 items-center justify-center gap-1 rounded-lg bg-foreground px-4 text-xs font-bold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Abrir na PEP <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          {s.web_url && (
            <a href={s.web_url} target="_blank" rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-border px-4 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Arquivo <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </li>
  )
}
