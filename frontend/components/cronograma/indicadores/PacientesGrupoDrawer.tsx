"use client"

// PacientesGrupoDrawer — "Ver pacientes" de uma linha das tabelas do Dashboard
// de Pacientes (convênio ou unidade). A lista sai de listarPacientesDoGrupo
// (lib/cronograma/pacientesDashboard.ts), com a MESMA chave do contador da
// tabela — o total listado aqui é sempre o número da coluna "Pacientes".

import { useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { Download, RefreshCw, Search } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { SortableTh, ordenarPor, type SortDir } from "@/components/cronograma/ui/SortableTh"
import { fmtHDec } from "@/lib/cronograma/helpers"
import { normTxt } from "@/lib/cronograma/constants"
import type { PacienteDoGrupo } from "@/lib/cronograma/salasTypes"

export interface GrupoSelecionado {
  segmentoLabel: string
  campo: "convenio" | "unidade"
  chave: string
}

type ChaveOrdem = "nome" | "sessoes" | "chSemanal"

export function PacientesGrupoDrawer({ grupo, pacientes, onClose }: {
  grupo: GrupoSelecionado
  pacientes: PacienteDoGrupo[]
  onClose: () => void
}) {
  const [busca, setBusca] = useState("")
  const [sort, setSort] = useState<{ key: ChaveOrdem; dir: SortDir }>({ key: "nome", dir: "asc" })
  const outraColuna = grupo.campo === "convenio" ? "Unidade" : "Convênio"

  const visiveis = useMemo(() => {
    const q = normTxt(busca)
    const filtrados = q
      ? pacientes.filter(p => normTxt(p.nome).includes(q) || p.ids.some(id => String(id).includes(q)))
      : pacientes
    return ordenarPor(filtrados, sort.key, sort.dir)
  }, [pacientes, busca, sort])

  const atualizados = pacientes.filter(p => p.atualizadoPeloCadastro).length

  function onSortClick(key: string) {
    setSort(prev => ({ key: key as ChaveOrdem, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }))
  }

  function exportar() {
    const linhas = pacientes.map(p => ({
      Segmento: grupo.segmentoLabel,
      [grupo.campo === "convenio" ? "Convenio" : "Unidade"]: grupo.chave,
      Paciente_ID: p.ids.join(", "),
      Paciente_Nome: p.nome,
      Sessoes: p.sessoes,
      CH_Semanal: +p.chSemanal.toFixed(2),
      Terapias: p.terapias.join(", "),
      [outraColuna === "Unidade" ? "Unidades" : "Convenios"]: p.outraDimensao.join(", "),
      Convenio_Agenda: p.conveniosAgenda.join(", "),
      Atualizado_Pelo_Cadastro: p.atualizadoPeloCadastro ? "sim" : "não",
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Pacientes")
    const nome = `Pacientes_${grupo.segmentoLabel}_${grupo.chave}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_]+/g, "_")
    XLSX.writeFile(wb, `${nome}.xlsx`)
  }

  return (
    <Drawer
      title={grupo.chave}
      subtitle={`${pacientes.length} ${pacientes.length === 1 ? "paciente" : "pacientes"} · ${grupo.segmentoLabel}${atualizados ? ` · ${atualizados} com convênio atualizado pelo cadastro` : ""}`}
      width="min(820px, 100vw)"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={exportar}
          disabled={!pacientes.length}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        >
          <Download size={13} /> Exportar lista (XLSX)
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar paciente ou ID..."
            aria-label="Buscar paciente"
            className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring"
          />
        </div>

        {busca && (
          <div className="text-[11px] text-muted-foreground">{visiveis.length} de {pacientes.length}</div>
        )}

        <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pl-3 pr-1 font-semibold tabular-nums">#</th>
                <SortableTh label="Paciente" sortKey="nome" activeKey={sort.key} dir={sort.dir} onClick={onSortClick} />
                <SortableTh label="Sessões" sortKey="sessoes" activeKey={sort.key} dir={sort.dir} align="right" onClick={onSortClick} />
                {/* Espaço inseparável: o rótulo não quebra em duas linhas (SortableTh é compartilhado, não muda). */}
                <SortableTh label={"CH semanal"} sortKey="chSemanal" activeKey={sort.key} dir={sort.dir} align="right" onClick={onSortClick} />
                <th className="py-1.5 px-2 font-semibold">Terapias</th>
                <th className="py-1.5 pl-2 pr-3 font-semibold">{outraColuna}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Nenhum paciente encontrado.</td></tr>
              )}
              {visiveis.map((p, i) => (
                <tr key={`${p.nome}-${p.ids.join("-")}`} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-1.5 pl-3 pr-1 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-medium text-foreground">{p.nome}</div>
                    {p.ids.length > 0 && <div className="text-[10px] tabular-nums text-muted-foreground">ID {p.ids.join(", ")}</div>}
                    {p.atualizadoPeloCadastro && (
                      <div
                        className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title="O cadastro da TiTa tem um convênio diferente do registrado na agenda"
                      >
                        <RefreshCw size={10} /> Agenda: {p.conveniosAgenda.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{p.sessoes}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtHDec(p.chSemanal)}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{p.terapias.join(", ") || "—"}</td>
                  <td className="py-1.5 pl-2 pr-3 text-muted-foreground">{p.outraDimensao.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  )
}
