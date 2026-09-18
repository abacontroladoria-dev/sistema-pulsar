"use client"

// NovoDiaDetalheModal — modalidade "Oportunidade via Novo Dia": ao contrário
// de Direto/Remanejamento (1 candidato fixo), aqui o usuário monta a
// combinação de sessões complementares ao vivo — a âncora (a vaga que
// motivou a oportunidade) vem sempre marcada e travada, as demais são
// opcionais. Quando um horário tem mais de 1 opção de terapia e/ou
// profissional, em vez de listar cada combinação como uma linha separada
// (o que virava uma lista enorme), o horário vira 1 único cartão com
// dropdowns de terapia/profissional — mesmo espírito do wizard "escolha a
// terapia, depois o profissional" de OcupPacMode.tsx (cronograma/ocupacao-
// paciente), só que sem os estágios "pendente" (aqui não há fila a
// resolver, é só exploração). Painel lateral mostra o contador
// autorizado×ofertado por especialidade e um aviso quando a seleção
// formaria um bloco de sessões isolado (regra: todo bloco contíguo precisa
// ter ≥2 sessões — nunca uma sessão sozinha entre buracos). Só visualização:
// não escreve nada na agenda real, igual às outras 2 modalidades desse tool.

import { Fragment, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  Apple, BookOpen, Brain, ChevronDown, Dumbbell, HeartHandshake, MessageCircle,
  Music, Paintbrush, PawPrint, PersonStanding, Plus, Puzzle, Users, Waves, X,
  type LucideIcon,
} from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { Button } from "@/components/ui/button"
import { DIAS_UTIL, TERAPIA_CORES, estiloUnidade, hexParaRgba, tCor, unidadeExibicao } from "@/lib/cronograma/constants"
import { diaCurto, fmtName } from "@/lib/cronograma/helpers"
import { horasEmBlocoInvalido, type OportunidadeNovoDia, type SessaoCandidataNovoDia } from "@/lib/cronograma/novoDia"
import type { CsvRow } from "@/types/cronograma"

// Mesmo sistema de ícone+cor por terapia de ComparativoSessoesShell.tsx
// (cronograma/indicadores/?tab=comparativo-sessoes), só que pela ESPECIALIDADE
// agregada (as chaves de gapPorEspecialidade), não pela terapia individual —
// a maioria dos nomes já bate 1:1 (ex.: "Fonoaudiologia"), só "Psicologia ABA"
// precisa de um desvio explícito pra achar a cor certa em TERAPIA_CORES (que é
// indexado por terapia, não por especialidade).
const ICONE_ESPECIALIDADE: Record<string, LucideIcon> = {
  "Arteterapia": Paintbrush,
  "Equoterapia": PawPrint,
  "Fisioterapia": Dumbbell,
  "Fisioterapia Aquática": Waves,
  "Fonoaudiologia": MessageCircle,
  "Habilidades Sociais": Users,
  "Musicoterapia": Music,
  "Psicologia": HeartHandshake,
  "Psicologia ABA": Brain,
  "Psicomotricidade": PersonStanding,
  "Psicopedagogia": BookOpen,
  "Terapia Alimentar": Apple,
  "Terapia Ocupacional": Puzzle,
}

/** Roxo — pedido do usuário: Psicologia ABA usa a MESMA cor de Coordenador de
 *  Caso em vez do cinza forçado que corTerapiaBadge() usa em outros badges de
 *  especialidade (lá o cinza existe pra não repetir a cor de nenhuma terapia
 *  específica do balde; aqui o pedido é o oposto). */
/** Escurece cores claras demais pra ler em cima de fundo branco (ex.:
 *  Psicopedagogia é um amarelo quase pastel em TERAPIA_CORES — ótimo pra tingir
 *  um fundo bem sutil, ilegível como cor de ícone/número/borda). Mesmo problema
 *  que corDotComContraste resolve em ComparativoSessoesShell.tsx (função
 *  privada daquele componente, não reaproveitável direto); aqui simplificado
 *  pra luminância perceptual (fórmula padrão de contraste WCAG simplificada). */
function corComContraste(hex: string): string {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  let tentativas = 0
  while ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72 && tentativas < 6) {
    r = Math.round(r * 0.8); g = Math.round(g * 0.8); b = Math.round(b * 0.8)
    tentativas++
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function corEspecialidade(especialidade: string): string {
  const base = especialidade === "Psicologia ABA" ? TERAPIA_CORES["Coordenador de Caso"] : tCor(especialidade)
  return corComContraste(base)
}

function hiStr(r: CsvRow): string { return String(r.HI_str || "") }
// Chave inclui a especialidade (não só profissional+hora) pra dar pra extrair
// de volta qual especialidade está ocupando cada horário sem precisar
// procurar na lista de candidatas de novo.
function chaveSessao(s: SessaoCandidataNovoDia): string { return `${s.especialidade}|||${s.profissional}|||${s.hora}` }
function especialidadeDaChave(chave: string): string { return chave.split("|||")[0] }

interface CelulaExistente { tipo: "existente"; terapia: string; prof: string; unidade: string }
type Celula = CelulaExistente

interface Props {
  oportunidade: OportunidadeNovoDia
  cRows: CsvRow[]
  onClose: () => void
}

export function NovoDiaDetalheModal({ oportunidade, cRows, onClose }: Props) {
  const chaveAncora = chaveSessao(oportunidade.ancora)

  const convenio = useMemo(
    () => cRows.find(r => r["Nome Favorecido"] === oportunidade.paciente && r["Convênio"])?.["Convênio"] as string | undefined,
    [cRows, oportunidade.paciente],
  )

  // Candidatas agrupadas por hora → especialidade → profissionais elegíveis
  // (exclui a hora da âncora, que é tratada à parte, sempre travada — é
  // literalmente a vaga que motivou a oportunidade, não uma escolha).
  const gruposPorHora = useMemo(() => {
    const m = new Map<string, Map<string, SessaoCandidataNovoDia[]>>()
    for (const c of oportunidade.candidatas) {
      if (c.hora === oportunidade.ancora.hora) continue
      const porEsp = m.get(c.hora) ?? new Map<string, SessaoCandidataNovoDia[]>()
      const lista = porEsp.get(c.especialidade) ?? []
      lista.push(c)
      porEsp.set(c.especialidade, lista)
      m.set(c.hora, porEsp)
    }
    return m
  }, [oportunidade])

  // hora -> chave da sessão escolhida pra essa hora (ausente = hora não
  // incluída no dia novo). No máximo 1 sessão por hora — fisicamente o
  // paciente não pode fazer 2 terapias ao mesmo tempo, mesmo quando há mais
  // de 1 opção elegível naquele horário.
  //
  // Estado inicial (mesmo padrão de OcupPacMode.tsx — sessões já vêm
  // pré-marcadas, não em branco esperando o usuário clicar em "adicionar"):
  // horário com 1 SÓ opção entra direto (sem ambiguidade pra decidir);
  // horário com VÁRIAS opções fica de fora até o usuário escolher qual —
  // é isso que diferencia a cor azul (auto, sem decisão) da amarela
  // (pendente, precisa decidir) mais abaixo na renderização.
  const [selecaoPorHora, setSelecaoPorHora] = useState<Record<string, string>>(() => {
    const sel: Record<string, string> = { [oportunidade.ancora.hora]: chaveAncora }
    const usadoPorEsp = new Map<string, number>([[oportunidade.ancora.especialidade, 1]])
    for (const hora of [...gruposPorHora.keys()].sort()) {
      const porEsp = gruposPorHora.get(hora)!
      if (porEsp.size > 1 || [...porEsp.values()][0].length > 1) continue // múltiplas opções — fica pendente
      const [esp, sessoes] = [...porEsp.entries()][0]
      const aut = oportunidade.gapPorEspecialidade[esp]?.aut ?? 0
      const usado = usadoPorEsp.get(esp) ?? 0
      if (usado + 1 > aut) continue // já esgotaria o autorizado — deixa disponível, não pré-marca
      sel[hora] = chaveSessao(sessoes[0])
      usadoPorEsp.set(esp, usado + 1)
    }
    return sel
  })

  function contagemPorEspSemHora(esp: string, horaExcluir: string): number {
    let n = 0
    for (const [hora, chave] of Object.entries(selecaoPorHora)) {
      if (hora === horaExcluir) continue
      if (especialidadeDaChave(chave) === esp) n++
    }
    return n
  }
  function excederiaGap(esp: string, horaExcluir: string): boolean {
    const g = oportunidade.gapPorEspecialidade[esp]
    if (!g) return true
    return contagemPorEspSemHora(esp, horaExcluir) + 1 > g.aut
  }

  // Toggle direto — só pra horário de opção ÚNICA (sem ambiguidade, então
  // "incluir"/"remover" é só ligar/desligar a mesma sessão candidata).
  function alternarHoraUnica(hora: string, sessao: SessaoCandidataNovoDia) {
    setSelecaoPorHora(prev => {
      if (prev[hora]) {
        const next = { ...prev }
        delete next[hora]
        return next
      }
      return { ...prev, [hora]: chaveSessao(sessao) }
    })
  }
  function escolherOpcao(hora: string, sessao: SessaoCandidataNovoDia) {
    setSelecaoPorHora(prev => ({ ...prev, [hora]: chaveSessao(sessao) }))
  }
  function removerHora(hora: string) {
    setSelecaoPorHora(prev => {
      if (!prev[hora]) return prev
      const next = { ...prev }
      delete next[hora]
      return next
    })
  }

  // Dropdown customizado (lista de botões, não <select>) pra escolher
  // terapia+profissional quando um horário tem mais de 1 opção — mesmo
  // espírito do wizard de OcupPacMode.tsx (cronograma/ocupacao-paciente), só
  // que num único nível (terapia e profissional juntos numa linha só), já
  // que aqui raramente há mais de 2-3 combinações por horário.
  //
  // Renderizado via portal em document.body, posicionado com `fixed` a
  // partir do retângulo do cartão que abriu ("rect") — a tabela vive dentro
  // de um container com scroll (overflow-x-auto) e o corpo do ScheduleModal
  // também rola; um dropdown `absolute` comum ficava cortado pela barra de
  // rolagem em vez de sobrepor o resto do conteúdo. Fecha ao rolar (em vez
  // de reposicionar continuamente) — simples e evita o dropdown "flutuar"
  // longe do cartão que o abriu.
  const [dropdownAberto, setDropdownAberto] = useState<{ hora: string; rect: DOMRect; abrirParaCima: boolean; maxHeight: number } | null>(null)
  // Decide o lado na hora de abrir: pra cima quando não sobra espaço suficiente
  // embaixo (ex.: horário perto do fim da tela, lista com muitas terapias) —
  // sem isso o usuário precisava reduzir o zoom do navegador pra ver a lista
  // inteira. maxHeight limita a lista ao espaço realmente disponível pro lado
  // escolhido, com rolagem própria dentro do dropdown como reforço pra listas
  // muito longas mesmo depois de escolher o melhor lado.
  function abrirDropdown(hora: string, rect: DOMRect) {
    const MARGEM = 8
    const espacoAbaixo = window.innerHeight - rect.bottom - MARGEM
    const espacoAcima = rect.top - MARGEM
    const abrirParaCima = espacoAbaixo < 220 && espacoAcima > espacoAbaixo
    setDropdownAberto({ hora, rect, abrirParaCima, maxHeight: Math.max(120, abrirParaCima ? espacoAcima : espacoAbaixo) })
  }
  useEffect(() => {
    if (!dropdownAberto) return
    function onMouseDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-novodia-dropdown]")) setDropdownAberto(null)
    }
    function onScroll() { setDropdownAberto(null) }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [dropdownAberto])

  const porEspecialidade = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const chave of Object.values(selecaoPorHora)) {
      const esp = especialidadeDaChave(chave)
      contagem.set(esp, (contagem.get(esp) ?? 0) + 1)
    }
    return Object.entries(oportunidade.gapPorEspecialidade).map(([especialidade, { aut, of }]) => {
      const selecionada = contagem.get(especialidade) ?? 0
      const ofProjetado = of + selecionada
      return { especialidade, aut, of, selecionada, ofProjetado, excesso: ofProjetado > aut }
    })
  }, [selecaoPorHora, oportunidade])

  const hasExcesso = porEspecialidade.some(p => p.excesso)

  const horasSelecionadas = Object.keys(selecaoPorHora)
  const horasInvalidas = horasEmBlocoInvalido(horasSelecionadas, oportunidade.turno)
  const blocoInvalido = horasInvalidas.length > 0
  const mensagemAviso = blocoInvalido
    ? `⚠ ${horasInvalidas.join(", ")} ficaria(m) sozinha(s) — marque uma sessão vizinha ou desmarque essa hora (todo bloco precisa ter ≥2 sessões contíguas).`
    : hasExcesso
      ? "⚠ Seleção ultrapassa o autorizado de alguma especialidade — desmarque sessões em excesso."
      : null

  // Semana COMPLETA do paciente (sessões "Agendado" já existentes nos outros
  // dias) — mesmo padrão de sessoesPaciente em PacienteAgendaHipoteticaModal —
  // pra dar contexto total do cronograma dele. O dia da oportunidade não tem
  // sessão existente nenhuma (é justamente por isso que ele qualifica).
  const sessoesPaciente = useMemo(() => {
    const vistos = new Set<string>()
    const res: { dia: string; hora: string; terapia: string; prof: string; unidade: string }[] = []
    for (const r of cRows) {
      if (r["Nome Favorecido"] !== oportunidade.paciente || r["Status do Agendamento"] !== "Agendado") continue
      const k = `${r["Dia da Semana"]}|||${hiStr(r)}|||${r.Terapia}|||${r.Profissional}`
      if (vistos.has(k)) continue
      vistos.add(k)
      res.push({ dia: r["Dia da Semana"], hora: hiStr(r), terapia: r.Terapia, prof: r.Profissional, unidade: String(r.Unidade || "Desconhecida") })
    }
    return res
  }, [cRows, oportunidade.paciente])

  const mapaExistentes: Record<string, Celula[]> = {}
  for (const s of sessoesPaciente) {
    const k = `${s.dia}|||${s.hora}`
    ;(mapaExistentes[k] ??= []).push({ tipo: "existente", terapia: s.terapia, prof: s.prof, unidade: s.unidade })
  }

  const diasComSessao = DIAS_UTIL
  const horasDoDiaNovo = [oportunidade.ancora.hora, ...gruposPorHora.keys()]
  const horasGrid = [...new Set([...Object.keys(mapaExistentes).map(k => k.split("|||")[1]), ...horasDoDiaNovo])].sort()

  // Manhã: 08:00-12:00 · Tarde: 12:30-17:40 — mesmo corte de AgendaProfissional/
  // RemanejamentoDetalheModal/PacienteAgendaHipoteticaModal, reaproveitado
  // aqui pra manter os 3 modais visualmente idênticos (pedido do usuário
  // 2026-08-17: 12:30 conta como Tarde, não Manhã).
  const CORTE_TARDE = "12:30"
  const horasManha = horasGrid.filter(h => h < CORTE_TARDE)
  const horasTarde = horasGrid.filter(h => h >= CORTE_TARDE)

  function unidadeDominante(horasTurno: string[], dia: string): string | null {
    if (dia === oportunidade.dia) return oportunidade.unidade
    const contagem = new Map<string, number>()
    for (const hora of horasTurno) {
      for (const c of mapaExistentes[`${dia}|||${hora}`] || []) {
        contagem.set(c.unidade, (contagem.get(c.unidade) ?? 0) + 1)
      }
    }
    let dominante: string | null = null
    let max = 0
    for (const [u, n] of contagem) {
      if (n > max) { max = n; dominante = u }
    }
    return dominante
  }

  return (
    <ScheduleModal
      title={oportunidade.paciente}
      maxWidth={1400}
      onClose={onClose}
      subtitle={convenio ? <span className="text-[13px] font-semibold">Convênio: {convenio}</span> : undefined}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div className="mb-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" /> Vaga-âncora (sempre incluída)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30" /> Incluída (única ou já escolhida)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" /> Várias opções — escolha pendente</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-border" /> Disponível, não incluída</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" /> Sessão existente (outro dia)</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="overflow-x-auto">
          {/* w-full (em vez de largura fixa em px) — as colunas mantêm a MESMA
              proporção entre si (56 pra hora, 1 parte por dia), mas esticam
              proporcionalmente pra preencher o espaço disponível no modal em
              vez de deixar sobra vazia quando a tela é larga. minWidth garante
              que nunca fica menor que o tamanho legível de antes (aciona o
              scroll horizontal do container em telas estreitas). */}
          <table className="w-full table-fixed border-collapse text-[11px]" style={{ minWidth: `${56 + diasComSessao.length * 128}px` }}>
            <colgroup>
              <col style={{ width: 56 }} />
              {diasComSessao.map(d => <col key={d} style={{ width: 128 }} />)}
            </colgroup>
            <thead><tr>
              <th className="w-14" />
              {diasComSessao.map(d => {
                const ehDiaNovo = d === oportunidade.dia
                return (
                  <th key={d} className={`rounded-t-lg pb-1.5 text-center ${ehDiaNovo ? "bg-amber-100 pt-1.5 dark:bg-amber-900/30" : ""}`}>
                    <div className={`uppercase ${ehDiaNovo ? "text-[14px] font-black text-amber-800 dark:text-amber-300" : "text-[11px] font-bold text-foreground"}`}>
                      {diaCurto(d)}
                    </div>
                    {ehDiaNovo && (
                      <div className="text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">Novo dia</div>
                    )}
                  </th>
                )
              })}
            </tr></thead>
            <tbody>
              {([
                { label: "Manhã", horasTurno: horasManha },
                { label: "Tarde", horasTurno: horasTarde },
              ] as const).map(turno => turno.horasTurno.length === 0 ? null : (
                <Fragment key={turno.label}>
                  <tr className="border-t border-border bg-muted/40">
                    <td className="py-1.5 pr-2 text-right text-[11px] font-black uppercase tracking-widest text-foreground/70">{turno.label}</td>
                    {diasComSessao.map(d => {
                      const u = unidadeDominante(turno.horasTurno, d)
                      return (
                        <td key={d} className="px-0.5 py-0">
                          {u && (
                            <div className={`rounded-md py-1 text-center text-[10px] font-black uppercase tracking-wide text-white ${estiloUnidade(u).bar}`}>
                              {unidadeExibicao(u)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                  {turno.horasTurno.map(hora => (
                    <tr key={hora} className="border-t border-border">
                      <td className="py-1 pr-2 text-right">
                        <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[13px] font-bold tabular-nums text-foreground">{hora}</span>
                      </td>
                      {diasComSessao.map(d => {
                        if (d !== oportunidade.dia) {
                          const celulas = mapaExistentes[`${d}|||${hora}`] || []
                          return (
                            <td key={d} className="px-0.5 py-0 align-top">
                              {celulas.map((c, ci) => {
                                const dominante = unidadeDominante(turno.horasTurno, d)
                                const combinaComDominante = c.unidade === dominante
                                return (
                                  <div key={ci} className="mb-0.5 flex h-[64px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-muted px-2 py-1.5">
                                    <div className="flex min-w-0 items-center justify-between gap-1">
                                      <span className="min-w-0 truncate text-[11px] font-bold leading-tight text-foreground">{c.terapia}</span>
                                      {!combinaComDominante && c.unidade !== "Desconhecida" && (
                                        <span className={`shrink-0 rounded px-1 text-[9px] font-black leading-tight ${estiloUnidade(c.unidade).bg} ${estiloUnidade(c.unidade).text}`}>{unidadeExibicao(c.unidade)}</span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{fmtName(c.prof)}</div>
                                  </div>
                                )
                              })}
                            </td>
                          )
                        }

                        // Coluna do dia novo: âncora (travada) ou grupo de
                        // candidatas complementares (dropdowns quando há mais
                        // de 1 opção de terapia/profissional nessa hora).
                        if (hora === oportunidade.ancora.hora) {
                          return (
                            <td key={d} className="px-0.5 py-0 align-top">
                              <div className="flex h-[64px] flex-col justify-center overflow-hidden rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5">
                                <div className="truncate text-[11px] font-bold leading-tight text-foreground">{oportunidade.ancora.terapia}</div>
                                <div className="truncate text-[10px] text-muted-foreground">{fmtName(oportunidade.ancora.profissional)}</div>
                                <div className="truncate text-[10px] font-bold text-emerald-700 dark:text-emerald-400">Vaga-âncora</div>
                              </div>
                            </td>
                          )
                        }

                        const porEsp = gruposPorHora.get(hora)
                        if (!porEsp) return <td key={d} className="px-0.5 py-0" />

                        // Opções achatadas (terapia+profissional) num nível só
                        // — na prática raramente passa de 2-3 combinações por
                        // horário, então não precisa do wizard em 2 estágios
                        // de OcupPacMode (escolher terapia, depois profissional).
                        const opcoes = [...porEsp.entries()].flatMap(([esp, sessoes]) => sessoes.map(sessao => ({ esp, sessao })))
                        const chaveAtual = selecaoPorHora[hora]
                        const opcaoAtual = chaveAtual ? opcoes.find(o => chaveSessao(o.sessao) === chaveAtual) ?? null : null
                        const temMultiplasOpcoes = opcoes.length > 1
                        const semOpcaoViavel = !chaveAtual && opcoes.every(o => excederiaGap(o.esp, hora))
                        const dropdownAbertoAqui = dropdownAberto?.hora === hora
                        // Cores: azul = incluída (opção única OU escolhida
                        // entre várias — mesma cor pras duas), amarelo =
                        // várias opções ainda sem escolha (pendente). Verde
                        // fica reservado só pra vaga-âncora.
                        const corCartao = opcaoAtual ? "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30" : null
                        const pendente = !opcaoAtual && temMultiplasOpcoes && !semOpcaoViavel

                        return (
                          <td key={d} className="px-0.5 py-0 align-top">
                            <div className="relative" data-novodia-dropdown={dropdownAbertoAqui || undefined}>
                              {/* Cartão inteiro clicável (não só um checkbox pequeno) —
                                  opção única liga/desliga direto; várias opções
                                  abrem a lista de escolha (mesmo espírito dos
                                  cards clicáveis e do wizard de OcupPacMode). */}
                              <div
                                role="button"
                                tabIndex={semOpcaoViavel ? -1 : 0}
                                aria-pressed={!!chaveAtual}
                                onClick={e => {
                                  if (semOpcaoViavel) return
                                  if (temMultiplasOpcoes) {
                                    if (dropdownAbertoAqui) setDropdownAberto(null); else abrirDropdown(hora, e.currentTarget.getBoundingClientRect())
                                  } else {
                                    alternarHoraUnica(hora, opcoes[0].sessao)
                                  }
                                }}
                                onKeyDown={e => {
                                  if (semOpcaoViavel || e.key !== "Enter" && e.key !== " ") return
                                  e.preventDefault()
                                  if (temMultiplasOpcoes) {
                                    if (dropdownAbertoAqui) setDropdownAberto(null); else abrirDropdown(hora, e.currentTarget.getBoundingClientRect())
                                  } else {
                                    alternarHoraUnica(hora, opcoes[0].sessao)
                                  }
                                }}
                                title={semOpcaoViavel ? "Todas as terapias desse horário já atingiriam o autorizado" : undefined}
                                className={`flex h-[64px] flex-col justify-center overflow-hidden rounded-lg border px-2 py-1.5 transition-colors ${
                                  semOpcaoViavel
                                    ? "cursor-not-allowed border-dashed border-border bg-transparent opacity-50"
                                    : corCartao
                                      ? `cursor-pointer hover:brightness-95 ${corCartao}`
                                      : pendente
                                        ? "cursor-pointer border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 hover:brightness-95"
                                        : "cursor-pointer border-dashed border-border bg-transparent hover:bg-muted/40"
                                }`}
                              >
                                {opcaoAtual ? (
                                  <>
                                    <div className="truncate pr-9 text-[11px] font-bold leading-tight text-foreground">{opcaoAtual.sessao.terapia}</div>
                                    <div className="truncate pr-9 text-[10px] text-muted-foreground">{fmtName(opcaoAtual.sessao.profissional)}</div>
                                    {temMultiplasOpcoes && (
                                      <div className="mt-0.5 flex items-center gap-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-400">
                                        Trocar <ChevronDown size={11} />
                                      </div>
                                    )}
                                  </>
                                ) : pendente ? (
                                  <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                    ⚠ Escolher terapia <ChevronDown size={11} />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                                    <Plus size={12} /> Adicionar sessão
                                  </div>
                                )}
                              </div>

                              {/* Botão X no canto superior direito — outro jeito de
                                  retirar a sessão além de clicar no cartão (que pra
                                  opção múltipla abre o dropdown em vez de remover
                                  direto) ou usar "Não incluir este horário" no
                                  dropdown. Selo de "incluída" já é a própria cor
                                  azul do cartão — um check ao lado do X era
                                  redundante. */}
                              {opcaoAtual && (
                                <div className="absolute right-1 top-1 z-10">
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); removerHora(hora) }}
                                    title="Retirar esta sessão do dia novo"
                                    aria-label="Retirar esta sessão do dia novo"
                                    className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              )}

                              {dropdownAbertoAqui && dropdownAberto && createPortal(
                                <div
                                  data-novodia-dropdown="true"
                                  className="fixed z-[100] w-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
                                  style={{
                                    ...(dropdownAberto.abrirParaCima
                                      ? { bottom: window.innerHeight - dropdownAberto.rect.top + 2 }
                                      : { top: dropdownAberto.rect.bottom + 2 }),
                                    left: dropdownAberto.rect.left,
                                    width: Math.max(dropdownAberto.rect.width, 180),
                                    maxHeight: dropdownAberto.maxHeight,
                                  }}
                                >
                                  {chaveAtual && (
                                    <button
                                      type="button"
                                      onClick={() => { removerHora(hora); setDropdownAberto(null) }}
                                      className="flex w-full items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-left text-[11px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    >
                                      <X size={13} className="shrink-0" /> Não incluir este horário
                                    </button>
                                  )}
                                  {opcoes.map(o => {
                                    const chave = chaveSessao(o.sessao)
                                    const selecionada = chave === chaveAtual
                                    const desabilitada = !selecionada && excederiaGap(o.esp, hora)
                                    return (
                                      <button
                                        key={chave}
                                        type="button"
                                        disabled={desabilitada}
                                        onClick={() => { escolherOpcao(hora, o.sessao); setDropdownAberto(null) }}
                                        className={`block w-full px-2.5 py-1.5 text-left transition-colors ${
                                          selecionada ? "bg-sky-50 dark:bg-sky-950/30"
                                          : desabilitada ? "cursor-not-allowed opacity-50"
                                          : "hover:bg-muted/60"
                                        }`}
                                      >
                                        <div className={`text-[11px] font-bold ${selecionada ? "text-sky-700 dark:text-sky-400" : "text-foreground"}`}>{o.esp}</div>
                                        <div className="text-[10px] text-muted-foreground">{fmtName(o.sessao.profissional)}{desabilitada ? " · excederia" : ""}</div>
                                      </button>
                                    )
                                  })}
                                </div>,
                                document.body,
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Autorizado × ofertado</div>
          <div className="flex flex-col gap-2">
            {porEspecialidade.map(p => {
              // Estourou o autorizado -> tudo vermelho (ícone, número, borda,
              // fundo); dentro do limite -> cor própria da terapia. Mesmo
              // princípio de destaque de OcupPacMode.tsx (cronograma/ocupacao-
              // paciente): a cor já entrega o veredito antes de ler o número.
              const cor = p.excesso ? "#dc2626" : corEspecialidade(p.especialidade)
              const Icone = ICONE_ESPECIALIDADE[p.especialidade]
              return (
                <div
                  key={p.especialidade}
                  className="flex items-center gap-2.5 rounded-lg border p-2.5"
                  style={{ borderColor: hexParaRgba(cor, 0.5), backgroundColor: hexParaRgba(cor, p.excesso ? 0.16 : 0.1) }}
                >
                  {Icone && <Icone size={30} strokeWidth={1.75} className="shrink-0" style={{ color: cor }} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-bold text-foreground" title={p.especialidade}>{p.especialidade}</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[22px] font-black leading-none tabular-nums" style={{ color: cor }}>{p.ofProjetado}</span>
                      <span className="text-[12px] font-semibold text-muted-foreground">/{p.aut}</span>
                      {p.excesso && <span className="ml-auto min-w-[34px] rounded px-2 py-0.5 text-center text-[10px] font-black text-white" style={{ backgroundColor: cor }}>acima</span>}
                      {!p.excesso && p.selecionada > 0 && <span className="ml-auto min-w-[34px] rounded px-2 py-0.5 text-center text-[10px] font-black text-white" style={{ backgroundColor: cor }}>+{p.selecionada}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {mensagemAviso && (
            <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              {mensagemAviso}
            </div>
          )}
        </div>
      </div>
    </ScheduleModal>
  )
}
