"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle, AlertTriangle, CalendarDays, CalendarSync, CheckCircle2, CircleDashed, CloudDownload, History, Loader2,
  LogOut, RefreshCw, ShieldCheck, UserRound, Users, type LucideIcon,
} from "lucide-react"
import toast from "react-hot-toast"
import { useHeader } from "@/contexts/HeaderContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { btnPrimario, btnSecundario, cartao } from "@/components/cronograma/grade/estilo"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import {
  rodadaDeDisponibilidade, rodadaDeGrade, rodadaDePacientes, rodadaDeProfissionais,
} from "@/components/tita/adaptadoresRelatorio"
import { RelatorioSincronizacaoTita, formatarDataHora, type RodadaRelatorio } from "@/components/tita/RelatorioSincronizacaoTita"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import { medirFrescorGrade, type FrescorGrade } from "@/lib/grade/fonte"
import { janelaImportacaoTita } from "@/lib/grade/janelaTita"
import { DEPENDENCIAS_TITA } from "@/lib/tita/dependencias"
import { lerCorteTita } from "@/services/corteTita.service"
import { gravarDisponibilidadeTita, lerImportacaoCompleta, prepararPreviaDisponibilidade } from "@/services/disponibilidadeTita.service"
import {
  aplicarImportacaoCompleta, atualizarCopiaTita, lerImportacaoGrade, listarImportacoesGrade, listarItensImportacaoGrade, previaImportacao,
} from "@/services/grade.service"
import { getHistoricoImportacoesPacientes, importarPacientesDaTita } from "@/services/pacientes.service"
import { importarDaTita } from "@/services/profissionais.service"
import { listarImportacoes, listarItensImportacao } from "@/services/titaImportacoes.service"

// "Carregar o Pulsar segundo o TiTa" — um botão que traz, NESTA ordem, tudo o
// que o Pulsar precisa para viver sem o TiTa: pacientes → profissionais →
// disponibilidades → agendamentos. Cada etapa depende da anterior (sessão de
// paciente sem cadastro vira pendência). Só lê as cópias do TiTa já
// sincronizadas no Supabase; NADA é enviado ao TiTa.
//
// Regras (15/10/2026): na disponibilidade e na agenda o TiTa prevalece no que
// veio dele; o que foi criado no Pulsar nunca é tocado (o banco recusa).
// Cada etapa usa a RPC do seu módulo, que exige a permissão do módulo.

type Etapa = "pacientes" | "profissionais" | "disponibilidade" | "agenda"
type Estado =
  | { t: "aguardando" }
  | { t: "rodando"; passo: string }
  | { t: "feito"; resumo: string[]; aviso?: string; abrir: () => Promise<void> }
  | { t: "erro"; mensagem: string }

const ETAPAS: { id: Etapa; titulo: string; Icone: LucideIcon; descricao: string }[] = [
  { id: "pacientes", titulo: "Pacientes", Icone: Users, descricao: "Cadastro, responsável e endereço. O convênio vem do CADASTRO do TiTa, nunca do agendamento." },
  { id: "profissionais", titulo: "Profissionais", Icone: UserRound, descricao: "Cadastro (CPF, registro, celular) e terapias habilitadas. Completa vazios; não sobrescreve edição." },
  { id: "disponibilidade", titulo: "Disponibilidades", Icone: CalendarSync, descricao: "Horários de cada profissional pela grade do TiTa das próximas duas semanas. O TiTa prevalece." },
  { id: "agenda", titulo: "Agendamentos", Icone: CalendarDays, descricao: "Sessões “Agendado” da grade do TiTa, em séries. O TiTa manda no que veio dele; o que foi criado no Pulsar fica." },
]

const INICIAL: Record<Etapa, Estado> = {
  pacientes: { t: "aguardando" }, profissionais: { t: "aguardando" }, disponibilidade: { t: "aguardando" }, agenda: { t: "aguardando" },
}

type Relatorio = {
  subtitulo: string
  rodadas: RodadaRelatorio[]
  detalhar?: (r: RodadaRelatorio) => Promise<RodadaRelatorio>
  vazio: string
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const ordenarPrimeiro = <T extends { id: string }>(lista: T[], id: string | null | undefined) =>
  id ? [...lista.filter(x => x.id === id), ...lista.filter(x => x.id !== id)] : lista

export default function CarregarTitaShell() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Carregar do TiTa", "Clona no Pulsar o que está no TiTa. Nada é enviado ao TiTa.")
    return () => setHeader("", "")
  }, [setHeader])

  const { terapias: catalogo } = useCadastroTerapias()
  const { confirmar, dialogo } = useConfirmacao()
  const janela = useMemo(() => janelaImportacaoTita(), [])
  const [estados, setEstados] = useState<Record<Etapa, Estado>>(INICIAL)
  const [rodando, setRodando] = useState(false)
  const [frescor, setFrescor] = useState<FrescorGrade | null>(null)
  const [corte, setCorte] = useState<string | null>(null)
  const [pedindoCopia, setPedindoCopia] = useState(false)
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)

  const lerFrescor = useCallback(async () => {
    try { setFrescor(await medirFrescorGrade(janela.inicio, janela.fim, 280)) } catch { /* só informativo */ }
  }, [janela])
  useEffect(() => {
    void lerFrescor()
    lerCorteTita().then(setCorte).catch(() => {})
  }, [lerFrescor])

  const definir = (etapa: Etapa, estado: Estado) => setEstados(prev => ({ ...prev, [etapa]: estado }))

  // ── Relatórios (o mesmo "Sincronização do TiTa" de cada tela) ───────────────
  const abrirPacientes = useCallback(async (logId?: string | null) => {
    const historico = await getHistoricoImportacoesPacientes(10)
    setRelatorio({
      subtitulo: "Pacientes trazidos da cópia da agenda do TiTa.",
      rodadas: ordenarPrimeiro(historico, logId).map(rodadaDePacientes),
      vazio: "Nenhuma importação de pacientes registrada.",
    })
  }, [])

  const abrirTita = useCallback(async (alvo: "profissionais" | "disponibilidade", id?: string | null) => {
    const execucoes = ordenarPrimeiro(await listarImportacoes(alvo, 10), id)
    const adaptar = alvo === "profissionais" ? rodadaDeProfissionais : rodadaDeDisponibilidade
    setRelatorio({
      subtitulo: alvo === "profissionais" ? "Cadastro de profissionais trazido do TiTa." : "Disponibilidade gravada a partir da grade do TiTa.",
      rodadas: execucoes.map(e => adaptar(e)),
      detalhar: async r => {
        const e = execucoes.find(x => x.id === r.id)
        return e ? adaptar(e, await listarItensImportacao(e.id)) : r
      },
      vazio: "Nenhuma execução registrada.",
    })
  }, [])

  const abrirAgenda = useCallback(async (id?: string | null) => {
    const execucoes = ordenarPrimeiro(await listarImportacoesGrade(10), id)
    setRelatorio({
      subtitulo: "Agenda trazida da cópia da grade do TiTa.",
      rodadas: execucoes.map(e => rodadaDeGrade(e)),
      detalhar: async r => {
        const e = execucoes.find(x => x.id === r.id)
        return e ? rodadaDeGrade(e, await listarItensImportacaoGrade(e.id)) : r
      },
      vazio: "Nenhuma importação da agenda registrada.",
    })
  }, [])

  const abrirHistorico = (etapa: Etapa) => {
    const p = etapa === "pacientes" ? abrirPacientes() : etapa === "agenda" ? abrirAgenda() : abrirTita(etapa)
    p.catch(e => toast.error(msg(e)))
  }

  // ── As quatro etapas ───────────────────────────────────────────────────────
  async function etapaPacientes() {
    definir("pacientes", { t: "rodando", passo: "Lendo o cadastro de pacientes do TiTa e trazendo…" })
    const r = await importarPacientesDaTita()
    if (!r.sucesso) throw new Error(r.erro ?? "A importação de pacientes falhou.")
    definir("pacientes", {
      t: "feito",
      resumo: [`${r.novos} novos`, `${r.atualizados} alterados`, `${r.vistos_na_tita} no TiTa`],
      aviso: r.avisoCadastro,
      abrir: () => abrirPacientes(r.log_id),
    })
  }

  async function etapaProfissionais() {
    definir("profissionais", { t: "rodando", passo: "Trazendo profissionais…" })
    const r = await importarDaTita()
    definir("profissionais", {
      t: "feito",
      resumo: [`${r.novos} novos`, `${r.atualizados} alterados`, `${r.vistos_na_tita} no TiTa`],
      abrir: () => abrirTita("profissionais", r.importacao_id),
    })
  }

  async function etapaDisponibilidade() {
    const previa = await prepararPreviaDisponibilidade({ catalogo, onPasso: passo => definir("disponibilidade", { t: "rodando", passo }) })
    const g = await gravarDisponibilidadeTita(previa, (feitos, total) =>
      definir("disponibilidade", { t: "rodando", passo: total ? `Gravando ${feitos} de ${total} lotes…` : "Conferindo…" }))
    const { imp } = await lerImportacaoCompleta(previa.id)
    definir("disponibilidade", {
      t: "feito",
      resumo: [`${imp.novos} novas`, `${imp.alterados} alteradas`, `${imp.iguais} iguais`, ...(imp.pendencias ? [`${imp.pendencias} pendências`] : [])],
      aviso: g.erros
        ? `${g.erros} profissional(is) não gravado(s) — veja o motivo no relatório.`
        : previa.foraDoCadastro.length ? `${previa.foraDoCadastro.length} da grade do TiTa sem cadastro no Pulsar.` : undefined,
      abrir: () => abrirTita("disponibilidade", previa.id),
    })
  }

  async function etapaAgenda() {
    definir("agenda", { t: "rodando", passo: `Lendo a grade do TiTa de ${dataBR(janela.inicio)} a ${dataBR(janela.fim)}…` })
    const previa = await previaImportacao(janela.inicio, janela.fim)
    if (previa.contadores.restaurados === undefined) {
      throw new Error("Falta aplicar a migration 20261016100000_grade_tita_manda_e_corte.sql. A agenda não foi tocada.")
    }
    if (previa.copia_velha) {
      throw new Error(`A cópia da grade do TiTa está velha (um dia foi conferido em ${formatarDataHora(previa.frescor_pior)}). Use "Atualizar a cópia do TiTa agora", espere e rode de novo. A agenda não foi tocada.`)
    }
    const a = await aplicarImportacaoCompleta(previa, (feitos, total) =>
      definir("agenda", { t: "rodando", passo: total ? `Gravando ${feitos} de ${total} lotes de profissionais…` : "Conferindo…" }))
    const imp = await lerImportacaoGrade(previa.importacao_id)
    definir("agenda", {
      t: "feito",
      resumo: [
        `${a.sessoes_novas} novas`, `${a.alteradas ?? 0} alteradas`, `${a.sumidos_excluidos} saíram`,
        ...(a.restauradas ? [`${a.restauradas} voltaram`] : []),
        `${imp.contadores.lidas} no TiTa`,
      ],
      aviso: previa.contadores.pendencias ? `${previa.contadores.pendencias} sessão(ões) com pendência de cadastro não entraram.` : undefined,
      abrir: () => abrirAgenda(previa.importacao_id),
    })
  }

  const EXECUTAR: Record<Etapa, () => Promise<void>> = {
    pacientes: etapaPacientes, profissionais: etapaProfissionais, disponibilidade: etapaDisponibilidade, agenda: etapaAgenda,
  }

  /** Roda a partir de `inicio` até o fim; para na primeira que falhar. */
  const rodar = async (inicio: Etapa = "pacientes") => {
    setRodando(true)
    const ordem = ETAPAS.map(e => e.id)
    const de = ordem.indexOf(inicio)
    setEstados(prev => {
      const n = { ...prev }
      for (const id of ordem.slice(de)) n[id] = { t: "aguardando" }
      return n
    })
    try {
      for (const id of ordem.slice(de)) {
        try {
          await EXECUTAR[id]()
        } catch (e) {
          definir(id, { t: "erro", mensagem: msg(e) })
          toast.error(`${ETAPAS.find(x => x.id === id)!.titulo}: ${msg(e)}`, { duration: 9000 })
          return
        }
      }
      toast.success("O Pulsar foi carregado segundo o TiTa. Confira o relatório de cada etapa.", { duration: 8000 })
    } finally {
      setRodando(false)
      void lerFrescor()
    }
  }

  const iniciar = async () => {
    if (!(await confirmar({
      titulo: "Carregar o Pulsar segundo o TiTa?",
      texto: "Traz, nesta ordem: pacientes, profissionais, disponibilidades e agendamentos da cópia do TiTa. "
        + "Nas disponibilidades e nos agendamentos que vieram do TiTa, o TiTa prevalece (o que está diferente aqui é trocado, e fica no histórico). "
        + "O que foi criado no Pulsar não é tocado. Nada é enviado ao TiTa.",
      confirmar: "Carregar agora",
      cancelar: "Ainda não",
      t: "aco",
      Icone: CloudDownload,
    }))) return
    await rodar("pacientes")
  }

  const pedirCopia = async () => {
    setPedindoCopia(true)
    try {
      await atualizarCopiaTita(janela.inicio, janela.fim)
      toast.success("Cópia pedida ao TiTa. Ele confere um dia por vez (cerca de 1 minuto por dia útil). Volte aqui depois.", { duration: 9000 })
    } catch (e) {
      toast.error(msg(e), { duration: 8000 })
    } finally {
      setPedindoCopia(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 sm:px-6">
      {corte && (
        <InlineNotice tone="slate" icon={<LogOut className="h-4 w-4" />}>
          <strong className="block text-sm">O TiTa foi desligado em {formatarDataHora(corte)}.</strong>
          Daqui em diante o Pulsar é a única fonte. As importações do TiTa não rodam mais.
        </InlineNotice>
      )}

      {/* ── O botão ─────────────────────────────────────────────────────── */}
      <section className={`${cartao} space-y-4 p-4 sm:p-5`}>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-foreground">Carregar o Pulsar segundo o TiTa</h2>
          <p className="text-sm text-muted-foreground">
            Clona no Pulsar os pacientes, os profissionais, as disponibilidades e os agendamentos que estão no TiTa, mostrando em
            detalhe o que foi trazido em cada etapa. Use quando quiser conferir — e uma última vez, no dia de se despedir do TiTa.
          </p>
        </div>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Nada é enviado ao TiTa: só lê a cópia dele que já está no Pulsar.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />O que foi criado no Pulsar nunca é apagado nem alterado por causa do TiTa.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Pode rodar de novo quantas vezes quiser: só o que mudou no TiTa é trazido.</li>
        </ul>

        <div className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-sm ${frescor?.desatualizado ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted text-foreground"}`}>
          {frescor?.desatualizado ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
          <span className="min-w-0 flex-1">
            {frescor?.visto
              ? `Cópia da grade do TiTa (${dataBR(janela.inicio)} a ${dataBR(janela.fim)}) conferida em ${formatarDataHora(frescor.visto)}${frescor.desatualizado ? " — está velha." : "."}`
              : "Conferindo a idade da cópia do TiTa…"}
          </span>
          <button type="button" onClick={pedirCopia} disabled={pedindoCopia || rodando || !!corte} className={btnSecundario}>
            {pedindoCopia ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Atualizar a cópia do TiTa agora
          </button>
        </div>

        <button type="button" onClick={iniciar} disabled={rodando || !!corte || !catalogo.length} className={`${btnPrimario} h-11 w-full text-base sm:w-auto`}>
          {rodando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <CloudDownload className="h-5 w-5" aria-hidden />}
          {rodando ? "Carregando…" : "Carregar o Pulsar segundo o TiTa"}
        </button>
      </section>

      {/* ── As etapas ───────────────────────────────────────────────────── */}
      <ol className="space-y-3">
        {ETAPAS.map((e, i) => (
          <CartaoEtapa
            key={e.id}
            numero={i + 1}
            etapa={e}
            estado={estados[e.id]}
            ocupado={rodando}
            onHistorico={() => abrirHistorico(e.id)}
            onTentarDeNovo={() => void rodar(e.id)}
          />
        ))}
      </ol>

      {/* ── A despedida ─────────────────────────────────────────────────── */}
      <section className={`${cartao} space-y-3 p-4 sm:p-5`}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden /> No futuro: a despedida do TiTa
        </h2>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">
          Não é agora. Nada nesta página desliga o TiTa: carregar só copia do TiTa para o Pulsar, e o TiTa continua funcionando
          normalmente.
        </p>
        <p className="text-sm text-muted-foreground">
          Quando você decidir, o corte é feito à mão pelo arquivo <code className="rounded bg-muted px-1 text-xs">docs/CORTE_TITA.sql</code>,
          que vem travado. Antes disso, estas telas ainda precisam deixar de ler o TiTa — senão ficariam paradas no dia do corte:
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {DEPENDENCIAS_TITA.map(d => (
            <li key={d.modulo} className="flex items-start gap-2 px-3 py-2 text-sm">
              <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span className="min-w-0">
                <span className="font-medium text-foreground">{d.modulo}</span>
                <span className="block text-xs text-muted-foreground">{d.porque} ({d.le})</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {DEPENDENCIAS_TITA.length
            ? `Faltam ${DEPENDENCIAS_TITA.length} módulos. Repontar cada um para a agenda do Pulsar é o próximo passo antes do corte.`
            : "Nenhum módulo depende mais do TiTa: o corte é seguro."}
        </p>
      </section>

      {relatorio && (
        <RelatorioSincronizacaoTita
          subtitulo={relatorio.subtitulo}
          rodadas={relatorio.rodadas}
          detalhar={relatorio.detalhar}
          vazio={relatorio.vazio}
          onClose={() => setRelatorio(null)}
        />
      )}
      {dialogo}
    </div>
  )
}

function CartaoEtapa({ numero, etapa, estado, ocupado, onHistorico, onTentarDeNovo }: {
  numero: number
  etapa: (typeof ETAPAS)[number]
  estado: Estado
  ocupado: boolean
  onHistorico: () => void
  onTentarDeNovo: () => void
}) {
  const [abrindo, setAbrindo] = useState(false)
  const abrir = async () => {
    if (estado.t !== "feito") return
    setAbrindo(true)
    try { await estado.abrir() } catch (e) { toast.error(msg(e)) } finally { setAbrindo(false) }
  }
  const icone = estado.t === "feito" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
    : estado.t === "rodando" ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
    : estado.t === "erro" ? <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
    : <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">{numero}</span>

  return (
    <li className={`${cartao} p-4`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icone}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <etapa.Icone className="h-4 w-4 text-muted-foreground" aria-hidden /> {etapa.titulo}
            </h3>
            <button type="button" onClick={onHistorico} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <History className="h-3.5 w-3.5" aria-hidden /> Histórico
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{etapa.descricao}</p>

          {estado.t === "rodando" && <p className="text-sm text-foreground">{estado.passo}</p>}
          {estado.t === "feito" && (
            <div className="flex flex-wrap items-center gap-2">
              {estado.resumo.map(r => (
                <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground tabular-nums">{r}</span>
              ))}
              <button type="button" onClick={abrir} disabled={abrindo} className={`${btnSecundario} h-8`}>
                {abrindo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Ver o que foi trazido
              </button>
            </div>
          )}
          {estado.t === "feito" && estado.aviso && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {estado.aviso}
            </p>
          )}
          {estado.t === "erro" && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{estado.mensagem}</p>
              <button type="button" onClick={onTentarDeNovo} disabled={ocupado} className={`${btnSecundario} h-8`}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Tentar de novo a partir daqui
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
