'use client'

import Link from 'next/link'
import { ArrowUpRight, Check, ChevronRight, ExternalLink, FileSpreadsheet, FileText, FileX, Folder, Minus, X } from 'lucide-react'
import { ScheduleModal } from '@/components/cronograma/ui/ScheduleModal'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { dataHora, ITENS_PEP, rotuloMotivo, TIPOS_ARQUIVO } from '@/lib/roboSharepoint/rotulos'
import type { ArquivoLidoCompleto, SpItemStatus } from '@/types/roboSharepoint'
import { TOM, useCamadaModal } from './Blocos'

// Tudo o que se sabe de UM arquivo lido: o que é, onde está (a trilha inteira
// de pastas), quem enviou e quando, o que o robô decidiu e por quê, e o que
// aconteceu com ele no Pulsar. Padrão do modal da Rem. Mês - Total: faixa
// de identidade, grade de campos com rótulo em caixa alta pequena, seções.

const SITUACAO: Record<SpItemStatus, { rotulo: string; tom: 'green' | 'amber' | 'blue' | 'gray' }> = {
  sugerido: { rotulo: 'sugestão para a PEP', tom: 'blue' },
  confirmado: { rotulo: 'confirmada na PEP', tom: 'green' },
  nao_reconhecido: { rotulo: 'não reconhecido', tom: 'amber' },
  ignorado: { rotulo: 'ignorada pelo RP', tom: 'gray' },
  removido: { rotulo: 'apagado do SharePoint', tom: 'gray' },
}

const mesBR = (c: string | null | undefined) => (c ? c.split('-').reverse().join('/') : '—')
const tamanho = (b: number | null) => (b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`)

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{rotulo}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{children}</dd>
    </div>
  )
}

function Sinal({ ok, rotulo, nota }: { ok: boolean | null | undefined; rotulo: string; nota: string }) {
  const Icone = ok == null ? Minus : ok ? Check : X
  const tom = ok == null ? 'gray' : ok ? 'green' : 'amber'
  return (
    <li className="flex items-start gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text}`}>
        <Icone className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{rotulo}</span>
        <span className="block text-xs text-muted-foreground">{nota}</span>
      </span>
    </li>
  )
}

export function ModalArquivo({ arquivo: a, zIndex, onClose }: { arquivo: ArquivoLidoCompleto; zIndex?: number; onClose: () => void }) {
  const camada = useCamadaModal()
  const segmentos = (a.caminho ?? a.nome).split('/').filter(Boolean)
  const pastas = segmentos.slice(0, -1)
  const item = ITENS_PEP.find(i => i.sigla === a.sigla)
  const situacao = a.situacao ? SITUACAO[a.situacao] : null
  const Icone = a.tipo === 'removido' ? FileX : a.tipo === 'planilha' ? FileSpreadsheet : FileText
  const competencia = a.competencia_pulsar ?? a.competencia
  const s = (a.sinais ?? {}) as Record<string, boolean | null>

  return (
    <ScheduleModal
      title={a.nome}
      subtitle={<span className="inline-flex items-center gap-2">{TIPOS_ARQUIVO[a.tipo]?.rotulo ?? a.tipo}{a.sigla ? ` · ${a.sigla}` : ''}{a.novo ? ' · visto pela 1ª vez nesta execução' : ''}</span>}
      maxWidth={920}
      zIndex={zIndex ?? camada}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {a.prestador_nome && competencia && a.tipo === 'evidencia' && (
            <Link href={`/relacionamento-prestador/pep?competencia=${competencia}&prestador=${encodeURIComponent(a.prestador_nome)}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Abrir na PEP <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {a.web_url && a.tipo !== 'removido' && (
            <a href={a.web_url} target="_blank" rel="noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Abrir no SharePoint <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Identidade */}
        <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-4">
          <span className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP[TOM[a.tipo]].bg} ${TONE_CHIP[TOM[a.tipo]].text}`}>
            <Icone className="h-6 w-6" aria-hidden />
            {a.sigla && <span className="mt-1 text-[10px] font-black">{a.sigla}</span>}
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-bold text-foreground">{a.nome}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item ? `${item.sigla} · ${item.nome}` : TIPOS_ARQUIVO[a.tipo]?.rotulo}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusChip tone={TOM[a.tipo]}>{TIPOS_ARQUIVO[a.tipo]?.rotulo ?? a.tipo}</StatusChip>
              {situacao && <StatusChip tone={situacao.tom}>{situacao.rotulo}</StatusChip>}
              {a.novo && <StatusChip tone="blue">novo</StatusChip>}
            </div>
          </div>
        </div>

        {/* Campos */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Campo rotulo="Prestador">{a.prestador_nome ?? pastas[0]?.replace(/^prestador de servi[cç]o\s*-\s*/i, '') ?? '—'}</Campo>
          <Campo rotulo="Paciente (pasta)">{a.paciente_pasta_id ? pastas[2] ?? '—' : a.sigla === 'STC' || a.sigla === 'ETC' ? 'Geral (sem paciente)' : '—'}</Campo>
          <Campo rotulo="Paciente no Pulsar">{a.paciente_nome ?? '—'}</Campo>
          <Campo rotulo="Competência">{mesBR(competencia)}</Campo>
          <Campo rotulo="Enviado em">{dataHora(a.criado_em_sp)}</Campo>
          <Campo rotulo="Enviado por">{a.criado_por ?? '—'}</Campo>
          <Campo rotulo="Modificado em">{dataHora(a.modificado_em_sp)}</Campo>
          <Campo rotulo="Tamanho">{tamanho(a.tamanho)}</Campo>
          <Campo rotulo="Robô viu pela 1ª vez">{dataHora(a.visto_primeiro_em)}</Campo>
          {a.resolvido_por_nome && <Campo rotulo="Resolvido por">{a.resolvido_por_nome} · {dataHora(a.resolvido_em)}</Campo>}
        </dl>

        {/* Trilha de pastas */}
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Onde está no SharePoint</p>
          <ol className="space-y-1">
            {pastas.map((p, i) => (
              <li key={`${p}-${i}`} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${i * 16}px` }}>
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-foreground">{p}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm font-semibold" style={{ paddingLeft: `${pastas.length * 16}px` }}>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
              <Icone className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
              <span className="truncate text-foreground">{a.nome}</span>
            </li>
          </ol>
        </section>

        {/* Por que */}
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">O que o robô decidiu e por quê</p>
          {a.tipo === 'evidencia' ? (
            <ul className="grid gap-2 sm:grid-cols-3">
              <Sinal ok={s.prestador} rotulo="Prestador reconhecido" nota="CNPJ da planilha está em Contratos" />
              <Sinal ok={a.sigla === 'STC' || a.sigla === 'ETC' ? null : s.paciente} rotulo="Paciente reconhecido" nota={a.sigla === 'STC' || a.sigla === 'ETC' ? 'item Geral: não tem paciente' : 'CPF da planilha + nome conferem com o cadastro'} />
              <Sinal ok={a.sigla === 'STC' || a.sigla === 'ETC' ? null : s.sessao_cc_no_mes} rotulo="Sessão no mês" nota="Coordenador de Caso com esse paciente na competência" />
            </ul>
          ) : (
            <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-foreground">
              {a.tipo === 'planilha'
                ? (a.detalhe?.usada ? 'É a planilha de planejamento deste prestador: o robô a leu para tirar o CNPJ e os CPFs.' : rotuloMotivo(a.detalhe?.motivo))
                : rotuloMotivo(a.motivo)}
            </p>
          )}
          {a.situacao === 'nao_reconhecido' && a.motivo_pulsar && (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Motivo no Pulsar: {rotuloMotivo(a.motivo_pulsar)}</p>
          )}
        </section>
      </div>
    </ScheduleModal>
  )
}
