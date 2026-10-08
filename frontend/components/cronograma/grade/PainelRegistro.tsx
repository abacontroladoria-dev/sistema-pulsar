"use client"

import { useEffect, useState } from "react"
import { CalendarPlus, CloudDownload, Lock, LockOpen, Repeat, Trash2, UserRoundX, type LucideIcon } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { hojeBrasilia, somarDias } from "@/lib/disponibilidadeProfissional"
import { listarEventos } from "@/services/grade.service"
import type { AcaoEventoGrade, EventoGrade } from "@/types/grade"
import { opcaoForm } from "./estilo"

// Registro de alterações da Grade: tudo o que foi criado, excluído, bloqueado e
// importado — por quem, quando e por quê. É a "lixeira auditável": nada some,
// a exclusão fica aqui com o nome de quem fez.

/** Cor só no ícone (texto), sobre o quadrado cinza — a ação também vem escrita no rodapé. */
const ACAO: Record<AcaoEventoGrade, { cor: string; Icone: LucideIcon; rotulo: string }> = {
  criado: { cor: "text-emerald-700 dark:text-emerald-400", Icone: CalendarPlus, rotulo: "Criado" },
  excluido: { cor: "text-rose-700 dark:text-rose-400", Icone: Trash2, rotulo: "Excluído" },
  serie_encerrada: { cor: "text-rose-700 dark:text-rose-400", Icone: Repeat, rotulo: "Série encerrada" },
  estendido: { cor: "text-muted-foreground", Icone: Repeat, rotulo: "Repetição automática" },
  importado: { cor: "text-violet-700 dark:text-violet-400", Icone: CloudDownload, rotulo: "Importado do TiTa" },
  bloqueio_criado: { cor: "text-muted-foreground", Icone: Lock, rotulo: "Bloqueio" },
  bloqueio_excluido: { cor: "text-muted-foreground", Icone: LockOpen, rotulo: "Bloqueio removido" },
  inativacao_profissional: { cor: "text-amber-700 dark:text-amber-400", Icone: UserRoundX, rotulo: "Profissional inativado" },
}

const FILTROS: { chave: string; rotulo: string; acoes: AcaoEventoGrade[] }[] = [
  { chave: "criado", rotulo: "Criações", acoes: ["criado"] },
  { chave: "excluido", rotulo: "Exclusões", acoes: ["excluido", "serie_encerrada", "inativacao_profissional"] },
  { chave: "bloqueio", rotulo: "Bloqueios", acoes: ["bloqueio_criado", "bloqueio_excluido"] },
  { chave: "importado", rotulo: "Importações", acoes: ["importado"] },
]

export function ListaEventos({ eventos, vazio }: { eventos: EventoGrade[]; vazio: string }) {
  if (!eventos.length) return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{vazio}</p>
  return (
    <ol className="divide-y divide-border rounded-lg border border-border">
      {eventos.map(e => {
        const cfg = ACAO[e.acao] ?? ACAO.criado
        return (
          <li key={e.id} className="flex gap-3 p-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted ${cfg.cor}`} aria-hidden>
              <cfg.Icone className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-foreground">{e.resumo}</p>
              <p className="mt-1 text-xs text-muted-foreground">
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
      <div className="space-y-4">
        <DateRangePicker inicio={periodo.inicio} fim={periodo.fim} onChange={setPeriodo} />
        <div className="flex flex-wrap gap-2">
          {FILTROS.map(f => (
            <button key={f.chave} type="button" aria-pressed={filtro === f.chave} onClick={() => setFiltro(v => (v === f.chave ? null : f.chave))}
              className={opcaoForm(filtro === f.chave)}>{f.rotulo}</button>
          ))}
          {pessoa && (
            <button type="button" aria-pressed={soPessoa} onClick={() => setSoPessoa(v => !v)} className={opcaoForm(soPessoa)}>
              Só {pessoa.nome.split(" ")[0]}
            </button>
          )}
        </div>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        {eventos === null
          ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : <ListaEventos eventos={eventos} vazio="Nada registrado neste período." />}
        {eventos && eventos.length >= 300 && (
          <p className="text-xs text-muted-foreground">Mostrando os 300 mais recentes — encurte o período para ver os outros.</p>
        )}
      </div>
    </Drawer>
  )
}
