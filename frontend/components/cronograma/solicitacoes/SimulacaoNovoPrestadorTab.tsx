"use client"

// Simulação de Novo Prestador — visualizador de hipótese: "se eu contratasse
// um novo profissional de tal especialidade, em tais dias/turnos, quantos
// pacientes com gap eu conseguiria encaixar, e em qual unidade?"
//
// Extraído de PreencherProfTab.tsx (que também tinha dois modos — "Profissional"
// e "Paciente" — inalcançáveis por qualquer rota do sistema). O motor de
// cálculo vive em lib/cronograma/simulacaoNovoPrestador.ts; este arquivo é só
// a UI. Não há mais fluxo de WhatsApp/oferta aqui — é puramente informativo.

import { Fragment, startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts"
import { Ban, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, House, Lock, Repeat2, Sparkles, Star, Wallet, Sliders } from "lucide-react"
import {
  avaliarPeriodo, calcularGaps, construirAgendaNovoProfissional, gapsParaMapa, limitarCandidatosPorGap, listarEspecialidades, montarPlanoRecomendado, ranquearUnidades,
  type CandidatoSlot, type PeriodoSimulado, type PeriodoAlvo, type SlotSimulado, type Turno,
} from "@/lib/cronograma/simulacaoNovoPrestador"
import { DIAS_UTIL, corTerapiaBadge, estiloUnidade, normTxt, unidadeAbrev } from "@/lib/cronograma/constants"
import { diaCurto, filtrarCapacidadeLivreReservada, fmtH, fmtName, fmtReal, pm, turnoFromHora, turnoNome } from "@/lib/cronograma/helpers"
import { useGradeAgendamentos } from "@/hooks/useGradeAgendamentos"
import { useOcupacaoSalas } from "@/hooks/useOcupacaoSalas"
import { useConvenioValoresCalculo } from "@/hooks/useConvenioValores"
import { useFeriados } from "@/hooks/useFeriados"
import { useParametrosGeraisCalculo } from "@/hooks/useParametrosGerais"
import { useTaxasEspecialidadeCalculo } from "@/hooks/useTaxasEspecialidade"
import {
  calcularBreakEvenPJ, projetarMargemBreakEvenPJ, calcularBreakEvenAtendimento, projetarMargemBreakEvenAtendimento,
  CENARIOS_PERDA_PCT, ESPECIALIDADES_BREAK_EVEN_PJ, SEMANAS_POR_MES,
  type CenarioPerdaPct,
} from "@/lib/remuneracao/pontoEquilibrio"
import { anexarModalidadeERemanejamento, filtrarPorDisponibilidadeInterna, separarCobertosPorDisponibilidadeInterna, anexarSala, anexarRemuneracaoEOrdenar, primeiroConvenioDoPaciente, contarSessoesReaisMes, terapiaDaEspecialidade } from "@/lib/cronograma/sugestaoContratacao"
import { capacidadeDiretaRestante, listarSlotsLivres, type SlotLivre } from "@/lib/cronograma/disponibilidadeInterna"
import { listarExclusividadesTerapia } from "@/services/salas.service"
import type { SalaTerapiaExclusiva } from "@/lib/cronograma/salasTypes"
import { SugestoesContratacaoPanel } from "./SugestoesContratacaoPanel"
import { RemanejamentoDetalheModal } from "./RemanejamentoDetalheModal"
import { PacienteAgendaHipoteticaModal } from "./PacienteAgendaHipoteticaModal"
import { ProjecaoFinanceiraDetalheModal } from "./ProjecaoFinanceiraDetalheModal"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { ICONE_TERAPIA } from "@/components/cronograma/indicadores/ComparativoSessoesShell"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { TONE_ACCENT, TONE_SOFT } from "@/components/cronograma/ui/tones"
import { Button } from "@/components/ui/button"
import { CabecalhoPastel } from "@/components/ui/pastel/pecas"
import type { CsvRow, LaudoRow } from "@/types/cronograma"
import type { CandidatoNaSugestao, SugestaoContratacao } from "@/lib/cronograma/sugestaoContratacaoTypes"

interface Props {
  lRows: LaudoRow[]
}

/** Reagrupa os candidatos já enriquecidos (adjacência + remanejamento, com
 *  disponibilidade interna descontada) de volta no formato de slots por hora
 *  que a agenda visual (construirAgendaNovoProfissional) espera — sem isso, a
 *  agenda/carga semanal/ocupação por dia mostrariam como "livre" um horário
 *  que só tem candidato via remanejamento, mesmo já entrando na receita
 *  projetada e em "Sessões e candidatos". */
function periodosEnriquecidosParaSimulado(periodos: SugestaoContratacao[]): PeriodoSimulado[] {
  return periodos.map(p => {
    const porHora = new Map<string, CandidatoSlot[]>()
    for (const c of p.candidatos) {
      const lista = porHora.get(c.hora) ?? []
      lista.push({ pac: c.paciente, gap: c.gap, aut: c.aut, of: c.of, sessoesNoDia: [] })
      porHora.set(c.hora, lista)
    }
    const slots: SlotSimulado[] = [...porHora.entries()]
      .map(([hora, candidatos]) => ({ dia: p.dia, turno: p.turnos[0], unidade: p.unidade, hora, candidatos }))
    return {
      dia: p.dia,
      turno: p.turnos[0],
      unidade: p.unidade,
      nPacientes: new Set(slots.flatMap(s => s.candidatos.map(c => c.pac))).size,
      totalSessoes: slots.reduce((soma, s) => soma + s.candidatos.length, 0),
      slots,
    }
  })
}

/** Converte os períodos simulados no formato SugestaoContratacao (1 turno por
 *  período) que os estágios de enriquecimento esperam — cada período vira uma
 *  "sugestão" só pra reaproveitar o mesmo pipeline do painel de sugestões
 *  automáticas (useSugestoesContratacao.ts).
 *
 *  Uma definição só, compartilhada por comRemanejamento (a unidade em exibição)
 *  e por vagasLiquidasPorUnidade (as três unidades das barras): se cada um
 *  montasse a própria base, a barra e a projeção financeira podiam discordar —
 *  que é exatamente o defeito que vagasLiquidasPorUnidade existe pra fechar. */
/** Luminância perceptual (WCAG) — decide se o hex da terapia é claro o
 *  bastante pra precisar de texto escuro em cima, em vez de branco. */
function corClaraPrecisaTextoEscuro(hex: string): boolean {
  const limpo = hex.replace("#", "")
  const r = parseInt(limpo.slice(0, 2), 16)
  const g = parseInt(limpo.slice(2, 4), 16)
  const b = parseInt(limpo.slice(4, 6), 16)
  const luminancia = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminancia > 0.6
}

function periodosComoSugestoes(periodos: PeriodoSimulado[], especialidade: string): SugestaoContratacao[] {
  return periodos.map((p, i) => ({
    id: `periodo-${i}`,
    unidade: p.unidade,
    especialidade,
    dia: p.dia,
    turnos: [p.turno],
    pctOcupacaoPrevista: 0,
    faixaCascata: 50,
    candidatos: p.slots.flatMap(s => s.candidatos.map(c => ({
      paciente: c.pac, gap: c.gap, aut: c.aut, of: c.of, turno: p.turno, hora: s.hora,
      modalidade: "adjacente" as const, valorSessaoProjetado: null, ordemNaVaga: 1,
    }))),
    modalidadeDominante: "adjacente" as const,
    salaVinculada: null,
    projecaoRemuneracao: null,
  }))
}

/** Reinsere, como período VAZIO, cada dia+turno que o usuário marcou em "Dias
 *  e turnos" mas que perdeu todos os candidatos no caminho (nenhum paciente
 *  elegível, ou todos absorvidos pela capacidade interna). dividirPorDisponibi-
 *  lidadeInterna descarta o período inteiro quando ele fica sem candidato
 *  (`if (candidatosRestantes.length)`, sugestaoContratacao.ts) — correto pro
 *  painel de sugestões automáticas, onde sugestão vazia não deve aparecer, mas
 *  aqui o dia/turno foi escolhido À MÃO pelo usuário: sumir da grade em
 *  silêncio faz parecer que a seleção não foi aplicada.
 *
 *  Caso real (27/08/2026): com manhã e tarde marcadas nos 5 dias, Padre Miguel
 *  desenhava só "TERÇA / tarde" — as manhãs sem candidato não viravam nem
 *  linha vazia, e a leitura era "o sistema ignorou a manhã que eu marquei" em
 *  vez de "a manhã que você marcou não tem candidato".
 *
 *  Só completa a agenda do profissional hipotético, nunca a "já coberta": ali
 *  período vazio é ausência de cobertura, não vaga ociosa a mostrar. */
function completarPeriodosSelecionados(
  periodos: PeriodoSimulado[], selecionados: PeriodoSimulado[],
): PeriodoSimulado[] {
  const presentes = new Set(periodos.map(p => `${p.dia}|||${p.turno}`))
  const vazios = selecionados
    .filter(p => !presentes.has(`${p.dia}|||${p.turno}`))
    .map(p => ({ ...p, slots: [], nPacientes: 0, totalSessoes: 0 }))
  return vazios.length ? [...periodos, ...vazios] : periodos
}

// ─── InfoTip ────────────────────────────────────────────────────────────────
// Fino wrapper sobre o InfoTooltip padrão (clique, painel via portal) — mantém
// os vários pontos desta tela consistentes, mas deixa cada um formatar o
// conteúdo (negrito, parágrafos) em vez de jogar tudo num texto corrido.
function InfoTip({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return <InfoTooltip ariaLabel={ariaLabel}>{children}</InfoTooltip>
}

// ─── LinhaEquilibrio ────────────────────────────────────────────────────────
// Linha do extrato vertical (DRE) do Ponto de Equilíbrio: rótulo (+ tooltip
// opcional) à esquerda, valor à direita — "forte" marca subtotal/total (borda
// em cima, negrito maior). O tooltip explica a FÓRMULA, nunca um número de
// exemplo — o valor de sessão vem da média real dos pacientes elegíveis desta
// simulação (ver "Sessão a sessão" em "Ver detalhe"), então varia conforme
// convênio/imposto/perda escolhidos, nunca é fixo.
function LinhaEquilibrio({
  label, valor, tone = "neutro", tooltip, forte = false,
}: { label: string; valor: string; tone?: "pos" | "neg" | "neutro"; tooltip?: ReactNode; forte?: boolean }) {
  // Linha inteira (rótulo + valor) fica colorida quando tone é pos/neg — igual
  // à Frente 1 (só o valor mudar de cor faria a dedução passar despercebida).
  const corTom = tone === "pos" ? "text-emerald-700 dark:text-emerald-400" : tone === "neg" ? "text-rose-600 dark:text-rose-400" : null
  const corLabel = corTom ?? (forte ? "text-foreground" : "text-muted-foreground")
  const corValor = corTom ?? "text-foreground"
  return (
    <div className={`flex items-center justify-between gap-3 ${forte ? "mt-0.5 border-t border-border pt-1.5" : ""}`}>
      <span className={`flex items-center gap-1 ${forte ? "font-bold" : ""} ${corLabel}`}>
        {label}
        {tooltip && <InfoTip ariaLabel={label}>{tooltip}</InfoTip>}
      </span>
      <span className={`tabular-nums ${forte ? "font-black" : "font-semibold"} ${corValor}`}>{valor}</span>
    </div>
  )
}

// ─── Ícone "casa bloqueada" ───────────────────────────────────────────────────
// Casa (sala/unidade) + Ban sobreposto no canto — usado nos botões de
// Manhã/Tarde de "Dias e turnos afetados" quando o turno marcado não tem sala
// livre encontrada, no lugar do ✓ azul de "selecionado" normal.
function IconeSemSala({ size = 14 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <House size={size} strokeWidth={2} />
      <Ban
        size={Math.round(size * 0.68)}
        strokeWidth={2.5}
        className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white dark:bg-neutral-900"
      />
    </span>
  )
}


// ─── Combobox de especialidade (padrão ARIA usado no autocomplete de paciente
//     do OcupPacMode — a melhor implementação desse padrão no módulo) ────────
function EspecialidadeCombobox({
  value, onChange, opcoes,
}: { value: string; onChange: (v: string) => void; opcoes: string[] }) {
  const [texto, setTexto] = useState(value)
  const [aberto, setAberto] = useState(false)
  const [ativoIdx, setAtivoIdx] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Sincroniza o texto quando `value` muda por fora (ex.: "Aplicar" sugestão),
  // sem depender de efeito — padrão documentado do React pra "ajustar estado
  // quando uma prop muda". Não atrapalha a digitação: enquanto o usuário
  // digita, cada tecla já manda onChange("") pro pai, então `value` fica
  // parado em "" entre uma tecla e outra e essa comparação nunca dispara.
  const [ultimoValor, setUltimoValor] = useState(value)
  if (value !== ultimoValor) {
    setUltimoValor(value)
    setTexto(value)
  }

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter(o => o.toLowerCase().includes(q))
  }, [texto, opcoes])

  const selecionar = (esp: string) => { onChange(esp); setTexto(esp); setUltimoValor(esp); setAberto(false); setAtivoIdx(-1) }
  const valida = opcoes.includes(value)

  return (
    <div className="relative">
      <input
        id="sim-esp-input"
        type="text"
        autoComplete="off"
        aria-label="Buscar especialidade"
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={aberto ? "sim-esp-listbox" : undefined}
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
        placeholder="Digite para buscar uma especialidade…"
        className={`w-full rounded-lg border px-2.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring ${valida ? "border-[var(--pp-border)] bg-[var(--pp-surface)] text-[var(--pp-ink)] placeholder:text-[var(--pp-ink-muted)]" : "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-100 placeholder:text-rose-400"}`}
      />
      {aberto && filtradas.length > 0 && (
        <div
          ref={listRef}
          id="sim-esp-listbox"
          role="listbox"
          aria-label="Especialidades"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-[100] max-h-52 overflow-y-auto rounded-lg border border-[var(--pp-border)] bg-[var(--pp-surface)] shadow-[var(--pp-sombra)]"
        >
          {filtradas.map((esp, i) => {
            const selecionada = esp === value
            const ativa = i === ativoIdx
            return (
              <button
                key={esp}
                type="button"
                role="option"
                aria-selected={selecionada}
                onMouseDown={e => { e.preventDefault(); selecionar(esp) }}
                className={`block w-full px-3 py-1.5 text-left text-[13px] transition-colors ${ativa ? "bg-[var(--pp-verde)] text-white" : selecionada ? "bg-[var(--pp-muted)] font-semibold text-[var(--pp-ink)]" : "text-[var(--pp-ink)] hover:bg-[var(--pp-muted)]/60"}`}
              >
                {esp}
              </button>
            )
          })}
        </div>
      )}
      {!valida && !aberto && texto && (
        <div className="mt-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">Selecione uma especialidade válida da lista.</div>
      )}
    </div>
  )
}

// ─── Grade semanal do plano recomendado (dia × turno) ────────────────────────
function PlanoGradeSemanal({ periodos }: { periodos: PeriodoSimulado[] }) {
  const dias = DIAS_UTIL.filter(d => periodos.some(p => p.dia === d))
  if (!dias.length) return null

  const unidadesNoPlano = new Set(periodos.map(p => p.unidade))
  if (unidadesNoPlano.size === 1) {
    // Caso homogêneo: a grade dia×turno vira ruído puro (repete o mesmo nome
    // em toda célula) — substituída por um resumo de cobertura compacto.
    const unidade = periodos[0].unidade
    const cor = estiloUnidade(unidade)
    const diasManha = dias.filter(d => periodos.some(p => p.dia === d && p.turno === "manha"))
    const diasTarde = dias.filter(d => periodos.some(p => p.dia === d && p.turno === "tarde"))
    const coberturaTotal = diasManha.length === dias.length && diasTarde.length === dias.length
    const cobertura = coberturaTotal
      ? `${dias.map(diaCurto).join(", ")} · Manhã e Tarde`
      : [
          diasManha.length && `Manhã: ${diasManha.map(diaCurto).join(", ")}`,
          diasTarde.length && `Tarde: ${diasTarde.map(diaCurto).join(", ")}`,
        ].filter(Boolean).join(" · ")
    return (
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${cor.bg}`}>
        <span className={`shrink-0 text-[13px] font-black ${cor.text}`}>{unidade}</span>
        <span className="text-[11px] font-semibold text-muted-foreground">{cobertura}</span>
      </div>
    )
  }

  // Caso misto: a variedade é informação real, mas o valor está em ver ONDE o
  // plano foge do padrão — não em reler a unidade dominante em toda célula.
  // Conta ocorrências pra achar a unidade dominante; células dela ficam
  // discretas (só a sigla, sem preenchimento), células diferentes (as
  // exceções) ganham cor cheia + contorno pra puxar o olho direto pra elas.
  const contagem = new Map<string, number>()
  periodos.forEach(p => contagem.set(p.unidade, (contagem.get(p.unidade) ?? 0) + 1))
  const dominante = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]

  return (
    <div className="grid w-full gap-1" style={{ gridTemplateColumns: `44px repeat(${dias.length}, minmax(0, 1fr))` }}>
      <div />
      {dias.map(dia => (
        <div key={`h-${dia}`} className="truncate text-center text-[11px] font-bold uppercase text-muted-foreground">{diaCurto(dia)}</div>
      ))}
      {(["manha", "tarde"] as Turno[]).flatMap(turno => [
        <div key={`t-${turno}`} className="flex items-center text-[11px] font-bold text-muted-foreground">{turnoNome[turno]}</div>,
        ...dias.map(dia => {
          const periodo = periodos.find(p => p.dia === dia && p.turno === turno)
          if (!periodo) return <div key={`${turno}-${dia}`} />
          const cor = estiloUnidade(periodo.unidade)
          const excecao = periodo.unidade !== dominante
          return (
            <div
              key={`${turno}-${dia}`}
              className={`truncate rounded-md px-1 py-2 text-center text-[10.5px] font-bold ${
                excecao ? `border-2 border-foreground/20 ${cor.bg} ${cor.text}` : `${cor.text} opacity-70`
              }`}
              title={periodo.unidade}
            >
              {unidadeAbrev(periodo.unidade)}
            </div>
          )
        }),
      ])}
    </div>
  )
}

interface DetalheModalData { pac: string; slot: SlotSimulado; especialidade: string; profissionalHipotetico?: string }

interface LinhaCandidato {
  dia: string; unidade: string; sugestao: SugestaoContratacao; candidato: CandidatoNaSugestao
  /** Quantos pacientes concorrem por essa mesma vaga (turno+hora) — > 1 significa que só um deles poderá ser atendido. */
  concorrentesNaVaga: number
  /** true quando o valor de sessão empata entre os concorrentes da vaga — a prioridade nesse caso vem da frequência semanal na clínica, não do valor. */
  priorizadoPorFrequencia: boolean
  /** Quantos profissionais já contratados estão "Livre" nesse mesmo dia+hora+unidade+especialidade — essa vaga já é ofertável hoje em "Ocupar Profissionais Disponíveis", sem esperar a contratação simulada. */
  vagasInternasDisponiveis: number
  /** Quem exatamente está livre nesse dia+hora+unidade — profissional(is), pra mostrar em "Ver detalhe". */
  vagasInternasSlots: SlotLivre[]
}

interface GrupoVaga { turno: Turno; hora: string; linhas: LinhaCandidato[] }

const COLGROUP_VAGA = (
  <colgroup>
    <col className="w-[52px]" />
    <col className="w-8" />
    <col />
    <col className="w-[190px]" />
    <col className="w-[165px]" />
    <col className="w-[150px]" />
  </colgroup>
)


interface GrupoSalaTurno { unidade: string; sala: string | null; turnos: { turno: Turno; vagas: GrupoVaga[] }[] }

// Agrupa vagas consecutivas do mesmo dia que compartilham unidade+sala — na
// prática, um dia inteiro de simulação quase sempre roda na mesma sala/
// unidade, então repetir esse cabeçalho em cada horário (como fazia antes) era
// a maior fonte de "monte de letras" repetido na tela. Só quebra o grupo
// quando sala OU unidade muda de fato; dentro do grupo, sub-agrupa por turno.
function agruparPorSalaTurno(vagas: GrupoVaga[]): GrupoSalaTurno[] {
  const grupos: GrupoSalaTurno[] = []
  for (const vaga of vagas) {
    const unidade = vaga.linhas[0].unidade
    const sala = vaga.linhas[0].sugestao.salaVinculada?.numeroSala ?? null
    const atual = grupos[grupos.length - 1]
    if (atual && atual.unidade === unidade && atual.sala === sala) {
      const turnoAtual = atual.turnos[atual.turnos.length - 1]
      if (turnoAtual.turno === vaga.turno) turnoAtual.vagas.push(vaga)
      else atual.turnos.push({ turno: vaga.turno, vagas: [vaga] })
    } else {
      grupos.push({ unidade, sala, turnos: [{ turno: vaga.turno, vagas: [vaga] }] })
    }
  }
  return grupos
}

// ─── Card de um grupo sala+turno (pode conter vários horários) ───────────────
// Unidade e sala aparecem 1x aqui (são as mesmas pra todo horário do grupo);
// turno aparece 1x por sub-bloco; só o horário e os candidatos variam linha
// a linha dentro de cada VagaBloco.
function GrupoSalaCard({
  grupoSala, cRows, especialidade, cobertosPorVaga, onVerDetalhe, onVerRemanejamento,
}: {
  grupoSala: GrupoSalaTurno
  cRows: CsvRow[]
  especialidade: string
  cobertosPorVaga: Map<string, string[]>
  onVerDetalhe: (d: DetalheModalData) => void
  onVerRemanejamento: (d: { sugestao: SugestaoContratacao; candidato: CandidatoNaSugestao; profissionalHipotetico?: string }) => void
}) {
  const cor = estiloUnidade(grupoSala.unidade)
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2.5">
        <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-extrabold ${cor.bg} ${cor.text}`}>{grupoSala.unidade}</span>
        <span className={grupoSala.sala
          ? "text-[12px] font-extrabold uppercase tracking-wide text-foreground"
          : "animate-pulse text-[12px] font-extrabold uppercase tracking-wide text-red-600 dark:text-red-400"}
        >
          {grupoSala.sala ? `Sala ${grupoSala.sala}` : "Sem sala livre encontrada"}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {grupoSala.turnos.map(({ turno, vagas }) => (
          <div key={turno} className="flex flex-col gap-1 py-2">
            <span className="px-3 text-[12px] font-extrabold uppercase tracking-wide text-sky-700 dark:text-sky-400">{turnoNome[turno]}</span>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] table-fixed border-collapse text-[12.5px]">
                {COLGROUP_VAGA}
                {/* Cabeçalho das colunas numéricas vive na mesma tabela dos dados
                    (não numa tabela separada acima de tudo) — assim a largura e o
                    alinhamento horizontal vêm de graça do colgroup compartilhado,
                    em vez de precisar bater manualmente com o padding de cada card. */}
                <thead>
                  <tr className="border-b border-border/60">
                    <th />
                    <th />
                    <th />
                    <th className="whitespace-nowrap pb-1 pr-3 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Autorizado → ofertado</th>
                    <th className="whitespace-nowrap pb-1 pr-3 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Valor/sessão</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {vagas.map((vaga, i) => (
                    <VagaLinhas
                      key={vaga.hora} vaga={vaga} cRows={cRows} especialidade={especialidade}
                      cobertosPorVaga={cobertosPorVaga} onVerDetalhe={onVerDetalhe} onVerRemanejamento={onVerRemanejamento}
                      separador={i > 0}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Linhas de uma vaga (horário) — só o que varia horário a horário ────────
// Uma linha por candidato principal, fluindo direto no mesmo <table> do turno
// (sem card/borda por horário) — "09:20 · Fulano ... próxima linha, 10:00 ·
// Beltrano ...". Quando há disputa, só o candidato #1 ("Ofereça primeiro") vem
// expandido com todo o contexto — os demais ("2ª opção", "3ª opção"...) ficam
// recolhidos atrás de 1 toggle, numa linha bem mais compacta e sem repetir a
// mesma frase de aviso ("só se o(s) anterior(es) recusar(em)") em cada um.
function VagaLinhas({
  vaga, cRows, especialidade, cobertosPorVaga, onVerDetalhe, onVerRemanejamento, separador,
}: {
  vaga: GrupoVaga
  cRows: CsvRow[]
  especialidade: string
  cobertosPorVaga: Map<string, string[]>
  onVerDetalhe: (d: DetalheModalData) => void
  onVerRemanejamento: (d: { sugestao: SugestaoContratacao; candidato: CandidatoNaSugestao; profissionalHipotetico?: string }) => void
  separador: boolean
}) {
  const [reservasAbertas, setReservasAbertas] = useState(false)
  const principal = vaga.linhas[0]
  const reservas = vaga.linhas.slice(1)
  const { sugestao, unidade } = principal
  const disputada = principal.concorrentesNaVaga > 1
  const vagaJaLivreNaClinica = principal.vagasInternasDisponiveis > 0

  const acaoParaCandidato = (linha: LinhaCandidato) => {
    const { candidato: c } = linha
    return c.modalidade === "adjacente" ? (
      <Button
        variant="outline" size="xs"
        onClick={() => onVerDetalhe({
          pac: c.paciente,
          slot: { dia: linha.dia, turno: c.turno, unidade, hora: c.hora, candidatos: [] },
          especialidade,
          profissionalHipotetico: vagaJaLivreNaClinica ? principal.vagasInternasSlots[0]?.profissional : undefined,
        })}
      >
        Ver detalhe
      </Button>
    ) : (
      <Button
        variant="outline" size="xs"
        onClick={() => onVerRemanejamento({
          sugestao, candidato: c,
          profissionalHipotetico: vagaJaLivreNaClinica ? principal.vagasInternasSlots[0]?.profissional : undefined,
        })}
      >
        Ver antes/depois
      </Button>
    )
  }

  return (
    <>
      <CandidatoLinha
        hora={vaga.hora} linha={principal} cRows={cRows} disputada={disputada}
        cobertosPorVaga={cobertosPorVaga} acao={acaoParaCandidato(principal)} separador={separador}
      />
      {reservas.length > 0 && (
        <>
          <tr>
            <td colSpan={6} className="pb-1.5 pl-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReservasAbertas(v => !v)}
                  className="flex items-center gap-1.5 text-left text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {reservasAbertas ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {reservasAbertas ? "Ocultar" : "Ver"} outro(s) candidato(s) para essa vaga
                </button>
                <InfoTip ariaLabel="Como funciona a fila de candidatos desta vaga">
                  <p>Só entram <strong className="text-foreground">se o(s) anterior(es) recusar(em)</strong>, na ordem em que aparecem ao expandir.</p>
                </InfoTip>
              </div>
            </td>
          </tr>
          {reservasAbertas && reservas.map((linha, i) => (
            <CandidatoLinhaReserva
              key={`${linha.dia}-${linha.candidato.turno}-${linha.candidato.hora}-${linha.candidato.paciente}-${i}`}
              linha={linha} cRows={cRows} cobertosPorVaga={cobertosPorVaga}
              acao={acaoParaCandidato(linha)}
            />
          ))}
        </>
      )}
    </>
  )
}

// Linha completa (candidato #1) — hora, motivo da prioridade e convênio
// visíveis, tudo numa linha só: "09:20 · Fulano [Adjacência] ASSIM Saúde ...".
function CandidatoLinha({
  linha, cRows, disputada, cobertosPorVaga, acao, hora, separador,
}: {
  linha: LinhaCandidato; cRows: CsvRow[]; disputada: boolean; cobertosPorVaga: Map<string, string[]>
  acao: ReactNode; hora: string; separador?: boolean
}) {
  const { candidato: c } = linha
  const adjacente = c.modalidade === "adjacente"
  const vagaJaLivreNaClinica = linha.vagasInternasDisponiveis > 0
  return (
    <tr className={`hover:bg-muted/30 ${separador ? "border-t border-border/40" : ""}`}>
      <td className="whitespace-nowrap py-2 pl-3 text-[12px] font-black tabular-nums text-foreground">{hora}</td>
      <td className="py-2">
        <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" aria-label="Pode oferecer agora" />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-foreground">{c.paciente}</span>
          <StatusPill tone={adjacente ? "green" : "blue"} variant="soft" dense>
            {adjacente ? "Adjacência" : "Remanejamento"}
          </StatusPill>
          <span className="text-[11px] text-muted-foreground">{primeiroConvenioDoPaciente(c.paciente, cRows)}</span>
          {vagaJaLivreNaClinica && (
            <>
              <StatusPill tone="amber" variant="solid" dense>Já disponível</StatusPill>
              <InfoTip ariaLabel="Por que esta vaga está destacada">
                <p>Existe(m) <strong className="text-foreground">profissional(is) já contratado(s) livre(s)</strong> neste mesmo dia, horário, unidade e especialidade — veja "Ocupar Profissionais Disponíveis".</p>
                <p className="mt-2">
                  Apenas {linha.vagasInternasDisponiveis} vaga(s) interna(s){disputada && ` para ${linha.concorrentesNaVaga} candidatos`}
                  {linha.vagasInternasSlots.length > 0 && (
                    <> — <strong className="text-foreground">{fmtName(linha.vagasInternasSlots[0].profissional)}</strong></>
                  )}.
                </p>
              </InfoTip>
            </>
          )}
        </div>
        {!!c.cobertosInternamente && c.ordemNaVaga === linha.concorrentesNaVaga && (() => {
          const nomesCobertos = cobertosPorVaga.get(`${linha.dia}|||${c.turno}|||${c.hora}|||${linha.unidade}`) ?? []
          return (
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
              + <strong className="text-foreground">{nomesCobertos.length ? nomesCobertos.map(fmtName).join(", ") : `${c.cobertosInternamente} paciente(s)`}</strong> desta vaga já atendido(s) por profissional existente
            </div>
          )
        })()}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2 tabular-nums text-sm font-bold text-foreground">
          <span>{c.aut}</span>
          <span className="text-muted-foreground">→</span>
          <span>{c.of}</span>
          <span className="rounded-full bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 text-xs font-extrabold text-rose-600 dark:text-rose-400">−{c.gap}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {c.valorSessaoProjetado !== null
          ? <span className="font-extrabold text-emerald-700 dark:text-emerald-400">{fmtReal(c.valorSessaoProjetado)}</span>
          : <span className="text-muted-foreground">Sem valor cadastrado</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 pr-3 text-right">{acao}</td>
    </tr>
  )
}

// Linha compacta (candidatos reserva, 2ª opção em diante) — sem repetir a
// frase "só se o(s) anterior(es) recusar(em)" (já dita 1x no toggle acima) e
// sem o badge de modalidade em pill (texto simples basta pra info secundária).
function CandidatoLinhaReserva({
  linha, cRows, cobertosPorVaga, acao,
}: { linha: LinhaCandidato; cRows: CsvRow[]; cobertosPorVaga: Map<string, string[]>; acao: ReactNode }) {
  const { candidato: c } = linha
  const adjacente = c.modalidade === "adjacente"
  const ultimaOpcao = c.ordemNaVaga === linha.concorrentesNaVaga
  return (
    <tr className="border-b border-border bg-muted/20 last:border-b-0 hover:bg-muted/40">
      <td className="py-1.5 pl-3" />
      <td className="py-1.5 text-center text-[10px] font-bold text-muted-foreground" title={`${c.ordemNaVaga}ª opção`}>
        {c.ordemNaVaga}ª
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{c.paciente}</span>
          <span className="text-[10.5px] text-muted-foreground">
            {adjacente ? "Adjacência" : "Remanejamento"} · {primeiroConvenioDoPaciente(c.paciente, cRows)}
          </span>
        </div>
        {!!c.cobertosInternamente && ultimaOpcao && (() => {
          const nomesCobertos = cobertosPorVaga.get(`${linha.dia}|||${c.turno}|||${c.hora}|||${linha.unidade}`) ?? []
          return (
            <div className="text-[10px] text-muted-foreground">
              + <strong className="text-foreground">{nomesCobertos.length ? nomesCobertos.map(fmtName).join(", ") : `${c.cobertosInternamente} paciente(s)`}</strong> já atendido(s) por profissional existente
            </div>
          )
        })()}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-[11.5px] font-semibold tabular-nums text-foreground">
        {c.aut} → {c.of} <span className="text-rose-600 dark:text-rose-400">(−{c.gap})</span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-[11.5px] tabular-nums">
        {c.valorSessaoProjetado !== null
          ? <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtReal(c.valorSessaoProjetado)}</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 pr-3 text-right">{acao}</td>
    </tr>
  )
}

// ─── Componente principal ────────────────────────────────────────────────────
export function SimulacaoNovoPrestadorTab({ lRows }: Props) {
  const { cRows: cRowsBrutos, loading: gradeLoading, error: gradeError, refWeek } = useGradeAgendamentos()
  // Amanda Ribeiro/Gracielle Rayane têm muitos horários "Livre" DE PROPÓSITO
  // (não é capacidade real) — a simulação não pode tratar esses horários
  // como espaço disponível pra descontar da oportunidade do novo profissional
  // (ver filtrarCapacidadeLivreReservada em helpers.ts).
  const cRows = useMemo(() => filtrarCapacidadeLivreReservada(cRowsBrutos), [cRowsBrutos])
  const { salasComOcupacao } = useOcupacaoSalas(refWeek.inicio, refWeek.fim)
  const { regrasGerais, excecoesPaciente } = useConvenioValoresCalculo()
  const { feriados } = useFeriados()
  const { parametros: parametrosGerais } = useParametrosGeraisCalculo()
  const {
    taxas_pa: taxasPA,
    be_custo_mensal_pj: beCustoMensalPJ, be_capacidade_manha: beCapacidadeManha, be_capacidade_tarde: beCapacidadeTarde,
  } = useTaxasEspecialidadeCalculo()
  const [cenarioPerdaPct, setCenarioPerdaPct] = useState<CenarioPerdaPct>(20)
  // Mesma lista usada pelo painel de sugestões automáticas (useSugestoesContratacao.ts)
  // — sem isso, anexarSala aqui ignorava exclusividade obrigatória/preferencial e
  // podia mostrar uma sala "livre" que a sugestão automática já descartou por regra.
  const [exclusividades, setExclusividades] = useState<SalaTerapiaExclusiva[]>([])
  useEffect(() => {
    let cancelled = false
    listarExclusividadesTerapia().then(r => { if (!cancelled) setExclusividades(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [especialidade, setEspecialidade] = useState("")
  const [periodosSel, setPeriodosSel] = useState<Record<string, { manha?: boolean; tarde?: boolean }>>({})
  const [unidadeFixada, setUnidadeFixada] = useState("")
  const [detalhe, setDetalhe] = useState<DetalheModalData | null>(null)
  const [detalheRemanejamento, setDetalheRemanejamento] = useState<{ sugestao: SugestaoContratacao; candidato: CandidatoNaSugestao; profissionalHipotetico?: string } | null>(null)
  const [detalheFinanceiroAberto, setDetalheFinanceiroAberto] = useState(false)
  const [vagaGradeAberta, setVagaGradeAberta] = useState<{ dia: string; vaga: GrupoVaga; cobertos?: { unidade: string; candidatos: CandidatoSlot[] } } | null>(null)
  const [vagaCobertaAberta, setVagaCobertaAberta] = useState<{ dia: string; hora: string; unidade: string; candidatos: CandidatoSlot[] } | null>(null)
  const [destaqueAplicado, setDestaqueAplicado] = useState(false)
  const parametrosRef = useRef<HTMLDivElement>(null)

  const espOptions = useMemo(() => listarEspecialidades(), [])
  const especialidadeValida = espOptions.includes(especialidade)
  const laudosCarregados = lRows.length > 0

  const gaps = useMemo(() => calcularGaps(lRows, cRows), [lRows, cRows])
  const gapMap = useMemo(() => gapsParaMapa(gaps), [gaps])

  // Quantos profissionais já contratados estão "Livre" (Status do Agendamento)
  // no mesmo dia+hora+unidade+especialidade de cada vaga simulada — essa é a
  // mesma vaga que apareceria em "Ocupar Profissionais Disponíveis". Quando
  // > 0, os candidatos dessa vaga já podem ser encaixados hoje, sem esperar a
  // contratação hipotética: destacamos isso na tabela abaixo.
  const vagasInternasPorChave = useMemo(() => {
    const mapa = new Map<string, SlotLivre[]>()
    for (const s of listarSlotsLivres(cRows)) {
      if (s.especialidade !== especialidade) continue
      const chave = `${s.dia}|||${s.hora}|||${s.unidade}`
      if (!mapa.has(chave)) mapa.set(chave, [])
      mapa.get(chave)!.push(s)
    }
    return mapa
  }, [cRows, especialidade])

  const periodosAlvo = useMemo((): PeriodoAlvo[] =>
    DIAS_UTIL.flatMap(dia =>
      (["manha", "tarde"] as Turno[]).filter(turno => periodosSel[dia]?.[turno]).map(turno => ({ dia, turno })),
    ), [periodosSel])

  const podeSimular = laudosCarregados && especialidadeValida && cRows.length > 0 && periodosAlvo.length > 0

  // Capacidade interna já usada por Direto (mesma fonte de "Ocupar
  // Profissionais Disponíveis") — sem descontar isso na hora de ESCOLHER a
  // unidade, o ranking/plano recomendado podia preferir uma unidade cuja
  // "demanda" era só candidato(s) que a capacidade interna já cobre sozinha
  // (nenhuma contratação resolveria nada ali), perdendo pra unidade com
  // demanda real. Ver sessoesLiquidas em simulacaoNovoPrestador.ts.
  const capacidadePorGrupo = useMemo(() => capacidadeDiretaRestante(cRows, gapMap), [cRows, gapMap])

  const unitRank = useMemo(() =>
    podeSimular ? ranquearUnidades(periodosAlvo, especialidade, cRows, gapMap, capacidadePorGrupo) : [],
    [podeSimular, periodosAlvo, especialidade, cRows, gapMap, capacidadePorGrupo],
  )

  const planoRecomendado = useMemo(() =>
    podeSimular ? montarPlanoRecomendado(periodosAlvo, especialidade, cRows, gapMap, capacidadePorGrupo) : [],
    [podeSimular, periodosAlvo, especialidade, cRows, gapMap, capacidadePorGrupo],
  )

  // totalVagas conta horários distintos (slots), não candidatos — um mesmo
  // horário pode ter vários pacientes concorrendo (ver "Sessões e candidatos"),
  // então somar candidatos.length inflaria a contagem de vagas reais.
  const planoStats = useMemo(() => {
    const pacientes = new Set<string>()
    let totalVagas = 0
    for (const p of planoRecomendado) {
      totalVagas += p.slots.length
      p.slots.forEach(s => s.candidatos.forEach(c => pacientes.add(c.pac)))
    }
    return { nPacientes: pacientes.size, totalVagas }
  }, [planoRecomendado])

  // Quando todos os períodos do plano recomendado caem na mesma unidade, o
  // plano não é de fato "misto" — é uma recomendação de unidade única. Evita
  // repetir o nome da unidade em cada célula da grade e permite liderar com o
  // número/unidade em vez de forçar a leitura de 10 células idênticas.
  const planoHomogeneo = useMemo(() => {
    if (!planoRecomendado.length) return null
    const unidades = new Set(planoRecomendado.map(p => p.unidade))
    return unidades.size === 1 ? planoRecomendado[0].unidade : null
  }, [planoRecomendado])

  const vagasDaUnidade = (u: { periodos: PeriodoSimulado[] }) => u.periodos.reduce((soma, p) => soma + p.slots.length, 0)

  // Das vagas BRUTAS acima, quantas exigiriam DE FATO a contratação — o resto
  // já é coberto por profissional contratado com horário Livre no mesmo slot,
  // então contratar não abre aquelas sessões. Sem essa distinção a tela
  // afirmava "4 vaga(s)" ao lado de uma projeção de R$ 0,00, sem nada
  // explicando a contradição (caso real Padre Miguel/Fonoaudiologia,
  // 27/08/2026 — a leitura foi "o Break Even parou de funcionar").
  //
  // Vem de periodosEnriquecidos, que é EXATAMENTE a fonte da projeção
  // financeira — então os dois números nunca podem discordar. Duas
  // alternativas foram medidas e descartadas:
  //
  //   • recalcular por uma conta paralela sobre capacidadeDiretaRestante é
  //     mais barato, mas ERRADO: a divisão real também consome a capacidade
  //     livre sobrante nos candidatos de remanejamento (capacidadeLivrePorGrupo,
  //     ver dividirPorDisponibilidadeInterna). Dava "2 exigem contratação"
  //     onde o pipeline real dá 0 — reproduzindo, menor, a mesma contradição.
  //
  //   • rodar o pipeline completo para as TRÊS unidades dá o número certo em
  //     todas as barras, mas custa 2–3 s de trabalho bloqueante por render
  //     (medido nos dados de produção; ficou mais caro ainda depois de laudo
  //     vencido passar a contar). Caro demais para um rótulo.
  //
  // Por isso o número líquido só aparece onde é gratuito: na unidade em
  // exibição e no plano recomendado. As outras barras seguem mostrando o bruto
  // sem afirmar nada sobre cobertura — melhor não dizer do que dizer errado.
  //
  // Conta VAGAS distintas (dia+hora), não candidatos: duas pessoas disputando
  // o mesmo horário são uma vaga só, igual ao que a barra mostra no bruto.
  // Declarado adiante, junto de nPacientesExibidos — depende de
  // periodosEnriquecidos, que só existe depois do pipeline de enriquecimento.

  const periodosExibidos = useMemo((): PeriodoSimulado[] => {
    if (!podeSimular) return []
    const bruto = unidadeFixada
      ? periodosAlvo.map(p => avaliarPeriodo(p.dia, p.turno, unidadeFixada, especialidade, cRows, gapMap))
      : planoRecomendado
    // planoRecomendado já sai limitado por limitarCandidatosPorGap (dentro de
    // montarPlanoRecomendado) — chamar de novo aqui é inofensivo (idempotente)
    // e cobre o caminho de unidade fixada, que não passa por lá.
    return limitarCandidatosPorGap(bruto, gapMap, especialidade, capacidadePorGrupo)
  }, [podeSimular, unidadeFixada, periodosAlvo, especialidade, cRows, gapMap, planoRecomendado, capacidadePorGrupo])

  const escalaComparativo = Math.max(1, planoStats.totalVagas, ...unitRank.map(vagasDaUnidade))

  const mesReferencia = useMemo(() => {
    const [ano, mes] = refWeek.inicio.split("-").map(Number)
    return ano && mes ? { ano, mes } : null
  }, [refWeek.inicio])

  const labelMesReferencia = useMemo(() => {
    if (!mesReferencia) return ""
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(mesReferencia.ano, mesReferencia.mes - 1, 1))
    return label.charAt(0).toUpperCase() + label.slice(1)
  }, [mesReferencia])

  // Enriquece cada período exibido (modalidade adjacente/remanejamento,
  // disponibilidade interna, sala livre vinculada e valor de cada sessão pelo
  // cadastro de valores) — mesmo pipeline e mesma ordem usados pelo painel de
  // sugestões automáticas (useSugestoesContratacao.ts), só que aplicado aos
  // períodos escolhidos manualmente aqui (um "período" vira uma
  // SugestaoContratacao de 1 turno só só pra reaproveitar os mesmos estágios).
  // Sem o estágio de disponibilidade interna, a projeção financeira contava
  // pacientes que já dá pra atender com quem existe — inflando a receita em
  // relação ao que a sugestão automática mostra pro mesmo dia/turno/unidade.
  // Base compartilhada por periodosEnriquecidos (candidatos que REALMENTE
  // precisariam da contratação) e periodosCobertos (candidatos que a
  // capacidade interna já atende sozinha) — ambos precisam partir do MESMO
  // enriquecimento de adjacência/remanejamento antes de se dividirem na
  // disponibilidade interna, senão os dois lados poderiam divergir.
  const comRemanejamento = useMemo((): SugestaoContratacao[] => {
    if (!podeSimular) return []
    const base = periodosComoSugestoes(periodosExibidos, especialidade)
    return anexarModalidadeERemanejamento(base, cRows, gapMap)
  }, [podeSimular, periodosExibidos, especialidade, cRows, gapMap])

  const periodosEnriquecidos = useMemo((): SugestaoContratacao[] => {
    if (!podeSimular) return []
    const comDisponibilidade = filtrarPorDisponibilidadeInterna(comRemanejamento, cRows, gapMap)
    const comSala = anexarSala(comDisponibilidade, salasComOcupacao, exclusividades)
    return anexarRemuneracaoEOrdenar(comSala, cRows, regrasGerais, excecoesPaciente, mesReferencia, feriados)
  }, [podeSimular, comRemanejamento, cRows, gapMap, salasComOcupacao, exclusividades, regrasGerais, excecoesPaciente, mesReferencia, feriados])

  // Vagas/pacientes do PLANO RECOMENDADO já descontados da cobertura interna —
  // o card do plano mostrava o bruto (`planoStats`) enquanto o Detalhamento, a
  // agenda e a projeção financeira logo abaixo mostravam o líquido, então a
  // mesma unidade aparecia com dois pares de números na mesma tela ("38 vagas ·
  // 50 pacientes" no card contra "40 pacientes · 32 vagas" no Detalhamento —
  // reportado em 27/08/2026 como número errado, e é só bruto vs. líquido).
  //
  // Quando nenhuma unidade está fixada o plano É a seleção em exibição, então
  // periodosEnriquecidos já é exatamente este cálculo e reusá-lo custa zero.
  // Com uma unidade fixada o plano sai de exibição e não há como reaproveitar:
  // aí paga um enriquecimento próprio (~0,7-1,0 s medido nos dados de
  // produção). Só um plano, nunca as três unidades — é a diferença entre este
  // custo e o que descartei em vagasLiquidasEmExibicao. Roda dentro do
  // startTransition de setUnidadeFixada, então não bloqueia a interação.
  const planoEnriquecido = useMemo((): SugestaoContratacao[] => {
    if (!podeSimular) return []
    if (!unidadeFixada) return periodosEnriquecidos
    const comRem = anexarModalidadeERemanejamento(periodosComoSugestoes(planoRecomendado, especialidade), cRows, gapMap)
    return filtrarPorDisponibilidadeInterna(comRem, cRows, gapMap)
  }, [podeSimular, unidadeFixada, periodosEnriquecidos, planoRecomendado, especialidade, cRows, gapMap])

  const planoStatsLiquidas = useMemo(() => ({
    vagas: new Set(planoEnriquecido.flatMap(s => s.candidatos.map(c => `${s.dia}|||${c.hora}`))).size,
    nPacientes: new Set(planoEnriquecido.flatMap(s => s.candidatos.map(c => c.paciente))).size,
  }), [planoEnriquecido])

  // Clampado em 0 pelo mesmo motivo de cobertasInternamente nas barras: o
  // líquido pode passar do bruto, porque anexarModalidadeERemanejamento cria
  // candidatos que avaliarPeriodo não tinha.
  const planoCobertasInternamente = Math.max(0, planoStats.totalVagas - planoStatsLiquidas.vagas)

  // Candidatos que a capacidade interna JÁ cobre sozinha (ver
  // separarCobertosPorDisponibilidadeInterna) — contratando ou não, essa vaga
  // vai ser preenchida por quem já está na clínica, então não entram em
  // periodosEnriquecidos (nem na projeção financeira, carga semanal ou
  // "Agenda do novo profissional"): ganham a própria agenda separada,
  // "Agenda atual disponível já cobre".
  const periodosCobertos = useMemo((): SugestaoContratacao[] =>
    podeSimular ? separarCobertosPorDisponibilidadeInterna(comRemanejamento, cRows, gapMap) : [],
    [podeSimular, comRemanejamento, cRows, gapMap],
  )

  // periodosEnriquecidosParaSimulado (usado pra montar agendaJaCoberta, a
  // grade "Agenda atual disponível já cobre") achata cada candidato pro
  // formato CandidatoSlot, que não carrega `modalidade`/`remanejamento` — só
  // serve pra desenhar a grade. Esse índice preserva o CandidatoNaSugestao
  // ORIGINAL (com modalidade intacta) pra quando o usuário clica numa vaga
  // coberta: sem ele, todo candidato "já coberto" abria o modal simples
  // (PacienteAgendaHipoteticaModal), mesmo quando só é válido via
  // remanejamento — mostrando a sessão hipotética sobreposta à sessão que
  // ocupa o horário, sem nunca exibir/aplicar o remanejamento que o tornou
  // válido (bug real 2026-08-18, casos Davi Dantas/Enzo Gabriel).
  const cobertoPorChave = useMemo(() => {
    const m = new Map<string, CandidatoNaSugestao>()
    for (const s of periodosCobertos) {
      for (const c of s.candidatos) m.set(`${s.dia}|||${c.hora}|||${s.unidade}|||${c.paciente}`, c)
    }
    return m
  }, [periodosCobertos])

  // Mesmo critério de abrirDetalheCandidato (modalidade decide o modal), só
  // que pra um candidato "já coberto" (originado de vagaGradeAberta.cobertos/
  // vagaCobertaAberta, sem o objeto LinhaCandidato completo) — recupera a
  // modalidade real via cobertoPorChave antes de decidir.
  const abrirDetalheCoberto = (dia: string, hora: string, unidade: string, pac: string, profissionalHipotetico?: string) => {
    const c = cobertoPorChave.get(`${dia}|||${hora}|||${unidade}|||${pac}`)
    if (c?.modalidade === "remanejamento" && c.remanejamento) {
      setDetalheRemanejamento({ sugestao: { especialidade } as SugestaoContratacao, candidato: c, profissionalHipotetico })
      return
    }
    setDetalhe({
      pac,
      slot: { dia, turno: turnoFromHora(hora), unidade, hora, candidatos: [] },
      especialidade,
      profissionalHipotetico,
    })
  }

  // Nomes de quem já está coberto internamente, por vaga (dia+turno+hora+
  // unidade) — usado em "Sessões e candidatos" pra mostrar QUEM já é atendido
  // em vez de só a contagem genérica "+N paciente(s)".
  const cobertosPorVaga = useMemo(() => {
    const mapa = new Map<string, string[]>()
    for (const s of periodosCobertos) {
      for (const c of s.candidatos) {
        const chave = `${s.dia}|||${c.turno}|||${c.hora}|||${s.unidade}`
        const lista = mapa.get(chave) ?? []
        lista.push(c.paciente)
        mapa.set(chave, lista)
      }
    }
    return mapa
  }, [periodosCobertos])

  // Agenda/carga semanal/ocupação por dia precisam refletir o MESMO conjunto
  // de vagas que "Sessões e candidatos" e a projeção financeira (remanejamento
  // incluído, disponibilidade interna descontada) — antes essa visualização
  // vinha direto de periodosExibidos (só adjacência, sem descontar
  // disponibilidade interna), então uma vaga preenchida por remanejamento
  // aparecia como "livre/ociosa" aqui mesmo já tendo receita projetada.
  const agendaNovoProf = useMemo(() =>
    podeSimular
      ? construirAgendaNovoProfissional(completarPeriodosSelecionados(
          periodosEnriquecidosParaSimulado(periodosEnriquecidos), periodosExibidos,
        ))
      : null,
    [podeSimular, periodosEnriquecidos, periodosExibidos],
  )

  // Espelha agendaNovoProf, só que pro lado "já coberto internamente" — usada
  // pra: (1) render da 2ª grade "Agenda atual disponível já cobre"; (2) saber,
  // célula a célula, se ali havia coberta interna (pra colorir de vermelho a
  // Agenda do novo profissional quando a vaga inteira já está coberta, e pra
  // não mostrar nome específico quando a divisão restante/coberto é ambígua).
  const agendaJaCoberta = useMemo(() =>
    podeSimular ? construirAgendaNovoProfissional(periodosEnriquecidosParaSimulado(periodosCobertos)) : null,
    [podeSimular, periodosCobertos],
  )

  // Eixos (dias/horas) unificados das duas agendas — uma vaga 100% coberta
  // internamente some inteira de agendaNovoProf (todos os candidatos migraram
  // pra periodosCobertos), então sem essa união o dia/hora correspondente
  // simplesmente desapareceria da grade em vez de aparecer em vermelho.
  const diasAgendas = useMemo(() => {
    const vistos = new Set([...(agendaNovoProf?.dias ?? []), ...(agendaJaCoberta?.dias ?? [])])
    return DIAS_UTIL.filter(d => vistos.has(d))
  }, [agendaNovoProf, agendaJaCoberta])

  const horasAgendas = useMemo(() => {
    const vistos = new Set([...(agendaNovoProf?.horasGrid ?? []), ...(agendaJaCoberta?.horasGrid ?? [])])
    return [...vistos].sort((a, b) => (pm(a) ?? 0) - (pm(b) ?? 0))
  }, [agendaNovoProf, agendaJaCoberta])

  const nPacientesExibidos = useMemo(
    () => new Set(periodosEnriquecidos.flatMap(s => s.candidatos.map(c => c.paciente))).size,
    [periodosEnriquecidos],
  )

  /** Vagas que exigiriam de fato a contratação na seleção em exibição — ver o
   *  bloco de comentário em vagasDaUnidade acima. Mesma fonte da projeção
   *  financeira, então os dois números nunca discordam. */
  const vagasLiquidasEmExibicao = useMemo(
    () => new Set(periodosEnriquecidos.flatMap(s => s.candidatos.map(c => `${s.dia}|||${c.hora}`))).size,
    [periodosEnriquecidos],
  )

  // Soma só a melhor oferta de cada vaga (já resolvido por anexarRemuneracaoEOrdenar
  // por período) — reflete o que se ganharia priorizando sempre o paciente mais
  // rentável em cada disputa, nunca somando os dois lados de uma mesma vaga.
  const resumoFinanceiro = useMemo(() => {
    let semanal = 0, mensal = 0
    for (const s of periodosEnriquecidos) {
      semanal += s.projecaoRemuneracao?.receitaSemanalProjetada ?? 0
      mensal += s.projecaoRemuneracao?.receitaMensalProjetada ?? 0
    }
    return { semanal, mensal }
  }, [periodosEnriquecidos])

  // Ponto de Equilíbrio — dois modelos conforme a especialidade (ver
  // lib/remuneracao/pontoEquilibrio.ts). O valor de sessão usado em ambos é a
  // média da própria Projeção financeira acima (receita semanal ÷ vagas com
  // candidato), não um valor fixo — reaproveita o convênio já resolvido em
  // vez de pedir um número novo pro usuário.
  const breakEvenFixoDisponivel = ESPECIALIDADES_BREAK_EVEN_PJ.has(especialidade)
    && beCustoMensalPJ[especialidade] != null && beCapacidadeManha[especialidade] != null && beCapacidadeTarde[especialidade] != null && !!parametrosGerais

  // Todas as demais especialidades pagam por atendimento (taxa PA já
  // cadastrada em Taxas por Especialidade) — custo variável, não fixo.
  // taxas_pa é cadastrado por TERAPIA granular (ex.: "Aplicador ABA (PS)"),
  // não pela especialidade agregada ("Psicologia ABA") — terapiaDaEspecialidade
  // resolve a terapia representativa, mesma lógica já usada pro Break Even PJ.
  const taxaPAEspecialidade = taxasPA[terapiaDaEspecialidade(especialidade)] ?? 0
  const breakEvenAtendimentoDisponivel = !ESPECIALIDADES_BREAK_EVEN_PJ.has(especialidade)
    && taxaPAEspecialidade > 0 && !!parametrosGerais

  const valorSessaoMedioSimulado = agendaNovoProf && agendaNovoProf.slotsComCandidato > 0
    ? resumoFinanceiro.semanal / agendaNovoProf.slotsComCandidato
    : 0

  // O custo mensal cadastrado é pra 1 dia/semana COMPLETO (manhã+tarde) —
  // se a simulação marcar só manhã ou só tarde num dia, custo e capacidade
  // daquele dia entram só na proporção do turno (ver calcularBreakEvenPJ).
  const periodosManha = periodosAlvo.filter(p => p.turno === "manha").length
  const periodosTarde = periodosAlvo.filter(p => p.turno === "tarde").length

  const resultadoBreakEven = useMemo(() => {
    if (!breakEvenFixoDisponivel || !parametrosGerais || valorSessaoMedioSimulado <= 0) return null
    return calcularBreakEvenPJ({
      valorSessaoBruto: valorSessaoMedioSimulado,
      impostoFaturamentoPct: parametrosGerais.imposto_faturamento_pct,
      custoMensalDiaCompleto: beCustoMensalPJ[especialidade]!,
      capacidadeManha: beCapacidadeManha[especialidade]!,
      capacidadeTarde: beCapacidadeTarde[especialidade]!,
      perdaPct: cenarioPerdaPct,
      periodosManha, periodosTarde,
    })
  }, [breakEvenFixoDisponivel, parametrosGerais, valorSessaoMedioSimulado, beCustoMensalPJ, beCapacidadeManha, beCapacidadeTarde, especialidade, cenarioPerdaPct, periodosManha, periodosTarde])

  const projecaoBreakEven = useMemo(() => {
    if (!resultadoBreakEven || !agendaNovoProf) return null
    return projetarMargemBreakEvenPJ(resultadoBreakEven, cenarioPerdaPct, agendaNovoProf.slotsComCandidato)
  }, [resultadoBreakEven, agendaNovoProf, cenarioPerdaPct])

  const resultadoBreakEvenAtendimento = useMemo(() => {
    if (!breakEvenAtendimentoDisponivel || !parametrosGerais || valorSessaoMedioSimulado <= 0) return null
    return calcularBreakEvenAtendimento({
      valorSessaoBruto: valorSessaoMedioSimulado,
      impostoFaturamentoPct: parametrosGerais.imposto_faturamento_pct,
      taxaPA: taxaPAEspecialidade,
      capacidadeManha: parametrosGerais.pa_capacidade_manha_padrao,
      capacidadeTarde: parametrosGerais.pa_capacidade_tarde_padrao,
      periodosManha, periodosTarde,
    })
  }, [breakEvenAtendimentoDisponivel, parametrosGerais, valorSessaoMedioSimulado, taxaPAEspecialidade, periodosManha, periodosTarde])

  const projecaoBreakEvenAtendimento = useMemo(() => {
    if (!resultadoBreakEvenAtendimento || !agendaNovoProf) return null
    return projetarMargemBreakEvenAtendimento(resultadoBreakEvenAtendimento, taxaPAEspecialidade, cenarioPerdaPct, agendaNovoProf.slotsComCandidato)
  }, [resultadoBreakEvenAtendimento, agendaNovoProf, taxaPAEspecialidade, cenarioPerdaPct])

  // Detalhamento didático do "Projetado/mês" (bruto, calendário real do mês):
  // desconta perda e imposto passo a passo, e a remuneração do prestador
  // pra chegar na margem — tudo na MESMA base (calendário real), nunca
  // misturando com a média de 4,33 semanas/mês da frente 2 abaixo (evita o
  // mesmo bug de mistura de bases já corrigido no card de Sugestões).
  const detalheMesEspecifico = useMemo(() => {
    if (!(breakEvenFixoDisponivel || breakEvenAtendimentoDisponivel) || !parametrosGerais) return null
    const bruto = resumoFinanceiro.mensal
    const perda = cenarioPerdaPct / 100
    const imposto = parametrosGerais.imposto_faturamento_pct / 100
    // Perda primeiro (sessão que falta simplesmente não acontece, não fatura),
    // imposto depois (incide só sobre o que de fato foi faturado).
    const aposPerda = bruto * (1 - perda)
    const valorPerda = bruto - aposPerda
    const liquido = aposPerda * (1 - imposto)
    const valorImposto = aposPerda - liquido

    let custo: number | null = null
    if (breakEvenFixoDisponivel && resultadoBreakEven) {
      // Custo fixo (PJ) por turnos marcados — não depende de quantos dias o mês real tem.
      custo = resultadoBreakEven.custoMensalTotal
    } else if (breakEvenAtendimentoDisponivel) {
      // Custo variável: sessões REAIS deste mês (soma exata da coluna
      // "Sessões" de "Ver detalhe", via contarSessoesReaisMes) × taxa PA —
      // sem desconto de perda nem imposto aqui. Sessão não é fracionária: o
      // profissional recebe pela quantidade exata de sessões que de fato
      // aconteceram no calendário real, não por uma média estatística
      // (diferente da Frente 2, que projeta um valor esperado sobre a média
      // de 4,33 semanas/mês, onde uma fração de sessão faz sentido).
      const sessoesReais = contarSessoesReaisMes(periodosEnriquecidos, mesReferencia, feriados)
      custo = sessoesReais * taxaPAEspecialidade
    }
    const margem = custo !== null ? liquido - custo : null

    return { bruto, valorPerda, valorImposto, liquido, custo, margem }
  }, [breakEvenFixoDisponivel, breakEvenAtendimentoDisponivel, parametrosGerais, resumoFinanceiro.mensal, cenarioPerdaPct, resultadoBreakEven, periodosEnriquecidos, mesReferencia, feriados, taxaPAEspecialidade])

  const linhasExibidas = useMemo((): Omit<LinhaCandidato, "concorrentesNaVaga" | "priorizadoPorFrequencia" | "vagasInternasDisponiveis" | "vagasInternasSlots">[] =>
    periodosEnriquecidos.flatMap(s => s.candidatos.map(candidato => ({ dia: s.dia, unidade: s.unidade, sugestao: s, candidato }))),
  [periodosEnriquecidos])

  // Vagas reais = horários distintos (dia+turno+hora) — várias candidaturas podem disputar a mesma vaga.
  const vagasExibidas = useMemo(
    () => new Set(linhasExibidas.map(l => `${l.dia}|||${l.candidato.turno}|||${l.candidato.hora}`)).size,
    [linhasExibidas],
  )

  // Modo manual não tem um clique de "Aplicar" pra travar num aviso — a
  // combinação muda a cada toggle de dia/turno/especialidade, então em vez do
  // modal usado na sugestão automática (SugestoesContratacaoPanel), aqui é um
  // banner que aparece/desaparece ao vivo junto com o resultado.
  const algumPeriodoSemSala = useMemo(
    () => periodosEnriquecidos.some(s => !s.salaVinculada),
    [periodosEnriquecidos],
  )

  // Pra pintar o botão do turno específico (não só o banner genérico acima) —
  // cada período enriquecido é sempre 1 turno só (turnos: [p.turno], ver base
  // em periodosEnriquecidos), então a chave dia+turno é única.
  const semSalaPorDiaTurno = useMemo(() => {
    const s = new Set<string>()
    for (const p of periodosEnriquecidos) {
      if (!p.salaVinculada) s.add(`${p.dia}|||${p.turnos[0]}`)
    }
    return s
  }, [periodosEnriquecidos])

  // Agrupado por VAGA (turno+hora), não mais uma linha flat por candidatura —
  // unidade/sala/"já disponível na clínica" são atributos da vaga, iguais
  // pra todo candidato dela; repeti-los numa coluna por linha só inflava a
  // tabela sem info nova (ver cabeçalho de vaga em "Sessões e candidatos").
  const gruposPorDia = useMemo(() => {
    const porDia = new Map<string, Omit<LinhaCandidato, "concorrentesNaVaga" | "priorizadoPorFrequencia" | "vagasInternasDisponiveis" | "vagasInternasSlots">[]>()
    for (const l of linhasExibidas) {
      if (!porDia.has(l.dia)) porDia.set(l.dia, [])
      porDia.get(l.dia)!.push(l)
    }
    return DIAS_UTIL
      .filter(d => porDia.has(d))
      .map(dia => {
        const linhasDoDia = porDia.get(dia)!
        const porVaga = new Map<string, typeof linhasDoDia>()
        for (const l of linhasDoDia) {
          const chave = `${l.candidato.turno}|||${l.candidato.hora}`
          if (!porVaga.has(chave)) porVaga.set(chave, [])
          porVaga.get(chave)!.push(l)
        }
        const empatePorVaga = new Map<string, boolean>()
        for (const [chave, itens] of porVaga.entries()) {
          const valores = itens.map(l => l.candidato.valorSessaoProjetado ?? -Infinity)
          empatePorVaga.set(chave, valores.filter(v => v === Math.max(...valores)).length > 1)
        }
        const vagas: GrupoVaga[] = [...porVaga.entries()]
          .map(([chave, itens]) => {
            const linhas: LinhaCandidato[] = itens
              .map(l => ({
                ...l,
                concorrentesNaVaga: porVaga.get(chave)?.length ?? 1,
                priorizadoPorFrequencia: empatePorVaga.get(chave) ?? false,
                vagasInternasDisponiveis: (vagasInternasPorChave.get(`${dia}|||${l.candidato.hora}|||${l.unidade}`) ?? []).length,
                vagasInternasSlots: vagasInternasPorChave.get(`${dia}|||${l.candidato.hora}|||${l.unidade}`) ?? [],
              }))
              .sort((a, b) => a.candidato.ordemNaVaga - b.candidato.ordemNaVaga)
            return { turno: linhas[0].candidato.turno, hora: linhas[0].candidato.hora, linhas }
          })
          .sort((a, b) => a.turno.localeCompare(b.turno) || a.hora.localeCompare(b.hora))
        return { dia, vagas }
      })
  }, [linhasExibidas, vagasInternasPorChave])

  // Índice dia+hora → vaga (mesmo dado de "Sessões e candidatos", só que
  // indexado pra lookup O(1) ao clicar numa célula de "Agenda do novo
  // profissional") — evita duplicar a lógica de agrupamento/prioridade de
  // candidatos, que já vive em gruposPorDia.
  const vagaPorDiaHora = useMemo(() => {
    const m = new Map<string, GrupoVaga>()
    for (const grupo of gruposPorDia) {
      for (const vaga of grupo.vagas) m.set(`${grupo.dia}|||${vaga.hora}`, vaga)
    }
    return m
  }, [gruposPorDia])

  // Mesma ação dos botões "Ver detalhe"/"Ver antes/depois" de CardVaga
  // (Sessões e candidatos), reaproveitada aqui pra abrir direto da grade de
  // "Agenda do novo profissional" — sem repetir a lógica de profissionalHipotetico.
  const abrirDetalheCandidato = (linha: LinhaCandidato) => {
    const c = linha.candidato
    const profissionalHipotetico = linha.vagasInternasDisponiveis > 0 ? linha.vagasInternasSlots[0]?.profissional : undefined
    if (c.modalidade === "adjacente") {
      setDetalhe({
        pac: c.paciente,
        slot: { dia: linha.dia, turno: c.turno, unidade: linha.unidade, hora: c.hora, candidatos: [] },
        especialidade,
        profissionalHipotetico,
      })
    } else {
      setDetalheRemanejamento({ sugestao: linha.sugestao, candidato: c, profissionalHipotetico })
    }
  }

  // Clique numa célula da grade: com só 1 candidato na vaga (e nenhum já
  // coberto internamente) pula o seletor e já abre a agenda proposta direto
  // (pedido do usuário 2026-08-17) — o seletor só aparece quando há mais de 1
  // opção no total, incluindo o caso "parcialmente coberto" (pedido do
  // usuário 2026-08-17: célula ambígua mostra as 3 opções — direto,
  // remanejamento e já coberto — juntas no mesmo modal).
  const abrirVagaGrade = (dia: string, vaga: GrupoVaga, cobertos?: { unidade: string; candidatos: CandidatoSlot[] }) => {
    if (vaga.linhas.length === 1 && !cobertos?.candidatos.length) {
      abrirDetalheCandidato(vaga.linhas[0])
      return
    }
    setVagaGradeAberta({ dia, vaga, cobertos })
  }

  // startTransition mantém o clique responsivo: o recálculo do plano (cadeia
  // de useMemo em ranquearUnidades/montarPlanoRecomendado/periodosEnriquecidos,
  // que varre a grade inteira) é pesado e síncrono — sem isso, o navegador
  // trava até o cálculo terminar antes de sequer repintar o botão pressionado.
  const alternar = (dia: string, turno: Turno) => {
    startTransition(() => {
      setUnidadeFixada("")
      setPeriodosSel(prev => ({ ...prev, [dia]: { ...prev[dia], [turno]: !prev[dia]?.[turno] } }))
    })
  }
  const alternarDiaInteiro = (dia: string) => {
    startTransition(() => {
      setUnidadeFixada("")
      setPeriodosSel(prev => {
        const atual = prev[dia] || {}
        const todosMarcados = !!atual.manha && !!atual.tarde
        return { ...prev, [dia]: { manha: !todosMarcados, tarde: !todosMarcados } }
      })
    })
  }
  const selecionarTudo = () => startTransition(() => {
    setUnidadeFixada("")
    setPeriodosSel(Object.fromEntries(DIAS_UTIL.map(d => [d, { manha: true, tarde: true }])))
  })
  const limparTudo = () => startTransition(() => { setUnidadeFixada(""); setPeriodosSel({}) })

  const aplicarSugestao = (esp: string, periodos: { dia: string; turno: Turno }[], unidade: string) => {
    startTransition(() => {
      setEspecialidade(esp)
      setPeriodosSel(Object.fromEntries(
        DIAS_UTIL.map(dia => [dia, {
          manha: periodos.some(p => p.dia === dia && p.turno === "manha"),
          tarde: periodos.some(p => p.dia === dia && p.turno === "tarde"),
        }]),
      ))
      setUnidadeFixada(unidade)
    })

    // Sem isso o usuário não percebe que a sugestão foi aplicada: os campos
    // preenchidos ficam abaixo da dobra, dentro de "Parâmetros da simulação".
    // Ficam fora do startTransition acima (não dependem do recálculo pesado).
    parametrosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    setDestaqueAplicado(true)
    setTimeout(() => setDestaqueAplicado(false), 2200)
  }

  return (
    <div className="flex flex-col gap-3">
      <SugestoesContratacaoPanel onAplicarSugestao={aplicarSugestao} />

      {/* Parâmetros */}
      <div
        ref={parametrosRef}
        className={`pp @container rounded-2xl border p-5 sm:p-6 transition-colors duration-700 ${
          destaqueAplicado
            ? "border-emerald-400 bg-[var(--pp-surface)] ring-4 ring-emerald-200"
            : "border-[var(--pp-border)] bg-[var(--pp-surface)] shadow-[var(--pp-sombra)]"
        }`}
      >
        <CabecalhoPastel
          id="parametros-simulacao"
          titulo="Parâmetros da simulação"
          t="azul"
          Icone={Sliders}
          direita={
            destaqueAplicado ? (
              <span className="animate-in fade-in slide-in-from-left-1 duration-300 flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white dark:bg-emerald-500">
                <Sparkles size={11} /> Sugestão aplicada
              </span>
            ) : null
          }
          apoio={
            <>
              Simule um novo profissional por especialidade, dia e turno para ver quantos pacientes com sessões pendentes ele conseguiria atender.
              <InfoTip ariaLabel="Como a simulação escolhe os pacientes">
                <p>Considera pacientes com <strong className="text-foreground">autorizado &gt; ofertado</strong> que já frequentam a unidade naquele dia, sem conflito de horário.</p>
                <p className="mt-2">Respeita o sequenciamento clínico: mínimo <strong className="text-foreground">1 sessão no dia</strong>, sempre em blocos consecutivos de <strong className="text-foreground">40min</strong>.</p>
              </InfoTip>
            </>
          }
        />

        {!laudosCarregados ? (
          <InlineNotice tone="amber" icon={<Lock size={15} />}>
            <strong>Relatório de laudos não anexado.</strong> Sem ele não é possível calcular quem tem sessões pendentes (autorizado × ofertado), então a simulação fica bloqueada. Anexe o relatório de laudos para liberar a especialidade e os dias/turnos.
          </InlineNotice>
        ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex w-full lg:w-56 shrink-0 flex-col gap-2 rounded-xl border border-[var(--pp-border)] bg-[var(--pp-muted)] p-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--pp-ink-muted)]">Especialidade</span>
            <EspecialidadeCombobox value={especialidade} onChange={setEspecialidade} opcoes={espOptions} />
          </div>

          <div className="w-full lg:w-fit rounded-xl border border-[var(--pp-border)] bg-[var(--pp-muted)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-[var(--pp-ink-muted)]">
                Dias e turnos
                <InfoTip ariaLabel="Como marcar dias e turnos">
                  <p>Marque <strong className="text-foreground">manhã</strong>, <strong className="text-foreground">tarde</strong> ou <strong className="text-foreground">dia inteiro</strong>.</p>
                  <p className="mt-2">A recomendação avalia cada período separadamente — pode indicar <strong className="text-foreground">unidades diferentes</strong> por turno.</p>
                </InfoTip>
              </span>
              <div className="ml-auto flex gap-1.5">
                <Button variant="outline" size="xs" onClick={selecionarTudo}>Selecionar tudo</Button>
                <Button variant="outline" size="xs" onClick={limparTudo}>Limpar</Button>
              </div>
            </div>
            <table className="table-fixed border-separate border-spacing-x-1.5 border-spacing-y-1">
              <colgroup>
                <col className="w-14" />
                <col className="w-[92px]" />
                <col className="w-[92px]" />
                <col className="w-[92px]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="w-14" />
                  <th className="pb-1 text-[10px] font-bold text-[var(--pp-ink-muted)]">Manhã</th>
                  <th className="pb-1 text-[10px] font-bold text-[var(--pp-ink-muted)]">Tarde</th>
                  <th className="pb-1 text-[10px] font-bold text-[var(--pp-ink-muted)]">Dia inteiro</th>
                </tr>
              </thead>
              <tbody>
                {DIAS_UTIL.map(dia => {
                  const diaInteiro = !!periodosSel[dia]?.manha && !!periodosSel[dia]?.tarde
                  return (
                    <tr key={dia}>
                      <td className="pr-1 text-xs font-extrabold uppercase text-[var(--pp-ink)]">{diaCurto(dia)}</td>
                      {(["manha", "tarde"] as Turno[]).map(turno => {
                        const marcado = !!periodosSel[dia]?.[turno]
                        const semSala = marcado && semSalaPorDiaTurno.has(`${dia}|||${turno}`)
                        return (
                          <td key={turno} className="p-0">
                            <button
                              type="button"
                              onClick={() => alternar(dia, turno)}
                              aria-pressed={marcado}
                              title={semSala ? "Selecionado, mas sem sala livre encontrada" : undefined}
                              className={`h-8 w-full rounded-full border text-xs font-bold transition-colors ${
                                semSala
                                  ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                                  : marcado
                                    ? "border-[var(--pp-verde)] bg-[var(--pp-verde)] text-white"
                                    : "border-[var(--pp-border)] bg-[var(--pp-surface)] text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)]"
                              }`}
                            >
                              {semSala
                                ? <IconeSemSala size={14} />
                                : marcado
                                  ? <CheckCircle2 size={14} className="mx-auto" />
                                  : turnoNome[turno]}
                            </button>
                          </td>
                        )
                      })}
                      <td className="p-0">
                        <button
                          type="button"
                          onClick={() => alternarDiaInteiro(dia)}
                          aria-pressed={diaInteiro}
                          className={`h-8 w-full rounded-full border px-2.5 text-[11px] font-semibold transition-colors ${diaInteiro ? "border-[var(--pp-verde)] bg-[var(--pp-verde)] text-white" : "border-[var(--pp-border)] bg-[var(--pp-surface)] text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)]"}`}
                        >
                          {diaInteiro ? <CheckCircle2 size={14} className="mx-auto" /> : "Marcar"}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!periodosAlvo.length && (
              <div className="mt-2 text-[11px] font-bold text-rose-600 dark:text-rose-400">Selecione pelo menos um dia/turno.</div>
            )}
            {podeSimular && algumPeriodoSemSala && (
              <div className="mt-2 flex animate-pulse items-center gap-1.5 text-[11px] font-bold text-red-600 dark:text-red-400">
                <IconeSemSala size={14} />
                Sem sala livre encontrada
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {gradeLoading && (
        <InlineNotice tone="slate">
          Carregando grade da semana de referência ({refWeek.label})…
        </InlineNotice>
      )}

      {!gradeLoading && gradeError && (
        <InlineNotice tone="red">
          Falha ao carregar a grade da semana de referência: {gradeError}
        </InlineNotice>
      )}

      {!gradeLoading && !gradeError && !cRows.length && (
        <InlineNotice tone="amber">
          Nenhuma sessão encontrada na semana de referência ({refWeek.label}). Verifique se a grade foi sincronizada, e anexe o relatório de laudos para usar esta ferramenta.
        </InlineNotice>
      )}

      {cRows.length > 0 && especialidade && !especialidadeValida && (
        <InlineNotice tone="red">
          Escolha uma especialidade válida da lista para simular.
        </InlineNotice>
      )}

      {/* Comparativo de unidades */}
      {podeSimular && (
        <>
          {/* SEÇÃO 1 — decisão: onde encaixar esse profissional */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border bg-muted px-4 py-2.5">
              <div className="text-sm font-extrabold text-foreground">Onde encaixar esse profissional</div>
              <div className="text-[11px] text-muted-foreground">{periodosAlvo.length} período(s) simulado(s) em {unitRank.length} unidade(s) candidatas</div>
            </div>

            <div className="flex flex-col lg:flex-row items-start gap-6 p-4">
              <button
                type="button"
                onClick={() => startTransition(() => setUnidadeFixada(""))}
                className={`flex w-full flex-col lg:w-[420px] shrink-0 rounded-xl border-2 p-3 text-left transition-colors ${!unidadeFixada ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30" : "border-border bg-card hover:bg-muted/40"}`}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <Star size={13} className="text-sky-600 dark:text-sky-400" />
                  <span className="text-sm font-extrabold text-foreground">
                    Plano recomendado{planoHomogeneo ? "" : " (misto)"}
                  </span>
                  <InfoTip ariaLabel="Como o plano recomendado escolhe a unidade">
                    <p>Escolhe a <strong className="text-foreground">melhor unidade</strong> para cada dia/turno separadamente.</p>
                    <p className="mt-2">Se uma unidade for escolhida num turno (ex.: Padre Miguel de manhã), o sistema não mistura com outra unidade no outro turno do mesmo dia — <strong className="text-foreground">restrição geográfica</strong>.</p>
                  </InfoTip>
                </div>
                {planoHomogeneo ? (
                  <div className="mb-2 flex items-baseline gap-1.5">
                    <span className={`text-2xl font-black tabular-nums ${estiloUnidade(planoHomogeneo).text}`}>{planoStatsLiquidas.vagas}</span>
                    <span className="text-[12px] font-semibold text-muted-foreground">
                      vaga(s) que exigem contratação em <strong className={estiloUnidade(planoHomogeneo).text}>{planoHomogeneo}</strong> · {planoStatsLiquidas.nPacientes} paciente(s) disputando
                    </span>
                    <InfoTip ariaLabel="O que essa estimativa considera">
                      <p>Vagas que <strong className="text-foreground">só a contratação resolve</strong>, já descontado o que a agenda atual cobre sozinha — mesmo número que o <strong className="text-foreground">Detalhamento</strong> e a <strong className="text-foreground">projeção financeira</strong> usam logo abaixo.</p>
                      <p className="mt-2">No bruto, antes desse desconto, o plano tem <strong className="text-foreground">{planoStats.totalVagas}</strong> vaga(s) e <strong className="text-foreground">{planoStats.nPacientes}</strong> paciente(s).</p>
                      <p className="mt-2">Ainda antes de resolver <strong className="text-foreground">sala</strong>: uma vaga sem sala livre não vira contratação.</p>
                    </InfoTip>
                  </div>
                ) : (
                  <div className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <strong className="text-foreground">{planoStatsLiquidas.nPacientes} paciente(s)</strong> disputando {planoStatsLiquidas.vagas} vaga(s) que exigem contratação
                    <InfoTip ariaLabel="O que essa estimativa considera">
                      <p>Vagas que <strong className="text-foreground">só a contratação resolve</strong>, já descontado o que a agenda atual cobre sozinha — mesmo número que o <strong className="text-foreground">Detalhamento</strong> e a <strong className="text-foreground">projeção financeira</strong> usam logo abaixo.</p>
                      <p className="mt-2">No bruto, antes desse desconto, o plano tem <strong className="text-foreground">{planoStats.totalVagas}</strong> vaga(s) e <strong className="text-foreground">{planoStats.nPacientes}</strong> paciente(s).</p>
                      <p className="mt-2">Ainda antes de resolver <strong className="text-foreground">sala</strong>: uma vaga sem sala livre não vira contratação.</p>
                    </InfoTip>
                  </div>
                )}
                {planoCobertasInternamente > 0 && (
                  <div className="mb-2 text-[10.5px] font-bold leading-tight text-amber-700 dark:text-amber-400">
                    + {planoCobertasInternamente} vaga(s) que a agenda atual já pode cobrir internamente
                  </div>
                )}
                <PlanoGradeSemanal periodos={planoRecomendado} />
              </button>

              <div className="w-full min-w-0 lg:max-w-[420px] lg:border-l lg:border-border lg:pl-6">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-foreground">
                    Ou fixe numa unidade única
                    <InfoTip ariaLabel="Como ler as barras de unidade">
                      <p>Cada barra mostra quantas <strong className="text-foreground">vagas de horário</strong> você teria se contratasse o novo profissional só para essa unidade, nos mesmos dias/turnos escolhidos.</p>
                      <p className="mt-2">Ao <strong className="text-foreground">clicar numa unidade</strong>, o total dela se abre nas duas parcelas que decidem a contratação: <strong className="text-foreground">exige contratação</strong> (só um profissional novo resolve) e <strong className="text-foreground">já pode cobrir internamente</strong> (existe profissional contratado com horário <strong className="text-foreground">Livre</strong> nesse mesmo slot, então essas sessões seriam preenchidas de qualquer jeito). As demais unidades mostram só o total, sem separar.</p>
                      <p className="mt-2">Uma unidade em que <strong className="text-foreground">tudo</strong> cai em já pode cobrir internamente é a que aparece com <strong className="text-foreground">margem R$ 0,00</strong> na projeção financeira: tem candidato, mas não tem receita nova.</p>
                      <p className="mt-2">A <strong className="text-foreground">marca vertical</strong> indica o total do plano recomendado (misto).</p>
                    </InfoTip>
                  </div>
                  {unidadeFixada && (
                    <Button variant="outline" size="xs" onClick={() => startTransition(() => setUnidadeFixada(""))}>Ver plano</Button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {unitRank.map(u => {
                    const cor = estiloUnidade(u.unidade)
                    const vagasUnidade = vagasDaUnidade(u)
                    const largura = (vagasUnidade / escalaComparativo) * 100
                    const referencia = (planoStats.totalVagas / escalaComparativo) * 100
                    const ativo = unidadeFixada === u.unidade
                    const semVagas = vagasUnidade === 0
                    // O número líquido só é conhecido de graça para a unidade
                    // FIXADA (é o periodosEnriquecidos em exibição). Nas outras
                    // barras não afirmamos nada sobre cobertura — ver o bloco
                    // de comentário em vagasDaUnidade.
                    const liquidoConhecido = ativo && !!unidadeFixada
                    const vagasLiquidas = liquidoConhecido ? vagasLiquidasEmExibicao : null
                    // Resto do bruto que a capacidade já contratada resolve
                    // sozinha. Clampado em 0 porque o líquido PODE passar do
                    // bruto: anexarModalidadeERemanejamento cria candidatos que
                    // avaliarPeriodo não tinha (medido: Realengo/Musicoterapia
                    // bruto=30, líquido=31) — não é subconjunto.
                    const cobertasInternamente = vagasLiquidas === null ? 0 : Math.max(0, vagasUnidade - vagasLiquidas)
                    // Tem candidato, mas contratar ali não abre sessão nenhuma:
                    // é a unidade cuja projeção financeira dá R$ 0,00.
                    const todasCobertas = !semVagas && vagasLiquidas === 0
                    const ehRecomendada = !unidadeFixada && planoHomogeneo === u.unidade
                    return (
                      <button
                        key={u.unidade}
                        type="button"
                        onClick={() => startTransition(() => setUnidadeFixada(ativo ? "" : u.unidade))}
                        className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                          ativo
                            ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30"
                            : semVagas
                              ? "border-transparent opacity-70 hover:opacity-100 hover:bg-muted/40"
                              : "border-transparent hover:bg-muted/50"
                        }`}
                      >
                        <span className={`flex w-[104px] shrink-0 items-center gap-1 truncate text-[12px] font-bold ${semVagas ? "text-muted-foreground" : cor.text}`}>
                          {ehRecomendada && <Star size={10} className="shrink-0 text-sky-600 dark:text-sky-400" />}
                          {u.unidade}
                        </span>
                        {/* Barra segue medindo o BRUTO — é o que dá para saber
                            das três unidades sem pagar o pipeline completo, e
                            mantém as barras comparáveis entre si. A distinção
                            bruto × exige-contratação aparece no número à
                            direita, para a unidade fixada. */}
                        <span
                          className="relative h-3 w-24 shrink-0 rounded-full bg-muted"
                          title={
                            semVagas ? undefined
                              : vagasLiquidas === null ? `${vagasUnidade} vaga(s) no total`
                              : `${vagasUnidade} vaga(s) no total · ${vagasLiquidas} exigiria(m) contratação`
                          }
                        >
                          {!semVagas && <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${cor.bar} ${todasCobertas ? "opacity-30" : ""}`} style={{ width: `${largura}%` }} />}
                          <span className="absolute -top-1 -bottom-1 w-[2px] bg-foreground/60" style={{ left: `${referencia}%` }} />
                        </span>
                        <span className="flex-1" />
                        {/* Quando o líquido é conhecido, o total bruto sai de
                            cena e a coluna mostra as duas parcelas que o
                            usuário precisa decidir: o que só a contratação
                            resolve e o que já dá pra cobrir com quem está aqui.
                            O bruto vira só o title da barra — como número
                            solto ele era o que contradizia a projeção
                            financeira. */}
                        <span className="w-[150px] shrink-0 text-right">
                          {semVagas ? (
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${TONE_SOFT.slate.bg} ${TONE_SOFT.slate.text}`}>
                              Sem vagas
                            </span>
                          ) : vagasLiquidas === null ? (
                            <span className="block text-[12px] font-black tabular-nums text-foreground">{vagasUnidade} vaga(s)</span>
                          ) : (
                            <>
                              {vagasLiquidas > 0 && (
                                <span className="block text-[9.5px] font-bold leading-tight text-foreground">
                                  <strong className="text-[12px] font-black tabular-nums">{vagasLiquidas}</strong>
                                  {" "}exige contratação
                                </span>
                              )}
                              {cobertasInternamente > 0 && (
                                <span className="block text-[9.5px] font-bold leading-tight text-amber-700 dark:text-amber-400">
                                  <strong className="text-[12px] font-black tabular-nums">{cobertasInternamente}</strong>
                                  {" "}já pode cobrir internamente
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Projeção financeira e Ponto de Equilíbrio — card separado dos parâmetros de entrada */}
          {laudosCarregados && podeSimular && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 text-[15px] font-extrabold text-foreground">
                Projeção financeira - Ponto de Equilíbrio (Break Even)
              </div>

              <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
              <div>
              {/* Frente 1 — mês real, com os dias úteis e feriados específicos desse calendário */}
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-black text-foreground">1</span>
                Projeção específica de {labelMesReferencia}
                <InfoTooltip ariaLabel="Como a projeção específica do mês é calculada">
                  <p>Soma, por vaga de horário, só a receita do <strong className="text-foreground">paciente mais rentável</strong> entre os que disputam aquele horário — priorizando sempre quem paga mais.</p>
                  <p className="mt-2">Projeção mensal usa os <strong className="text-foreground">dias úteis e feriados reais</strong> de {labelMesReferencia} — mesma lógica da Previsão de Receitas. Por isso não bate exatamente com a frente 2 abaixo, que usa uma média fixa de 4,33 semanas/mês.</p>
                </InfoTooltip>
              </div>
              <div className="sm:max-w-xs">
                <StatCard tone={!detalheMesEspecifico || detalheMesEspecifico.margem === null || detalheMesEspecifico.margem >= 0 ? "green" : "red"} icon={<Wallet size={14} />} label={`Margem de ${labelMesReferencia}`}>
                  {detalheMesEspecifico && detalheMesEspecifico.margem !== null ? (
                    <>
                      <div className={`text-lg font-black tabular-nums ${detalheMesEspecifico.margem >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {detalheMesEspecifico.margem >= 0 ? "+" : ""}{fmtReal(detalheMesEspecifico.margem)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Valores brutos {fmtReal(resumoFinanceiro.mensal)} · {fmtReal(resumoFinanceiro.semanal)}/semana</div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-black tabular-nums text-emerald-700 dark:text-emerald-400">{fmtReal(resumoFinanceiro.mensal)}</div>
                      <div className="text-[11px] text-muted-foreground">100% de presença · sem imposto · {fmtReal(resumoFinanceiro.semanal)}/semana</div>
                    </>
                  )}
                </StatCard>

                {detalheMesEspecifico && (
                  <div className="mt-2 space-y-1 rounded-lg bg-muted/40 px-2.5 py-2 text-[11.5px]">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Projetado (100% de presença)</span>
                      <span className="font-semibold tabular-nums text-foreground">{fmtReal(detalheMesEspecifico.bruto)}</span>
                    </div>
                    <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                      <span>− Perda ({cenarioPerdaPct}% falta/ociosidade)</span>
                      <span className="font-semibold tabular-nums">− {fmtReal(detalheMesEspecifico.valorPerda)}</span>
                    </div>
                    <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                      <span>− Imposto ({parametrosGerais?.imposto_faturamento_pct}% faturamento)</span>
                      <span className="font-semibold tabular-nums">− {fmtReal(detalheMesEspecifico.valorImposto)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-1 font-bold text-foreground">
                      <span>= Líquido</span>
                      <span className="tabular-nums">{fmtReal(detalheMesEspecifico.liquido)}</span>
                    </div>
                    {detalheMesEspecifico.custo !== null && detalheMesEspecifico.margem !== null && (
                      <>
                        <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                          <span>− Remuneração do prestador</span>
                          <span className="font-semibold tabular-nums">− {fmtReal(detalheMesEspecifico.custo)}</span>
                        </div>
                        <div className={`flex items-center justify-between border-t border-border pt-1 font-black ${detalheMesEspecifico.margem >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          <span>= Margem</span>
                          <span className="tabular-nums">{detalheMesEspecifico.margem >= 0 ? "+" : ""}{fmtReal(detalheMesEspecifico.margem)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <Button
                  variant="outline"
                  size="xs"
                  className={`mt-2 w-full px-6 ${
                    detalheMesEspecifico && detalheMesEspecifico.margem !== null && detalheMesEspecifico.margem < 0
                      ? "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                  }`}
                  onClick={() => setDetalheFinanceiroAberto(true)}
                >
                  Ver detalhe
                </Button>
              </div>
              </div>

              {(breakEvenFixoDisponivel || breakEvenAtendimentoDisponivel) && (
                <div className="mt-3 border-t border-border pt-3 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                  {/* Frente 2 — média mensal padronizada, mesma base usada pelo Ponto de Equilíbrio */}
                  <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-black text-foreground">2</span>
                    Projeção média mensal — 4,33 sem/mês e 56,33 sess/mês
                    <InfoTooltip ariaLabel="Como o Ponto de Equilíbrio é calculado">
                      {breakEvenFixoDisponivel ? (
                        <>
                          <p>Margem de <strong className="text-foreground">contribuição</strong>: cobre só o custo fixo mensal do profissional (PJ), sem rateio de sala, recepção, supervisão ou sistema.</p>
                          <p className="mt-2">Usa o <strong className="text-foreground">valor de sessão médio</strong> desta simulação (receita semanal ÷ vagas com candidato) e a <strong className="text-foreground">perda</strong> escolhida abaixo (falta + ociosidade) — ajuste em "Variáveis &amp; Taxas" o custo mensal e a capacidade diária de cada especialidade.</p>
                          {resultadoBreakEven && projecaoBreakEven && (
                            <>
                              <p className="mt-2 font-bold text-foreground">Como chega no extrato abaixo:</p>
                              <ul className="mt-1 list-disc space-y-1 pl-4">
                                <li>{fmtReal(resumoFinanceiro.semanal)} ÷ {agendaNovoProf?.slotsComCandidato ?? 0} slot(s)/semana = <strong className="text-foreground">{fmtReal(valorSessaoMedioSimulado)}</strong>/sessão (bruto)</li>
                                <li>× (1 − {parametrosGerais?.imposto_faturamento_pct}% imposto) = <strong className="text-foreground">{fmtReal(resultadoBreakEven.receitaLiquidaSessao)}</strong>/sessão líquido</li>
                                <li>{agendaNovoProf?.slotsComCandidato ?? 0} × 4,33 semanas × (1 − {cenarioPerdaPct}% perda) = <strong className="text-foreground">{projecaoBreakEven.sessoesEfetivasMes.toFixed(2)}</strong> sessões/mês</li>
                                <li>× receita líquida/sessão = <strong className="text-foreground">{fmtReal(projecaoBreakEven.receitaLiquidaMes)}</strong> receita líquida/mês</li>
                                <li>− {fmtReal(resultadoBreakEven.custoMensalTotal)} (custo fixo PJ, dos turnos marcados) = <strong className={projecaoBreakEven.margemMensal >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{projecaoBreakEven.margemMensal >= 0 ? "+" : ""}{fmtReal(projecaoBreakEven.margemMensal)}</strong> margem</li>
                              </ul>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <p>Essa especialidade paga o profissional <strong className="text-foreground">por atendimento</strong> (taxa PA), não um valor fixo — o custo cresce junto com o volume, então o Break Even é decidido pela <strong className="text-foreground">margem de uma sessão isolada</strong>, não por um piso de slots/semana.</p>
                          <p className="mt-2">A <strong className="text-foreground">perda</strong> muda a margem mensal projetada, mas não muda se a especialidade atinge o Break Even — ajuste a taxa PA em "Taxas por Especialidade" e a capacidade padrão em "Valores Padrão".</p>
                          {resultadoBreakEvenAtendimento && projecaoBreakEvenAtendimento && (
                            <>
                              <p className="mt-2 font-bold text-foreground">Como chega no extrato abaixo:</p>
                              <ul className="mt-1 list-disc space-y-1 pl-4">
                                <li>{fmtReal(resumoFinanceiro.semanal)} ÷ {agendaNovoProf?.slotsComCandidato ?? 0} slot(s)/semana = <strong className="text-foreground">{fmtReal(valorSessaoMedioSimulado)}</strong>/sessão (bruto)</li>
                                <li>× (1 − {parametrosGerais?.imposto_faturamento_pct}% imposto) = <strong className="text-foreground">{fmtReal(resultadoBreakEvenAtendimento.receitaLiquidaSessao)}</strong>/sessão líquido</li>
                                <li>{agendaNovoProf?.slotsComCandidato ?? 0} × 4,33 semanas × (1 − {cenarioPerdaPct}% perda) = <strong className="text-foreground">{projecaoBreakEvenAtendimento.sessoesEfetivasMes.toFixed(2)}</strong> sessões/mês</li>
                                <li>× receita líquida/sessão = <strong className="text-foreground">{fmtReal(projecaoBreakEvenAtendimento.receitaLiquidaMes)}</strong> receita líquida/mês</li>
                                <li>− {projecaoBreakEvenAtendimento.sessoesEfetivasMes.toFixed(2)} × {fmtReal(taxaPAEspecialidade)} (taxa PA) = <strong className={projecaoBreakEvenAtendimento.margemMensal >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{projecaoBreakEvenAtendimento.margemMensal >= 0 ? "+" : ""}{fmtReal(projecaoBreakEvenAtendimento.margemMensal)}</strong> margem</li>
                              </ul>
                            </>
                          )}
                        </>
                      )}
                    </InfoTooltip>
                  </div>
                  {breakEvenFixoDisponivel ? (
                    !resultadoBreakEven || !projecaoBreakEven ? (
                      <div className="text-[11px] text-muted-foreground">Simule pelo menos 1 vaga com candidato pra calcular o Ponto de Equilíbrio.</div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:max-w-xs">
                        <StatCard tone={projecaoBreakEven.margemMensal >= 0 ? "green" : "red"} icon={<Wallet size={14} />} label="Margem — Projeção média mensal">
                          <div className={`text-lg font-black tabular-nums ${projecaoBreakEven.margemMensal >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {projecaoBreakEven.margemMensal >= 0 ? "+" : ""}{fmtReal(projecaoBreakEven.margemMensal)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Valores brutos {fmtReal(resumoFinanceiro.semanal * SEMANAS_POR_MES)} · {fmtReal(resumoFinanceiro.semanal)}/semana</div>
                        </StatCard>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10.5px] font-bold text-muted-foreground">Perda (falta + ociosidade):</span>
                          <div className="flex gap-1">
                            {CENARIOS_PERDA_PCT.map(pct => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setCenarioPerdaPct(pct)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                  cenarioPerdaPct === pct
                                    ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400"
                                    : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                                }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>

                        <StatusPill tone={projecaoBreakEven.atingiuBreakEven ? "green" : "red"} variant="solid" dense className="w-full justify-center">
                          {projecaoBreakEven.atingiuBreakEven ? "Break Even atingido" : "Break Even não atingido"}
                        </StatusPill>

                        <div className="space-y-1 rounded-lg bg-muted/40 px-2.5 py-2 text-[11.5px]">
                          <LinhaEquilibrio label="Valor médio da sessão (bruto)" valor={fmtReal(valorSessaoMedioSimulado)} />
                          <LinhaEquilibrio
                            label={`− Imposto (${parametrosGerais?.imposto_faturamento_pct}% faturamento)`}
                            valor={`− ${fmtReal(valorSessaoMedioSimulado - resultadoBreakEven.receitaLiquidaSessao)}`}
                            tone="neg"
                          />
                          <LinhaEquilibrio label="= Receita líquida por sessão" valor={fmtReal(resultadoBreakEven.receitaLiquidaSessao)} forte />
                          <LinhaEquilibrio label="× Sessões efetivas do mês" valor={projecaoBreakEven.sessoesEfetivasMes.toFixed(2)} />
                          <LinhaEquilibrio label="= Receita líquida do mês" valor={fmtReal(projecaoBreakEven.receitaLiquidaMes)} forte />
                          <LinhaEquilibrio
                            label="− Remuneração do prestador"
                            valor={`− ${fmtReal(resultadoBreakEven.custoMensalTotal)}`}
                            tone="neg"
                          />
                          <LinhaEquilibrio
                            label="= Margem"
                            valor={`${projecaoBreakEven.margemMensal >= 0 ? "+" : ""}${fmtReal(projecaoBreakEven.margemMensal)}`}
                            tone={projecaoBreakEven.margemMensal >= 0 ? "pos" : "neg"}
                            forte
                          />
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          Piso mínimo: <strong className="text-foreground">{resultadoBreakEven.slotsSemanaMinimo} slot(s)/semana</strong> ({Math.round(resultadoBreakEven.alocacaoPercentual * 100)}% da capacidade)
                          {" · "}simulado: <strong className="text-foreground">{agendaNovoProf?.slotsComCandidato ?? 0} slot(s)/semana</strong>
                        </div>
                      </div>
                    )
                  ) : (
                    !resultadoBreakEvenAtendimento || !projecaoBreakEvenAtendimento ? (
                      <div className="text-[11px] text-muted-foreground">Simule pelo menos 1 vaga com candidato pra calcular o Ponto de Equilíbrio.</div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:max-w-xs">
                        <StatCard tone={projecaoBreakEvenAtendimento.margemMensal >= 0 ? "green" : "red"} icon={<Wallet size={14} />} label="Margem — Projeção média mensal">
                          <div className={`text-lg font-black tabular-nums ${projecaoBreakEvenAtendimento.margemMensal >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {projecaoBreakEvenAtendimento.margemMensal >= 0 ? "+" : ""}{fmtReal(projecaoBreakEvenAtendimento.margemMensal)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Valores brutos {fmtReal(resumoFinanceiro.semanal * SEMANAS_POR_MES)} · {fmtReal(resumoFinanceiro.semanal)}/semana</div>
                          <div className="text-[11px] text-muted-foreground">Líquido {fmtReal(projecaoBreakEvenAtendimento.receitaLiquidaMes)} · {projecaoBreakEvenAtendimento.sessoesEfetivasMes.toFixed(2)} sessões/mês</div>
                        </StatCard>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10.5px] font-bold text-muted-foreground">Perda (falta + ociosidade):</span>
                          <div className="flex gap-1">
                            {CENARIOS_PERDA_PCT.map(pct => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setCenarioPerdaPct(pct)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                  cenarioPerdaPct === pct
                                    ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400"
                                    : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                                }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>

                        <StatusPill tone={resultadoBreakEvenAtendimento.atingiuBreakEven ? "green" : "red"} variant="solid" dense className="w-full justify-center">
                          {resultadoBreakEvenAtendimento.atingiuBreakEven ? "Break Even atingido" : "Break Even não atingido"}
                        </StatusPill>

                        <div className={`flex items-center justify-center gap-1 text-center text-sm font-black tabular-nums ${resultadoBreakEvenAtendimento.margemPorSessao >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          Margem por sessão: {resultadoBreakEvenAtendimento.margemPorSessao >= 0 ? "+" : ""}{fmtReal(resultadoBreakEvenAtendimento.margemPorSessao)}
                          <InfoTip ariaLabel="Por que o Break Even não muda com o cenário de perda">
                            <p>Esse aviso aparece só no modelo "por atendimento" (especialidades que não são Fono/TO/Musicoterapia) e explica por que o selo "Break Even atingido/não atingido" fica igual não importa qual % de perda (20/25/30%) você escolher ali em cima.</p>
                            <p className="mt-2">O motivo: nesse modelo, tanto a receita quanto o custo são <strong className="text-foreground">por sessão realizada</strong> — se uma sessão não acontece (falta/ociosidade), a clínica não fatura aquela sessão, mas também não paga o profissional por ela (paga a taxa PA só pelo que foi atendido). Então perda reduz receita e custo na <strong className="text-foreground">mesma proporção</strong>, e o veredito "dá lucro ou não" já fica decidido numa única sessão isolada.</p>
                          </InfoTip>
                        </div>

                        <div className="space-y-1 rounded-lg bg-muted/40 px-2.5 py-2 text-[11.5px]">
                          <LinhaEquilibrio label="Valor médio da sessão (bruto)" valor={fmtReal(valorSessaoMedioSimulado)} />
                          <LinhaEquilibrio
                            label={`− Imposto (${parametrosGerais?.imposto_faturamento_pct}% faturamento)`}
                            valor={`− ${fmtReal(valorSessaoMedioSimulado - resultadoBreakEvenAtendimento.receitaLiquidaSessao)}`}
                            tone="neg"
                          />
                          <LinhaEquilibrio label="= Receita líquida por sessão" valor={fmtReal(resultadoBreakEvenAtendimento.receitaLiquidaSessao)} forte />
                          <LinhaEquilibrio label="× Sessões efetivas do mês" valor={projecaoBreakEvenAtendimento.sessoesEfetivasMes.toFixed(2)} />
                          <LinhaEquilibrio label="= Receita líquida do mês" valor={fmtReal(projecaoBreakEvenAtendimento.receitaLiquidaMes)} forte />
                          <LinhaEquilibrio
                            label="− Remuneração do prestador"
                            valor={`− ${fmtReal(projecaoBreakEvenAtendimento.custoVariavelMes)}`}
                            tone="neg"
                          />
                          <LinhaEquilibrio
                            label="= Margem"
                            valor={`${projecaoBreakEvenAtendimento.margemMensal >= 0 ? "+" : ""}${fmtReal(projecaoBreakEvenAtendimento.margemMensal)}`}
                            tone={projecaoBreakEvenAtendimento.margemMensal >= 0 ? "pos" : "neg"}
                            forte
                          />
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          {Math.round((resultadoBreakEvenAtendimento.capacidadeMensal > 0 ? (agendaNovoProf!.slotsComCandidato * 4.33 / resultadoBreakEvenAtendimento.capacidadeMensal) * 100 : 0))}% da capacidade de referência (56,33 sessões/mês)
                          {" · "}simulado: <strong className="text-foreground">{agendaNovoProf?.slotsComCandidato ?? 0} slot(s)/semana</strong>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
              </div>
            </div>
          )}

          {/* SEÇÃO 2 — detalhamento da opção selecionada acima */}
          {agendaNovoProf && agendaNovoProf.totalSlots > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-4 py-3">
                <span className="text-sm font-extrabold text-foreground">Detalhamento — {unidadeFixada || "Plano recomendado (misto)"}</span>
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                  {nPacientesExibidos} pacientes · {agendaNovoProf.slotsComCandidato} vaga(s) de horário · {Math.round((agendaNovoProf.slotsComCandidato / agendaNovoProf.totalSlots) * 100)}% de ocupação
                  <InfoTip ariaLabel="O que conta como vaga de horário">
                    <p><strong className="text-foreground">Vagas de horário</strong> são os horários distintos do novo profissional com pelo menos um candidato.</p>
                    <p className="mt-2">Diferente do total de candidaturas na tabela "Sessões e candidatos" abaixo, já que mais de um paciente pode disputar a mesma vaga.</p>
                  </InfoTip>
                </span>
              </div>

              <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-col xl:flex-row gap-4 items-start">
                {/* Agenda do novo profissional */}
                <div className="w-fit max-w-full min-w-0 rounded-xl bg-muted/40 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-foreground">Agenda do novo profissional</span>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-400 dark:bg-sky-500" />
                        Candidato(s)
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400 dark:ring-amber-700" />
                        Parcialmente coberto
                        <InfoTip ariaLabel="O que significa uma vaga parcialmente coberta">
                          <p>Dessa vaga, <strong className="text-foreground">parte dos candidatos</strong> já é atendida pela capacidade interna, e a <strong className="text-foreground">quantidade mostrada</strong> é quem ainda precisaria da contratação.</p>
                          <p className="mt-2">Não dá pra saber qual candidato específico já está coberto — por isso aparece só a contagem, sem nome.</p>
                        </InfoTip>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-100 dark:bg-rose-950/40 ring-1 ring-rose-400 dark:ring-rose-700" />
                        Totalmente coberto sem contratar
                        <InfoTip ariaLabel="O que significa uma vaga totalmente coberta sem contratar">
                          <p>Essa vaga tem <strong className="text-foreground">candidato(s)</strong>, mas a capacidade interna já cobre todos eles — contratando ou não, quem já está na clínica vai atender.</p>
                          <p className="mt-2">Por isso não entra na projeção financeira nem na carga semanal do novo profissional.</p>
                        </InfoTip>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" />
                        Livre
                      </span>
                    </div>
                  </div>
                  {/* Antes só aparecia sm:hidden (mobile) — em telas de notebook
                      (~1366-1440px), Carga semanal + Ocupação por dia ao lado já
                      ocupam quase todo o card, então a grade de 5 dias também
                      precisa rolar, e sem esse aviso a Sexta cortada parecia bug
                      em vez de "role para o lado" (2026-08-27). */}
                  <div className="mb-1 text-[10px] font-bold text-muted-foreground">role para o lado →</div>
                  <div className="overflow-x-auto">
                    {/* border-spacing-y sutil (0.5 = 2px) — um respiro mínimo
                        entre sessões e entre a barra de unidade e a 1ª sessão
                        do turno, sem reabrir o vão grande que existia antes
                        (pedido do usuário 2026-08-17; ajuste só visual, nenhum
                        cálculo muda). */}
                    <table className="border-separate border-spacing-x-1.5 border-spacing-y-0.5" style={{ width: `${64 + diasAgendas.length * 128}px` }}>
                      <thead>
                        <tr>
                          <th className="w-14" />
                          {diasAgendas.map(dia => (
                            <th key={dia} className="min-w-[128px] pb-1 text-center text-[12px] font-extrabold uppercase text-foreground">{diaCurto(dia)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(["manha", "tarde"] as Turno[]).map(turno => {
                          const horasTurno = horasAgendas.filter(h => turnoFromHora(h) === turno)
                          if (!horasTurno.length) return null
                          return (
                          <Fragment key={turno}>
                          {/* Barra de unidade por dia+turno — no plano "misto" cada
                              dia/turno pode vir de uma unidade diferente (ver
                              montarPlanoRecomendado), e sem isso não dava pra saber
                              qual unidade cada bloco de sessões representa sem abrir
                              o modal "Ver agenda" de cada paciente. Mesmo padrão
                              visual da barra de unidade dominante nos modais
                              (RemanejamentoDetalheModal/PacienteAgendaHipoteticaModal). */}
                          <tr>
                            <td className="pr-2 text-right text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">{turnoNome[turno]}</td>
                            {diasAgendas.map(dia => {
                              const unidade = agendaNovoProf?.grade[`${dia}|||${horasTurno[0]}`]?.unidade
                                ?? agendaJaCoberta?.grade[`${dia}|||${horasTurno[0]}`]?.unidade
                              // Turno que o usuário marcou, foi avaliado (por isso
                              // tem unidade) e não rendeu candidato nenhum em hora
                              // alguma. Antes esse turno desaparecia da grade e a
                              // leitura era "minha seleção foi ignorada" — ver
                              // completarPeriodosSelecionados.
                              const semCandidato = !!unidade && horasTurno.every(h => {
                                const chave = `${dia}|||${h}`
                                return !(agendaNovoProf?.grade[chave]?.candidatos.length)
                                  && !(agendaJaCoberta?.grade[chave]?.candidatos.length)
                              })
                              return (
                                <td key={dia} className="px-0.5 pb-0.5">
                                  {unidade && (
                                    <div className={`rounded-md py-0.5 text-center text-[9px] font-black uppercase tracking-wide text-white ${estiloUnidade(unidade).bar} ${semCandidato ? "opacity-40" : ""}`}>
                                      {unidade}
                                    </div>
                                  )}
                                  {semCandidato && (
                                    <div
                                      className="mt-0.5 text-center text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground"
                                      title={`${turnoNome[turno]} de ${diaCurto(dia)} foi simulada, mas nenhum paciente com sessão pendente é elegível nesses horários`}
                                    >
                                      sem candidato
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                          {horasTurno.map(hora => (
                          <tr key={hora}>
                            <td className="rounded-md bg-card px-2 py-1 text-right text-[13px] font-bold tabular-nums text-foreground">{hora}</td>
                            {diasAgendas.map(dia => {
                              const chave = `${dia}|||${hora}`
                              const celula = agendaNovoProf?.grade[chave]
                              const cobertura = agendaJaCoberta?.grade[chave]
                              const qtdRestante = celula?.candidatos.length ?? 0
                              const qtdCoberta = cobertura?.candidatos.length ?? 0
                              const ambiguo = qtdRestante > 0 && qtdCoberta > 0

                              if (qtdRestante === 0 && qtdCoberta === 0) {
                                // Fundo igual ao card ao redor (bg-card) fazia a célula
                                // "sumir" — parecia espaço em branco puro ao lado dos
                                // cartões coloridos. Borda tracejada discreta em vez de
                                // sólida invisível (só visual, sem mudar nenhum cálculo).
                                return <td key={dia}><div className="h-9 rounded-md border border-dashed border-border/40" /></td>
                              }
                              if (qtdRestante === 0) {
                                return (
                                  <td key={dia}>
                                    <button
                                      type="button"
                                      onClick={() => setVagaCobertaAberta({ dia, hora, unidade: cobertura!.unidade, candidatos: cobertura!.candidatos })}
                                      title="Vaga já coberta pela capacidade interna — contratar aqui não mudaria a ocupação"
                                      className="flex h-9 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-rose-300 bg-rose-50 px-1.5 text-center hover:brightness-95 dark:border-rose-800 dark:bg-rose-950/40"
                                    >
                                      {qtdCoberta === 1 ? (
                                        <div className="text-[10.5px] font-bold leading-tight text-rose-800 dark:text-rose-300">{fmtName(cobertura!.candidatos[0].pac)}</div>
                                      ) : (
                                        <div className="text-sm font-black leading-none text-rose-800 dark:text-rose-300">{qtdCoberta}</div>
                                      )}
                                      <div className="text-[8.5px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400 opacity-90">sem contratar</div>
                                    </button>
                                  </td>
                                )
                              }
                              const cor = estiloUnidade(celula!.unidade)
                              const corCelula = ambiguo
                                ? { border: "border-amber-300 dark:border-amber-800", bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-900 dark:text-amber-200" }
                                : { border: "border-sky-200 dark:border-sky-800", bg: cor.bg, text: cor.text }
                              const totalNaVaga = qtdRestante + qtdCoberta
                              const vagaDaCelula = vagaPorDiaHora.get(`${dia}|||${hora}`)
                              return (
                                <td key={dia}>
                                  <button
                                    type="button"
                                    disabled={!vagaDaCelula}
                                    onClick={() => vagaDaCelula && abrirVagaGrade(dia, vagaDaCelula, ambiguo ? { unidade: cobertura!.unidade, candidatos: cobertura!.candidatos } : undefined)}
                                    title={ambiguo ? `${totalNaVaga} candidato(s) disputam esta vaga: ${qtdCoberta} já está(ão) coberto(s) pela capacidade interna, ${qtdRestante} precisaria(m) da contratação` : undefined}
                                    className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 text-center ${ambiguo ? "h-14" : "h-9"} ${corCelula.border} ${corCelula.bg} ${vagaDaCelula ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                                  >
                                    {!ambiguo && qtdRestante === 1 ? (
                                      <div className={`text-[10.5px] font-bold leading-tight ${corCelula.text}`}>{fmtName(celula!.candidatos[0].pac)}</div>
                                    ) : ambiguo ? (
                                      <>
                                        <div className={`text-[12px] font-black leading-none ${corCelula.text}`}>{totalNaVaga} candidato(s)</div>
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="rounded-full bg-rose-100 px-1.5 py-px text-[8.5px] font-bold leading-tight text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                                            {qtdCoberta} já coberto(s)
                                          </span>
                                          <span className="rounded-full bg-sky-100 px-1.5 py-px text-[8.5px] font-bold leading-tight text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
                                            {qtdRestante} a contratar
                                          </span>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className={`text-sm font-black leading-none ${corCelula.text}`}>{qtdRestante}</div>
                                        <div className={`text-[8.5px] font-semibold uppercase tracking-wide ${corCelula.text} opacity-80`}>candidato(s)</div>
                                      </>
                                    )}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                          ))}
                          </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                  {/* Carga semanal — largura reduzida de 300 para 220px
                      (2026-08-27, pedido do usuário): com Ocupação por dia
                      fixa ao lado, 300px sobrava pouco espaço pra "Agenda do
                      novo profissional" numa tela de notebook (~1366-1440px),
                      cortando a Sexta-feira da grade. O donut (170px) cabe
                      inteiro nos 220px - 32px de padding = 188px. */}
                  <div className="w-full xl:w-[220px] shrink-0 rounded-xl bg-muted/40 p-4">
                    <div className="text-sm font-extrabold text-foreground">Carga semanal</div>
                    <div className="mb-3 text-[11px] text-muted-foreground">Novo profissional hipotético</div>
                    <div className="relative mx-auto aspect-square w-[170px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Com candidato", value: agendaNovoProf.slotsComCandidato, color: TONE_ACCENT.green },
                            { name: "Livre/ociosa", value: agendaNovoProf.slotsLivres, color: TONE_ACCENT.red },
                          ].filter(s => s.value > 0)}
                          cx="50%" cy="50%" innerRadius="62%" outerRadius="88%"
                          dataKey="value" strokeWidth={0} startAngle={90} endAngle={-270}
                        >
                          {[
                            { color: TONE_ACCENT.green }, { color: TONE_ACCENT.red },
                          ].filter((_, i) => [agendaNovoProf.slotsComCandidato, agendaNovoProf.slotsLivres][i] > 0)
                            .map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <RechartsTooltip formatter={(val, name) => [`${val ?? 0} slot(s)`, name]} contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-foreground">
                      {Math.round((agendaNovoProf.slotsComCandidato / agendaNovoProf.totalSlots) * 100)}%
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2">
                      <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400">{fmtH(agendaNovoProf.chOcupMin / 60)}</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400">com candidato</div>
                    </div>
                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
                      <div className="text-xl font-extrabold text-rose-700 dark:text-rose-400">{fmtH(agendaNovoProf.chLivreMin / 60)}</div>
                      <div className="text-[11px] text-rose-700 dark:text-rose-400">livre/ociosa</div>
                    </div>
                  </div>
                  <div className="mt-3 text-center text-[12px] text-muted-foreground">
                    CH total: <strong className="text-foreground">{fmtH(agendaNovoProf.chTotalMin / 60)}</strong>
                  </div>

                  {breakEvenFixoDisponivel && projecaoBreakEven && (
                    <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-3">
                      <span className="text-[11px] font-bold text-muted-foreground">Break Even:</span>
                      <StatusPill tone={projecaoBreakEven.atingiuBreakEven ? "green" : "red"} variant="solid" dense>
                        {projecaoBreakEven.atingiuBreakEven ? "Atingido" : "Não atingido"}
                      </StatusPill>
                    </div>
                  )}
                  {breakEvenAtendimentoDisponivel && resultadoBreakEvenAtendimento && (
                    <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-3">
                      <span className="text-[11px] font-bold text-muted-foreground">Break Even:</span>
                      <StatusPill tone={resultadoBreakEvenAtendimento.atingiuBreakEven ? "green" : "red"} variant="solid" dense>
                        {resultadoBreakEvenAtendimento.atingiuBreakEven ? "Atingido" : "Não atingido"}
                      </StatusPill>
                    </div>
                  )}
                </div>

                  {/* Ocupação por dia — só 4 colunas compactas, não precisa da
                      largura generosa das outras duas seções ao lado. */}
                  <div className="flex w-full flex-col gap-2 min-w-0 xl:w-[320px] xl:shrink-0">
                  <div className="rounded-xl bg-muted/40 p-4">
                    <div className="text-sm font-extrabold text-foreground">Ocupação por dia</div>
                    <div className="mb-3 text-[11px] text-muted-foreground">Novo profissional hipotético</div>
                    <table className="w-full table-fixed text-[13px]">
                    <colgroup>
                      <col className="w-[68px]" />
                      <col />
                      <col className="w-[54px]" />
                      <col className="w-[60px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border">
                        <th className="whitespace-nowrap pb-2 pr-2 text-left text-[11px] font-bold text-muted-foreground">Dia</th>
                        <th className="pb-2 pr-2 text-left text-[11px] font-bold text-muted-foreground">Unidade</th>
                        <th className="pb-2 pr-2 text-center text-[11px] font-bold whitespace-nowrap text-muted-foreground">Sessões</th>
                        <th className="pb-2 text-right text-[11px] font-bold whitespace-nowrap text-muted-foreground">% ocup.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agendaNovoProf.porDia.map(row => (
                        <tr key={row.dia} className="border-b border-border last:border-b-0">
                          <td className="whitespace-nowrap py-2 pr-2 font-bold text-foreground">{diaCurto(row.dia)}</td>
                          <td className="truncate py-2 pr-2 text-foreground">{row.unidades}</td>
                          <td className="whitespace-nowrap py-2 pr-2 text-center tabular-nums text-foreground">{row.sessoes}/{row.totalSlots}</td>
                          <td className="py-2 text-right">
                            <StatusPill tone={row.pct >= 70 ? "green" : row.pct > 50 ? "amber" : "red"} variant="solid" dense>
                              {row.pct.toFixed(0)}%
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                  {/* Nome da especialidade sobre a própria cor da terapia —
                      antes exigia print da agenda (pra ver a cor da barra de
                      unidade/candidato) + print de outro lugar pra achar o
                      nome; pedido do usuário pra tirar só 1 print
                      (2026-09-02). */}
                  <div
                    className="flex items-center gap-2 rounded-xl px-4 py-2.5"
                    style={{ background: corTerapiaBadge(especialidade) }}
                  >
                    {(() => {
                      const Icone = ICONE_TERAPIA[normTxt(especialidade)]
                      const textoEscuro = corClaraPrecisaTextoEscuro(corTerapiaBadge(especialidade))
                      return Icone ? <Icone size={16} className={`shrink-0 ${textoEscuro ? "text-black/80" : "text-white"}`} /> : null
                    })()}
                    <span className={`truncate text-[13px] font-extrabold ${corClaraPrecisaTextoEscuro(corTerapiaBadge(especialidade)) ? "text-black/80" : "text-white"}`}>
                      {especialidade}
                    </span>
                  </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold text-foreground">Sessões e candidatos em formato lista</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{linhasExibidas.length} candidatura(s) elegível(is) em {vagasExibidas} vaga(s) de horário</span>
                  </div>
                  {algumPeriodoSemSala && (
                    <InlineNotice tone="red" className="mb-3 animate-pulse border-red-300 dark:border-red-800">
                      <strong>Sem sala livre encontrada</strong> para pelo menos um dos dias/turnos simulados — você está simulando uma contratação hipotética sem sala garantida nessa combinação.
                    </InlineNotice>
                  )}
                  {!linhasExibidas.length ? (
                    <InlineNotice tone="slate" className="text-center justify-center">Nenhuma sessão com candidatos nesta combinação.</InlineNotice>
                  ) : (
                    <div className="flex flex-col gap-5">
                      <div className="text-[10px] font-bold text-muted-foreground sm:hidden">deslize para o lado →</div>
                      {gruposPorDia.map(grupo => (
                        <div key={grupo.dia}>
                          <div className="mb-2 text-[13.5px] font-extrabold uppercase tracking-wide text-foreground">
                            {grupo.dia}
                          </div>
                          <div className="flex flex-col gap-2">
                            {agruparPorSalaTurno(grupo.vagas).map((grupoSala, i) => (
                              <GrupoSalaCard
                                key={`${grupo.dia}-${grupoSala.unidade}-${grupoSala.sala ?? "sem-sala"}-${i}`}
                                grupoSala={grupoSala}
                                cRows={cRows}
                                especialidade={especialidade}
                                cobertosPorVaga={cobertosPorVaga}
                                onVerDetalhe={setDetalhe}
                                onVerRemanejamento={setDetalheRemanejamento}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {detalhe && (
        <PacienteAgendaHipoteticaModal
          paciente={detalhe.pac}
          slot={detalhe.slot}
          especialidade={detalhe.especialidade}
          profissionalHipotetico={detalhe.profissionalHipotetico}
          cRows={cRows}
          onClose={() => setDetalhe(null)}
        />
      )}
      {detalheRemanejamento?.candidato.remanejamento && (
        <RemanejamentoDetalheModal
          paciente={detalheRemanejamento.candidato.paciente}
          terapiaHipotetica={detalheRemanejamento.sugestao.especialidade}
          profissionalHipotetico={detalheRemanejamento.profissionalHipotetico}
          remanejamento={detalheRemanejamento.candidato.remanejamento}
          cRows={cRows}
          onClose={() => setDetalheRemanejamento(null)}
        />
      )}
      {detalheFinanceiroAberto && (
        <ProjecaoFinanceiraDetalheModal
          periodosEnriquecidos={periodosEnriquecidos}
          mesReferencia={mesReferencia}
          labelMesReferencia={labelMesReferencia}
          feriados={feriados}
          cRows={cRows}
          onClose={() => setDetalheFinanceiroAberto(false)}
        />
      )}
      {vagaGradeAberta && (() => {
        const diretos = vagaGradeAberta.vaga.linhas.filter(l => l.candidato.modalidade === "adjacente")
        const remanejamentos = vagaGradeAberta.vaga.linhas.filter(l => l.candidato.modalidade === "remanejamento")
        const cobertos = vagaGradeAberta.cobertos?.candidatos ?? []
        const profissionaisLivres = cobertos.length
          ? vagasInternasPorChave.get(`${vagaGradeAberta.dia}|||${vagaGradeAberta.vaga.hora}|||${vagaGradeAberta.cobertos!.unidade}`) ?? []
          : []
        return (
          <ScheduleModal
            title={`${vagaGradeAberta.dia} · ${vagaGradeAberta.vaga.hora}`}
            subtitle={cobertos.length
              ? "Vaga parcialmente coberta — parte já é atendida internamente, veja as 3 opções dessa vaga."
              : "Mais de um paciente candidato a essa vaga — veja quem é cada um."}
            maxWidth={480}
            onClose={() => setVagaGradeAberta(null)}
          >
            <div className="flex flex-col gap-4">
              {diretos.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={13} /> Oportunidade direta
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {diretos.map((linha, i) => (
                      <button
                        key={`direto-${i}`}
                        type="button"
                        onClick={() => abrirDetalheCandidato(linha)}
                        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-left hover:brightness-95"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-bold text-foreground">{fmtName(linha.candidato.paciente)}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{linha.unidade} · {linha.sugestao.especialidade}</span>
                        </span>
                        <span className="shrink-0 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">Ver agenda</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {remanejamentos.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                    <Repeat2 size={13} /> Oportunidade via remanejamento
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {remanejamentos.map((linha, i) => (
                      <button
                        key={`remanejamento-${i}`}
                        type="button"
                        onClick={() => abrirDetalheCandidato(linha)}
                        className="flex items-center justify-between gap-2 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-left hover:brightness-95"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-bold text-foreground">{fmtName(linha.candidato.paciente)}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{linha.unidade} · {linha.sugestao.especialidade}</span>
                        </span>
                        <span className="shrink-0 text-[10.5px] font-bold text-sky-700 dark:text-sky-400">Ver antes/depois</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {cobertos.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-rose-700 dark:text-rose-400">
                    <House size={13} /> Já coberto pela capacidade interna
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cobertos.map((c, i) => (
                      <button
                        key={`coberto-${i}`}
                        type="button"
                        onClick={() => abrirDetalheCoberto(vagaGradeAberta.dia, vagaGradeAberta.vaga.hora, vagaGradeAberta.cobertos!.unidade, c.pac, profissionaisLivres[i]?.profissional)}
                        className="flex items-center justify-between gap-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-left hover:brightness-95"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-bold text-foreground">{fmtName(c.pac)}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{vagaGradeAberta.cobertos!.unidade}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-right text-[10.5px] font-bold text-rose-700 dark:text-rose-400">
                          {profissionaisLivres[i] ? fmtName(profissionaisLivres[i].profissional) : "Profissional já disponível"}
                          <ChevronRight size={13} className="shrink-0" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScheduleModal>
        )
      })()}
      {vagaCobertaAberta && (() => {
        const profissionaisLivres = vagasInternasPorChave.get(`${vagaCobertaAberta.dia}|||${vagaCobertaAberta.hora}|||${vagaCobertaAberta.unidade}`) ?? []
        return (
          <ScheduleModal
            title={`${vagaCobertaAberta.dia} · ${vagaCobertaAberta.hora}`}
            subtitle="Capacidade interna já cobre essa vaga — contratando ou não, quem já está na clínica vai atender."
            maxWidth={480}
            onClose={() => setVagaCobertaAberta(null)}
          >
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-rose-700 dark:text-rose-400">
                <House size={13} /> Já coberto pela capacidade interna
              </div>
              <div className="flex flex-col gap-1.5">
                {vagaCobertaAberta.candidatos.map((c, i) => (
                  <button
                    key={`coberto-${i}`}
                    type="button"
                    onClick={() => abrirDetalheCoberto(vagaCobertaAberta.dia, vagaCobertaAberta.hora, vagaCobertaAberta.unidade, c.pac, profissionaisLivres[i]?.profissional)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-left hover:brightness-95"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-bold text-foreground">{fmtName(c.pac)}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">{vagaCobertaAberta.unidade}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-right text-[10.5px] font-bold text-rose-700 dark:text-rose-400">
                      {profissionaisLivres[i] ? fmtName(profissionaisLivres[i].profissional) : "Profissional já disponível"}
                      <ChevronRight size={13} className="shrink-0" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </ScheduleModal>
        )
      })()}
    </div>
  )
}
