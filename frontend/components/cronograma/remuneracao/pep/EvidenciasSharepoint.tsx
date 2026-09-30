"use client"

import { useMemo, useState } from "react"
import { Check, ExternalLink, FileText, Loader2, X } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import type { PepCatalogoItem } from "@/types/pep"
import type { SpItem } from "@/types/roboSharepoint"

// O que o robô encontrou no SharePoint para este analista neste mês. O robô só
// SUGERE: nada entra na PEP sem este clique. Confirmar grava pelo mesmo caminho
// do painel manual (upsertRegistroEntrega → trilha de auditoria, bloqueio de
// mês liberado), só que com a evidência já preenchida com o link do arquivo.

export type AvaliacaoSugestao = { pode: true } | { pode: false; motivo: string }

function dataBR(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

export function EvidenciasSharepoint({ itens, catalogo, avaliar, onConfirmar, onIgnorar }: {
  itens: SpItem[]
  catalogo: PepCatalogoItem[]
  avaliar: (item: SpItem) => AvaliacaoSugestao
  onConfirmar: (item: SpItem) => Promise<boolean>
  onIgnorar: (item: SpItem) => Promise<boolean>
}) {
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const pendentes = useMemo(() => itens.filter(i => i.status === "sugerido"), [itens])
  const confirmados = useMemo(() => itens.filter(i => i.status === "confirmado"), [itens])
  const itemPorId = useMemo(() => new Map(catalogo.map(c => [c.id, c])), [catalogo])

  if (itens.length === 0) return null

  async function agir(i: SpItem, fn: (i: SpItem) => Promise<boolean>) {
    setOcupado(i.sp_id)
    try { await fn(i) } finally { setOcupado(null) }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <FileText size={16} className="text-blue-700 dark:text-blue-400" aria-hidden />
          <span className="font-semibold text-foreground">Evidências do SharePoint</span>
          <span className="text-muted-foreground">
            {pendentes.length > 0
              ? `${pendentes.length} arquivo(s) esperando confirmação`
              : "tudo confirmado"}
            {confirmados.length > 0 && ` · ${confirmados.length} já confirmado(s)`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          Revisar
        </button>
      </div>

      {aberto && (
        <Drawer
          title="Evidências do SharePoint"
          subtitle="Encontradas pelo robô. Confirme para registrar a entrega com o link do arquivo."
          width={520}
          onClose={() => setAberto(false)}
        >
          <ul className="space-y-3">
            {[...pendentes, ...confirmados].map(i => {
              const cat = i.item_id ? itemPorId.get(i.item_id) : undefined
              const av = i.status === "sugerido" ? avaliar(i) : null
              return (
                <li key={i.sp_id} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {cat?.sigla ?? i.sigla} · {i.paciente_nome ?? "Geral (sem paciente)"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={i.nome}>{i.nome}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Enviado em {dataBR(i.criado_em_sp)}{i.criado_por ? ` por ${i.criado_por}` : ""}
                        {i.competencia_fonte === "nome" ? " · mês lido do nome do arquivo" : ""}
                      </p>
                    </div>
                    {i.web_url && (
                      <a href={i.web_url} target="_blank" rel="noreferrer"
                        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40">
                        Abrir <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>

                  {i.status === "confirmado" ? (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      <Check size={12} aria-hidden /> Confirmado{i.resolvido_por_nome ? ` por ${i.resolvido_por_nome}` : ""}
                      {i.removido_em ? " · arquivo removido do SharePoint depois" : ""}
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!av?.pode || ocupado === i.sp_id}
                        onClick={() => agir(i, onConfirmar)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {ocupado === i.sp_id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
                        Confirmar entrega
                      </button>
                      <button
                        type="button"
                        disabled={ocupado === i.sp_id}
                        onClick={() => agir(i, onIgnorar)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                      >
                        <X size={14} aria-hidden /> Ignorar
                      </button>
                      {av && !av.pode && <p className="w-full text-xs text-amber-700 dark:text-amber-400">{av.motivo}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Drawer>
      )}
    </>
  )
}
