"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Search,
  UserCheck,
  UserPlus,
} from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import type { PacienteImportacaoLog } from "@/types/pacienteImportacao"

interface ModalDetalheImportacaoProps {
  log: PacienteImportacaoLog | null
  historico?: PacienteImportacaoLog[]
  onClose: () => void
}

function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function ModalDetalheImportacao({
  log,
  historico = [],
  onClose,
}: ModalDetalheImportacaoProps) {
  const [logSelecionado, setLogSelecionado] = useState<PacienteImportacaoLog | null>(log)
  const ativo = logSelecionado ?? log

  const novos = useMemo(() => ativo?.detalhes?.novos ?? [], [ativo])
  const atualizados = useMemo(() => ativo?.detalhes?.atualizados ?? [], [ativo])

  const [aba, setAba] = useState<"mudancas" | "historico">("mudancas")

  // Estado das seções: por padrão vêm ENXUTAS (fechadas). Abrem com 1 clique.
  const [secaoNovosAberta, setSecaoNovosAberta] = useState(false)
  const [secaoAtualizadosAberta, setSecaoAtualizadosAberta] = useState(false)
  const [buscaNovos, setBuscaNovos] = useState("")
  const [buscaAtualizados, setBuscaAtualizados] = useState("")

  const novosFiltrados = useMemo(() => {
    const termo = buscaNovos.trim().toLowerCase()
    if (!termo) return novos
    return novos.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        (p.cpf && p.cpf.includes(termo)) ||
        (p.tita_id && String(p.tita_id).includes(termo))
    )
  }, [novos, buscaNovos])

  const atualizadosFiltrados = useMemo(() => {
    const termo = buscaAtualizados.trim().toLowerCase()
    if (!termo) return atualizados
    return atualizados.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        (p.tita_id && String(p.tita_id).includes(termo)) ||
        p.campos.some((c) => c.toLowerCase().includes(termo)) ||
        p.mudancas?.some(
          (m) =>
            m.campo.toLowerCase().includes(termo) ||
            (m.para && m.para.toLowerCase().includes(termo))
        )
    )
  }, [atualizados, buscaAtualizados])

  return (
    <Drawer
      title="Sincronização do TiTa"
      subtitle="Detalhes das alterações trazidas da cópia da agenda do TiTa."
      width="min(560px, 95vw)"
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 p-5">
        {/* Abas internas do Drawer */}
        <div className="flex border-b border-border text-sm font-medium">
          <button
            type="button"
            onClick={() => setAba("mudancas")}
            className={`border-b-2 px-3 pb-2.5 transition-colors ${
              aba === "mudancas"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Última Execução
          </button>
          <button
            type="button"
            onClick={() => setAba("historico")}
            className={`border-b-2 px-3 pb-2.5 transition-colors ${
              aba === "historico"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Histórico ({historico.length})
          </button>
        </div>

        {aba === "historico" ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Selecione uma rodada para inspecionar as alterações registradas:
            </p>
            {historico.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Nenhuma execução anterior encontrada no registro.
              </p>
            ) : (
              historico.map((h) => {
                const isSelected = h.id === ativo?.id
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setLogSelecionado(h)
                      setAba("mudancas")
                      setSecaoNovosAberta(false)
                      setSecaoAtualizadosAberta(false)
                    }}
                    className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        {h.status === "sucesso" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        )}
                        {formatarDataHora(h.iniciado_em)}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {h.origem === "cron" ? "Automático (04:00)" : "Manual"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{h.novos} novo{h.novos === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{h.atualizados} atualizado{h.atualizados === 1 ? "" : "s"}</span>
                      {h.vinculados_por_cpf > 0 && (
                        <>
                          <span>·</span>
                          <span>{h.vinculados_por_cpf} por CPF</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        ) : !ativo ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <History className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Nenhuma importação registrada</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              A importação é executada automaticamente todos os dias às 04:00 ou pode ser disparada pelo botão &quot;Atualizar (import. do TiTa)&quot;.
            </p>
          </div>
        ) : (
          <>
            {/* Status & Resumo da Execução */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    {ativo.status === "sucesso" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Sucesso
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" /> Falhou
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {ativo.origem === "cron" ? "Automático (rotina 04:00)" : "Disparo manual"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatarDataHora(ativo.iniciado_em)}
                    {ativo.usuario_nome && ` · por ${ativo.usuario_nome}`}
                  </p>
                </div>
              </div>

              {ativo.erro_mensagem && (
                <InlineNotice tone="red" icon={<AlertCircle className="h-4 w-4" />}>
                  {ativo.erro_mensagem}
                </InlineNotice>
              )}

              {/* Grid de Métricas Clicáveis */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setSecaoNovosAberta((v) => !v)}
                  className={`rounded-lg p-2.5 text-center transition-all border ${
                    secaoNovosAberta
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                      : "border-transparent bg-muted/40 hover:bg-muted/70 text-foreground cursor-pointer"
                  }`}
                  title="Clique para abrir ou recolher a lista de novos pacientes"
                >
                  <div className="text-lg font-bold tabular-nums">{ativo.novos}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    Novos <span className="text-[10px]">{secaoNovosAberta ? "▲" : "▼"}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSecaoAtualizadosAberta((v) => !v)}
                  className={`rounded-lg p-2.5 text-center transition-all border ${
                    secaoAtualizadosAberta
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-transparent bg-muted/40 hover:bg-muted/70 text-foreground cursor-pointer"
                  }`}
                  title="Clique para abrir ou recolher a lista de cadastros alterados"
                >
                  <div className="text-lg font-bold tabular-nums">{ativo.atualizados}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    Alterados <span className="text-[10px]">{secaoAtualizadosAberta ? "▲" : "▼"}</span>
                  </div>
                </button>

                <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                  <div className="text-lg font-bold text-foreground tabular-nums">{ativo.vistos_na_tita}</div>
                  <div className="text-[11px] text-muted-foreground">No TiTa</div>
                </div>
              </div>
            </div>

            {/* Seção Sanfona: Novos Pacientes (Enxuto por padrão) */}
            <div className="rounded-xl border border-border bg-card overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setSecaoNovosAberta((v) => !v)}
                className="flex w-full items-center justify-between p-3.5 text-left hover:bg-muted/40 transition-colors"
                aria-expanded={secaoNovosAberta}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Novos Pacientes
                      </span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {novos.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {secaoNovosAberta ? "Toque para fechar a lista" : "Toque para abrir e ver os nomes"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="text-[11px] font-medium hidden sm:inline">
                    {secaoNovosAberta ? "Recolher" : "Ver lista"}
                  </span>
                  {secaoNovosAberta ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
              </button>

              {secaoNovosAberta && (
                <div className="border-t border-border/70 p-3 space-y-2.5 bg-muted/10">
                  {novos.length > 5 && (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={buscaNovos}
                        onChange={(e) => setBuscaNovos(e.target.value)}
                        placeholder="Buscar paciente novo..."
                        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  {novosFiltrados.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-xs text-muted-foreground">
                      {buscaNovos ? "Nenhum paciente encontrado na busca." : "Nenhum paciente novo adicionado nesta rodada."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60 rounded-lg border border-border bg-card max-h-80 overflow-y-auto">
                      {novosFiltrados.map((pac) => (
                        <li key={pac.id} className="flex items-center justify-between p-3 text-xs hover:bg-muted/30 transition-colors">
                          <div className="min-w-0 pr-2">
                            <Link
                              href={`/cadastros/pacientes/${pac.id}`}
                              className="font-medium text-foreground hover:text-primary hover:underline flex items-center gap-1"
                              onClick={onClose}
                            >
                              <span className="truncate">{pac.nome}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </Link>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              ID TiTa {pac.tita_id ?? "—"} {pac.cpf ? `· CPF ${pac.cpf}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Novo
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Seção Sanfona: Cadastros com Dados Alterados (Enxuto por padrão) */}
            <div className="rounded-xl border border-border bg-card overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setSecaoAtualizadosAberta((v) => !v)}
                className="flex w-full items-center justify-between p-3.5 text-left hover:bg-muted/40 transition-colors"
                aria-expanded={secaoAtualizadosAberta}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Dados Alterados
                      </span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {atualizados.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {secaoAtualizadosAberta ? "Toque para fechar a lista" : "Toque para ver o que mudou em cada um"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="text-[11px] font-medium hidden sm:inline">
                    {secaoAtualizadosAberta ? "Recolher" : "Ver lista"}
                  </span>
                  {secaoAtualizadosAberta ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
              </button>

              {secaoAtualizadosAberta && (
                <div className="border-t border-border/70 p-3 space-y-2.5 bg-muted/10">
                  {atualizados.length > 5 && (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={buscaAtualizados}
                        onChange={(e) => setBuscaAtualizados(e.target.value)}
                        placeholder="Buscar paciente ou campo alterado..."
                        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  {atualizadosFiltrados.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-xs text-muted-foreground">
                      {buscaAtualizados ? "Nenhum paciente encontrado na busca." : "Nenhum dado alterado nesta rodada."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60 rounded-lg border border-border bg-card max-h-80 overflow-y-auto">
                      {atualizadosFiltrados.map((pac) => (
                        <li key={pac.id} className="p-3 text-xs space-y-1.5 hover:bg-muted/30 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/cadastros/pacientes/${pac.id}`}
                              className="font-medium text-foreground hover:text-primary hover:underline flex items-center gap-1"
                              onClick={onClose}
                            >
                              <span className="truncate">{pac.nome}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </Link>
                            {pac.tita_id && (
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                ID TiTa {pac.tita_id}
                              </span>
                            )}
                          </div>
                          {pac.mudancas && pac.mudancas.length > 0 ? (
                            <div className="mt-1 space-y-1 rounded bg-muted/40 p-2">
                              {pac.mudancas.map((m, idx) => (
                                <div key={idx} className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="font-semibold text-foreground">{m.campo}:</span>
                                  {m.de ? (
                                    <>
                                      <span className="line-through opacity-70">{m.de}</span>
                                      <span className="text-primary font-bold">➔</span>
                                      <span className="font-medium text-foreground">{m.para}</span>
                                    </>
                                  ) : (
                                    <span className="font-medium text-primary">preenchido com {m.para}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {pac.campos.map((campoNome) => (
                                <span
                                  key={campoNome}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  +{campoNome}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
