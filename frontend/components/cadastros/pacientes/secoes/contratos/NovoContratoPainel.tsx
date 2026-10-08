"use client"

import { useRef, useState } from "react"
import toast from "react-hot-toast"
import { FileText, Loader2, Save, X } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
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
import {
  TAMANHO_MAXIMO_PDF,
  criarContrato,
  editarRascunho,
  enviarArquivoOriginal,
} from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { campo, rotulo } from "../../ui/campos"

// Painel lateral "Novo contrato" — e o mesmo painel para editar um RASCUNHO
// (depois de enviado para assinatura, o documento é o que vale e as datas
// travam; a RPC recusa a edição).
//
// O PDF é opcional na criação: a equipe pode registrar o contrato agora e
// anexar depois pelo detalhe. Se o contrato for criado e só o upload falhar, o
// contrato fica (já tem evento na linha do tempo) e o aviso diz o que faltou.

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
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const datasOk = !!inicio && !!vencimento && vencimento >= inicio
  const valido = !!tipo && datasOk

  function escolherArquivo(f: File | undefined) {
    setErroArquivo(null)
    if (!f) return
    if (f.type !== "application/pdf") return setErroArquivo("Escolha um arquivo PDF.")
    if (f.size > TAMANHO_MAXIMO_PDF) return setErroArquivo("O PDF passa de 10 MB.")
    setArquivo(f)
  }

  async function salvar() {
    if (!valido || !tipo) return
    setSalvando(true)
    const dados = { tipo, dataInicio: inicio, dataVencimento: vencimento, observacao: observacao.trim() || null }
    try {
      let contrato = editando ? await editarRascunho(editando.id, dados) : await criarContrato(pacienteId, dados)
      if (arquivo) {
        try {
          contrato = await enviarArquivoOriginal(contrato.id, arquivo)
        } catch (e) {
          toast.error(
            `Contrato ${editando ? "salvo" : "criado"}, mas o PDF não subiu: ${e instanceof Error ? e.message : "erro"}. Anexe pelo detalhe do contrato.`,
            { duration: 9000 },
          )
          onSalvo(contrato)
          return
        }
      }
      toast.success(editando ? "Contrato salvo." : "Contrato criado em Rascunho.")
      onSalvo(contrato)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o contrato.", { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Drawer
      title={editando ? "Editar contrato" : "Novo contrato"}
      subtitle={editando ? "Só é possível editar enquanto está em Rascunho." : "Nasce em Rascunho. A assinatura vem depois."}
      width={480}
      onClose={() => !salvando && onFechar()}
      footer={
        <>
          <button type="button" onClick={onFechar} disabled={salvando} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
            Cancelar
          </button>
          <button type="button" onClick={() => void salvar()} disabled={!valido || salvando} className={`${btnPrimario} min-h-11 sm:min-h-0`}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {salvando ? "Salvando…" : editando ? "Salvar" : "Criar contrato"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className={rotulo}>Tipo de contrato *</legend>
          <div className="flex flex-col gap-1.5">
            {TIPOS_CONTRATO.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipo === t}
                onClick={() => setTipo(t)}
                className={`${opcaoForm(tipo === t)} min-h-11 justify-start`}
              >
                {ROTULO_TIPO[t]}
              </button>
            ))}
          </div>
        </fieldset>

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

        <div>
          <span className={rotulo}>PDF do contrato</span>
          <p className="mt-0.5 text-xs text-muted-foreground">Opcional agora — dá para anexar depois.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={salvando} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
              <FileText className="h-4 w-4" aria-hidden />
              {arquivo ? "Trocar PDF" : editando?.arquivo_original_path ? "Substituir PDF" : "Escolher PDF"}
            </button>
            {arquivo && (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs text-foreground">
                <span className="truncate" title={arquivo.name}>{arquivo.name}</span>
                <button
                  type="button"
                  onClick={() => setArquivo(null)}
                  aria-label="Remover PDF escolhido"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              escolherArquivo(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          {erroArquivo && <p className="mt-1 text-xs text-destructive">{erroArquivo}</p>}
        </div>
      </div>
    </Drawer>
  )
}
