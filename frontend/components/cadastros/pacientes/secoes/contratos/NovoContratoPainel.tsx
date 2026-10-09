"use client"

import { useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { Loader2, Save, X } from "lucide-react"
import { DatePicker } from "@/components/ui/date-picker"
import { btnPrimario, btnSecundario, opcaoForm } from "@/components/cronograma/grade/estilo"
import {
  ROTULO_TIPO,
  TIPOS_CONTRATO,
  dataBR,
  hojeBrasilia,
  vencimentoSugerido,
  type TipoContrato,
} from "@/lib/contratos/status"
import { criarContrato, editarRascunho } from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { CampoSelect, campo, rotulo } from "../../ui/campos"

// Formulário "Novo contrato", aberto na própria aba (não em gaveta) — e o mesmo painel para editar um RASCUNHO
// (depois de enviado para assinatura, o documento é o que vale e as datas
// travam; a RPC recusa a edição).
//
// Sem campo de PDF aqui (pedido do usuário, 08/10/2026): o anexo é sempre pelo
// detalhe do contrato, depois de criado — este painel só registra tipo/datas.

const OPCOES_TIPO = TIPOS_CONTRATO.map((t) => ({ valor: t, rotulo: ROTULO_TIPO[t] }))

const PRAZOS = [
  { meses: 6, rotulo: "6 meses" },
  { meses: 12, rotulo: "12 meses" },
]

export function NovoContratoPainel({
  pacienteId,
  editando,
  onFechar,
  onSalvo,
}: {
  pacienteId: number
  /** Presente = editar este rascunho. */
  editando?: ContratoPaciente
  onFechar: () => void
  onSalvo: (c: ContratoPaciente) => void
}) {
  const hoje = hojeBrasilia()
  const [tipo, setTipo] = useState<TipoContrato | null>(editando?.tipo ?? null)
  const [inicio, setInicio] = useState(editando?.data_inicio ?? hoje)
  const [vencimento, setVencimento] = useState(editando?.data_vencimento ?? vencimentoSugerido(hoje, 12))
  const [observacao, setObservacao] = useState(editando?.observacao ?? "")
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLElement>(null)

  // Abre na própria página: leva o formulário à vista.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const datasOk = !!inicio && !!vencimento && vencimento >= inicio
  const valido = !!tipo && datasOk

  async function salvar() {
    if (!valido || !tipo) return
    setSalvando(true)
    const dados = { tipo, dataInicio: inicio, dataVencimento: vencimento, observacao: observacao.trim() || null }
    try {
      const contrato = editando ? await editarRascunho(editando.id, dados) : await criarContrato(pacienteId, dados)
      toast.success(editando ? "Contrato salvo." : "Contrato criado em Rascunho.")
      onSalvo(contrato)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o contrato.", { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section
      ref={ref}
      aria-labelledby="novo-contrato-titulo"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !salvando && !e.defaultPrevented) onFechar()
      }}
      className="scroll-mt-4 rounded-lg border border-primary/30 bg-card shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="novo-contrato-titulo" className="text-base font-semibold text-foreground">
            {editando ? "Editar contrato" : "Novo contrato"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {editando ? "Só é possível editar enquanto está em Rascunho." : "Nasce em Rascunho. A assinatura vem depois."}
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          disabled={salvando}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="space-y-5 px-4 py-4">
        <CampoSelect<TipoContrato>
          label="Tipo de contrato *"
          value={tipo}
          onChange={setTipo}
          disabled={false}
          opcoes={OPCOES_TIPO}
          vazio="Escolha o tipo"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={rotulo}>Data de início *</span>
            <div className="mt-1">
              <DatePicker value={inicio} onChange={(v) => v && setInicio(v)} />
            </div>
          </div>
          <div>
            <span className={rotulo}>Data de vencimento *</span>
            <div className="mt-1">
              <DatePicker value={vencimento} onChange={(v) => v && setVencimento(v)} />
            </div>
          </div>
        </div>
        <div className="-mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Vencimento em:</span>
          {PRAZOS.map((p) => {
            const alvo = inicio ? vencimentoSugerido(inicio, p.meses) : ""
            return (
              <button
                key={p.meses}
                type="button"
                aria-pressed={vencimento === alvo}
                disabled={!inicio}
                onClick={() => setVencimento(alvo)}
                className={`${opcaoForm(vencimento === alvo)} min-h-9 text-xs`}
                title={alvo ? `Vence em ${dataBR(alvo)}` : undefined}
              >
                {p.rotulo}
              </button>
            )
          })}
        </div>
        {!datasOk && inicio && vencimento && (
          <p role="alert" className="-mt-2 text-xs text-destructive">
            O vencimento precisa ser igual ou depois do início.
          </p>
        )}

        <div>
          <label className={rotulo} htmlFor="contrato-observacao">
            Observação
          </label>
          <textarea
            id="contrato-observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Ex.: valor combinado, condição especial, quem negociou"
            className={`mt-1 ${campo} resize-y`}
          />
        </div>
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onFechar} disabled={salvando} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
          Cancelar
        </button>
        <button type="button" onClick={() => void salvar()} disabled={!valido || salvando} className={`${btnPrimario} min-h-11 sm:min-h-0`}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {salvando ? "Salvando…" : editando ? "Salvar" : "Criar contrato"}
        </button>
      </footer>
    </section>
  )
}
