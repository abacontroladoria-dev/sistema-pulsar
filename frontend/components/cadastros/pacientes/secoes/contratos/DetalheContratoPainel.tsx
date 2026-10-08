"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import toast from "react-hot-toast"
import {
  Ban,
  CircleCheck,
  Download,
  FileText,
  FileUp,
  Loader2,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  UserRound,
  Users,
} from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DatePicker } from "@/components/ui/date-picker"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { btnPerigo, btnPrimario, btnSecundario } from "@/components/cronograma/grade/estilo"
import {
  ROTULO_TIPO,
  dataBR,
  dataBRDeTimestamp,
  hojeBrasilia,
  statusEfetivo,
  textoPrazo,
  transicaoPermitida,
  vigencia,
} from "@/lib/contratos/status"
import {
  TAMANHO_MAXIMO_PDF,
  cancelarContrato,
  enviarArquivoOriginal,
  marcarAssinadoManual,
  urlDoArquivo,
} from "@/services/pacienteContratos.service"
import { getVinculosDoPaciente } from "@/services/responsaveis.service"
import type { ContratoPaciente, EventoContrato, SignatarioContrato } from "@/types/contratosPaciente"
import type { VinculoResponsavel } from "@/types/responsavel"
import { campo, rotulo } from "../../ui/campos"
import { LinhaDoTempo } from "./LinhaDoTempo"
import { SelosContrato } from "./Selos"

// Painel lateral de UM contrato: dados, documento, assinatura, ações e linha do
// tempo. Fica de lado (Drawer) para a lista continuar visível atrás.
//
// Ações da fase 1 (modo manual): marcar como assinado, cancelar, anexar e
// baixar PDF. As da integração D4Sign/WhatsApp (fases 3 e 4) aparecem
// desligadas com "em breve" — o lugar delas já existe, para a tela não mudar
// de forma quando forem ligadas.

type Acao = null | "assinar" | "cancelar"

export function DetalheContratoPainel({
  contrato: c,
  eventos,
  signatarios,
  pacienteId,
  onFechar,
  onEditar,
  onMudou,
}: {
  contrato: ContratoPaciente
  eventos: EventoContrato[]
  signatarios: SignatarioContrato[]
  pacienteId: number
  onFechar: () => void
  onEditar: () => void
  onMudou: () => Promise<void> | void
}) {
  const hoje = hojeBrasilia()
  const status = statusEfetivo(c)
  const v = vigencia(c.data_inicio, c.data_vencimento, hoje)
  const { confirmar, dialogo } = useConfirmacao()

  const [acao, setAcao] = useState<Acao>(null)
  const [assinadoEm, setAssinadoEm] = useState(hoje)
  const [motivo, setMotivo] = useState("")
  const [ocupado, setOcupado] = useState<null | "assinar" | "cancelar" | "upload" | "original" | "assinado">(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const podeAssinar = transicaoPermitida(status, "assinado")
  const podeCancelar = transicaoPermitida(status, "cancelado")
  // O PDF original só troca enquanto o contrato é rascunho: depois de enviado,
  // o documento da D4Sign é o que vale. Sem PDF ainda, qualquer status vivo aceita.
  const podeAnexar = status !== "cancelado" && (status === "rascunho" || !c.arquivo_original_path)

  async function assinar() {
    if (!assinadoEm || assinadoEm > hoje) {
      toast.error("A data da assinatura não pode ficar em branco nem no futuro.")
      return
    }
    const ok = await confirmar({
      titulo: "Marcar como assinado?",
      texto: `Registra que o contrato foi assinado em ${dataBR(assinadoEm)}, fora da D4Sign (papel ou outro meio). Não dá para desfazer — só cancelar o contrato.`,
      confirmar: "Marcar como assinado",
      t: "verde",
      Icone: CircleCheck,
    })
    if (!ok) return
    setOcupado("assinar")
    try {
      await marcarAssinadoManual(c.id, assinadoEm)
      toast.success("Contrato marcado como assinado.")
      setAcao(null)
      await onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar como assinado.", { duration: 8000 })
    } finally {
      setOcupado(null)
    }
  }

  async function cancelar() {
    if (motivo.trim().length < 3) {
      toast.error("Informe o motivo do cancelamento.")
      return
    }
    const ok = await confirmar({
      titulo: "Cancelar este contrato?",
      texto:
        status === "assinado"
          ? "O contrato está assinado: cancelar registra a rescisão. Ele continua no histórico, mas deixa de contar como vigente."
          : "O contrato continua no histórico, mas deixa de contar. Não dá para reativar — se precisar, crie outro.",
      confirmar: "Cancelar contrato",
      cancelar: "Voltar",
      t: "vermelho",
      Icone: Ban,
    })
    if (!ok) return
    setOcupado("cancelar")
    try {
      await cancelarContrato(c.id, motivo.trim())
      toast.success("Contrato cancelado.")
      setAcao(null)
      await onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.", { duration: 8000 })
    } finally {
      setOcupado(null)
    }
  }

  async function anexar(f: File | undefined) {
    if (!f) return
    if (f.type !== "application/pdf") return void toast.error("Escolha um arquivo PDF.")
    if (f.size > TAMANHO_MAXIMO_PDF) return void toast.error("O PDF passa de 10 MB.")
    if (c.arquivo_original_path) {
      const ok = await confirmar({
        titulo: "Substituir o PDF?",
        texto: "O PDF atual deixa de ser o do contrato. A troca fica registrada na linha do tempo.",
        confirmar: "Substituir",
      })
      if (!ok) return
    }
    setOcupado("upload")
    try {
      await enviarArquivoOriginal(c.id, f)
      toast.success("PDF anexado.")
      await onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o PDF.", { duration: 8000 })
    } finally {
      setOcupado(null)
    }
  }

  async function baixar(qual: "original" | "assinado") {
    // A aba abre ANTES do await: aberta depois, o bloqueador de pop-up do
    // navegador a trata como pop-up não solicitado.
    const aba = window.open("about:blank", "_blank")
    setOcupado(qual)
    try {
      const url = await urlDoArquivo(c.id, qual)
      if (aba) aba.location.href = url
      else window.location.href = url
    } catch (e) {
      aba?.close()
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o PDF.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Drawer
      title={ROTULO_TIPO[c.tipo]}
      subtitle={`${dataBR(c.data_inicio)} → ${dataBR(c.data_vencimento)}`}
      width={520}
      onClose={() => !ocupado && onFechar()}
      footer={
        status === "rascunho" ? (
          <button type="button" onClick={onEditar} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
            <Pencil className="h-4 w-4" aria-hidden />
            Editar rascunho
          </button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* ── Situação ── */}
        <section className="space-y-2">
          <SelosContrato status={status} vigencia={v} />
          <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
            {status !== "cancelado" && <Item rotulo="Prazo">{textoPrazo(c.data_inicio, c.data_vencimento, hoje)}</Item>}
            {c.assinado_em && (
              <Item rotulo="Assinado em">
                {dataBRDeTimestamp(c.assinado_em)} {c.origem_assinatura === "manual" ? "(marcação manual)" : "(D4Sign)"}
              </Item>
            )}
            {c.link_expira_em && status !== "assinado" && status !== "cancelado" && (
              <Item rotulo="Link vale até">{dataBRDeTimestamp(c.link_expira_em)}</Item>
            )}
            <Item rotulo="Criado">
              {dataBRDeTimestamp(c.criado_em)}
              {c.criado_por_nome && ` por ${c.criado_por_nome}`}
            </Item>
            {c.observacao && <Item rotulo="Observação">{c.observacao}</Item>}
          </dl>
        </section>

        {/* ── Documento ── */}
        <section>
          <h3 className={rotulo}>Documento</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.arquivo_original_path ? (
              <button type="button" onClick={() => void baixar("original")} disabled={!!ocupado} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
                {ocupado === "original" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                Baixar PDF
              </button>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" aria-hidden /> Nenhum PDF anexado.
              </p>
            )}
            {podeAnexar && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!ocupado} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
                {ocupado === "upload" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
                {c.arquivo_original_path ? "Substituir PDF" : "Anexar PDF"}
              </button>
            )}
            {c.arquivo_assinado_path ? (
              <button type="button" onClick={() => void baixar("assinado")} disabled={!!ocupado} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
                {ocupado === "assinado" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                Baixar contrato assinado
              </button>
            ) : (
              <EmBreve Icone={Download}>Baixar contrato assinado</EmBreve>
            )}
          </div>
          {c.arquivo_original_nome && (
            <p className="mt-1.5 truncate text-xs text-muted-foreground" title={c.arquivo_original_nome}>
              {c.arquivo_original_nome}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              void anexar(e.target.files?.[0])
              e.target.value = ""
            }}
          />
        </section>

        {/* ── Assinatura ── */}
        <section>
          <h3 className={rotulo}>Assinatura</h3>
          <div className="mt-2">
            {signatarios.length > 0 ? (
              <ul className="space-y-1.5">
                {signatarios.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                      <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{s.nome}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {s.status === "assinado"
                        ? `assinou em ${dataBRDeTimestamp(s.assinado_em)}`
                        : s.status === "recusado"
                          ? "recusou"
                          : s.link_enviado_em
                            ? `link enviado ${dataBRDeTimestamp(s.link_enviado_em)}${s.envios > 1 ? ` (${s.envios}×)` : ""}`
                            : "pendente"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <QuemVaiAssinar pacienteId={pacienteId} />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <EmBreve Icone={Send}>Enviar para assinatura</EmBreve>
            <EmBreve Icone={RefreshCw}>Reenviar link</EmBreve>
            <EmBreve Icone={MessageCircle}>Ver status das assinaturas</EmBreve>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Envio pela D4Sign com link no WhatsApp: em breve. Até lá, anexe o PDF e marque como assinado.
          </p>
        </section>

        {/* ── Ações ── */}
        {(podeAssinar || podeCancelar) && (
          <section>
            <h3 className={rotulo}>Ações</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {podeAssinar && (
                <button
                  type="button"
                  aria-expanded={acao === "assinar"}
                  onClick={() => setAcao(acao === "assinar" ? null : "assinar")}
                  disabled={!!ocupado}
                  className={`${btnSecundario} min-h-11 sm:min-h-0`}
                >
                  <CircleCheck className="h-4 w-4" aria-hidden />
                  Marcar como assinado
                </button>
              )}
              {podeCancelar && (
                <button
                  type="button"
                  aria-expanded={acao === "cancelar"}
                  onClick={() => setAcao(acao === "cancelar" ? null : "cancelar")}
                  disabled={!!ocupado}
                  className={`${btnPerigo} min-h-11 sm:min-h-0`}
                >
                  <Ban className="h-4 w-4" aria-hidden />
                  Cancelar contrato
                </button>
              )}
            </div>

            {acao === "assinar" && (
              <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
                <span className={rotulo}>Data da assinatura</span>
                <DatePicker value={assinadoEm} onChange={(d) => setAssinadoEm(d)} />
                {assinadoEm > hoje && <p className="text-xs text-destructive">A data não pode ser no futuro.</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void assinar()}
                    disabled={!!ocupado || !assinadoEm || assinadoEm > hoje}
                    className={`${btnPrimario} min-h-11 sm:min-h-0`}
                  >
                    {ocupado === "assinar" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Confirmar assinatura
                  </button>
                </div>
              </div>
            )}

            {acao === "cancelar" && (
              <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
                <label className={rotulo} htmlFor={`motivo-cancelar-${c.id}`}>
                  Motivo do cancelamento *
                </label>
                <textarea
                  id={`motivo-cancelar-${c.id}`}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className={`${campo} resize-y`}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void cancelar()}
                    disabled={!!ocupado || motivo.trim().length < 3}
                    className={`${btnPerigo} min-h-11 sm:min-h-0`}
                  >
                    {ocupado === "cancelar" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Cancelar contrato
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Linha do tempo ── */}
        <section>
          <h3 className={rotulo}>Linha do tempo</h3>
          <div className="mt-3">
            <LinhaDoTempo eventos={eventos} />
          </div>
        </section>
      </div>
      {dialogo}
    </Drawer>
  )
}

function Item({ rotulo: r, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{r}: </dt>
      <dd className="inline break-words">{children}</dd>
    </div>
  )
}

function EmBreve({ Icone, children }: { Icone: typeof Send; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title="Em breve: integração com a D4Sign"
      className={`${btnSecundario} min-h-11 sm:min-h-0`}
    >
      <Icone className="h-4 w-4" aria-hidden />
      {children}
      <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold uppercase text-muted-foreground">em breve</span>
    </button>
  )
}

/**
 * Antes do envio não há signatário gravado: mostra quem SERÁ — o responsável
 * financeiro, ou a filiação 1 sem ele (regra da fase 4). Vem de
 * responsaveis/pacientes_responsaveis, nunca das colunas legadas
 * pacientes.responsavel_*. CPF não aparece: não é preciso para conferir.
 */
function QuemVaiAssinar({ pacienteId }: { pacienteId: number }) {
  const [vinculo, setVinculo] = useState<VinculoResponsavel | null | undefined>(undefined)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let cancelado = false
    void getVinculosDoPaciente(pacienteId).then(({ data, error }) => {
      if (cancelado) return
      if (error) return setErro(true)
      setVinculo(data.find((d) => d.tipo === "financeiro") ?? data.find((d) => d.tipo === "filiacao_1") ?? null)
    })
    return () => {
      cancelado = true
    }
  }, [pacienteId])

  if (erro) return <p className="text-sm text-muted-foreground">Não foi possível ler os responsáveis.</p>
  if (vinculo === undefined) return <div className="h-5 w-48 animate-pulse rounded bg-muted" />
  if (vinculo === null) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
        <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Sem responsável financeiro nem filiação cadastrados. Complete em Cadastro → Filiação e responsáveis antes de enviar para assinatura.
      </p>
    )
  }
  const r = vinculo.responsavel
  return (
    <div className="text-sm">
      <p className="flex items-center gap-1.5 text-foreground">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{r.nome}</span>
        <span className="text-xs text-muted-foreground">
          · {vinculo.tipo === "financeiro" ? "responsável financeiro" : "filiação 1"}
          {vinculo.parentesco && ` (${vinculo.parentesco})`}
        </span>
      </p>
      {!r.celular && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Sem celular no cadastro — o link de assinatura vai pelo WhatsApp.</p>
      )}
    </div>
  )
}
