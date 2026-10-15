"use client"

// OcupacaoDetalheModal — drill-down de auditoria dos StatCards "Manhã/Tarde
// X/Y ocupados" (Dashboard por Unidade, binário) e "X/Y preenchidos" (Ocupação
// Real, granular) em UnidadeDashboardShell.tsx. Mesma fonte de dados de
// /relacionamento-prestador/ocupacao-salas/ (calcularOcupacaoDaSala, lib/cronograma/salas.ts)
// — aqui só lemos as linhas já "achatadas" por listarSlotsDetalhados/
// listarBlocosDetalhados, sem recalcular nada.
//
// Estrutura de tabela inspirada em PrevisaoReceitasShell.tsx ("Por sessão"):
// SortableTh/ordenarPor, container com scroll e header sticky.

import { useMemo, useState } from "react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { SortableTh, compararValores, type SortDir } from "@/components/cronograma/ui/SortableTh"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import type { SlotDetalhado, BlocoDetalhado } from "@/lib/cronograma/salasTypes"

export type DetalheOcupacao =
  | { tipo: "slot"; unidade: string; turno: "Manhã" | "Tarde"; linhas: SlotDetalhado[] }
  | { tipo: "bloco"; unidade: string; turno: "Manhã" | "Tarde"; linhas: BlocoDetalhado[] }

interface OcupacaoDetalheModalProps {
  detalhe: DetalheOcupacao
  /** Para abrir por cima de um painel lateral já aberto (Z_MODAL_EMPILHADO). */
  zIndex?: number
  onClose: () => void
}

type FiltroOcupacao = "todos" | "ocupados" | "livres"

function ehOcupadoSlot(l: SlotDetalhado): boolean {
  return l.status === "ocupado" || l.status === "parcial"
}

// Ordena "Sala 2" antes de "Sala 10" — comparação alfabética pura (usada por
// ordenarPor/compararValores) trata "10" < "2" porque compara caractere a
// caractere. Extrai o número e ordena por ele; sem número (ex.: "Sala
// Ambiente comum"), vai pro final.
function extrairNumeroSala(sala: string): number {
  const m = sala.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : Infinity
}

/**
 * Ordenação em 2 níveis: a coluna clicada é o critério principal, e a outra
 * dimensão (sala ↔ dia/horário) entra automaticamente como desempate — assim
 * clicar em "Sala" já agrupa por sala com os dias em ordem cronológica dentro
 * de cada grupo, sem precisar de uma segunda interação (shift+click etc.).
 */
function ordenarComDesempate<T extends Record<string, unknown>>(rows: T[], key: string, dir: SortDir): T[] {
  const desempates = ["salaOrdem", "ordem"].filter(k => k !== key)
  const chain: [string, SortDir][] = [[key, dir], ...desempates.map((k): [string, SortDir] => [k, "asc"])]
  return [...rows].sort((a, b) => {
    for (const [k, d] of chain) {
      const cmp = compararValores(a[k], b[k]) * (d === "asc" ? 1 : -1)
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

export function OcupacaoDetalheModal({ detalhe, zIndex, onClose }: OcupacaoDetalheModalProps) {
  const { tipo, unidade, turno } = detalhe

  // Chave de ordenação cronológica (dia, e horário quando existe) — string
  // lexicográfica funciona porque dow é 1 dígito (1-5) seguido de "HH:MM"
  // zero-padded, então a ordem alfabética já bate com a ordem real.
  const linhasCalc = useMemo(() => {
    if (tipo === "slot") {
      return detalhe.linhas.map(l => ({ ...l, ordem: `${l.dow}`, salaOrdem: extrairNumeroSala(l.sala), ocupado: ehOcupadoSlot(l) }))
    }
    return detalhe.linhas.map(l => ({ ...l, ordem: `${l.dow}${l.hora}`, salaOrdem: extrairNumeroSala(l.sala), ocupado: l.status === "preenchido" }))
  }, [tipo, detalhe.linhas])

  const total = linhasCalc.length
  const ocupados = linhasCalc.filter(l => l.ocupado).length
  const livres = total - ocupados

  const [filtro, setFiltro] = useState<FiltroOcupacao>("todos")
  // Padrão inicial: agrupado por Sala (com Dia/Horário como desempate) — mais
  // útil pra auditoria "sala por sala" do que abrir já agrupado por dia.
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "salaOrdem", dir: "asc" })

  const linhasFiltradas = useMemo(() => {
    if (filtro === "ocupados") return linhasCalc.filter(l => l.ocupado)
    if (filtro === "livres") return linhasCalc.filter(l => !l.ocupado)
    return linhasCalc
  }, [linhasCalc, filtro])

  const linhasOrdenadas = useMemo(
    () => ordenarComDesempate(linhasFiltradas, sort.key, sort.dir),
    [linhasFiltradas, sort.key, sort.dir],
  )

  function onSortClick(key: string) {
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }))
  }

  const rotuloOcupado = tipo === "slot" ? "Ocupados" : "Preenchidos"

  return (
    <ScheduleModal
      title={`${unidade} — ${turno} — ${tipo === "slot" ? "Slots ocupados" : "Blocos preenchidos"}`}
      subtitle={`${ocupados} ${rotuloOcupado.toLowerCase()} de ${total} · ${livres} livres — mesmos dados de /relacionamento-prestador/ocupacao-salas/`}
      maxWidth={1360}
      zIndex={zIndex}
      onClose={onClose}
    >
      <div className="mb-3">
        <SegmentedTabs
          value={filtro}
          onChange={setFiltro}
          tabs={[
            { value: "todos", label: "Todos", count: total },
            { value: "ocupados", label: rotuloOcupado, count: ocupados },
            { value: "livres", label: "Livres", count: livres },
          ]}
        />
      </div>

      <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-muted-foreground">
              <SortableTh label="Sala" sortKey="salaOrdem" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
              <SortableTh label="Dia" sortKey="ordem" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
              {tipo === "bloco" && (
                <SortableTh label="Horário" sortKey="hora" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
              )}
              <SortableTh label="Status" sortKey="status" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
              {tipo === "bloco" ? (
                <>
                  <SortableTh label="Profissional" sortKey="profissional" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
                  <SortableTh label="Especialidade" sortKey="terapia" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
                  <SortableTh label="ID Agend." sortKey="idAgendamento" activeKey={sort.key} dir={sort.dir} align="right" onClick={onSortClick} />
                </>
              ) : (
                <>
                  <th className="py-1.5 px-2 font-semibold">Profissional</th>
                  <th className="py-1.5 px-2 font-semibold">Especialidade</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Sessões</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.length === 0 && (
              <tr><td colSpan={tipo === "bloco" ? 7 : 6} className="py-4 text-center text-muted-foreground">Nenhuma linha nesse filtro.</td></tr>
            )}
            {tipo === "slot"
              ? (linhasOrdenadas as (SlotDetalhado & { ordem: string; ocupado: boolean })[]).map((l, i) => (
                <tr key={`${l.sala}-${l.dow}-${i}`} className="border-t border-border/40">
                  <td className="py-1.5 pr-2 font-medium text-foreground whitespace-nowrap">{l.sala}</td>
                  <td className="py-1.5 px-2 whitespace-nowrap">{l.diaLabel}</td>
                  <td className="py-1.5 px-2">
                    <StatusPill tone={l.status === "ocupado" ? "green" : l.status === "parcial" ? "amber" : "slate"} dense>
                      {l.status === "ocupado" ? "Ocupado" : l.status === "parcial" ? "Parcial" : "Livre"}
                    </StatusPill>
                  </td>
                  <td className="py-1.5 px-2 text-muted-foreground">
                    {l.alocacoes.length === 0
                      ? "—"
                      : l.alocacoes.map((a, idx) => <div key={idx} className="whitespace-nowrap">{a.profissional}</div>)}
                  </td>
                  <td className="py-1.5 px-2 text-muted-foreground">
                    {l.alocacoes.length === 0
                      ? "—"
                      : l.alocacoes.map((a, idx) => <div key={idx} className="whitespace-nowrap">{a.terapia ?? "—"}</div>)}
                  </td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    {l.alocacoes.length === 0
                      ? "—"
                      : l.alocacoes.map((a, idx) => <div key={idx}>{a.sessoesReais}/{a.sessoesCapacidadeTurno}</div>)}
                  </td>
                </tr>
              ))
              : (linhasOrdenadas as (BlocoDetalhado & { ordem: string; ocupado: boolean })[]).map((l, i) => (
                <tr key={`${l.sala}-${l.dow}-${l.hora}-${i}`} className="border-t border-border/40">
                  <td className="py-1.5 pr-2 font-medium text-foreground whitespace-nowrap">{l.sala}</td>
                  <td className="py-1.5 px-2 whitespace-nowrap">{l.diaLabel}</td>
                  <td className="py-1.5 px-2 whitespace-nowrap text-muted-foreground">{l.hora}–{l.horaFim}</td>
                  <td className="py-1.5 px-2">
                    <StatusPill tone={l.status === "preenchido" ? "green" : "slate"} dense>
                      {l.status === "preenchido" ? "Preenchido" : "Livre"}
                    </StatusPill>
                  </td>
                  <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{l.profissional ?? "—"}</td>
                  <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{l.terapia ?? "—"}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">{l.idAgendamento ?? "—"}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </ScheduleModal>
  )
}
