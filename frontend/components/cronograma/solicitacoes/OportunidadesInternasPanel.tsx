"use client"

// Painel "Onde já dá pra aproveitar internamente" — equivalente, na visão
// por Unidade/Dia/Especialidade, ao painel "Sugestões automáticas de
// contratação" da Simulação de Novo Prestador (SugestoesContratacaoPanel.tsx):
// em vez de indicar onde CONTRATAR renderia mais ocupação, aponta quais
// combinações turno+especialidade já têm mais oportunidade (direto +
// remanejamento) com quem já está contratado, sem precisar abrir vaga nova.
// Clicar em "Aplicar" preenche os filtros abaixo (unidade/dia+turno/
// especialidade), reaproveitando a mesma grade já renderizada.
//
// Visual alinhado ao painel-irmão (mesmo badge colorido por faixa, mesma
// especialidade colorida, mesmo indicador dia/turno minimalista e mesmos
// filtros de Ocupação/Especialidades) — dois painéis com a mesma pergunta
// ("onde olhar primeiro?") devem parecer a mesma ferramenta. Diferença
// deliberada: aqui o ranking é por QUANTIDADE de sessões de oportunidade
// (não %), porque a pergunta é "onde consigo mais sessões pra agendar
// agora", não "qual % de ocupação prevista" — sem simular contratação nova,
// não faz sentido perseguir uma % de "capacidade cheia".

import { startTransition, useEffect, useMemo, useState, useTransition } from "react"
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react"
import { rankearOportunidadesInternas, type CategoriaComOportunidade } from "@/lib/cronograma/ocupacaoCategoria"
import { corTerapiaBadge, escurecerHex, hexParaRgba, TODAS_ESP_CATEGORIA, UNID_COR } from "@/lib/cronograma/constants"
import { diaCurto } from "@/lib/cronograma/helpers"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { BadgeOcupacao, COR_OCUPACAO } from "@/components/cronograma/ui/BadgeOcupacao"
import { IndicadorDiaTurno } from "@/components/cronograma/ui/IndicadorDiaTurno"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import type { ModoCascataOcupacao } from "@/lib/cronograma/sugestaoContratacao"
import type { GapItem, Turno } from "@/lib/cronograma/simulacaoNovoPrestador"
import type { CsvRow } from "@/types/cronograma"

const ITENS_POR_PAGINA = 6
const ESPECIALIDADES_OPCOES = TODAS_ESP_CATEGORIA.map((nome, id) => ({ id, nome }))
const UNIDADES_OPCOES = Object.keys(UNID_COR).map((nome, id) => ({ id, nome }))

interface Props {
  cRows: CsvRow[]
  gapMap: Record<string, GapItem>
  /** Teto de pacientes por profissional Coordenador de Caso — ver gerarVagasCategoria. */
  limiteCoordenadorCaso?: number
  onAplicar: (unidade: string, periodos: { dia: string; turno: Turno }[], especialidade: string) => void
}

// Card inteiro é a área clicável (inspirado em CardPaciente, de
// PacientesCadastro.tsx: hover eleva + sombra cresce + borda escurece,
// tudo com guardas motion-reduce). Raiz é um <div role="button"> em vez
// de <button> porque o InfoTooltip (lâmpada de detalhamento) já renderiza
// um <button> interno — <button> dentro de <button> é HTML inválido. O
// InfoTooltip já para a propagação do clique, então abrir o detalhamento
// não aplica o filtro do card.
function CardOportunidade({ item, pendente, onAplicar }: { item: CategoriaComOportunidade; pendente: boolean; onAplicar: () => void }) {
  const turnos: Turno[] = item.periodo === "diaInteiro" ? ["manha", "tarde"] : [item.periodo]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-busy={pendente}
      onClick={() => { if (!pendente) onAplicar() }}
      onKeyDown={e => {
        if (pendente) return
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAplicar() }
      }}
      aria-label={`Aplicar filtro: ${item.especialidade} em ${item.unidade}, ${diaCurto(item.dia)}`}
      className={`group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-foreground/15 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none ${pendente ? "cursor-wait opacity-80" : "cursor-pointer"}`}
    >
      <div className="flex items-start gap-3">
        <BadgeOcupacao
          pct={item.pctAproveitamento}
          faixa={item.faixa}
          valorExibido={String(item.qtdOportunidade)}
          sufixo={`de ${item.maxSessoes} sessões`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full border px-2 py-0.5 text-[12.5px] font-extrabold"
              style={{
                backgroundColor: hexParaRgba(corTerapiaBadge(item.especialidade), 0.16),
                borderColor: hexParaRgba(corTerapiaBadge(item.especialidade), 0.4),
                color: escurecerHex(corTerapiaBadge(item.especialidade), 0.35),
              }}
            >
              {item.especialidade}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-[12.5px] font-bold text-foreground">{item.unidade}</span>
          </div>
          <IndicadorDiaTurno dia={item.dia} turnos={turnos} corBar={COR_OCUPACAO[item.faixa].bar} />
        </div>
      </div>

      <hr className="border-border" />

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border border-border bg-muted/40 px-2 py-1 font-semibold text-foreground">
          <InfoTooltip ariaLabel="Detalhamento das oportunidades" trigger={<span>{item.qtdOportunidade} oportunidade(s)</span>}>
            <div className="flex flex-col gap-1">
              <span>{item.qtdDireto} direta(s)</span>
              <span>{item.qtdRemanejamentoMesmoDia} via remanejamento (mesmo dia)</span>
              <span>{item.qtdRemanejamentoOutroDia} via remanejamento (outro dia)</span>
              <span>{item.qtdNovoDia} via novo dia</span>
            </div>
          </InfoTooltip>
        </span>
        {item.qtdLivre > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-muted-foreground">
            {item.qtdLivre} livre(s) sem oportunidade
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-end gap-1 pt-1 text-[11px] font-bold text-sky-700 dark:text-sky-400">
        {pendente ? (
          <>
            Aplicando…
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
          </>
        ) : (
          <>
            Aplicar
            <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" />
          </>
        )}
      </div>
    </div>
  )
}

export function OportunidadesInternasPanel({ cRows, gapMap, limiteCoordenadorCaso, onAplicar }: Props) {
  const [modo, setModo] = useState<ModoCascataOcupacao>("diaInteiro")
  const [especialidadesIds, setEspecialidadesIds] = useState<Set<number>>(new Set())
  const [unidadesIds, setUnidadesIds] = useState<Set<number>>(new Set())
  const [pagina, setPagina] = useState(0)

  // Aplicar um card dispara recálculo pesado da grade abaixo (mesmo motivo
  // do startTransition usado nos filtros) — sem indicação visual, o clique
  // parece não ter feito nada até o recálculo terminar. `aplicando` cobre
  // o período em que o React está processando essa transição; `itemPendenteKey`
  // marca QUAL card mostra o spinner (só o que foi clicado, não todos).
  const [aplicando, startAplicarTransition] = useTransition()
  const [itemPendenteKey, setItemPendenteKey] = useState<string | null>(null)
  useEffect(() => {
    if (!aplicando) setItemPendenteKey(null)
  }, [aplicando])

  const especialidadesSelecionadas = useMemo(
    () => new Set(ESPECIALIDADES_OPCOES.filter(o => especialidadesIds.has(o.id)).map(o => o.nome)),
    [especialidadesIds],
  )
  const unidadesSelecionadas = useMemo(
    () => new Set(UNIDADES_OPCOES.filter(o => unidadesIds.has(o.id)).map(o => o.nome)),
    [unidadesIds],
  )

  const ranking = useMemo(
    () => rankearOportunidadesInternas(cRows, gapMap, { unidades: unidadesSelecionadas, modo, especialidades: especialidadesSelecionadas, limiteCoordenadorCaso }),
    [cRows, gapMap, unidadesSelecionadas, modo, especialidadesSelecionadas, limiteCoordenadorCaso],
  )

  // startTransition: recalcular o ranking varre unidade × dia × especialidade
  // (até ~195 combinações) — sem isso, trocar modo/especialidade trava o
  // clique até o recálculo terminar (mesmo cuidado de SugestoesContratacaoPanel.tsx).
  const mudarModo = (novo: ModoCascataOcupacao) => startTransition(() => { setModo(novo); setPagina(0) })

  const alternarEspecialidade = (id: number) => startTransition(() => {
    setEspecialidadesIds(prev => {
      const proxima = new Set(prev)
      if (proxima.has(id)) proxima.delete(id)
      else proxima.add(id)
      return proxima
    })
    setPagina(0)
  })

  const alternarUnidade = (id: number) => startTransition(() => {
    setUnidadesIds(prev => {
      const proxima = new Set(prev)
      if (proxima.has(id)) proxima.delete(id)
      else proxima.add(id)
      return proxima
    })
    setPagina(0)
  })

  const totalPaginas = Math.max(1, Math.ceil(ranking.length / ITENS_POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas - 1)
  const itensDaPagina = ranking.slice(paginaAtual * ITENS_POR_PAGINA, paginaAtual * ITENS_POR_PAGINA + ITENS_POR_PAGINA)

  const aplicarItem = (item: CategoriaComOportunidade, key: string) => {
    setItemPendenteKey(key)
    startAplicarTransition(() => {
      const periodos: { dia: string; turno: Turno }[] = item.periodo === "diaInteiro"
        ? [{ dia: item.dia, turno: "manha" }, { dia: item.dia, turno: "tarde" }]
        : [{ dia: item.dia, turno: item.periodo }]
      onAplicar(item.unidade, periodos, item.especialidade)
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-1.5">
        <Sparkles size={15} className="text-violet-600 dark:text-violet-400" />
        <span className="text-[15px] font-extrabold text-foreground">Onde já dá pra aproveitar internamente</span>
        <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
          {ranking.length} combinação(ões)
        </span>
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Ranqueado por quantidade de sessões de oportunidade (direto + remanejamento + novo dia) com quem já está contratado — sem precisar abrir vaga nova.
        {!unidadesIds.size && " Comparando as 3 unidades — escolha uma ou mais abaixo pra focar o ranking nelas."}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-xl bg-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted-foreground">Ocupação:</span>
          <div className="flex gap-1">
            {(
              [
                { value: "diaInteiro" as const, label: "Manhã + tarde juntos" },
                { value: "porTurno" as const, label: "Melhor turno isolado" },
              ]
            ).map(tab => {
              const ativa = modo === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => mudarModo(tab.value)}
                  aria-pressed={ativa}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    ativa
                      ? "border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="hidden h-5 w-px bg-border sm:block" />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted-foreground">Especialidades:</span>
          <div className="w-64">
            <MultiSearchCombobox
              opcoes={ESPECIALIDADES_OPCOES}
              selecionados={especialidadesIds}
              onToggle={alternarEspecialidade}
              placeholder="Todas as especialidades"
              nomePlural="especialidades"
              ariaLabel="Especialidades"
            />
          </div>
          {especialidadesIds.size > 0 && (
            <button
              type="button"
              onClick={() => startTransition(() => { setEspecialidadesIds(new Set()); setPagina(0) })}
              className="text-[11px] font-bold text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              Limpar filtro
            </button>
          )}
        </div>

        <div className="hidden h-5 w-px bg-border sm:block" />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted-foreground">Unidade:</span>
          <div className="w-64">
            <MultiSearchCombobox
              opcoes={UNIDADES_OPCOES}
              selecionados={unidadesIds}
              onToggle={alternarUnidade}
              placeholder="Todas as unidades"
              nomePlural="unidades"
              ariaLabel="Unidade"
            />
          </div>
          {unidadesIds.size > 0 && (
            <button
              type="button"
              onClick={() => startTransition(() => { setUnidadesIds(new Set()); setPagina(0) })}
              className="text-[11px] font-bold text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              Limpar filtro
            </button>
          )}
        </div>
      </div>

      {!ranking.length ? (
        <InlineNotice tone="slate">
          Nenhuma combinação com oportunidade interna no momento — tente trocar a unidade, a ocupação ou as especialidades acima.
        </InlineNotice>
      ) : (
        <>
          <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {itensDaPagina.map((item, i) => {
              const key = `${item.unidade}-${item.dia}-${item.periodo}-${item.especialidade}-${i}`
              return (
                <CardOportunidade
                  key={key}
                  item={item}
                  pendente={itemPendenteKey === key}
                  onAplicar={() => aplicarItem(item, key)}
                />
              )
            })}
          </div>

          {totalPaginas > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline" size="icon-xs"
                disabled={paginaAtual === 0}
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft size={13} />
              </Button>
              {Array.from({ length: totalPaginas }, (_, i) => i).map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPagina(i)}
                  className={`h-7 min-w-7 rounded-full border px-2 text-[11px] font-bold transition-colors ${
                    i === paginaAtual
                      ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500"
                      : "border-border bg-card text-foreground hover:bg-muted/50"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <Button
                variant="outline" size="icon-xs"
                disabled={paginaAtual === totalPaginas - 1}
                onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
                aria-label="Próxima página"
              >
                <ChevronRight size={13} />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
