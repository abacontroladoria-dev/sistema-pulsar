"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, CloudDownload, History, Loader2,
  LogOut, OctagonX, RefreshCw, ShieldCheck,
} from "lucide-react"
import toast from "react-hot-toast"
import { useHeader } from "@/contexts/HeaderContext"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { btnPrimario, btnSecundario, cartao } from "@/components/cronograma/grade/estilo"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { useModalLayer, Z_MODAL } from "@/components/cronograma/ui/useModalLayer"
import {
  rodadaDeDisponibilidade, rodadaDeGrade, rodadaDePacientes, rodadaDeProfissionais,
} from "@/components/tita/adaptadoresRelatorio"
import { RelatorioSincronizacaoTita, formatarDataHora, type RodadaRelatorio } from "@/components/tita/RelatorioSincronizacaoTita"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import { medirFrescorGrade, type FrescorGrade } from "@/lib/grade/fonte"
import { janelaImportacaoTita, janelaReleituraTita } from "@/lib/grade/janelaTita"
import { DEPENDENCIAS_TITA } from "@/lib/tita/dependencias"
import { lerCorteTita } from "@/services/corteTita.service"
import {
  iniciarCargaTita, listarCargasTita, pararCargaTita, type CargaTita, type EtapaCargaTita, type ProgressoReleitura,
} from "@/services/cargaTita.service"
import { atualizarCopiaTita, listarImportacoesGrade, listarItensImportacaoGrade } from "@/services/grade.service"
import { getHistoricoImportacoesPacientes } from "@/services/pacientes.service"
import { listarImportacoes, listarItensImportacao } from "@/services/titaImportacoes.service"

// "Carregar o Pulsar segundo o TiTa" — um botão que traz, NESTA ordem, tudo o
// que o Pulsar precisa para viver sem o TiTa: pacientes → profissionais →
// disponibilidades → agendamentos. Cada etapa depende da anterior (sessão de
// paciente sem cadastro vira pendência). NADA é enviado ao TiTa.
//
// NO SERVIDOR (23/10/2026): o botão chama /api/tita/carga-manual, que roda as
// mesmas etapas da rotina das 04:00 (services/tita/cargaTita.server.ts) depois
// de responder. Esta página só acompanha a linha de tita_cargas — pode ser
// fechada sem interromper — e pode pedir para parar. Antes, o navegador rodava
// as etapas e esperava a releitura do TiTa (até 75 min) com a aba aberta.
//
// Agendamentos AO VIVO (20/10/2026): antes de importar, o servidor pede ao sync
// uma releitura do TiTa de hoje até a primeira semana completa do mês seguinte
// e espera todos esses dias serem reconfirmados (grade_sync_dia). Se a cópia das
// 02:00 estiver velha, a confirmação oferece reler a janela inteira.
//
// Regras (15/10/2026): na disponibilidade e na agenda o TiTa prevalece no que
// veio dele; o que foi criado no Pulsar nunca é tocado (o banco recusa).

type Etapa = EtapaCargaTita["etapa"]
type Estado =
  | { t: "aguardando" }
  | { t: "rodando"; passo: string; progresso: ProgressoReleitura | null }
  | { t: "feito"; resumo: string[]; aviso?: string; abrir: () => Promise<void> }
  | { t: "erro"; mensagem: string }
  | { t: "naoRodou"; motivo: string }

const ETAPAS: { id: Etapa; titulo: string; descricao: string }[] = [
  { id: "pacientes", titulo: "Pacientes", descricao: "Cadastro, responsável e endereço. O convênio vem do cadastro do TiTa." },
  { id: "profissionais", titulo: "Profissionais", descricao: "Cadastro e terapias habilitadas. Preenche o que está vazio; não troca o que foi editado no Pulsar." },
  { id: "disponibilidade", titulo: "Disponibilidades", descricao: "Horários de cada profissional pela grade do TiTa. O TiTa prevalece." },
  { id: "agenda", titulo: "Agendamentos", descricao: "Sessões agendadas no TiTa, lidas na hora até a primeira semana do mês seguinte." },
]

/** Quanto a carga pode ficar sem dar sinal antes de a tela avisar (o servidor grava a cada ~15 s). */
const SEM_SINAL_MS = 3 * 60_000
/** Na releitura, sem dia novo por este tempo a tela avisa; aos 8 min o servidor desiste. */
const SEM_AVANCO_AVISO_MS = 3 * 60_000
const SEM_AVANCO_LIMITE_MIN = 8
const POLL_MS = 5_000

type Relatorio = {
  subtitulo: string
  rodadas: RodadaRelatorio[]
  detalhar?: (r: RodadaRelatorio) => Promise<RodadaRelatorio>
  vazio: string
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const ordenarPrimeiro = <T extends { id: string }>(lista: T[], id: string | null | undefined) =>
  id ? [...lista.filter(x => x.id === id), ...lista.filter(x => x.id !== id)] : lista
const minutos = (ms: number) => Math.max(0, Math.round(ms / 60_000))
const duracao = (ms: number) => {
  const m = minutos(ms)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Estado de cada etapa a partir da carga gravada no banco. */
function estadosDaCarga(c: CargaTita | null, abrir: (etapa: Etapa, id?: string) => Promise<void>): Record<Etapa, Estado> {
  const n = {} as Record<Etapa, Estado>
  const falhou = c?.etapas.find(e => e.situacao === "erro")
  ETAPAS.forEach((e, i) => {
    const r = c?.etapas.find(x => x.etapa === e.id)
    if (!c) n[e.id] = { t: "aguardando" }
    else if (r?.fora) n[e.id] = { t: "naoRodou", motivo: r.aviso ?? "Fora desta carga." }
    else if (r?.situacao === "erro") n[e.id] = { t: "erro", mensagem: r.erro ?? "Falhou." }
    else if (r) n[e.id] = { t: "feito", resumo: r.resumo, aviso: r.aviso, abrir: () => abrir(e.id, r.importacao_id) }
    else if (c.situacao === "rodando") {
      n[e.id] = i === c.etapas.length
        ? { t: "rodando", passo: c.passo ?? "Rodando…", progresso: e.id === "agenda" ? c.progresso ?? null : null }
        : { t: "aguardando" }
    } else if (c.situacao === "parada") n[e.id] = { t: "naoRodou", motivo: "Não rodou: a carga foi parada a pedido." }
    else if (falhou) n[e.id] = { t: "naoRodou", motivo: `Não rodou porque ${ETAPAS.find(x => x.id === falhou.etapa)?.titulo ?? falhou.etapa} falhou.` }
    else n[e.id] = { t: "naoRodou", motivo: c.erro_mensagem ?? "Não rodou." }
  })
  return n
}

export default function CarregarTitaShell() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Carregar do TiTa", "Copia para o Pulsar o que está no TiTa. Nada é enviado ao TiTa.")
    return () => setHeader("", "")
  }, [setHeader])

  const [confirmando, setConfirmando] = useState(false)
  const janela = useMemo(() => janelaImportacaoTita(), [])
  const [frescor, setFrescor] = useState<FrescorGrade | null>(null)
  const [frescorErro, setFrescorErro] = useState(false)
  const [corte, setCorte] = useState<string | null>(null)
  // undefined = carregando; null = migration da rotina ainda não aplicada.
  const [cargas, setCargas] = useState<CargaTita[] | null | undefined>(undefined)
  const [iniciando, setIniciando] = useState(false)
  const [parando, setParando] = useState(false)
  const [pedindoCopia, setPedindoCopia] = useState(false)
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  const lerFrescor = useCallback(async () => {
    try { setFrescor(await medirFrescorGrade(janela.inicio, janela.fim, 280)); setFrescorErro(false) } catch { setFrescorErro(true) }
  }, [janela])
  const lerCargas = useCallback(async () => {
    try { setCargas(await listarCargasTita(7)) } catch { setCargas(c => c ?? null) }
  }, [])
  useEffect(() => {
    void lerFrescor()
    void lerCargas()
    lerCorteTita().then(setCorte).catch(() => {})
  }, [lerFrescor, lerCargas])

  // A carga mostrada nas etapas é a mais recente (do botão ou da rotina).
  const atual = cargas?.[0] ?? null
  const rodando = atual?.situacao === "rodando"

  // Enquanto roda: relê a carga a cada 5 s e o relógio a cada segundo.
  useEffect(() => {
    if (!rodando) return
    const poll = setInterval(() => void lerCargas(), POLL_MS)
    const relogio = setInterval(() => setAgora(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(relogio) }
  }, [rodando, lerCargas])

  // Avisa uma vez quando a carga acompanhada termina.
  const acompanhada = useRef<string | null>(null)
  useEffect(() => {
    if (!atual) return
    if (atual.situacao === "rodando") { acompanhada.current = atual.id; return }
    if (acompanhada.current !== atual.id) return
    acompanhada.current = null
    setParando(false)
    void lerFrescor()
    if (atual.situacao === "sucesso") toast.success("O Pulsar foi carregado segundo o TiTa.", { duration: 8000 })
    else if (atual.situacao === "parcial") toast("Carga concluída com avisos. Confira as etapas em amarelo.", { duration: 8000 })
    else if (atual.situacao === "parada") toast("Carga parada. O que já foi gravado fica.", { duration: 8000 })
    else toast.error(atual.erro_mensagem ?? "A carga falhou.", { duration: 9000 })
  }, [atual, lerFrescor])

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

  const abrirEtapa = useCallback((etapa: Etapa, id?: string | null) =>
    etapa === "pacientes" ? abrirPacientes(id) : etapa === "agenda" ? abrirAgenda(id) : abrirTita(etapa, id),
  [abrirPacientes, abrirAgenda, abrirTita])

  const abrirHistorico = (etapa: Etapa) => { abrirEtapa(etapa).catch(e => toast.error(msg(e))) }

  const estados = useMemo(() => estadosDaCarga(atual, abrirEtapa), [atual, abrirEtapa])

  // ── Ações ──────────────────────────────────────────────────────────────────
  const rodar = async (opcoes: { inicio?: Etapa; copiaCompleta?: boolean } = {}) => {
    setIniciando(true)
    try {
      const { jaRodando } = await iniciarCargaTita(opcoes)
      if (jaRodando) toast("Já havia uma carga rodando. Acompanhe por aqui.", { duration: 6000 })
      await lerCargas()
    } catch (e) {
      toast.error(msg(e), { duration: 9000 })
    } finally {
      setIniciando(false)
    }
  }

  const parar = async () => {
    if (!atual) return
    setParando(true)
    try {
      await pararCargaTita(atual.id)
      toast("Parada pedida. A carga termina o passo em curso e para.", { duration: 7000 })
      await lerCargas()
    } catch (e) {
      setParando(false)
      toast.error(msg(e), { duration: 8000 })
    }
  }

  const pedirCopia = async () => {
    setPedindoCopia(true)
    try {
      const { jaPedida } = await atualizarCopiaTita(janela.inicio, janela.fim)
      toast.success(jaPedida
        ? "A cópia já foi pedida há pouco e está sendo lida. Acompanhe pela data de conferência."
        : "Cópia pedida ao TiTa. Ele confere um dia por vez (cerca de 1 minuto por dia útil). Volte aqui depois.", { duration: 9000 })
    } catch (e) {
      toast.error(msg(e), { duration: 8000 })
    } finally {
      setPedindoCopia(false)
    }
  }

  const rotinaLigada = !!cargas?.some(c => c.origem === "cron")
  const releituraFim = dataBR(janelaReleituraTita().fim)
  const ocupado = rodando || iniciando
  const semSinal = rodando && agora - Date.parse(atual.atualizado_em ?? atual.iniciado_em) > SEM_SINAL_MS
  const paradaPedida = parando || !!atual?.parar_pedido_em
  // Sem as colunas de acompanhamento (migration 20261023180000) não há como pedir parada.
  const podeParar = rodando && atual.parar_pedido_em !== undefined
  const copiaVelha = !!frescor?.desatualizado

  return (
    <div className="w-full space-y-5 px-4 py-5 sm:px-6">
      {corte && (
        <InlineNotice tone="slate" icon={<LogOut className="h-4 w-4" />}>
          <strong className="block text-sm">O TiTa foi desligado em {formatarDataHora(corte)}.</strong>
          Daqui em diante o Pulsar é a única fonte. As importações do TiTa não rodam mais.
        </InlineNotice>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* ── O botão e as etapas ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <section className={`${cartao} space-y-4 p-4 sm:p-5`}>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-foreground">Carregar o Pulsar segundo o TiTa</h2>
              <p className="text-sm text-muted-foreground">
                Traz pacientes, profissionais, disponibilidades e agendamentos, nesta ordem
                {rotinaLigada ? ". Também roda sozinho todo dia às 04:00." : "."}
              </p>
            </div>

            {atual && <ResumoCarga carga={atual} agora={agora} semSinal={semSinal} />}

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {rodando ? (
                podeParar && (
                  <button type="button" onClick={parar} disabled={paradaPedida} className={`${btnSecundario} h-11 text-base`}>
                    {paradaPedida ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <OctagonX className="h-5 w-5 text-destructive" aria-hidden />}
                    {paradaPedida ? "Parando…" : "Parar a carga"}
                  </button>
                )
              ) : (
                <button type="button" onClick={() => setConfirmando(true)} disabled={ocupado || !!corte} className={`${btnPrimario} h-11 text-base`}>
                  {iniciando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <CloudDownload className="h-5 w-5" aria-hidden />}
                  {iniciando ? "Começando…" : "Carregar o Pulsar segundo o TiTa"}
                </button>
              )}
              {rodando && <p className="text-xs text-muted-foreground">Pode fechar esta página: a carga continua no servidor.</p>}
            </div>

            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${copiaVelha || frescorErro ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted text-foreground"}`}>
              {copiaVelha || frescorErro ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                : frescor ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">
                {frescorErro
                  ? "Não foi possível conferir a cópia das 02:00. Recarregue a página para tentar de novo."
                  : frescor?.visto
                    ? `Cópia das 02:00 (${dataBR(janela.inicio)} a ${dataBR(janela.fim)}) conferida em ${formatarDataHora(frescor.visto)}${copiaVelha ? ": está desatualizada." : "."}`
                    : "Conferindo a cópia das 02:00…"}
              </span>
              <button type="button" onClick={pedirCopia} disabled={pedindoCopia || ocupado || !!corte}
                className={`inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50 sm:min-h-0 ${foco}`}>
                {pedindoCopia ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                Atualizar a cópia agora
              </button>
            </div>
          </section>

          <ol className="space-y-3">
            {ETAPAS.map((e, i) => (
              <CartaoEtapa
                key={e.id}
                numero={i + 1}
                etapa={e}
                estado={estados[e.id]}
                ocupado={ocupado}
                agora={agora}
                onHistorico={() => abrirHistorico(e.id)}
                onTentarDeNovo={() => void rodar({ inicio: e.id })}
              />
            ))}
          </ol>
        </div>

        {/* ── Cargas anteriores e despedida ───────────────────────────────── */}
        <div className="space-y-5">
          {cargas !== null && <CargasAnteriores cargas={cargas?.slice(1)} rotinaLigada={rotinaLigada} />}

          {!corte && (
            <details className={`${cartao} group p-4 sm:p-5`}>
              <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-base font-semibold text-foreground sm:min-h-0 [&::-webkit-details-marker]:hidden ${foco}`}>
                <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  No futuro: a despedida do TiTa
                  <span className="block text-xs font-normal text-muted-foreground">
                    {DEPENDENCIAS_TITA.length ? `${DEPENDENCIAS_TITA.length} módulos ainda leem o TiTa` : "Pronto para o corte"}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
              </summary>
              <div className="mt-3 space-y-3">
                <p className="rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">
                  Nada nesta página desliga o TiTa: carregar só copia do TiTa para o Pulsar.
                </p>
                <p className="text-sm text-muted-foreground">
                  O corte é feito à mão pelo time técnico. Antes dele, estas telas precisam deixar de ler o TiTa:
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
              </div>
            </details>
          )}
        </div>
      </div>

      {relatorio && (
        <RelatorioSincronizacaoTita
          subtitulo={relatorio.subtitulo}
          rodadas={relatorio.rodadas}
          detalhar={relatorio.detalhar}
          vazio={relatorio.vazio}
          onClose={() => setRelatorio(null)}
        />
      )}
      {confirmando && (
        <ConfirmarCarga
          releituraFim={releituraFim}
          copiaVelha={copiaVelha ? { visto: frescor?.visto ?? null, fim: dataBR(janela.fim) } : null}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={copiaCompleta => { setConfirmando(false); void rodar({ copiaCompleta }) }}
        />
      )}
    </div>
  )
}

const SELO_CARGA: Record<CargaTita["situacao"], { texto: string; classe: string }> = {
  sucesso: { texto: "Concluída", classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  parcial: { texto: "Concluída com avisos", classe: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  erro: { texto: "Falhou", classe: "bg-destructive/10 text-destructive" },
  parada: { texto: "Parada", classe: "bg-muted text-foreground" },
  rodando: { texto: "Rodando", classe: "bg-primary/10 text-primary" },
}

const quemRodou = (c: CargaTita) => c.origem === "cron" ? "rotina das 04:00" : c.pedida_por_nome ? `por ${c.pedida_por_nome}` : "pelo botão"

/** A carga mais recente em uma linha: situação, quando, quem, etapas e avisos. Fica depois de terminar. */
function ResumoCarga({ carga: c, agora, semSinal }: { carga: CargaTita; agora: number; semSinal: boolean }) {
  const feitas = c.etapas.filter(e => !e.fora && e.situacao === "sucesso").length
  const daCarga = c.etapas.some(e => e.fora) ? c.etapas.filter(e => !e.fora).length + (c.situacao === "rodando" ? 1 : 0) : 4
  const avisos = c.etapas.filter(e => !e.fora && (e.aviso || e.situacao === "pulada")).length
  const fim = c.finalizado_em ? Date.parse(c.finalizado_em) : agora
  return (
    <div className="space-y-1" role="status" aria-live="polite">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SELO_CARGA[c.situacao].classe}`}>{SELO_CARGA[c.situacao].texto}</span>
        <span className="text-foreground tabular-nums">
          {c.situacao === "rodando"
            ? `Começou às ${formatarDataHora(c.iniciado_em).slice(-5)}, há ${duracao(agora - Date.parse(c.iniciado_em))}`
            : `${formatarDataHora(c.finalizado_em ?? c.iniciado_em)} · levou ${duracao(fim - Date.parse(c.iniciado_em))}`}
        </span>
        <span className="text-muted-foreground">
          {quemRodou(c)} · {feitas} de {daCarga} etapas{avisos ? ` · ${avisos} com aviso` : ""}
        </span>
      </p>
      {semSinal && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Sem notícias da carga há {duracao(agora - Date.parse(c.atualizado_em ?? c.iniciado_em))}. Se o servidor reiniciou, ela parou no meio e o que já foi gravado fica.
          Com 20 min sem notícias ela é dada como interrompida, e uma carga nova pode começar.
        </p>
      )}
    </div>
  )
}

/** Confirmação no design padrão do Pulsar (mesmos tokens da Grade e desta página). */
function ConfirmarCarga({ releituraFim, copiaVelha, onCancelar, onConfirmar }: {
  releituraFim: string
  /** A cópia das 02:00 está velha: oferece reler a janela inteira. */
  copiaVelha: { visto: string | null; fim: string } | null
  onCancelar: () => void
  onConfirmar: (copiaCompleta: boolean) => void
}) {
  const cartaoRef = useRef<HTMLDivElement | null>(null)
  useModalLayer(cartaoRef, onCancelar)
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/45 p-4 animate-in fade-in duration-150 motion-reduce:animate-none"
      style={{ zIndex: Z_MODAL }}
      onClick={e => { if (e.target === e.currentTarget) onCancelar() }}
    >
      <div
        ref={cartaoRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="carregar-tita-titulo"
        className={`${cartao} w-full max-w-md space-y-4 p-5 outline-none`}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground" aria-hidden>
            <CloudDownload className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id="carregar-tita-titulo" className="text-base font-semibold text-foreground">Carregar o Pulsar segundo o TiTa?</h2>
            <p className="text-sm text-muted-foreground">Traz, nesta ordem: pacientes, profissionais, disponibilidades e agendamentos.</p>
          </div>
        </div>
        {copiaVelha && (
          <p className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              A cópia das 02:00 está desatualizada{copiaVelha.visto ? ` (conferida em ${formatarDataHora(copiaVelha.visto)})` : ""}. Sem reler,
              a etapa Agendamentos não mexe na agenda. Reler tudo até {copiaVelha.fim} resolve, mas demora mais: cerca de 1 minuto por dia útil.
            </span>
          </p>
        )}
        <ul className="space-y-2 text-sm text-foreground">
          <li className="flex gap-2">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            Os agendamentos até {copiaVelha ? copiaVelha.fim : releituraFim} são lidos do TiTa na hora. Roda no servidor: pode fechar a página.
          </li>
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            Nas disponibilidades e nos agendamentos que vieram do TiTa, o TiTa prevalece: o que está diferente aqui é trocado e fica no histórico.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            O que foi criado no Pulsar não é tocado, e nada é enviado ao TiTa.
          </li>
        </ul>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onCancelar} className={btnSecundario}>Ainda não</button>
          {copiaVelha ? (
            <>
              <button type="button" onClick={() => onConfirmar(false)} className={btnSecundario}>Carregar sem reler</button>
              <button type="button" onClick={() => onConfirmar(true)} className={btnPrimario}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Reler tudo e carregar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onConfirmar(false)} className={btnPrimario}>
              <CloudDownload className="h-4 w-4" aria-hidden /> Carregar agora
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** As cargas antes da mais recente (que já aparece nas etapas), uma por linha. */
function CargasAnteriores({ cargas, rotinaLigada }: { cargas: CargaTita[] | undefined; rotinaLigada: boolean }) {
  return (
    <section className={`${cartao} space-y-3 p-4 sm:p-5`}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden /> Cargas anteriores
      </h2>
      {!rotinaLigada && cargas !== undefined && (
        <p className="text-xs text-muted-foreground">A rotina das 04:00 ainda não está ligada; quem liga é o time técnico.</p>
      )}
      {cargas === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando…</p>
      ) : !cargas.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma outra carga registrada.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {cargas.map(c => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SELO_CARGA[c.situacao].classe}`}>{SELO_CARGA[c.situacao].texto}</span>
              <span className="tabular-nums text-foreground">{formatarDataHora(c.iniciado_em)}</span>
              <span className="text-xs text-muted-foreground">{quemRodou(c)}</span>
              {(c.erro_mensagem || c.etapas.some(e => !e.fora && e.aviso)) && (
                <span className="basis-full text-xs text-muted-foreground">
                  {c.erro_mensagem ?? c.etapas.filter(e => !e.fora && e.aviso).map(e => e.aviso).join(" ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Barra da releitura ao vivo: dias conferidos, estimativa e aviso de lentidão. */
function ProgressoReleituraTita({ p, agora }: { p: ProgressoReleitura; agora: number }) {
  const pct = p.total ? Math.round((p.conferidos / p.total) * 100) : 0
  const decorrido = agora - Date.parse(p.desde)
  const faltam = p.total - p.conferidos
  // Ritmo observado; antes do primeiro dia, ~1 min por dia (o sync lê um dia útil por minuto).
  const restante = p.conferidos > 0 ? (decorrido / p.conferidos) * faltam : faltam * 60_000
  const semAvanco = agora - Date.parse(p.ultimo_avanco_em)
  return (
    <div className="space-y-1.5">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.conferidos}
        aria-label={`${p.conferidos} de ${p.total} dias relidos`}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {p.conferidos} de {p.total} dias ({dataBR(p.inicio)} a {dataBR(p.fim)}) · faltam cerca de {duracao(restante)}
      </p>
      {semAvanco > SEM_AVANCO_AVISO_MS && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Nenhum dia novo há {duracao(semAvanco)}. Aos {SEM_AVANCO_LIMITE_MIN} min sem avanço a carga desiste, sem mexer na agenda.
        </p>
      )}
    </div>
  )
}

function CartaoEtapa({ numero, etapa, estado, ocupado, agora, onHistorico, onTentarDeNovo }: {
  numero: number
  etapa: (typeof ETAPAS)[number]
  estado: Estado
  ocupado: boolean
  agora: number
  onHistorico: () => void
  onTentarDeNovo: () => void
}) {
  const [abrindo, setAbrindo] = useState(false)
  const abrir = async () => {
    if (estado.t !== "feito") return
    setAbrindo(true)
    try { await estado.abrir() } catch (e) { toast.error(msg(e)) } finally { setAbrindo(false) }
  }
  const icone = estado.t === "feito" ? (estado.aviso
      ? <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
      : <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />)
    : estado.t === "rodando" ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
    : estado.t === "erro" ? <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
    : estado.t === "naoRodou" ? <CircleDashed className="h-5 w-5 text-muted-foreground" aria-hidden />
    : <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">{numero}</span>

  const textoEstado = { aguardando: "Aguardando", rodando: "Rodando", feito: "Concluída", erro: "Falhou", naoRodou: "Não rodou" }[estado.t]
  const ativa = estado.t === "rodando"

  return (
    <li className={`${cartao} p-4 ${ativa ? "ring-2 ring-primary/40" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icone}<span className="sr-only">{textoEstado}</span></span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {numero}. {etapa.titulo}
            </h3>
            <button type="button" onClick={onHistorico} className={`inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0 ${foco}`}>
              <History className="h-3.5 w-3.5" aria-hidden /> Histórico<span className="sr-only"> de {etapa.titulo}</span>
            </button>
          </div>
          {/* Durante a execução a descrição sai: o que importa é o passo. */}
          {!ativa && <p className="text-xs text-muted-foreground">{etapa.descricao}</p>}

          <div role="status" aria-live="polite" className="space-y-2">
          {estado.t === "naoRodou" && <p className="text-xs font-medium text-muted-foreground">{estado.motivo}</p>}
          {estado.t === "rodando" && <p className="text-sm text-foreground">{estado.progresso ? "Lendo os agendamentos no TiTa, um dia por vez." : estado.passo}</p>}
          {estado.t === "rodando" && estado.progresso && <ProgressoReleituraTita p={estado.progresso} agora={agora} />}
          {estado.t === "feito" && (
            <div className="flex flex-wrap items-center gap-2">
              {estado.resumo.map(r => (
                <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground tabular-nums">{r}</span>
              ))}
              <button type="button" onClick={abrir} disabled={abrindo} className={`${btnSecundario} h-11 sm:h-8`}>
                {abrindo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Ver o que foi trazido
              </button>
            </div>
          )}
          {estado.t === "feito" && estado.aviso && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {estado.aviso}
            </p>
          )}
          </div>
          {estado.t === "erro" && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">{estado.mensagem}</p>
              <button type="button" onClick={onTentarDeNovo} disabled={ocupado} className={`${btnSecundario} h-11 sm:h-8`}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Tentar de novo a partir daqui
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
