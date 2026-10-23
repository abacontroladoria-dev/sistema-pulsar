"use client"

import { useRef, useState } from "react"
import { Check, ExternalLink, Loader2, Trash2 } from "lucide-react"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { btnPerigo, btnPrimario, btnSecundario, opcaoForm } from "@/components/cronograma/grade/estilo"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import type { AjusteNome } from "@/lib/roboSharepoint/ajusteNome"
import type { PepCatalogoItem, PepEvidencia } from "@/types/pep"
import { AvisoAjustarNome, useAjusteNome } from "./ajusteNome"
import {
  confirmarComMotivo,
  evidenciasCompletas,
  limparEvidencias,
  normalizarEvidencias,
  quantidadeEsperada,
  type RegistroResumo,
} from "./Celulas"
import { ChipOrigem, ORIGEM, origemDaUnidade } from "./origem"
import { faturamentoDaCompetencia } from "./VisaoGeralPep"

// Uma unidade de referência de evidência — o caminho é a informação que
// realmente importa (é o que torna a unidade faturável, PRD Seção 2.3/12.3);
// o nome do arquivo é só apoio visual, por isso pesa menos na hierarquia.
function CampoEvidenciaUnidade({ evidencia, rotuloTexto, ajuste, onChange }: {
  evidencia: PepEvidencia
  rotuloTexto: string
  /** Nome fora do padrão: a entrega vale, com o aviso "Ajustar nomenclatura". */
  ajuste?: AjusteNome | null
  onChange: (campoChave: keyof PepEvidencia, valor: string) => void
}) {
  // Evidência confirmada a partir do robô do SharePoint chega com o endereço
  // completo do arquivo (webUrl) e o nome: aí dá para abrir direto daqui.
  const link = /^https?:\/\//i.test(evidencia.caminho) ? evidencia.caminho : null
  const marcada = !!evidencia.caminho.trim()
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className={`${rotulo} mb-0 flex items-center gap-2`}>
          {rotuloTexto}
          {marcada && <ChipOrigem origem={evidencia.origem === "robo" ? "robo" : "humano"} />}
        </label>
      </div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={`${btnSecundario} min-h-11 w-full justify-between sm:min-h-0`}
        >
          <span className="truncate">{evidencia.nome ?? "Abrir arquivo"}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs">
            Abrir no SharePoint <ExternalLink size={13} aria-hidden />
          </span>
        </a>
      )}
      {evidencia.origem === "robo" && (
        <p className="text-xs text-muted-foreground">
          Mudar este caminho troca a unidade para Pessoa e conta como entrega do robô desfeita.
        </p>
      )}
      <input
        type="text"
        placeholder="ex.: SharePoint/Pacientes/Fulano/STC-01-082026.pdf"
        value={evidencia.caminho}
        onChange={e => onChange("caminho", e.target.value)}
        className={campo}
      />
      {ajuste && <AvisoAjustarNome ajuste={ajuste} />}
    </div>
  )
}

// Uma referência de evidência por unidade entregue (ex.: 2 de TAP = 2 campos
// — PRD Seção 13.6 usa nomenclatura sequencial: TAP-01-..., TAP-02-...).
export function CamposEvidencia({ evidencias, onChange, rotulo: rotuloFn, conferirNome }: {
  evidencias: PepEvidencia[]
  onChange: (evidencias: PepEvidencia[]) => void
  rotulo: (indice: number) => string
  /** Item e paciente da célula: liga o aviso "Ajustar nomenclatura" (sem isso, nada é conferido). */
  conferirNome?: { item: PepCatalogoItem; pacienteNome: string | null }
}) {
  const conferir = useAjusteNome()
  function atualizar(indice: number, campoChave: keyof PepEvidencia, valor: string) {
    // Trocar o caminho de uma unidade do robô a torna da pessoa (o gatilho do
    // banco registra a entrega do robô como desfeita).
    const nova = evidencias.map((e, i) => {
      if (i !== indice) return e
      const base = campoChave === "caminho" && e.origem === "robo" ? { caminho: e.caminho, nome: e.nome } : e
      return { ...base, [campoChave]: campoChave === "nome" && !valor ? null : valor }
    })
    onChange(nova)
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {evidencias.map((ev, i) => (
        <CampoEvidenciaUnidade
          key={i}
          evidencia={ev}
          rotuloTexto={rotuloFn(i)}
          ajuste={conferirNome && ev.caminho.trim() ? conferir(ev, i, conferirNome.pacienteNome, conferirNome.item) : null}
          onChange={(campoChave, valor) => atualizar(i, campoChave, valor)}
        />
      ))}
    </div>
  )
}

// Substitui o campo numérico "quantidade entregue" por N botões de opção (um
// por unidade esperada) com o selo suave da origem — clicar na caixa i preenche
// até ela; clicar numa já marcada desmarca ela e tudo depois.
function SeletorQuantidadeSlots({ esperado, quantidade, onChange, disabled, evidencias }: {
  esperado: number
  quantidade: number
  onChange: (nova: number) => void
  disabled?: boolean
  evidencias?: PepEvidencia[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: esperado }, (_, i) => {
        const marcado = i < quantidade
        const origem = marcado ? origemDaUnidade(evidencias, i) : null
        const Icone = origem ? ORIGEM[origem].icone : null
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onChange(marcado ? i : i + 1)}
            title={`Unidade ${i + 1} de ${esperado}${origem ? ` — entregue (${ORIGEM[origem].rotulo})` : " — pendente"}`}
            className={`${opcaoForm(marcado)} min-h-11 sm:min-h-9`}
          >
            {marcado ? <Check size={14} strokeWidth={2.5} /> : null}
            <span className="tabular-nums">{i + 1}</span>
            {origem && Icone && (
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ${ORIGEM[origem].selo}`}>
                <Icone size={11} aria-hidden />
                <span className="sr-only">{ORIGEM[origem].rotulo}</span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function PainelQuantidade({ pacienteNome, item, competencia, semanasCalendario, registro, erro, onFechar, onSalvar, onExcluir }: {
  pacienteNome: string | null
  item: PepCatalogoItem
  competencia: string
  semanasCalendario: number
  registro: (RegistroResumo & { observacao?: string | null }) | null
  erro?: string | null
  onFechar: () => void
  onSalvar: (input: {
    quantidadeEntregue: number
    evidencias: PepEvidencia[]
    observacao: string | null
    motivo?: string | null
  }) => void | Promise<void>
  onExcluir?: (motivo: string) => boolean | Promise<boolean>
}) {
  const esperado = quantidadeEsperada(item, semanasCalendario)
  const [quantidade, setQuantidade] = useState(registro?.quantidade_entregue ?? 0)
  const [evidencias, setEvidencias] = useState<PepEvidencia[]>(
    normalizarEvidencias(registro?.evidencias ?? [], Math.max(1, registro?.quantidade_entregue ?? 0))
  )
  const [observacao, setObservacao] = useState(registro?.observacao ?? "")
  const [salvandoDireto, setSalvandoDireto] = useState(false)
  const motivoRef = useRef("")
  const { confirmar, dialogo } = useConfirmacao()
  const jaExiste = !!registro

  function alterarQuantidade(nova: number) {
    const clamped = Math.max(0, Math.min(esperado, nova))
    setQuantidade(clamped)
    setEvidencias(prev => normalizarEvidencias(prev, Math.max(1, clamped)))
  }

  async function salvarDireto() {
    setSalvandoDireto(true)
    try {
      await onSalvar({ quantidadeEntregue: quantidade, evidencias: limparEvidencias(evidencias), observacao: observacao || null })
    } finally {
      setSalvandoDireto(false)
    }
  }

  async function confirmarSalvar() {
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Salvar alterações?",
      mensagem: "Este registro já existia — a quantidade e a evidência serão sobrescritas.",
      confirmLabel: "Salvar alterações",
      t: "verde",
      motivoRef,
    })
    if (!motivo) return
    setSalvandoDireto(true)
    try {
      await onSalvar({
        quantidadeEntregue: quantidade,
        evidencias: limparEvidencias(evidencias),
        observacao: observacao || null,
        motivo,
      })
    } finally {
      setSalvandoDireto(false)
    }
  }

  async function confirmarExcluir() {
    if (!onExcluir) return
    motivoRef.current = ""
    const motivo = await confirmarComMotivo(confirmar, {
      titulo: "Excluir este registro?",
      mensagem: "A quantidade entregue e a evidência deste item nesta competência serão apagadas. Essa ação fica registrada na trilha de auditoria.",
      confirmLabel: "Excluir",
      t: "vermelho",
      motivoRef,
      erro,
    })
    if (!motivo) return
    setSalvandoDireto(true)
    try {
      await onExcluir(motivo)
    } finally {
      setSalvandoDireto(false)
    }
  }

  return (
    <>
      <ScheduleModal
        title={item.nome}
        subtitle={`${pacienteNome ?? "Geral (sem paciente)"} · Atendimento de ${faturamentoDaCompetencia(competencia).mesAtendimento}`}
        maxWidth={480}
        onClose={onFechar}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {jaExiste && onExcluir && (
                <button
                  type="button"
                  disabled={salvandoDireto}
                  onClick={confirmarExcluir}
                  className={`${btnPerigo} min-h-11 sm:min-h-0`}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              )}
            </div>
            <button
              type="button"
              disabled={salvandoDireto || (quantidade > 0 && !evidenciasCompletas(evidencias, quantidade))}
              onClick={() => (jaExiste ? confirmarSalvar() : salvarDireto())}
              className={`${btnPrimario} min-h-11 sm:min-h-0`}
            >
              {salvandoDireto ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {salvandoDireto ? "Salvando…" : "Salvar quantidade"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className={rotulo}>
              Marque as unidades já entregues ({esperado} esperada{esperado > 1 ? "s" : ""} este mês)
            </label>
            <SeletorQuantidadeSlots esperado={esperado} quantidade={quantidade} onChange={alterarQuantidade} evidencias={evidencias} />
          </div>

          {quantidade > 0 && (
            <CamposEvidencia
              evidencias={evidencias}
              onChange={setEvidencias}
              conferirNome={{ item, pacienteNome }}
              rotulo={i => (esperado > 1 ? `Referência da evidência — unidade ${i + 1} de ${quantidade}` : "Referência da evidência")}
            />
          )}

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
        </div>
      </ScheduleModal>
      {dialogo}
    </>
  )
}
