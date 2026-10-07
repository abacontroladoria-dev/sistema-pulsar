"use client"

// Ocupar Profissionais Disponíveis — escolha UM profissional já contratado e
// veja onde a agenda dele tem espaço pra crescer, antes de abrir vaga de
// contratação nova. Mesmo espírito de /cronograma/ocupacao-paciente (escolher
// uma entidade por vez, ver oportunidades na agenda dela), só que na ótica do
// profissional em vez do paciente.
//
// Duas modalidades de oportunidade, calculadas por
// lib/cronograma/ocupacaoProfissional.ts:
//   1) Direto — o profissional já tem um horário "Livre" exato na grade, e
//      existe paciente com sessão pendente (gap) elegível ali.
//   2) Via remanejamento — o horário está ocupado por OUTRO profissional com
//      outro paciente, mas o PACIENTE candidato (não o ocupante) tem uma
//      sessão conflitante nesse horário com ESSE outro profissional, que pode
//      ser movida pra uma ponta adjacente da agenda do próprio paciente,
//      mantendo o outro profissional — liberando o horário pro selecionado.
//      A agenda do profissional selecionado NUNCA perde nada; só ganha.

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, Lock, Sparkles, Users } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { useGradeAgendamentos } from "@/hooks/useGradeAgendamentos"
import { calcularGaps, gapsParaMapa } from "@/lib/cronograma/simulacaoNovoPrestador"
import { listarProfissionaisComOportunidade, gerarOportunidadesProfissional, type OportunidadeProfissional } from "@/lib/cronograma/ocupacaoProfissional"
import { listarSlotsLivres } from "@/lib/cronograma/disponibilidadeInterna"
import { DIAS_UTIL, TODAS_ESP, UNID_COR, normTxt, estiloUnidade, unidadeAbrev, unidadeExibicao } from "@/lib/cronograma/constants"
import { diaCurto, fmtName, filtrarCapacidadeLivreReservada } from "@/lib/cronograma/helpers"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { RemanejamentoDetalheModal } from "./RemanejamentoDetalheModal"
import { PacienteAgendaHipoteticaModal } from "./PacienteAgendaHipoteticaModal"
import { NovoDiaDetalheModal } from "./NovoDiaDetalheModal"
import { OcupacaoCategoriaView } from "./OcupacaoCategoriaView"
import { ProjecaoOcupacaoDonut, type SegmentoOcupacao } from "./ProjecaoOcupacaoDonut"
import type { CsvRow } from "@/types/cronograma"

const TABS = [
  { key: "categoria", label: "Por Unidade, Dia e Especialidade" },
  { key: "nome",      label: "Por Nome do Profissional" },
] as const
type TabKey = (typeof TABS)[number]["key"]

function hiStr(r: CsvRow): string { return String(r.HI_str || "") }

// ─── Combobox de profissional (mesmo padrão ARIA do EspecialidadeCombobox de
//     SimulacaoNovoPrestadorTab.tsx, por sua vez copiado do autocomplete de
//     paciente do OcupPacMode) ─────────────────────────────────────────────
// Nome completo (não abreviado) e a(s) especialidade(s) com horário "Livre"
// aparecem direto na busca — pedido do usuário (2026-08-12): antes só o
// primeiro/último nome apareciam, exigindo abrir a agenda pra saber a
// especialidade de cada profissional.
function ProfissionalCombobox({
  value, onChange, opcoes, contagemLivres, especialidadesPorProfissional,
}: { value: string; onChange: (v: string) => void; opcoes: string[]; contagemLivres: Map<string, number>; especialidadesPorProfissional: Map<string, string[]> }) {
  const [texto, setTexto] = useState(value)
  const [aberto, setAberto] = useState(false)
  const [ativoIdx, setAtivoIdx] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const [ultimoValor, setUltimoValor] = useState(value)
  if (value !== ultimoValor) {
    setUltimoValor(value)
    setTexto(value)
  }

  const filtradas = useMemo(() => {
    const q = normTxt(texto)
    if (!q) return opcoes
    return opcoes.filter(o => normTxt(o).includes(q))
  }, [texto, opcoes])

  const selecionar = (p: string) => { onChange(p); setTexto(p); setUltimoValor(p); setAberto(false); setAtivoIdx(-1) }
  const valida = opcoes.includes(value)

  return (
    <div className="relative w-full sm:w-80">
      <input
        id="ocupar-prof-input"
        type="text"
        autoComplete="off"
        aria-label="Buscar profissional"
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={aberto ? "ocupar-prof-listbox" : undefined}
        value={texto}
        onChange={e => { setTexto(e.target.value); setUltimoValor(""); onChange(""); setAberto(true); setAtivoIdx(-1) }}
        onFocus={() => setAberto(true)}
        onBlur={() => { setTimeout(() => setAberto(false), 150); if (value) setTexto(value) }}
        onKeyDown={e => {
          if (!aberto || !filtradas.length) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            const next = Math.min(ativoIdx + 1, filtradas.length - 1)
            setAtivoIdx(next); listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            const prev = Math.max(ativoIdx - 1, 0)
            setAtivoIdx(prev); listRef.current?.children[prev]?.scrollIntoView({ block: "nearest" })
          } else if (e.key === "Enter") {
            e.preventDefault()
            const idx = ativoIdx >= 0 ? ativoIdx : (filtradas.length === 1 ? 0 : -1)
            if (idx >= 0) selecionar(filtradas[idx])
          } else if (e.key === "Escape") {
            setAberto(false); setAtivoIdx(-1)
            if (value) setTexto(value)
          }
        }}
        placeholder="Digite para buscar um profissional..."
        className={`w-full rounded-lg border px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${valida ? "border-border bg-card" : "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20"}`}
      />
      {aberto && filtradas.length > 0 && (
        <div
          ref={listRef}
          id="ocupar-prof-listbox"
          role="listbox"
          aria-label="Profissionais"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-[100] max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        >
          {filtradas.map((p, i) => {
            const selecionada = p === value
            const ativa = i === ativoIdx
            const especialidades = especialidadesPorProfissional.get(p) ?? []
            return (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={selecionada}
                onMouseDown={e => { e.preventDefault(); selecionar(p) }}
                className={`flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${ativa ? "bg-sky-600 text-white" : selecionada ? "bg-muted font-semibold text-foreground" : "text-foreground hover:bg-muted/60"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p}</span>
                  {especialidades.length > 0 && (
                    <span className={`block truncate text-[11px] font-normal ${ativa ? "text-white/80" : "text-muted-foreground"}`}>
                      {especialidades.join(" · ")}
                    </span>
                  )}
                </span>
                <span className={`shrink-0 text-[10px] font-bold ${ativa ? "text-white/80" : "text-muted-foreground"}`}>
                  {contagemLivres.get(p) ?? 0} livre(s)
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Grade semanal do profissional (existente + oportunidades) ────────────
type TagCelula = "ocupado" | "livre" | "direto" | "remanejamento-mesmo-dia" | "remanejamento-outro-dia" | "novo-dia"

interface CelulaProf {
  tag: TagCelula
  terapia: string
  unidade: string
  paciente?: string
  oportunidade?: OportunidadeProfissional
}

const ESTILO_CELULA: Record<TagCelula, string> = {
  ocupado: "border-border bg-muted",
  livre: "border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/20",
  direto: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 cursor-pointer hover:brightness-95",
  "remanejamento-mesmo-dia": "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 cursor-pointer hover:brightness-95",
  "remanejamento-outro-dia": "border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 cursor-pointer hover:brightness-95",
  "novo-dia": "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 cursor-pointer hover:brightness-95",
}

// Casa a tag da célula com o segmento do donut (ProjecaoOcupacaoDonut) — as 3
// modalidades de oportunidade (direto/remanejamento/novo-dia) contam como um
// único segmento "oportunidade" lá, então precisam mapear pro mesmo valor
// aqui pra saber se a célula deve ficar em destaque quando o usuário clica
// numa fatia/stat-row do donut.
function segmentoDaTag(tag: TagCelula): SegmentoOcupacao {
  return tag === "ocupado" ? "ocupado" : tag === "livre" ? "livre" : "oportunidade"
}

function AgendaProfissional({
  profissional, cRows, onAbrirOportunidade,
}: { profissional: string; cRows: CsvRow[]; onAbrirOportunidade: (o: OportunidadeProfissional) => void }) {
  const { lRows } = useCronogramaData()
  const gapMap = useMemo(() => gapsParaMapa(calcularGaps(lRows, cRows)), [lRows, cRows])
  const oportunidades = useMemo(
    () => gerarOportunidadesProfissional(profissional, cRows, gapMap),
    [profissional, cRows, gapMap],
  )
  const [destaque, setDestaque] = useState<SegmentoOcupacao | null>(null)
  useEffect(() => setDestaque(null), [profissional])

  const mapa = useMemo(() => {
    const m: Record<string, CelulaProf> = {}
    for (const row of cRows) {
      if (row["Profissional"] !== profissional) continue
      const status = row["Status do Agendamento"]
      if (status !== "Agendado" && status !== "Livre") continue
      const chave = `${row["Dia da Semana"]}|||${hiStr(row)}`
      const unidade = String(row.Unidade || "Desconhecida")
      if (status === "Agendado") {
        m[chave] = { tag: "ocupado", terapia: row.Terapia, unidade, paciente: row["Nome Favorecido"] }
      } else if (!m[chave]) {
        m[chave] = { tag: "livre", terapia: row.Terapia, unidade }
      }
    }
    for (const o of oportunidades) {
      const chave = `${o.dia}|||${o.hora}`
      m[chave] = { tag: o.modalidade, terapia: o.terapia, unidade: o.unidade, paciente: o.paciente.pac, oportunidade: o }
    }
    return m
  }, [cRows, profissional, oportunidades])

  const dias = useMemo(() => DIAS_UTIL.filter(d => Object.keys(mapa).some(k => k.startsWith(`${d}|||`))), [mapa])
  const horas = useMemo(() => [...new Set(Object.keys(mapa).map(k => k.split("|||")[1]))].sort(), [mapa])

  // Manhã: 08:00-12:00 · Tarde: 12:30-17:40 (corte em "12:30" — pedido do
  // usuário 2026-08-17: 12:30 conta como Tarde, não Manhã — comparação de
  // string funciona porque HI_str é sempre "HH:MM" com zero à esquerda).
  const CORTE_TARDE = "12:30"
  const horasManha = useMemo(() => horas.filter(h => h < CORTE_TARDE), [horas])
  const horasTarde = useMemo(() => horas.filter(h => h >= CORTE_TARDE), [horas])

  // Unidade predominante de um turno (pra um dado dia) — mostrada 1x num
  // cabeçalho de turno em vez de abreviar a unidade em cada sessão — pedido
  // do usuário (2026-08-17). Quando há uma sessão isolada de OUTRA unidade
  // (incomum), o cabeçalho continua mostrando a predominante e só a(s)
  // célula(s) destoantes ganham o selo individual (pedido do usuário
  // 2026-08-17: inclusive quando a predominante é "Desconhecida", vermelho).
  const unidadeDominantePorDiaTurno = useMemo(() => {
    const calc = (horasTurno: string[]) => {
      const m = new Map<string, string | null>()
      for (const dia of dias) {
        const contagem = new Map<string, number>()
        for (const hora of horasTurno) {
          const c = mapa[`${dia}|||${hora}`]
          if (!c) continue
          contagem.set(c.unidade, (contagem.get(c.unidade) ?? 0) + 1)
        }
        let dominante: string | null = null
        let max = 0
        for (const [unidade, qtd] of contagem) {
          if (qtd > max) { dominante = unidade; max = qtd }
        }
        m.set(dia, dominante)
      }
      return m
    }
    return { manha: calc(horasManha), tarde: calc(horasTarde) }
  }, [dias, horasManha, horasTarde, mapa])

  const qtdDireto = oportunidades.filter(o => o.modalidade === "direto").length
  const qtdRemanejamentoMesmoDia = oportunidades.filter(o => o.modalidade === "remanejamento-mesmo-dia").length
  const qtdRemanejamentoOutroDia = oportunidades.filter(o => o.modalidade === "remanejamento-outro-dia").length
  const qtdNovoDia = oportunidades.filter(o => o.modalidade === "novo-dia").length
  const celulas = Object.values(mapa)
  const qtdOcupado = celulas.filter(c => c.tag === "ocupado").length
  const qtdLivreSemOportunidade = celulas.filter(c => c.tag === "livre").length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={14} className="text-muted-foreground" />
        <span className="text-sm font-extrabold text-foreground">{profissional}</span>
        <span className="text-[11px] text-muted-foreground">
          {oportunidades.length} oportunidade(s) — {qtdDireto} direta(s), {qtdRemanejamentoMesmoDia} via remanejamento (mesmo dia), {qtdRemanejamentoOutroDia} via remanejamento (outro dia), {qtdNovoDia} via novo dia
        </span>
      </div>

      <div className="mb-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" /> Ocupado</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/20" /> Livre, sem oportunidade</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" /> Oportunidade direta</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30" /> Oportunidade via remanejamento (mesmo dia)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30" /> Oportunidade via remanejamento (outro dia)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" /> Oportunidade via novo dia</span>
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-bold">Unidade:</span>
        {Object.keys(UNID_COR).map(u => (
          <span key={u} className="flex items-center gap-1">
            <span className={`rounded px-1 text-[9px] font-black leading-tight ${estiloUnidade(u).bg} ${estiloUnidade(u).text}`}>{unidadeAbrev(u)}</span>
            {u}
          </span>
        ))}
      </div>

      {!dias.length ? (
        <InlineNotice tone="slate">Nenhum horário (ocupado ou livre) encontrado pra esse profissional na semana de referência.</InlineNotice>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4 items-start">
          <div className="overflow-x-auto rounded-xl border border-border p-3">
            <table className="table-fixed border-collapse text-[11px]" style={{ width: `${56 + dias.length * 140}px` }}>
              <colgroup>
                <col style={{ width: 56 }} />
                {dias.map(d => <col key={d} style={{ width: 140 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="w-14" />
                  {dias.map(d => (
                    <th key={d} className="pb-1.5 text-center text-[11px] font-bold text-foreground">{diaCurto(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  { label: "Manhã", horasTurno: horasManha, dominante: unidadeDominantePorDiaTurno.manha },
                  { label: "Tarde", horasTurno: horasTarde, dominante: unidadeDominantePorDiaTurno.tarde },
                ] as const).map(turno => turno.horasTurno.length === 0 ? null : (
                  <Fragment key={turno.label}>
                    <tr className="border-t border-border bg-muted/40">
                      <td className="py-1 pr-2 text-right text-[9px] font-black uppercase tracking-wide text-muted-foreground">{turno.label}</td>
                      {dias.map(dia => {
                        const u = turno.dominante.get(dia)
                        return (
                          <td key={dia} className="px-0.5 py-0">
                            {u && (
                              <div className={`rounded-md py-1 text-center text-[10px] font-black uppercase tracking-wide text-white ${estiloUnidade(u).bar}`}>
                                {unidadeExibicao(u)}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    {turno.horasTurno.map(hora => (
                      <tr key={hora} className="border-t border-border">
                        <td className="py-1 pr-2 text-right font-mono text-[10px] font-semibold text-muted-foreground">{hora}</td>
                        {dias.map(dia => {
                          const c = mapa[`${dia}|||${hora}`]
                          if (!c) return <td key={dia} className="px-0.5 py-0"><div className={`h-[64px] transition-opacity ${destaque ? "opacity-30" : ""}`} /></td>
                          const clicavel = c.tag === "direto" || c.tag === "remanejamento-mesmo-dia" || c.tag === "remanejamento-outro-dia" || c.tag === "novo-dia"
                          const combinaComDominante = c.unidade === turno.dominante.get(dia)
                          const emDestaque = !destaque || segmentoDaTag(c.tag) === destaque
                          return (
                            <td key={dia} className="px-0.5 py-0">
                              <button
                                type="button"
                                disabled={!clicavel}
                                onClick={() => c.oportunidade && onAbrirOportunidade(c.oportunidade)}
                                title={`Unidade: ${unidadeExibicao(c.unidade)}`}
                                className={`h-[64px] w-full overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-opacity ${ESTILO_CELULA[c.tag]} ${emDestaque ? "" : "opacity-30"}`}
                              >
                                <div className="flex min-w-0 items-center justify-between gap-1">
                                  <span className="min-w-0 truncate text-[11px] font-bold leading-tight text-foreground">{c.terapia}</span>
                                  {!combinaComDominante && (
                                    <span className={`shrink-0 rounded px-1 text-[9px] font-black leading-tight ${estiloUnidade(c.unidade).bg} ${estiloUnidade(c.unidade).text}`}>
                                      {unidadeAbrev(c.unidade)}
                                    </span>
                                  )}
                                </div>
                                <div className="truncate text-[10px] text-muted-foreground">
                                  {c.tag === "livre" ? "Livre" : fmtName(c.paciente ?? "")}
                                </div>
                                {clicavel && (
                                  <div className={`mt-0.5 truncate text-[10px] font-bold ${
                                    c.tag === "direto" ? "text-emerald-700 dark:text-emerald-400"
                                    : c.tag === "remanejamento-mesmo-dia" ? "text-sky-700 dark:text-sky-400"
                                    : c.tag === "remanejamento-outro-dia" ? "text-indigo-700 dark:text-indigo-400"
                                    : "text-amber-700 dark:text-amber-400"
                                  }`}>
                                    {c.tag === "direto" ? "Ver agenda"
                                      : c.tag === "remanejamento-mesmo-dia" ? "Ver antes/depois"
                                      : c.tag === "remanejamento-outro-dia" ? "Ver antes/depois (outro dia)"
                                      : "Ver novo dia"}
                                  </div>
                                )}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <ProjecaoOcupacaoDonut
            titulo="Ocupação do profissional" ocupado={qtdOcupado} oportunidade={qtdDireto + qtdRemanejamentoMesmoDia + qtdRemanejamentoOutroDia + qtdNovoDia} livre={qtdLivreSemOportunidade}
            segmentoSelecionado={destaque} onSelecionarSegmento={setDestaque}
          />
        </div>
      )}
    </div>
  )
}

export function DisponibilidadeInternaView() {
  const { cRows: cRowsBrutos, loading, error, refWeek } = useGradeAgendamentos()
  // Amanda Ribeiro Campos / Gracielle Rayane Faria Miranda têm muitos horários
  // "Livre" DE PROPÓSITO (motivo interno) — pedido do usuário (2026-08-11):
  // não podem receber vaga em NENHUMA aba desta tela (ver PROFISSIONAIS_SEM_CAPACIDADE_LIVRE).
  const cRows = useMemo(() => filtrarCapacidadeLivreReservada(cRowsBrutos), [cRowsBrutos])
  const { lRows } = useCronogramaData()
  // Sem laudo não dá pra calcular sessão pendente (autorizado × ofertado) —
  // sem isso, "0 oportunidade(s)" apareceria como resultado real em vez de
  // dado faltante (mesmo bug corrigido em OcupacaoCategoriaView.tsx).
  const laudosCarregados = lRows.length > 0
  const { setHeader } = useHeader()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get("tab")
  const activeTab: TabKey = rawTab && TABS.some(t => t.key === rawTab) ? (rawTab as TabKey) : "categoria"
  const [profissional, setProfissional] = useState("")
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("")
  const [detalheDireto, setDetalheDireto] = useState<OportunidadeProfissional | null>(null)
  const [detalheRemanejamento, setDetalheRemanejamento] = useState<OportunidadeProfissional | null>(null)
  const [detalheNovoDia, setDetalheNovoDia] = useState<OportunidadeProfissional | null>(null)

  // "categoria" é o default atual (era "nome" antes) — bookmark/link externo
  // antigo com ?tab=nome não pode mais abrir direto em "nome", só clique
  // explícito na aba dentro da tela. abaClicadaRef marca esse clique; a
  // correção da 1ª carga só roda uma vez (cargaInicialTratadaRef) pra não
  // sobrescrever o clique do usuário depois.
  const abaClicadaRef = useRef(false)
  const cargaInicialTratadaRef = useRef(false)
  useEffect(() => {
    if (cargaInicialTratadaRef.current) return
    cargaInicialTratadaRef.current = true
    if (!abaClicadaRef.current && (!rawTab || rawTab === "nome")) {
      router.replace("/relacionamento-prestador/ocupar-profissionais-disponiveis?tab=categoria")
    }
  }, [rawTab, router])

  useEffect(() => {
    const subtitle = activeTab === "nome"
      ? `Escolha um profissional já contratado pra ver onde a agenda dele tem espaço pra crescer — semana de referência: ${refWeek.label}`
      : `Escolha unidade, dia e especialidade pra ver todas as vagas dessa combinação — semana de referência: ${refWeek.label}`
    setHeader("Ocupar Profissionais Disponíveis", subtitle)
    return () => setHeader("", "")
  }, [activeTab, refWeek.label, setHeader])

  const profissionais = useMemo(() => listarProfissionaisComOportunidade(cRows), [cRows])
  const contagemLivres = useMemo(() => {
    // Conta horários físicos distintos, não entradas de listarSlotsLivres —
    // um horário que serve 3 especialidades gera 3 entradas (ver
    // listarSlotsLivres), mas continua sendo 1 único horário livre pro
    // profissional; sem dedupe aqui o contador exibido ("N livre(s)")
    // inflava artificialmente pra quem tem slots multi-especialidade.
    const vistos = new Set<string>()
    const m = new Map<string, number>()
    for (const s of listarSlotsLivres(cRows)) {
      if (!s.especialidade) continue
      const chaveSlot = `${s.profissional}|||${s.dia}|||${s.hora}|||${s.unidade}`
      if (vistos.has(chaveSlot)) continue
      vistos.add(chaveSlot)
      m.set(s.profissional, (m.get(s.profissional) ?? 0) + 1)
    }
    return m
  }, [cRows])

  // Especialidade(s) em que cada profissional tem horário "Livre" real —
  // mostrada direto na busca e usada pelo filtro "Especialidade" abaixo, pra
  // não depender de abrir a agenda inteira só pra saber o que o profissional atende.
  const especialidadesPorProfissional = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const s of listarSlotsLivres(cRows)) {
      if (!s.especialidade) continue
      if (!m.has(s.profissional)) m.set(s.profissional, new Set())
      m.get(s.profissional)!.add(s.especialidade)
    }
    const ordenado = new Map<string, string[]>()
    for (const [p, esps] of m) ordenado.set(p, [...esps].sort())
    return ordenado
  }, [cRows])

  const profissionaisFiltrados = useMemo(() => {
    if (!filtroEspecialidade) return profissionais
    return profissionais.filter(p => especialidadesPorProfissional.get(p)?.includes(filtroEspecialidade))
  }, [profissionais, especialidadesPorProfissional, filtroEspecialidade])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      Carregando disponibilidade interna...
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center py-24 text-sm text-destructive">
      Erro ao carregar dados: {error}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {TABS.map(tab => {
          const ativo = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => { abaClicadaRef.current = true; router.replace(`/relacionamento-prestador/ocupar-profissionais-disponiveis?tab=${tab.key}`) }}
              className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${ativo ? "bg-violet-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "categoria" ? (
        <OcupacaoCategoriaView cRows={cRows} />
      ) : !laudosCarregados ? (
        <InlineNotice tone="amber" icon={<Lock size={15} />}>
          <strong>Relatório de laudos não anexado.</strong> Sem ele não é possível calcular quem tem sessões pendentes (autorizado × ofertado) — os horários "Livre" apareceriam sempre como "sem oportunidade", mesmo quando há demanda real. Anexe o relatório de laudos para liberar esta aba.
        </InlineNotice>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-1 flex items-center gap-1.5">
              <Sparkles size={15} className="text-violet-600 dark:text-violet-400" />
              <span className="text-[15px] font-extrabold text-foreground">Ocupar profissional já contratado</span>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              Escolha um profissional pra ver, dentro dos horários “Livre” reais da agenda dele, quais pacientes com sessão pendente (autorizado &gt; ofertado) poderiam entrar — direto ou remanejando a sessão conflitante de outro paciente com OUTRO profissional, mantido. Sem escrever nada no TiTa por enquanto — é só visualização.
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex w-full sm:w-56 flex-col gap-1">
                <span className="text-[11px] font-bold text-muted-foreground">Especialidade (opcional)</span>
                <SearchCombobox
                  value={filtroEspecialidade}
                  onChange={setFiltroEspecialidade}
                  opcoes={TODAS_ESP}
                  placeholder="Filtrar por especialidade..."
                  ariaLabel="Filtrar profissionais por especialidade"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[11px] font-bold text-muted-foreground">Profissional</span>
                <ProfissionalCombobox
                  value={profissional}
                  onChange={setProfissional}
                  opcoes={profissionaisFiltrados}
                  contagemLivres={contagemLivres}
                  especialidadesPorProfissional={especialidadesPorProfissional}
                />
              </div>
            </div>
            {!profissionaisFiltrados.length && (
              <div className="mt-3">
                <InlineNotice tone="slate">
                  {filtroEspecialidade
                    ? `Nenhum profissional com horário "Livre" em ${filtroEspecialidade} na semana de referência.`
                    : "Nenhum profissional com horário “Livre” na semana de referência."}
                </InlineNotice>
              </div>
            )}
          </div>

          {!profissional ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Selecione um profissional. Só aparecem na lista profissionais com pelo menos 1 horário “Livre” na semana de referência.
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4">
              <AgendaProfissional
                profissional={profissional}
                cRows={cRows}
                onAbrirOportunidade={o => (
                  o.modalidade === "direto" ? setDetalheDireto(o)
                  : o.modalidade === "remanejamento-mesmo-dia" || o.modalidade === "remanejamento-outro-dia" ? setDetalheRemanejamento(o)
                  : setDetalheNovoDia(o)
                )}
              />
            </div>
          )}

          {detalheDireto && (
            <PacienteAgendaHipoteticaModal
              paciente={detalheDireto.paciente.pac}
              slot={{ dia: detalheDireto.dia, turno: detalheDireto.turno, hora: detalheDireto.hora, unidade: detalheDireto.unidade }}
              especialidade={detalheDireto.especialidade}
              profissionalHipotetico={profissional}
              cRows={cRows}
              onClose={() => setDetalheDireto(null)}
            />
          )}

          {detalheRemanejamento?.remanejamento && (
            <RemanejamentoDetalheModal
              paciente={detalheRemanejamento.paciente.pac}
              terapiaHipotetica={detalheRemanejamento.terapia}
              profissionalHipotetico={profissional}
              remanejamento={detalheRemanejamento.remanejamento}
              cRows={cRows}
              onClose={() => setDetalheRemanejamento(null)}
            />
          )}

          {detalheNovoDia?.novoDia && (
            <NovoDiaDetalheModal
              oportunidade={detalheNovoDia.novoDia}
              cRows={cRows}
              onClose={() => setDetalheNovoDia(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
