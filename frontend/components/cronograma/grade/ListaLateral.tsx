"use client"

import { useMemo, useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { ChevronDown, Search, UserRoundX, X } from "lucide-react"
import { campo, foco } from "@/components/cadastros/pacientes/ui/campos"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { normTxt } from "@/lib/cronograma/constants"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import type { ProfissionalGrade, ResumoGrade } from "@/types/grade"
import { btnSecundario, cartao, selo } from "./estilo"

// Lista de profissionais/pacientes, enxuta (08/10/2026): ponto na cor da
// terapia principal, nome e os números da semana em cinza — no padrão das
// linhas do modo lista de /cadastros/profissionais. Fica RECOLHIDA num campo
// "Buscar profissional/paciente" (decisão do usuário, 08/10/2026: a grade
// ganha a largura toda); a lista completa abre por cima ao clicar nele.

export type LinhaProfissional = {
  p: ProfissionalGrade
  cor: string | null
  icone: string | null
  terapias: { nome: string; cor: string; terapiaId: number }[]
  semana: ResumoGrade | null
}

export type LinhaPaciente = {
  id: number
  nome: string
  convenio: string | null
  ativo: boolean
  sessoes: number
  reposicao: number
}

const LIMITE_PACIENTES = 80

function Busca({ valor, onMudar, rotulo }: { valor: string; onMudar: (v: string) => void; rotulo: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="text" value={valor} onChange={e => onMudar(e.target.value)} placeholder={rotulo} aria-label={rotulo}
        className={`${campo} h-9 pl-9 ${valor ? "pr-9" : ""}`} />
      {valor && (
        <button type="button" onClick={() => onMudar("")} aria-label="Limpar busca"
          className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * Campo recolhido "Buscar profissional/paciente" (mostra quem está escolhido);
 * o clique abre a lista completa num painel flutuante, com a busca em foco.
 */
export function SeletorDaLista({
  aberto, onAberto, rotulo, escolhido, children,
}: {
  aberto: boolean
  onAberto: (v: boolean) => void
  /** "Buscar profissional" / "Buscar paciente". */
  rotulo: string
  escolhido: { nome: string; cor?: string | null } | null
  /** A lista completa (ListaProfissionais / ListaPacientes). */
  children: ReactNode
}) {
  return (
    <Popover.Root open={aberto} onOpenChange={onAberto}>
      <Popover.Trigger asChild>
        <button type="button" aria-haspopup="dialog" title={escolhido ? `${escolhido.nome} — trocar` : rotulo}
          className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm transition-colors hover:bg-muted/50 sm:w-72 ${foco}`}>
          {escolhido ? (
            <>
              {escolhido.cor !== undefined && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: escolhido.cor ?? "var(--border)" }} aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{escolhido.nome}</span>
              <span className="sr-only">— {rotulo}</span>
            </>
          ) : (
            <>
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{rotulo}</span>
            </>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={16} aria-label={rotulo}
          // O filtro de terapia abre a própria lista num portal: clicar nela
          // não é "clicar fora", e o Esc dela não fecha este painel.
          onInteractOutside={e => { if ((e.target as Element | null)?.closest?.("[data-multisearch-aberto]")) e.preventDefault() }}
          onEscapeKeyDown={e => { if (document.querySelector("[data-multisearch-aberto]")) e.preventDefault() }}
          className="z-50 h-[min(70vh,36rem)] w-[min(24rem,calc(100vw-2rem))] rounded-xl shadow-xl outline-none">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Linha da lista: botão de 44 px de altura mínima, selecionada em bg-muted. */
const linhaCls = (ativa: boolean) =>
  `flex min-h-11 w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${foco} ${ativa ? "bg-muted" : "hover:bg-muted/50"}`

export function ListaProfissionais({
  linhas, selecionado, onSelecionar, opcoesTerapia,
}: {
  linhas: LinhaProfissional[]
  selecionado: number | null
  onSelecionar: (id: number) => void
  opcoesTerapia: { id: number; nome: string }[]
}) {
  const [busca, setBusca] = useState("")
  const [terapias, setTerapias] = useState<Set<number>>(new Set())
  const [inativos, setInativos] = useState(false)

  const filtradas = useMemo(() => {
    const q = normTxt(busca)
    return linhas.filter(l =>
      (inativos ? !l.p.ativo : l.p.ativo) &&
      (!q || normTxt(l.p.nome).includes(q)) &&
      (!terapias.size || l.p.terapias.some(t => terapias.has(t))))
  }, [linhas, busca, terapias, inativos])

  return (
    <div className={`${cartao} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="space-y-2 border-b border-border p-3">
        <Busca valor={busca} onMudar={setBusca} rotulo="Buscar profissional" />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <MultiSearchCombobox
              opcoes={opcoesTerapia}
              selecionados={terapias}
              onToggle={id => setTerapias(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              onDesmarcarTodos={() => setTerapias(new Set())}
              ariaLabel="Filtrar por terapia"
              nomePlural="terapias"
              placeholder="Terapia: todas"
              className="h-9 text-sm"
            />
          </div>
          <button type="button" aria-pressed={inativos} onClick={() => setInativos(v => !v)}
            className={`${btnSecundario} ${inativos ? "bg-muted" : ""}`}
            title="Mostrar quem saiu (sessões mantidas para reposição)">
            <UserRoundX className="h-4 w-4" aria-hidden />Inativos
          </button>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">{filtradas.length} profissiona{filtradas.length === 1 ? "l" : "is"}</p>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Profissionais">
        {filtradas.map(l => {
          const ativa = l.p.id === selecionado
          const s = l.semana
          return (
            <li key={l.p.id}>
              <button type="button" onClick={() => onSelecionar(l.p.id)} aria-current={ativa ? "true" : undefined} className={linhaCls(ativa)}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: l.cor ?? "var(--border)" }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${ativa ? "font-semibold text-primary" : "font-medium text-foreground"}`}>{l.p.nome}</span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    {!l.p.ativo && l.p.data_saida
                      ? `Saiu em ${dataBR(l.p.data_saida)}`
                      : s && (s.agendados + s.disponiveis > 0)
                        ? <>{s.agendados} agendado{s.agendados === 1 ? "" : "s"} · {s.disponiveis} livre{s.disponiveis === 1 ? "" : "s"}</>
                        : "Sem horários nesta semana"}
                    {s && s.reposicao > 0 && <span className="text-rose-700 dark:text-rose-400"> · {s.reposicao} reposição</span>}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!filtradas.length && (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">Ninguém neste recorte.</li>
        )}
      </ul>
    </div>
  )
}

export function ListaPacientes({
  linhas, selecionado, onSelecionar, carregando,
}: {
  linhas: LinhaPaciente[]
  selecionado: number | null
  onSelecionar: (id: number) => void
  carregando: boolean
}) {
  const [busca, setBusca] = useState("")
  const [soReposicao, setSoReposicao] = useState(false)

  const filtradas = useMemo(() => {
    const q = normTxt(busca)
    return linhas
      .filter(l => (!q || normTxt(l.nome).includes(q)) && (!soReposicao || l.reposicao > 0) && (q || l.ativo || l.sessoes > 0))
      // Sem busca: quem tem sessão na semana primeiro.
      .sort((a, b) => (q ? 0 : b.sessoes - a.sessoes) || a.nome.localeCompare(b.nome, "pt-BR"))
  }, [linhas, busca, soReposicao])
  const comReposicao = useMemo(() => linhas.filter(l => l.reposicao > 0).length, [linhas])
  const mostradas = filtradas.slice(0, LIMITE_PACIENTES)

  return (
    <div className={`${cartao} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="space-y-2 border-b border-border p-3">
        <Busca valor={busca} onMudar={setBusca} rotulo="Buscar paciente" />
        {comReposicao > 0 && (
          <button type="button" aria-pressed={soReposicao} onClick={() => setSoReposicao(v => !v)}
            className={`${btnSecundario} w-full justify-between ${soReposicao ? "bg-muted" : ""}`}>
            <span className="inline-flex items-center gap-2"><UserRoundX className="h-4 w-4" aria-hidden />Precisam de reposição</span>
            <span className={selo("red")}>{comReposicao}</span>
          </button>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {carregando ? "Carregando pacientes…" : filtradas.length > LIMITE_PACIENTES
            ? `Mostrando ${LIMITE_PACIENTES} de ${filtradas.length} — digite para encontrar os outros`
            : `${filtradas.length} paciente${filtradas.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Pacientes">
        {mostradas.map(l => {
          const ativa = l.id === selecionado
          return (
            <li key={l.id}>
              <button type="button" onClick={() => onSelecionar(l.id)} aria-current={ativa ? "true" : undefined} className={linhaCls(ativa)}>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${ativa ? "font-semibold text-primary" : l.ativo ? "font-medium text-foreground" : "font-medium text-muted-foreground"}`}>{l.nome}</span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    {[l.convenio, l.sessoes ? `${l.sessoes} ${l.sessoes === 1 ? "sessão" : "sessões"} na semana` : null].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                {l.reposicao > 0 && (
                  <span className={`${selo("red")} mt-0.5`} title={`${l.reposicao} sessão(ões) com profissional inativo — precisam de reposição`}>
                    {l.reposicao}<span className="sr-only"> para reposição</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
