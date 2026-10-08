"use client"

import { useEffect, useState } from "react"
import { CalendarPlus, CloudDownload, Lock, LockOpen, Repeat, Trash2, UserRoundX, type LucideIcon } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { tom, type Tom } from "@/components/ui/pastel/pecas"
import { hojeBrasilia, somarDias } from "@/lib/disponibilidadeProfissional"
import { listarEventos } from "@/services/grade.service"
import type { AcaoEventoGrade, EventoGrade } from "@/types/grade"

// Registro de alterações da Grade: tudo o que foi criado, excluído, bloqueado e
// importado — por quem, quando e por quê. É a "lixeira auditável": nada some,
// a exclusão fica aqui com o nome de quem fez.

const ACAO: Record<AcaoEventoGrade, { t: Tom; Icone: LucideIcon; rotulo: string }> = {
  criado: { t: "verde", Icone: CalendarPlus, rotulo: "Criado" },
  excluido: { t: "vermelho", Icone: Trash2, rotulo: "Excluído" },
  serie_encerrada: { t: "vermelho", Icone: Repeat, rotulo: "Série encerrada" },
  estendido: { t: "cinza", Icone: Repeat, rotulo: "Repetição automática" },
  importado: { t: "violeta", Icone: CloudDownload, rotulo: "Importado do TiTa" },
  bloqueio_criado: { t: "cinza", Icone: Lock, rotulo: "Bloqueio" },
  bloqueio_excluido: { t: "aco", Icone: LockOpen, rotulo: "Bloqueio removido" },
  inativacao_profissional: { t: "amber", Icone: UserRoundX, rotulo: "Profissional inativado" },
}

const FILTROS: { chave: string; rotulo: string; acoes: AcaoEventoGrade[]; t: Tom }[] = [
  { chave: "criado", rotulo: "Criações", acoes: ["criado"], t: "verde" },
  { chave: "excluido", rotulo: "Exclusões", acoes: ["excluido", "serie_encerrada", "inativacao_profissional"], t: "vermelho" },
  { chave: "bloqueio", rotulo: "Bloqueios", acoes: ["bloqueio_criado", "bloqueio_excluido"], t: "cinza" },
  { chave: "importado", rotulo: "Importações", acoes: ["importado"], t: "violeta" },
]

export function ListaEventos({ eventos, vazio }: { eventos: EventoGrade[]; vazio: string }) {
  if (!eventos.length) return <p className="rounded-xl bg-[var(--pp-muted)] px-3 py-4 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">{vazio}</p>
  return (
    <ol className="space-y-2">
      {eventos.map(e => {
        const cfg = ACAO[e.acao] ?? ACAO.criado
        return (
          <li key={e.id} className="flex gap-3 rounded-[14px] bg-[var(--pp-surface)] p-3 shadow-[inset_0_0_0_1px_var(--pp-border)]">
            <span className={`${tom(cfg.t)} flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--c)] text-[var(--c-sobre)]`} aria-hidden>
              <cfg.Icone className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{e.resumo}</p>
              <p className="mt-1 text-[11px] font-medium text-[var(--pp-ink-muted)]">
                {cfg.rotulo} · {e.feito_por_nome ?? "—"} · {e.feito_em_brasilia ?? e.feito_em.slice(0, 16).replace("T", " ")}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function PainelRegistro({
  onFechar, profissional, paciente,
}: {
  onFechar: () => void
  /** Pessoa em foco na tela: oferece "só desta pessoa". */
  profissional?: { id: number; nome: string } | null
  paciente?: { id: number; nome: string } | null
}) {
  const hoje = hojeBrasilia()
  const [periodo, setPeriodo] = useState({ inicio: somarDias(hoje, -30), fim: hoje })
  const [filtro, setFiltro] = useState<string | null>(null)
  const [soPessoa, setSoPessoa] = useState(false)
  // Resultado guardado com a chave da consulta: enquanto a chave atual não
  // chega, a lista mostra "Carregando…" (sem setState síncrono no efeito).
  const chave = JSON.stringify([periodo, filtro, soPessoa, profissional?.id, paciente?.id])
  const [lido, setLido] = useState<{ chave: string; eventos: EventoGrade[]; erro: string | null } | null>(null)

  useEffect(() => {
    let vivo = true
    listarEventos({
      de: periodo.inicio, ate: periodo.fim,
      acoes: FILTROS.find(f => f.chave === filtro)?.acoes,
      profissionalId: soPessoa ? profissional?.id ?? null : null,
      pacienteId: soPessoa ? paciente?.id ?? null : null,
    })
      .then(r => { if (vivo) setLido({ chave, eventos: r, erro: null }) })
      .catch(e => { if (vivo) setLido({ chave, eventos: [], erro: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [chave, periodo, filtro, soPessoa, profissional?.id, paciente?.id])
  const eventos = lido?.chave === chave ? lido.eventos : null
  const erro = lido?.chave === chave ? lido.erro : null

  const pessoa = profissional ?? paciente ?? null

  return (
    <Drawer title="Registro de alterações" subtitle="Quem criou, excluiu, bloqueou ou importou — e por quê." width={520} onClose={onFechar}>
      <div className="pp space-y-4">
        <DateRangePicker inicio={periodo.inicio} fim={periodo.fim} onChange={setPeriodo} />
        <div className="flex flex-wrap gap-2">
          {FILTROS.map(f => (
            <button key={f.chave} type="button" aria-pressed={filtro === f.chave} onClick={() => setFiltro(v => (v === f.chave ? null : f.chave))}
              className={`${tom(f.t)} pp-pilula min-h-11 pl-3`}>{f.rotulo}</button>
          ))}
          {pessoa && (
            <button type="button" aria-pressed={soPessoa} onClick={() => setSoPessoa(v => !v)} className={`${tom("aco")} pp-pilula min-h-11 pl-3`}>
              Só {pessoa.nome.split(" ")[0]}
            </button>
          )}
        </div>
        {erro && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-400">{erro}</p>}
        {eventos === null
          ? <p className="text-sm text-[var(--pp-ink-muted)]">Carregando…</p>
          : <ListaEventos eventos={eventos} vazio="Nada registrado neste período." />}
        {eventos && eventos.length >= 300 && (
          <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">Mostrando os 300 mais recentes — encurte o período para ver os outros.</p>
        )}
      </div>
    </Drawer>
  )
}
