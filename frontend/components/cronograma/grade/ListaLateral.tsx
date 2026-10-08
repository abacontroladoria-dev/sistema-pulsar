"use client"

import { useMemo, useState } from "react"
import { Search, UserRoundX, X } from "lucide-react"
import { AvatarProfissional, ChipTerapia } from "@/components/cadastros/profissionais/pecas"
import { campo, foco } from "@/components/cadastros/pacientes/ui/campos"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { BarraPastel, tom } from "@/components/ui/pastel/pecas"
import { normTxt } from "@/lib/cronograma/constants"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import type { ProfissionalGrade, ResumoGrade } from "@/types/grade"

// Lista à esquerda (decisão do usuário, 07/10/2026): quem está na Grade, com a
// semana de cada um em números. No celular ela abre num painel a partir do
// botão "Escolher …" (ver GradeShell).

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
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pp-ink-muted)]" aria-hidden />
      <input type="text" value={valor} onChange={e => onMudar(e.target.value)} placeholder={rotulo} aria-label={rotulo}
        className={`${campo} h-11 w-full pl-9 ${valor ? "pr-10" : ""}`} />
      {valor && (
        <button type="button" onClick={() => onMudar("")} aria-label="Limpar busca"
          className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)] ${foco}`}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

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
    <div className="flex h-full min-h-0 flex-col gap-3">
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
            className="h-11 text-sm"
          />
        </div>
        <button type="button" aria-pressed={inativos} onClick={() => setInativos(v => !v)}
          className={`${tom("vermelho")} pp-pilula min-h-11 shrink-0 ${inativos ? "!bg-[var(--c-suave)] !text-[var(--c-tinta)] shadow-[inset_0_0_0_2px_var(--c-medio)]" : ""}`}
          title="Mostrar quem saiu (sessões mantidas para reposição)">
          <span className="pp-pilula-bola"><UserRoundX className="h-3.5 w-3.5" aria-hidden /></span>Inativos
        </button>
      </div>
      <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">{filtradas.length} profissiona{filtradas.length === 1 ? "l" : "is"}</p>
      <ul className="-mx-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 pb-2" aria-label="Profissionais">
        {filtradas.map(l => {
          const ativo = l.p.id === selecionado
          const s = l.semana
          return (
            <li key={l.p.id}>
              <button type="button" onClick={() => onSelecionar(l.p.id)} aria-current={ativo ? "true" : undefined}
                className={`flex w-full items-start gap-3 rounded-[16px] p-2.5 text-left transition-colors ${foco} ${
                  ativo ? `${tom("aco")} bg-[var(--c-suave)] shadow-[inset_0_0_0_2px_var(--c-medio)]` : "hover:bg-[var(--pp-muted)]"}`}>
                <AvatarProfissional icone={l.icone} cor={l.cor} fotoPath={l.p.foto_path} tamanho="sm" inativo={!l.p.ativo} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{l.p.nome}</span>
                  {!l.p.ativo && l.p.data_saida && (
                    <span className="block text-xs font-bold text-rose-700 dark:text-rose-400">Saiu em {dataBR(l.p.data_saida)}</span>
                  )}
                  {l.terapias.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {l.terapias.slice(0, 2).map(t => <ChipTerapia key={t.terapiaId} terapia={t} inativo={!l.p.ativo} />)}
                      {l.terapias.length > 2 && <span className="text-xs font-bold text-[var(--pp-ink-muted)]">+{l.terapias.length - 2}</span>}
                    </span>
                  )}
                  {s && (s.agendados + s.disponiveis + s.bloqueados > 0) && (
                    <span className="mt-2 block">
                      <BarraPastel legenda={false} partes={[
                        { valor: s.agendados - s.reposicao, t: "aco", rotulo: "Agendados" },
                        { valor: s.disponiveis, t: "teal", rotulo: "Livres" },
                        { valor: s.bloqueados, t: "cinza", rotulo: "Bloqueados" },
                        { valor: s.reposicao, t: "vermelho", rotulo: "Reposição" },
                      ]} rotulo={`Semana: ${s.agendados} agendados, ${s.disponiveis} livres, ${s.bloqueados} bloqueados`} />
                      <span className="mt-1 block text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)]">
                        {s.agendados} agend. · {s.disponiveis} livre{s.disponiveis === 1 ? "" : "s"}
                        {s.reposicao > 0 && <span className="text-rose-700 dark:text-rose-400"> · {s.reposicao} reposição</span>}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
        {!filtradas.length && (
          <li className="rounded-xl bg-[var(--pp-muted)] px-3 py-6 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">
            Ninguém neste recorte.
          </li>
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Busca valor={busca} onMudar={setBusca} rotulo="Buscar paciente" />
      {comReposicao > 0 && (
        <button type="button" aria-pressed={soReposicao} onClick={() => setSoReposicao(v => !v)}
          className={`${tom("vermelho")} pp-pilula min-h-11 self-start ${soReposicao ? "!bg-[var(--c-suave)] !text-[var(--c-tinta)] shadow-[inset_0_0_0_2px_var(--c-medio)]" : ""}`}>
          <span className="pp-pilula-bola"><UserRoundX className="h-3.5 w-3.5" aria-hidden /></span>
          Precisam de reposição <span className="tabular-nums">{comReposicao}</span>
        </button>
      )}
      <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">
        {carregando ? "Carregando pacientes…" : filtradas.length > LIMITE_PACIENTES
          ? `Mostrando ${LIMITE_PACIENTES} de ${filtradas.length} — digite para encontrar os outros`
          : `${filtradas.length} paciente${filtradas.length === 1 ? "" : "s"}`}
      </p>
      <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-2" aria-label="Pacientes">
        {mostradas.map(l => {
          const ativo = l.id === selecionado
          return (
            <li key={l.id}>
              <button type="button" onClick={() => onSelecionar(l.id)} aria-current={ativo ? "true" : undefined}
                className={`flex min-h-11 w-full items-center gap-2 rounded-[14px] px-3 py-2 text-left transition-colors ${foco} ${
                  ativo ? `${tom("aco")} bg-[var(--c-suave)] shadow-[inset_0_0_0_2px_var(--c-medio)]` : "hover:bg-[var(--pp-muted)]"}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-extrabold ${l.ativo ? "" : "text-[var(--pp-ink-muted)]"}`}>{l.nome}</span>
                  {l.convenio && <span className="block truncate text-xs font-semibold text-[var(--pp-ink-muted)]">{l.convenio}</span>}
                </span>
                {l.reposicao > 0 && (
                  <span className={`${tom("vermelho")} shrink-0 rounded-full bg-[var(--c)] px-2 text-xs font-extrabold leading-6 text-[var(--c-sobre)]`}
                    title={`${l.reposicao} sessão(ões) com profissional inativo — precisam de reposição`}>
                    {l.reposicao}<span className="sr-only"> para reposição</span>
                  </span>
                )}
                {l.sessoes > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--pp-muted)] px-2 text-xs font-extrabold leading-6 tabular-nums" title={`${l.sessoes} sessão(ões) na semana`}>
                    {l.sessoes}<span className="sr-only"> sessões na semana</span>
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
