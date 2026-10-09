"use client"

import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Loader2, Plus, Save, Trash2, Calendar } from "lucide-react"
import { DatePicker } from "@/components/ui/date-picker"
import { B } from "@/lib/cronograma/constants"
import { useFeriados, refetchFeriados } from "@/hooks/useFeriados"
import { upsertFeriado, deleteFeriadoPorData } from "@/services/feriados.service"
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext"
import type { FeriadoInfo } from "@/types/feriados"

const HORARIO_DIA_COMPLETO = { inicio: "08:00", fim: "17:40" }

const TIPO_LABEL: Record<"integral" | "parcial", string> = {
  integral: "Dia completo",
  parcial: "Parcial",
}

function horarioLabel(f: FeriadoInfo): string | null {
  if (!f.horario_inicio && !f.horario_fim) return null
  return `${f.horario_inicio ?? "—"} - ${f.horario_fim ?? "—"}`
}

function fmtDataCompleta(iso: string): string {
  const [ano, mes, dia] = iso.split("-")
  return `${dia}/${mes}/${ano}`
}

export function FeriadosCadastro() {
  const { feriados: feriadosSalvos, loading: feriadosLoading } = useFeriados()

  const [feriados, setFeriados] = useState<Record<string, FeriadoInfo>>(feriadosSalvos)
  const [saving, setSaving] = useState(false)
  const [savedFeriados, setSavedFeriados] = useState<Record<string, FeriadoInfo>>(feriadosSalvos)

  // Para adicionar novo
  const [novaData, setNovaData] = useState("")
  const [novoNome, setNovoNome] = useState("")
  const [novoTipo, setNovoTipo] = useState<"integral" | "parcial">("integral")
  const [novoInicio, setNovoInicio] = useState(HORARIO_DIA_COMPLETO.inicio)
  const [novoFim, setNovoFim] = useState(HORARIO_DIA_COMPLETO.fim)

  // Ressincroniza com os feriados assíncronos quando chegam/mudam depois do
  // mount — padrão recomendado do React para ajustar estado a partir de props
  // sem efeito.
  const [prevFeriadosSalvos, setPrevFeriadosSalvos] = useState(feriadosSalvos)
  if (feriadosSalvos !== prevFeriadosSalvos) {
    setPrevFeriadosSalvos(feriadosSalvos)
    setFeriados(feriadosSalvos)
    setSavedFeriados(feriadosSalvos)
  }

  const isDirty = JSON.stringify(feriados) !== JSON.stringify(savedFeriados)

  const handleSaveAll = useCallback(async () => {
    setSaving(true)

    const todasDatas = new Set([...Object.keys(feriados), ...Object.keys(savedFeriados)])
    const operacoes = [...todasDatas].map(data => {
      const atual = feriados[data]
      const salvo = savedFeriados[data]
      if (!atual) return deleteFeriadoPorData(data)
      if (salvo && JSON.stringify(atual) === JSON.stringify(salvo)) return Promise.resolve(true)
      return upsertFeriado({ data, ...atual })
    })

    const resultados = await Promise.all(operacoes)
    const ok = resultados.every(Boolean)
    setSaving(false)
    if (ok) {
      setSavedFeriados(feriados)
      await refetchFeriados()
      toast.success("Feriados atualizados com sucesso!")
    } else {
      toast.error("Erro ao salvar feriados.")
    }
    return ok
  }, [feriados, savedFeriados])

  const { registerGuard } = useUnsavedChangesGuard()
  useEffect(() => {
    registerGuard({ isDirty, save: handleSaveAll })
    return () => registerGuard(null)
  })

  const handleTipoChange = (tipo: "integral" | "parcial") => {
    setNovoTipo(tipo)
    if (tipo === "integral") {
      setNovoInicio(HORARIO_DIA_COMPLETO.inicio)
      setNovoFim(HORARIO_DIA_COMPLETO.fim)
    } else {
      setNovoInicio("")
      setNovoFim("")
    }
  }

  const handleAdd = () => {
    if (!novaData || !novoNome) return toast.error("Preencha a data e o nome.")
    if (novoTipo === "parcial" && (!novoInicio || !novoFim)) return toast.error("Selecione o horário de início e fim.")
    setFeriados(prev => ({
      ...prev,
      [novaData]: novoTipo === "integral"
        ? { nome: novoNome, tipo: novoTipo, horario_inicio: HORARIO_DIA_COMPLETO.inicio, horario_fim: HORARIO_DIA_COMPLETO.fim }
        : { nome: novoNome, tipo: novoTipo, horario_inicio: novoInicio, horario_fim: novoFim }
    }))
    setNovaData("")
    setNovoNome("")
    setNovoTipo("integral")
    setNovoInicio(HORARIO_DIA_COMPLETO.inicio)
    setNovoFim(HORARIO_DIA_COMPLETO.fim)
  }

  const handleRemove = (data: string) => {
    const next = { ...feriados }
    delete next[data]
    setFeriados(next)
  }

  if (feriadosLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  const sortedDates = Object.keys(feriados).sort()

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-4 animate-in fade-in duration-300">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-bold text-lg text-foreground">Feriados Estaduais / Municipais</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            O sistema já desconta os feriados nacionais automaticamente. Adicione aqui apenas os feriados regionais que afetam a operação da clínica.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isDirty && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
              alterações não salvas
            </span>
          )}
          <button
            onClick={handleSaveAll}
            disabled={saving || !isDirty}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: B.blue }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Feriados
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-6 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="col-span-12 md:col-span-3">
            <label htmlFor="feriado-data" className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Data</label>
            <DatePicker id="feriado-data" value={novaData} onChange={setNovaData} classeGatilho="flex w-full items-center justify-between border border-slate-300 dark:border-slate-700 bg-transparent text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="col-span-12 md:col-span-5">
            <label htmlFor="feriado-nome" className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Nome do Feriado</label>
            <input id="feriado-nome" type="text" placeholder="Digite" value={novoNome} onChange={e => setNovoNome(e.target.value)} className="w-full border border-slate-300 dark:border-slate-700 bg-transparent text-foreground placeholder:text-slate-400 dark:placeholder:text-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="col-span-12 md:col-span-4">
            <label htmlFor="feriado-tipo" className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Tipo</label>
            <select id="feriado-tipo" value={novoTipo} onChange={e => handleTipoChange(e.target.value as "integral" | "parcial")} className="w-full border border-slate-300 dark:border-slate-700 bg-transparent text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="integral" className="text-foreground bg-white dark:bg-slate-900">Dia completo</option>
              <option value="parcial" className="text-foreground bg-white dark:bg-slate-900">Parcial</option>
            </select>
          </div>

          {novoTipo === "integral" ? (
            <div className="col-span-12 md:col-span-6">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Horário</span>
              <div className="w-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg px-3 py-2 text-sm">
                {HORARIO_DIA_COMPLETO.inicio} - {HORARIO_DIA_COMPLETO.fim}
              </div>
            </div>
          ) : (
            <>
              <div className="col-span-6 md:col-span-3">
                <label htmlFor="feriado-inicio" className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Horário início</label>
                <input id="feriado-inicio" type="time" value={novoInicio} onChange={e => setNovoInicio(e.target.value)} className="w-full border border-slate-300 dark:border-slate-700 bg-transparent text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="col-span-6 md:col-span-3">
                <label htmlFor="feriado-fim" className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">Horário fim</label>
                <input id="feriado-fim" type="time" value={novoFim} onChange={e => setNovoFim(e.target.value)} className="w-full border border-slate-300 dark:border-slate-700 bg-transparent text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </>
          )}

          <div className="col-span-12 md:col-span-2 flex items-end">
            <button onClick={handleAdd} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        {sortedDates.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
            <Calendar className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <p>Nenhum feriado local configurado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedDates.map(date => {
              const f = feriados[date]
              const horario = horarioLabel(f)
              return (
                <div key={date} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {f.nome}
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-bold ${f.tipo === 'integral' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'}`}>
                        {TIPO_LABEL[f.tipo]}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {fmtDataCompleta(date)}{horario ? ` · ${horario}` : ""}
                    </div>
                  </div>
                  <button onClick={() => handleRemove(date)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
