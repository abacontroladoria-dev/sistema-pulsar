"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, AlertOctagon, ClockAlert, Hourglass, PlayCircle, RotateCw, UserRound, UserX, Users } from "lucide-react"
import type { ItemPdi } from "@/lib/pdi/filtros"
import type { MetaPdiPrazos } from "@/types/pdiPrazos"
import {
  agruparPorAnalista,
  calcularResumoExecutivo,
  calcularSemaforo,
  filtrarAtivosComAutorizacaoAba,
  type LinhaAnalista,
  type Semaforo,
} from "@/lib/pdi/painelAnalista"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/ScheduleModal"
import { AnalistaDetalheModal } from "./AnalistaDetalheModal"
import { PdiDetalheModal } from "./PdiDetalheModal"

// "PDI - Painel por Analista" — dashboard por Coordenador de Caso ("Analista",
// no jargão da clínica), pedido do usuário (04/09/2026), espelhando a aba
// "Dashboard" da planilha Excel original (`Controle_Prazos_PDI pronto 2.0`).
//
// MOLDE de PdiPrazosShell.tsx: mesmo fetch de /api/pdi-controle-prazos/, mesmo
// tratamento de erro/loading — mas SEM filtro/paginação: é um painel de
// leitura, não uma fila de trabalho. A agregação (`agruparPorAnalista`,
// `calcularResumoExecutivo`, `calcularSemaforo`) é toda em lib/pdi/painelAnalista.ts,
// puro e testado — este componente só busca, calcula com `useMemo` e renderiza.
//
// ─── Decisões desta tela ──────────────────────────────────────────────────
//
// A população do painel INTEIRO é `filtrarAtivosComAutorizacaoAba(itens)`
// (pedido do usuário, 05/09/2026), não `itens` cru — ver o cabeçalho de
// lib/pdi/painelAnalista.ts. "Total com Autorização ABA" só conta quem tem
// autorização HOJE (elegível pelo relatório) E está ativo (sessão agendada na
// 1ª semana do mês seguinte); os outros números do painel (Atrasados,
// Próximo do Prazo, etc.) usam a MESMA população, senão o "Total" não bateria
// com a soma dos outros cards.
//
// "Resumo Geral" (tabela Categoria/Quantidade da planilha original) foi
// REMOVIDO (pedido do usuário, 05/09/2026): é a mesma informação do Painel
// Executivo acima, em outro formato — redundante de verdade, ao contrário do
// resto da estrutura da planilha que fazia sentido replicar.
//
// "PDIs por Coordenador" virou CARDS, não tabela (pedido do usuário,
// 05/09/2026: a tabela "parecia planilha de Excel") — ver `CardAnalista`
// abaixo.
//
// "Sem Coordenador de Caso": `agruparPorAnalista` só itera coordenadores
// existentes (ver o cabeçalho de lib/pdi/painelAnalista.ts), então a
// responsabilidade de não deixar esses pacientes desaparecerem da tabela por
// analista é DESTE componente — `linhaSemCoordenador` abaixo soma por status
// os itens com `coordenadores.length === 0`, viram uma linha extra ao fim da
// tabela "PDIs por Coordenador".

// O selo do semáforo diz a SITUAÇÃO, não a cor. A planilha original escrevia
// "VERDE"/"AMARELO"/"VERMELHO" dentro de uma pílula que já era daquela cor —
// redundante para quem enxerga e vazio para leitor de tela ("VERMELHO" não é
// um estado, é um pixel). Os limites da fórmula (0 / 1-5 / >5) continuam 1:1
// com `calcularSemaforo`; só a redação mudou, e agora aparecem na tela em vez
// de viver só neste comentário.
const SEMAFORO_INFO: Record<Semaforo, { rotulo: string; regra: string; cor: string; anel: string }> = {
  verde: {
    rotulo: "Sem atrasos",
    regra: "nenhum PDI atrasado",
    cor: "text-emerald-700 dark:text-emerald-400",
    anel: "border-emerald-400 bg-emerald-500/10 dark:border-emerald-800 dark:bg-emerald-950/30",
  },
  amarelo: {
    rotulo: "Atenção",
    regra: "de 1 a 5 PDIs atrasados",
    cor: "text-amber-700 dark:text-amber-400",
    anel: "border-amber-400 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-950/30",
  },
  vermelho: {
    rotulo: "Acima do limite",
    regra: "mais de 5 PDIs atrasados",
    cor: "text-rose-700 dark:text-rose-400",
    anel: "border-rose-400 bg-rose-500/10 dark:border-rose-800 dark:bg-rose-950/30",
  },
}

/** Moldura neutra do semáforo enquanto carrega — ver o comentário no JSX. */
const SEMAFORO_NEUTRO = "border-border bg-muted/30"

type CardExecutivoInfo = {
  chave: "totalPacientes" | "atrasados" | "proximoPrazo" | "emAndamento" | "aguardandoImplementacao"
  rotulo: string
  icone: typeof Users
  tom: string
  base: string
}

const CARDS_EXECUTIVO: CardExecutivoInfo[] = [
  {
    chave: "totalPacientes",
    rotulo: "Ativos com Autorização ABA",
    icone: Users,
    tom: "text-slate-600 dark:text-slate-300",
    base: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
  },
  {
    chave: "atrasados",
    rotulo: "Total de PDIs Atrasados",
    icone: AlertOctagon,
    tom: "text-rose-600 dark:text-rose-400",
    base: "border-rose-100 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30",
  },
  {
    chave: "proximoPrazo",
    rotulo: "Total Próximos do Prazo",
    icone: ClockAlert,
    tom: "text-amber-600 dark:text-amber-400",
    base: "border-amber-100 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
  },
  {
    chave: "emAndamento",
    rotulo: "Total Dentro do Prazo",
    icone: PlayCircle,
    tom: "text-emerald-600 dark:text-emerald-400",
    base: "border-emerald-100 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
  },
  {
    chave: "aguardandoImplementacao",
    rotulo: "Total Aguardando Implementação",
    icone: Hourglass,
    tom: "text-sky-600 dark:text-sky-400",
    base: "border-sky-100 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30",
  },
]

/** Soma os pacientes SEM Coordenador de Caso por status — vira a linha extra da tabela, ver o cabeçalho. */
function linhaSemCoordenador(itens: ItemPdi[]): LinhaAnalista {
  const linha: LinhaAnalista = {
    profissionalId: 0,
    nome: "Sem Coordenador de Caso",
    atrasados: 0,
    proximoPrazo: 0,
    emAndamento: 0,
    aguardandoImplementacao: 0,
    total: 0,
  }
  for (const item of itens) {
    if (item.coordenadores.length > 0) continue
    linha.total += 1
    if (item.status === "Atrasado") linha.atrasados += 1
    else if (item.status === "Próximo do prazo") linha.proximoPrazo += 1
    else if (item.status === "Dentro do prazo") linha.emAndamento += 1
    else if (item.status === "Aguardando Implementação") linha.aguardandoImplementacao += 1
  }
  return linha
}

export function PainelAnalistaShell() {
  const [itens, setItens] = useState<ItemPdi[]>([])
  const [meta, setMeta] = useState<MetaPdiPrazos | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // `carregar` extraído em useCallback (e não inline no efeito) para o banner
  // de erro poder REINVOCÁ-LO — antes a única recuperação de uma falha do robô
  // do Órbita era F5, que recarrega a página inteira. `vivoRef` substitui a
  // flag local do efeito: sobrevive entre chamadas e impede que um retry
  // desmontado escreva estado.
  const vivoRef = useRef(true)
  useEffect(() => {
    vivoRef.current = true
    return () => {
      vivoRef.current = false
    }
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch("/api/pdi-controle-prazos/", { cache: "no-store" })
      const corpo = await resposta.json()
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.error ?? `HTTP ${resposta.status}`)
      }
      if (!vivoRef.current) return
      setItens(corpo.itens as ItemPdi[])
      setMeta(corpo.meta as MetaPdiPrazos)
    } catch (e) {
      console.error("[pdi-painel-analista] falha ao carregar", e)
      if (vivoRef.current) setErro(e instanceof Error ? e.message : "erro desconhecido")
    } finally {
      if (vivoRef.current) setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // A população do painel inteiro: elegível (autorização ABA hoje) E ativo
  // (sessão agendada na 1ª semana do mês seguinte) — ver o cabeçalho de
  // lib/pdi/painelAnalista.ts::filtrarAtivosComAutorizacaoAba. Todo cálculo
  // abaixo (Painel Executivo, Semáforo, PDIs por Coordenador, e o drill-down
  // por analista) opera sobre ESTA lista, não sobre `itens` cru — os números
  // batem entre si de propósito.
  const itensPainel = useMemo(() => filtrarAtivosComAutorizacaoAba(itens), [itens])

  const resumo = useMemo(() => calcularResumoExecutivo(itensPainel), [itensPainel])
  const semaforo = useMemo(() => calcularSemaforo(resumo.atrasados), [resumo.atrasados])
  const porAnalista = useMemo(() => agruparPorAnalista(itensPainel), [itensPainel])
  const semCoordenador = useMemo(() => linhaSemCoordenador(itensPainel), [itensPainel])

  const infoSemaforo = SEMAFORO_INFO[semaforo]

  // Enquanto carrega OU depois de falhar, os números não valem: o semáforo e
  // os cards executivos ficam neutros e mostram "—". Sem isso, uma falha de
  // atualização deixava o último `resumo` bem-sucedido pintado com confiança
  // total — uma moldura verde "Sem atrasos" a manhã inteira, logo abaixo de um
  // banner vermelho dizendo que a carga falhou. O flash verde de meio segundo
  // já tinha sido corrigido; este é o mesmo erro na versão permanente.
  const semNumeros = carregando || erro !== null

  // "Sem Coordenador de Caso" DISPUTA posição com os coordenadores reais, em
  // vez de ser empurrado para o fim. `agruparPorAnalista` já devolve ordenado
  // por `atrasados` desc (desempate por nome) — juntar e reordenar pelo mesmo
  // critério mantém uma regra só: quem tem mais atrasado aparece primeiro,
  // seja uma pessoa ou a ausência de uma. Pacientes sem coordenador com
  // atrasado são o pior caso do produto (atrasado E sem dono); pregá-los no
  // canto inferior direito da grade era esconder justamente a pior célula.
  // Pior atraso (mais negativo de `diasRestantes`) por coordenador. Sem isso,
  // 3 PDIs com 2 dias de atraso e 3 com 40 desenham o MESMO cartão — e a tela
  // decide quem vai ser cobrado. `diasRestantes` já vem calculado do servidor
  // no ItemPdi; aqui só se pega o mínimo entre os atrasados de cada um.
  // Chave 0 = "Sem Coordenador de Caso", igual ao resto da tela.
  const piorAtrasoPorAnalista = useMemo(() => {
    const pior = new Map<number, number>()
    const registrar = (id: number, dias: number) => {
      const atual = pior.get(id)
      if (atual === undefined || dias < atual) pior.set(id, dias)
    }
    for (const item of itensPainel) {
      if (item.status !== "Atrasado" || item.diasRestantes === null) continue
      if (item.coordenadores.length === 0) registrar(0, item.diasRestantes)
      else for (const c of item.coordenadores) registrar(c.profissionalId, item.diasRestantes)
    }
    return pior
  }, [itensPainel])

  const linhas: LinhaAnalista[] = useMemo(() => {
    const todas = semCoordenador.total > 0 ? [...porAnalista, semCoordenador] : porAnalista
    return [...todas].sort((a, b) => {
      if (a.atrasados !== b.atrasados) return b.atrasados - a.atrasados
      // GRAVIDADE antes de volume: com o mesmo número de atrasados, quem tem o
      // atraso mais antigo vem primeiro. Sem este critério a posição no grid e
      // o número mais alarmante do cartão discordavam — 6 atrasados de 2 dias
      // ficavam à frente de 2 atrasados de 38 — e quem lê para de confiar na
      // ordem e volta a varrer todos os cartões.
      const piorA = piorAtrasoPorAnalista.get(a.profissionalId)
      const piorB = piorAtrasoPorAnalista.get(b.profissionalId)
      if (piorA !== undefined && piorB !== undefined && piorA !== piorB) return piorA - piorB
      if (a.proximoPrazo !== b.proximoPrazo) return b.proximoPrazo - a.proximoPrazo
      if (a.total !== b.total) return b.total - a.total
      return a.nome.localeCompare(b.nome, "pt-BR")
    })
  }, [porAnalista, semCoordenador, piorAtrasoPorAnalista])

  // Recorte da grade. Os cards do Painel Executivo passam a FILTRAR, como os
  // KPIs da tela irmã (FiltrosPdi.tsx) — antes tinham a mesma silhueta de um
  // controle clicável e não faziam nada, uma promessa falsa de affordance. O
  // "Ativos com Autorização ABA" limpa o recorte, por ser a população inteira.
  const [recorte, setRecorte] = useState<CardExecutivoInfo["chave"]>("totalPacientes")
  const [busca, setBusca] = useState("")

  const linhasVisiveis = useMemo(() => {
    const alvo = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (recorte !== "totalPacientes" && l[recorte] === 0) return false
      if (alvo && !l.nome.toLowerCase().includes(alvo)) return false
      return true
    })
  }, [linhas, recorte, busca])

  const filtroAtivo = recorte !== "totalPacientes" || busca.trim() !== ""

  // Clicar num CardAnalista abre a lista de pacientes daquele analista; clicar
  // num paciente ali dentro abre o PdiDetalheModal de verdade (o mesmo de
  // Controle de Prazos) POR CIMA, com a lista do coordenador viva atrás —
  // pedido do usuário (05/09/2026): "poderei ver o nome dos pacientes e quem
  // está em cada categoria".
  //
  // A versão anterior fechava a lista ao abrir o paciente (`setAnalistaAberto(null)`),
  // então revisar 4 pacientes do mesmo coordenador custava 4 idas e voltas à
  // grade para reencontrar o cartão. Agora fechar o paciente devolve a lista
  // exatamente onde estava — é o mesmo caso de uso da tarefa central da tela
  // ("cobrar os atrasados de fulano"), não uma navegação excepcional.
  //
  // Guarda-se o ID, não o objeto `LinhaAnalista`: com o modal do paciente
  // aberto por cima, salvar uma edição recalcula `linhas` — um snapshot
  // preso no estado mostraria contagens velhas no cabeçalho do modal de trás
  // enquanto a lista dentro dele já teria mudado.
  const [analistaAbertoId, setAnalistaAbertoId] = useState<number | null>(null)
  const [pacienteAberto, setPacienteAberto] = useState<ItemPdi | null>(null)

  const analistaAberto = useMemo(
    () => (analistaAbertoId === null ? null : (linhas.find((l) => l.profissionalId === analistaAbertoId) ?? null)),
    [analistaAbertoId, linhas],
  )

  const itensDoAnalista = useMemo(() => {
    if (!analistaAberto) return []
    if (analistaAberto.profissionalId === 0) {
      return itensPainel.filter((i) => i.coordenadores.length === 0)
    }
    return itensPainel.filter((i) => i.coordenadores.some((c) => c.profissionalId === analistaAberto.profissionalId))
  }, [analistaAberto, itensPainel])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
      {erro && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Não foi possível carregar o Painel por Analista. {erro}
            {" — o robô do Órbita pode não ter rodado hoje."}
          </span>
          <button
            type="button"
            onClick={() => void carregar()}
            disabled={carregando}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-[13px] font-semibold transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:opacity-60"
          >
            <RotateCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            {carregando ? "Tentando…" : "Tentar de novo"}
          </button>
        </div>
      )}

      {/* Indicador Geral (Semáforo) — fórmula 1:1 da planilha: 0 atrasados =
          verde, 1-5 = amarelo, >5 = vermelho (ver calcularSemaforo).

          A moldura fica NEUTRA enquanto carrega. Antes `infoSemaforo.anel` era
          aplicado sem checar `carregando`, e `calcularSemaforo(0)` sobre a
          lista vazia devolve "verde": o primeiro paint pintava um quadro verde
          de tudo-certo que depois virava vermelho. Um painel que mente por meio
          segundo justamente onde deveria estabelecer confiança é pior que um
          painel que ainda não sabe. */}
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 px-5 py-4 shadow-sm transition-colors duration-200 motion-reduce:transition-none ${
          semNumeros ? SEMAFORO_NEUTRO : infoSemaforo.anel
        }`}
      >
        <span className={`text-sm font-bold tracking-wide ${semNumeros ? "text-muted-foreground" : infoSemaforo.cor}`}>
          Indicador Geral
        </span>
        {/* Só a parte que MUDA é anunciada. Com o aria-live no container
            inteiro, cada atualização relia também o rótulo estático. */}
        <span aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {carregando ? (
            <span className="h-7 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none" aria-hidden="true" />
          ) : erro ? (
            <span className="rounded-full border-2 border-border px-4 py-1 text-lg font-bold text-muted-foreground">
              Indisponível
            </span>
          ) : (
            <span className={`rounded-full border-2 px-4 py-1 text-lg font-bold ${infoSemaforo.cor} ${infoSemaforo.anel}`}>
              {infoSemaforo.rotulo}
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            {carregando
              ? "Carregando…"
              : erro
                ? "Os números abaixo não puderam ser atualizados."
                : `${resumo.atrasados} ${resumo.atrasados === 1 ? "PDI atrasado" : "PDIs atrasados"} no total · ${infoSemaforo.regra}`}
          </span>
        </span>
      </div>

      {/* PAINEL EXECUTIVO — cada card RECORTA a grade abaixo, como os KPIs de
          Controle de Prazos (FiltrosPdi.tsx). Eram inertes e tinham a mesma
          silhueta dos clicáveis da tela irmã: quem vinha de lá clicava e não
          acontecia nada. */}
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Painel executivo">
        {CARDS_EXECUTIVO.map((card) => {
          const Icone = card.icone
          const ativo = recorte === card.chave
          const vazio = !semNumeros && card.chave !== "totalPacientes" && resumo[card.chave] === 0
          return (
            <button
              key={card.chave}
              type="button"
              onClick={() => setRecorte(card.chave)}
              disabled={semNumeros || vazio}
              aria-pressed={ativo}
              className={`flex min-h-11 flex-col items-center gap-1 rounded-2xl border px-4 py-4 text-center shadow-sm transition-all duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transform-none motion-reduce:transition-none ${
                semNumeros ? "border-border bg-muted/20" : card.base
              } ${ativo ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
            >
              <Icone className={`h-5 w-5 ${semNumeros ? "text-muted-foreground" : card.tom}`} aria-hidden="true" />
              <span className={`text-3xl font-bold leading-none tabular-nums ${semNumeros ? "text-muted-foreground" : card.tom}`}>
                {semNumeros ? "—" : resumo[card.chave]}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">{card.rotulo}</span>
            </button>
          )
        })}
      </section>

      {/* PDIs por Coordenador — cards, não tabela (pedido do usuário,
          05/09/2026: a tabela "parecia planilha de Excel"). Mesmo vocabulário
          visual do resto da feature: cartão arredondado com sombra, hover
          levanta (ver CardPdi.tsx/KpisPdi em FiltrosPdi.tsx) — o Total salta
          aos olhos como número grande, os status viram selos coloridos
          compactos (só aparecem quando > 0, pra não poluir quem tem tudo
          zerado), e Atrasados > 0 destaca a borda inteira do cartão em rose —
          é o mesmo tratamento que "Sem Coordenador de Caso" merece atenção
          (borda tracejada + ícone) em vez de escondido no fim de uma tabela. */}
      <section aria-label="PDIs por Coordenador">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-wide text-foreground">PDIs por Coordenador</h2>
            {/* A ordem e a dupla contagem viviam só em comentário de código.
                Quem somasse os cartões e passasse do total do Painel Executivo
                concluía que o painel estava quebrado. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mais atrasados primeiro · paciente com dois coordenadores conta para os dois
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="busca-coordenador" className="sr-only">
              Buscar coordenador pelo nome
            </label>
            <input
              id="busca-coordenador"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              disabled={semNumeros}
              placeholder="Buscar coordenador…"
              className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-56"
            />
            {filtroAtivo && (
              <button
                type="button"
                onClick={() => {
                  setRecorte("totalPacientes")
                  setBusca("")
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        {carregando ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-8 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-5 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : erro ? (
          // Falha de carga já é dita pelo banner no topo, com o botão de
          // retry. Sem esta guarda o vazio aparecia JUNTO do erro, afirmando
          // "nenhum paciente" quando na verdade não se sabe.
          <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Dados indisponíveis — use “Tentar de novo” acima.
          </p>
        ) : linhas.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum paciente no Controle de Prazos do PDI.
          </p>
        ) : linhasVisiveis.length === 0 ? (
          // "O filtro não achou ninguém" é diferente de "não há dados": aqui a
          // saída é mexer no filtro, e o texto diz isso.
          <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum coordenador neste recorte.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {linhasVisiveis.map((linha) => (
              <CardAnalista
                key={linha.profissionalId}
                linha={linha}
                piorAtraso={piorAtrasoPorAnalista.get(linha.profissionalId) ?? null}
                onAbrir={() => setAnalistaAbertoId(linha.profissionalId)}
              />
            ))}
          </ul>
        )}
      </section>

      {meta && (
        <p className="text-xs text-muted-foreground">
          Relatório <span className="font-semibold">{meta.arquivoNome}</span> ·{" "}
          {meta.linhasLidas} linhas lidas → {meta.itens} elegíveis · calculado em{" "}
          {meta.hoje.split("-").reverse().join("/")}
        </p>
      )}

      {analistaAberto && (
        <AnalistaDetalheModal
          analistaNome={analistaAberto.nome}
          itens={itensDoAnalista}
          onFechar={() => setAnalistaAbertoId(null)}
          onAbrirPaciente={(item) => setPacienteAberto(item)}
        />
      )}

      {pacienteAberto && meta && (
        <PdiDetalheModal
          item={pacienteAberto}
          hoje={meta.hoje}
          // Empilha sobre a lista do coordenador, que segue montada atrás.
          zIndex={Z_MODAL_EMPILHADO}
          onFechar={() => setPacienteAberto(null)}
          onSalvo={(atualizado) => {
            setItens((atuais) => atuais.map((i) => (i.pacienteId === atualizado.pacienteId ? atualizado : i)))
            setPacienteAberto(null)
          }}
        />
      )}
    </div>
  )
}

/** Um selo de status pequeno — só aparece quando `valor > 0` (ver `CardAnalista`), pra não poluir quem tem tudo zerado. */
const TONS_SELO: Record<"rose" | "amber" | "emerald" | "sky", string> = {
  rose: "border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400",
  amber: "border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  emerald: "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  sky: "border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
}

function SeloStatus({
  valor,
  rotuloSingular,
  rotuloPlural,
  tom,
  sufixo,
}: {
  valor: number
  rotuloSingular: string
  rotuloPlural: string
  tom: keyof typeof TONS_SELO
  /** Ex.: "pior 38d de atraso" — a MAGNITUDE, sempre em módulo (ver `piorAtraso` em CardAnalista). */
  sufixo?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONS_SELO[tom]}`}>
      <span className="tabular-nums">{valor}</span> {valor === 1 ? rotuloSingular : rotuloPlural}
      {sufixo && <span className="font-bold tabular-nums">· {sufixo}</span>}
    </span>
  )
}

/**
 * Um Coordenador de Caso (Analista) e a contagem de PDIs sob sua
 * responsabilidade, hoje. Substitui a linha de tabela original — pedido do
 * usuário (05/09/2026): mais visual, no mesmo vocabulário de cartão do resto
 * da feature (`CardPdi.tsx`, `KpisPdi` em `FiltrosPdi.tsx`).
 */
function CardAnalista({
  linha,
  piorAtraso,
  onAbrir,
}: {
  linha: LinhaAnalista
  /** `diasRestantes` mais negativo entre os atrasados deste coordenador, ou null. */
  piorAtraso: number | null
  onAbrir: () => void
}) {
  const semCoordenador = linha.profissionalId === 0
  const temAtraso = linha.atrasados > 0

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        // O rótulo carrega a SITUAÇÃO, não só o nome: com "Ver pacientes de X"
        // um leitor de tela ouvia 20 botões idênticos e só descobria quem
        // estava pegando fogo abrindo um por um. O que está na tela em cor e
        // posição precisa estar aqui em palavras.
        aria-label={[
          `Ver pacientes de ${linha.nome}`,
          `${linha.total} ${linha.total === 1 ? "paciente" : "pacientes"}`,
          linha.atrasados > 0
            ? `${linha.atrasados} ${linha.atrasados === 1 ? "atrasado" : "atrasados"}${
                piorAtraso !== null ? `, pior com ${Math.abs(piorAtraso)} dias de atraso` : ""
              }`
            : null,
          linha.proximoPrazo > 0 ? `${linha.proximoPrazo} próximo do prazo` : null,
          linha.aguardandoImplementacao > 0 ? `${linha.aguardandoImplementacao} aguardando implementação` : null,
        ]
          .filter(Boolean)
          .join(". ")}
        className={`flex w-full flex-col gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none ${
          temAtraso
            ? "border-rose-300 bg-rose-500/5 dark:border-rose-800"
            : semCoordenador
              ? "border-dashed border-border bg-muted/20"
              : "border-border bg-card"
        }`}
      >
        <div className="flex items-center gap-2">
          {semCoordenador ? (
            <UserX className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          ) : (
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <h3 className="truncate text-sm font-bold text-foreground" title={linha.nome}>
            {linha.nome}
          </h3>
        </div>

        <p className="leading-none">
          <span className="text-3xl font-extrabold tabular-nums text-foreground">{linha.total}</span>{" "}
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {linha.total === 1 ? "paciente" : "pacientes"}
          </span>
        </p>

        <div className="flex flex-wrap gap-1.5">
          {linha.atrasados > 0 && (
            <SeloStatus
              valor={linha.atrasados}
              rotuloSingular="atrasado"
              rotuloPlural="atrasados"
              tom="rose"
              // `piorAtraso` é o MENOR `diasRestantes` (negativo para quem já
              // passou do prazo) — vai para a tela em módulo. "pior -38d" seria
              // negativo qualificando um conceito já negativo ("atrasados"), e
              // ainda contradiria o modal que abre deste mesmo cartão, que diz
              // "38 dias de atraso" para o mesmo paciente.
              sufixo={piorAtraso !== null ? `pior ${Math.abs(piorAtraso)}d de atraso` : undefined}
            />
          )}
          {linha.proximoPrazo > 0 && (
            <SeloStatus valor={linha.proximoPrazo} rotuloSingular="próximo" rotuloPlural="próximos" tom="amber" />
          )}
          {linha.emAndamento > 0 && (
            <SeloStatus valor={linha.emAndamento} rotuloSingular="dentro do prazo" rotuloPlural="dentro do prazo" tom="emerald" />
          )}
          {linha.aguardandoImplementacao > 0 && (
            <SeloStatus
              valor={linha.aguardandoImplementacao}
              rotuloSingular="aguardando"
              rotuloPlural="aguardando"
              tom="sky"
            />
          )}
        </div>
      </button>
    </li>
  )
}
