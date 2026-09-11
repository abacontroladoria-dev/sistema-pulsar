"use client"

// Modal de detalhamento por Coordenador de Caso do "PDI — Painel por Analista".
// Segue o padrão de detalhamento em modal (docs/padrao-detalhamento-modal.md),
// o mesmo de ModalRemuneracaoRP.tsx (/rp): workspace largo, o número que trouxe
// a pessoa até aqui no cabeçalho, a faixa de resultado no meio, UMA tabela com
// abas embaixo.
//
// Substitui a versão anterior — um ScheduleModal de 520px com quatro listas
// empilhadas de nome + prazo. Dois problemas que esta reescrita resolve:
//
// 1. A conta sumia na entrada. Quem clica numa linha da lista de prioridade vem
//    atrás de um número (atrasados); ao abrir, esse número só existia entre
//    parênteses num cabeçalho de grupo, do mesmo tamanho dos outros três.
// 2. Quatro listas não são uma partição visível: não dava para buscar, filtrar
//    nem comparar. Aqui as MESMAS quatro categorias viram abas de uma tabela
//    só, com "Todos" por cima — e o badge de cada aba repete o número da faixa
//    de resultado, que é o que garante que aba e conta nunca divirjam (§3.1).
//
// O que NÃO foi trazido do RP: os blocos `PassoConta`/`Conector` da
// "composição". Lá existe uma fórmula real (agendadas − canceladas +
// substituições = base remunerável). Aqui os quatro status são uma PARTIÇÃO, não
// uma conta: não há o que somar nem subtrair, e uma fila de caixinhas ligadas
// por "−" e "=" seria a forma do RP sem o conteúdo que a justifica.
//
// Cor: `TONE_CHIP`/`TONE_PANEL` de components/ui/tones, o mapa canônico do
// padrão, com o mapeamento direto dos status desta tela (Atrasado → red,
// Próximo do prazo → amber, Aguardando Implementação → blue, Dentro do prazo →
// green). O modal não introduz cor nova nem destoa da lista atrás.
//
// Nenhum número é calculado aqui: tudo é contagem sobre os `itens` que o
// chamador já filtrou, e todo campo de linha vem pronto do `ItemPdi`.

import { Fragment, useMemo, useState } from "react"
import {
  AlertOctagon, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, ClockAlert,
  Hourglass, ListFilter, Search, Users, X,
} from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { StatusChip, TONE_CHIP } from "@/components/ui/tones"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { norm, type ItemPdi } from "@/lib/pdi/filtros"
import { DIAS_ALERTA_PRAZO, type StatusPdi } from "@/lib/pdi/status"

const POR_PAGINA = 15

/** `norm` de lib/pdi/filtros, aceitando também número (o id do paciente). */
const normKey = (v: unknown): string => norm(String(v ?? ""))

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  const primeira = partes[0][0] ?? ""
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : ""
  return (primeira + ultima).toUpperCase()
}

/** dd/mm/aaaa a partir do ISO que vem do banco; "—" quando não há data. */
function dataBR(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "—"
}

// ─── Os quatro status, com tom e ícone ───────────────────────────────────────
// Ordem deliberada: a mesma da urgência, para a tira de abas se ler da esquerda
// (o que pega fogo) para a direita (o que está resolvido).

const STATUS_INFO: Record<StatusPdi, { rotulo: string; tone: Tone; icone: typeof AlertOctagon }> = {
  "Atrasado": { rotulo: "Atrasados", tone: "red", icone: AlertOctagon },
  "Próximo do prazo": { rotulo: "Próximo do prazo", tone: "amber", icone: ClockAlert },
  "Aguardando Implementação": { rotulo: "Aguardando Implementação", tone: "blue", icone: Hourglass },
  "Dentro do prazo": { rotulo: "Dentro do prazo", tone: "green", icone: CircleCheck },
}

const ORDEM_STATUS: StatusPdi[] = [
  "Atrasado",
  "Próximo do prazo",
  "Aguardando Implementação",
  "Dentro do prazo",
]

/**
 * A MAGNITUDE do prazo — o que decide quem é chamado primeiro. Herdado da versão
 * anterior deste modal, onde já substituía o `ID {pacienteId}` que ocupava esta
 * posição: ninguém cobra um PDI por id interno. `diasRestantes` e
 * `prazoFechamento` já vêm prontos no `ItemPdi`.
 */
function prazoDoItem(item: ItemPdi): string {
  const dias = item.diasRestantes
  if (dias !== null) {
    if (dias < 0) return `${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"} de atraso`
    if (dias === 0) return "vence hoje"
    if (dias <= 15) return `faltam ${dias} ${dias === 1 ? "dia" : "dias"}`
  }
  if (!item.prazoFechamento) return "sem prazo"
  const [, mes, dia] = item.prazoFechamento.slice(0, 10).split("-")
  return mes && dia ? `vence ${dia}/${mes}` : "sem prazo"
}

/**
 * Por URGÊNCIA, não por nome: dentro de "Atrasados" o que interessa é quem está
 * atrasado há mais tempo. Quem não tem `diasRestantes` (Aguardando
 * Implementação) cai no fim, em ordem alfabética. Regra preservada da versão
 * anterior — o que mudou foi só a moldura em volta.
 */
function porUrgencia(a: ItemPdi, b: ItemPdi): number {
  if (a.diasRestantes === null && b.diasRestantes === null) {
    return a.nome.localeCompare(b.nome, "pt-BR")
  }
  if (a.diasRestantes === null) return 1
  if (b.diasRestantes === null) return -1
  if (a.diasRestantes !== b.diasRestantes) return a.diasRestantes - b.diasRestantes
  return a.nome.localeCompare(b.nome, "pt-BR")
}

// ─── Auxiliares de apresentação ──────────────────────────────────────────────
// Repetem os de ModalRemuneracaoRP.tsx de propósito: esta tela é a segunda a
// usar o padrão fora de /rp, e o próprio RP registra que a extração para um kit
// compartilhado espera a terceira. Quando ela vier, é aqui e lá que se mexe.

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

function CampoDetalhe({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{rotulo}</dt>
      <dd className="mt-0.5 text-xs text-foreground wrap-break-word">{valor}</dd>
    </div>
  )
}

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

type AbaId = "todos" | StatusPdi

export function AnalistaDetalheModal({
  analistaNome,
  itens,
  onFechar,
  onAbrirPaciente,
}: {
  analistaNome: string
  /** Já filtrados pelo chamador — os pacientes deste analista (ou "Sem Coordenador de Caso"). */
  itens: ItemPdi[]
  onFechar: () => void
  onAbrirPaciente: (item: ItemPdi) => void
}) {
  const toneColor = useToneColor()
  const [aba, setAba] = useState<AbaId>("todos")
  const [pagina, setPagina] = useState(1)
  const [detalhe, setDetalhe] = useState<number | null>(null)
  // Busca própria do modal, sempre vazia ao abrir. A busca da página escolhe
  // QUAL coordenador aparece na lista; aqui a mesma string esconderia parte dos
  // pacientes desta pessoa — são perguntas diferentes (§3.11).
  const [buscaLocal, setBuscaLocal] = useState("")

  const porStatus = useMemo(() => {
    const mapa = new Map<StatusPdi, ItemPdi[]>(ORDEM_STATUS.map(s => [s, []]))
    for (const item of itens) mapa.get(item.status)?.push(item)
    for (const lista of mapa.values()) lista.sort(porUrgencia)
    return mapa
  }, [itens])

  const todosOrdenados = useMemo(() => [...itens].sort(porUrgencia), [itens])

  // As abas são uma PARTIÇÃO: cada paciente em exatamente uma, e a soma delas
  // fecha com "Todos". "Todos" fica cinza (e não verde) para o verde continuar
  // significando uma coisa só nesta tela: PDI dentro do prazo.
  const abas = useMemo(() => {
    const lista: { id: AbaId; label: string; icon: React.ReactNode; tone: Tone; itens: ItemPdi[] }[] = [
      { id: "todos", label: "Todos", icon: <ListFilter size={13} />, tone: "gray", itens: todosOrdenados },
    ]
    for (const status of ORDEM_STATUS) {
      const info = STATUS_INFO[status]
      const Icone = info.icone
      lista.push({
        id: status,
        label: info.rotulo,
        icon: <Icone size={13} />,
        tone: info.tone,
        itens: porStatus.get(status) ?? [],
      })
    }
    return lista
  }, [todosOrdenados, porStatus])

  const abaAtiva = abas.find(a => a.id === aba) ?? abas[0]

  const q = normKey(buscaLocal)
  const linhas = useMemo(() => {
    const base = abaAtiva?.itens ?? []
    if (!q) return base
    return base.filter(i =>
      normKey(`${i.nome} ${i.pacienteId} ${i.aplicadores.map(a => a.nome).join(" ")}`).includes(q)
    )
  }, [abaAtiva, q])

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const visiveis = linhas.slice(inicio, inicio + POR_PAGINA)

  const atrasados = (porStatus.get("Atrasado") ?? []).length
  const proximos = (porStatus.get("Próximo do prazo") ?? []).length
  const aguardando = (porStatus.get("Aguardando Implementação") ?? []).length
  const emDia = (porStatus.get("Dentro do prazo") ?? []).length

  // A barra mostra a proporção que o número sozinho não mostra: quantos NÃO
  // estão com o prazo em cima. Atrasado e Próximo do prazo ficam de fora —
  // "Próximo do prazo" é, por definição, um prazo prestes a estourar, e contá-lo
  // aqui faria a barra desmentir o próprio rótulo. Aguardando Implementação
  // entra: o PDI foi aprovado e não há prazo correndo, está em fila.
  const semPrazoEmCima = emDia + aguardando
  const pctEmDia = itens.length > 0 ? (semPrazoEmCima / itens.length) * 100 : 0
  // A cor sai da MESMA quantidade que a barra desenha, e não de `atrasados` por
  // fora: com a cor lendo um número e o preenchimento lendo outro, um
  // coordenador sem nenhum atraso e com todos os pacientes próximos do prazo
  // pintava uma barra vazia de verde.
  const corPct = toneColor(
    itens.length === 0 ? "gray" : pctEmDia === 100 ? "green" : pctEmDia >= 50 ? "amber" : "red",
  )
  const larguraBarra = Math.max(0, Math.min(100, pctEmDia))

  const nota: string = aba === "todos"
    ? "Todos os pacientes sob este Coordenador de Caso, do mais urgente ao mais folgado. A coluna Prazo diz, linha a linha, quanto tempo resta — ou há quanto tempo passou."
    : {
        "Atrasado": "O prazo de fechamento já passou. É por estes que a lista de prioridade trouxe você até aqui.",
        "Próximo do prazo": `Fecham em ${DIAS_ALERTA_PRAZO} dias ou menos. Ainda dá para fechar sem atraso, e é a janela em que cobrar custa menos.`,
        "Aguardando Implementação": "PDI aprovado, esperando implementação do PIC. Não há prazo estourando: a ação é destravar a fila.",
        "Dentro do prazo": "Prazo confortável, nada a fazer hoje. Estão aqui para o total fechar.",
      }[aba as StatusPdi]

  const vazio: string = aba === "todos"
    ? "Nenhum paciente neste Coordenador de Caso."
    : `Nenhum paciente em “${STATUS_INFO[aba as StatusPdi].rotulo}”.`

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onFechar() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // O PdiDetalheModal (edição) empilha POR CIMA deste, num portal próprio
        // fora da árvore do Radix. Sem estas duas guardas o trap de foco do
        // Dialog disputaria cada clique e cada Tab com os campos daquele modal,
        // e um clique lá dentro fecharia este por baixo.
        onInteractOutside={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
        className="h-[90vh] w-[90vw] max-w-350 gap-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-350"
      >
        {/* ── Cabeçalho ─────────────────────────────────────────────────────
            Empilhado no mobile: em uma única linha o nome disputaria largura com
            os números e quebraria letra a letra. */}
        <header className="flex flex-col gap-3 border-b border-border px-5 py-4 md:px-6 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
          <div className="flex min-w-0 items-start gap-3 lg:flex-1 lg:items-center">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-black ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>
              {iniciaisDe(analistaNome)}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold wrap-break-word text-foreground">{analistaNome}</DialogTitle>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users size={12} aria-hidden />
                {itens.length} {itens.length === 1 ? "paciente" : "pacientes"} no Controle de Prazos
              </p>
            </div>
          </div>

          {/* O número que trouxe a pessoa até aqui, no lugar de maior peso do
              cabeçalho — é o que a lista de prioridade mostrava na linha. */}
          <div className="shrink-0 border-border sm:border-l sm:pl-6">
            <div className="text-[11px] font-semibold text-muted-foreground">PDI atrasados</div>
            <div
              className="text-3xl font-black tabular-nums leading-none"
              style={{ color: toneColor(atrasados > 0 ? "red" : "green") }}
            >
              {atrasados}
            </div>
          </div>

          {/* Absoluto no mobile para não empurrar o nome; volta ao fluxo no lg. */}
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar detalhamento"
            className="absolute top-3 right-3 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:static lg:ml-auto"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── Corpo — rola só aqui ──────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-5 md:px-6">
          <div className="space-y-4">

            {/* ── Resultado ─────────────────────────────────────────────── */}
            <section className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border p-4 sm:flex-nowrap">
              <ResultadoNumero
                icon={<AlertOctagon size={14} />}
                label="Atrasados"
                valor={atrasados}
                nota={`de ${itens.length} ${itens.length === 1 ? "paciente" : "pacientes"}`}
                cor={toneColor(atrasados > 0 ? "red" : "gray")}
              />

              <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-6">
                <div className="text-[11px] font-semibold text-muted-foreground">Sem prazo estourando</div>
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
                    {itens.length === 0 ? "—" : `${pctEmDia.toFixed(0)}%`}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {itens.length === 0
                    ? "Nenhum paciente neste Coordenador de Caso."
                    : `${semPrazoEmCima} de ${itens.length} — ${emDia} dentro do prazo, ${aguardando} aguardando implementação`}
                </div>
              </div>

              <ResultadoNumero
                divisor
                icon={<ClockAlert size={14} />}
                label="Próximos do prazo"
                valor={proximos}
                nota={`fecham em ${DIAS_ALERTA_PRAZO} dias ou menos`}
                cor={toneColor(proximos > 0 ? "amber" : "gray")}
              />
            </section>

            {/* ── Tabela única com abas ─────────────────────────────────── */}
            <section className="rounded-2xl border border-border">
              {/* Tira de abas em formato de planilha: a tira é levemente
                  tonalizada e a aba ativa, em bg-card, se emenda ao painel da
                  tabela — o -mb-px sobre a borda da tira é o que apaga a linha
                  embaixo da aba ativa e cria a emenda. */}
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-t-2xl border-b border-border bg-muted/30 px-2 pt-2">
                <div role="tablist" aria-label="Filtrar pacientes por status" className="flex flex-1 flex-wrap items-end gap-1">
                  {abas.map(a => {
                    const ativa = a.id === abaAtiva?.id
                    // Ícone sempre no tom (é a identidade da aba); badge só
                    // colorido quando há o que contar — um "0" em vermelho
                    // grita por um problema que justamente não existe.
                    const badge = a.itens.length > 0 ? TONE_CHIP[a.tone] : TONE_CHIP.gray
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
                          {a.itens.length}
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
                    placeholder="Buscar paciente, aplicador…"
                    aria-label="Buscar nos pacientes deste coordenador"
                    className="w-48 rounded-full border border-border bg-card py-1 pr-2.5 pl-7 text-[11px] text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
                  />
                </div>
              </div>

              <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">{nota}</p>

              {linhas.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {q ? `Nenhum paciente encontrado para “${buscaLocal}” nesta aba.` : vazio}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    {/* min-w para o container rolar de lado em tela estreita em
                        vez de comprimir "Paciente" em três linhas por célula. */}
                    <table className="w-full min-w-190 text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Paciente</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Status</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Prazo</th>
                          <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Fechamento</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Dias clínicos</th>
                          <th scope="col" className="px-3 py-2.5 text-left font-semibold">Aplicadores</th>
                          <th scope="col" className="w-10 px-2 py-2.5">
                            <span className="sr-only">Detalhes</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiveis.map(item => {
                          const info = STATUS_INFO[item.status]
                          const aberto = detalhe === item.pacienteId
                          const atrasado = item.diasRestantes !== null && item.diasRestantes < 0
                          return (
                            // O par de <tr> precisa de Fragment com key: <> com
                            // keys nos filhos dispara warning do React.
                            <Fragment key={item.pacienteId}>
                              <tr className="border-t border-border/70 hover:bg-muted/40">
                                <td className="px-3 py-2.5">
                                  {/* Clicar no NOME abre a edição — o mesmo
                                      comportamento da versão anterior, em que a
                                      linha inteira era o gatilho. Aqui o alvo é
                                      o nome, para o chevron poder ter a sua
                                      própria ação sem ambiguidade. */}
                                  <button
                                    type="button"
                                    onClick={() => onAbrirPaciente(item)}
                                    className="max-w-full truncate rounded text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    title={`Abrir o PDI de ${item.nome}`}
                                  >
                                    {item.nome}
                                  </button>
                                </td>
                                <td className="px-3 py-2.5">
                                  <StatusChip tone={info.tone} dense>{item.status}</StatusChip>
                                </td>
                                <td className={`whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums ${atrasado ? TONE_CHIP.red.text : "text-foreground"}`}>
                                  {prazoDoItem(item)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                                  {dataBR(item.prazoFechamento)}
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground">
                                  {item.diasClinicos.length > 0 ? item.diasClinicos.join(", ") : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground">
                                  {item.quantidadeAplicadores > 0
                                    ? `${item.quantidadeAplicadores} ${item.quantidadeAplicadores === 1 ? "aplicador" : "aplicadores"}`
                                    : "—"}
                                </td>
                                <td className="px-2 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => setDetalhe(aberto ? null : item.pacienteId)}
                                    aria-expanded={aberto}
                                    aria-label={aberto ? `Ocultar detalhes de ${item.nome}` : `Ver detalhes de ${item.nome}`}
                                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                  >
                                    <ChevronDown size={14} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
                                  </button>
                                </td>
                              </tr>
                              {aberto && (
                                // O que não cabe na tabela principal, e que hoje
                                // só existia depois de abrir o modal de edição.
                                <tr className="border-t border-border/70 bg-muted/40">
                                  <td colSpan={7} className="px-3 py-3">
                                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                                      <CampoDetalhe rotulo="ID Favorecido" valor={item.pacienteId} />
                                      <CampoDetalhe rotulo="Avaliação" valor={dataBR(item.dataAvaliacao)} />
                                      <CampoDetalhe rotulo="Validade" valor={dataBR(item.dataValidade)} />
                                      <CampoDetalhe rotulo="Prazo do relatório" valor={dataBR(item.prazoRelatorio)} />
                                      <CampoDetalhe rotulo="Implantação do PIC" valor={dataBR(item.dataImplementacaoPic)} />
                                      <CampoDetalhe rotulo="Turno clínico" valor={item.turnoClinico || "—"} />
                                      <CampoDetalhe rotulo="Prioridade" valor={item.prioridade} />
                                      <CampoDetalhe
                                        rotulo="Ambiente natural"
                                        valor={item.autorizadoAmbienteNatural
                                          ? item.temAgendamentoAmbienteNatural ? "Autorizado e agendado" : "Autorizado, sem agendamento"
                                          : "Não autorizado"}
                                      />
                                      <CampoDetalhe
                                        rotulo="Aplicadores"
                                        valor={item.aplicadores.length > 0
                                          ? item.aplicadores.map(a => a.nome).join(", ")
                                          : "—"}
                                      />
                                      {item.coordenadores.length > 1 && (
                                        <CampoDetalhe
                                          rotulo="Coordenadores de Caso"
                                          valor={
                                            <span className={TONE_CHIP.amber.text}>
                                              {item.coordenadores.map(c => c.nome).join(", ")} — conta para cada um
                                            </span>
                                          }
                                        />
                                      )}
                                      {item.semCadastroPulsar && (
                                        <CampoDetalhe
                                          rotulo="Cadastro"
                                          valor={<span className={TONE_CHIP.amber.text}>Sem cadastro no Pulsar.</span>}
                                        />
                                      )}
                                      {item.cadastroDuplicadoTita && (
                                        <CampoDetalhe
                                          rotulo="Cadastro TiTa"
                                          valor={<span className={TONE_CHIP.amber.text}>Nome com mais de um ID Favorecido.</span>}
                                        />
                                      )}
                                      {item.observacoes && (
                                        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-5">
                                          <CampoDetalhe rotulo="Observações" valor={item.observacoes} />
                                        </div>
                                      )}
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
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Mostrando {inicio + 1} a {Math.min(inicio + POR_PAGINA, linhas.length)} de {linhas.length}{" "}
                      {linhas.length === 1 ? "paciente" : "pacientes"}
                    </span>

                    {totalPaginas > 1 && (
                      <nav aria-label="Paginação dos pacientes" className="flex items-center gap-1">
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
