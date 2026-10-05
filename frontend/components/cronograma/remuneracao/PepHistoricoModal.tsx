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
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { TONE_SOLID } from "@/components/cronograma/ui/tones"
import {
  camposAlterados,
  camposSnapshot,
  diffEvidencias,
  evidenciasDe,
  nomeDaEvidencia,
  nomeItemDaTrilha,
  resumoCurto,
  semEstadoAnterior,
  type EvidenciaTrilha,
} from "@/lib/remuneracao/pepAuditoriaFormat"
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

/**
 * A linha curta sob o nome. Robô (e "Desfeito", que só ele grava): o `resumo`
 * escrito pelo SQL já é uma frase pronta. Pessoa: montada na hora a partir de
 * antes/depois — o `resumo` gravado traz a URL inteira das evidências.
 */
function resumoDaLinha(item: PepTrilhaAuditoria): string {
  if ((item.ator === "robo" || item.acao === "reverter") && item.resumo) return item.resumo
  return resumoCurto(item) || item.resumo || ""
}

// Link neutro: azul e violeta na PEP querem dizer Pessoa e Robô (pep/origem.tsx).
function LinkEvidencia({ evidencia, riscado = false }: { evidencia: EvidenciaTrilha; riscado?: boolean }) {
  const nome = nomeDaEvidencia(evidencia)
  const link = /^https?:\/\//i.test(evidencia.caminho) ? evidencia.caminho : null
  if (!link) return <span className={`break-words ${riscado ? "line-through" : ""}`}>{nome}</span>
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      title={link}
      className={`inline-flex max-w-full items-center gap-1 underline decoration-border underline-offset-2 hover:decoration-foreground ${riscado ? "line-through" : ""}`}
    >
      <span className="min-w-0 break-words">{nome}</span>
      <ExternalLink size={12} className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">(abre no SharePoint)</span>
    </a>
  )
}

function ListaEvidencias({ valor }: { valor: unknown }) {
  const lista = evidenciasDe(valor)
  if (!lista.length) return <>—</>
  return (
    <ul className="flex flex-col gap-0.5">
      {lista.map(e => <li key={e.caminho} className="min-w-0"><LinkEvidencia evidencia={e} /></li>)}
    </ul>
  )
}

function DiffEvidencias({ antes, depois }: { antes: unknown; depois: unknown }) {
  const { adicionadas, removidas } = diffEvidencias(antes, depois)
  if (!adicionadas.length && !removidas.length) return <>Mesmos arquivos, com outro nome ou outra ordem</>
  return (
    <ul className="flex flex-col gap-0.5">
      {removidas.map(e => (
        <li key={`-${e.caminho}`} className="flex min-w-0 gap-1.5 text-muted-foreground">
          <span className="shrink-0 font-bold text-rose-600 dark:text-rose-400" aria-label="Removido">−</span>
          <LinkEvidencia evidencia={e} riscado />
        </li>
      ))}
      {adicionadas.map(e => (
        <li key={`+${e.caminho}`} className="flex min-w-0 gap-1.5">
          <span className="shrink-0 font-bold text-emerald-600 dark:text-emerald-400" aria-label="Adicionado">+</span>
          <LinkEvidencia evidencia={e} />
        </li>
      ))}
    </ul>
  )
}

/** Rótulo à esquerda, valor à direita; no celular, um embaixo do outro. */
const GRADE = "grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1.5"
const ROTULO = "text-[12px] font-semibold text-muted-foreground sm:text-sm"
const VALOR = "mb-1.5 min-w-0 break-words text-foreground sm:mb-0"

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
          // Edição do robô vem sem `antes`: mostra o estado gravado, sem "— → valor".
          const comoDiff = item.acao === "editar" && !semEstadoAnterior(item)
          const alteracoes = comoDiff ? camposAlterados(item) : []
          const snapshot = comoDiff ? [] : camposSnapshot(item).filter(c => c.valor !== "—")
          const temDetalhe = alteracoes.length > 0 || snapshot.length > 0 || !!item.motivo
          const resumo = resumoDaLinha(item)
          // Aberto, o detalhe diz tudo e a linha curta só repetiria. A do robô é
          // uma frase que o detalhe não tem, então fica.
          const mostrarResumo = !!resumo && (!expandido || item.ator === "robo" || item.acao === "reverter")
          return (
            <div key={item.id} className="rounded-lg border border-border px-2.5 py-2">
              <button
                type="button"
                onClick={() => temDetalhe && setExpandidoId(expandido ? null : item.id)}
                aria-expanded={temDetalhe ? expandido : undefined}
                className={`flex w-full items-start gap-2 text-left ${temDetalhe ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className="mt-0.5 w-3.5 shrink-0 text-muted-foreground">
                  {temDetalhe && (expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone.bg} ${tone.text}`}>{ACAO_LABEL[item.acao]}</span>
                    <ChipOrigem origem={item.ator === "robo" ? "robo" : "humano"} />
                    <span className="text-[11px] font-semibold text-muted-foreground">{TABELA_LABEL[item.tabela]}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">{nomeContextual(item, catalogo)}</span>
                  {mostrarResumo && (
                    <span className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{resumo}</span>
                  )}
                </span>
                <span className="max-w-[40%] shrink-0 text-right text-[11px] leading-snug text-muted-foreground">
                  <span className="block">{item.usuario_nome ?? "Usuário desconhecido"}</span>
                  <span className="block tabular-nums">{formatarDataHora(item)}</span>
                </span>
              </button>
              {expandido && (
                <div className="mt-2 border-t border-border pt-2 sm:pl-[22px]">
                  {alteracoes.length === 0 && snapshot.length === 0 && !item.motivo && (
                    <div className="text-sm text-muted-foreground">Nenhum outro detalhe registrado pra essa alteração.</div>
                  )}
                  {alteracoes.length > 0 && (
                    <dl className={GRADE}>
                      {alteracoes.map(c => (
                        <div key={c.campo} className="contents">
                          <dt className={ROTULO}>{c.label}</dt>
                          <dd className={VALOR}>
                            {c.campo === "evidencias" ? (
                              <DiffEvidencias antes={c.antesBruto} depois={c.depoisBruto} />
                            ) : (
                              <>
                                <span className="text-muted-foreground line-through">{c.antes}</span>
                                <span className="mx-1.5 text-muted-foreground" aria-label="passou a ser">→</span>
                                <span className="font-semibold">{c.depois}</span>
                              </>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {snapshot.length > 0 && (
                    <dl className={GRADE}>
                      {snapshot.map(c => (
                        <div key={c.campo} className="contents">
                          <dt className={ROTULO}>{c.label}</dt>
                          <dd className={VALOR}>
                            {c.campo === "evidencias" ? <ListaEvidencias valor={c.valorBruto} /> : c.valor}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {item.motivo && (
                    <dl className={`${GRADE} mt-1.5`}>
                      <dt className={ROTULO}>Motivo</dt>
                      <dd className={VALOR}>{item.motivo}</dd>
                    </dl>
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