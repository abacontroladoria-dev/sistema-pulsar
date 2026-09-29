"use client"

import { useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { ArrowDownUp, Check, ChevronDown, FilterX, ListFilter } from "lucide-react"
import { DateRangePicker, type AtalhoPeriodo } from "@/components/ui/date-range-picker"
import { MultiSearchCombobox, type OpcaoMulti } from "@/components/cronograma/ui/MultiSearchCombobox"
import { foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { hojeBrasiliaISO } from "@/lib/laudos/acompanhamento"
import {
  DIAS_ALERTA_VENCIMENTO,
  filtrosAlterados,
  SITUACAO_PACIENTE_LABEL,
  TODAS_SITUACOES_PACIENTE,
  type FiltrosLaudos as Filtros,
  type OrdemLaudos,
} from "@/lib/laudos/filtros"
import type { SituacaoPaciente } from "@/types/laudosAcompanhamento"

// O painel de filtros. (Os cards de KPI moram em PainelIndicadores.tsx.)
//
// O painel (`PainelFiltros`) mora ENTRE o cabeçalho e os KPIs — pedido do usuário
// (28/09/2026): "o header ficou desorganizado com o tanto de informação". Até
// ali a barra vivia no cabeçalho, uma faixa de 80px fixos (`layout.tsx`) que não
// pode quebrar linha: cada controle tinha de encolher até virar só ícone, e com
// o filtro de senha e o botão de upload a faixa passou a rolar de lado. No
// painel há espaço para rótulo visível, controles de 40px e uma grade que
// empilha no celular. O cabeçalho ficou só com as AÇÕES (Atualizar senhas,
// Histórico).
//
// A decisão de desenho que continua: **os cards de KPI SÃO o filtro de
// situação — do laudo E da senha.** Por isso não há seletor de situação do
// laudo nem de status da senha aqui: o número que motiva o filtro está no card,
// e a segunda porta seria a que ninguém usa (a lista "Senha ASSIM" que morou
// aqui saiu por isso — decisão do usuário, 28/09/2026).
//
// ─── Os controles são os padrões do projeto (AGENTS.md) ─────────────────────
//
//   • Validade: `DateRangePicker` — é um INTERVALO, e o padrão para intervalo é
//     ele (antes eram dois `DatePicker`, duas portas para uma variável).
//   • Convênio e Paciente: `MultiSearchCombobox` — o padrão para lista suspensa
//     com várias seleções.
//   • Ordenar: `Suspenso`, desta tela — escolha ÚNICA, fora da regra acima.

/**
 * As ordenações, em dois grupos com título — espelho dos painéis Laudo e
 * Senhas. O grupo da senha só aparece com relatório de senhas importado.
 */
const GRUPOS_ORDEM: {
  titulo: string
  soComSenhas: boolean
  ordens: { valor: OrdemLaudos; rotulo: string; dica: string }[]
}[] = [
  {
    titulo: "Laudo",
    soComSenhas: false,
    ordens: [
      { valor: "validade", rotulo: "Validade do laudo", dica: "a que venceu há mais tempo primeiro" },
      { valor: "data_laudo", rotulo: "Data do laudo", dica: "o laudo mais antigo primeiro" },
      { valor: "avisado_em", rotulo: "Avisado em", dica: "o aviso mais antigo primeiro" },
      { valor: "nome", rotulo: "Nome do paciente", dica: "de A a Z" },
    ],
  },
  {
    titulo: "Senha",
    soComSenhas: true,
    ordens: [
      {
        valor: "urgencia_senha",
        rotulo: "Urgência da senha",
        dica: "vencida, sem senha, pendente… e a que vence antes",
      },
      { valor: "validade_senha", rotulo: "Validade da senha", dica: "a que vence primeiro" },
      { valor: "liberacao_senha", rotulo: "Liberação da senha", dica: "a liberada mais recentemente" },
      {
        valor: "atualizacao_senha",
        rotulo: "Atualizada no convênio",
        dica: "a alterada mais recentemente no relatório",
      },
    ],
  },
]

const TODAS_ORDENS = GRUPOS_ORDEM.flatMap((g) => g.ordens)

/** Uma data ISO deslocada em `dias` (negativo volta). Sem fuso: é data pura. */
function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

/**
 * O gatilho de 40px comum aos campos do painel — a busca (no shell), o período,
 * as listas e a ordenação têm a mesma altura, borda e fundo, para a grade ler
 * como um formulário só.
 */
const GATILHO_CAMPO =
  "flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * O painel de filtros, entre o cabeçalho e os KPIs.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ 🔍 Buscar…                                  [Ordenar ▾] [Limpar] │
 *   │ ──────────────────────────────────────────────────────────────── │
 *   │ VALIDADE DO LAUDO  VALIDADE DA SENHA  CONVÊNIO      PACIENTE     │
 *   │ [📅 período]       [📅 período]       [ASSIM ▾]     [Ativo ▾]    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * A busca entra por `busca` (um nó pronto): ela é dona do próprio texto e mora
 * no shell, que controla a chave que a remonta ao limpar (ver `CampoBusca`).
 *
 * No celular a busca ocupa a linha inteira, Ordenar e Limpar dividem a de baixo,
 * e os quatro campos ficam dois por linha no tablet e um por linha no celular.
 */
export function PainelFiltros({
  filtros,
  onChange,
  onLimpar,
  comSenhas,
  hoje,
  busca,
  opcoesConvenio,
}: {
  filtros: Filtros
  onChange: (f: Filtros) => void
  onLimpar: () => void
  /** Os convênios da lista, com contagem — ver `opcoesDeConvenio`. */
  opcoesConvenio: OpcaoMulti<string>[]
  /** Há relatório de senhas importado? Sem ele, sai a ordenação por validade da senha. */
  comSenhas: boolean
  /** `meta.hoje` do servidor — base dos atalhos de período. */
  hoje: string
  busca: ReactNode
}) {
  function set<K extends keyof Filtros>(chave: K, valor: Filtros[K]) {
    onChange({ ...filtros, [chave]: valor })
  }

  const ordemAtual = TODAS_ORDENS.find((o) => o.valor === filtros.ordem)?.rotulo ?? ""
  const podeLimpar = filtrosAlterados(filtros)

  // "Hoje" do servidor quando já veio; antes do primeiro carregamento, o de
  // Brasília calculado aqui — o mesmo cálculo que o servidor faz.
  const base = () => hoje || hojeBrasiliaISO()
  const atalhos: AtalhoPeriodo[] = [
    {
      rotulo: `Próximos ${DIAS_ALERTA_VENCIMENTO} dias`,
      intervalo: () => ({ inicio: base(), fim: somarDias(base(), DIAS_ALERTA_VENCIMENTO) }),
    },
    { rotulo: "Próximos 30 dias", intervalo: () => ({ inicio: base(), fim: somarDias(base(), 30) }) },
    { rotulo: "Últimos 30 dias", intervalo: () => ({ inicio: somarDias(base(), -30), fim: base() }) },
  ]

  return (
    <section
      aria-label="Filtros"
      className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">{busca}</div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Suspenso icone={ArrowDownUp} etiqueta="Ordenar" resumo={ordemAtual} larguraPainel="w-72">
            {(fechar) =>
              GRUPOS_ORDEM.filter((g) => comSenhas || !g.soComSenhas).map((g, n) => (
                <div
                  key={g.titulo}
                  role="group"
                  aria-label={g.titulo}
                  className={n > 0 ? "mt-1 border-t border-border pt-1" : ""}
                >
                  <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.titulo}
                  </p>
                  {g.ordens.map((o) => (
                    <ItemSuspenso
                      key={o.valor}
                      rotulo={o.rotulo}
                      dica={o.dica}
                      marcado={filtros.ordem === o.valor}
                      onClick={() => {
                        set("ordem", o.valor)
                        // Escolha ÚNICA: escolher já responde a pergunta.
                        fechar()
                      }}
                    />
                  ))}
                </div>
              ))
            }
          </Suspenso>

          {/* DESABILITADO quando não há nada a limpar, em vez de escondido: um
              botão que aparece e some muda a largura de tudo ao lado. Aceso,
              ele também avisa que ALGUM filtro está ativo — inclusive a busca. */}
          <button
            type="button"
            onClick={onLimpar}
            disabled={!podeLimpar}
            title={
              podeLimpar
                ? "Volta ao estado inicial: todos os laudos, convênios ASSIM Saúde e LEVE SAUDE, só pacientes ativos, por validade mais antiga"
                : "Nenhum filtro alterado"
            }
            className={`flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-[13px] font-semibold text-foreground transition hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-background ${foco}`}
          >
            <FilterX className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Limpar filtros
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotuloTexto="Validade do laudo">
          <DateRangePicker
            inicio={filtros.validadeDe}
            fim={filtros.validadeAte}
            onChange={({ inicio, fim }) =>
              onChange({ ...filtros, validadeDe: inicio, validadeAte: fim })
            }
            atalhos={atalhos}
            // Aqui "sem período" é um estado válido (= todas as validades), ao
            // contrário das telas que consultam o banco por período — por isso o
            // Limpar volta ao vazio, e o gatilho mostra "Selecionar período".
            padrao={() => ({ inicio: "", fim: "" })}
            className={GATILHO_CAMPO}
          />
        </Campo>

        {/* Qualquer senha do laudo (dentro ou fora do ROL) com validade no
            período. Sem relatório importado, desabilitado — em vez de sumir, para
            o painel não mudar de tamanho quando a lista termina de carregar. */}
        <Campo rotuloTexto="Validade da senha">
          {comSenhas ? (
            <DateRangePicker
              inicio={filtros.validadeSenhaDe}
              fim={filtros.validadeSenhaAte}
              onChange={({ inicio, fim }) =>
                onChange({ ...filtros, validadeSenhaDe: inicio, validadeSenhaAte: fim })
              }
              atalhos={atalhos}
              padrao={() => ({ inicio: "", fim: "" })}
              className={GATILHO_CAMPO}
            />
          ) : (
            <div
              className="flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-[13px] text-muted-foreground"
              title="Suba o relatório em “Atualizar senhas”, no topo da tela"
            >
              Nenhum relatório importado
            </div>
          )}
        </Campo>

        {/* VAZIO = todos (ver `FiltrosLaudos.convenios`): por isso o texto em
            repouso é "Todos os convênios", e não "Nenhuma selecionada". */}
        <Campo rotuloTexto="Convênio">
          <CampoMultiplo
            etiqueta="Convênio do paciente"
            opcoes={opcoesConvenio}
            selecionados={filtros.convenios}
            onToggle={(c) => set("convenios", alternar(filtros.convenios, c))}
            onMarcarTodos={(ids) => set("convenios", new Set([...filtros.convenios, ...ids]))}
            onDesmarcarTodos={() => set("convenios", new Set())}
            placeholder="Todos os convênios"
            nomePlural="convênios"
            adjetivoResumo="selecionados"
          />
        </Campo>

        <Campo rotuloTexto="Paciente">
          <CampoMultiplo
            etiqueta="Situação do paciente"
            opcoes={OPCOES_PACIENTE}
            selecionados={filtros.situacoesPaciente}
            onToggle={(s) => set("situacoesPaciente", alternar(filtros.situacoesPaciente, s))}
            onMarcarTodos={(ids) => set("situacoesPaciente", new Set([...filtros.situacoesPaciente, ...ids]))}
            onDesmarcarTodos={() => set("situacoesPaciente", new Set())}
          />
        </Campo>
      </div>
    </section>
  )
}

/** Rótulo visível em cima do controle — o formato de formulário do projeto. */
function Campo({ rotuloTexto, children }: { rotuloTexto: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={rotulo}>{rotuloTexto}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

/**
 * Seletor de escolha ÚNICA do painel (a ordenação). `children` é função e
 * recebe `fechar`, para fechar ao escolher. O nome do campo fica no `title` do
 * gatilho e no `aria-label` da lista; o ícone faz o papel de rótulo visível.
 */
function Suspenso({
  icone: Icone,
  etiqueta,
  resumo,
  larguraPainel,
  children,
}: {
  icone: typeof ListFilter
  etiqueta: string
  resumo: string
  larguraPainel: string
  children: (fechar: () => void) => ReactNode
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={etiqueta}
          aria-label={`${etiqueta}: ${resumo}`}
          className="flex h-10 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-left text-[13px] font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 max-w-52 flex-1 truncate">{resumo}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className={`z-[100] ${larguraPainel} overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`}
        >
          <div role="listbox" aria-label={etiqueta}>
            {children(() => setAberto(false))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ItemSuspenso({
  rotulo,
  dica,
  marcado,
  onClick,
}: {
  rotulo: string
  /** Em que sentido ordena ("a que vence primeiro") — sem ela, o sentido fica no escuro. */
  dica?: string
  marcado: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={marcado}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className={`block ${marcado ? "font-semibold text-foreground" : ""}`}>{rotulo}</span>
        {dica && <span className="block text-xs text-muted-foreground">{dica}</span>}
      </span>
      {marcado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  )
}

const OPCOES_PACIENTE: OpcaoMulti<SituacaoPaciente>[] = TODAS_SITUACOES_PACIENTE.map((s) => ({
  id: s,
  nome: SITUACAO_PACIENTE_LABEL[s],
}))

/** Cópia do conjunto com `item` trocado — nunca muta o Set que está no estado. */
function alternar<T>(conjunto: Set<T>, item: T): Set<T> {
  const novo = new Set(conjunto)
  if (novo.has(item)) novo.delete(item)
  else novo.add(item)
  return novo
}

/**
 * Lista de escolha MÚLTIPLA do painel: o `MultiSearchCombobox` padrão do
 * projeto, com o gatilho de 40px dos outros campos (variante "plano", para a
 * moldura ser a do painel e não a dele).
 *
 * O painel abre com a largura do gatilho — a coluna da grade —, que cabe o
 * rótulo mais longo das opções (ex.: "MEMORIAL SAÚDE LTDA (14)").
 *
 * Opções complementares: marcar mais de uma SOMA ao resultado; nenhuma marcada
 * mostra nenhuma linha (ver `aplicarFiltrosSecundarios`).
 */
function CampoMultiplo<Id extends string>({
  etiqueta,
  opcoes,
  selecionados,
  onToggle,
  placeholder = "Nenhuma selecionada",
  nomePlural = "situações",
  adjetivoResumo,
  onMarcarTodos,
  onDesmarcarTodos,
}: {
  etiqueta: string
  opcoes: OpcaoMulti<Id>[]
  selecionados: Set<Id>
  onToggle: (id: Id) => void
  placeholder?: string
  nomePlural?: string
  adjetivoResumo?: string
  /** "Marcar todos" / "Desmarcar todos" dentro da lista — ver MultiSearchCombobox. */
  onMarcarTodos?: (idsVisiveis: Id[]) => void
  onDesmarcarTodos?: () => void
}) {
  return (
    <MultiSearchCombobox
      variant="plano"
      opcoes={opcoes}
      selecionados={selecionados}
      onToggle={onToggle}
      ariaLabel={etiqueta}
      placeholder={placeholder}
      nomePlural={nomePlural}
      adjetivoResumo={adjetivoResumo}
      onMarcarTodos={onMarcarTodos}
      onDesmarcarTodos={onDesmarcarTodos}
      className="h-10 rounded-lg border border-border bg-background px-3 font-semibold text-foreground transition hover:bg-muted/40"
    />
  )
}
