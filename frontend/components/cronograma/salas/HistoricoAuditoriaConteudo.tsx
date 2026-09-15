"use client"

// HistoricoAuditoriaConteudo — o corpo da trilha de auditoria, sem a casca de
// modal. Extraído de HistoricoAuditoriaModal quando o detalhe da sala passou a
// precisar do mesmo histórico numa aba: o modal continua existindo (botão
// "Histórico" da página, trilha geral) e agora é uma casca fina em volta deste
// componente, então não há duas implementações para divergir.
//
// `registroId` filtra no SERVIÇO (getTrilhaAuditoriaSala já aceita o parâmetro),
// não no cliente — filtrar depois de paginar mostraria "nenhuma alteração" toda
// vez que as 30 linhas mais recentes fossem de outras salas.

import { useEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { TONE_SOLID } from "@/components/cronograma/ui/tones"
import { camposAlterados, camposSnapshot } from "@/lib/cronograma/auditoriaFormat"
import { getTrilhaAuditoriaSala, type CronogramaTrilhaAcao, type CronogramaTrilhaAuditoria, type CronogramaTrilhaTabela } from "@/services/salasAuditoria.service"

const ACAO_LABEL: Record<CronogramaTrilhaAcao, string> = { criar: "Criação", editar: "Edição", excluir: "Exclusão" }
const ACAO_TONE: Record<CronogramaTrilhaAcao, keyof typeof TONE_SOLID> = { criar: "green", editar: "blue", excluir: "red" }
const TABELA_LABEL: Record<CronogramaTrilhaTabela, string> = {
  sala: "Sala", alocacao: "Alocação", nucleo: "Núcleo", status_label: "Status", exclusividade_terapia: "Exclusividade de terapia",
}

function nomeContextual(item: CronogramaTrilhaAuditoria): string {
  if (item.tabela === "alocacao") {
    const partes = [item.sala_nome, item.profissional_nome, item.terapia_nome].filter(Boolean)
    return partes.length ? partes.join(" · ") : "—"
  }
  if (item.tabela === "exclusividade_terapia") {
    const partes = [item.sala_nome, item.terapia_nome].filter(Boolean)
    return partes.length ? partes.join(" · ") : "—"
  }
  return item.sala_nome ?? item.nucleo_nome ?? item.registro_id
}

function formatarDataHora(item: CronogramaTrilhaAuditoria): string {
  // criado_em_brasilia já vem pronto do banco (DD/MM/AAAA HH:MM, horário de
  // Brasília) — toLocaleString é só um fallback pra linhas antigas sem essa coluna.
  return item.criado_em_brasilia ?? new Date(item.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

const ITENS_POR_PAGINA = 30

interface HistoricoAuditoriaConteudoProps {
  /** Quando presente, traz só a trilha deste registro (ex.: uma sala específica). */
  registroId?: string
  /** Texto do estado vazio — muda entre a trilha geral e a de uma sala. */
  vazioLabel?: string
}

export function HistoricoAuditoriaConteudo({
  registroId,
  vazioLabel = "Nenhuma alteração registrada ainda.",
}: HistoricoAuditoriaConteudoProps) {
  const [itens, setItens] = useState<CronogramaTrilhaAuditoria[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandidoId, setExpandidoId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setExpandidoId(null)
    getTrilhaAuditoriaSala({ limite: ITENS_POR_PAGINA, pagina, registroId })
      .then(({ data, total, error }) => {
        if (error) setError("Não foi possível carregar o histórico.")
        setItens(data)
        setTotal(total)
      })
      .finally(() => setLoading(false))
  }, [pagina, registroId])

  const totalPaginas = Math.max(1, Math.ceil(total / ITENS_POR_PAGINA))

  return (
    <>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando histórico...
        </div>
      )}
      {error && <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>}
      {!loading && !error && itens.length === 0 && (
        <div className="text-sm text-muted-foreground">{vazioLabel}</div>
      )}

      <div className="flex flex-col gap-1.5">
        {itens.map(item => {
          const tone = TONE_SOLID[ACAO_TONE[item.acao]]
          const expandido = expandidoId === item.id
          const alteracoes = item.acao === "editar" ? camposAlterados(item) : []
          const snapshot = item.acao !== "editar" ? camposSnapshot(item) : []
          const temDetalhe = alteracoes.length > 0 || snapshot.length > 0 || !!item.motivo
          return (
            <div key={item.id} className="rounded-lg border border-border px-2.5 py-2">
              <button
                type="button"
                onClick={() => temDetalhe && setExpandidoId(expandido ? null : item.id)}
                aria-expanded={temDetalhe ? expandido : undefined}
                className={`flex w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${temDetalhe ? "cursor-pointer" : "cursor-default"}`}
              >
                {temDetalhe ? (expandido ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />) : <span className="w-3.5 shrink-0" />}
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone.bg} ${tone.text}`}>{ACAO_LABEL[item.acao]}</span>
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{TABELA_LABEL[item.tabela]}</span>
                <span className="flex-1 truncate text-sm font-semibold text-foreground">{nomeContextual(item)}</span>
                <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <div>{item.usuario_nome ?? "Usuário desconhecido"}</div>
                  <div>{formatarDataHora(item)}</div>
                </span>
              </button>
              {item.resumo && (
                <div className="mt-1 pl-5.5 text-[12px] text-muted-foreground">{item.resumo}</div>
              )}
              {expandido && (
                <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
                  {alteracoes.length === 0 && snapshot.length === 0 && (
                    <div className="text-sm text-muted-foreground">Nenhum outro detalhe registrado pra essa alteração.</div>
                  )}
                  {alteracoes.map(c => (
                    <div key={c.label} className="text-sm text-foreground">
                      <span className="font-semibold">{c.label}:</span> {c.antes} <span className="text-muted-foreground">→</span> {c.depois}
                    </div>
                  ))}
                  {snapshot.map(c => (
                    <div key={c.label} className="text-sm text-foreground">
                      <span className="font-semibold">{c.label}:</span> {c.valor}
                    </div>
                  ))}
                  {item.motivo && (
                    <div className="text-sm text-foreground">
                      <span className="font-semibold">Motivo:</span> {item.motivo}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!loading && !error && total > ITENS_POR_PAGINA && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setPagina(p => Math.max(1, p - 1))}
            disabled={pagina === 1}
            className="flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted sm:min-h-0"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-[12px] text-muted-foreground">Página {pagina} de {totalPaginas}</span>
          <button
            type="button"
            onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
            disabled={pagina === totalPaginas}
            className="flex min-h-11 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted sm:min-h-0"
          >
            Próxima <ChevronRight size={14} />
          </button>
        </div>
      )}
    </>
  )
}
