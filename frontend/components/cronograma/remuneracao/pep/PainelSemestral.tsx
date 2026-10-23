"use client"

import { useRef, useState } from "react"
import { CalendarPlus, Check, Loader2, Trash2 } from "lucide-react"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, btnPerigo, btnPrimario, btnSecundario } from "@/components/cronograma/grade/estilo"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { DatePicker } from "@/components/ui/date-picker"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import type { PepCatalogoItem, PepEvidencia, PepPlanejamentoSemestral } from "@/types/pep"
import {
  confirmarComMotivo,
  evidenciasCompletas,
  formatarDataBR,
  limparEvidencias,
  normalizarEvidencias,
  type RegistroResumo,
} from "./Celulas"
import { CamposEvidencia } from "./PainelQuantidade"

export function PainelSemestral({
  pacienteNome,
  item,
  registro,
  planejamento,
  erro,
  onFechar,
  onSalvarPlanejamento,
  onSalvarEntrega,
  onSalvarReprogramacaoImpedimento,
  onExcluirEntrega,
  onExcluirPlanejamento,
}: {
  pacienteNome: string | null
  item: PepCatalogoItem
  registro: (RegistroResumo & { observacao?: string | null }) | null
  planejamento: PepPlanejamentoSemestral | null
  erro?: string | null
  onFechar: () => void
  onSalvarPlanejamento: (dataPlanejada: string) => void | Promise<void>
  onSalvarEntrega: (input: {
    status: "pendente" | "entregue"
    evidencias: PepEvidencia[]
    observacao: string | null
    motivo?: string | null
    dataEntrega: string
  }) => void | Promise<void>
  onSalvarReprogramacaoImpedimento: (input: {
    dataPlanejada: string
    motivo: string
    evidencias: PepEvidencia[]
  }) => void | Promise<void>
  onExcluirEntrega?: (motivo: string) => boolean | Promise<boolean>
  onExcluirPlanejamento?: (motivo: string) => boolean | Promise<boolean>
}) {
  const [evidencias, setEvidencias] = useState<PepEvidencia[]>(normalizarEvidencias(registro?.evidencias ?? [], 1))
  const [observacao, setObservacao] = useState(registro?.observacao ?? "")
  const [dataPlanejadaInput, setDataPlanejadaInput] = useState(planejamento?.data_planejada ?? "")
  // Vazio até o usuário escolher — não presumir "hoje" por padrão, senão o
  // campo parece já ter uma entrega confirmada quando ainda não há nenhuma.
  const [dataEntregaInput, setDataEntregaInput] = useState(registro?.data_entrega ?? "")
  const [mostrarRep, setMostrarRep] = useState(false)
  const [repDataPlanejada, setRepDataPlanejada] = useState(planejamento?.data_planejada ?? "")
  const [repMotivo, setRepMotivo] = useState("")
  const [repEvidencias, setRepEvidencias] = useState<PepEvidencia[]>(normalizarEvidencias([], 1))
  const [salvandoDireto, setSalvandoDireto] = useState(false)
  const motivoRef = useRef("")
  const { confirmar, dialogo } = useConfirmacao()

  // `jaExiste` (existe linha na tabela) e `entregueAtual` (status realmente
  // "entregue") são coisas diferentes: depois de um "Desfazer", a linha
  // continua existindo (jaExiste=true) mas volta a status "pendente".
  const jaExiste = !!registro
  const entregueAtual = registro?.status === "entregue"

  async function executarDireto(acao: () => void | Promise<void>) {
    setSalvandoDireto(true)
    try {
      await acao()
    } finally {
      setSalvandoDireto(false)
    }
  }

  async function confirmarSalvar() {
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Salvar alterações?",
      mensagem: "Este registro já existia — o status e a evidência serão sobrescritos.",
      confirmLabel: "Salvar alterações",
      t: "verde",
      motivoRef,
    })
    if (!motivo) return
    await executarDireto(() =>
      onSalvarEntrega({
        status: "entregue",
        evidencias: limparEvidencias(evidencias),
        observacao: observacao || null,
        motivo,
        dataEntrega: dataEntregaInput,
      })
    )
  }

  async function confirmarDesfazer() {
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Desfazer esta entrega?",
      mensagem: "O item volta a status Pendente e a evidência é apagada. Essa ação fica registrada na trilha de auditoria.",
      confirmLabel: "Desfazer",
      t: "vermelho",
      motivoRef,
    })
    if (!motivo) return
    await executarDireto(() =>
      onSalvarEntrega({
        status: "pendente",
        evidencias: [],
        observacao: observacao || null,
        motivo,
        dataEntrega: dataEntregaInput,
      })
    )
  }

  async function confirmarExcluirEntrega() {
    if (!onExcluirEntrega) return
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Excluir este registro?",
      mensagem: "O status de entrega e a evidência deste item nesta competência serão apagados. Essa ação fica registrada na trilha de auditoria.",
      confirmLabel: "Excluir",
      t: "vermelho",
      motivoRef,
      erro,
    })
    if (!motivo) return
    await executarDireto(async () => {
      await onExcluirEntrega(motivo)
    })
  }

  async function confirmarExcluirPlanejamento() {
    if (!onExcluirPlanejamento) return
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Excluir o planejamento?",
      mensagem: "A competência planejada deste item some para este paciente. Se este planejamento já foi reprogramado antes, a exclusão pode ser bloqueada para preservar o histórico.",
      confirmLabel: "Excluir",
      t: "vermelho",
      motivoRef,
      erro,
    })
    if (!motivo) return
    await executarDireto(async () => {
      await onExcluirPlanejamento(motivo)
    })
  }

  if (!planejamento) {
    return (
      <>
        <ScheduleModal
          title={item.nome}
          subtitle={pacienteNome ?? "Geral (sem paciente)"}
          maxWidth={480}
          onClose={onFechar}
          footer={
            <button
              type="button"
              disabled={salvandoDireto || !dataPlanejadaInput}
              onClick={() => executarDireto(() => onSalvarPlanejamento(dataPlanejadaInput))}
              className={`${btnPrimario} min-h-11 sm:min-h-0`}
            >
              {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
              {salvandoDireto ? "Salvando…" : "Salvar planejamento"}
            </button>
          }
        >
          <div className="space-y-2">
            <label className={rotulo}>
              Data planejada
            </label>
            <DatePicker value={dataPlanejadaInput} onChange={setDataPlanejadaInput} />
          </div>
        </ScheduleModal>
        {dialogo}
      </>
    )
  }

  return (
    <>
      <ScheduleModal
        title={item.nome}
        subtitle={pacienteNome ?? "Geral (sem paciente)"}
        maxWidth={480}
        onClose={onFechar}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {entregueAtual && (
                <button
                  type="button"
                  disabled={salvandoDireto}
                  onClick={confirmarDesfazer}
                  className={`${btnSecundario} min-h-11 sm:min-h-0`}
                >
                  Desfazer
                </button>
              )}
              {jaExiste && onExcluirEntrega && (
                <button
                  type="button"
                  disabled={salvandoDireto}
                  onClick={confirmarExcluirEntrega}
                  className={`${btnPerigo} min-h-11 sm:min-h-0`}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              )}
            </div>
            <button
              type="button"
              disabled={salvandoDireto || !evidenciasCompletas(evidencias, 1) || !dataEntregaInput}
              onClick={() =>
                jaExiste
                  ? confirmarSalvar()
                  : executarDireto(() =>
                      onSalvarEntrega({
                        status: "entregue",
                        evidencias: limparEvidencias(evidencias),
                        observacao: observacao || null,
                        dataEntrega: dataEntregaInput,
                      })
                    )
              }
              className={`${btnPrimario} min-h-11 sm:min-h-0`}
            >
              {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {salvandoDireto ? "Salvando…" : entregueAtual ? "Salvar alterações" : "Marcar entregue"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={rotulo}>Planejado para</p>
                  <p className="text-sm font-semibold text-foreground">{formatarDataBR(planejamento.data_planejada)}</p>
                </div>
                <div className="space-y-1">
                  <p className={rotulo}>
                    {entregueAtual ? "Entregue em" : "Marcar entrega em"}
                  </p>
                  {entregueAtual ? (
                    <p className="text-sm font-semibold text-foreground">{formatarDataBR(registro?.data_entrega)}</p>
                  ) : (
                    <DatePicker
                      value={dataEntregaInput}
                      onChange={setDataEntregaInput}
                      classeGatilho="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-foreground/80 focus:outline-none focus:underline decoration-dotted disabled:text-muted-foreground"
                    />
                  )}
                </div>
              </div>
              {onExcluirPlanejamento && (
                <button
                  type="button"
                  disabled={salvandoDireto}
                  onClick={confirmarExcluirPlanejamento}
                  title="Excluir planejamento"
                  className={`${btnPerigo} min-h-11 px-2.5 sm:min-h-0`}
                >
                  <Trash2 size={13} />
                  <span className="sr-only">Excluir planejamento</span>
                </button>
              )}
            </div>

            {!entregueAtual && dataEntregaInput && planejamento.data_planejada && dataEntregaInput > planejamento.data_planejada && (
              <p className={`mt-2 ${aviso("amber")} text-xs`}>
                Data depois do planejado — será registrada como entrega retroativa.
              </p>
            )}
          </div>

          <CamposEvidencia
            evidencias={evidencias}
            onChange={setEvidencias}
            conferirNome={{ item, pacienteNome }}
            rotulo={() => "Referência da evidência"}
          />

          <div className="space-y-1.5">
            <label htmlFor="pep-observacao" className={rotulo}>
              Observação
            </label>
            <textarea
              id="pep-observacao"
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={2}
              className={campo}
            />
          </div>

          {!entregueAtual && (
            <div className="space-y-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setMostrarRep(v => !v)}
                className="text-xs font-semibold text-muted-foreground underline decoration-dotted hover:text-foreground"
              >
                {mostrarRep ? "Cancelar reprogramação" : "Impedimento terapêutico? Registrar reprogramação (REP-)"}
              </button>

              {mostrarRep && (
                <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    PRD Seção 9.7 — aceito o relatório de reprogramação, o ajuste fica suspenso até a nova data planejada.
                  </p>
                  <div className="space-y-1.5">
                    <label className={rotulo}>
                      Nova data planejada
                    </label>
                    <DatePicker value={repDataPlanejada} onChange={setRepDataPlanejada} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="pep-rep-motivo" className={rotulo}>
                      Motivos e justificativas técnicas
                    </label>
                    <textarea
                      id="pep-rep-motivo"
                      value={repMotivo}
                      onChange={e => setRepMotivo(e.target.value)}
                      rows={2}
                      className={campo}
                    />
                  </div>
                  <CamposEvidencia
                    evidencias={repEvidencias}
                    onChange={setRepEvidencias}
                    rotulo={() => `Referência do relatório (ex.: REP-${item.sigla}-PACIENTE-${repDataPlanejada.replace(/-/g, "").slice(2)})`}
                  />
                  <button
                    type="button"
                    disabled={salvandoDireto || !repMotivo.trim() || !repDataPlanejada || !evidenciasCompletas(repEvidencias, 1)}
                    onClick={() =>
                      executarDireto(() =>
                        onSalvarReprogramacaoImpedimento({
                          dataPlanejada: repDataPlanejada,
                          motivo: repMotivo.trim(),
                          evidencias: limparEvidencias(repEvidencias),
                        })
                      )
                    }
                    className={`${btnPrimario} min-h-11 sm:min-h-0`}
                  >
                    {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
                    {salvandoDireto ? "Salvando…" : "Aceitar reprogramação"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </ScheduleModal>
      {dialogo}
    </>
  )
}
