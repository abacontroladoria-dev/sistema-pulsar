"use client"

// Dashboard de topo da Rem. Mês - Total: quanto a empresa paga no mês e como
// esse total se reparte por especialidade.
//
// A disposição é a mesma do painel "Evolução por especialidade" da Análise de
// Evolução (central-terapeutas/tratativas/TratativasDashboard.tsx) — hero à
// esquerda com as métricas de apoio na mesma linha, uma barra geral logo abaixo,
// e o ranking em grade de colunas com cabeçalho, ordenação e "ver todas".
//
// O que NÃO foi copiado é o percentual. Lá o número que resume a linha é uma
// TAXA ("quanto do que devia ser evoluído já foi"), e o percentual é a forma
// certa de mostrá-la. Aqui o número que resume a linha é DINHEIRO, e uma
// participação em % responderia a pergunta errada: quem confere folha quer saber
// quanto se paga de Psicologia, não que Psicologia é 23,4% do mês. A proporção
// continua visível — é o comprimento da barra —, mas o número lido é R$.
//
// A barra geral também mudou de sentido: lá ela é progresso rumo a 100%; aqui é
// a COMPOSIÇÃO do total (o que varia por sessão × o fixo de banco de horas), que
// é o que falta explicar sobre o número do hero e o ranking não diz.
//
// A agregação toda vive em lib/remuneracao/dashboardRP.ts — este arquivo só
// apresenta, e a ordenação é apresentação pura (não muda nenhum valor).

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpDown, ChevronDown, ChevronRight, FileClock, Filter, X } from "lucide-react"

import { fmt } from "@/lib/remuneracao/formatacao"
import { B } from "@/lib/cronograma/constants"
import { useToneColor } from "@/hooks/useToneColor"
import { calcularTotalPorEspecialidade } from "@/lib/remuneracao/dashboardRP"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SemContratoAnteriorModal } from "./SemContratoAnteriorModal"
import type { CadastroContratual, ProfRemunReal } from "@/lib/remuneracao/calculo"

// ─── Contagem animada do valor total (respeita prefers-reduced-motion) ───────

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target)
  const prevTarget = useRef(0)
  const firstRun = useRef(true)

  useEffect(() => {
    const prefersReduced = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const from = firstRun.current ? 0 : prevTarget.current
    firstRun.current = false
    let raf = 0

    // Sem animação, o salto ainda vai por requestAnimationFrame: `setState`
    // direto no corpo do efeito viola react-hooks/set-state-in-effect (e o
    // estado já nasce com o valor certo, então não há piscada a evitar).
    if (prefersReduced) {
      raf = requestAnimationFrame(() => { setValue(target); prevTarget.current = target })
      return () => cancelAnimationFrame(raf)
    }

    const start = performance.now()

    function tick(now: number) {
      const t = Math.min((now - start) / durationMs, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else prevTarget.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}

/** Métrica de apoio da linha do hero: valor em cima, rótulo embaixo. */
function Metric({ label, valor, cor, title }: {
  label: string; valor: string; cor?: string; title?: string
}) {
  return (
    <span className="flex flex-col" title={title}>
      <span className="text-base font-bold tabular-nums leading-tight" style={cor ? { color: cor } : undefined}>
        {valor}
      </span>
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
    </span>
  )
}

type SortKey = "valor" | "profissionais" | "especialidade"

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "valor", label: "Valor" },
  { key: "profissionais", label: "Profissionais" },
  { key: "especialidade", label: "Especialidade (A–Z)" },
]

const LIMITE_INICIAL = 10

interface DashboardProps {
  resultado: ProfRemunReal[]
  /** Múltiplas especialidades podem ficar ativas ao mesmo tempo (OR: aparece
   * quem tem qualquer uma delas) — ver RemunRPTab.tsx, que também tem o
   * dropdown multi-seleção com busca ao lado da busca por texto. */
  especialidadesFiltro: Set<string>
  onToggleEspecialidade: (esp: string) => void
  onLimparEspecialidades: () => void
  // PEP apurada (pep_apuracao_mensal), por prestador — leitura pura, não
  // recalcula nada aqui. Sem isso a barra "Coordenador de Caso" fica zerada.
  pepResumo?: Map<string, { potencial: number; alcancado: number }>
  /** Contratos cadastrados por profissional — usado para saber quem tem
   * contrato vigente de Coordenador de Caso (filtra a PEP avulsa da lista) e
   * como fallback de especialidade de contrato de banco de horas sem `funcao`. */
  cadastroPrestadores?: Record<string, CadastroContratual>
  /** Especialidade geral cadastrada do profissional (reboot_profissionais),
   * chave normalizada por normKey — fallback de bh.funcao vazio. */
  especialidadeGeralPorProf?: Map<string, string>
}

export function RemuneracaoRPDashboard({ resultado, especialidadesFiltro, onToggleEspecialidade, onLimparEspecialidades, pepResumo, cadastroPrestadores, especialidadeGeralPorProf }: DashboardProps) {
  const { totalMes, totalVariavel, totalBancoHoras, profsBancoHoras, porEspecialidade } =
    useMemo(
      () => calcularTotalPorEspecialidade(resultado, pepResumo, cadastroPrestadores, especialidadeGeralPorProf),
      [resultado, pepResumo, cadastroPrestadores, especialidadeGeralPorProf]
    )

  const animatedTotal = useCountUp(totalMes)
  const toneColor = useToneColor()
  const [verTodas, setVerTodas] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("valor")
  const [semAnteriorAberto, setSemAnteriorAberto] = useState(false)
  const gatilhoSemAnterior = useRef<HTMLButtonElement>(null)

  const semContratoAnterior = useMemo(() => resultado.filter(p => !p.temAntigo), [resultado])

  const especialidadesOrdenadas = useMemo(() => {
    const lista = [...porEspecialidade]
    if (sortKey === "especialidade") return lista.sort((a, b) => a.especialidade.localeCompare(b.especialidade, "pt-BR"))
    if (sortKey === "profissionais") return lista.sort((a, b) => b.profissionais.length - a.profissionais.length)
    return lista.sort((a, b) => b.valor - a.valor)
  }, [porEspecialidade, sortKey])

  if (resultado.length === 0) return null

  const especialidadesVisiveis = verTodas ? especialidadesOrdenadas : especialidadesOrdenadas.slice(0, LIMITE_INICIAL)
  // A barra de cada linha compara com a MAIOR especialidade, não com o total:
  // é um ranking de magnitudes, e contra o total quase toda barra viraria um
  // toco indistinguível do vizinho.
  const maiorValor = porEspecialidade.reduce((m, e) => Math.max(m, e.valor), 0)

  const corValor = toneColor("green")
  const corFixo = toneColor("amber")
  const pctVariavel = totalMes > 0 ? (totalVariavel / totalMes) * 100 : 0

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${B.green}, ${B.blue})` }} />

      <div className="space-y-4 p-5 md:p-6">
        {/* Cabeçalho: título + controle de filtro ativo. Mesma forma da Análise
            de Evolução — só estes dois elementos, nada mais entra aqui. */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-foreground">Remuneração por especialidade</h2>
          {especialidadesFiltro.size > 0 && (
            <button
              type="button"
              onClick={onLimparEspecialidades}
              aria-label={`Remover filtro: ${[...especialidadesFiltro].join(", ")}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground transition-opacity hover:opacity-70"
            >
              <Filter size={11} />
              {especialidadesFiltro.size === 1
                ? [...especialidadesFiltro][0]
                : `${especialidadesFiltro.size} especialidades`}
              <X size={11} />
            </button>
          )}
        </div>

        {/* Métricas: total em destaque à esquerda + apoio na mesma linha */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black tabular-nums leading-none sm:text-5xl" style={{ color: corValor }}>
              {fmt(animatedTotal)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">a pagar no mês</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Metric
              label={`Profissiona${resultado.length !== 1 ? "is" : "l"}`}
              valor={resultado.length.toLocaleString("pt-BR")}
            />
            <Metric
              label="PA/PPD/PEP/ETA"
              valor={fmt(totalVariavel)}
              title="A parte que varia por sessão e por entrega: PA por sessão, PPD (diária), PEP apurada e bônus ETA."
            />
            <Metric
              label={`Fixo de banco de horas${profsBancoHoras > 0 ? ` (${profsBancoHoras})` : ""}`}
              valor={fmt(totalBancoHoras)}
              // Zero não tem cor: a maioria dos meses não tem banco de horas, e
              // um "R$ 0,00" em âmbar chamaria atenção para nada.
              cor={totalBancoHoras > 0 ? corFixo : undefined}
              title="Valor fixo dos contratos vigentes em banco de horas. Não varia por sessão."
            />
          </div>
        </div>

        {/* Pendência de CADASTRO, não de folha. Fica logo abaixo das métricas
            porque é do número de profissionais que ela fala — e acima do
            ranking porque no rodapé ela mudava de lugar toda vez que "Ver todas
            as especialidades" abria ou fechava, e um controle que se move é um
            controle que não se acha.
            Tem de PARECER botão: como frase sublinhada em cinza-mudo passava
            batido, virou controle com moldura, fundo próprio e contagem em
            pastilha — o mesmo vocabulário do botão "Contém Inconsistência" logo
            abaixo na página. Neutro de propósito: nesta tela vermelho é
            inconsistência (dinheiro em dúvida) e âmbar é banco de horas; um
            terceiro sentido no mesmo matiz apagaria os dois. */}
        {semContratoAnterior.length > 0 && (
          <button
            ref={gatilhoSemAnterior}
            type="button"
            onClick={() => setSemAnteriorAberto(true)}
            aria-haspopup="dialog"
            aria-expanded={semAnteriorAberto}
            aria-label={
              semContratoAnterior.length === 1
                ? "Ver o profissional sem contrato anterior cadastrado"
                : `Ver os ${semContratoAnterior.length} profissionais sem contrato anterior cadastrado`
            }
            className="group inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileClock size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            {/* Rótulo curto + contagem em pastilha, e não a frase inteira:
                "34 profissionais sem contrato anterior" não cabe sem truncar em
                largura apertada. A frase completa vive no aria-label e no título
                do modal. */}
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              Sem contrato anterior
            </span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-foreground">
              {semContratoAnterior.length}
            </span>
            <ChevronRight
              size={14}
              className="shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              aria-hidden
            />
          </button>
        )}

        {/* Composição do total — é o que o ranking por especialidade não diz:
            quanto do mês veio de apuração por sessão e quanto é fixo de contrato. */}
        <div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full"
              style={{
                background: corValor,
                width: `${pctVariavel}%`,
                transition: "width 500ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
            <div className="h-full flex-1" style={{ background: totalBancoHoras > 0 ? corFixo : "transparent" }} />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {totalBancoHoras > 0 ? (
              <>
                <span className="font-semibold" style={{ color: corValor }}>{fmt(totalVariavel)}</span> por sessão e entrega
                {" + "}
                <span className="font-semibold" style={{ color: corFixo }}>{fmt(totalBancoHoras)}</span> fixo de contrato
              </>
            ) : (
              <>Todo o mês vem de apuração por sessão e entrega — nenhum contrato vigente em banco de horas.</>
            )}
          </div>
        </div>

        {/* Ranking por especialidade */}
        <div className="pt-1">
          <div className="mb-1.5 flex items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Ordenar especialidades por"
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 sm:min-h-0"
                >
                  <ArrowUpDown size={11} />
                  {SORT_OPTIONS.find(o => o.key === sortKey)?.label}
                  <ChevronDown size={11} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                {SORT_OPTIONS.map(o => (
                  <DropdownMenuItem
                    key={o.key}
                    onSelect={() => setSortKey(o.key)}
                    className={sortKey === o.key ? "bg-muted font-semibold text-foreground" : ""}
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {especialidadesOrdenadas.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Sem valores para detalhar por especialidade ainda.</p>
          ) : (
            <div>
              {/* Cabeçalho de colunas — só desktop, com o mesmo grid-template das
                  linhas para os rótulos ficarem exatamente sobre seus valores. */}
              <div className="hidden px-2 pb-1 sm:grid sm:grid-cols-[35fr_20fr_30fr_15fr] sm:gap-4">
                <span className="text-[10px] font-semibold text-muted-foreground/70">Especialidade</span>
                <span className="text-[10px] font-semibold text-muted-foreground/70">Profissionais</span>
                <span className="col-span-2 text-[10px] font-semibold text-muted-foreground/70">Valor no mês</span>
              </div>

              {especialidadesVisiveis.map(esp => {
                const selected = especialidadesFiltro.has(esp.especialidade)
                const dimmed = especialidadesFiltro.size > 0 && !selected
                const largura = maiorValor > 0 ? Math.max((esp.valor / maiorValor) * 100, 3) : 0
                const qtd = esp.profissionais.length
                return (
                  <button
                    key={esp.especialidade}
                    type="button"
                    onClick={() => onToggleEspecialidade(esp.especialidade)}
                    aria-pressed={selected}
                    aria-label={
                      selected
                        ? `Remover filtro de ${esp.especialidade}`
                        : `Filtrar por ${esp.especialidade}, ${fmt(esp.valor)} no mês`
                    }
                    title={esp.especialidade}
                    className={`grid min-h-11 w-full grid-cols-1 content-center items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-[opacity,background-color] duration-150 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:grid-cols-[35fr_20fr_30fr_15fr] sm:gap-4 sm:py-2 ${
                      selected ? "bg-muted/60" : ""
                    } ${dimmed ? "opacity-35" : "opacity-100"}`}
                  >
                    {/* Mobile: nome + valor na primeira linha. Desktop: `contents`
                        remove esta div do layout e as duas spans viram itens
                        diretos do grid. */}
                    <div className="flex items-center gap-3 sm:contents">
                      <span className={`min-w-0 flex-1 truncate text-sm ${selected ? "font-bold text-foreground" : "font-medium text-foreground/90"}`}>
                        {esp.especialidade}
                      </span>
                      <span className="shrink-0 text-right text-sm font-bold tabular-nums sm:hidden" style={{ color: corValor }}>
                        {fmt(esp.valor)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 sm:contents">
                      <span className="min-w-0 flex-1 sm:flex-none">
                        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                          {qtd.toLocaleString("pt-BR")} profissiona{qtd !== 1 ? "is" : "l"}
                        </span>
                        {/* A média só aparece com mais de um profissional: com um
                            só ela repetiria, com outro nome, o valor da própria
                            linha ali do lado (§3.2). A linha continua ocupando o
                            espaço (nbsp) para todas terem a mesma altura. */}
                        <span className="block truncate text-[10px] text-muted-foreground/60 tabular-nums">
                          {qtd > 1 ? `${fmt(esp.valor / qtd)} em média por profissional` : " "}
                        </span>
                      </span>

                      <span className="h-2 w-16 min-w-0 shrink-0 overflow-hidden rounded-full bg-muted sm:w-full">
                        {/* clip-path em vez de width: não força reflow por frame e o
                            arredondamento fica com o container. */}
                        <span
                          className="block h-full w-full"
                          style={{
                            background: corValor,
                            clipPath: `inset(0 ${100 - largura}% 0 0)`,
                            transition: "clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)",
                          }}
                        />
                      </span>
                    </div>

                    <span className="hidden text-right text-sm font-bold tabular-nums sm:block" style={{ color: corValor }}>
                      {fmt(esp.valor)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {especialidadesOrdenadas.length > LIMITE_INICIAL && (
            <button
              type="button"
              onClick={() => setVerTodas(v => !v)}
              className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-foreground transition-opacity hover:opacity-70"
            >
              <ChevronDown size={13} className={`transition-transform ${verTodas ? "rotate-180" : ""}`} />
              {verTodas ? "Ver menos" : `Ver todas as especialidades (${especialidadesOrdenadas.length})`}
            </button>
          )}

          {totalBancoHoras > 0 && (
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              As barras somam {fmt(totalMes)} e já incluem o valor fixo de banco de horas — cada contrato em
              banco de horas tem uma especialidade só, então o valor dele entra direto na barra dela.
            </p>
          )}
        </div>

      </div>

      <SemContratoAnteriorModal
        aberto={semAnteriorAberto}
        onOpenChange={setSemAnteriorAberto}
        pendentes={semContratoAnterior}
        total={resultado.length}
        gatilho={gatilhoSemAnterior}
      />
    </div>
  )
}
