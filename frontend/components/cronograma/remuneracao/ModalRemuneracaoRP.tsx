"use client"

// Modal de detalhamento por profissional da Rem. Mês - Total. Substitui a
// expansão inline do card (que empurrava a lista para baixo e escondia quatro
// tabelas dentro de accordions) por um workspace: a conta em cima, o resultado
// no meio, UMA tabela com abas embaixo.
//
// Nenhum número é calculado aqui. Tudo vem de composicaoRP()
// (lib/remuneracao/composicaoRP.ts), a mesma função que CardRemunRP usa — por
// construção as abas e a conta não podem divergir (§3.1 do padrão de
// detalhamento em modal, docs/padrao-detalhamento-modal.md).
//
// Os auxiliares de apresentação (PassoConta, Conector, CampoDetalhe,
// paginasVisiveis) repetem os de tratativas/ModalAnaliseTerapeuta.tsx de
// propósito: esta sprint tem escopo em /rp, então nada é extraído para um kit
// compartilhado ainda. Quando a terceira tela pedir o mesmo, é hora de extrair.

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Banknote, CalendarDays, CalendarX2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, Clock, ExternalLink, HelpCircle, ListFilter, Repeat2, Search, Sparkles, Sun, UserRoundMinus,
  Wallet, X,
} from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { fmt, isSim } from "@/lib/remuneracao/formatacao"
import { isCancelado } from "@/lib/remuneracao/rotulosExecucao"
import { formatDateBR } from "@/lib/remuneracao/datas"
import { bucketDaSessao, composicaoRP, corrigirTotalComPEP, type BucketSessao } from "@/lib/remuneracao/composicaoRP"
import type { ProfRemunReal, SessaoComPapel } from "@/lib/remuneracao/calculo"

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
// Origem, Situação e Remuneração são três eixos DIFERENTES, e é isso que a
// tabela precisa mostrar (§3.7): "Pendente retroativa" é uma sessão que
// aconteceu (presença Sim) e não gera pagamento — Situação "Realizado",
// Remuneração "Não paga". Colapsar os três numa coluna só é o que fazia a
// leitura antiga precisar de legenda.

function origemDaSessao(s: SessaoComPapel): { texto: string; tone: Tone } {
  return s.papel === "Substituição realizada"
    ? { texto: "Substituição", tone: "purple" }
    : { texto: "Agendamento", tone: "gray" }
}

function situacaoDaSessao(s: SessaoComPapel): { texto: string; tone: Tone } {
  const cls = s.classificacao ?? ""
  if (cls === "Feriado/Ponto Fac.") return { texto: "Feriado/Ponto Fac.", tone: "gray" }
  // Também lido do status, e não só da classificação: em "Cancelado evoluído" a
  // sessão foi cancelada e ainda assim tem evolução — dizer "Realizado" ali
  // esconderia exatamente a contradição que faz a linha ser inconsistente.
  if (cls === "Cancelado" || isCancelado(s.statusFinal) || isCancelado(s.statusCsv)) {
    return { texto: "Cancelado", tone: "red" }
  }
  if (isSim(s.presencaOrbita)) return { texto: "Realizado", tone: "green" }
  return { texto: "Sem presença", tone: "amber" }
}

/**
 * O terceiro eixo desta tela — o que a linha faz com o dinheiro. É o que
 * substitui a coluna "Evolução" da Análise de Evolução: lá a pergunta é "consta
 * evolução?", aqui é "isso vira pagamento?".
 */
function remuneracaoDaSessao(s: SessaoComPapel): { texto: string; tone: Tone } {
  const b = bucketDaSessao(s)
  if (b === "inconsistencia") return { texto: s.classificacao || "Inconsistência", tone: "red" }
  if (b === "pendente") return { texto: "Não paga — sem registro", tone: "amber" }
  if (b === "cancelada") return { texto: "Não exigida", tone: "gray" }
  if (b === "cedida") return { texto: "Paga a quem assumiu", tone: "gray" }
  // comEvolucao | substituicao: as duas únicas em que calculo.ts somou PA.
  if (s.valorPATexto) return { texto: s.valorPATexto, tone: "green" }
  const pa = s.valorPA ?? 0
  return pa > 0 ? { texto: fmt(pa), tone: "green" } : { texto: "Sem PA por sessão", tone: "gray" }
}

const chaveSessao = (s: SessaoComPapel, i: number) =>
  `${s.papel}|${s._idx ?? ""}|${s.id ?? ""}|${s.data ?? ""}|${s.hora ?? ""}|${i}`

// ─── A conta ─────────────────────────────────────────────────────────────────

/**
 * Um passo da fórmula. `destaque` (anel) marca os RESULTADOS — o que vem depois
 * de um "=" — e distingue "Base remunerável" de "Canceladas", que dividem o
 * mesmo cinza mas têm papéis opostos na conta.
 *
 * `alerta` é o que este bloco NÃO está contando: existe por causa da
 * substituição com autoria em conflito, em que o número honesto é 0 e sem dizer
 * "1 em conferência" o modal mostraria 0 substituições ao lado de uma linha com
 * Origem "Substituição" (§3.4).
 */
function PassoConta({ tone, icon, valor, titulo, nota, alerta, destaque = false, moeda = false }: {
  tone: Tone; icon: React.ReactNode; valor: React.ReactNode; titulo: string
  nota?: string; alerta?: string; destaque?: boolean; moeda?: boolean
}) {
  const painel = TONE_PANEL[tone]
  return (
    <div className={`flex w-full min-w-30 flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-center sm:flex-1 ${painel.bg} ${destaque ? `ring-1 ring-inset ${painel.ring}` : ""}`}>
      <span className={TONE_CHIP[tone].text}>{icon}</span>
      <div className={`font-black tabular-nums leading-none ${moeda ? "text-lg" : "text-2xl"} ${TONE_CHIP[tone].text}`}>
        {valor}
      </div>
      <div className="text-[11px] font-semibold leading-snug text-foreground/85">{titulo}</div>
      {nota && <div className="-mt-1 text-[10px] leading-snug text-muted-foreground">{nota}</div>}
      {alerta && (
        <div className={`-mt-1 text-[10px] font-semibold leading-snug ${TONE_CHIP.amber.text}`}>{alerta}</div>
      )}
    </div>
  )
}

/**
 * Zero não tem cor (§3.5). Um "R$ 0,00" em âmbar no bloco do Bônus ETA grita por
 * um problema que não existe — a maioria dos profissionais simplesmente não tem
 * essa parcela. O tom volta assim que há valor.
 */
const tomDoValor = (valor: number, tone: Tone): Tone => (valor > 0 ? tone : "gray")

function Conector({ sinal }: { sinal: "−" | "+" | "=" }) {
  return (
    <span aria-hidden className="shrink-0 self-center px-0.5 text-lg font-medium text-muted-foreground/60">
      {sinal}
    </span>
  )
}

function ResultadoNumero({ icon, label, valor, nota, cor, divisor = false }: {
  icon: React.ReactNode; label: string; valor: React.ReactNode; nota: string; cor: string; divisor?: boolean
}) {
  // A divisória é responsiva de propósito: empilhado no mobile, uma borda
  // esquerda solta ficaria pendurada no meio do nada.
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

type AbaId = "todos" | "remuneradas" | "substituicoes" | "pendentes" | "canceladas" | "cedidas" | "inconsistencias"

/** Bucket de bucketDaSessao → aba deste modal, para o link "abrir a sessão X" achar a aba certa. */
const BUCKET_PARA_ABA: Record<BucketSessao, AbaId> = {
  comEvolucao: "remuneradas",
  substituicao: "substituicoes",
  pendente: "pendentes",
  cancelada: "canceladas",
  cedida: "cedidas",
  inconsistencia: "inconsistencias",
}

interface Props {
  p: ProfRemunReal | null
  periodo: { de: string; ate: string } | null
  /**
   * PEP apurada em pep_apuracao_mensal (aba Entregas PEP). É uma leitura de
   * OUTRA apuração: não entra em `valorConfirmado` e não é parcela desta conta —
   * aparece como nota, nunca como bloco da fórmula.
   */
  pepResumo?: { potencial: number; alcancado: number } | null
  /**
   * ID de uma sessão a abrir direto — de um link de outra tela (ex.: causa de
   * diferença na Visão Geral Individual). O modal acha a aba dela, a página
   * onde cai e já expande a linha, em vez de abrir em "Todos" na página 1 e
   * deixar quem clicou procurar entre até 7 abas.
   */
  focoSessaoId?: string | null
  onClose: () => void
}

export function ModalRemuneracaoRP({ p, periodo, pepResumo, focoSessaoId, onClose }: Props) {
  const toneColor = useToneColor()

  // Precisa vir antes dos useState de aba/página/detalhe: os três nascem
  // direto no lugar certo quando há foco, sem efeito de "pular depois".
  const c = useMemo(() => (p ? composicaoRP(p) : null), [p])

  const foco = useMemo(() => {
    if (!c || !focoSessaoId) return null
    for (const bucket of Object.keys(BUCKET_PARA_ABA) as BucketSessao[]) {
      const idx = c.porBucket[bucket].findIndex(s => s.id === focoSessaoId)
      if (idx < 0) continue
      return {
        aba: BUCKET_PARA_ABA[bucket],
        pagina: Math.floor(idx / POR_PAGINA) + 1,
        chave: chaveSessao(c.porBucket[bucket][idx], idx),
      }
    }
    return null
  }, [c, focoSessaoId])

  const [aba, setAba] = useState<AbaId>(() => foco?.aba ?? "todos")
  const [pagina, setPagina] = useState(() => foco?.pagina ?? 1)
  const [detalhe, setDetalhe] = useState<string | null>(() => foco?.chave ?? null)
  // Busca própria do modal, sempre vazia ao abrir. A busca da página escolhe
  // QUEM aparece na lista; aqui a mesma string esconderia o resto do mês desta
  // pessoa — são perguntas diferentes (§3.11). O card antigo recebia `remBusca`
  // e ainda abria forçado por causa dela.
  const [buscaLocal, setBuscaLocal] = useState("")

  // Nada de efeito para resetar aba/página ao trocar de profissional: quem monta
  // remonta por `key={prof}` (ver RemunRPTab), então este estado já nasce limpo
  // (com foco, nasce direto na sessão; sem foco, no de sempre).

  // Rola até a linha em foco depois do primeiro paint — ela já nasce expandida
  // (detalhe = foco.chave), só falta trazê-la pra tela em vez de deixar quem
  // abriu o link precisar rolar a tabela sozinho.
  const focoRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (foco) focoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na entrada; foco não muda depois do mount (não há setFoco)
  }, [])

  const especialidades = useMemo(() => {
    if (!p) return []
    const contagem = new Map<string, number>()
    for (const s of p.sessoes) {
      const e = s.especialidade || "Sem especialidade"
      contagem.set(e, (contagem.get(e) ?? 0) + 1)
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e)
  }, [p])

  // As abas são uma PARTIÇÃO: cada registro em exatamente uma, e a soma delas
  // fecha com "Todos". Os quatro blocos do card antigo não eram — "Evolução
  // duplicada" e "Evolução em conflito" no papel Agenda não caíam em bloco
  // nenhum e sumiam da tela, sem nenhuma aba "Todos" para alcançá-las.
  //
  // O tom de cada aba é o MESMO que o conceito já tem no card da lista e na
  // conta — a aba não introduz cor nova. "Todos" fica azul (e não verde) para o
  // verde continuar significando só uma coisa nesta tela: sessão remunerada.
  const abas = useMemo(() => {
    if (!c) return []
    const lista: { id: AbaId; label: string; icon: React.ReactNode; tone: Tone; sessoes: SessaoComPapel[] }[] = [
      { id: "todos",         label: "Todos",         icon: <ListFilter size={13} />,   tone: "blue",   sessoes: c.todas },
      { id: "remuneradas",   label: "Remuneradas",   icon: <CheckCircle2 size={13} />, tone: "green",  sessoes: c.porBucket.comEvolucao },
      { id: "substituicoes", label: "Substituições", icon: <Repeat2 size={13} />,      tone: "purple", sessoes: c.porBucket.substituicao },
      { id: "pendentes",     label: "Sem registro",  icon: <Clock size={13} />,        tone: "amber",  sessoes: c.porBucket.pendente },
      { id: "canceladas",    label: "Canceladas",    icon: <CalendarX2 size={13} />,   tone: "red",    sessoes: c.porBucket.cancelada },
    ]
    // Cedidas ganham aba só quando existem: é um filtro útil quando há o que
    // filtrar, e uma aba permanentemente vazia quando não há. As linhas seguem
    // alcançáveis em "Todos" de qualquer jeito.
    if (c.cedidas > 0) {
      lista.push({ id: "cedidas", label: "Cedidas a outro", icon: <UserRoundMinus size={13} />, tone: "gray", sessoes: c.porBucket.cedida })
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

  const isCC = p.sessoes.some(s => s.especialidade === "Coordenador de Caso")
  const pep = corrigirTotalComPEP(c, isCC, pepResumo ?? undefined)

  const corPct = toneColor(c.baseRemuneravel === 0 ? "gray" : c.pct >= 80 ? "green" : c.pct >= 50 ? "amber" : "red")
  const larguraBarra = Math.max(0, Math.min(100, c.pct))
  const semBase = c.baseRemuneravel === 0
  const emConferencia = c.substituicoesEmConferencia

  const nota = {
    todos: "Todos os registros do período, inclusive os que não geram pagamento — a coluna Remuneração diz, linha por linha, o que vira R$ e o que não.",
    // As duas notas abaixo dizem a mesma soma dos dois lados: é o que liga as
    // duas abas ao número único "Remuneradas" da faixa de resultado.
    remuneradas: c.substituicoes > 0
      ? `Sessões da própria agenda com evolução registrada. Somadas às ${c.substituicoes} substituições assumidas, dão as ${c.remuneradas} remuneradas do resultado acima.`
      : "Sessões da própria agenda com evolução registrada.",
    substituicoes: `Sessões assumidas de outro profissional — quem registrou a evolução recebe, e é por isso que somam à base remunerável.${
      c.substituicoes > 0 ? ` Com as ${c.porBucket.comEvolucao.length} da própria agenda, dão as ${c.remuneradas} remuneradas do resultado acima.` : ""
    }`,
    pendentes: "A sessão aconteceu (ou não foi cancelada) e segue sem registro de evolução: está na base e não gera pagamento. Verifique a Presença Recep. linha a linha.",
    canceladas: "Sessões canceladas (inclui feriado e ponto facultativo). Não aconteceram, então saem da base — não há atendimento a pagar.",
    cedidas: "Estavam na agenda deste profissional, mas outro assumiu e registrou a evolução: o pagamento é de quem assumiu, e a sessão sai da base deste.",
    inconsistencias: "Presença da recepção e evolução registrada se contradizem, ou a autoria está em dúvida. Confirme antes de pagar. Linha com Origem “Substituição” aqui não credita substituição a este profissional até a autoria ser decidida.",
  }[aba]

  const vazio = {
    todos: "Nenhum registro deste profissional no período.",
    remuneradas: "Nenhuma sessão remunerada da própria agenda no período.",
    substituicoes: "Nenhuma substituição assumida no período.",
    pendentes: "Nenhum registro pendente — todas as sessões da base foram evoluídas.",
    canceladas: "Nenhuma sessão cancelada no período.",
    cedidas: "Nenhuma sessão cedida a outro profissional no período.",
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
            Empilhado no mobile: em uma única linha o nome disputaria largura com
            o período e quebraria letra a letra. */}
        <header className="flex flex-col gap-3 border-b border-border px-5 py-4 md:px-6 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
          <div className="flex min-w-0 items-start gap-3 lg:flex-1 lg:items-center">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-black ${TONE_CHIP.green.bg} ${TONE_CHIP.green.text}`}>
              {iniciaisDe(p.prof)}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold wrap-break-word text-foreground">{p.prof}</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground wrap-break-word">
                {especialidades.length > 0 ? especialidades.slice(0, 2).join(" · ") : "Sem especialidade"}
                {especialidades.length > 2 && ` +${especialidades.length - 2}`}
              </p>
              {c.emBancoDeHoras && (
                <div className="mt-1.5">
                  <StatusChip tone={c.fixoNaoCadastrado ? "red" : "amber"} dense>
                    <Wallet size={11} aria-hidden />
                    {c.fixoNaoCadastrado
                      ? "Banco de horas sem valor cadastrado"
                      : c.soFixo ? "Banco de horas" : "Banco de horas + PA"}
                  </StatusChip>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {periodo && (
              <div className="shrink-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <CalendarDays size={12} />
                  Período da grade
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {formatDateBR(periodo.de)} a {formatDateBR(periodo.ate)}
                </div>
              </div>
            )}

            <div className="shrink-0 border-border sm:border-l sm:pl-6">
              <div className="text-[11px] font-semibold text-muted-foreground">A pagar</div>
              <div className="text-3xl font-black tabular-nums leading-none" style={{ color: toneColor(tomDoValor(pep.valorTotalAPagar, "green")) }}>
                {fmt(pep.valorTotalAPagar)}
              </div>
            </div>
          </div>

          {/* Absoluto no mobile para não empurrar o nome; volta ao fluxo no lg. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhamento"
            className="absolute top-3 right-3 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:static lg:ml-auto"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── Corpo — rola só aqui ──────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-5 md:px-6">
          <div className="space-y-4">

            {/* ── A conta, trilho 1: a base de sessões ──────────────────── */}
            <section className="rounded-2xl border border-border p-4">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-foreground">Composição da base remunerável</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Canceladas e cedidas saem da conta; substituições assumidas entram nela.
                </p>
              </div>

              <p className="sr-only">
                {c.agendadas} agendamentos menos {c.canceladas} sessões canceladas
                {c.cedidas > 0 && ` menos ${c.cedidas} sessões cedidas a outro profissional`}
                {" "}resultam em {c.validas} sessões válidas; somadas a {c.substituicoes} substituições
                realizadas, {c.baseRemuneravel} sessões na base remunerável.
                {emConferencia > 0 && ` Outras ${emConferencia} substituições estão em conferência e ficam fora desta conta.`}
              </p>

              {/* Empilha no mobile (flex-col) para a sequência continuar legível
                  de cima para baixo: em flex-wrap os conectores caem soltos no
                  início de uma linha e a fórmula deixa de se ler. */}
              <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap" aria-hidden>
                <PassoConta tone="blue" icon={<CalendarDays size={16} />} valor={c.agendadas} titulo="Agendamentos" />
                <Conector sinal="−" />
                <PassoConta tone="red" icon={<CalendarX2 size={16} />} valor={c.canceladas} titulo="Canceladas" nota="não aconteceram" />
                {c.cedidas > 0 && (
                  <>
                    <Conector sinal="−" />
                    <PassoConta tone="gray" icon={<UserRoundMinus size={16} />} valor={c.cedidas} titulo="Cedidas a outro" nota="paga quem assumiu" />
                  </>
                )}
                <Conector sinal="=" />
                <PassoConta tone="gray" icon={<ClipboardList size={16} />} valor={c.validas} titulo="Sessões válidas" destaque />
                <Conector sinal="+" />
                <PassoConta
                  tone="purple"
                  icon={<Repeat2 size={16} />}
                  valor={c.substituicoes}
                  titulo="Substituições realizadas"
                  nota="assumidas de outro"
                  alerta={emConferencia > 0 ? `${emConferencia} em conferência` : undefined}
                />
                <Conector sinal="=" />
                <PassoConta
                  tone="green"
                  icon={<CheckCircle2 size={16} />}
                  valor={c.baseRemuneravel}
                  titulo="Base remunerável"
                  nota={`${c.validas} válidas + ${c.substituicoes} substituições`}
                  destaque
                />
              </div>
            </section>

            {/* ── A conta, trilho 2: o valor ────────────────────────────── */}
            <section className="rounded-2xl border border-border p-4">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-foreground">Composição do valor</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.soFixo
                    ? "Contrato de banco de horas: o valor fixo é a remuneração inteira — PA por sessão, PPD, bônus ETA e PE não se somam por cima."
                    : "Parcelas apuradas no período, como saem do cálculo da remuneração."}
                </p>
              </div>

              <p className="sr-only">
                {c.soFixo
                  ? `Valor fixo de banco de horas de ${fmt(c.valorFixoBancoHoras)}, total a pagar ${fmt(pep.valorTotalAPagar)}.`
                  : `PA de ${fmt(c.valorPA)} mais PPD de ${fmt(c.ppd)} mais bônus ETA de ${fmt(c.bonusEta)} mais PEP de ${isCC && !pep.pepApurada ? "ainda não apurada" : fmt(pep.pepValor)} resultam em ${fmt(pep.valorConfirmado)} confirmados${
                      c.valorFixoBancoHoras > 0 ? `; somados ao valor fixo de ${fmt(c.valorFixoBancoHoras)}` : ""
                    }, total a pagar ${fmt(pep.valorTotalAPagar)}.`}
              </p>

              <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap" aria-hidden>
                {!c.soFixo && (
                  <>
                    {c.paPorContrato.length > 1 ? (
                      <>
                        {c.paPorContrato.map((item, i) => (
                          <Fragment key={item.label}>
                            {i > 0 && <Conector sinal="+" />}
                            <PassoConta moeda tone={tomDoValor(item.total, "blue")} icon={<Banknote size={16} />}
                              valor={fmt(item.total)} titulo={item.label} nota={`${item.count}×${fmt(item.rate)}`} />
                          </Fragment>
                        ))}
                        <Conector sinal="=" />
                        <PassoConta moeda tone={tomDoValor(c.valorPA, "green")} icon={<Wallet size={16} />} valor={fmt(c.valorPA)} titulo="PA total" />
                      </>
                    ) : (
                      <PassoConta moeda tone={tomDoValor(c.valorPA, "green")} icon={<Banknote size={16} />} valor={fmt(c.valorPA)} titulo="PA por sessão"
                        nota={`${c.remuneradas} ${c.remuneradas === 1 ? "sessão remunerada" : "sessões remuneradas"}`} />
                    )}
                    {(c.ppd > 0 || c.bonusEta > 0) && (
                      <>
                        <Conector sinal="+" />
                        <PassoConta moeda tone={tomDoValor(c.ppd, "blue")} icon={<Sun size={16} />} valor={fmt(c.ppd)} titulo="PPD" nota="diária por período" />
                        <Conector sinal="+" />
                        <PassoConta moeda tone={tomDoValor(c.bonusEta, "amber")} icon={<Sparkles size={16} />} valor={fmt(c.bonusEta)} titulo="Bônus ETA"
                          nota={p.etaWeeksPeriodo > 0 ? `${p.etaWeeksPeriodo} ${p.etaWeeksPeriodo === 1 ? "semana" : "semanas"}` : undefined} />
                      </>
                    )}
                    <Conector sinal="+" />
                    <PassoConta
                      moeda
                      tone={isCC && !pep.pepApurada ? "amber" : tomDoValor(pep.pepValor, "purple")}
                      icon={<ClipboardList size={16} />}
                      valor={isCC && !pep.pepApurada ? "—" : fmt(pep.pepValor)}
                      titulo="PEP"
                      alerta={isCC && !pep.pepApurada ? "ainda não apurada" : undefined}
                    />
                    <Conector sinal="=" />
                    {/* Sem valor fixo, "Confirmado" e "Total a pagar" são o MESMO
                        número — então usa-se o nome do cabeçalho, e não dois
                        rótulos para uma quantidade só (§3.2). */}
                    <PassoConta
                      moeda destaque
                      tone={tomDoValor(pep.valorConfirmado, "green")}
                      icon={<Wallet size={16} />}
                      valor={fmt(pep.valorConfirmado)}
                      titulo={c.valorFixoBancoHoras > 0 ? "Confirmado" : "Total a pagar"}
                    />
                  </>
                )}
                {(c.soFixo || c.valorFixoBancoHoras > 0) && (
                  <>
                    {!c.soFixo && <Conector sinal="+" />}
                    <PassoConta
                      moeda
                      tone={c.fixoNaoCadastrado ? "red" : tomDoValor(c.valorFixoBancoHoras, "amber")}
                      icon={<Wallet size={16} />}
                      valor={fmt(c.valorFixoBancoHoras)}
                      titulo="Fixo de banco de horas"
                      nota={p.numerosBancoHoras.length > 0 ? p.numerosBancoHoras.join(" / ") : undefined}
                      alerta={c.fixoNaoCadastrado ? "sem valor cadastrado" : undefined}
                    />
                    <Conector sinal="=" />
                    <PassoConta moeda destaque tone={tomDoValor(pep.valorTotalAPagar, "green")} icon={<Banknote size={16} />} valor={fmt(pep.valorTotalAPagar)} titulo="Total a pagar" />
                  </>
                )}
              </div>

              {/* O que a conta NÃO está dizendo, dito (§3.4). */}
              {c.paDivergente && (
                <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${TONE_PANEL.amber.bg} ${TONE_CHIP.amber.text}`}>
                  As parcelas somam {fmt(c.valorPA + c.ppd + c.bonusEta + c.pe)} e o cálculo confirmou{" "}
                  {fmt(c.valorConfirmado)}. A diferença vem de sessões que somaram valor fora dos dois
                  grupos remunerados — confira antes de pagar.
                </p>
              )}
              {c.fixoNaoCadastrado && (
                <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${TONE_PANEL.red.bg} ${TONE_CHIP.red.text}`}>
                  {`O contrato ${p.numerosBancoHoras.join(" / ") || "vigente"} está marcado como banco de horas, mas sem valor total em Cadastros › Contratos. O PA por sessão foi zerado e não há valor fixo para pagar no lugar — é pendência de cadastro, não R$ 0.`}
                </p>
              )}
              {isCC && periodo && (
                <div className="mt-3">
                  <Link
                    href={`/relacionamento-prestador/pep/?competencia=${periodo.de.slice(0, 7)}&prestador=${encodeURIComponent(p.prof)}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium ${TONE_CHIP.purple.text} hover:bg-muted/50`}
                  >
                    <ExternalLink size={12} aria-hidden />
                    Abrir Entregas PEP
                    <span className="sr-only">(abre em outra aba, já na competência e no Analista deste modal)</span>
                  </Link>
                </div>
              )}
            </section>

            {/* ── Resultado ─────────────────────────────────────────────── */}
            <section className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border p-4 sm:flex-nowrap">
              <ResultadoNumero
                icon={<CheckCircle2 size={14} />}
                label="Remuneradas"
                valor={c.remuneradas}
                nota={`de ${c.baseRemuneravel} da base`}
                cor={toneColor(c.remuneradas > 0 ? "green" : "gray")}
              />

              <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-6">
                <div className="text-[11px] font-semibold text-muted-foreground">Cobertura da base</div>
                <div className="mt-1.5 flex items-center gap-3">
                  {/* flex-1 + min-w-0 e não w-full: o percentual é shrink-0 e
                      precisa ser medido primeiro, senão a barra reserva a faixa
                      toda e joga o número fora da tela em largura apertada. */}
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
                    {semBase ? "—" : `${fmtPct(c.pct)}%`}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {semBase
                    ? "Sem sessões na base remunerável no período."
                    : `${c.remuneradas} remuneradas de ${c.baseRemuneravel} da base`}
                </div>
              </div>

              <ResultadoNumero
                divisor
                icon={<Clock size={14} />}
                label="Sem registro"
                valor={c.pendentes}
                nota={`de ${c.baseRemuneravel} da base`}
                cor={toneColor(c.pendentes > 0 ? "amber" : "gray")}
              />

              {c.inconsistencias > 0 && (
                <ResultadoNumero
                  divisor
                  icon={<HelpCircle size={14} />}
                  label="Inconsistências"
                  valor={c.inconsistencias}
                  nota="confirme antes de pagar"
                  cor={toneColor("red")}
                />
              )}
            </section>

            {/* ── Tabela única com abas ─────────────────────────────────── */}
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
                    // colorido quando há o que contar — é também o que distingue
                    // as duas abas vermelhas (Canceladas e Inconsistências) no
                    // caso comum.
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

                <div className="relative mb-2 shrink-0">
                  <Search size={12} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={buscaLocal}
                    onChange={e => { setBuscaLocal(e.target.value); setPagina(1); setDetalhe(null) }}
                    placeholder="Buscar paciente, data…"
                    aria-label="Buscar nas sessões deste profissional"
                    className="w-48 rounded-full border border-border bg-card py-1 pr-2.5 pl-7 text-[11px] text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
                  />
                </div>
              </div>

              {nota && (
                <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">{nota}</p>
              )}

              {/* O que esta aba NÃO mostra. A contagem do badge continua igual ao
                  número da conta — é essa coerência que garante que aba e conta
                  nunca divirjam —, então a linha em conferência não entra aqui:
                  o que entra é o caminho até ela. */}
              {aba === "substituicoes" && emConferencia > 0 && (
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 text-xs ${TONE_PANEL.amber.bg}`}>
                  <span className={`shrink-0 ${TONE_CHIP.amber.text}`}><HelpCircle size={14} /></span>
                  <p className="min-w-0 flex-1 text-foreground/85">
                    {emConferencia === 1
                      ? "1 substituição está em conferência e não entra nesta conta"
                      : `${emConferencia} substituições estão em conferência e não entram nesta conta`}
                    : duas pessoas evoluíram o mesmo agendamento e a autoria precisa ser decidida antes de pagar.
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
                    {/* min-w para o container rolar de lado em tela estreita em
                        vez de comprimir "Paciente" em três linhas por célula. */}
                    <table className="w-full min-w-215 text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Data</th>
                          <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Horário</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Paciente</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Especialidade</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Origem</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Situação</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Remuneração</th>
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
                          const remuneracao = remuneracaoDaSessao(s)
                          const aberto = detalhe === chave
                          const emFoco = foco?.chave === chave
                          return (
                            // O par de <tr> precisa de Fragment com key: <> com
                            // keys nos filhos dispara warning do React.
                            <Fragment key={chave}>
                              <tr
                                ref={emFoco ? focoRef : undefined}
                                className={`border-t border-border/70 hover:bg-muted/40 ${emFoco ? TONE_PANEL.amber.bg : ""}`}
                              >
                                <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums text-foreground">{formatDateBR(s.data)}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-foreground">{s.hora}</td>
                                <td className="px-3 py-2.5 text-foreground">{s.paciente || "—"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">{s.especialidade || "—"}</td>
                                <td className="px-3 py-2.5"><StatusChip tone={origem.tone} dense>{origem.texto}</StatusChip></td>
                                <td className="px-3 py-2.5"><StatusChip tone={situacao.tone} dense>{situacao.texto}</StatusChip></td>
                                <td className="px-3 py-2.5"><StatusChip tone={remuneracao.tone} dense>{remuneracao.texto}</StatusChip></td>
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
                                // Ruído técnico vive aqui, não na tabela principal (§3.8).
                                <tr className="border-t border-border/70 bg-muted/40">
                                  <td colSpan={8} className="px-3 py-3">
                                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                                      <CampoDetalhe rotulo="ID Agendamento" valor={s.id || "—"} />
                                      <CampoDetalhe rotulo="Prof. escalado" valor={s.profAgenda || "—"} />
                                      <CampoDetalhe rotulo="Evoluído por" valor={s.profCsv || "—"} />
                                      <CampoDetalhe rotulo="Presença recepção" valor={s.presencaOrbita || "—"} />
                                      <CampoDetalhe rotulo="Presença TiTa" valor={s.presencaTita || "—"} />
                                      <CampoDetalhe rotulo="Possui tratativa" valor={s.possuiTratativa || "—"} />
                                      <CampoDetalhe rotulo="Classificação" valor={s.classificacao || "—"} />
                                      {s.funcaoPA && <CampoDetalhe rotulo="Função do PA" valor={s.funcaoPA} />}
                                      {s.contratoAtualPA && <CampoDetalhe rotulo="Contrato do PA" valor={s.contratoAtualPA} />}
                                      {s.explicacaoPA && <CampoDetalhe rotulo="Como o PA foi definido" valor={s.explicacaoPA} />}
                                      {s.cadastroContratoPendente && (
                                        <CampoDetalhe
                                          rotulo="Cadastro"
                                          valor={<span className={TONE_CHIP.amber.text}>Contrato pendente de cadastro.</span>}
                                        />
                                      )}
                                      {/* O "por quê" da inconsistência de autoria: sem
                                          isto a tela só nomeava o problema. */}
                                      {bucketDaSessao(s) === "inconsistencia" && s.papel === "Substituição realizada" && (
                                        <CampoDetalhe
                                          rotulo="Efeito na conta"
                                          valor={
                                            <span className={TONE_CHIP.amber.text}>
                                              Fora das substituições — ninguém recebe até a autoria ser decidida.
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
