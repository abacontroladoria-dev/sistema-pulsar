"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Building2, ChevronDown, ChevronRight, History, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { useConvenios } from "@/hooks/useConvenios"
import {
  criarConvenio, atualizarConvenio, inativarConvenio, reativarConvenio,
  criarPlanoSaude, atualizarPlanoSaude, inativarPlanoSaude, reativarPlanoSaude,
} from "@/services/convenios.service"
import { ConvenioModal } from "./ConvenioModal"
import { PlanoSaudeModal } from "./PlanoSaudeModal"
import type { Convenio, ConvenioEdit, PlanoSaude } from "@/types/convenio"

export function ConveniosCadastro() {
  const { convenios, loading, error, recarregar } = useConvenios()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // Inativos saem da lista principal: eles não são escolha possível no select
  // da Ficha Médica, então misturá-los aos ativos só faz a lista de trabalho
  // crescer com o que não pode ser usado. Ficam num bloco próprio, recolhido.
  const ativos = convenios.filter(c => c.ativo)
  const inativos = convenios.filter(c => !c.ativo)
  const [inativosAbertos, setInativosAbertos] = useState(false)

  const [modalConvenio, setModalConvenio] = useState<{ convenio?: Convenio } | null>(null)
  const [modalPlano, setModalPlano] = useState<{ convenio: Convenio; plano?: PlanoSaude } | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  // ?convenio=ID — vindo da busca mestre: abre o convênio, rola até ele e o
  // contorna por alguns segundos. Lido do window, e não de useSearchParams, para
  // a página não precisar de Suspense.
  const [destacadoId, setDestacadoId] = useState<number | null>(null)

  useEffect(() => {
    if (loading) return
    const id = Number(new URLSearchParams(window.location.search).get("convenio"))
    const alvo = convenios.find(c => c.id === id)
    if (!alvo) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê a URL só depois de a lista carregar
    if (!alvo.ativo) setInativosAbertos(true)
    setExpandedIds(prev => new Set(prev).add(alvo.id))
    setDestacadoId(alvo.id)
    requestAnimationFrame(() =>
      document.getElementById(`convenio-${alvo.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
    )
    const t = setTimeout(() => setDestacadoId(null), 4000)
    return () => clearTimeout(t)
  }, [loading, convenios])

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSalvarConvenio = async (input: ConvenioEdit) => {
    if (modalConvenio?.convenio) {
      await atualizarConvenio(modalConvenio.convenio.id, input)
      toast.success("Convênio atualizado.")
    } else {
      await criarConvenio(input)
      toast.success("Convênio criado.")
    }
    recarregar()
  }

  const handleInativarConvenio = async (convenio: Convenio) => {
    try {
      await inativarConvenio(convenio.id)
      toast.success(`Convênio "${convenio.nome}" inativado.`)
      recarregar()
    } catch (e: any) {
      toast.error(String(e?.message ?? e))
    }
  }

  const handleReativarConvenio = async (convenio: Convenio) => {
    try {
      await reativarConvenio(convenio.id)
      toast.success(`Convênio "${convenio.nome}" reativado.`)
      recarregar()
    } catch (e: any) {
      toast.error(String(e?.message ?? e))
    }
  }

  const handleSalvarPlano = async (nome: string, ativo: boolean) => {
    if (!modalPlano) return
    if (modalPlano.plano) {
      await atualizarPlanoSaude(modalPlano.plano.id, { nome })
      if (ativo !== modalPlano.plano.ativo) {
        if (ativo) await reativarPlanoSaude(modalPlano.plano.id)
        else await inativarPlanoSaude(modalPlano.plano.id)
      }
      toast.success("Plano atualizado.")
    } else {
      await criarPlanoSaude({ convenio_id: modalPlano.convenio.id, nome })
      toast.success("Plano criado.")
    }
    recarregar()
  }

  const handleInativarPlano = async (plano: PlanoSaude) => {
    try {
      await inativarPlanoSaude(plano.id)
      toast.success(`Plano "${plano.nome}" inativado.`)
      recarregar()
    } catch (e: any) {
      toast.error(String(e?.message ?? e))
    }
  }

  const handleReativarPlano = async (plano: PlanoSaude) => {
    try {
      await reativarPlanoSaude(plano.id)
      toast.success(`Plano "${plano.nome}" reativado.`)
      recarregar()
    } catch (e: any) {
      toast.error(String(e?.message ?? e))
    }
  }

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  if (error) {
    return <div className="p-8 text-center text-sm font-semibold text-red-600 dark:text-red-400">{error}</div>
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-4 animate-in fade-in duration-300">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-bold text-lg text-foreground">Convênios</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Convênios e seus planos, usados como fonte do campo Plano de saúde no Cadastro de Pacientes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setVerHistorico(true)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
          >
            <History className="w-4 h-4" /> Histórico
          </button>
          <button
            onClick={() => setModalConvenio({})}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold text-white shadow-sm transition-all bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Plus className="w-4 h-4" /> Criar Convênio
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
        {ativos.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
            <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <p>{inativos.length > 0 ? "Nenhum convênio ativo." : "Nenhum convênio cadastrado."}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ativos.map(c => {
              const expandido = expandedIds.has(c.id)
              return (
                <div key={c.id} id={`convenio-${c.id}`} className={`rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-shadow ${destacadoId === c.id ? "ring-2 ring-sidebar-primary" : ""}`}>
                  <div className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <button
                      type="button"
                      onClick={() => toggleExpand(c.id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      {expandido ? <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" /> : <ChevronRight className="w-4 h-4 shrink-0 text-slate-400" />}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          {c.nome}
                          {!c.ativo && (
                            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              Inativo
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {[c.cnpj, c.ans, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "—"}
                          {" · "}{c.planos.length} plano{c.planos.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setModalConvenio({ convenio: c })}
                        title="Editar convênio"
                        className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {c.ativo ? (
                        <button
                          onClick={() => handleInativarConvenio(c)}
                          title="Inativar convênio"
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReativarConvenio(c)}
                          title="Reativar convênio"
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expandido && (
                    <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 px-3 py-2 pl-9 space-y-1">
                      {c.planos.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400 py-2">Nenhum plano cadastrado.</p>
                      ) : (
                        c.planos.map(p => (
                          <div key={p.id} className="flex items-center justify-between py-1.5">
                            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
                              {p.nome}
                              {!p.ativo && (
                                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                  Inativo
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => setModalPlano({ convenio: c, plano: p })}
                                title="Editar plano"
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {p.ativo ? (
                                <button
                                  onClick={() => handleInativarPlano(p)}
                                  title="Inativar plano"
                                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleReativarPlano(p)}
                                  title="Reativar plano"
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      <button
                        onClick={() => setModalPlano({ convenio: c })}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white py-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Novo plano
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {inativos.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setInativosAbertos(a => !a)}
            aria-expanded={inativosAbertos}
            className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-amber-500/10 transition-colors"
          >
            {inativosAbertos
              ? <ChevronDown className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              : <ChevronRight className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />}
            <span className="font-bold text-amber-700 dark:text-amber-400">
              Convênios Inativos
            </span>
            <span className="text-sm text-amber-700/80 dark:text-amber-400/80">
              ({inativos.length})
            </span>
          </button>

          {inativosAbertos && (
            <div className="px-6 pb-6 space-y-2">
              <p className="text-sm text-amber-700/80 dark:text-amber-400/80 pb-1">
                Não aparecem no campo Plano de saúde do cadastro de pacientes. Reativar
                o convênio não reativa os planos — cada plano é reativado à parte.
              </p>
              {inativos.map(c => {
                const expandido = expandedIds.has(c.id)
                return (
                  <div key={c.id} id={`convenio-${c.id}`} className={`rounded-xl border border-amber-500/25 bg-white dark:bg-slate-900 overflow-hidden transition-shadow ${destacadoId === c.id ? "ring-2 ring-sidebar-primary" : ""}`}>
                    <div className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <button
                        type="button"
                        onClick={() => toggleExpand(c.id)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        {expandido
                          ? <ChevronDown className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          : <ChevronRight className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />}
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white">{c.nome}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {[c.cnpj, c.ans, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "—"}
                            {" · "}{c.planos.length} plano{c.planos.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setModalConvenio({ convenio: c })}
                          title="Editar convênio"
                          className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleReativarConvenio(c)}
                          title="Reativar convênio"
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {expandido && (
                      <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 px-3 py-2 pl-9 space-y-1">
                        {c.planos.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">Nenhum plano cadastrado.</p>
                        ) : (
                          c.planos.map(p => (
                            <div key={p.id} className="flex items-center justify-between py-1.5">
                              <span className="text-sm text-slate-700 dark:text-slate-300">{p.nome}</span>
                              {!p.ativo && (
                                <button
                                  onClick={() => handleReativarPlano(p)}
                                  title="Reativar plano"
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors shrink-0"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {modalConvenio && (
        <ConvenioModal
          convenio={modalConvenio.convenio}
          onSalvar={handleSalvarConvenio}
          onClose={() => setModalConvenio(null)}
        />
      )}

      {modalPlano && (
        <PlanoSaudeModal
          convenioNome={modalPlano.convenio.nome}
          plano={modalPlano.plano}
          onSalvar={handleSalvarPlano}
          onClose={() => setModalPlano(null)}
        />
      )}

      {verHistorico && (
        <HistoricoCadastrosModal
          subtitulo="Alterações em convênios e planos de saúde."
          entidades={["convenio", "plano_saude"]}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </div>
  )
}
