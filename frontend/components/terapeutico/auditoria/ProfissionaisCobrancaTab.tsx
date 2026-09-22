'use client'

import React from 'react'
import { MessageSquare, Users } from 'lucide-react'
import { useToneColor, type Tone } from '@/hooks/useToneColor'
import { TONE_CHIP } from '@/components/ui/tones'
import type { ResumoProfissionalAuditoria } from '@/types/auditoriaEvolucoes'
import { tomDaConformidade, tomSeHouver, FOCO, BOTAO_SECUNDARIO } from './vocabulario'

interface Props {
  resumos: ResumoProfissionalAuditoria[]
  onCobrarProfissional: (prof: ResumoProfissionalAuditoria) => void
  onVerEvolucoesProfissional: (prof: ResumoProfissionalAuditoria) => void
}

export function ProfissionaisCobrancaTab({
  resumos,
  onCobrarProfissional,
  onVerEvolucoesProfissional
}: Props) {
  const toneColor = useToneColor()

  if (resumos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-16 text-center shadow-sm">
        <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-sm font-semibold text-foreground">
          Nenhum profissional com evoluções neste período
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Amplie o período nos filtros ou rode a análise em “Auditar novas evoluções”.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {resumos.map(prof => {
        const temRisco = prof.risco_relevante > 0 || prof.risco_especifico > 0
        const temPendencias = prof.pendentes_cobranca > 0

        // Dois sinais, duas cores (§3.6): o que mais urge nesta pessoa pinta a
        // identidade; a barra lê o próprio percentual. Com um tom só, uma única
        // inconsistência pintava 90% de vermelho.
        const tomStatus: 'red' | 'amber' | 'green' =
          prof.risco_relevante > 0 ? 'red' : prof.risco_especifico > 0 ? 'amber' : 'green'
        const temConformidade = prof.total_auditadas > 0
        const tomPct = tomDaConformidade(temConformidade ? prof.taxa_conformidade : null)

        return (
          <div
            key={prof.profissional_id ? String(prof.profissional_id) : prof.profissional_nome}
            className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Identificação */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${TONE_CHIP[tomStatus].bg} ${TONE_CHIP[tomStatus].text}`}
                  aria-hidden
                >
                  {prof.profissional_nome.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-bold text-foreground">
                    {prof.profissional_nome}
                  </h4>
                  <p className="truncate text-xs text-muted-foreground">
                    {prof.terapia_nome || 'Especialidade não informada'}
                  </p>
                </div>
              </div>
            </div>

            {/* Conformidade: barra + número. flex-1 min-w-0 na barra, nunca w-full. */}
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-muted">
                {temConformidade && (
                  <div
                    className="h-full w-full"
                    style={{
                      background: toneColor(tomPct),
                      clipPath: `inset(0 ${100 - prof.taxa_conformidade}% 0 0)`,
                      transition: 'clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                  />
                )}
              </div>
              <span
                className="shrink-0 text-sm font-bold tabular-nums"
                style={{ color: toneColor(tomPct) }}
              >
                {temConformidade ? `${prof.taxa_conformidade}%` : '—'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {temConformidade
                ? `${prof.sem_risco} de ${prof.total_auditadas} evoluções sem risco`
                : `Nenhuma das ${prof.total_evolucoes} evoluções foi auditada ainda`}
            </p>

            {/* Métricas — colorido só quando > 0 (§3.5) */}
            <dl className="mt-4 grid grid-cols-4 gap-2 rounded-lg bg-muted/50 px-1 py-2 text-center">
              <Metrica rotulo="Total" valor={prof.total_evolucoes} />
              <Metrica rotulo="Sem risco" valor={prof.sem_risco} tone={tomSeHouver(prof.sem_risco, 'green')} toneColor={toneColor} />
              <Metrica rotulo="Específico" valor={prof.risco_especifico} tone={tomSeHouver(prof.risco_especifico, 'amber')} toneColor={toneColor} />
              <Metrica rotulo="Relevante" valor={prof.risco_relevante} tone={tomSeHouver(prof.risco_relevante, 'red')} toneColor={toneColor} />
            </dl>

            {/* Ações */}
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
              <button
                onClick={() => onVerEvolucoesProfissional(prof)}
                className={`${BOTAO_SECUNDARIO} flex-1 justify-center`}
              >
                Ver evoluções ({prof.total_evolucoes})
              </button>

              {temRisco && (
                <button
                  onClick={() => onCobrarProfissional(prof)}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${FOCO} ${
                    temPendencias
                      ? 'bg-brand-fg text-white hover:bg-brand-dark'
                      : 'border border-border bg-background text-foreground hover:bg-muted/40'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {temPendencias ? `Cobrar (${prof.pendentes_cobranca})` : 'Cobrar'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Metrica({ rotulo, valor, tone, toneColor }: {
  rotulo: string
  valor: number
  tone?: Tone
  toneColor?: (t: Tone) => string
}) {
  return (
    <div>
      <dt className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </dt>
      <dd
        className="text-sm font-bold tabular-nums text-foreground"
        style={tone && toneColor ? { color: toneColor(tone) } : undefined}
      >
        {valor}
      </dd>
    </div>
  )
}
