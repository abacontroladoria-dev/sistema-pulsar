"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  CalendarPlus, ChevronLeft, ChevronRight, CloudDownload, Database, History, Lock, Stethoscope, UserRound, Users,
} from "lucide-react"
import toast from "react-hot-toast"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DatePicker } from "@/components/ui/date-picker"
import { tom } from "@/components/ui/pastel/pecas"
import { useHeader } from "@/contexts/HeaderContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { useDadosPeriodo, useGradeBase } from "@/hooks/useGrade"
import { dataBR, hojeBrasilia, somarDias } from "@/lib/disponibilidadeProfissional"
import {
  DIAS_CURTOS, diaDaSemana, foraDaJanelaDoPaciente, janelaDoPaciente, montarPeriodo, precisaReposicao,
  resumir, rotuloDia, rotuloMes, rotuloSemana, semanaDe, semanasDoMes,
} from "@/lib/grade/motor"
import { disponibilidadePaciente } from "@/services/grade.service"
import type { AgendamentoGrade, BloqueioGrade, DiaGrade, DisponibilidadePacienteGrade, HorarioGrade, ProfissionalGrade } from "@/types/grade"
import { ResumoPaciente, ResumoProfissional } from "./CartaoResumo"
import { ListaPacientes, ListaProfissionais, type LinhaPaciente, type LinhaProfissional } from "./ListaLateral"
import { PainelAgendamento } from "./PainelAgendamento"
import { PainelNovoBloqueio, PainelVerBloqueio } from "./PainelBloqueio"
import { PainelImportarTita } from "./PainelImportarTita"
import { PainelNovoAgendamento, type InicialNovo } from "./PainelNovoAgendamento"
import { PainelRegistro } from "./PainelRegistro"
import {
  BlocoHorario, CartaoSessao, Legenda, TOM_ESTADO, grupoDoEstado, janelaDeTempo, minutos, type FiltroEstados, type ItemColuna,
} from "./pecas"
import { CabecalhoDia, GradeColunas, GradeMes, type ColunaGrade, type NumerosDia } from "./visoes"

// Grade — agenda própria do Pulsar (docs/PLANO_GRADE_CRONOGRAMA.md).
//
//   ?visao=profissional|paciente  &periodo=dia|semana|mes  &data=AAAA-MM-DD  &id=…
//
// A página NÃO lê o TiTa ao abrir (CronogramaDataLayout pula esta rota): o TiTa
// só entra pelo botão "Importar do TiTa". Toda alteração feita aqui vale só no
// Pulsar.

type Visao = "profissional" | "paciente"
type Periodo = "dia" | "semana" | "mes"

type Painel =
  | { tipo: "sessao"; a: AgendamentoGrade; foraDaGrade: boolean }
  | { tipo: "novo"; inicial: InicialNovo }
  | { tipo: "bloqueio-novo"; inicial: { profissionalId?: number | null; data?: string; inicio?: string; fim?: string } }
  | { tipo: "bloqueio"; b: BloqueioGrade }
  | { tipo: "importar" }
  | { tipo: "registro" }
  | { tipo: "lista" }
  | null

const ehData = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
]

export function GradeShell() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const hoje = hojeBrasilia()

  const visao: Visao = params.get("visao") === "paciente" ? "paciente" : "profissional"
  const pp = params.get("periodo")
  const periodo: Periodo = pp === "dia" || pp === "mes" ? pp : "semana"
  const data = ehData(params.get("data")) ? params.get("data")! : hoje
  const id = Number(params.get("id")) || null

  const ir = useCallback((patch: Partial<{ visao: Visao; periodo: Periodo; data: string; id: number | null }>) => {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") q.delete(k)
      else q.set(k, String(v))
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false })
  }, [params, pathname, router])

  const [painel, setPainel] = useState<Painel>(null)
  const [ocultos, setOcultos] = useState<FiltroEstados>(new Set())
  const [filtroDia, setFiltroDia] = useState("")

  // ── Dados ───────────────────────────────────────────────────────────────────
  const base = useGradeBase(visao === "paciente" || painel?.tipo === "novo")
  const { terapias: catalogo } = useCadastroTerapias()
  const semana = useMemo(() => semanaDe(data), [data])
  const dadosSemana = useDadosPeriodo({ de: semana[0], ate: semana[6] })
  const semanasMes = useMemo(() => semanasDoMes(data), [data])
  const datasMes = useMemo(() => semanasMes.flat(), [semanasMes])
  const dadosMes = useDadosPeriodo({
    de: datasMes[0], ate: datasMes[datasMes.length - 1],
    profissionais: visao === "profissional" && id ? [id] : undefined,
    pacienteId: visao === "paciente" ? id : null,
    incluirFaixas: visao === "profissional",
    ativo: periodo === "mes" && !!id,
  })
  // Guardada com o id de quem foi lida: trocar de paciente não mostra a janela do anterior.
  const [dispLida, setDispLida] = useState<{ id: number; d: DisponibilidadePacienteGrade | null } | null>(null)
  useEffect(() => {
    if (visao !== "paciente" || !id) return
    let vivo = true
    disponibilidadePaciente(id).then(d => vivo && setDispLida({ id, d })).catch(() => {})
    return () => { vivo = false }
  }, [visao, id])
  const dispPac = visao === "paciente" && dispLida?.id === id ? dispLida.d : null

  const recarregar = useCallback(() => {
    void dadosSemana.recarregar()
    void dadosMes.recarregar()
    void base.recarregar()
  }, [dadosSemana, dadosMes, base])

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])
  const corDe = useCallback((terapiaId: number) => catalogoPorId.get(terapiaId)?.cor_hex ?? null, [catalogoPorId])
  const profPorId = useMemo(() => new Map(base.profissionais.map(p => [p.id, p])), [base.profissionais])
  const focal = useCallback((p: ProfissionalGrade) => {
    const t = catalogoPorId.get(p.terapia_focal_id ?? p.terapias[0] ?? -1)
    return { cor: t?.cor_hex ?? null, icone: t?.icone ?? null }
  }, [catalogoPorId])

  // ── Cabeçalho ───────────────────────────────────────────────────────────────
  const { setHeader, setRightContent } = useHeader()
  useEffect(() => { setHeader("Grade", "Agenda do Pulsar — por profissional e por paciente") }, [setHeader])
  const profSel = visao === "profissional" && id ? profPorId.get(id) ?? null : null
  useEffect(() => {
    const imp = base.importacao
    // Mesma tipografia e moldura dos botões do header em /cadastros/profissionais
    // (fonte padrão do Pulsar: text-sm semibold, não o kit pastel).
    const secundario = `inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-sm font-semibold text-foreground hover:bg-muted ${foco}`
    setRightContent(
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => setPainel({ tipo: "registro" })} title="Registro de alterações" aria-label="Registro de alterações"
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted ${foco}`}>
          <History className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => setPainel({ tipo: "bloqueio-novo", inicial: { profissionalId: profSel?.id ?? null, data } })}
          className={secundario} title="Bloquear horário de um profissional">
          <Lock className="h-4 w-4" aria-hidden /><span className="hidden xl:inline">Bloquear</span>
        </button>
        <button type="button" onClick={() => setPainel({ tipo: "importar" })}
          title={imp?.aplicada_em ? `Última importação: ${new Date(imp.aplicada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}${imp.aplicada_por_nome ? ` por ${imp.aplicada_por_nome}` : ""}` : "Nenhuma importação ainda"}
          className={secundario}>
          <CloudDownload className="h-4 w-4" aria-hidden /><span className="hidden xl:inline">Importar do TiTa</span>
        </button>
        <button type="button" onClick={() => setPainel({ tipo: "novo", inicial: { profissionalId: profSel?.id ?? null, pacienteId: visao === "paciente" ? id : null, data } })}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${foco}`}>
          <CalendarPlus className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Novo agendamento</span>
        </button>
      </div>
    )
    return () => setRightContent(null)
  }, [setRightContent, base.importacao, profSel, visao, id, data])

  // ── Abrir painéis a partir da grade ─────────────────────────────────────────
  const abrirSessao = useCallback((a: AgendamentoGrade, foraDaGrade = false) => setPainel({ tipo: "sessao", a, foraDaGrade }), [])
  const abrirLivre = useCallback((h: HorarioGrade, profissionalId: number) =>
    setPainel({ tipo: "novo", inicial: { profissionalId, data: h.data, inicio: h.inicio, fim: h.fim, pacienteId: visao === "paciente" ? id : null } }), [visao, id])
  const abrirFechado = useCallback((h: HorarioGrade, bloqueios: BloqueioGrade[]) => {
    if (h.fechado?.origem === "bloqueio") {
      const b = bloqueios.find(x => x.id === h.fechado?.bloqueioId)
      if (b) setPainel({ tipo: "bloqueio", b })
    } else if (h.fechado) {
      toast(`Feriado: ${h.fechado.motivo}. Feriados ficam em Cadastros → Feriados.`, { icon: "📅" })
    }
  }, [])

  const itensDoDia = useCallback((dia: DiaGrade, profissionalId: number, bloqueios: BloqueioGrade[]): ItemColuna[] =>
    dia.horarios
      .filter(h => !ocultos.has(grupoDoEstado(h.estado)))
      .map(h => ({
        chave: `${profissionalId}-${h.data}-${h.inicio}-${h.estado}`,
        ini: minutos(h.inicio),
        fim: minutos(h.fim),
        conteudo: (altura: number) => (
          <BlocoHorario h={h} altura={altura} corDe={corDe}
            onSessao={a => abrirSessao(a, h.estado === "fora_da_grade")}
            onLivre={h.data >= hoje ? hh => abrirLivre(hh, profissionalId) : undefined}
            onFechado={hh => abrirFechado(hh, bloqueios)} />
        ),
      })), [ocultos, corDe, abrirSessao, abrirLivre, abrirFechado, hoje])

  // ── Lista lateral ───────────────────────────────────────────────────────────
  const diasPorProf = useMemo(() => {
    const m = new Map<number, DiaGrade[]>()
    for (const p of base.profissionais) {
      m.set(p.id, montarPeriodo({ profissional: p, datas: semana, faixas: dadosSemana.faixas, agendamentos: dadosSemana.agendamentos, bloqueios: dadosSemana.bloqueios, feriados: dadosSemana.feriados }))
    }
    return m
  }, [base.profissionais, semana, dadosSemana.faixas, dadosSemana.agendamentos, dadosSemana.bloqueios, dadosSemana.feriados])

  const linhasProf: LinhaProfissional[] = useMemo(() => base.profissionais.map(p => {
    const f = focal(p)
    const dias = diasPorProf.get(p.id) ?? []
    return {
      p, cor: f.cor, icone: f.icone,
      terapias: p.terapias.map(t => catalogoPorId.get(t)).filter(Boolean).map(t => ({ nome: t!.nome, cor: t!.cor_hex, terapiaId: t!.id })),
      semana: dias.length ? resumir(dias) : null,
    }
  }), [base.profissionais, diasPorProf, catalogoPorId, focal])

  const opcoesTerapia = useMemo(() => {
    const usadas = new Set(base.profissionais.flatMap(p => p.terapias))
    return catalogo.filter(t => usadas.has(t.id)).map(t => ({ id: t.id, nome: t.nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  }, [base.profissionais, catalogo])

  const linhasPac: LinhaPaciente[] = useMemo(() => {
    const porPac = new Map<number, { sessoes: number; reposicao: number }>()
    for (const a of dadosSemana.agendamentos) {
      const r = porPac.get(a.paciente_id) ?? { sessoes: 0, reposicao: 0 }
      r.sessoes++
      if (precisaReposicao(a, profPorId)) r.reposicao++
      porPac.set(a.paciente_id, r)
    }
    return (base.pacientes ?? []).map(p => ({
      id: p.id_paciente, nome: p.nome, convenio: p.convenio_nome, ativo: p.ativo,
      sessoes: porPac.get(p.id_paciente)?.sessoes ?? 0, reposicao: porPac.get(p.id_paciente)?.reposicao ?? 0,
    }))
  }, [base.pacientes, dadosSemana.agendamentos, profPorId])

  const selecionar = (novoId: number) => { ir({ id: novoId }); if (painel?.tipo === "lista") setPainel(null) }
  const lista = visao === "profissional"
    ? <ListaProfissionais linhas={linhasProf} selecionado={id} onSelecionar={selecionar} opcoesTerapia={opcoesTerapia} />
    : <ListaPacientes linhas={linhasPac} selecionado={id} onSelecionar={selecionar} carregando={!base.pacientes} />

  // ── Conteúdo principal ─────────────────────────────────────────────────────
  const pacSel = visao === "paciente" && id ? (base.pacientes ?? []).find(p => p.id_paciente === id) ?? null : null

  const conteudo = useMemo(() => {
    // Por Profissional — Dia: todos lado a lado.
    if (visao === "profissional" && periodo === "dia") {
      const q = filtroDia.trim().toLowerCase()
      const colunas: ColunaGrade[] = []
      const todosDias: DiaGrade[] = []
      for (const p of base.profissionais) {
        if (q && !p.nome.toLowerCase().includes(q)) continue
        const dia = (diasPorProf.get(p.id) ?? []).find(d => d.data === data)
        if (!dia || !dia.horarios.length) continue
        todosDias.push(dia)
        const f = focal(p)
        colunas.push({
          chave: String(p.id),
          aba: p.nome.split(" ")[0],
          cabecalho: (
            <button type="button" onClick={() => ir({ id: p.id, periodo: "semana" })} title={`Abrir a semana de ${p.nome}`}
              className="flex w-full min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 text-left hover:bg-[var(--pp-muted)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.cor ?? "var(--pp-border-strong)" }} aria-hidden />
              <span className="truncate text-sm font-extrabold">{p.nome}</span>
            </button>
          ),
          itens: itensDoDia(dia, p.id, dadosSemana.bloqueios),
        })
      }
      return { tipo: "colunas" as const, colunas, dias: todosDias, resumo: resumir(todosDias) }
    }

    // Por Profissional — Semana / Mês: um profissional.
    if (visao === "profissional") {
      if (!profSel) return { tipo: "escolher" as const }
      if (periodo === "mes") {
        const dias = montarPeriodo({ profissional: profSel, datas: datasMes, faixas: dadosMes.faixas, agendamentos: dadosMes.agendamentos, bloqueios: dadosMes.bloqueios, feriados: dadosMes.feriados })
        const numeros = new Map<string, NumerosDia>(dias.map(d => {
          const r = resumir([d])
          return [d.data, { agendados: r.agendados - r.reposicao, livres: r.disponiveis, bloqueados: r.bloqueados, reposicao: r.reposicao, feriado: d.feriado?.nome ?? null }]
        }))
        const doMes = dias.filter(d => d.data.slice(0, 7) === data.slice(0, 7))
        return { tipo: "mes" as const, numeros, resumo: resumir(doMes) }
      }
      const dias = diasPorProf.get(profSel.id) ?? []
      const colunas: ColunaGrade[] = dias.map(d => ({
        chave: d.data,
        aba: `${DIAS_CURTOS[diaDaSemana(d.data)]} ${Number(d.data.slice(8, 10))}`,
        cabecalho: <CabecalhoDia data={d.data} hoje={hoje} extra={d.feriado ? <Lock className="h-3.5 w-3.5" aria-label={`Feriado: ${d.feriado.nome}`} /> : null} />,
        itens: itensDoDia(d, profSel.id, dadosSemana.bloqueios),
        estreita: [0, 6].includes(diaDaSemana(d.data)) && !d.horarios.length,
        destaque: d.data === hoje,
        aviso: d.feriado && !d.horarios.length ? <AvisoFeriado nome={d.feriado.nome} /> : null,
      }))
      return { tipo: "colunas" as const, colunas, dias, resumo: resumir(dias) }
    }

    // Por Paciente.
    if (!id) return { tipo: "escolher" as const }
    const fonte = periodo === "mes" ? dadosMes.agendamentos : dadosSemana.agendamentos
    const doPac = fonte.filter(a => a.paciente_id === id)
    if (periodo === "mes") {
      const numeros = new Map<string, NumerosDia>()
      const feriados = new Map(dadosMes.feriados.map(f => [f.data, f.nome]))
      for (const d of datasMes) {
        const s = doPac.filter(a => a.data === d)
        const rep = s.filter(a => precisaReposicao(a, profPorId)).length
        numeros.set(d, { agendados: s.length - rep, livres: 0, bloqueados: 0, reposicao: rep, feriado: feriados.get(d) ?? null })
      }
      return { tipo: "mes" as const, numeros, sessoes: doPac.filter(a => a.data.slice(0, 7) === data.slice(0, 7)) }
    }
    const datas = periodo === "dia" ? [data] : semana
    const feriados = new Map(dadosSemana.feriados.map(f => [f.data, f]))
    const colunas: ColunaGrade[] = datas.map(d => {
      const s = doPac.filter(a => a.data === d)
      const janela = janelaDoPaciente(dispPac, d)
      const itens: ItemColuna[] = s
        .map(a => ({ a, rep: precisaReposicao(a, profPorId), fora: foraDaJanelaDoPaciente(dispPac, a) }))
        .filter(x => !ocultos.has(x.rep ? "inativo" : "agendado"))
        .map(({ a, rep, fora }) => ({
          chave: a.id, ini: minutos(a.hora_inicio), fim: minutos(a.hora_fim),
          conteudo: (altura: number) => (
            <CartaoSessao a={a} cor={corDe(a.terapia_id)} titulo={a.profissional_nome} linhas={altura >= 70 ? 3 : altura >= 44 ? 2 : 1}
              alerta={rep ? { t: "vermelho", rotulo: "reposição" } : fora ? { t: "amber", rotulo: "fora da janela" } : null}
              onClick={() => abrirSessao(a)} />
          ),
        }))
      const fer = feriados.get(d)
      return {
        chave: d,
        aba: `${DIAS_CURTOS[diaDaSemana(d)]} ${Number(d.slice(8, 10))}`,
        cabecalho: <CabecalhoDia data={d} hoje={hoje} extra={fer ? <Lock className="h-3.5 w-3.5" aria-label={`Feriado: ${fer.nome}`} /> : null} />,
        itens,
        fundo: janela ? [{ ini: minutos(janela.inicio), fim: minutos(janela.fim), rotulo: `Família disponível ${janela.inicio}–${janela.fim}` }] : undefined,
        estreita: periodo === "semana" && [0, 6].includes(diaDaSemana(d)) && !s.length,
        destaque: d === hoje,
        aviso: fer ? <AvisoFeriado nome={fer.nome} /> : null,
      }
    })
    return { tipo: "colunas" as const, colunas, dias: [], sessoes: doPac.filter(a => datas.includes(a.data)) }
  }, [visao, periodo, filtroDia, base.profissionais, diasPorProf, data, focal, itensDoDia, dadosSemana.bloqueios, dadosSemana.agendamentos, dadosSemana.feriados,
      profSel, datasMes, dadosMes.faixas, dadosMes.agendamentos, dadosMes.bloqueios, dadosMes.feriados, hoje, id, semana, dispPac, profPorId, ocultos, corDe, abrirSessao, ir])

  const janela = useMemo(() => {
    if (conteudo.tipo !== "colunas") return { de: 8 * 60, ate: 18 * 60 }
    const intervalos = conteudo.colunas.flatMap(c => [...c.itens.map(i => ({ ini: i.ini, fim: i.fim })), ...(c.fundo ?? [])])
    return janelaDeTempo(intervalos)
  }, [conteudo])

  // Contagens da legenda (no que está na tela).
  const contagens = useMemo(() => {
    const c: Partial<Record<keyof typeof TOM_ESTADO, number>> = { disponivel: 0, agendado: 0, bloqueado: 0, fora_da_grade: 0, inativo: 0 }
    if ("dias" in conteudo && conteudo.dias?.length) {
      for (const d of conteudo.dias) for (const h of d.horarios) {
        const g = grupoDoEstado(h.estado)
        c[g] = (c[g] ?? 0) + (g === "disponivel" || g === "bloqueado" ? 1 : h.ocupados.length)
      }
    } else if ("sessoes" in conteudo && conteudo.sessoes) {
      for (const a of conteudo.sessoes) {
        const g = precisaReposicao(a, profPorId) ? "inativo" : "agendado"
        c[g] = (c[g] ?? 0) + 1
      }
    }
    return c
  }, [conteudo, profPorId])

  // ── Navegação ───────────────────────────────────────────────────────────────
  const passo = periodo === "dia" ? 1 : periodo === "semana" ? 7 : 0
  const navegar = (dir: -1 | 1) => {
    if (periodo === "mes") {
      const [a, m] = data.split("-").map(Number)
      const alvo = new Date(Date.UTC(a, m - 1 + dir, 1)).toISOString().slice(0, 10)
      ir({ data: alvo })
    } else ir({ data: somarDias(data, dir * passo) })
  }
  const rotuloPeriodo = periodo === "dia" ? rotuloDia(data) : periodo === "semana" ? rotuloSemana(semana) : rotuloMes(data)

  // ── Estados de erro ─────────────────────────────────────────────────────────
  if (base.naoInstalada || dadosSemana.naoInstalada) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <InlineNotice tone="amber" icon={<Database className="h-4 w-4" />}>
          A Grade ainda não existe neste banco. Aplique as migrations <strong>20261007150800</strong> e <strong>20261008100000</strong> a <strong>20261008100400</strong> e recarregue a página.
        </InlineNotice>
      </div>
    )
  }
  const erro = base.erro ?? dadosSemana.erro ?? dadosMes.erro
  const carregando = base.carregando || dadosSemana.carregando || (periodo === "mes" && dadosMes.carregando)
  const resumoPeriodo = periodo === "dia" ? "no dia" : periodo === "semana" ? "na semana" : "no mês"

  return (
    <div className="pp mx-auto w-full max-w-[1600px] px-4 py-5">
      {erro && (
        <div role="alert" className="mb-4">
          <InlineNotice tone="red" icon={<Database className="h-4 w-4" />}>{erro}</InlineNotice>
        </div>
      )}

      <div className="flex gap-5">
        {/* Lista à esquerda (tela larga) */}
        <aside className="sticky top-4 hidden h-[calc(100vh-8rem)] w-80 shrink-0 lg:block" aria-label={visao === "profissional" ? "Profissionais" : "Pacientes"}>
          {lista}
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          {/* Barra: visão, período, navegação */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full bg-[var(--pp-muted)] p-1" role="tablist" aria-label="Visão">
              {([["profissional", "Por Profissional", Stethoscope], ["paciente", "Por Paciente", UserRound]] as const).map(([v, r, I]) => (
                <button key={v} type="button" role="tab" aria-selected={visao === v} onClick={() => ir({ visao: v, id: null })}
                  className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-extrabold transition-colors ${visao === v ? `${tom("aco")} bg-[var(--c)] text-[var(--c-sobre)]` : "text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]"}`}>
                  <I className="h-4 w-4" aria-hidden />{r}
                </button>
              ))}
            </div>
            <div className="flex rounded-full bg-[var(--pp-muted)] p-1" role="tablist" aria-label="Período">
              {PERIODOS.map(p => (
                <button key={p.valor} type="button" role="tab" aria-selected={periodo === p.valor} onClick={() => ir({ periodo: p.valor })}
                  className={`min-h-11 rounded-full px-4 text-sm font-extrabold transition-colors ${periodo === p.valor ? `${tom("aco")} bg-[var(--c)] text-[var(--c-sobre)]` : "text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]"}`}>
                  {p.rotulo}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => navegar(-1)} className="pp-iconbtn h-11 w-11" aria-label="Anterior"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
              <button type="button" onClick={() => ir({ data: hoje })} className={`${tom("aco")} pp-btn pp-btn-suave min-h-11 px-4`}>Hoje</button>
              <button type="button" onClick={() => navegar(1)} className="pp-iconbtn h-11 w-11" aria-label="Próximo"><ChevronRight className="h-5 w-5" aria-hidden /></button>
            </div>
            <div className="w-40"><DatePicker value={data} onChange={v => v && ir({ data: v })} classeGatilho="h-11" /></div>
            <p className="min-w-0 text-[16px] font-extrabold" aria-live="polite">{rotuloPeriodo}</p>
            {carregando && <span className="text-xs font-semibold text-[var(--pp-ink-muted)]">Carregando…</span>}
          </div>

          {/* Escolher (celular) */}
          <button type="button" onClick={() => setPainel({ tipo: "lista" })}
            className={`${tom("aco")} pp-btn pp-btn-suave min-h-11 w-full justify-between lg:hidden`}>
            <span className="flex min-w-0 items-center gap-2">
              {visao === "profissional" ? <Stethoscope className="h-4 w-4" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />}
              <span className="truncate">{profSel?.nome ?? pacSel?.nome ?? (visao === "profissional" ? "Escolher profissional" : "Escolher paciente")}</span>
            </span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>

          {/* Resumo */}
          {profSel && periodo !== "dia" && "resumo" in conteudo && conteudo.resumo && (
            <ResumoProfissional p={profSel} {...focal(profSel)} resumo={conteudo.resumo} periodo={resumoPeriodo} />
          )}
          {pacSel && "sessoes" in conteudo && conteudo.sessoes && (
            <ResumoPaciente nome={pacSel.nome} convenio={pacSel.convenio_nome} periodo={resumoPeriodo}
              sessoes={conteudo.sessoes.length}
              profissionais={new Set(conteudo.sessoes.map(a => a.profissional_id)).size}
              reposicao={conteudo.sessoes.filter(a => precisaReposicao(a, profPorId)).length}
              foraDaJanela={conteudo.sessoes.filter(a => foraDaJanelaDoPaciente(dispPac, a)).length}
              semDisponibilidade={!dispPac} />
          )}

          {conteudo.tipo !== "escolher" && conteudo.tipo !== "mes" && <Legenda contagens={contagens} ocultos={ocultos}
            onAlternar={k => setOcultos(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })} />}

          <section className="rounded-2xl border border-[var(--pp-border)] bg-[var(--pp-surface)] p-3 shadow-[var(--pp-sombra)] sm:p-4" aria-label="Grade">
            {conteudo.tipo === "escolher" ? (
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                {visao === "profissional" ? <Stethoscope className="h-9 w-9 text-[var(--pp-ink-muted)]" aria-hidden /> : <Users className="h-9 w-9 text-[var(--pp-ink-muted)]" aria-hidden />}
                <p className="text-base font-extrabold">{visao === "profissional" ? "Escolha um profissional na lista" : "Escolha um paciente na lista"}</p>
                <p className="max-w-md text-sm font-semibold text-[var(--pp-ink-muted)]">
                  {visao === "profissional"
                    ? "A grade de cada profissional vem da Disponibilidade do cadastro. Em “Dia”, todos aparecem lado a lado."
                    : "Mostra as sessões do paciente com todos os profissionais e a disponibilidade que a família informou."}
                </p>
              </div>
            ) : conteudo.tipo === "mes" ? (
              <GradeMes semanas={semanasMes} mes={data.slice(0, 7)} hoje={hoje} numeros={conteudo.numeros}
                onAbrirDia={d => ir({ data: d, periodo: "semana" })} />
            ) : (
              <>
                {visao === "profissional" && periodo === "dia" && (
                  <input type="text" value={filtroDia} onChange={e => setFiltroDia(e.target.value)} placeholder="Filtrar profissionais do dia"
                    aria-label="Filtrar profissionais do dia" className="mb-3 h-11 w-full max-w-xs rounded-xl border border-[var(--pp-border)] bg-[var(--pp-surface)] px-3 text-sm" />
                )}
                {conteudo.colunas.length ? (
                  <GradeColunas colunas={conteudo.colunas} janela={janela} abaInicial={hoje}
                    larguraMin={visao === "profissional" && periodo === "dia" ? 150 : 128}
                    rotuloAbas={periodo === "dia" && visao === "profissional" ? "Profissionais do dia" : "Dias da semana"} />
                ) : (
                  <p className="px-4 py-14 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">
                    {visao === "profissional" && periodo === "dia"
                      ? `Ninguém com grade ou sessão em ${dataBR(data)}.`
                      : "Nada neste período."}
                  </p>
                )}
              </>
            )}
          </section>
        </main>
      </div>

      {/* Painéis */}
      {painel?.tipo === "lista" && (
        <Drawer title={visao === "profissional" ? "Profissionais" : "Pacientes"} width={400} onClose={() => setPainel(null)}>
          <div className="pp h-[calc(100vh-9rem)]">{lista}</div>
        </Drawer>
      )}
      {painel?.tipo === "sessao" && (
        <PainelAgendamento a={painel.a} cor={corDe(painel.a.terapia_id)}
          reposicao={precisaReposicao(painel.a, profPorId)} foraDaGrade={painel.foraDaGrade}
          foraDaJanela={visao === "paciente" && foraDaJanelaDoPaciente(dispPac, painel.a)}
          onFechar={() => setPainel(null)} onMudou={recarregar} />
      )}
      {painel?.tipo === "novo" && (
        <PainelNovoAgendamento inicial={painel.inicial} profissionais={base.profissionais} pacientes={base.pacientes}
          catalogo={catalogo} onFechar={() => setPainel(null)} onCriado={recarregar} />
      )}
      {painel?.tipo === "bloqueio-novo" && (
        <PainelNovoBloqueio profissionais={base.profissionais} inicial={painel.inicial} onFechar={() => setPainel(null)} onCriado={recarregar} />
      )}
      {painel?.tipo === "bloqueio" && (
        <PainelVerBloqueio b={painel.b} nomeProfissional={profPorId.get(painel.b.profissional_id)?.nome ?? ""} onFechar={() => setPainel(null)} onMudou={recarregar} />
      )}
      {painel?.tipo === "importar" && <PainelImportarTita onFechar={() => setPainel(null)} onImportado={recarregar} />}
      {painel?.tipo === "registro" && (
        <PainelRegistro onFechar={() => setPainel(null)}
          profissional={profSel ? { id: profSel.id, nome: profSel.nome } : null}
          paciente={pacSel ? { id: pacSel.id_paciente, nome: pacSel.nome } : null} />
      )}
    </div>
  )
}

function AvisoFeriado({ nome }: { nome: string }) {
  return (
    <p className={`${tom("cinza")} flex items-center gap-1 rounded-lg bg-[var(--c-suave)] px-2 py-1 text-[11px] font-extrabold text-[var(--c-tinta)]`}>
      <Lock className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{nome}</span>
    </p>
  )
}
