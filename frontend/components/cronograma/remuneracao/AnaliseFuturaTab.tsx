"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  CalendarDays, CheckCircle2, Search, X, ChevronDown, ChevronUp,
  AlertTriangle, Users, TrendingUp, TrendingDown, Building2, FileQuestion,
  Download, Wallet, PieChart, Clock, UserMinus,
} from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { useAnaliseFutura } from "@/hooks/useRemuneracao"
import { useParametrosGerais } from "@/hooks/useParametrosGerais"
import { fmt, fmtH, fmtPct } from "@/lib/remuneracao/formatacao"
import { B } from "@/lib/cronograma/constants"
import { DOW_PT } from "@/lib/cronograma/ocupacaoConst"
// regrasCapacidadeTexto vem de ocupacaoProf.ts (não de lib/remuneracao/ocupacao.ts)
// porque a ocupação em si agora é calculada por esse mesmo motor — ver calculo.ts.
import { regrasCapacidadeTexto } from "@/lib/cronograma/ocupacaoProf"
import { OcupacaoDonut } from "@/components/cronograma/indicadores/OcupacaoDonut"
// Mesmo componente usado em cronograma/indicadores — clonado aqui (não
// reimplementado) para garantir que "Agenda Disponibilizada" mostre exatamente
// a mesma grade/contagem daquela tela, sem duplicar a lógica de agregação.
import { AgendaMinimalista } from "@/components/cronograma/indicadores/AgendaMinimalista"
import { exportarAnaliseXlsx } from "@/lib/remuneracao/exportAnaliseFutura"
import type { ProfissionalAnalise, TerapiaDetalhe } from "@/lib/remuneracao/calculo"

// ─── Chip / badge tonal (dark-mode aware — mesma convenção do item 7) ─────────

type Tone = "green" | "amber" | "blue" | "purple" | "red" | "slate"

const TONE_CLS: Record<Tone, { bg: string; text: string }> = {
  green:  { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400" },
  amber:  { bg: "bg-amber-50 dark:bg-amber-950/30",     text: "text-amber-700 dark:text-amber-400" },
  blue:   { bg: "bg-sky-50 dark:bg-sky-950/30",         text: "text-sky-700 dark:text-sky-400" },
  purple: { bg: "bg-violet-50 dark:bg-violet-950/30",   text: "text-violet-700 dark:text-violet-400" },
  red:    { bg: "bg-rose-50 dark:bg-rose-950/30",       text: "text-rose-700 dark:text-rose-400" },
  slate:  { bg: "bg-slate-100 dark:bg-slate-800/60",    text: "text-slate-600 dark:text-slate-400" },
}

function Chip({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  const c = TONE_CLS[tone]
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${c.bg} ${c.text}`}>
      {children}
    </span>
  )
}

// ─── Dropdown de checkboxes para adicionar filtros de especialidade ──────────

function EspecialidadeCheckboxDropdown({
  options, selected, onToggle,
}: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) setBusca("")
  }, [open])

  const filtrados = options.filter(t => t.toLowerCase().includes(busca.toLowerCase()))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-popover px-3 py-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        + especialidade
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
          <div className="relative mb-1.5">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar especialidade…"
              aria-label="Buscar especialidade"
              className="w-full rounded-md border border-border bg-muted/50 pl-7 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div role="listbox" aria-label="Filtrar por especialidade" className="max-h-56 overflow-y-auto">
            {filtrados.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma especialidade encontrada.</div>
            )}
            {filtrados.map(t => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-popover-foreground hover:bg-muted/70"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(t)}
                  onChange={() => onToggle(t)}
                  className="h-3.5 w-3.5 rounded border-border accent-sky-600 dark:accent-sky-500"
                />
                {t}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card premium (mesmo tratamento visual do CardRemun.tsx usado em
// relacionamento-prestador/rp/): faixa de gradiente no topo + ícone circular
// tonal + rótulo. Reaproveitado pelos 4 cards de resumo do profissional. ─────

const ICON_BG: Record<Tone, string> = {
  green:  "bg-emerald-100 dark:bg-emerald-900/40",
  amber:  "bg-amber-100 dark:bg-amber-900/40",
  blue:   "bg-sky-100 dark:bg-sky-900/40",
  purple: "bg-violet-100 dark:bg-violet-900/40",
  red:    "bg-rose-100 dark:bg-rose-900/40",
  slate:  "bg-slate-200 dark:bg-slate-800",
}

const TONE_ACCENT: Record<Tone, string> = {
  // slate usa um cinza médio (não B.navy) — B.navy é escuro demais pra servir
  // de cor de ícone/faixa em cima de fundo já escuro no dark mode.
  green: B.green, amber: B.amber, blue: B.blue, purple: B.purple, red: B.red, slate: "#64748b",
}

function StatCardShell({
  tone, icon, label, children,
}: { tone: Tone; icon: React.ReactNode; label: string; children: React.ReactNode }) {
  const c = TONE_CLS[tone]
  const accent = TONE_ACCENT[tone]
  return (
    <div className={`rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full flex flex-col ${c.bg}`}>
      <div className="h-1 w-full shrink-0" style={{ background: `linear-gradient(90deg, ${accent}cc, ${accent}33)` }} />
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${ICON_BG[tone]}`} style={{ color: accent }}>
            {icon}
          </div>
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── KPI agregado (linha de resumo do topo) ───────────────────────────────────

function SummaryTile({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: Tone }) {
  const c = TONE_CLS[tone]
  return (
    <div className={`rounded-2xl border border-border p-4 ${tone === "slate" ? "bg-card" : c.bg}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone === "slate" ? "text-foreground" : c.text}`}>{value}</div>
    </div>
  )
}

// ─── Card: Contrato Antigo ─────────────────────────────────────────────────

// Linha "valor em cima, descrição embaixo": empilhado e alinhado à esquerda —
// não depende de quanto espaço sobra na linha, então nunca quebra de forma
// imprevisível num card estreito. Escala fixa (text-md/text-xs) em vez de
// tamanhos soltos em px, pra manter tudo consistente entre os cards.
function LinhaValorDescricao({ valor, descricao, tone = "default" }: { valor: React.ReactNode; descricao: React.ReactNode; tone?: "default" | "muted" }) {
  return (
    <div>
      <div className={`text-md font-bold tabular-nums leading-tight ${tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>{valor}</div>
      <div className="text-xs text-muted-foreground leading-snug mt-0.5">{descricao}</div>
    </div>
  )
}

function ContratoAntigoCard({ d }: { d: ProfissionalAnalise }) {
  return (
    <StatCardShell tone="slate" icon={<Building2 size={15} />} label="Contrato antigo / mês">
      {d.temAntigo ? (
        <>
          {d.contrato && (
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground self-start">
              {d.contrato}
            </div>
          )}
          <div className="font-black text-3xl leading-tight mt-2 text-foreground tabular-nums">{fmt(d.salAntigo!)}</div>

          {d.valorHoraDerivado !== null && (
            <div className="mt-3">
              <LinhaValorDescricao
                valor={fmt(d.valorHoraDerivado)}
                descricao="valor/hora (calculado: valor total ÷ horas agendadas no mês)"
                tone="muted"
              />
            </div>
          )}

          <div className="mt-3 rounded-xl border border-border bg-card px-3.5 py-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={12} />
                Carga agendada
              </span>
              <strong className="text-sm font-bold tabular-nums text-foreground">{fmtH(d.horasSemanaTotal)}</strong>
            </div>

            {d.diasTrabalhados.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.diasTrabalhados.map(dt => (
                  <span key={dt.dow} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
                    <span className="font-semibold text-foreground">{DOW_PT[dt.dow]}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtH(dt.horas)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-1.5 py-3 text-center">
          <FileQuestion size={20} className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground italic">
            {d.contrato ? "Novo modelo" : "Sem contrato antigo cadastrado"}
          </p>
        </div>
      )}
    </StatCardShell>
  )
}

// ─── Card: Banco de Horas (contrato vigente de valor fixo) ────────────────────

// Contrato vigente com modelo_faturamento = "banco_horas": o profissional recebe
// um valor total fixo no período, não PA por sessão — então este card substitui
// os dois de projeção por presença (que não faz diferença num valor fixo). O
// valor/hora é derivado, nunca cadastrado: valor fixo ÷ horas agendadas no mês.
function BancoDeHorasCard({ d, presenca }: { d: ProfissionalAnalise; presenca: number | null }) {
  const c = TONE_CLS.amber
  // Só o valor fixo: em banco de horas puro o cálculo já zera PA, PPD, ETA e PEP na
  // origem. No híbrido eles continuam existindo, mas vêm do contrato de
  // atendimento ao lado — quem os mostra são os cards de presença, não este.
  const soFixo = d.modalidade === "banco_horas"
  const semValorCadastrado = d.valorFixoBancoHoras === null

  return (
    <StatCardShell tone="amber" icon={<Wallet size={15} />} label="Banco de horas / mês">
      {d.numerosBancoHoras.length > 0 && (
        <div className="flex flex-wrap gap-1.5 self-start mb-2">
          {d.numerosBancoHoras.map(n => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground">
              {n}
            </span>
          ))}
        </div>
      )}

      <div className={`font-black text-3xl leading-tight tabular-nums ${c.text}`}>{fmt(d.valorFixoBancoHoras ?? 0)}</div>

      {d.valorHoraBancoHoras !== null && (
        <div className="mt-3">
          <LinhaValorDescricao
            valor={fmt(d.valorHoraBancoHoras)}
            descricao="valor/hora (calculado: valor fixo ÷ horas agendadas no mês)"
            tone="muted"
          />
        </div>
      )}

      {semValorCadastrado && (
        <p className={`mt-2 text-xs font-semibold leading-snug ${TONE_CLS.red.text}`}>
          Contrato em banco de horas sem valor total cadastrado em Cadastros › Contratos.
          Enquanto ficar assim, a previsão deste profissional é zero.
        </p>
      )}

      {soFixo && (
        <p className="mt-3 text-xs text-muted-foreground leading-snug">
          É a remuneração inteira: PA por sessão, PPD, bônus ETA e PEP não se somam a um contrato
          de valor fixo.
        </p>
      )}

      <div className="mt-3 rounded-xl border border-border bg-card px-3.5 py-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={12} />
            Carga agendada
          </span>
          <strong className="text-sm font-bold tabular-nums text-foreground">{fmtH(d.horasSemanaTotal)}</strong>
        </div>

        {d.diasTrabalhados.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d.diasTrabalhados.map(dt => (
              <span key={dt.dow} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
                <span className="font-semibold text-foreground">{DOW_PT[dt.dow]}</span>
                <span className="text-muted-foreground tabular-nums">{fmtH(dt.horas)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground leading-snug">
        Fora de “Total 100%” e “Total {presenca ?? "—"}%” — valor fixo não varia com presença. Somado em “Total banco de horas”.
      </p>
    </StatCardShell>
  )
}

// ─── Card: projeção de presença (100% / X%) ───────────────────────────────────

function PresencaCard({
  d, variante, presenca,
}: {
  d: ProfissionalAnalise
  variante: "100" | "x"
  presenca: number | null
}) {
  const is100 = variante === "100"
  const total = is100 ? d.total100 : d.totalX
  const delta = is100 ? d.delta100 : d.deltaX
  const ppd = d.terapiaDetails.filter(t => !t.isCC).reduce((s, t) => s + (t.mensalDiaria || 0), 0)
  const pa = d.terapiaDetails.reduce((s, t) => s + (is100 ? t.mensalPA100 : t.mensalPAX), 0)
  const etaBonusTotal = d.terapiaDetails.reduce((s, t) => s + (t.mensalETA100 || 0), 0)
  const temPpd = d.terapiaDetails.some(t => !t.isCC && t.mensalDiaria > 0)
  const temEta = d.terapiaDetails.some(t => t.isETA && t.mensalETA100 > 0)
  const tone: Tone = is100 ? "green" : "blue"
  const c = TONE_CLS[tone]

  return (
    <StatCardShell
      tone={tone}
      icon={<Wallet size={15} />}
      label={`Contrato novo (PA) - ${is100 ? "100%" : `${presenca ?? "—"}%`} presença`}
    >
      <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground self-start mb-2">
        {d.contratoNovo ?? "PS.ABA-PENDENTE"}
      </div>
      <div className={`font-black text-3xl tabular-nums ${c.text}`}>{fmt(total)}</div>

      <div className="mt-3 space-y-2.5">
        <LinhaValorDescricao valor={fmt(pa)} descricao="PA · pagamento por atendimento" />
        {temPpd && <LinhaValorDescricao valor={fmt(ppd)} descricao="PPD · pagamento por diária" />}
        {temEta && <LinhaValorDescricao valor={fmt(etaBonusTotal)} descricao="Bônus ETA" />}
        {d.pe > 0 && <LinhaValorDescricao valor={fmt(d.pe)} descricao="PEP · parcela por entregas por paciente" />}
      </div>

      {delta !== null && (
        <div className={`flex items-center gap-1 text-xs font-semibold mt-auto pt-3 ${delta >= 0 ? "text-[var(--status-ok)]" : "text-rose-600 dark:text-rose-400"}`}>
          {delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {fmtPct(delta)} vs contrato antigo
        </div>
      )}
    </StatCardShell>
  )
}

// ─── Expansível: dias trabalhados ─────────────────────────────────────────────

// Larguras compartilhadas pela tabela principal (6 colunas) e pela sub-tabela
// de PPD (que reusa as mesmas 6 colunas via colSpan) — garante que "Dia" e
// "Ocorr." fiquem alinhados entre as duas tabelas do mesmo card e também
// entre os cards de terapias diferentes empilhados na tela (table-fixed usa
// % do próprio elemento, não o conteúdo, então não varia por bloco).
const DIAS_COL_WIDTHS = ["24%", "12%", "14%", "14%", "18%", "18%"]

function DiasColGroup() {
  return (
    <colgroup>
      {DIAS_COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
    </colgroup>
  )
}

function TerapiaDiasBloco({ td, presenca, ccPA, ccPE, etaBonus }: {
  td: TerapiaDetalhe; presenca: number; ccPA: number; ccPE: number; etaBonus: number
}) {
  const tone: Tone = td.isCC ? "purple" : "blue"
  const c = TONE_CLS[tone]
  return (
    <div className={`rounded-xl p-3 ${c.bg}`}>
      <div className={`font-semibold text-xs mb-2 ${c.text}`}>
        {td.terp}
        <span className="ml-2 font-normal text-muted-foreground">
          {td.isCC ? <>PA: {fmt(ccPA)}/sessão · PEP: {fmt(ccPE)}/pac.</> : <>PA: {fmt(td.pa)}/sessão · PPD: {fmt(td.diar)}/dia</>}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs mb-1">
          <DiasColGroup />
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left py-0.5 font-medium">Dia</th>
              <th className="text-center font-medium">Sess/sem</th>
              <th className="text-center font-medium">Ocorr.</th>
              <th className="text-center font-medium">Sess/mês</th>
              <th className="text-right font-medium">PA 100%</th>
              <th className="text-right font-medium">PA {presenca}%</th>
            </tr>
          </thead>
          <tbody>
            {td.dowBreak.map(b => (
              <tr key={b.dow} className="border-t border-white/40 dark:border-black/20">
                <td className="py-1 font-medium text-foreground">{DOW_PT[b.dow]}</td>
                <td className="text-center text-foreground tabular-nums">{b.cnt}</td>
                <td className="text-center text-foreground tabular-nums">
                  <span className="inline-flex items-center justify-center gap-1">
                    {b.occ}
                    {b.feriados.length > 0 && (
                      <span className="text-[var(--status-atencao)]" title={b.feriados.map(f => f.nome).join(", ")}>
                        −{b.feriados.length}
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-center font-semibold text-foreground tabular-nums">{b.mensal}</td>
                <td className="text-right text-foreground tabular-nums">{fmt(b.mensal * td.pa)}</td>
                <td className="text-right text-foreground tabular-nums">{fmt(b.mensal * (presenca / 100) * td.pa)}</td>
              </tr>
            ))}
            {td.isCC && (
              <tr className={c.text}>
                <td colSpan={3} className="text-xs pt-1.5 truncate">PEP ({td.pacientes} pac. × {fmt(ccPE)})</td>
                <td />
                <td className="text-right font-bold tabular-nums">{fmt(td.pacientes * ccPE)}</td>
                <td className="text-right font-bold tabular-nums">{fmt(td.pacientes * ccPE)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!td.isCC && td.diar > 0 && td.diariasDetalhe.length > 0 && (
        <div className="border-t border-white/40 dark:border-black/20 pt-2 mt-1">
          <div className="text-xs font-semibold mb-1 text-orange-700 dark:text-orange-400">
            PPD — Pagamento por Diária ({fmt(td.diar)}/dia)
          </div>
          <table className="w-full table-fixed text-xs">
            <DiasColGroup />
            <tbody>
              {td.diariasDetalhe.map(dd => (
                <tr key={dd.dow} className="border-t border-white/40 dark:border-black/20">
                  <td className="py-0.5 font-medium text-foreground">{DOW_PT[dd.dow]}</td>
                  <td />
                  <td className="text-center text-foreground tabular-nums">
                    <span className="inline-flex items-center justify-center gap-1">
                      {dd.occ}
                      {dd.feriados.length > 0 && <span className="text-[var(--status-atencao)]">−{dd.feriados.length}</span>}
                    </span>
                  </td>
                  <td colSpan={3} className="text-right font-semibold text-orange-700 dark:text-orange-400 tabular-nums">{fmt(dd.valor)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black/10 dark:border-white/10 font-bold">
                <td colSpan={3} className="py-1 text-foreground">Total PPD/mês</td>
                <td colSpan={3} className="text-right text-orange-700 dark:text-orange-400 tabular-nums">{fmt(td.mensalDiaria)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {td.isETA && (
        <div className="border-t border-white/40 dark:border-black/20 pt-2 mt-2">
          <div className="text-xs font-semibold mb-2 text-orange-700 dark:text-orange-400">Bônus ETA</div>
          <div className="rounded-lg p-2 grid grid-cols-3 gap-1 text-xs bg-orange-50/70 dark:bg-orange-950/30">
            <div className="text-center">
              <div className="text-muted-foreground">Semanas ETA</div>
              <div className="font-bold text-lg text-orange-700 dark:text-orange-400">{td.etaWeeks}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Bônus/semana</div>
              <div className="font-bold text-lg text-orange-700 dark:text-orange-400">{fmt(etaBonus)}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Total ETA/mês</div>
              <div className="font-bold text-lg text-orange-700 dark:text-orange-400">{fmt(td.mensalETA100)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card do profissional ──────────────────────────────────────────────────

type SecaoExpandida = "dias" | "pacs" | "agenda" | null

function ProfissionalCard({
  d, exp, onToggle, presenca, ccPA, ccPE, etaBonus, feriadosMes,
}: {
  d: ProfissionalAnalise
  exp: SecaoExpandida
  onToggle: (tipo: Exclude<SecaoExpandida, null>) => void
  presenca: number
  ccPA: number
  ccPE: number
  etaBonus: number
  feriadosMes: Array<{ date: string; nome: string; dow: number }>
}) {
  const regraTexto = regrasCapacidadeTexto(d)
  // B.navy é escuro demais pra faixa de gradiente em cima de fundo já escuro no
  // dark mode (mesmo ajuste do TONE_ACCENT.slate acima).
  const corTopo = d.hasCC ? B.purple : d.hasTA ? B.blue : d.hasAE ? B.orange : "#64748b"

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${corTopo}cc, ${corTopo}33)` }} />

      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-bold text-base text-foreground">{d.prof}</div>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {d.terapiaDetails.map(t => (
              <Chip key={t.terp} tone={t.isCC ? "purple" : t.isETA ? "amber" : "blue"}>
                {t.terp} · {t.sessoesMes100} sess/mês
                {t.isETA && t.etaSessoesSemana > 0 && <span className="opacity-70">+{t.etaSessoesSemana} ETA</span>}
              </Chip>
            ))}
          </div>

          {regraTexto && <div className="text-xs mt-1.5 text-violet-700 dark:text-violet-400">{regraTexto}</div>}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {d.desligado && (
            <Chip tone="red" title="Inativado no TiTa. Continua listado no mês do desligamento e no seguinte, por questão de pagamento.">
              <UserMinus size={12} />
              Desligado
            </Chip>
          )}
          {d.modalidade !== "atendimento" && (
            <Chip
              tone={d.valorFixoBancoHoras === null ? "red" : "amber"}
              title={d.valorFixoBancoHoras === null
                ? `Contrato ${d.numerosBancoHoras.join(" / ") || "vigente"} está marcado como banco de horas, mas sem valor total cadastrado em Cadastros › Contratos.`
                : d.modalidade === "hibrido"
                  ? "Tem contrato vigente em banco de horas e em atendimento — recebe pelos dois."
                  : "Contrato vigente em banco de horas: o valor fixo é a remuneração inteira, sem PA, PPD, ETA ou PEP por cima."}
            >
              <Wallet size={12} />
              {d.valorFixoBancoHoras === null
                ? "Banco de horas sem valor cadastrado"
                : d.modalidade === "hibrido" ? "Banco de horas + PA" : "Banco de horas"}
            </Chip>
          )}
          {d.alertaCC && (
            <Chip tone="red">
              <AlertTriangle size={12} />
              CC: {d.pacCC}/{d.limiteCC} pac.
            </Chip>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
        <ContratoAntigoCard d={d} />
        {/* Banco de horas puro dispensa os cards de projeção por presença (o valor é
            fixo), então o card ocupa as duas colunas que eles deixaram. No híbrido os
            dois convivem: o profissional recebe pelos dois contratos. */}
        {d.modalidade === "banco_horas" ? (
          <div className="sm:col-span-2">
            <BancoDeHorasCard d={d} presenca={presenca} />
          </div>
        ) : (
          <>
            {d.modalidade === "hibrido" && <BancoDeHorasCard d={d} presenca={presenca} />}
            <PresencaCard d={d} variante="100" presenca={presenca} />
            <PresencaCard d={d} variante="x" presenca={presenca} />
          </>
        )}
        <StatCardShell tone="slate" icon={<PieChart size={15} />} label="Resumo da ocupação">
          <div className="flex-1 flex flex-col items-center justify-center">
            <OcupacaoDonut item={d} size={128} centerFillClassName="fill-slate-100 dark:fill-slate-800" />
          </div>
          {d.ocupacao && (
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div className={`rounded-lg px-2.5 py-2 text-center ${TONE_CLS.red.bg} ${TONE_CLS.red.text}`}>
                <strong className="block text-sm tabular-nums">{fmtH(d.ocupacao.horasOcupadas)}</strong>
                ocupadas
              </div>
              <div className={`rounded-lg px-2.5 py-2 text-center ${TONE_CLS.green.bg} ${TONE_CLS.green.text}`}>
                <strong className="block text-sm tabular-nums">{fmtH(d.ocupacao.horasLivres)}</strong>
                livres
              </div>
            </div>
          )}
        </StatCardShell>
      </div>

      <div className="px-4 pb-3 pt-1 flex gap-4 flex-wrap border-t border-border">
        <button
          type="button"
          onClick={() => onToggle("dias")}
          className="inline-flex items-center gap-1 text-xs font-semibold pt-2 text-foreground hover:opacity-70 transition-opacity"
        >
          {exp === "dias" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Dias trabalhados
        </button>
        <button
          type="button"
          onClick={() => onToggle("pacs")}
          className="inline-flex items-center gap-1 text-xs font-semibold pt-2 text-muted-foreground hover:opacity-70 transition-opacity"
        >
          {exp === "pacs" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Pacientes ({d.allPacs.length})
        </button>
        <button
          type="button"
          onClick={() => onToggle("agenda")}
          className="inline-flex items-center gap-1 text-xs font-semibold pt-2 text-muted-foreground hover:opacity-70 transition-opacity"
        >
          {exp === "agenda" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Agenda Disponibilizada
        </button>
      </div>

      {exp === "dias" && (
        <div className="px-4 pb-4 space-y-3 pt-1">
          {feriadosMes.length > 0 && (
            <div className="rounded-lg px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
              <span className="font-semibold flex items-center gap-1"><CalendarDays size={12} /> Feriados descontados:</span>
              {feriadosMes.map(f => (
                <span key={f.date}><strong>{f.date.slice(5)}</strong> {f.nome} ({DOW_PT[f.dow]})</span>
              ))}
            </div>
          )}
          {d.terapiaDetails.map(td => (
            <TerapiaDiasBloco key={td.terp} td={td} presenca={presenca} ccPA={ccPA} ccPE={ccPE} etaBonus={etaBonus} />
          ))}
        </div>
      )}

      {exp === "pacs" && (
        <div className="px-4 pb-4 pt-1">
          {d.allPacs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum paciente nesta grade.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {d.allPacs.map(p => (
                <div key={p} className="text-xs px-2.5 py-1.5 rounded-lg bg-muted/50 text-foreground">{p}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {exp === "agenda" && (
        <div className="px-4 pb-4 pt-1">
          <AgendaMinimalista ocupacao={d.ocupacao} />
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────

type SortKey = "alpha" | "delta_desc" | "delta_asc" | "ocup_desc" | "ocup_asc"

const SORT_OPTIONS: { k: SortKey; l: string }[] = [
  { k: "alpha", l: "A–Z" },
  { k: "delta_desc", l: "Maior % vs antigo" },
  { k: "delta_asc", l: "Menor % vs antigo" },
  { k: "ocup_desc", l: "Maior ocupação" },
  { k: "ocup_asc", l: "Menor ocupação" },
]

export function AnaliseFuturaTab() {
  const { resultado, refWeek, analMes, presenca, loading, error, avisoContratos, gradeVazia, totalGrade } = useAnaliseFutura()
  const { parametros } = useParametrosGerais()
  const { setHeader, setRightContent } = useHeader()

  const ccPA = parametros?.cc_pa_default ?? 50
  const ccPE = parametros?.cc_pe_default ?? 100
  const etaBonus = parametros?.eta_bonus_default ?? 100
  const presencaNum = presenca ?? 80

  const [busca, setBusca] = useState("")
  const [filtrosEsp, setFiltrosEsp] = useState<string[]>(["todos"])
  const [sortKey, setSortKey] = useState<SortKey>("alpha")
  const [expandido, setExpandido] = useState<Record<string, SecaoExpandida>>({})

  useEffect(() => {
    setHeader("Rem. Mês - Previsão", "Relacionamento Prestador")
    setRightContent(
      <div className="flex items-center gap-4">
        {totalGrade > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 px-3 py-1 text-xs font-medium">
            <CheckCircle2 size={11} className="text-green-500 dark:text-green-400" />
            Grade · {totalGrade.toLocaleString("pt-BR")} horários
          </span>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays size={11} />
          <span className="font-medium text-foreground/60">Período</span>
          <span>{refWeek.label}</span>
        </div>
      </div>
    )
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent, refWeek.label, totalGrade])

  const dadosPorProf = resultado?.dadosPorProf ?? []

  const allTerps = resultado?.allTerps ?? []

  const dadosFiltrados = useMemo(() => {
    let r = dadosPorProf
    const q = busca.trim().toLowerCase()
    if (q) r = r.filter(d => d.prof.toLowerCase().includes(q))
    if (filtrosEsp.length > 0 && !filtrosEsp.includes("todos")) {
      r = r.filter(d => filtrosEsp.some(f => d.terapiaDetails.some(t => t.terp === f)))
    }
    return r
  }, [dadosPorProf, busca, filtrosEsp])

  const dadosOrdenados = useMemo(() => {
    return [...dadosFiltrados].sort((a, b) => {
      if (sortKey === "delta_desc" || sortKey === "delta_asc") {
        if (a.delta100 === null && b.delta100 === null) return a.prof.localeCompare(b.prof)
        if (a.delta100 === null) return 1
        if (b.delta100 === null) return -1
        return sortKey === "delta_desc" ? b.delta100 - a.delta100 : a.delta100 - b.delta100
      }
      if (sortKey === "ocup_desc" || sortKey === "ocup_asc") {
        if (a.taxaOcupacao === null && b.taxaOcupacao === null) return a.prof.localeCompare(b.prof)
        if (a.taxaOcupacao === null) return 1
        if (b.taxaOcupacao === null) return -1
        return sortKey === "ocup_desc" ? b.taxaOcupacao - a.taxaOcupacao : a.taxaOcupacao - b.taxaOcupacao
      }
      return a.prof.localeCompare(b.prof)
    })
  }, [dadosFiltrados, sortKey])

  const { tot100, totX, alerts, totalAntigo, pendContr, totalBancoHoras } = useMemo(() => ({
    tot100: dadosFiltrados.reduce((s, d) => s + d.total100, 0),
    totX: dadosFiltrados.reduce((s, d) => s + d.totalX, 0),
    alerts: dadosPorProf.filter(d => d.alertaCC).length,
    totalAntigo: dadosFiltrados.filter(d => d.temAntigo).reduce((s, d) => s + (d.salAntigo || 0), 0),
    pendContr: dadosFiltrados.filter(d => !d.temAntigo).length,
    // Valor fixo fica à parte de tot100/totX: não varia com presença, então somá-lo
    // ali misturaria duas coisas diferentes no mesmo número.
    totalBancoHoras: dadosFiltrados.reduce((s, d) => s + (d.valorFixoBancoHoras || 0), 0),
  }), [dadosFiltrados, dadosPorProf])

  const toggleFiltro = (key: string) => {
    if (key === "todos") { setFiltrosEsp(["todos"]); return }
    setFiltrosEsp(cur => {
      const sem = cur.filter(x => x !== "todos")
      if (sem.includes(key)) {
        const next = sem.filter(x => x !== key)
        return next.length ? next : ["todos"]
      }
      return [...sem, key]
    })
  }
  const filtroAtivo = (key: string) => (key === "todos" ? filtrosEsp.includes("todos") || !filtrosEsp.length : filtrosEsp.includes(key))
  const toggleExp = (prof: string, tipo: Exclude<SecaoExpandida, null>) =>
    setExpandido(e => ({ ...e, [prof]: e[prof] === tipo ? null : tipo }))

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Carregando…</div>
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
  }

  if (gradeVazia || !resultado) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        Nenhum agendamento encontrado para a semana de referência ({refWeek.label}).
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Projeção mensal com base na semana de referência: <strong className="text-foreground">{refWeek.label}</strong>
      </p>

      {avisoContratos && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {avisoContratos}
          </span>
        </div>
      )}

      {/* 5 tiles fixos + os 2 condicionais (banco de horas, alertas CC) — a 7ª
          coluna entra só quando os dois aparecem, pra não sobrar um tile órfão
          numa segunda linha. Ambas as classes precisam existir literais aqui
          para o Tailwind gerá-las. */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${totalBancoHoras > 0 && alerts > 0 ? "lg:grid-cols-7" : "lg:grid-cols-6"}`}>
        <SummaryTile label="Exibindo" value={`${dadosFiltrados.length} de ${dadosPorProf.length}`} tone="blue" />
        <SummaryTile label="Total 100% / mês" value={fmt(tot100)} tone="green" />
        <SummaryTile label={`Total ${presenca ?? "—"}% / mês`} value={fmt(totX)} tone="blue" />
        {totalBancoHoras > 0 && (
          <SummaryTile label="Total banco de horas" value={fmt(totalBancoHoras)} tone="amber" />
        )}
        <SummaryTile label="Total antigo proporcional" value={fmt(totalAntigo)} tone="slate" />
        <SummaryTile label="Dados contratuais pendentes" value={pendContr} tone={pendContr > 0 ? "red" : "slate"} />
        {alerts > 0 && (
          <SummaryTile
            label="Alertas CC"
            value={<span className="inline-flex items-center gap-1"><AlertTriangle size={18} />{alerts}</span>}
            tone="red"
          />
        )}
      </div>

      {resultado.feriadosMes.length > 0 && (
        <div className="rounded-xl px-4 py-2.5 text-xs flex flex-wrap gap-x-3 gap-y-1 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
          <span className="font-semibold flex items-center gap-1"><CalendarDays size={12} /> Feriados no mês:</span>
          {resultado.feriadosMes.map(f => (
            <span key={f.date} className="font-medium">{f.date.slice(5)} {f.nome} ({DOW_PT[f.dow]})</span>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar profissional…"
              aria-label="Buscar profissional"
              className="w-full rounded-lg border border-border bg-muted/50 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {busca && (
            <button type="button" onClick={() => setBusca("")} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X size={12} /> limpar
            </button>
          )}
          {(busca || !filtroAtivo("todos")) && (
            <button
              type="button"
              onClick={() => { setBusca(""); setFiltrosEsp(["todos"]) }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:opacity-70 transition-opacity"
            >
              <X size={12} /> limpar tudo
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-between border-t border-border pt-3">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground mr-0.5">Especialidade</span>
            <button
              type="button"
              onClick={() => toggleFiltro("todos")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                filtroAtivo("todos")
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white"
                  : "bg-transparent text-foreground border-border hover:bg-muted/50"
              }`}
            >
              Todos
            </button>
            {filtrosEsp.filter(f => f !== "todos").map(f => (
              <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-600 dark:bg-sky-500 text-white">
                {f}
                <button type="button" onClick={() => toggleFiltro(f)} className="opacity-70 hover:opacity-100 transition-opacity">
                  <X size={11} />
                </button>
              </span>
            ))}
            <EspecialidadeCheckboxDropdown options={allTerps} selected={filtrosEsp} onToggle={toggleFiltro} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ordenar</span>
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {SORT_OPTIONS.map(({ k, l }) => (
                  <option key={k} value={k} className="bg-popover text-popover-foreground">{l}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => exportarAnaliseXlsx({ dadosFiltrados, analMes, presenca: presencaNum, etaBonus, ccPE })}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 active:scale-95 transition-colors"
            >
              <Download size={13} />
              Exportar XLSX
            </button>
          </div>
        </div>
      </div>

      {dadosOrdenados.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <Users size={20} className="text-muted-foreground/50" />
          Nenhum profissional encontrado com esses filtros.
        </div>
      )}

      <div className="space-y-3">
        {dadosOrdenados.map(d => (
          <ProfissionalCard
            key={d.prof}
            d={d}
            exp={expandido[d.prof] ?? null}
            onToggle={tipo => toggleExp(d.prof, tipo)}
            presenca={presencaNum}
            ccPA={ccPA}
            ccPE={ccPE}
            etaBonus={etaBonus}
            feriadosMes={resultado.feriadosMes}
          />
        ))}
      </div>
    </div>
  )
}
