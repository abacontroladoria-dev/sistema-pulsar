"use client"

import type { CSSProperties, ReactNode } from "react"
import { AlertTriangle, CalendarX2, Lock, Plus, UserRoundX, type LucideIcon } from "lucide-react"
import { tom, type Tom } from "@/components/ui/pastel/pecas"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import { deMin, horaCurta, paraMin } from "@/lib/disponibilidadeProfissional"
import { rotuloVagas } from "@/lib/grade/motor"
import type { AgendamentoGrade, EstadoHorario, HorarioGrade } from "@/types/grade"

// Peças visuais da Grade. Mesma linguagem do Cadastro de Profissionais: a cor
// da terapia (cadastro_terapias.cor_hex) vira os tons --t-* via .ua-tons —
// nunca usada crua — e os estados usam os tons do kit pastel, um sentido por
// cor (DESIGN.md):
//   disponível = teal tracejado · agendado = cor da terapia · bloqueado =
//   listras cinza · fora da grade = âmbar · reposição = vermelho.

/** Altura de um minuto na grade (40 min = 60 px). */
export const PX_POR_MIN = 1.5

export const TOM_ESTADO: Record<"disponivel" | "agendado" | "bloqueado" | "fora_da_grade" | "inativo", { t: Tom; Icone: LucideIcon; rotulo: string }> = {
  disponivel: { t: "teal", Icone: Plus, rotulo: "Disponível" },
  agendado: { t: "aco", Icone: CalendarX2, rotulo: "Agendado" },
  bloqueado: { t: "cinza", Icone: Lock, rotulo: "Bloqueado" },
  fora_da_grade: { t: "amber", Icone: AlertTriangle, rotulo: "Fora da grade" },
  inativo: { t: "vermelho", Icone: UserRoundX, rotulo: "Reposição" },
}

/** Estado → grupo da legenda (parcial e lotado são "agendado"). */
export function grupoDoEstado(e: EstadoHorario): keyof typeof TOM_ESTADO {
  if (e === "parcial" || e === "lotado") return "agendado"
  return e
}

const LISTRAS: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--pp-muted) 0 7px, transparent 7px 14px)",
}

// ── Sessão ────────────────────────────────────────────────────────────────────

/**
 * Uma sessão na cor da terapia. `linhas` = quanto cabe: 1 (só o nome), 2 (+
 * terapia), 3 (+ sala). `titulo` = o que vai em destaque (paciente na visão do
 * profissional, profissional na do paciente).
 */
export function CartaoSessao({
  a, cor, titulo, linhas = 2, alerta, onClick,
}: {
  a: AgendamentoGrade
  cor: string | null
  titulo: string
  linhas?: 1 | 2 | 3
  /** Selo pequeno no canto (fora da grade, reposição…). */
  alerta?: { t: Tom; rotulo: string } | null
  onClick: () => void
}) {
  const terapia = a.terapia_exibicao_nome ?? a.terapia_nome
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      style={estiloTons(cor)}
      title={`${horaCurta(a.hora_inicio)}–${horaCurta(a.hora_fim)} · ${a.paciente_nome} × ${a.profissional_nome} · ${terapia}${a.sala_nome ? ` · ${a.sala_nome}` : ""}`}
      className="ua-tons group relative flex w-full min-w-0 items-stretch gap-1.5 overflow-hidden rounded-[10px] bg-[var(--t-50)] text-left text-[var(--t-700)] shadow-[inset_0_0_0_1px_var(--t-300)] transition-shadow hover:shadow-[inset_0_0_0_2px_var(--t-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pp-foco)]"
    >
      <span className="w-1 shrink-0 bg-[var(--t-500)]" aria-hidden />
      <span className="min-w-0 flex-1 py-1 pr-1.5 leading-tight">
        <span className="block truncate text-xs font-extrabold">{titulo}</span>
        {linhas >= 2 && <span className="block truncate text-[11px] font-semibold opacity-90">{terapia}</span>}
        {linhas >= 3 && a.sala_nome && <span className="block truncate text-[11px] font-semibold opacity-75">{a.sala_nome}</span>}
      </span>
      {alerta && (
        <span className={`${tom(alerta.t)} absolute right-1 top-1 rounded-full bg-[var(--c)] px-1.5 text-[11px] font-extrabold leading-4 text-[var(--c-sobre)]`}>
          {alerta.rotulo}
        </span>
      )}
    </button>
  )
}

// ── Bloco de um horário ───────────────────────────────────────────────────────

/**
 * Um horário da grade (visão do profissional): livre, parcial, lotado,
 * bloqueado, fora da grade ou reposição. A altura vem da duração.
 */
export function BlocoHorario({
  h, altura, corDe, onSessao, onLivre, onFechado,
}: {
  h: HorarioGrade
  altura: number
  corDe: (terapiaId: number) => string | null
  onSessao: (a: AgendamentoGrade) => void
  /** Clique no espaço livre: novo agendamento já preenchido. */
  onLivre?: (h: HorarioGrade) => void
  /** Clique no horário fechado: detalhe do bloqueio/feriado. */
  onFechado?: (h: HorarioGrade) => void
}) {
  const livres = Math.max(0, h.capacidade - h.ocupados.length)
  const cabem = Math.max(1, Math.floor((altura - (livres && h.estado === "parcial" ? 18 : 0)) / 22))
  const linhas: 1 | 2 | 3 = h.ocupados.length > 1 ? 1 : altura >= 70 ? 3 : altura >= 44 ? 2 : 1
  const hora = `${h.inicio}–${h.fim}`

  if (h.estado === "disponivel") {
    return (
      <button
        type="button"
        onClick={() => onLivre?.(h)}
        disabled={!onLivre}
        className={`${tom("teal")} group flex h-full w-full flex-col justify-center rounded-[10px] border-2 border-dashed border-[var(--c-medio)] bg-[var(--c-suave)] px-2 text-left text-[var(--c-tinta)] transition-colors hover:bg-[var(--c)] hover:text-[var(--c-sobre)] disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pp-foco)]`}
        aria-label={`${hora}: ${rotuloVagas(h)}. Agendar`}
        title={`${hora} · ${rotuloVagas(h)}${h.terapias.length ? ` · ${h.terapias.map(t => t.nome).join(", ")}` : ""}`}
      >
        <span className="flex items-center gap-1 text-xs font-extrabold">
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />{h.capacidade > 1 ? `${livres} livres` : "Livre"}
        </span>
        {altura >= 44 && <span className="truncate text-[11px] font-semibold opacity-80 tabular-nums">{hora}</span>}
      </button>
    )
  }

  if (h.estado === "bloqueado") {
    return (
      <button
        type="button"
        onClick={() => onFechado?.(h)}
        style={LISTRAS}
        className="flex h-full w-full flex-col gap-1 overflow-hidden rounded-[10px] bg-[var(--pp-surface)] px-2 py-1 text-left text-[var(--pp-ink-muted)] shadow-[inset_0_0_0_1px_var(--pp-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pp-foco)]"
        title={`${hora} · ${h.fechado?.origem === "feriado" ? "Feriado" : "Bloqueado"}: ${h.fechado?.motivo ?? ""}`}
      >
        <span className="flex min-w-0 items-center gap-1 text-[11px] font-extrabold">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate rounded bg-[var(--pp-surface)] px-0.5">{h.fechado?.motivo ?? "Bloqueado"}</span>
        </span>
        {/* Sessão que ficou dentro do bloqueio: aparece, com alerta. */}
        {h.ocupados.slice(0, cabem).map(a => (
          <CartaoSessao key={a.id} a={a} cor={corDe(a.terapia_id)} titulo={a.paciente_nome} linhas={1}
            alerta={{ t: "amber", rotulo: "!" }} onClick={() => onSessao(a)} />
        ))}
      </button>
    )
  }

  const alerta = h.estado === "fora_da_grade" ? { t: "amber" as Tom, rotulo: "fora da grade" }
    : h.estado === "inativo" ? { t: "vermelho" as Tom, rotulo: "reposição" } : null
  const visiveis = h.ocupados.slice(0, cabem)
  const sobra = h.ocupados.length - visiveis.length

  // Parcial: o bloco inteiro (fora dos cartões) também agenda — alvo de toque grande.
  const agendarNoFundo = h.estado === "parcial" && onLivre ? () => onLivre(h) : undefined
  return (
    <div
      onClick={agendarNoFundo}
      className={`flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-[12px] p-0.5 ${agendarNoFundo ? "cursor-pointer" : ""} ${
        h.estado === "inativo" ? `${tom("vermelho")} shadow-[inset_0_0_0_2px_var(--c-medio)]`
        : h.estado === "fora_da_grade" ? `${tom("amber")} shadow-[inset_0_0_0_2px_var(--c-medio)]` : ""}`}
    >
      {visiveis.map((a, i) => (
        <div key={a.id} className="min-h-0 flex-1">
          <CartaoSessao a={a} cor={corDe(a.terapia_id)} titulo={a.paciente_nome} linhas={linhas}
            alerta={i === 0 ? alerta : null} onClick={() => onSessao(a)} />
        </div>
      ))}
      {sobra > 0 && <span className="px-1 text-[11px] font-extrabold text-[var(--pp-ink-muted)]">+{sobra}</span>}
      {h.capacidade > 1 && (h.estado === "parcial" || h.estado === "lotado") && (
        <div className="flex items-center justify-between gap-1 px-1">
          <span className="text-[11px] font-extrabold tabular-nums text-[var(--pp-ink-muted)]">{h.ocupados.length}/{h.capacidade}</span>
          {h.estado === "parcial" && onLivre && (
            <button type="button" onClick={e => { e.stopPropagation(); onLivre(h) }}
              className={`${tom("teal")} inline-flex h-5 items-center gap-0.5 rounded-full bg-[var(--c-suave)] px-1.5 text-[11px] font-extrabold text-[var(--c-tinta)] hover:bg-[var(--c)]`}
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

/**
 * Coluna com itens posicionados por minuto (suporta durações mistas). Itens que
 * se cruzam dividem a largura em raias.
 */
export function ColunaHorarios({
  itens, de, ate, fundo, vazio,
}: {
  itens: ItemColuna[]
  de: number
  ate: number
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

  const altura = Math.max(0, (ate - de) * PX_POR_MIN)
  return (
    <div className="relative" style={{ height: altura }}>
      {/* Linhas de hora */}
      {Array.from({ length: Math.floor((ate - de) / 60) + 1 }, (_, i) => Math.ceil(de / 60) * 60 + i * 60)
        .filter(m => m >= de && m <= ate)
        .map(m => <div key={m} className="absolute inset-x-0 border-t border-dashed border-[var(--pp-border)]" style={{ top: (m - de) * PX_POR_MIN }} aria-hidden />)}
      {fundo?.map(f => (
        <div key={`${f.ini}-${f.fim}`} title={f.rotulo}
          className={`${tom("verde")} absolute inset-x-0 rounded-[10px] bg-[var(--c-suave)]`}
          style={{ top: (Math.max(f.ini, de) - de) * PX_POR_MIN, height: (Math.min(f.fim, ate) - Math.max(f.ini, de)) * PX_POR_MIN }}
          aria-hidden />
      ))}
      {!itens.length && vazio}
      {ordenados.map(it => {
        const n = total.get(it.chave) ?? 1
        const r = raia.get(it.chave) ?? 0
        const h = Math.max(18, (it.fim - it.ini) * PX_POR_MIN - 3)
        return (
          <div key={it.chave} className="absolute px-0.5"
            style={{ top: (it.ini - de) * PX_POR_MIN + 1, height: h, left: `${(r / n) * 100}%`, width: `${100 / n}%` }}>
            {it.conteudo(h)}
          </div>
        )
      })}
    </div>
  )
}

/** Régua de horas à esquerda da grade. */
export function EixoHoras({ de, ate }: { de: number; ate: number }) {
  const horas: number[] = []
  for (let m = Math.ceil(de / 60) * 60; m <= ate; m += 60) horas.push(m)
  return (
    <div className="relative w-12 shrink-0" style={{ height: (ate - de) * PX_POR_MIN }} aria-hidden>
      {horas.map(m => (
        <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] font-bold tabular-nums text-[var(--pp-ink-muted)]" style={{ top: (m - de) * PX_POR_MIN }}>
          {deMin(m)}
        </span>
      ))}
    </div>
  )
}

/** Janela de tempo que cobre os horários (de hora cheia a hora cheia); padrão 08–18. */
export function janelaDeTempo(intervalos: { ini: number; fim: number }[]): { de: number; ate: number } {
  if (!intervalos.length) return { de: 8 * 60, ate: 18 * 60 }
  const de = Math.floor(Math.min(...intervalos.map(i => i.ini)) / 60) * 60
  const ate = Math.ceil(Math.max(...intervalos.map(i => i.fim)) / 60) * 60
  return { de, ate: Math.max(ate, de + 60) }
}

export const minutos = (h: string) => paraMin(horaCurta(h))

// ── Legenda com filtro ────────────────────────────────────────────────────────

export type FiltroEstados = Set<keyof typeof TOM_ESTADO>

export function Legenda({ contagens, ocultos, onAlternar }: {
  contagens: Partial<Record<keyof typeof TOM_ESTADO, number>>
  ocultos: FiltroEstados
  onAlternar: (k: keyof typeof TOM_ESTADO) => void
}) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Legenda — clique para esconder ou mostrar">
      {(Object.keys(TOM_ESTADO) as (keyof typeof TOM_ESTADO)[]).map(k => {
        const { t, Icone, rotulo } = TOM_ESTADO[k]
        const visivel = !ocultos.has(k)
        return (
          <li key={k}>
            <button type="button" aria-pressed={visivel} onClick={() => onAlternar(k)}
              className={`${tom(t)} pp-pilula h-8 pl-1.5 text-[12px] ${visivel ? "" : "opacity-45 line-through"}`}
              title={visivel ? `Esconder: ${rotulo}` : `Mostrar: ${rotulo}`}>
              <span className="pp-pilula-bola size-5"><Icone className="h-3 w-3" aria-hidden /></span>
              {rotulo}
              {contagens[k] != null && <span className="tabular-nums text-[var(--c-tinta)]">{contagens[k]}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
