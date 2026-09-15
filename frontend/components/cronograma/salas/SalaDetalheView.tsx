"use client"

// SalaDetalheView — a sala inteira numa tela: o que ela é, como está ocupada,
// quem a usa e o que mudou nela.
//
// É uma VIEW, não uma rota irmã, de propósito: `useOcupacaoSalas` faz 5
// consultas pesadas num único efeito (uma delas já estourou statement timeout,
// ver o comentário no hook) e não há cache nenhum. Uma rota `[id]` remontaria o
// hook a cada sala aberta. Aqui o detalhe e a lista compartilham os mesmos
// dados já carregados, e `recarregarAlocacoes()` atualiza os dois de uma vez.
// A URL (`?sala=<id>`) dá deep-link e Back do browser mesmo assim.
//
// O estado interno (aba, drawer) nasce limpo na troca de sala pelo `key` que o
// pai passa — nunca por um useEffect de reset (regra 3.12 do padrão de modais).

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronRight, ShieldCheck } from "lucide-react"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { gradeSemanalDaSala, profissionaisDaSala, resumoCardSala, type AlocacaoNaCelula, type CelulaGradeSala } from "@/lib/cronograma/salasView"
import { SalaCadastroCard } from "./SalaCadastroCard"
import { SalaGradeSemanal } from "./SalaGradeSemanal"
import { SalaProfissionaisTab } from "./SalaProfissionaisTab"
import { HistoricoAuditoriaConteudo } from "./HistoricoAuditoriaConteudo"
import type { SalaComOcupacao, SalaTerapiaExclusiva } from "@/lib/cronograma/salasTypes"

type AbaDetalhe = "geral" | "semana" | "profissionais" | "historico"

interface SalaDetalheViewProps {
  item: SalaComOcupacao
  exclusividades: SalaTerapiaExclusiva[]
  onVoltar: () => void
  onEditarSala: () => void
  /** Abre o AlocarSessaoModal para editar uma alocação existente. */
  onEditarAlocacao: (celula: CelulaGradeSala, alocacao: AlocacaoNaCelula) => void
  /** Abre o AlocarSessaoModal em modo criação para o turno clicado. */
  onNovaAlocacao: (celula: CelulaGradeSala) => void
  /** Abre o drawer com o detalhe de uma alocação. */
  onVerAlocacao: (celula: CelulaGradeSala, alocacao: AlocacaoNaCelula) => void
}

export function SalaDetalheView({
  item, exclusividades, onVoltar, onEditarSala, onNovaAlocacao, onVerAlocacao,
}: SalaDetalheViewProps) {
  const [aba, setAba] = useState<AbaDetalhe>("geral")
  const { labels: statusLabels, loading: statusCarregando } = useStatusLabels()

  const resumo = useMemo(() => resumoCardSala(item), [item])
  const celulas = useMemo(() => gradeSemanalDaSala(item), [item])
  const profissionais = useMemo(() => profissionaisDaSala(item), [item])
  const exclusividadesDaSala = useMemo(
    () => exclusividades.filter(e => e.sala_id === item.sala.id),
    [exclusividades, item.sala.id],
  )

  const sala = item.sala
  const statusLabel = statusLabels[sala.status]
  // Mesmo sufixo do card e da tabela antiga — "Fazendinha · 1" lia-se como
  // parte do nome da unidade.
  const local = [sala.unidade_nome, sala.andar ? `${sala.andar}º andar` : null, sala.nucleo].filter(Boolean).join(" · ")
  const pct = resumo.pctSemanal === null ? null : Math.round(resumo.pctSemanal * 100)

  function abrirPorAlocacaoId(alocacaoId: string) {
    for (const celula of celulas) {
      const alocacao = celula.alocacoes.find(a => a.alocacaoId === alocacaoId)
      if (alocacao) {
        onVerAlocacao(celula, alocacao)
        return
      }
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-muted-foreground">
        {/* Um <button>, não um <Link>: voltar precisa manter os dados e os
            filtros já carregados, não remontar a página. */}
        <button
          type="button"
          onClick={onVoltar}
          className="rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ocupação de Salas
        </button>
        <ChevronRight size={12} aria-hidden />
        <span className="font-semibold text-foreground">{sala.nome_exibicao}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">{sala.nome_exibicao}</h2>
            {!statusLabel && statusCarregando ? (
              <span className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            ) : (
              <StatusPill tone={statusLabel?.tone ?? "slate"}>
                {statusLabel?.label ?? sala.status}
              </StatusPill>
            )}
            {exclusividadesDaSala.length > 0 && (
              <StatusPill tone="blue" dense>
                <ShieldCheck size={11} aria-hidden /> Exclusiva
              </StatusPill>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{local}</p>
        </div>

        <button
          type="button"
          onClick={onEditarSala}
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Editar sala
        </button>
      </header>

      {resumo.temInconsistencia && (
        <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
          <AlertTriangle size={13} className="shrink-0" />
          Esta sala tem alocação acima da capacidade ou fora da regra de exclusividade — veja a aba Ocupação semanal.
        </p>
      )}

      <SegmentedTabs
        value={aba}
        onChange={setAba}
        ariaLabel="Seções da sala"
        tabs={[
          { value: "geral", label: "Visão geral" },
          { value: "semana", label: "Ocupação semanal" },
          { value: "profissionais", label: "Profissionais", count: profissionais.length },
          { value: "historico", label: "Histórico" },
        ]}
      />

      {aba === "geral" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniKpi rotulo="Ocupação da semana" valor={pct === null ? "—" : `${pct}%`} />
            <MiniKpi rotulo="Turnos ocupados" valor={`${resumo.slotsOcupados}/${resumo.slotsTotal}`} />
            <MiniKpi rotulo="Profissionais" valor={String(profissionais.length)} />
            <MiniKpi
              rotulo="Precisam de atenção"
              valor={String(profissionais.filter(p => p.situacao === "conflito" || p.situacao === "sem-sessao").length)}
            />
          </div>

          {/* Aqui havia um "Semana em relance" repetindo as MESMAS bolinhas do
              card (mesmo resumo.dias, mesmo DIA_CLS) em tamanho maior — na aba
              alcançada justamente clicando naquele card, e ao lado da aba
              "Ocupação semanal", que mostra a semana de verdade. Três
              representações de uma semana numa tela só. A aba ao lado é a boa. */}
          <SalaCadastroCard sala={sala} exclusividades={exclusividadesDaSala} terapias={resumo.terapias} />
        </div>
      )}

      {aba === "semana" && (
        <SalaGradeSemanal
          celulas={celulas}
          onAbrirAlocacao={onVerAlocacao}
          onNovaAlocacao={onNovaAlocacao}
        />
      )}

      {aba === "profissionais" && (
        <SalaProfissionaisTab linhas={profissionais} onAbrirAlocacao={abrirPorAlocacaoId} />
      )}

      {aba === "historico" && (
        <div className="flex flex-col gap-2">
          {/* Filtrado no serviço por registro_id — ver HistoricoAuditoriaConteudo. */}
          <HistoricoAuditoriaConteudo
            registroId={sala.id}
            vazioLabel="Nenhuma alteração registrada nesta sala ainda."
          />
          <p className="text-[11px] text-muted-foreground">
            Mostra alterações do cadastro desta sala. Alterações de alocação aparecem no histórico geral da página.
          </p>
        </div>
      )}
    </div>
  )
}

function MiniKpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{valor}</div>
    </div>
  )
}
