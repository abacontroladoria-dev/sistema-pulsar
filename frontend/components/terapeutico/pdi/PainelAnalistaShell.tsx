"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, RotateCw } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { norm, type ItemPdi } from "@/lib/pdi/filtros"
import type { MetaPdiPrazos } from "@/types/pdiPrazos"
import {
  agruparPorAnalista,
  calcularResumoExecutivo,
  calcularSemaforo,
  filtrarAtivosComAutorizacaoAba,
  type LinhaAnalista,
} from "@/lib/pdi/painelAnalista"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/ScheduleModal"
import { AnalistaDetalheModal } from "./AnalistaDetalheModal"
import { PdiDetalheModal } from "./PdiDetalheModal"
import { ResumoAcao } from "./painel/ResumoAcao"
import { FiltrosPainelAnalista } from "./painel/FiltrosPainelAnalista"
import { ListaPrioridade } from "./painel/ListaPrioridade"
import { DistribuicaoGeral } from "./painel/DistribuicaoGeral"
import type { RecortePainel } from "./painel/tipos"

// "PDI - Painel por Analista" — dashboard por Coordenador de Caso ("Analista",
// no jargão da clínica), pedido do usuário (04/09/2026), espelhando a aba
// "Dashboard" da planilha Excel original (`Controle_Prazos_PDI pronto 2.0`).
//
// MOLDE de PdiPrazosShell.tsx: mesmo fetch de /api/pdi-controle-prazos/, mesmo
// tratamento de erro/loading — mas SEM paginação: é um painel de leitura, não
// uma fila de trabalho. A agregação (`agruparPorAnalista`,
// `calcularResumoExecutivo`, `calcularSemaforo`) é toda em lib/pdi/painelAnalista.ts,
// puro e testado — este componente só busca, calcula com `useMemo` e distribui
// para os componentes de apresentação em ./painel/.
//
// ─── Decisões desta tela ──────────────────────────────────────────────────
//
// A população do painel INTEIRO é `filtrarAtivosComAutorizacaoAba(itens)`
// (pedido do usuário, 05/09/2026), não `itens` cru — ver o cabeçalho de
// lib/pdi/painelAnalista.ts. Todo número da tela (topo, distribuição, lista)
// sai da MESMA lista, senão o total não bateria com a soma das partes.
//
// "Sem Coordenador de Caso": `agruparPorAnalista` só itera coordenadores
// existentes (ver o cabeçalho de lib/pdi/painelAnalista.ts), então a
// responsabilidade de não deixar esses pacientes desaparecerem é DESTE
// componente — `linhaSemCoordenador` abaixo soma por status os itens com
// `coordenadores.length === 0` e vira uma linha extra, que DISPUTA posição em
// vez de ser empurrada para o fim: atrasado E sem dono é o pior caso do
// produto, e pregá-lo no rodapé era esconder justamente a pior célula.
//
// ─── Refatoração visual (11/09/2026) ──────────────────────────────────────
//
// A hierarquia anterior contradizia a tarefa da tela. Cinco cards de peso
// idêntico no topo faziam "Ativos com Autorização ABA" (contexto) competir com
// "Atrasados" (ação); e cada cartão de coordenador exibia o TOTAL DE PACIENTES
// como número grande, com os atrasados num selo de 11px — sendo que todo
// coordenador tem entre 15 e 18 pacientes e essa contagem não distingue
// ninguém. Agora: um card de ação dominante, uma lista compacta em que o
// atraso é o sinal, e o contexto numa coluna lateral.
//
// O banner "Indicador Geral (Semáforo)" foi absorvido pelo card de ação — ver
// ResumoAcao.tsx. A fórmula (`calcularSemaforo`, 0 / 1-5 / >5) não mudou.

/** Soma os pacientes SEM Coordenador de Caso por status — vira a linha extra da lista, ver o cabeçalho. */
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
  /** Instante do último fetch BEM-SUCEDIDO — o "Atualizado em" do cabeçalho. */
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)

  // `carregar` extraído em useCallback (e não inline no efeito) para o banner
  // de erro e o botão do cabeçalho poderem REINVOCÁ-LO — antes a única
  // recuperação de uma falha do robô do Órbita era F5, que recarrega a página
  // inteira. `vivoRef` substitui a flag local do efeito: sobrevive entre
  // chamadas e impede que um retry desmontado escreva estado.
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
      setAtualizadoEm(new Date())
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

  // A população do painel inteiro — ver o cabeçalho de
  // lib/pdi/painelAnalista.ts::filtrarAtivosComAutorizacaoAba. Todo cálculo
  // abaixo opera sobre ESTA lista, não sobre `itens` cru.
  const itensPainel = useMemo(() => filtrarAtivosComAutorizacaoAba(itens), [itens])

  const resumo = useMemo(() => calcularResumoExecutivo(itensPainel), [itensPainel])
  const semaforo = useMemo(() => calcularSemaforo(resumo.atrasados), [resumo.atrasados])
  const porAnalista = useMemo(() => agruparPorAnalista(itensPainel), [itensPainel])
  const semCoordenador = useMemo(() => linhaSemCoordenador(itensPainel), [itensPainel])

  // Enquanto carrega OU depois de falhar, os números não valem: tudo mostra
  // "—" e as molduras ficam neutras. Sem isso, uma falha de atualização
  // deixava o último `resumo` bem-sucedido pintado com confiança total — um
  // quadro verde "Sem atrasos" a manhã inteira, logo abaixo de um banner
  // vermelho dizendo que a carga falhou.
  const semNumeros = carregando || erro !== null

  // Pior atraso (mais negativo de `diasRestantes`) por coordenador. Sem isso,
  // 3 PDIs com 2 dias de atraso e 3 com 40 desenham a MESMA linha — e a tela
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
      // atraso mais antigo vem primeiro. Sem este critério a posição na lista e
      // o número mais alarmante da linha discordavam — 6 atrasados de 2 dias
      // ficavam à frente de 2 atrasados de 38 — e quem lê para de confiar na
      // ordem e volta a varrer tudo.
      const piorA = piorAtrasoPorAnalista.get(a.profissionalId)
      const piorB = piorAtrasoPorAnalista.get(b.profissionalId)
      if (piorA !== undefined && piorB !== undefined && piorA !== piorB) return piorA - piorB
      if (a.proximoPrazo !== b.proximoPrazo) return b.proximoPrazo - a.proximoPrazo
      if (a.total !== b.total) return b.total - a.total
      return a.nome.localeCompare(b.nome, "pt-BR")
    })
  }, [porAnalista, semCoordenador, piorAtrasoPorAnalista])

  // ─── Filtros ────────────────────────────────────────────────────────────
  //
  // `recorte` tem DOIS caminhos de entrada — os cards do topo e o seletor de
  // status — e um só lugar no estado, então eles não têm como discordar. Os
  // cards já filtravam antes; o seletor torna isso visível para quem não
  // descobria que um card era clicável.
  const [recorte, setRecorte] = useState<RecortePainel>("totalPacientes")
  const [busca, setBusca] = useState("")
  const [analistaFiltrado, setAnalistaFiltrado] = useState<number | null>(null)

  // A busca casa nome de ANALISTA ou de PACIENTE — o campo promete os dois. Um
  // paciente encontrado mantém à vista os coordenadores dele, que é o caminho
  // para abri-lo. `norm` (de lib/pdi/filtros.ts, o mesmo da tela irmã) ignora
  // acento: com `toLowerCase().includes` cru, "maite" não achava "Maitê".
  const idsPorBusca = useMemo(() => {
    const alvo = norm(busca)
    if (!alvo) return null
    const ids = new Set<number>()
    for (const item of itensPainel) {
      if (!norm(item.nome).includes(alvo)) continue
      if (item.coordenadores.length === 0) ids.add(0)
      else for (const c of item.coordenadores) ids.add(c.profissionalId)
    }
    return ids
  }, [busca, itensPainel])

  const linhasVisiveis = useMemo(() => {
    const alvo = norm(busca)
    return linhas.filter((l) => {
      if (analistaFiltrado !== null && l.profissionalId !== analistaFiltrado) return false
      if (recorte !== "totalPacientes" && l[recorte] === 0) return false
      if (alvo && !norm(l.nome).includes(alvo) && !idsPorBusca?.has(l.profissionalId)) return false
      return true
    })
  }, [linhas, recorte, busca, idsPorBusca, analistaFiltrado])

  const filtroAtivo = recorte !== "totalPacientes" || busca.trim() !== "" || analistaFiltrado !== null

  const limparFiltros = useCallback(() => {
    setRecorte("totalPacientes")
    setBusca("")
    setAnalistaFiltrado(null)
  }, [])

  // ─── Cabeçalho global ───────────────────────────────────────────────────
  //
  // "Atualizado em" + botão Atualizar vão para o `rightContent` do header do
  // app (o mesmo padrão de PdiPrazosShell.tsx), em vez de um cabeçalho próprio
  // dentro da página: o app já tem uma faixa de 80px com título, subtítulo e
  // sino de alertas, e desenhar outra abaixo dela daria dois cabeçalhos
  // empilhados dizendo a mesma coisa.
  const { setRightContent } = useHeader()

  useEffect(() => {
    setRightContent(
      <div className="flex items-center gap-2">
        {atualizadoEm && !erro && (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            Atualizado às{" "}
            {atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          type="button"
          onClick={() => void carregar()}
          disabled={carregando}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <RotateCw
            className={`h-3.5 w-3.5 shrink-0 ${carregando ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          {carregando ? "Atualizando…" : "Atualizar"}
        </button>
      </div>,
    )
    return () => setRightContent(null)
  }, [atualizadoEm, carregando, erro, carregar, setRightContent])

  // Clicar numa linha abre a lista de pacientes daquele analista; clicar num
  // paciente ali dentro abre o PdiDetalheModal de verdade (o mesmo de Controle
  // de Prazos) POR CIMA, com a lista do coordenador viva atrás — pedido do
  // usuário (05/09/2026): "poderei ver o nome dos pacientes e quem está em cada
  // categoria".
  //
  // A versão anterior fechava a lista ao abrir o paciente, então revisar 4
  // pacientes do mesmo coordenador custava 4 idas e voltas para reencontrar a
  // linha. Agora fechar o paciente devolve a lista exatamente onde estava.
  //
  // Guarda-se o ID, não o objeto `LinhaAnalista`: com o modal do paciente
  // aberto por cima, salvar uma edição recalcula `linhas` — um snapshot preso
  // no estado mostraria contagens velhas no cabeçalho do modal de trás
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
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
      {erro && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
            <RotateCw
              className={`h-3.5 w-3.5 ${carregando ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
            {carregando ? "Tentando…" : "Tentar de novo"}
          </button>
        </div>
      )}

      <ResumoAcao
        resumo={resumo}
        semaforo={semaforo}
        semNumeros={semNumeros}
        recorte={recorte}
        onRecorte={setRecorte}
      />

      <FiltrosPainelAnalista
        linhas={linhas}
        recorte={recorte}
        onRecorte={setRecorte}
        busca={busca}
        onBusca={setBusca}
        analistaId={analistaFiltrado}
        onAnalista={setAnalistaFiltrado}
        temFiltro={filtroAtivo}
        onLimpar={limparFiltros}
        desabilitado={semNumeros}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ListaPrioridade
          linhas={linhas}
          visiveis={linhasVisiveis}
          piorAtrasoPorAnalista={piorAtrasoPorAnalista}
          carregando={carregando}
          erro={erro}
          onAbrir={setAnalistaAbertoId}
        />
        <DistribuicaoGeral resumo={resumo} semNumeros={semNumeros} />
      </div>

      {meta && (
        <p className="text-xs text-muted-foreground">
          Relatório <span className="font-semibold">{meta.arquivoNome}</span> · {meta.linhasLidas} linhas lidas →{" "}
          {meta.itens} elegíveis · calculado em {meta.hoje.split("-").reverse().join("/")}
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
