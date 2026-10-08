"use client"

import type { ReactNode } from "react"
import { FilterX } from "lucide-react"
import { MultiSearchCombobox, type OpcaoMulti } from "@/components/cronograma/ui/MultiSearchCombobox"
import { opcaoForm } from "@/components/cronograma/grade/estilo"
import { foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { ROTULO_TIPO, TIPOS_CONTRATO, type TipoContrato } from "@/lib/contratos/status"
import type { FiltrosContratos, SituacaoPacienteContrato } from "@/lib/contratos/filtros"

// Painel de filtros da Status Contratos, entre o cabeçalho e os indicadores —
// mesmo molde de components/acompanhamento/laudos/FiltrosLaudos.tsx.
//
// Status e vigência NÃO têm seletor aqui: os cards de indicador são o filtro
// dessas duas dimensões (o número que motiva o filtro é o próprio botão).
// Unidade também não: a grade que alimenta a tela é toda da unidade 280.
//
// Listas com várias seleções usam `MultiSearchCombobox` (padrão do AGENTS.md).

const OPCOES_TIPO: OpcaoMulti<TipoContrato>[] = TIPOS_CONTRATO.map((t) => ({ id: t, nome: ROTULO_TIPO[t] }))
const OPCOES_SITUACAO: OpcaoMulti<SituacaoPacienteContrato>[] = [
  { id: "ativo", nome: "Ativo" },
  { id: "inativo", nome: "Inativo" },
]

function alternar<T>(conjunto: Set<T>, valor: T): Set<T> {
  const novo = new Set(conjunto)
  if (novo.has(valor)) novo.delete(valor)
  else novo.add(valor)
  return novo
}

const CLASSE_MULTI =
  "h-10 rounded-lg border border-border bg-background px-3 font-semibold text-foreground transition hover:bg-muted/40"

export function PainelFiltrosContratos({
  filtros,
  onChange,
  onLimpar,
  podeLimpar,
  busca,
  opcoesConvenio,
}: {
  filtros: FiltrosContratos
  onChange: (f: FiltrosContratos) => void
  onLimpar: () => void
  podeLimpar: boolean
  busca: ReactNode
  opcoesConvenio: string[]
}) {
  function set<K extends keyof FiltrosContratos>(chave: K, valor: FiltrosContratos[K]) {
    onChange({ ...filtros, [chave]: valor })
  }

  return (
    <section aria-label="Filtros" className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">{busca}</div>
        {/* Desabilitado em vez de escondido: um botão que aparece e some muda a
            largura de tudo ao lado. */}
        <button
          type="button"
          onClick={onLimpar}
          disabled={!podeLimpar}
          title={podeLimpar ? "Volta ao estado inicial: todos os contratos, só pacientes ativos" : "Nenhum filtro alterado"}
          className={`flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-[13px] font-semibold text-foreground transition hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-background ${foco}`}
        >
          <FilterX className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Limpar filtros
        </button>
      </div>

      <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotuloTexto="Tipo de contrato">
          <MultiSearchCombobox
            variant="plano"
            opcoes={OPCOES_TIPO}
            selecionados={filtros.tipos}
            onToggle={(t) => set("tipos", alternar(filtros.tipos, t))}
            onDesmarcarTodos={() => set("tipos", new Set())}
            ariaLabel="Tipo de contrato"
            placeholder="Todos os tipos"
            nomePlural="tipos"
            adjetivoResumo="selecionados"
            className={CLASSE_MULTI}
          />
        </Campo>

        <Campo rotuloTexto="Convênio">
          <MultiSearchCombobox
            variant="plano"
            opcoes={opcoesConvenio.map((c) => ({ id: c, nome: c }))}
            selecionados={filtros.convenios}
            onToggle={(c) => set("convenios", alternar(filtros.convenios, c))}
            onMarcarTodos={(ids) => set("convenios", new Set([...filtros.convenios, ...ids]))}
            onDesmarcarTodos={() => set("convenios", new Set())}
            ariaLabel="Convênio do paciente"
            placeholder="Todos os convênios"
            nomePlural="convênios"
            adjetivoResumo="selecionados"
            className={CLASSE_MULTI}
          />
        </Campo>

        <Campo rotuloTexto="Paciente">
          <MultiSearchCombobox
            variant="plano"
            opcoes={OPCOES_SITUACAO}
            selecionados={filtros.situacoes}
            onToggle={(s) => set("situacoes", alternar(filtros.situacoes, s))}
            onDesmarcarTodos={() => set("situacoes", new Set())}
            ariaLabel="Situação do paciente"
            placeholder="Nenhuma selecionada"
            nomePlural="situações"
            className={CLASSE_MULTI}
          />
        </Campo>

        <Campo rotuloTexto="Grade do TiTa">
          <div className="grid h-10 grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={!filtros.soNaGrade}
              onClick={() => set("soNaGrade", false)}
              className={`${opcaoForm(!filtros.soNaGrade)} h-10`}
            >
              Todos
            </button>
            <button
              type="button"
              aria-pressed={filtros.soNaGrade}
              onClick={() => set("soNaGrade", true)}
              className={`${opcaoForm(filtros.soNaGrade)} h-10`}
              title="Só pacientes com agendamento na grade do TiTa"
            >
              Na grade
            </button>
          </div>
        </Campo>
      </div>
    </section>
  )
}

function Campo({ rotuloTexto, children }: { rotuloTexto: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={rotulo}>{rotuloTexto}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
