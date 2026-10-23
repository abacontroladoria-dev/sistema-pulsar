"use client"

import { useState, type MutableRefObject } from "react"
import { AlertTriangle, CalendarPlus, Paperclip } from "lucide-react"
import toast from "react-hot-toast"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import type { PedidoConfirmacao } from "@/components/ui/pastel/confirmacao"
import type { Tom } from "@/components/ui/pastel/pecas"
import type { PepCatalogoItem, PepEvidencia, PepPlanejamentoSemestral, PepRegistroEntrega } from "@/types/pep"
import { SeloAjustarNome, useContarAjustes } from "./ajusteNome"
import { ORIGEM, SeloUnidade, contarOrigem, origemDaUnidade } from "./origem"

export type RegistroResumo = Pick<PepRegistroEntrega, "status" | "quantidade_entregue" | "evidencias" | "observacao" | "data_entrega"> | null

export const money = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`

/** 'YYYY-MM-DD' → 'DD/MM/AAAA'. Sem hora em nenhum lugar (PRD §2.2). */
export function formatarDataBR(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.split("-")
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : "—"
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. A competência é sempre DERIVADA da data (PRD §2.2/§3/§6), nunca o contrário. */
export function competenciaDaData(iso: string): string {
  return iso.slice(0, 7)
}

export function competenciaDoMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function addMeses(competencia: string, meses: number): string {
  const [y, m] = competencia.split("-").map(Number)
  const d = new Date(y, m - 1 + meses, 1)
  return competenciaDoMes(d)
}

// Quantidade esperada no mês para um item recorrente. PRD Seção 9.11: só os
// itens SEMANAIS (Supervisão/Estudo) variam com o calendário — calculado
// automaticamente a partir dos feriados (usePepCalendario). TAP/Parental usam
// sempre a referência fixa do catálogo (Seção 7.2).
export function quantidadeEsperada(item: PepCatalogoItem, semanasCalendario: number): number {
  if (item.periodicidade === "semanal") return semanasCalendario
  return item.qtd_referencia_mes ?? 1
}

// Quantos meses se passaram entre a competência planejada e a atual —
// PRD Seção 10.1: dentro de 1 mês do vencimento ainda é "aceite postergado"
// normal; a partir de 2 meses é pendência reiterada (o sistema deve
// sinalizar — risco de inadimplemento de obrigação essencial).
export function mesesEntre(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  return (by - ay) * 12 + (bm - am)
}

// Garante exatamente `n` posições de evidência, preservando o que já existia.
export function normalizarEvidencias(evidencias: PepEvidencia[], n: number): PepEvidencia[] {
  return Array.from({ length: n }, (_, i) => evidencias[i] ?? { caminho: "", nome: null })
}

export function limparEvidencias(evidencias: PepEvidencia[]): PepEvidencia[] {
  return evidencias.filter(e => e.caminho.trim())
}

// PRD Seção 2.3/12.3: "uma unidade só é faturável com evidência presente" —
// não é opcional. Cada unidade entregue precisa da sua própria referência de
// evidência (2 unidades de TAP = 2 evidências, não uma só pra tudo).
export function evidenciasCompletas(evidencias: PepEvidencia[], quantidade: number): boolean {
  return limparEvidencias(evidencias).length >= quantidade
}

export type StatusRecorrente = { esperado: number; entregue: number; completo: boolean; parcial: boolean }

// Única fonte da regra "completo/parcial" para item recorrente — usada tanto
// pela célula da tabela mensal quanto pelo indicador de progresso agregado,
// pra não duplicar a leitura de quantidadeEsperada em dois lugares.
export function statusRecorrente(item: PepCatalogoItem, semanasCalendario: number, registro: RegistroResumo): StatusRecorrente {
  const esperado = quantidadeEsperada(item, semanasCalendario)
  const entregue = registro?.quantidade_entregue ?? 0
  return { esperado, entregue, completo: entregue >= esperado, parcial: entregue > 0 && entregue < esperado }
}

export type StatusSemestral = {
  statusLabel: string
  entregue: boolean
  icone: "check" | "alert" | "calendar" | null
  link: string | null
}

// Extraído 1:1 da lógica que antes vivia inline em TabelaSemestralPaciente —
// nenhuma regra de vencido/reiterada/retroativo/reprogramado muda aqui.
export function statusSemestral(item: PepCatalogoItem, plano: PepPlanejamentoSemestral | null, registro: RegistroResumo, hoje: string): StatusSemestral {
  const entregue = registro?.status === "entregue"
  const link = registro?.evidencias?.find(e => e.caminho)?.caminho ?? null

  if (!plano) {
    return { statusLabel: "Planejar", entregue: false, icone: "calendar", link }
  }

  if (entregue) {
    const retroativo = !!(registro?.data_entrega && plano.data_planejada && registro.data_entrega > plano.data_planejada)
    return {
      statusLabel: retroativo ? "Realizado (retroativo)" : "Realizado",
      entregue: true,
      icone: "check",
      link,
    }
  }

  // `hoje` e a data planejada precisam comparar dia contra dia — comparar só a
  // competência (mês) marcava "Vencido" a partir do dia 1º do mês planejado,
  // mesmo quando o dia exato ainda não tinha chegado (ex.: planejado pra
  // 04/09, já aparecia vencido em 03/09).
  const dataPlanejadaISO = plano.data_planejada ?? `${plano.competencia_planejada}-01`
  const vencido = dataPlanejadaISO <= hoje
  const reiterada = vencido && mesesEntre(competenciaDaData(dataPlanejadaISO), competenciaDaData(hoje)) >= 2
  const reprogramado = plano.origem === "reprogramacao_impedimento" && !vencido
  const statusLabel = reprogramado ? "Reprogramado (REP-)" : reiterada ? "Pendência reiterada" : vencido ? "Vencido" : "Entrega pendente"
  return { statusLabel, entregue: false, icone: statusLabel !== "Entrega pendente" ? "alert" : null, link }
}

function temEvidencia(registro: RegistroResumo): boolean {
  return !!registro?.evidencias?.some(e => e.caminho)
}

export function CelulaRecorrente({ item, pacienteNome, semanasCalendario, registro, onClick, disabled }: {
  item: PepCatalogoItem
  pacienteNome: string | null
  semanasCalendario: number
  registro: RegistroResumo
  onClick: () => void
  disabled?: boolean
}) {
  const { esperado, entregue, completo } = statusRecorrente(item, semanasCalendario, registro)
  // Um check por unidade esperada, na cor de quem marcou (violeta robô, azul
  // pessoa); vazio = pendente. A célula diz completo/parcial/pendente.
  const unidades = Array.from({ length: esperado }, (_, i) => (i < entregue ? origemDaUnidade(registro?.evidencias, i) : null))
  const { robo, humano } = contarOrigem(registro)
  const quem = [robo ? `${robo} do robô` : "", humano ? `${humano} de pessoa` : ""].filter(Boolean).join(", ")
  const ajustes = useContarAjustes(registro?.evidencias, pacienteNome, item)
  const classeEstado = completo
    ? `border-emerald-200 dark:border-emerald-800 ${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}`
    : entregue > 0
      ? `border-amber-200 dark:border-amber-800 ${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text}`
      : "border-border bg-background text-muted-foreground hover:bg-muted/50"

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Faturamento liberado — reabra para editar" : `${item.nome} — ${entregue} de ${esperado}${quem ? ` (${quem})` : ""}`}
      className={`inline-flex min-h-11 sm:min-h-0 items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${classeEstado}`}
    >
      <span className="font-semibold">{item.sigla} {entregue}/{esperado}</span>
      <span className="inline-flex items-center gap-0.5">
        {unidades.map((o, i) => <SeloUnidade key={i} origem={o} tamanho={14} />)}
      </span>
      {temEvidencia(registro) && <Paperclip size={11} aria-hidden />}
      <SeloAjustarNome quantidade={ajustes} />
    </button>
  )
}

// Célula da matriz semestral — irmã visual de CelulaRecorrente. Datas e link
// da evidência ficam no PainelSemestral (aberto no clique); aqui só o status.
export function CelulaSemestral({ paciente, item, plano, registro, hoje, onClick, disabled }: {
  paciente: string
  item: PepCatalogoItem
  plano: PepPlanejamentoSemestral | null
  registro: RegistroResumo
  hoje: string
  onClick: () => void
  disabled?: boolean
}) {
  const { statusLabel, entregue, icone } = statusSemestral(item, plano, registro, hoje)
  const ajustes = useContarAjustes(registro?.evidencias, paciente, item)
  const reiterada = statusLabel === "Pendência reiterada"
  const vencido = statusLabel === "Vencido"
  const reprogramado = statusLabel === "Reprogramado (REP-)"
  const pendente = statusLabel === "Entrega pendente"

  const origem = entregue ? origemDaUnidade(registro?.evidencias, 0) : null
  const classeEstado = entregue
    ? `border-emerald-200 dark:border-emerald-800 ${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}`
    : reiterada
      ? `border-rose-300 dark:border-rose-700 ${TONE_SOFT.red.bg} ${TONE_SOFT.red.text} font-semibold`
      : vencido
        ? `border-rose-200 dark:border-rose-800 ${TONE_SOFT.red.bg} ${TONE_SOFT.red.text}`
        : reprogramado
          ? `border-dashed border-slate-400 dark:border-slate-500 ${TONE_SOFT.slate.bg} ${TONE_SOFT.slate.text}`
          : pendente
            ? "border-border bg-background text-muted-foreground hover:bg-muted/50"
            : `border-amber-200 dark:border-amber-800 ${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text}`

  const rotuloExibido = reiterada ? "Reiterada" : statusLabel

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled
        ? "Faturamento liberado — reabra para editar"
        : `${item.nome} · ${paciente} — ${statusLabel}${plano?.data_planejada ? ` (planejado para ${formatarDataBR(plano.data_planejada)})` : ""}${!entregue && plano ? " — clique para marcar como entregue" : ""}`}
      className={`inline-flex min-h-11 sm:min-h-0 w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${classeEstado}`}
    >
      {icone === "check" && <SeloUnidade origem={origem ?? "humano"} tamanho={14} />}
      {icone === "alert" && <AlertTriangle size={13} />}
      {icone === "calendar" && <CalendarPlus size={13} />}
      {rotuloExibido}
      {origem && <span className="sr-only"> por {ORIGEM[origem].rotulo}</span>}
      {temEvidencia(registro) && <Paperclip size={11} aria-hidden />}
      <SeloAjustarNome quantidade={ajustes} />
    </button>
  )
}

function BlocoMotivoConfirmacao({ mensagem, valorInicial, onMudar, erro }: {
  mensagem: string
  valorInicial: string
  onMudar: (valor: string) => void
  erro?: string | null
}) {
  const [valor, setValor] = useState(valorInicial)
  return (
    <div className="space-y-3 whitespace-normal font-normal text-foreground">
      <p className="text-xs text-muted-foreground">{mensagem}</p>
      <div className="space-y-1.5">
        <label htmlFor="pep-confirm-motivo" className={rotulo}>
          Motivo
        </label>
        <textarea
          id="pep-confirm-motivo"
          value={valor}
          onChange={e => {
            setValor(e.target.value)
            onMudar(e.target.value)
          }}
          rows={2}
          placeholder="Descreva o motivo (fica na trilha de auditoria)"
          className={campo}
        />
      </div>
      {erro && <p className="text-xs font-medium text-rose-700 dark:text-rose-400">{erro}</p>}
    </div>
  )
}

/**
 * Abre o diálogo de confirmação padrão (`useConfirmacao`) solicitando motivo
 * obrigatório para a trilha de auditoria (PRD Seção 11.4).
 */
export async function confirmarComMotivo(
  confirmar: (p: PedidoConfirmacao) => Promise<boolean>,
  opcoes: {
    titulo: string
    mensagem: string
    confirmLabel: string
    t?: Tom
    motivoRef: MutableRefObject<string>
    erro?: string | null
  }
): Promise<string | null> {
  let erroLocal = opcoes.erro ?? null
  while (true) {
    const valorInicial = opcoes.motivoRef.current
    const ok = await confirmar({
      titulo: opcoes.titulo,
      texto: (
        <BlocoMotivoConfirmacao
          mensagem={opcoes.mensagem}
          valorInicial={valorInicial}
          onMudar={v => { opcoes.motivoRef.current = v }}
          erro={erroLocal}
        />
      ),
      confirmar: opcoes.confirmLabel,
      t: opcoes.t ?? "verde",
    })
    if (!ok) return null
    const textoMotivo = opcoes.motivoRef.current.trim()
    if (textoMotivo) return textoMotivo
    erroLocal = "Informe o motivo para continuar."
    toast.error("Informe o motivo para continuar.")
  }
}
