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
    // Sem `hover:shadow`: o DESIGN.md define o sistema como flat — mudança de
    // estado é cor e opacidade, nunca elevação. O hover agora escurece a borda.
    <div
      // `h-full` para o card ocupar a altura da linha da grade: sem isso o
      // `mt-auto` do rodapé não tem espaço livre para empurrar e os botões
      // voltam a seguir o conteúdo.
      className={`group relative flex h-full flex-col rounded-xl border bg-card p-4 transition-colors ${
        temInconsistencia
          ? "border-rose-300 dark:border-rose-800"
          : "border-border hover:border-slate-300 dark:hover:border-slate-600"
      }`}
    >
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
          {/* A unidade como CHIP, não como faixa lateral: o DESIGN.md proíbe
              side-stripe em card, e a cor precisa morar dentro do perímetro.
              O chip é mais legível que o trilho de 6px que estava aqui — diz
              a mesma coisa de relance e ainda carrega o nome.
              Violeta/terracota/ciano são famílias que NENHUM estado usa: rosa,
              âmbar, verde e azul-céu estão reservados a conflito/atenção/
              saudável/agenda-aberta, e uma unidade em âmbar leria como alerta. */}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${unidade.chip}`}>
              {sala.unidade_nome}
            </span>
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
      {/* `mt-auto` AQUI, não no rodapé: a folga variável de cada card (a faixa
          "Precisa de atenção" existe só em alguns) precisa ser absorvida ACIMA
          da semana. Com o mt-auto no rodapé, a folga caía entre a semana e a
          linha divisória, e a fileira de dias ficava colada na linha num card e
          longe dela no vizinho. */}
      <div className="mt-auto flex items-center gap-1.5 pt-3" role="img" aria-label={descreverResumoSemanal(dias)}>
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
      {/* Margem fixa: quem absorve a folga variável do card é a fileira de dias
          acima (o `mt-auto` dela). Daqui para baixo o espaçamento é constante,
          então semana → linha → botões guardam a mesma distância em todo card. */}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
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
          // `B.steel`, não `B.navy`: o navy é a cor da identidade e a 14.4:1
          // lê como quase-preto — num card claro ele pesava como um bloco de
          // texto. O aço é azul de verdade e mantém 6.89:1 com branco.
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#2B5E86] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-slate-900"
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
