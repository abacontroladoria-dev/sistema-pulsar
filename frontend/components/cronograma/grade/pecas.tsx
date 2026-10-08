"use client"

import type { ReactNode } from "react"
import { Lock, Plus } from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import type { Tone } from "@/components/cronograma/ui/tones"
import { IconeTerapia } from "@/lib/cadastros/iconesTerapia"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import { deMin, horaCurta, paraMin } from "@/lib/disponibilidadeProfissional"
import { rotuloVagas } from "@/lib/grade/motor"
import type { AgendamentoGrade, EstadoHorario, HorarioGrade } from "@/types/grade"
import { LISTRAS_BLOQUEIO, selo } from "./estilo"

// Peças visuais da Grade no design PADRÃO do Pulsar (receitas da Agenda do
// Connect e de Ocupação de Salas). A cor da terapia vem de
// cadastro_terapias.cor_hex pelos tons --t-* (.ua-tons), como nos cards de
// Profissionais; estados usam tons neutros + TONE_SOFT:
//   livre = borda tracejada · agendado = cor da terapia · bloqueado = cinza
//   listrado com cadeado · fora da grade = âmbar · reposição = rosa.
// Sem faixa colorida lateral nos cartões (DESIGN.md: "no side-stripe borders").

/** Altura de um minuto na grade (40 min = 60 px). */
export const PX_POR_MIN = 1.5

export const TOM_ESTADO: Record<"disponivel" | "agendado" | "bloqueado" | "fora_da_grade" | "inativo", { t: Tone; rotulo: string }> = {
  disponivel: { t: "slate", rotulo: "Livre" },
  agendado: { t: "blue", rotulo: "Agendado" },
  bloqueado: { t: "slate", rotulo: "Bloqueado" },
  fora_da_grade: { t: "amber", rotulo: "Fora da grade" },
  inativo: { t: "red", rotulo: "Reposição" },
}

/** Estado → grupo da legenda (parcial e lotado são "agendado"). */
export function grupoDoEstado(e: EstadoHorario): keyof typeof TOM_ESTADO {
  if (e === "parcial" || e === "lotado") return "agendado"
  return e
}

// ── Sessão ────────────────────────────────────────────────────────────────────

/** Cor e ícone de uma terapia (cadastro_terapias.cor_hex / icone). */
export type VisualTerapia = { cor: string | null; icone: string | null }

/**
 * Uma sessão na cor da terapia (receita do bloco da Agenda do Connect). Sem a
 * hora — a régua à esquerda já mostra (decisão do usuário, 08/10/2026).
 * `linhas` = quanto cabe: 1 (só o título), 2 (+ ícone e terapia),
 * 3 (+ terapia de exibição, só quando difere da terapia principal).
 */
export function CartaoSessao({
  a, visual, titulo, linhas = 2, alerta, onClick,
}: {
  a: AgendamentoGrade
  visual: VisualTerapia
  titulo: string
  linhas?: 1 | 2 | 3
  /** Selo pequeno (fora da grade, reposição…). */
  alerta?: { t: Tone; rotulo: string } | null
  onClick: () => void
}) {
  const exibicao = a.terapia_exibicao_nome && a.terapia_exibicao_nome !== a.terapia_nome ? a.terapia_exibicao_nome : null
  const hora = `${horaCurta(a.hora_inicio)}–${horaCurta(a.hora_fim)}`
  const contorno = alerta?.t === "amber" ? "ring-amber-400 dark:ring-amber-500"
    : alerta?.t === "red" ? "ring-rose-400 dark:ring-rose-500"
    : "ring-[var(--t-300)] hover:ring-[var(--t-500)]"
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      style={estiloTons(visual.cor)}
      title={`${hora} · ${a.paciente_nome} × ${a.profissional_nome} · ${a.terapia_nome}${exibicao ? ` (exibição: ${exibicao})` : ""}${a.sala_nome ? ` · ${a.sala_nome}` : ""}`}
      className={`ua-tons block h-full w-full min-w-0 overflow-hidden rounded-md bg-[var(--t-50)] px-2 py-0.5 text-left text-[var(--t-700)] ring-1 ring-inset transition-shadow ${contorno} ${foco}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-xs font-semibold leading-4">{titulo}</span>
        {alerta && <span className={`${selo(alerta.t)} ml-auto shrink-0`}>{alerta.rotulo}</span>}
      </span>
      {linhas >= 2 && (
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 opacity-80">
          <IconeTerapia chave={visual.icone} className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span className="truncate">{a.terapia_nome}</span>
        </span>
      )}
      {linhas >= 3 && exibicao && <span className="block truncate text-[11px] leading-4 opacity-70">({exibicao})</span>}
    </button>
  )
}

/** Linhas do cartão que cabem na altura (16 px cada + respiro): 40 min = 3 linhas. */
export const linhasQueCabem = (altura: number): 1 | 2 | 3 => (altura >= 52 ? 3 : altura >= 36 ? 2 : 1)

// ── Bloco de um horário ───────────────────────────────────────────────────────

/** Um horário da grade na visão do profissional. A altura vem da duração. */
export function BlocoHorario({
  h, altura, visualDe, onSessao, onLivre, onFechado, onVerTodos,
}: {
  h: HorarioGrade
  altura: number
  visualDe: (terapiaId: number) => VisualTerapia
  onSessao: (a: AgendamentoGrade) => void
  /** Clique no espaço livre: novo agendamento já preenchido. */
  onLivre?: (h: HorarioGrade) => void
  /** Clique no horário fechado: detalhe do bloqueio/feriado. */
  onFechado?: (h: HorarioGrade) => void
  /** "+N": lista todos os pacientes do horário (grupo que não coube). */
  onVerTodos?: (h: HorarioGrade) => void
}) {
  const livres = Math.max(0, h.capacidade - h.ocupados.length)
  const hora = `${h.inicio}–${h.fim}`

  if (h.estado === "disponivel") {
    return (
      <button
        type="button"
        onClick={() => onLivre?.(h)}
        disabled={!onLivre}
        aria-label={`${hora}: ${rotuloVagas(h)}. Agendar`}
        title={`${hora} · ${rotuloVagas(h)}${h.terapias.length ? ` · ${h.terapias.map(t => t.nome).join(", ")}` : ""}`}
        className={`flex h-full w-full flex-col items-start justify-center rounded-md border border-dashed border-border px-2 text-left text-muted-foreground transition-colors hover:border-solid hover:bg-muted/60 hover:text-foreground disabled:cursor-default disabled:opacity-60 disabled:hover:border-dashed disabled:hover:bg-transparent ${foco}`}
      >
        <span className="flex items-center gap-1 text-[11px] font-medium">
          <Plus className="h-3 w-3 shrink-0" aria-hidden />{h.capacidade > 1 ? `${livres} livres` : "Livre"}
        </span>
        {altura >= 44 && <span className="text-[11px] tabular-nums opacity-70">{hora}</span>}
      </button>
    )
  }

  if (h.estado === "bloqueado") {
    // div com botões irmãos (o horário e as sessões que ficaram dentro dele):
    // botão dentro de botão é HTML inválido e confunde o leitor de tela.
    return (
      <div style={LISTRAS_BLOQUEIO} className="flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border border-border bg-muted/50 p-0.5">
        <button type="button" onClick={() => onFechado?.(h)}
          title={`${hora} · ${h.fechado?.origem === "feriado" ? "Feriado" : "Bloqueado"}: ${h.fechado?.motivo ?? ""}`}
          className={`flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted ${foco}`}>
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{h.fechado?.motivo ?? "Bloqueado"}</span>
        </button>
        {h.ocupados.map(a => (
          <div key={a.id} className="min-h-0 flex-1">
            <CartaoSessao a={a} visual={visualDe(a.terapia_id)} titulo={a.paciente_nome} linhas={1}
              alerta={{ t: "amber", rotulo: "no bloqueio" }} onClick={() => onSessao(a)} />
          </div>
        ))}
      </div>
    )
  }

  const alerta = h.estado === "fora_da_grade" ? { t: "amber" as Tone, rotulo: "fora da grade" }
    : h.estado === "inativo" ? { t: "red" as Tone, rotulo: "reposição" } : null
  const emGrupo = h.capacidade > 1 && (h.estado === "parcial" || h.estado === "lotado")
  // Cabe uma sessão por ~22 px; o rodapé do grupo (x/N, +N, +livre) ocupa uma linha.
  const cabem = Math.max(1, Math.floor((altura - (emGrupo || h.ocupados.length > 1 ? 18 : 0)) / 22))
  const visiveis = h.ocupados.slice(0, cabem)
  const escondidos = h.ocupados.length - visiveis.length
  const linhas = linhasQueCabem(h.ocupados.length > 1 ? 0 : altura)

  return (
    <div className="flex h-full w-full flex-col gap-0.5 overflow-hidden">
      {visiveis.map((a, i) => (
        <div key={a.id} className="min-h-0 flex-1">
          <CartaoSessao a={a} visual={visualDe(a.terapia_id)} titulo={a.paciente_nome} linhas={linhas}
            alerta={i === 0 ? alerta : null} onClick={() => onSessao(a)} />
        </div>
      ))}
      {(emGrupo || escondidos > 0) && (
        <div className="flex shrink-0 items-center gap-1 px-0.5">
          {emGrupo && <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{h.ocupados.length}/{h.capacidade}</span>}
          {escondidos > 0 && onVerTodos && (
            <button type="button" onClick={() => onVerTodos(h)}
              className={`rounded px-1 text-[11px] font-semibold text-foreground underline-offset-2 hover:underline ${foco}`}
              aria-label={`Ver os ${h.ocupados.length} pacientes de ${hora}`}>
              +{escondidos}
            </button>
          )}
          {h.estado === "parcial" && onLivre && (
            <button type="button" onClick={() => onLivre(h)}
              className={`ml-auto inline-flex items-center gap-0.5 rounded border border-dashed border-border px-1 text-[11px] font-medium text-muted-foreground hover:border-solid hover:bg-muted/60 hover:text-foreground ${foco}`}
              aria-label={`${hora}: ${rotuloVagas(h)}. Agendar mais um`}>
              <Plus className="h-3 w-3" aria-hidden />{livres}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Coluna posicionada no tempo ───────────────────────────────────────────────

export type ItemColuna = { chave: string; ini: number; fim: number; conteudo: (altura: number) => ReactNode }

// ── Escala de tempo ───────────────────────────────────────────────────────────
// A régua segue os horários da regra de negócio (sessões de 40 min), não a hora
// cheia (decisão do usuário, 08/10/2026). Quem tem disponibilidade fora desse
// padrão ganha a régua dos próprios horários cadastrados. Intervalos sem nenhum
// horário (ex.: 12:00–13:00) viram uma pausa estreita, para sobrar tela.

export const HORARIOS_PADRAO: [string, string][] = [
  ["08:00", "08:40"], ["08:40", "09:20"], ["09:20", "10:00"], ["10:00", "10:40"], ["10:40", "11:20"], ["11:20", "12:00"],
  ["13:00", "13:40"], ["13:40", "14:20"], ["14:20", "15:00"], ["15:00", "15:40"], ["15:40", "16:20"], ["16:20", "17:00"], ["17:00", "17:40"],
]
export const INICIOS_PADRAO = new Set(HORARIOS_PADRAO.map(([i]) => i))
const INTERVALOS_PADRAO = HORARIOS_PADRAO.map(([i, f]) => ({ ini: paraMin(i), fim: paraMin(f) }))

/** Altura da pausa entre blocos sem horário. */
const PAUSA_PX = 14

export type Escala = {
  altura: number
  /** Posição vertical (px) de um minuto do dia. */
  y: (m: number) => number
  /** Início de cada horário e fim de cada bloco: linha na grade e rótulo na régua. */
  marcas: { m: number; y: number }[]
  pausas: { y: number; h: number }[]
}

/**
 * Monta a escala a partir dos horários que vão aparecer. `comPadrao` soma os
 * horários da regra de negócio (dia todo à vista); sem ele, a régua usa só os
 * horários informados (profissional com grade fora do padrão).
 */
export function montarEscala(intervalos: { ini: number; fim: number }[], comPadrao: boolean): Escala {
  const todos = [...(comPadrao || !intervalos.length ? INTERVALOS_PADRAO : []), ...intervalos.filter(i => i.fim > i.ini)]
    .sort((a, b) => a.ini - b.ini || a.fim - b.fim)
  const blocos: { ini: number; fim: number; y: number }[] = []
  let y = 0
  for (const i of todos) {
    const ult = blocos[blocos.length - 1]
    if (ult && i.ini <= ult.fim) { ult.fim = Math.max(ult.fim, i.fim); continue }
    if (ult) y = ult.y + (ult.fim - ult.ini) * PX_POR_MIN + PAUSA_PX
    blocos.push({ ini: i.ini, fim: i.fim, y })
  }
  const ultimo = blocos[blocos.length - 1]
  const altura = ultimo ? ultimo.y + (ultimo.fim - ultimo.ini) * PX_POR_MIN : 0
  const posicao = (m: number) => {
    let r = 0
    for (const b of blocos) {
      if (m < b.ini) return r
      if (m <= b.fim) return b.y + (m - b.ini) * PX_POR_MIN
      r = b.y + (b.fim - b.ini) * PX_POR_MIN
    }
    return r
  }
  const pontos = new Set<number>()
  for (const i of todos) pontos.add(i.ini)
  for (const b of blocos) pontos.add(b.fim)
  const marcas = [...pontos].sort((a, b) => a - b).map(m => ({ m, y: posicao(m) }))
  const pausas = blocos.slice(1).map(b => ({ y: b.y - PAUSA_PX, h: PAUSA_PX }))
  return { altura, y: posicao, marcas, pausas }
}

/** Linhas dos horários e faixas das pausas, atrás dos cartões. */
export function LinhasEscala({ escala }: { escala: Escala }) {
  return (
    <>
      {escala.pausas.map(p => (
        <div key={`p${p.y}`} className="pointer-events-none absolute inset-x-0 bg-muted/60" style={{ top: p.y, height: p.h }} aria-hidden />
      ))}
      {escala.marcas.map(mk => (
        <div key={mk.m} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: mk.y }} aria-hidden />
      ))}
    </>
  )
}

/**
 * Coluna com itens posicionados na escala (suporta durações mistas). Itens que
 * se cruzam dividem a largura em raias.
 */
export function ColunaHorarios({
  itens, escala, fundo, vazio,
}: {
  itens: ItemColuna[]
  escala: Escala
  /** Faixas de fundo (ex.: janela que a família informou). */
  fundo?: { ini: number; fim: number; rotulo: string }[]
  vazio?: ReactNode
}) {
  const ordenados = [...itens].sort((a, b) => a.ini - b.ini || b.fim - a.fim)
  // Raias: cada item vai para a primeira raia livre; o grupo que se cruza divide a largura.
  const raia = new Map<string, number>()
  const total = new Map<string, number>()
  let grupo: ItemColuna[] = []
  let fimGrupo = -1
  const fechar = () => {
    const n = Math.max(1, ...grupo.map(g => (raia.get(g.chave) ?? 0) + 1))
    grupo.forEach(g => total.set(g.chave, n))
    grupo = []
  }
  const fins: number[] = []
  for (const it of ordenados) {
    if (it.ini >= fimGrupo && grupo.length) { fechar(); fins.length = 0 }
    let r = fins.findIndex(f => f <= it.ini)
    if (r < 0) { r = fins.length; fins.push(it.fim) } else fins[r] = it.fim
    raia.set(it.chave, r)
    grupo.push(it)
    fimGrupo = Math.max(fimGrupo, it.fim)
  }
  if (grupo.length) fechar()

  return (
    <div className="relative" style={{ height: escala.altura }}>
      <LinhasEscala escala={escala} />
      {fundo?.map(f => {
        const topo = escala.y(f.ini)
        const alt = escala.y(f.fim) - topo
        return alt > 0 && (
          <div key={`${f.ini}-${f.fim}`} title={f.rotulo}
            className="absolute inset-x-0 bg-emerald-500/10 dark:bg-emerald-400/10"
            style={{ top: topo, height: alt }} aria-hidden />
        )
      })}
      {!itens.length && vazio}
      {ordenados.map(it => {
        const n = total.get(it.chave) ?? 1
        const r = raia.get(it.chave) ?? 0
        const topo = escala.y(it.ini)
        const h = Math.max(20, escala.y(it.fim) - topo - 3)
        return (
          <div key={it.chave} className="absolute px-0.5"
            style={{ top: topo + 1, height: h, left: `${(r / n) * 100}%`, width: `${100 / n}%` }}>
            {it.conteudo(h)}
          </div>
        )
      })}
    </div>
  )
}

/** Régua à esquerda: início de cada horário (08:00, 08:40, 09:20…) e o fim de cada bloco. */
export function EixoHoras({ escala }: { escala: Escala }) {
  // Rótulos muito próximos (horário fora do padrão colado num do padrão) se sobrepõem: pula o segundo.
  const rotulos = escala.marcas.reduce<Escala["marcas"]>((acc, mk) => {
    const ultimo = acc[acc.length - 1]
    return !ultimo || mk.y - ultimo.y >= 13 ? [...acc, mk] : acc
  }, [])
  return (
    <div className="relative w-14 shrink-0" style={{ height: escala.altura }} aria-hidden>
      {escala.pausas.map(p => (
        <div key={`p${p.y}`} className="absolute inset-x-0 bg-muted/60" style={{ top: p.y, height: p.h }} />
      ))}
      {rotulos.map(mk => (
        <span key={mk.m} className="absolute right-2 -translate-y-1/2 text-[11px] leading-3 tabular-nums text-muted-foreground" style={{ top: mk.y }}>
          {deMin(mk.m)}
        </span>
      ))}
    </div>
  )
}

export const minutos = (h: string) => paraMin(horaCurta(h))

// ── Filtro por estado (usado no painel de resumo) ─────────────────────────────

export type FiltroEstados = Set<keyof typeof TOM_ESTADO>

/** A mesma forma que aparece na grade, em miniatura. */
export function Amostra({ k }: { k: keyof typeof TOM_ESTADO }) {
  const base = "inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
  if (k === "disponivel") return <span className={`${base} border border-dashed border-muted-foreground/60`} aria-hidden />
  if (k === "bloqueado") return <span className={`${base} border border-border bg-muted`} style={LISTRAS_BLOQUEIO} aria-hidden />
  if (k === "agendado") return <span className={`${base} bg-sky-500/70`} aria-hidden />
  if (k === "fora_da_grade") return <span className={`${base} ring-1 ring-inset ring-amber-400`} aria-hidden />
  return <span className={`${base} ring-1 ring-inset ring-rose-400`} aria-hidden />
}
