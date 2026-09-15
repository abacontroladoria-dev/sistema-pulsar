"use client"

// SalaCard — a unidade da visão geral. Responde, nesta ordem e com pesos
// visuais diferentes: que sala é, em que estado está, quanto está ocupada, se
// tem problema, e como foi a semana.
//
// O card é BURRO de propósito: recebe `ResumoCardSala` já derivado por
// `resumoCardSala()` (lib/cronograma/salasView.ts) e não calcula nada. Se ele
// pudesse contar slots, o número dele e o do KPI divergiriam no primeiro
// filtro novo — é a regra 3.1 de docs/padrao-detalhamento-modal.md.
//
// O que ele deliberadamente NÃO mostra: nomes de profissionais. A visão geral
// serve para achar a sala; quem está nela é assunto do detalhe. Listar 6 nomes
// em 80 cards transforma a página na planilha que ela deixou de ser.

import { memo } from "react"
import { AlertTriangle, ShieldCheck } from "lucide-react"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { descreverResumoSemanal, type ResumoCardSala } from "@/lib/cronograma/salasView"
import { corDaUnidade, DIA_CLS, SITUACAO_MARCA_CLS } from "./salasVocabulario"
import type { StatusTone } from "@/services/salas.service"

/** O que `useStatusLabels()` entrega por código de status (não é a linha inteira do banco). */
export interface RotuloStatus {
  label: string
  label_curto: string
  tone: StatusTone
}

interface SalaCardProps {
  resumo: ResumoCardSala
  temExclusividade: boolean
  /** Rótulo/cor do status vindos do banco; `undefined` enquanto carregam. */
  statusLabel?: RotuloStatus
  statusCarregando?: boolean
  onVerDetalhes: (salaId: string) => void
  onEditarSala: (salaId: string) => void
}

function SalaCardBase({ resumo, temExclusividade, statusLabel, statusCarregando, onVerDetalhes, onEditarSala }: SalaCardProps) {
  const { sala, dias, slotsOcupados, slotsTotal, pctSemanal, temInconsistencia } = resumo
  const pct = pctSemanal === null ? null : Math.round(pctSemanal * 100)
  const unidade = corDaUnidade(sala.unidade_nome)

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-shadow hover:shadow-md ${
        temInconsistencia ? "border-rose-300 dark:border-rose-800" : "border-border"
      }`}
    >
      {/* A unidade é o que agrupa a varredura de dezenas de cards: a faixa é o
          que se lê de relance, antes de qualquer texto. Violeta/terracota/ciano
          são famílias que NENHUM estado usa — rosa, âmbar, verde e azul-céu
          estão reservados a conflito/atenção/saudável/agenda-aberta (ver
          salasVocabulario), e uma unidade em âmbar leria como alerta. */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${unidade.faixa}`} aria-hidden />

      {/* 1 e 2 — que sala é, em que estado está */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[15px] font-bold text-foreground">{sala.nome_exibicao}</h3>
            {temExclusividade && (
              <ShieldCheck
                size={13}
                className="shrink-0 text-sky-600 dark:text-sky-400"
                aria-label="Sala com exclusividade de terapia"
              />
            )}
          </div>
          {/* Unidade fora do cinza e separada do andar: antes as duas viviam
              numa string só ("Fazendinha · 1º andar") no mesmo peso do núcleo,
              e a unidade — o dado mais usado para achar a sala — sumia. */}
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
            <span className={`font-semibold ${unidade.texto}`}>{sala.unidade_nome}</span>
            {sala.andar && <span className="text-muted-foreground">{sala.andar}º andar</span>}
          </p>
        </div>
        {/* Enquanto os rótulos não chegaram do banco, um skeleton — o fallback
            cinza fazia um status vermelho piscar cinza a cada carga. */}
        {!statusLabel && statusCarregando ? (
          <span className="h-5 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
        ) : (
          <StatusPill tone={statusLabel?.tone ?? "slate"} dense>
            {statusLabel?.label_curto ?? sala.status}
          </StatusPill>
        )}
      </div>

      {/* Altura reservada mesmo sem núcleo: sem isso um card sem núcleo fica
          mais curto e a barra de ocupação dele desalinha das vizinhas na mesma
          linha da grade, quebrando a leitura horizontal. */}
      <p className="mt-2 h-4 truncate text-xs text-muted-foreground" title={sala.nucleo ?? undefined}>
        {sala.nucleo}
      </p>

      {/* 3 — ocupação. O número grande é o que o olho procura ao varrer a grade de cards. */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums text-foreground">{slotsOcupados}</span>
          <span className="text-sm text-muted-foreground">/ {slotsTotal} turnos</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {pct === null ? "—" : `${pct}%`}
        </span>
      </div>

      {/* Sala fora de operação não tem denominador: uma barra vazia ali diria
          "0% ocupada", quando o certo é "não há base" (o "—" ao lado). */}
      {/* A barra mede OCUPAÇÃO e só isso. Antes ela ficava rosa quando a sala
          tinha inconsistência em outro lugar — a mesma cor dizendo "conflito"
          num sítio e "quanto está ocupado" noutro. Conflito já é dito pela
          borda do card e pela faixa "Precisa de atenção" logo abaixo. */}
      <div className="mt-1.5 h-1.5" role="presentation">
        {slotsTotal > 0 && (
          <div className="h-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-slate-400 dark:bg-slate-500"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {resumo.capacidadeLabel} · {resumo.capacidadeProjetada > 0 ? `${resumo.capacidadeProjetada} simultâneos` : "fora de operação"}
      </p>

      {/* 4 — problema. Só aparece quando existe: um selo permanente em todo card
          vira ruído e deixa de sinalizar coisa alguma. */}
      {temInconsistencia && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
          <AlertTriangle size={12} className="shrink-0" /> Precisa de atenção
        </p>
      )}

      {/* 5 — a semana em relance. Cor nunca carrega a informação sozinha: o
          aria-label diz o mesmo em prosa e cada bolinha tem title. */}
      <div className="mt-3 flex items-center gap-1.5" role="img" aria-label={descreverResumoSemanal(dias)}>
        {dias.map(d => (
          <span key={d.dow} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-muted-foreground">{d.label}</span>
            <span
              className={`${SITUACAO_MARCA_CLS} ${DIA_CLS[d.nivel]}`}
              title={d.total > 0 ? `${d.label}: ${d.ocupados}/${d.total} turnos` : d.label}
            />
          </span>
        ))}
      </div>

      {/* 6 — ações. Ambas são botões de verdade: "Editar sala" era texto sem
          borda e lia-se como link, não como ação. A hierarquia entre elas fica
          no PREENCHIMENTO, não na ausência de forma — "Ver detalhes" é o que a
          maioria das visitas quer (consultar), editar é o caso secundário. */}
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onEditarSala(sala.id)}
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Editar sala
        </button>
        <button
          type="button"
          onClick={() => onVerDetalhes(sala.id)}
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#222847] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2d3459] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-slate-900"
        >
          Ver detalhes
        </button>
      </div>
    </div>
  )
}

/**
 * `memo` porque a grade renderiza N cards e a busca por profissional dispara um
 * render do pai a cada tecla. A comparação olha só o que o card exibe.
 */
export const SalaCard = memo(SalaCardBase, (a, b) =>
  a.resumo.sala.id === b.resumo.sala.id
  && a.resumo.sala.updated_at === b.resumo.sala.updated_at
  && a.resumo.pctSemanal === b.resumo.pctSemanal
  && a.resumo.slotsOcupados === b.resumo.slotsOcupados
  && a.resumo.slotsTotal === b.resumo.slotsTotal
  && a.resumo.temInconsistencia === b.resumo.temInconsistencia
  && a.temExclusividade === b.temExclusividade
  && a.statusLabel === b.statusLabel
  && a.statusCarregando === b.statusCarregando,
)
