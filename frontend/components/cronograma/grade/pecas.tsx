"use client"

import type { ReactNode } from "react"
import { Lock, Plus } from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import type { Tone } from "@/components/cronograma/ui/tones"
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

/**
 * Uma sessão na cor da terapia (receita do bloco da Agenda do Connect).
 * `linhas` = quanto cabe: 1 (só o título), 2 (+ horário · terapia), 3 (+ sala).
 */
export function CartaoSessao({
  a, cor, titulo, linhas = 2, alerta, onClick,
}: {
  a: AgendamentoGrade
  cor: string | null
  titulo: string
  linhas?: 1 | 2 | 3
  /** Selo pequeno (fora da grade, reposição…). */
  alerta?: { t: Tone; rotulo: string } | null
  onClick: () => void
}) {
  const terapia = a.terapia_exibicao_nome ?? a.terapia_nome
  const hora = `${horaCurta(a.hora_inicio)}–${horaCurta(a.hora_fim)}`
  const contorno = alerta?.t === "amber" ? "ring-amber-400 dark:ring-amber-500"
    : alerta?.t === "red" ? "ring-rose-400 dark:ring-rose-500"
    : "ring-[var(--t-300)] hover:ring-[var(--t-500)]"
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      style={estiloTons(cor)}
      title={`${hora} · ${a.paciente_nome} × ${a.profissional_nome} · ${terapia}${a.sala_nome ? ` · ${a.sala_nome}` : ""}`}
      className={`ua-tons block h-full w-full min-w-0 overflow-hidden rounded-md bg-[var(--t-50)] px-2 py-0.5 text-left text-[var(--t-700)] ring-1 ring-inset transition-shadow ${contorno} ${foco}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-xs font-semibold leading-4">{titulo}</span>
        {alerta && <span className={`${selo(alerta.t)} ml-auto shrink-0`}>{alerta.rotulo}</span>}
      </span>
      {linhas >= 2 && <span className="block truncate text-[11px] leading-4 opacity-80 tabular-nums">{hora} · {terapia}</span>}
      {linhas >= 3 && a.sala_nome && <span className="block truncate text-[11px] leading-4 opacity-70">{a.sala_nome}</span>}
    </button>
  )
}

// ── Bloco de um horário ───────────────────────────────────────────────────────

/** Um horário da grade na visão do profissional. A altura vem da duração. */
export function BlocoHorario({
  h, altura, corDe, onSessao, onLivre, onFechado, onVerTodos,
}: {
  h: HorarioGrade
  altura: number
  corDe: (terapiaId: number) => string | null
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
            <CartaoSessao a={a} cor={corDe(a.terapia_id)} titulo={a.paciente_nome} linhas={1}
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
  const linhas: 1 | 2 | 3 = h.ocupados.length > 1 ? 1 : altura >= 70 ? 3 : altura >= 40 ? 2 : 1

  return (
    <div className="flex h-full w-full flex-col gap-0.5 overflow-hidden">
      {visiveis.map((a, i) => (
        <div key={a.id} className="min-h-0 flex-1">
          <CartaoSessao a={a} cor={corDe(a.terapia_id)} titulo={a.paciente_nome} linhas={linhas}
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

/** Fundo com uma linha por hora (técnica da Agenda do Connect: sem divs por linha). */
export function fundoHoras(de: number): React.CSSProperties {
  const passo = 60 * PX_POR_MIN
  const desloc = ((60 - (de % 60)) % 60) * PX_POR_MIN
  return {
    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${passo}px)`,
    backgroundPosition: `0 ${desloc}px`,
  }
}

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

  return (
    <div className="relative" style={{ height: Math.max(0, (ate - de) * PX_POR_MIN), ...fundoHoras(de) }}>
      {fundo?.map(f => (
        <div key={`${f.ini}-${f.fim}`} title={f.rotulo}
          className="absolute inset-x-0 bg-emerald-500/10 dark:bg-emerald-400/10"
          style={{ top: (Math.max(f.ini, de) - de) * PX_POR_MIN, height: (Math.min(f.fim, ate) - Math.max(f.ini, de)) * PX_POR_MIN }}
          aria-hidden />
      ))}
      {!itens.length && vazio}
      {ordenados.map(it => {
        const n = total.get(it.chave) ?? 1
        const r = raia.get(it.chave) ?? 0
        const h = Math.max(20, (it.fim - it.ini) * PX_POR_MIN - 3)
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
    <div className="relative w-14 shrink-0" style={{ height: (ate - de) * PX_POR_MIN }} aria-hidden>
      {horas.map(m => (
        <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: (m - de) * PX_POR_MIN }}>
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

/** A mesma forma que aparece na grade, em miniatura. */
function Amostra({ k }: { k: keyof typeof TOM_ESTADO }) {
  const base = "inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
  if (k === "disponivel") return <span className={`${base} border border-dashed border-muted-foreground/60`} aria-hidden />
  if (k === "bloqueado") return <span className={`${base} border border-border bg-muted`} style={LISTRAS_BLOQUEIO} aria-hidden />
  if (k === "agendado") return <span className={`${base} bg-sky-500/70`} aria-hidden />
  if (k === "fora_da_grade") return <span className={`${base} ring-1 ring-inset ring-amber-400`} aria-hidden />
  return <span className={`${base} ring-1 ring-inset ring-rose-400`} aria-hidden />
}

export function Legenda({ contagens, ocultos, onAlternar }: {
  contagens: Partial<Record<keyof typeof TOM_ESTADO, number>>
  ocultos: FiltroEstados
  onAlternar: (k: keyof typeof TOM_ESTADO) => void
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda — clique para esconder ou mostrar">
      {(Object.keys(TOM_ESTADO) as (keyof typeof TOM_ESTADO)[]).map(k => {
        const { rotulo } = TOM_ESTADO[k]
        const visivel = !ocultos.has(k)
        return (
          <li key={k}>
            <button type="button" aria-pressed={visivel} onClick={() => onAlternar(k)}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 hover:bg-muted ${visivel ? "" : "opacity-50 line-through"} ${foco}`}
              title={visivel ? `Esconder: ${rotulo}` : `Mostrar: ${rotulo}`}>
              <Amostra k={k} />
              {rotulo}
              {contagens[k] != null && <span className="font-semibold tabular-nums text-foreground">{contagens[k]}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
