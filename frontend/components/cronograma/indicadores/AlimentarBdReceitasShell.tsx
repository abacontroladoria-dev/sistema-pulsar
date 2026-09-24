"use client"

// AlimentarBdReceitasShell — "Preencher Receitas Faturadas"
// (/cronograma/indicadores?tab=alimentar-bd). Lançamento manual de
// pagamentos/NF recebidos por paciente e mês de atendimento — a fonte do
// "Efetivado" real usado em Previsão/Histórico de Receitas (ver
// frontend/lib/cronograma/receitasEfetivadas.ts).
//
// Side panel (Drawer) pra criar/editar, tabela pra listar — mesmo padrão já
// usado nas outras telas de indicadores, mobile-first (tela usada também
// pelas atendentes, ver AGENTS.md).

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import { DatePicker } from "@/components/ui/date-picker"
import { SeletorMesPrevisao } from "./SeletorMesPrevisao"
import { getPacientes } from "@/services/pacientes.service"
import {
  listarFaturamento,
  salvarFaturamento,
  excluirFaturamento,
  type RegistroFaturamento,
} from "@/services/previsaoReceitasFaturamento.service"
import { fmtReal } from "@/lib/cronograma/helpers"
import { maskMoedaBR, formatMoedaBRTexto, parseNumeroBR } from "@/lib/remuneracao/formatacao"
import type { Paciente } from "@/types/paciente"

function anoMesParaCompetencia(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`
}

function competenciaParaAnoMes(competencia: string): { ano: number; mes: number } {
  const [ano, mes] = competencia.split("-").map(Number)
  return { ano, mes }
}

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

/** "2026-08" -> "Ago-2026" — exibição compacta da competência na tabela. */
function competenciaLabelCurto(competencia: string): string {
  const { ano, mes } = competenciaParaAnoMes(competencia)
  return `${MESES_ABREV[mes - 1] ?? "?"}-${ano}`
}

function opcaoPaciente(p: Paciente): string {
  return `${p.nome} (ID ${p.id_paciente})`
}

interface FormState {
  id?: number
  pacienteOpcao: string
  competencia: string
  numeroNf: string
  dataPagamento: string
  valorPago: string
}

function formVazio(competenciaPadrao: string): FormState {
  return { pacienteOpcao: "", competencia: competenciaPadrao, numeroNf: "", dataPagamento: "", valorPago: "" }
}

function formDeRegistro(r: RegistroFaturamento, pacientes: Paciente[]): FormState {
  const paciente = pacientes.find(p => p.id_paciente === r.paciente_id)
  return {
    id: r.id,
    pacienteOpcao: paciente ? opcaoPaciente(paciente) : `ID ${r.paciente_id}`,
    competencia: r.competencia,
    numeroNf: r.numero_nf ?? "",
    dataPagamento: r.data_pagamento ?? "",
    valorPago: r.valor_pago ? formatMoedaBRTexto(Number(r.valor_pago)) : "",
  }
}

export function AlimentarBdReceitasShell() {
  const hoje = new Date()
  const [periodoFiltro, setPeriodoFiltro] = useState({ ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 })
  const competenciaFiltro = anoMesParaCompetencia(periodoFiltro.ano, periodoFiltro.mes)

  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [registros, setRegistros] = useState<RegistroFaturamento[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [drawerAberto, setDrawerAberto] = useState(false)
  const [form, setForm] = useState<FormState>(() => formVazio(competenciaFiltro))
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  async function recarregar() {
    setLoading(true)
    const [resPacientes, resFaturamento] = await Promise.all([
      getPacientes(),
      listarFaturamento({ competencia: competenciaFiltro }),
    ])
    setPacientes(resPacientes.data)
    setRegistros(resFaturamento.data)
    setError(resPacientes.error ?? resFaturamento.error)
    setLoading(false)
  }

  useEffect(() => {
    recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competenciaFiltro])

  const opcoesPacientes = useMemo(() => pacientes.map(opcaoPaciente), [pacientes])
  const pacientePorOpcao = useMemo(() => new Map(pacientes.map(p => [opcaoPaciente(p), p])), [pacientes])

  function abrirNovo() {
    setForm(formVazio(competenciaFiltro))
    setErroForm(null)
    setConfirmandoExclusao(false)
    setDrawerAberto(true)
  }

  function abrirEdicao(r: RegistroFaturamento) {
    setForm(formDeRegistro(r, pacientes))
    setErroForm(null)
    setConfirmandoExclusao(false)
    setDrawerAberto(true)
  }

  async function onSalvar() {
    const paciente = pacientePorOpcao.get(form.pacienteOpcao)
    if (!paciente) {
      setErroForm("Selecione um paciente válido da lista (ID).")
      return
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.competencia)) {
      setErroForm("Mês de atendimento inválido.")
      return
    }
    const valor = parseNumeroBR(form.valorPago)
    if (valor === null || valor < 0) {
      setErroForm("Informe um valor pago válido.")
      return
    }

    setSalvando(true)
    setErroForm(null)
    const { error } = await salvarFaturamento({
      id: form.id,
      pacienteId: paciente.id_paciente,
      pacienteNome: paciente.nome,
      competencia: form.competencia,
      numeroNf: form.numeroNf || null,
      dataPagamento: form.dataPagamento || null,
      valorPago: valor,
    })
    setSalvando(false)

    if (error) {
      setErroForm(error)
      return
    }
    setDrawerAberto(false)
    await recarregar()
  }

  async function onConfirmarExclusao() {
    if (!form.id) return
    const paciente = pacientePorOpcao.get(form.pacienteOpcao)
    const pacienteId = paciente?.id_paciente ?? pacientes.find(p => opcaoPaciente(p) === form.pacienteOpcao)?.id_paciente
    if (!pacienteId) {
      setErroForm("Não foi possível identificar o paciente do lançamento.")
      setConfirmandoExclusao(false)
      return
    }

    setExcluindo(true)
    const { error } = await excluirFaturamento(
      { id: form.id, paciente_id: pacienteId, competencia: form.competencia },
      paciente?.nome ?? form.pacienteOpcao,
    )
    setExcluindo(false)
    setConfirmandoExclusao(false)

    if (error) {
      setErroForm(error)
      return
    }
    setDrawerAberto(false)
    await recarregar()
  }

  const registrosOrdenados = useMemo(
    () => [...registros].sort((a, b) => a.id - b.id),
    [registros],
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Lançamento manual de pagamentos/NF recebidos dos convênios, por paciente (ID) e mês de atendimento. É a fonte do "Efetivado" real mostrado em Previsão/Histórico de Receitas — sem nenhum lançamento aqui, todo o projetado de um paciente/mês aparece como "Indefinido (Glosa ou Receita)".
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeletorMesPrevisao ano={periodoFiltro.ano} mes={periodoFiltro.mes} onChange={(ano, mes) => setPeriodoFiltro({ ano, mes })} />
        <button
          type="button"
          onClick={abrirNovo}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 active:scale-95 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        >
          <Plus size={14} /> Nova receita faturada
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando lançamentos...
        </div>
      )}
      {error && <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pl-3 pr-2 font-semibold">ID</th>
                <th className="py-1.5 px-2 font-semibold">Paciente</th>
                <th className="py-1.5 px-2 font-semibold">Convênio</th>
                <th className="py-1.5 px-2 font-semibold">Mês de Atendimento</th>
                <th className="py-1.5 px-2 font-semibold">N° da NF</th>
                <th className="py-1.5 px-2 font-semibold">Data do Pagamento</th>
                <th className="py-1.5 px-2 text-right font-semibold">Valor Pago</th>
                <th className="py-1.5 pr-3 pl-2 font-semibold">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {registrosOrdenados.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">
                  <Receipt size={18} className="mx-auto mb-1 opacity-40" />
                  Nenhum lançamento neste mês ainda.
                </td></tr>
              )}
              {registrosOrdenados.map(r => {
                const paciente = pacientes.find(p => p.id_paciente === r.paciente_id)
                return (
                  <tr
                    key={r.id}
                    onClick={() => abrirEdicao(r)}
                    className="cursor-pointer border-t border-border/40 hover:bg-muted/40"
                  >
                    <td className="py-1.5 pl-3 pr-2 text-muted-foreground">{r.paciente_id}</td>
                    <td className="py-1.5 px-2 font-medium text-foreground">{paciente?.nome ?? "—"}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{paciente?.convenio_nome ?? "—"}</td>
                    <td className="py-1.5 px-2">{competenciaLabelCurto(r.competencia)}</td>
                    <td className="py-1.5 px-2">{r.numero_nf || "—"}</td>
                    <td className="py-1.5 px-2">{r.data_pagamento ? new Date(r.data_pagamento + "T00:00").toLocaleDateString("pt-BR") : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmtReal(Number(r.valor_pago))}</td>
                    <td className="py-1.5 pr-3 pl-2 text-[11px] text-muted-foreground">
                      {r.atualizado_por_nome ?? "—"}{r.atualizado_em_brasilia ? ` · ${r.atualizado_em_brasilia}` : ""}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerAberto && (
        <Drawer
          title={form.id ? "Editar receita faturada" : "Nova receita faturada"}
          subtitle="ID do paciente, mês de atendimento, NF e pagamento — sem status: o valor pago é o que define Efetivado."
          onClose={() => setDrawerAberto(false)}
          footer={
            <>
              {form.id && (
                <button
                  type="button"
                  onClick={() => setConfirmandoExclusao(true)}
                  disabled={excluindo}
                  className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <Trash2 size={13} /> Excluir
                </button>
              )}
              <button
                type="button"
                onClick={() => setDrawerAberto(false)}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSalvar}
                disabled={salvando}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-muted-foreground">Paciente (ID)</label>
              <SearchCombobox
                value={form.pacienteOpcao}
                onChange={v => setForm(f => ({ ...f, pacienteOpcao: v }))}
                opcoes={opcoesPacientes}
                placeholder="Digite o nome do paciente..."
                ariaLabel="Paciente"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-muted-foreground">Mês de Atendimento</label>
              <SeletorMesPrevisao
                ano={competenciaParaAnoMes(form.competencia).ano}
                mes={competenciaParaAnoMes(form.competencia).mes}
                onChange={(ano, mes) => setForm(f => ({ ...f, competencia: anoMesParaCompetencia(ano, mes) }))}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-muted-foreground">N° da NF</label>
              <input
                type="text"
                value={form.numeroNf}
                onChange={e => setForm(f => ({ ...f, numeroNf: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Opcional"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-muted-foreground">Data do Pagamento</label>
              <DatePicker
                value={form.dataPagamento}
                onChange={v => setForm(f => ({ ...f, dataPagamento: v }))}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-muted-foreground">Valor Pago</label>
              <div className="flex items-center rounded-lg border border-border bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring">
                <span className="select-none text-[13px] text-muted-foreground">R$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.valorPago}
                  onChange={e => setForm(f => ({ ...f, valorPago: maskMoedaBR(e.target.value) }))}
                  className="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-[13px] text-foreground focus:outline-none"
                  placeholder="0,00"
                />
              </div>
            </div>

            {erroForm && <div className="text-[12px] font-semibold text-rose-600 dark:text-rose-400">{erroForm}</div>}
          </div>
        </Drawer>
      )}

      {confirmandoExclusao && (
        <ConfirmDialog
          title="Excluir receita faturada?"
          description={`${form.pacienteOpcao} — ${form.competencia}${form.numeroNf ? ` — NF ${form.numeroNf}` : ""}\nEssa ação não pode ser desfeita.`}
          confirmLabel={excluindo ? "Excluindo..." : "Excluir"}
          confirmColor="#dc2626"
          onConfirm={onConfirmarExclusao}
          onCancel={() => setConfirmandoExclusao(false)}
        />
      )}
    </div>
  )
}
