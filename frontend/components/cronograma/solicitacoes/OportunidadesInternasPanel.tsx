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

import { startTransition, useMemo, useState } from "react"
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react"
import { rankearOportunidadesInternas, type CategoriaComOportunidade } from "@/lib/cronograma/ocupacaoCategoria"
import { corTerapiaBadge, escurecerHex, hexParaRgba, TODAS_ESP_CATEGORIA, UNID_COR } from "@/lib/cronograma/constants"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { BadgeOcupacao, COR_OCUPACAO } from "@/components/cronograma/ui/BadgeOcupacao"
import { IndicadorDiaTurno } from "@/components/cronograma/ui/IndicadorDiaTurno"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import type { ModoCascataOcupacao } from "@/lib/cronograma/sugestaoContratacao"
import type { GapItem, Turno } from "@/lib/cronograma/simulacaoNovoPrestador"
import type { CsvRow } from "@/types/cronograma"

const ITENS_POR_PAGINA = 5
const ESPECIALIDADES_OPCOES = TODAS_ESP_CATEGORIA.map((nome, id) => ({ id, nome }))
const UNIDADES_OPCOES = Object.keys(UNID_COR).map((nome, id) => ({ id, nome }))

interface Props {
  cRows: CsvRow[]
  gapMap: Record<string, GapItem>
  /** Teto de pacientes por profissional Coordenador de Caso — ver gerarVagasCategoria. */
  limiteCoordenadorCaso?: number
  onAplicar: (unidade: string, periodos: { dia: string; turno: Turno }[], especialidade: string) => void
}

function CardOportunidade({ item, onAplicar }: { item: CategoriaComOportunidade; onAplicar: () => void }) {
  const turnos: Turno[] = item.periodo === "diaInteiro" ? ["manha", "tarde"] : [item.periodo]
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3.5">
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

        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 font-semibold text-foreground">
            {item.qtdOportunidade} oportunidade(s) — {item.qtdDireto} direta(s), {item.qtdRemanejamentoMesmoDia} via remanejamento (mesmo dia), {item.qtdRemanejamentoOutroDia} via remanejamento (outro dia), {item.qtdNovoDia} via novo dia
          </span>
          {item.qtdLivre > 0 && (
            <span className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-muted-foreground">
              {item.qtdLivre} livre(s) sem oportunidade
            </span>
          )}
        </div>
      </div>

      <Button size="xs" onClick={onAplicar} className="shrink-0 gap-1">
        Aplicar <ArrowRight size={12} />
      </Button>
    </div>
  )
}

export function OportunidadesInternasPanel({ cRows, gapMap, limiteCoordenadorCaso, onAplicar }: Props) {
  const [modo, setModo] = useState<ModoCascataOcupacao>("diaInteiro")
  const [especialidadesIds, setEspecialidadesIds] = useState<Set<number>>(new Set())
  const [unidadesIds, setUnidadesIds] = useState<Set<number>>(new Set())
  const [pagina, setPagina] = useState(0)

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

  const aplicarItem = (item: CategoriaComOportunidade) => {
    const periodos: { dia: string; turno: Turno }[] = item.periodo === "diaInteiro"
      ? [{ dia: item.dia, turno: "manha" }, { dia: item.dia, turno: "tarde" }]
      : [{ dia: item.dia, turno: item.periodo }]
    onAplicar(item.unidade, periodos, item.especialidade)
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
          <div className="flex flex-col gap-2.5">
            {itensDaPagina.map((item, i) => (
              <CardOportunidade
                key={`${item.unidade}-${item.dia}-${item.periodo}-${item.especialidade}-${i}`}
                item={item}
                onAplicar={() => aplicarItem(item)}
              />
            ))}
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
