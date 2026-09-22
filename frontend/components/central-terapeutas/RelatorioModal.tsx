'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Download, FileSpreadsheet, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { listarCentralTerapeuticaPeriodo } from '@/services/central-terapeutas-relatorio.service'
import { montarRelatorio } from '@/lib/central-terapeutas/exportRelatorio'

type Props = {
  aberto: boolean
  /** Data selecionada na tela — serve de ponto de partida do período. */
  dataPadrao: string
  onClose: () => void
}

const inputClass =
  'w-full h-10 pl-11 pr-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-[#3A8FB7] transition'

export default function RelatorioModal({ aberto, dataPadrao, onClose }: Props) {
  const [dataInicio, setDataInicio] = useState(dataPadrao)
  const [dataFim, setDataFim] = useState(dataPadrao)
  const [gerando, setGerando] = useState(false)
  const [carregadas, setCarregadas] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)

  // Reabrir o modal parte da data que está na tela agora, não da anterior.
  useEffect(() => {
    if (aberto) {
      setDataInicio(dataPadrao)
      setDataFim(dataPadrao)
      setCarregadas(0)
      setAviso(null)
    }
  }, [aberto, dataPadrao])

  useEffect(() => {
    if (!aberto) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !gerando) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto, gerando, onClose])

  if (!aberto) return null

  const periodoInvalido = !dataInicio || !dataFim || dataInicio > dataFim

  async function handleGerar() {
    if (periodoInvalido || gerando) return

    setGerando(true)
    setCarregadas(0)
    setAviso(null)
    try {
      const itens = await listarCentralTerapeuticaPeriodo(
        dataInicio,
        dataFim,
        setCarregadas
      )

      // Baixar uma planilha só com cabeçalhos é a pior resposta possível: o
      // toast some, o arquivo fica, e quem recebeu conclui que o relatório
      // está quebrado. Quando não há o que exportar, não geramos arquivo —
      // o modal segue aberto dizendo o porquê, com o período ainda na tela
      // para o usuário corrigir.
      const { linhas, arquivo, baixar } = montarRelatorio(
        itens,
        dataInicio,
        dataFim
      )

      if (linhas === 0) {
        setAviso(
          itens.length === 0
            ? 'Nenhum atendimento nesse período. Confira as datas — fim de semana e feriado não têm agenda.'
            : 'O período só tem linhas que o relatório não exporta (horário bloqueado, administrativo ou conta de teste).'
        )
        return
      }

      baixar()
      toast.success(`${linhas} atendimentos exportados em ${arquivo}`)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao gerar o relatório'
      toast.error(msg)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                Relatório de atendimentos
              </h2>
              <p className="text-xs text-slate-400">
                Escolha o período e baixe a planilha .xlsx
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={gerando}
            aria-label="Fechar"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-5 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">
                De
              </span>
              <span className="relative block">
                <CalendarDays className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => {
                    setDataInicio(e.target.value)
                    setAviso(null)
                  }}
                  disabled={gerando}
                  className={inputClass}
                />
              </span>
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">
                Até
              </span>
              <span className="relative block">
                <CalendarDays className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="date"
                  value={dataFim}
                  min={dataInicio || undefined}
                  onChange={(e) => {
                    setDataFim(e.target.value)
                    setAviso(null)
                  }}
                  disabled={gerando}
                  className={inputClass}
                />
              </span>
            </label>
          </div>

          {periodoInvalido && dataInicio && dataFim && (
            <p className="text-xs text-rose-500">
              A data final precisa ser igual ou posterior à inicial.
            </p>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 leading-relaxed">
            A planilha traz duas abas: <strong>Atendimentos</strong> (data,
            horário, unidade, sala, terapeuta, terapia, paciente, convênio,
            status, substituição e quem cobriu) e{' '}
            <strong>Resumo por terapeuta</strong>.
          </div>

          {aviso && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
              {aviso}
            </div>
          )}

          {gerando && carregadas > 0 && (
            <p className="text-xs text-slate-400">
              {carregadas} atendimentos carregados...
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={gerando}
            className="px-4 h-10 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-500 hover:border-slate-300 disabled:opacity-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGerar}
            disabled={periodoInvalido || gerando}
            className="flex items-center gap-2 px-4 h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {gerando ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            {gerando ? 'Gerando...' : 'Baixar .xlsx'}
          </button>
        </div>
      </div>
    </div>
  )
}
