"use client"

// PepHistoricoModal — trilha de auditoria da Entregas PEP (Analista do
// Comportamento). A trilha (pep_trilha_auditoria) já existia e já era escrita
// em toda mutação, mas nunca ganhou uma tela — mesma situação que
// HistoricoAuditoriaModal (Ocupação de Salas) resolveu antes.
//
// Dois usos deste mesmo componente: com `prestadorNome`, mostra só o
// histórico daquele Analista (todas as competências); sem ele, mostra todas
// as alterações da PEP, de qualquer prestador — inclusive as de
// `calendario_competencia` ("Semanas no mês"), que não têm prestador.

import { useEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { TONE_SOLID } from "@/components/cronograma/ui/tones"
import { camposAlterados, camposSnapshot, nomeItemDaTrilha } from "@/lib/remuneracao/pepAuditoriaFormat"
import { getTrilhaAuditoria, type PepTrilhaAcao, type PepTrilhaAuditoria, type PepTrilhaTabela } from "@/services/pepAuditoria.service"
import type { PepCatalogoItem } from "@/types/pep"
import { ChipOrigem } from "./pep/origem"

interface Props {
  prestadorNome?: string
  catalogo: PepCatalogoItem[]
  onClose: () => void
}

const ACAO_LABEL: Record<PepTrilhaAcao, string> = { criar: "Criação", editar: "Edição", excluir: "Exclusão", reverter: "Desfeito" }
const ACAO_TONE: Record<PepTrilhaAcao, keyof typeof TONE_SOLID> = { criar: "green", editar: "blue", excluir: "red", reverter: "slate" }
const TABELA_LABEL: Record<PepTrilhaTabela, string> = {
  registro_entrega: "Entrega",
  planejamento_semestral: "Planejamento",
  apuracao_mensal: "Faturamento",
  calendario_competencia: "Semanas no mês",
}

function nomeContextual(item: PepTrilhaAuditoria, catalogo: PepCatalogoItem[]): string {
  if (item.tabela === "calendario_competencia") return `Competência ${item.registro_id}`
  const nomeItem = nomeItemDaTrilha(item, catalogo)
  const partes = [item.paciente_nome, nomeItem].filter(Boolean)
  return partes.length ? partes.join(" · ") : (item.prestador_nome ?? "—")
}

function formatarDataHora(item: PepTrilhaAuditoria): string {
  // criado_em_brasilia já vem pronto do banco (DD/MM/AAAA HH:MM, horário de
  // Brasília) — toLocaleString é só um fallback pra linhas antigas sem essa coluna.
  return item.criado_em_brasilia ?? new Date(item.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

const ITENS_POR_PAGINA = 30

export function PepHistoricoModal({ prestadorNome, catalogo, onClose }: Props) {
  const [itens, setItens] = useState<PepTrilhaAuditoria[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandidoId, setExpandidoId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setExpandidoId(null)
    getTrilhaAuditoria({ prestadorNome, limite: ITENS_POR_PAGINA, pagina })
      .then(({ data, total, error }) => {
        if (error) setError("Não foi possível carregar o histórico.")
        setItens(data)
        setTotal(total)
      })
      .finally(() => setLoading(false))
  }, [prestadorNome, pagina])

  const totalPaginas = Math.max(1, Math.ceil(total / ITENS_POR_PAGINA))

  return (
    <ScheduleModal
      title={prestadorNome ? `Histórico — ${prestadorNome}` : "Histórico geral da PEP"}
      subtitle={prestadorNome
        ? "Planejamentos, entregas e faturamento deste Analista — todas as competências, mais recentes primeiro."
        : "Todas as alterações da PEP, de qualquer Analista do Comportamento — mais recentes primeiro."}
      maxWidth={720}
      onClose={onClose}
    >
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando histórico...
        </div>
      )}
      {error && <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>}
      {!loading && !error && itens.length === 0 && (
        <div className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</div>
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
                className={`flex w-full items-center gap-2 text-left ${temDetalhe ? "cursor-pointer" : "cursor-default"}`}
              >
                {temDetalhe ? (expandido ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />) : <span className="w-3.5 shrink-0" />}
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone.bg} ${tone.text}`}>{ACAO_LABEL[item.acao]}</span>
                <ChipOrigem origem={item.ator === "robo" ? "robo" : "humano"} />
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{TABELA_LABEL[item.tabela]}</span>
                <span className="flex-1 truncate text-sm font-semibold text-foreground">{nomeContextual(item, catalogo)}</span>
                <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <div>{item.usuario_nome ?? "Usuário desconhecido"}</div>
                  <div>{formatarDataHora(item)}</div>
                </span>
              </button>
              {item.resumo && (
                <div className="mt-1 pl-[22px] text-[12px] text-muted-foreground">{item.resumo}</div>
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
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-[12px] text-muted-foreground">Página {pagina} de {totalPaginas}</span>
          <button
            type="button"
            onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
            disabled={pagina === totalPaginas}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
          >
            Próxima <ChevronRight size={14} />
          </button>
        </div>
      )}
    </ScheduleModal>
  )
}