"use client"

// Modal de análise por terapeuta da Análise de Evolução. Substitui a expansão
// inline do card (que empurrava a lista para baixo e escondia quatro tabelas
// dentro de accordions) por um workspace: composição da responsabilidade em
// cima, resultado no meio, UMA tabela com filtros embaixo.
//
// Nenhum número é calculado aqui. Tudo vem de composicaoEvolucao()
// (lib/remuneracao/evolucao.ts), a mesma função que o card da lista usa — por
// construção as abas e a composição não podem divergir. Como o resto da tela,
// não existe NADA monetário: ProfTratativas/SessaoTratativa não têm campo de R$.

import { Fragment, useMemo, useState } from "react"
import {
  CalendarDays, CalendarX2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, Clock, HelpCircle, ListFilter, Repeat2, Search, Target, UserRoundMinus, X,
} from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { isSim } from "@/lib/remuneracao/formatacao"
import { isCancelado } from "@/lib/remuneracao/rotulosExecucao"
import { formatDateBR } from "@/lib/remuneracao/datas"
import { composicaoEvolucao, bucketDaSessao, type BucketSessao } from "@/lib/remuneracao/evolucao"
import type { ProfTratativas, SessaoTratativa } from "@/lib/remuneracao/tratativas"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"

const POR_PAGINA = 15

const normKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

const fmtPct = (pct: number) => pct.toFixed(1).replace(".", ",")

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  const primeira = partes[0][0] ?? ""
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] ?? "" : ""
  return (primeira + ultima).toUpperCase()
}

// ─── Leitura de uma linha da tabela ──────────────────────────────────────────
// Paciente e Evolução são dois eixos DIFERENTES e é isso que a tabela precisa
// mostrar: "Pendente retroativa" é uma sessão que aconteceu (presença Sim) e
// está sem evolução — Paciente "Presente", Evolução "Pendente". Colapsar os
// dois numa coluna só é o que fazia a leitura antiga precisar de legenda.

function origemDaSessao(s: SessaoTratativa): { texto: string; tone: Tone } {
  return s.papel === "Substituição realizada"
    ? { texto: "Substituição", tone: "purple" }
    : { texto: "Agendamento", tone: "gray" }
}

function situacaoDaSessao(s: SessaoTratativa): { texto: string; tone: Tone } {
  const cls = s.classificacao ?? ""
  if (cls === "Feriado/Ponto Fac.") return { texto: "Feriado/Ponto Fac.", tone: "gray" }
  // Também lido do status, e não só da classificação: em "Cancelado evoluído" a
  // sessão foi cancelada e ainda assim tem evolução — dizer "Presente" ali
  // esconderia exatamente a contradição que faz a linha ser inconsistente.
  if (cls === "Cancelado" || isCancelado(s.statusFinal) || isCancelado(s.statusCsv)) {
    return { texto: "Cancelado", tone: "red" }
  }
  if (isSim(s.presencaOrbita)) return { texto: "Presente", tone: "green" }
  return { texto: "Sem presença", tone: "amber" }
}

const EVOLUCAO_POR_BUCKET: Record<BucketSessao, { texto: string; tone: Tone }> = {
  comEvolucao:    { texto: "Com evolução",      tone: "green" },
  substituicao:   { texto: "Com evolução",      tone: "green" },
  pendente:       { texto: "Pendente",          tone: "amber" },
  cancelada:      { texto: "Não exigida",       tone: "gray" },
  cedida:         { texto: "Evoluída por outro", tone: "gray" },
  // Inconsistência mostra a própria classificação: "Cancelado evoluído" e
  // "Evolução em conflito" pedem ações diferentes, um rótulo genérico esconderia isso.
  inconsistencia: { texto: "",                  tone: "red" },
}

function evolucaoDaSessao(s: SessaoTratativa): { texto: string; tone: Tone } {
  const b = bucketDaSessao(s)
  const base = EVOLUCAO_POR_BUCKET[b]
  return b === "inconsistencia" ? { texto: s.classificacao || "Inconsistência", tone: "red" } : base
}

const chaveSessao = (s: SessaoTratativa, i: number) =>
  `${s.papel}|${s._idx ?? ""}|${s.id ?? ""}|${s.data ?? ""}|${s.hora ?? ""}|${i}`

// ─── Composição da responsabilidade ──────────────────────────────────────────

/**
 * Um passo da fórmula. `destaque` (anel) marca os RESULTADOS — o que vem depois
 * de um "=" — e distingue "Agendamentos válidos" de "Substituídas por outro", que
 * dividem o mesmo cinza mas têm papéis opostos na conta.
 *
 * `alerta` é o que este bloco NÃO está contando. Existe por causa da
 * substituição em conflito de autoria: o número honesto é 0, e sem dizer "1 em
 * conferência" aqui o modal mostrava 0 substituições ao lado de uma linha com
 * Origem = "Substituição" e nada explicando a diferença.
 */
function PassoComposicao({ tone, icon, valor, titulo, nota, alerta, destaque = false }: {
  tone: Tone; icon: React.ReactNode; valor: number; titulo: string
  nota?: string; alerta?: string; destaque?: boolean
}) {
  const painel = TONE_PANEL[tone]
  return (
    <div className={`flex w-full min-w-30 flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-center sm:flex-1 ${painel.bg} ${destaque ? `ring-1 ring-inset ${painel.ring}` : ""}`}>
      <span className={TONE_CHIP[tone].text}>{icon}</span>
      <div className={`text-2xl font-black tabular-nums leading-none ${TONE_CHIP[tone].text}`}>{valor}</div>
      <div className="text-[11px] font-semibold leading-snug text-foreground/85">{titulo}</div>
      {nota && <div className="-mt-1 text-[10px] leading-snug text-muted-foreground">{nota}</div>}
      {alerta && (
        <div className={`-mt-1 text-[10px] font-semibold leading-snug ${TONE_CHIP.amber.text}`}>{alerta}</div>
      )}
    </div>
  )
}

function Conector({ sinal }: { sinal: "−" | "+" | "=" }) {
  return (
    <span aria-hidden className="shrink-0 self-center px-0.5 text-lg font-medium text-muted-foreground/60">
      {sinal}
    </span>
  )
}

// ─── Bloco de resultado ──────────────────────────────────────────────────────

function ResultadoNumero({ icon, label, valor, nota, cor, divisor = false }: {
  icon: React.ReactNode; label: string; valor: number; nota: string; cor: string; divisor?: boolean
}) {
  // A divisória é responsiva de propósito: empilhado no mobile, uma borda
  // esquerda solta ficaria pendurada no meio do nada.
  // Os ícones são os MESMOS do card da lista (MetricMini) — um ícone, um
  // significado nas duas telas.
  return (
    <div className={`min-w-30 ${divisor ? "sm:border-l sm:border-border sm:pl-6" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <span style={{ color: cor }}>{icon}</span>
        {label}
      </div>
      <div className="mt-0.5 text-3xl font-black tabular-nums leading-none" style={{ color: cor }}>{valor}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{nota}</div>
    </div>
  )
}

// ─── Detalhe secundário de uma sessão ────────────────────────────────────────

function CampoDetalhe({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{rotulo}</dt>
      <dd className="mt-0.5 text-xs text-foreground wrap-break-word">{valor}</dd>
    </div>
  )
}

// ─── Paginação ───────────────────────────────────────────────────────────────

/** Janela de páginas com elipse — no máximo 7 itens, sempre com a primeira e a última. */
function paginasVisiveis(atual: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const janela = new Set([1, total, atual, atual - 1, atual + 1])
  if (atual <= 3) [2, 3, 4].forEach(n => janela.add(n))
  if (atual >= total - 2) [total - 3, total - 2, total - 1].forEach(n => janela.add(n))
  const ordenadas = [...janela].filter(n => n >= 1 && n <= total).sort((a, b) => a - b)
  const saida: (number | "…")[] = []
  ordenadas.forEach((n, i) => {
    if (i > 0 && n - ordenadas[i - 1] > 1) saida.push("…")
    saida.push(n)
  })
  return saida
}

// ─── Modal ───────────────────────────────────────────────────────────────────

type AbaId = "todos" | "comEvolucao" | "pendentes" | "canceladas" | "substituicoes" | "cedidas" | "inconsistencias"

interface Props {
  p: ProfTratativas | null
  periodo: { de: string; ate: string } | null
  onClose: () => void
}

export function ModalAnaliseTerapeuta({ p, periodo, onClose }: Props) {
  const toneColor = useToneColor()
  const [aba, setAba] = useState<AbaId>("todos")
  const [pagina, setPagina] = useState(1)
  const [detalhe, setDetalhe] = useState<string | null>(null)
  // Busca própria do modal, sempre vazia ao abrir. Antes ela nascia com a busca
  // da página: quem tinha "dani" digitado para achar a pessoa na lista abria o
  // modal dela já filtrado, sem ter pedido. São perguntas diferentes — na lista
  // a busca escolhe QUEM aparece, aqui ela esconderia o resto do mês da pessoa.
  const [buscaLocal, setBuscaLocal] = useState("")

  // Nada de efeito para resetar aba/página ao trocar de profissional: quem
  // monta remonta por `key={prof}` (ver TratativasTab), então este estado já
  // nasce limpo a cada pessoa.

  const c = useMemo(() => (p ? composicaoEvolucao(p) : null), [p])

  const especialidades = useMemo(() => {
    if (!p) return []
    const contagem = new Map<string, number>()
    for (const s of p.sessoes) {
      const e = s.especialidade || "Sem especialidade"
      contagem.set(e, (contagem.get(e) ?? 0) + 1)
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e)
  }, [p])

  // As abas são uma PARTIÇÃO: cada registro aparece em exatamente uma, e a soma
  // das abas fecha com "Todos". Antes "Com evolução" trazia as substituições
  // junto (elas são evolução dela, afinal) e as mesmas linhas contavam de novo
  // na aba "Substituições" — a barra mostrava 60+0+10+4+3+0 = 77 com "Todos 73",
  // e nenhuma das contagens estava errada isoladamente. Por isso "Evolução
  // própria": é a metade do numerador que veio da própria agenda; a outra metade
  // é a aba "Substituições", e é a soma das duas que dá o "Com evolução" do
  // resultado acima.
  //
  // O tom de cada aba é o MESMO que aquele conceito já tem no card da lista e na
  // composição — a aba não introduz cor nova, herda a que existe. "Todos" fica
  // azul (e não verde) para o verde continuar significando só uma coisa nesta
  // tela: evolução feita.
  const abas = useMemo(() => {
    if (!c) return []
    const lista: { id: AbaId; label: string; icon: React.ReactNode; tone: Tone; sessoes: SessaoTratativa[] }[] = [
      { id: "todos",          label: "Todos",              icon: <ListFilter size={13} />,   tone: "blue",   sessoes: c.todas },
      { id: "comEvolucao",    label: "Evolução própria",   icon: <CheckCircle2 size={13} />, tone: "green",  sessoes: c.porBucket.comEvolucao },
      { id: "pendentes",      label: "Pendentes",          icon: <Clock size={13} />,        tone: "amber",  sessoes: c.porBucket.pendente },
      { id: "canceladas",     label: "Canceladas",         icon: <CalendarX2 size={13} />,   tone: "red",    sessoes: c.porBucket.cancelada },
      { id: "substituicoes",  label: "Substituições",      icon: <Repeat2 size={13} />,      tone: "purple", sessoes: c.porBucket.substituicao },
    ]
    // Cedidas ganham aba só quando existem: é um filtro útil quando há o que
    // filtrar, e uma aba permanentemente vazia quando não há. As linhas seguem
    // alcançáveis em "Todos" de qualquer jeito.
    if (c.cedidas > 0) {
      // Mesmo conceito do bloco "Substituídas por outro terapeuta" da
      // composição, encurtado só para caber na tira de abas.
      lista.push({ id: "cedidas", label: "Substituídas por outro", icon: <UserRoundMinus size={13} />, tone: "gray", sessoes: c.porBucket.cedida })
    }
    lista.push({ id: "inconsistencias", label: "Inconsistências", icon: <HelpCircle size={13} />, tone: "red", sessoes: c.porBucket.inconsistencia })
    return lista
  }, [c])

  const abaAtiva = abas.find(a => a.id === aba) ?? abas[0]

  const q = normKey(buscaLocal)
  const linhas = useMemo(() => {
    const base = abaAtiva?.sessoes ?? []
    if (!q) return base
    return base.filter(s =>
      normKey(`${s.paciente} ${s.especialidade} ${s.data} ${s.hora} ${s.profAgenda} ${s.profCsv} ${s.id}`).includes(q)
    )
  }, [abaAtiva, q])

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const visiveis = linhas.slice(inicio, inicio + POR_PAGINA)

  if (!p || !c) return null

  const corPct = toneColor(c.pct >= 80 ? "green" : c.pct >= 50 ? "amber" : "red")
  const larguraBarra = Math.max(0, Math.min(100, c.pct))
  const semEsperadas = c.esperadas === 0

  const emConferencia = c.substituicoesEmConferencia

  const nota = {
    todos: "Todos os registros do período, inclusive os que não entram na conta — a coluna Evolução diz, linha por linha, o que conta como evolução e o que não é exigido.",
    // As duas notas abaixo dizem a mesma soma dos dois lados: é o que liga as
    // duas abas ao número único "Com evolução" da faixa de resultado.
    comEvolucao: c.substituicoes > 0
      ? `Sessões da própria agenda que este profissional evoluiu. Somadas às ${c.substituicoes} substituições assumidas, dão as ${c.comEvolucao} com evolução do resultado acima.`
      : "Sessões da própria agenda que este profissional evoluiu.",
    canceladas: "Sessões canceladas (inclui feriado e ponto facultativo). Não entram nas evoluções esperadas — não há atendimento a evoluir.",
    substituicoes: `Sessões assumidas de outro terapeuta — contam como evolução deste, e é por isso que somam às evoluções esperadas.${
      c.substituicoes > 0 ? ` Com as ${c.porBucket.comEvolucao.length} da própria agenda, dão as ${c.comEvolucao} com evolução do resultado acima.` : ""
    }`,
    cedidas: "Estavam na agenda deste profissional, mas outro terapeuta assumiu e registrou a evolução — saem da responsabilidade dele e entram na de quem assumiu.",
    inconsistencias: "Presença da recepção e evolução registrada se contradizem, ou a autoria está em dúvida. Encaminhe para conferência antes de cobrar. Linha com Origem “Substituição” aqui não conta como substituição deste profissional até a autoria ser decidida.",
  }[aba as "todos" | "comEvolucao" | "canceladas" | "substituicoes" | "cedidas" | "inconsistencias"]

  const vazio = {
    todos: "Nenhum registro deste profissional no período.",
    comEvolucao: "Nenhuma evolução da própria agenda no período.",
    pendentes: "Nenhuma pendência — todas as evoluções esperadas foram registradas.",
    canceladas: "Nenhuma sessão cancelada no período.",
    substituicoes: "Nenhuma substituição assumida no período.",
    cedidas: "Nenhuma sessão substituída por outro terapeuta no período.",
    inconsistencias: "Nenhuma inconsistência encontrada.",
  }[aba]

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onClose() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="h-[90vh] w-[90vw] max-w-350 gap-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-350"
      >
        {/* ── Cabeçalho ─────────────────────────────────────────────────────
            Empilhado no mobile: em uma única linha o nome disputava largura com
            o período e quebrava letra a letra ("Agatacr / yst / Moreira"). */}
        <header className="flex flex-col gap-3 border-b border-border px-5 py-4 md:px-6 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
          <div className="flex min-w-0 items-start gap-3 lg:flex-1 lg:items-center">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-black ${TONE_CHIP.green.bg} ${TONE_CHIP.green.text}`}>
              {iniciaisDe(p.prof)}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold wrap-break-word text-foreground">{p.prof}</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground wrap-break-word">
                Terapeuta
                {especialidades.length > 0 && ` · ${especialidades.slice(0, 2).join(" · ")}`}
                {especialidades.length > 2 && ` +${especialidades.length - 2}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {periodo && (
              <div className="shrink-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <CalendarDays size={12} />
                  Período analisado
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {formatDateBR(periodo.de)} a {formatDateBR(periodo.ate)}
                </div>
              </div>
            )}

            <div className="shrink-0 border-border sm:border-l sm:pl-6">
              <div className="text-[11px] font-semibold text-muted-foreground">Evolução</div>
              <div className="text-3xl font-black tabular-nums leading-none" style={{ color: corPct }}>
                {semEsperadas ? "—" : `${fmtPct(c.pct)}%`}
              </div>
            </div>
          </div>

          {/* Absoluto no mobile para não empurrar o nome; volta ao fluxo no lg. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar análise"
            className="absolute top-3 right-3 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:static lg:ml-auto"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── Corpo ─────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-5 md:px-6">
          <div className="space-y-4">

            {/* Composição da responsabilidade */}
            <section className="rounded-2xl border border-border p-4">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-foreground">Composição da responsabilidade</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Canceladas saem da conta; substituições assumidas entram nela.
                </p>
              </div>

              <p className="sr-only">
                {c.previstos} agendamentos previstos menos {c.canceladas} sessões canceladas
                {c.cedidas > 0 && ` menos ${c.cedidas} sessões substituídas por outro terapeuta`}
                {" "}resultam em {c.validos} agendamentos válidos; somados a {c.substituicoes} substituições
                realizadas, {c.esperadas} evoluções esperadas.
                {emConferencia > 0 && ` Outras ${emConferencia} substituições estão em conferência e ficam fora desta conta.`}
              </p>

              {/* Empilha no mobile (flex-col) para a sequência continuar legível de
                  cima para baixo: em flex-wrap os conectores caíam soltos no início
                  de uma linha e a fórmula deixava de se ler. */}
              <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap" aria-hidden>
                <PassoComposicao tone="blue" icon={<CalendarDays size={16} />} valor={c.previstos} titulo="Agendamentos previstos" />
                <Conector sinal="−" />
                <PassoComposicao tone="red" icon={<CalendarX2 size={16} />} valor={c.canceladas} titulo="Canceladas" nota="não exigem evolução" />
                {c.cedidas > 0 && (
                  <>
                    <Conector sinal="−" />
                    <PassoComposicao tone="gray" icon={<UserRoundMinus size={16} />} valor={c.cedidas} titulo="Substituídas por outro terapeuta" nota="não exigem evolução dele" />
                  </>
                )}
                <Conector sinal="=" />
                <PassoComposicao tone="gray" icon={<ClipboardList size={16} />} valor={c.validos} titulo="Agendamentos válidos" destaque />
                <Conector sinal="+" />
                <PassoComposicao
                  tone="purple"
                  icon={<Repeat2 size={16} />}
                  valor={c.substituicoes}
                  titulo="Substituições realizadas"
                  nota="assumidas de outro terapeuta"
                  alerta={emConferencia > 0 ? `${emConferencia} em conferência` : undefined}
                />
                <Conector sinal="=" />
                <PassoComposicao
                  tone="green"
                  icon={<Target size={16} />}
                  valor={c.esperadas}
                  titulo="Evoluções esperadas"
                  nota={`${c.validos} válidos + ${c.substituicoes} substituições`}
                  destaque
                />
              </div>
            </section>

            {/* Resultado da evolução */}
            <section className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border p-4 sm:flex-nowrap">
              <ResultadoNumero
                icon={<CheckCircle2 size={14} />}
                label="Com evolução"
                valor={c.comEvolucao}
                nota={`de ${c.esperadas} esperadas`}
                cor={toneColor("green")}
              />

              <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-6">
                <div className="text-[11px] font-semibold text-muted-foreground">Evolução</div>
                <div className="mt-1.5 flex items-center gap-3">
                  {/* Sem teto de largura: a barra ocupa toda a faixa entre "Com
                      evolução" e "Pendentes". flex-1 + min-w-0 (e não w-full) porque
                      o percentual é shrink-0 e precisa ser medido primeiro — com
                      w-full a barra reservava a faixa inteira e jogava o número
                      fora da tela em largura apertada. */}
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-muted">
                    <div
                      className="h-full w-full"
                      style={{
                        background: corPct,
                        clipPath: `inset(0 ${100 - larguraBarra}% 0 0)`,
                        transition: "clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-xl font-black tabular-nums leading-none" style={{ color: corPct }}>
                    {semEsperadas ? "—" : `${fmtPct(c.pct)}%`}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {semEsperadas
                    ? "Sem evoluções esperadas no período."
                    : `${c.comEvolucao} com evolução de ${c.esperadas} esperadas`}
                </div>
              </div>

              <ResultadoNumero
                divisor
                icon={<Clock size={14} />}
                label="Pendentes"
                valor={c.pendentes}
                nota={`de ${c.esperadas} esperadas`}
                cor={c.pendentes > 0 ? toneColor("amber") : toneColor("gray")}
              />

              {c.inconsistencias > 0 && (
                <ResultadoNumero
                  divisor
                  icon={<HelpCircle size={14} />}
                  label="Inconsistências"
                  valor={c.inconsistencias}
                  nota="para conferência"
                  cor={toneColor("red")}
                />
              )}
            </section>

            {/* Tabela única com filtros */}
            <section className="rounded-2xl border border-border">
              {/* Tira de abas em formato de planilha: a tira é levemente
                  tonalizada e a aba ativa, em bg-card, se emenda ao painel da
                  tabela — o -mb-px sobre a borda da tira é o que apaga a linha
                  embaixo da aba ativa e cria a emenda. */}
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-t-2xl border-b border-border bg-muted/30 px-2 pt-2">
                <div role="tablist" aria-label="Filtrar sessões" className="flex flex-1 flex-wrap items-end gap-1">
                  {abas.map(a => {
                    const ativa = a.id === abaAtiva?.id
                    // Ícone sempre no tom (é a identidade da aba); badge só
                    // colorido quando há o que contar — mesma regra do card, onde
                    // "0 inconsistências" em vermelho gritaria por um problema
                    // que não existe. É também o que distingue as duas abas
                    // vermelhas (Canceladas e Inconsistências) no caso comum.
                    const badge = a.sessoes.length > 0 ? TONE_CHIP[a.tone] : TONE_CHIP.gray
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="tab"
                        aria-selected={ativa}
                        onClick={() => { setAba(a.id); setPagina(1); setDetalhe(null) }}
                        className={`relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border px-3 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          ativa
                            ? "border-border border-b-transparent bg-card font-bold text-foreground"
                            : "border-transparent font-semibold text-muted-foreground hover:bg-card/60 hover:text-foreground"
                        }`}
                      >
                        {/* Acento no TOPO, não sublinhado embaixo: embaixo ele
                            cortaria justamente a emenda com o painel. */}
                        {ativa && (
                          <span
                            aria-hidden
                            className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg"
                            style={{ background: toneColor(a.tone) }}
                          />
                        )}
                        <span className={TONE_CHIP[a.tone].text}>{a.icon}</span>
                        {a.label}
                        <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${badge.bg} ${badge.text}`}>
                          {a.sessoes.length}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Campo, e não só um chip de remover: o filtro do modal existia
                    mas só podia ser herdado da página — dava para desligar, nunca
                    para ligar. */}
                <div className="relative mb-2 shrink-0">
                  <Search size={12} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={buscaLocal}
                    onChange={e => { setBuscaLocal(e.target.value); setPagina(1); setDetalhe(null) }}
                    placeholder="Buscar paciente, data…"
                    aria-label="Buscar nas sessões deste terapeuta"
                    className="w-48 rounded-full border border-border bg-card py-1 pr-2.5 pl-7 text-[11px] text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
                  />
                </div>
              </div>

              {nota && (
                <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">{nota}</p>
              )}

              {/* O que esta aba NÃO mostra. A contagem do badge continua igual ao
                  número da composição — é essa coerência que garante que aba e
                  conta nunca divirjam —, então a linha em conferência não entra
                  aqui: o que entra é o caminho até ela. */}
              {aba === "substituicoes" && emConferencia > 0 && (
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 text-xs ${TONE_PANEL.amber.bg}`}>
                  <span className={`shrink-0 ${TONE_CHIP.amber.text}`}><HelpCircle size={14} /></span>
                  <p className="min-w-0 flex-1 text-foreground/85">
                    {emConferencia === 1
                      ? "1 substituição está em conferência e não entra nesta conta"
                      : `${emConferencia} substituições estão em conferência e não entram nesta conta`}
                    : duas pessoas evoluíram o mesmo agendamento e a autoria precisa ser decidida.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setAba("inconsistencias"); setPagina(1); setDetalhe(null) }}
                    className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Ver em Inconsistências
                  </button>
                </div>
              )}

              {linhas.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {q ? `Nenhuma sessão encontrada para "${buscaLocal}" nesta aba.` : vazio}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    {/* min-w para o container rolar de lado em tela estreita em vez
                        de comprimir "Paciente" em três linhas por célula. */}
                    <table className="w-full min-w-215 text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Data</th>
                          <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Horário</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Paciente</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Especialidade</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Origem</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Paciente</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Evolução</th>
                          <th scope="col" className="w-10 px-2 py-2.5">
                            <span className="sr-only">Detalhes</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiveis.map((s, i) => {
                          const chave = chaveSessao(s, inicio + i)
                          const origem = origemDaSessao(s)
                          const situacao = situacaoDaSessao(s)
                          const evolucao = evolucaoDaSessao(s)
                          const aberto = detalhe === chave
                          return (
                            <Fragment key={chave}>
                              <tr className="border-t border-border/70 hover:bg-muted/40">
                                <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums text-foreground">{formatDateBR(s.data)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-foreground">{s.hora}</td>
                                <td className="px-3 py-2.5 text-foreground">{s.paciente || "—"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">{s.especialidade || "—"}</td>
                                <td className="px-3 py-2.5"><StatusChip tone={origem.tone} dense>{origem.texto}</StatusChip></td>
                                <td className="px-3 py-2.5"><StatusChip tone={situacao.tone} dense>{situacao.texto}</StatusChip></td>
                                <td className="px-3 py-2.5"><StatusChip tone={evolucao.tone} dense>{evolucao.texto}</StatusChip></td>
                                <td className="px-2 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => setDetalhe(aberto ? null : chave)}
                                    aria-expanded={aberto}
                                    aria-label={aberto ? "Ocultar detalhes da sessão" : "Ver detalhes da sessão"}
                                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                  >
                                    <ChevronDown size={14} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
                                  </button>
                                </td>
                              </tr>
                              {aberto && (
                                <tr className="border-t border-border/70 bg-muted/40">
                                  <td colSpan={8} className="px-3 py-3">
                                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                                      <CampoDetalhe rotulo="ID Agendamento" valor={s.id || "—"} />
                                      <CampoDetalhe rotulo="Prof. escalado" valor={s.profAgenda || "—"} />
                                      <CampoDetalhe rotulo="Evoluído por" valor={s.profCsv || "—"} />
                                      <CampoDetalhe rotulo="Presença recepção" valor={s.presencaOrbita || "—"} />
                                      <CampoDetalhe rotulo="Presença TiTa" valor={s.presencaTita || "—"} />
                                      <CampoDetalhe rotulo="Possui tratativa" valor={s.possuiTratativa || "—"} />
                                      <CampoDetalhe rotulo="Criação da tratativa" valor={s.criacaoTratativa || "—"} />
                                      <CampoDetalhe rotulo="Classificação" valor={s.classificacao || "—"} />
                                      {/* O "por quê" de "Evolução em conflito" e
                                          "Evolução duplicada": sem estes números a
                                          tela só nomeava o problema. */}
                                      {(s.tratativas > 1 || s.tratativasDistintas > 1) && (
                                        <CampoDetalhe
                                          rotulo="Evoluções neste agendamento"
                                          valor={`${s.tratativas} · de ${s.tratativasDistintas} ${s.tratativasDistintas === 1 ? "pessoa" : "pessoas"}`}
                                        />
                                      )}
                                      {bucketDaSessao(s) === "inconsistencia" && s.papel === "Substituição realizada" && (
                                        <CampoDetalhe
                                          rotulo="Efeito na conta"
                                          valor={
                                            <span className={TONE_CHIP.amber.text}>
                                              Fora das substituições até a autoria ser decidida.
                                            </span>
                                          }
                                        />
                                      )}
                                      <CampoDetalhe rotulo="Convênio" valor={s.convenio || "—"} />
                                      <CampoDetalhe rotulo="Unidade" valor={s.unidade || "—"} />
                                      {s.motivo && <CampoDetalhe rotulo="Motivo" valor={s.motivo} />}
                                    </dl>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Mostrando {inicio + 1} a {Math.min(inicio + POR_PAGINA, linhas.length)} de {linhas.length} registro(s)
                    </span>

                    {totalPaginas > 1 && (
                      <nav aria-label="Paginação das sessões" className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setPagina(paginaAtual - 1); setDetalhe(null) }}
                          disabled={paginaAtual === 1}
                          aria-label="Página anterior"
                          className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        {paginasVisiveis(paginaAtual, totalPaginas).map((n, i) =>
                          n === "…" ? (
                            <span key={`gap${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                          ) : (
                            <button
                              key={n}
                              type="button"
                              onClick={() => { setPagina(n); setDetalhe(null) }}
                              aria-current={n === paginaAtual ? "page" : undefined}
                              className={`flex size-7 items-center justify-center rounded-md text-xs font-semibold tabular-nums transition-colors ${
                                n === paginaAtual
                                  ? "bg-foreground text-background"
                                  : "border border-border text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {n}
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => { setPagina(paginaAtual + 1); setDetalhe(null) }}
                          disabled={paginaAtual === totalPaginas}
                          aria-label="Próxima página"
                          className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </nav>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
