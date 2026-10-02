"use client"

// Visão geral de Entregas PEP — o que a tela mostra ANTES de escolher um
// Analista do Comportamento: o mês inteiro, de todos os analistas.
//
// SÓ LEITURA. Os números vêm de resumoPepCompetencia (lib/remuneracao/
// visaoGeralPep.ts), que cruza a Grade com as linhas JÁ gravadas em
// pep_apuracao_mensal. Nada aqui apura: quem apura é abrir o analista.
//
// Tons (docs/padrao-detalhamento-modal.md §3.5 — um tom, um sentido; zero sem
// cor): verde = liberado para pagamento, vermelho = descontado por entrega
// faltando, âmbar = faltam entregas (e valor não calculado), azul = conferido,
// cinza = entregas completas, ninguém conferiu ainda.
//
// O STATUS do analista diz o que as PESSOAS já fizeram com as entregas
// (lib/remuneracao/situacaoEntregasPep.ts) — não se o sistema já gravou um
// cálculo. Valor ainda não calculado é um aviso pequeno, não um status.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Bot, CalendarDays, ChevronRight, ClipboardList, FileCheck2, Loader2, PieChart, Search, Undo2, User, Users } from "lucide-react"

import { fmt } from "@/lib/remuneracao/formatacao"
import { B } from "@/lib/cronograma/constants"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { usePepVisaoGeral } from "@/hooks/usePepVisaoGeral"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import { useCountUp } from "../RemuneracaoRPDashboard"
import { BarraEmpilhada, Card, Legenda, Metric, num, pct1 } from "../visaoGeral/pecas"
import {
  resumoPepCompetencia, type AnalistaDaGrade, type StatusApuracaoAnalista,
} from "@/lib/remuneracao/visaoGeralPep"
import { situacaoEntregasPorAnalista } from "@/lib/remuneracao/situacaoEntregasPep"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { LegendaOrigem, ORIGEM } from "./origem"

// Roxo = robô, azul = pessoa (./origem). Hex para as barras, que pintam por style.
const COR_ROBO = "#7c3aed"
const COR_PESSOA = "#2563eb"

const normKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

function competenciaAtual(): string {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`
}

// `nota` é o texto de "quando aparece": vai na lista ao lado e no tooltip
// (title) de cada status — o mesmo texto nos dois lugares.
const STATUS: Record<StatusApuracaoAnalista, { rotulo: string; tone: Tone; nota: string }> = {
  faltam_entregas: { rotulo: "Faltam entregas", tone: "amber", nota: "O mês tem item esperado sem entrega, ou sugestão esperando uma pessoa. Sai dos dados, sem ninguém clicar." },
  entregas_completas: { rotulo: "Entregas completas", tone: "gray", nota: "Tudo o que era esperado foi entregue, mas ninguém conferiu ainda." },
  conferido: { rotulo: "Conferido", tone: "blue", nota: "Uma pessoa clicou “Marcar como conferido”. Fica gravado quem e quando." },
  liberado: { rotulo: "Liberado para pagamento", tone: "green", nota: "É o “Liberado” de hoje. O mês fica travado." },
  sem_dados: { rotulo: "Sem dados", tone: "gray", nota: "Não foi possível ler as entregas deste mês. Recarregue a página." },
}

/** A lâmpada que explica cada status e quando ele aparece (o mesmo texto do tooltip de cada chip). */
function ExplicacaoStatus() {
  return (
    <InfoTooltip ariaLabel="Explicação dos status" largura={340}>
      <p className="mb-2 text-xs font-bold text-foreground">Status do analista no mês</p>
      <ul className="space-y-2">
        {(["faltam_entregas", "entregas_completas", "conferido", "liberado"] as StatusApuracaoAnalista[]).map(s => (
          <li key={s}>
            <StatusChip tone={STATUS[s].tone} dense>{STATUS[s].rotulo}</StatusChip>
            <p className="mt-1 leading-snug text-muted-foreground">{STATUS[s].nota}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-border pt-2 leading-snug text-muted-foreground">
        O status mostra o que as pessoas já fizeram com as entregas. Abrir a página do analista não muda o status.
      </p>
    </InfoTooltip>
  )
}

/** Nenhum paciente do analista tem valor calculado ainda. */
const semCalculo = (a: { pacientes: number; pacientesSemApuracao: string[] }) =>
  a.pacientes > 0 && a.pacientesSemApuracao.length === a.pacientes

/** O que está faltando, em uma linha curta (sob o nome do analista). */
function resumoFaltas(s: { unidadesFaltando: number; semestraisVencidas: number; sugestoesEsperando: number } | null): string | null {
  if (!s) return null
  const partes = [
    s.unidadesFaltando > 0 && `${s.unidadesFaltando} ${s.unidadesFaltando === 1 ? "unidade" : "unidades"} faltando`,
    s.semestraisVencidas > 0 && `${s.semestraisVencidas} ${s.semestraisVencidas === 1 ? "semestral vencida" : "semestrais vencidas"}`,
    s.sugestoesEsperando > 0 && `${s.sugestoesEsperando} ${s.sugestoesEsperando === 1 ? "sugestão esperando" : "sugestões esperando"} uma pessoa`,
  ].filter(Boolean)
  return partes.length ? partes.join(" · ") : null
}

// ─── Mês de atendimento × mês de faturamento ─────────────────────────────────
//
// "Competência" sozinha é ambígua para quem opera: é o mês em que o paciente
// foi ATENDIDO (é dele que vêm as entregas e a grade). O faturamento desse mês
// acontece no mês SEGUINTE — PRD §11: "Até dia 5: Clínica confere e informa o
// Faturamento Liberado" (ver liberarFaturamento em pepApuracao.service.ts).

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

/** "2026-08" → atendimento Agosto/2026, faturado em Setembro/2026, liberação até 05/09/2026. */
export function faturamentoDaCompetencia(competencia: string) {
  const [ano, mes] = competencia.split("-").map(Number)
  const seguinte = new Date(ano, mes, 1) // mes é 1-based: new Date(ano, mes) já é o mês seguinte
  const anoF = seguinte.getFullYear(), mesF = seguinte.getMonth() + 1
  return {
    mesAtendimento: `${MESES_PT[mes - 1]}/${ano}`,
    mesFaturamento: `${MESES_PT[mesF - 1]}/${anoF}`,
    limiteLiberacao: `05/${String(mesF).padStart(2, "0")}/${anoF}`,
  }
}

/** Nota ao lado do seletor de mês: de qual faturamento este mês de atendimento é. */
export function NotaFaturamento({ competencia }: { competencia: string }) {
  const f = faturamentoDaCompetencia(competencia)
  return (
    <span className="text-xs text-muted-foreground">
      → faturamento em <span className="font-semibold text-foreground">{f.mesFaturamento}</span>
      <span className="hidden sm:inline"> · liberar até {f.limiteLiberacao}</span>
    </span>
  )
}

// ─── Barra de competência ────────────────────────────────────────────────────

/**
 * Seletor de mês da tela inicial. Na tela do analista o mês continua sendo
 * trocado em "Entregas mensais"; aqui ele precisa existir ANTES de escolher
 * alguém — antes, a tela inicial nem deixava trocar o mês.
 */
export function BarraCompetencia({ competencia, onMudarMes, carregando, modoTeste }: {
  competencia: string
  onMudarMes: (ano: number, mes: number) => void
  carregando: boolean
  modoTeste: boolean
}) {
  const [ano, mes] = competencia.split("-").map(Number)
  const emAndamento = competencia === competenciaAtual()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm md:px-5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mês de atendimento</span>
      <SeletorMesPrevisao ano={ano} mes={mes} onChange={onMudarMes} />
      <NotaFaturamento competencia={competencia} />
      <StatusChip tone={emAndamento ? "blue" : "gray"}>
        <CalendarDays size={11} aria-hidden />
        {emAndamento ? "Atendimentos em andamento" : "Atendimentos encerrados"}
      </StatusChip>
      {modoTeste && <StatusChip tone="amber">Modo teste</StatusChip>}
      {carregando && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" aria-hidden /> Carregando grade…
        </span>
      )}
    </div>
  )
}

// ─── Visão geral ─────────────────────────────────────────────────────────────

interface Props {
  competencia: string
  analistas: AnalistaDaGrade[]
  /** V — o valor por paciente dos Parâmetros Gerais, o mesmo da apuração. */
  valorPorPaciente: number
  /** Abre o analista na própria página (troca de estado, sem navegação). */
  onSelecionar: (nome: string) => void
  /** Chamado quando a apuração do mês terminou de carregar (a tela espera por ele). */
  onCarregado?: () => void
}

export function VisaoGeralPep({ competencia, analistas, valorPorPaciente, onSelecionar, onCarregado }: Props) {
  const toneColor = useToneColor()
  // Monta só enquanto ninguém está selecionado: ao voltar de um analista (que
  // pode ter apurado ou liberado algo), remonta e lê de novo.
  // Antes de ler, reapura só os analistas em que o robô SharePoint entregou ou
  // desfez algo desde o último cálculo (pep_apuracao_recalcular).
  const { linhas, indices, situacao: dadosSituacao, loading, erro } = usePepVisaoGeral(competencia, analistas, valorPorPaciente)
  useEffect(() => { if (!loading) onCarregado?.() }, [loading, onCarregado])
  const idx = useMemo(() => indices.reduce((t, i) => ({
    roboAprovou: t.roboAprovou + i.robo_aprovou,
    roboVigentes: t.roboVigentes + i.robo_vigentes,
    pessoaAprovou: t.pessoaAprovou + i.humano_aprovou,
    pessoaDesfez: t.pessoaDesfez + i.humano_reverteu,
    segue: t.segue + i.segue_padrao,
    fora: t.fora + i.fora_padrao,
    repetidos: t.repetidos + i.duplicados,
  }), { roboAprovou: 0, roboVigentes: 0, pessoaAprovou: 0, pessoaDesfez: 0, segue: 0, fora: 0, repetidos: 0 }), [indices])
  const acerto = idx.roboAprovou > 0 ? Math.round((idx.roboVigentes / idx.roboAprovou) * 100) : null
  const r = useMemo(
    () => resumoPepCompetencia({
      analistas, linhas, valorPorPaciente, competencia,
      situacao: dadosSituacao ? situacaoEntregasPorAnalista(analistas, dadosSituacao, competencia) : null,
    }),
    [analistas, linhas, valorPorPaciente, competencia, dadosSituacao]
  )
  const apuradoAnimado = useCountUp(r.apurado)
  const [busca, setBusca] = useState("")

  const corApurado = toneColor("green")
  const corDesconto = toneColor("red")
  const corPendente = toneColor("amber")
  const corCinza = toneColor("gray")
  const pctGeral = r.teto > 0 ? (r.apurado / r.teto) * 100 : null
  const emAndamento = competencia === competenciaAtual()

  const q = normKey(busca)
  const visiveis = q ? r.porAnalista.filter(a => normKey(a.nome).includes(q)) : r.porAnalista

  // Sem V configurado, "teto" e "não apurado" não fazem sentido — diz, em vez
  // de mostrar R$ 0,00 como se fosse o valor.
  const semValor = valorPorPaciente <= 0

  return (
    <div className="space-y-4">
      {erro && (
        <p className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${TONE_PANEL.red.bg} ${TONE_CHIP.red.text}`}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {erro}
        </p>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${B.navy}, ${B.purple})` }} />
        <div className="space-y-4 p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={`text-4xl font-black tabular-nums leading-none sm:text-5xl ${loading ? "opacity-40" : ""}`}
                  style={{ color: r.apurado > 0 ? corApurado : corCinza }}>
                  {fmt(apuradoAnimado)}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  apurado de {semValor ? "—" : fmt(r.teto)} de teto
                  {pctGeral !== null && !loading && <> · {pct1(pctGeral)}</>}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {loading ? "Lendo a apuração do mês…" : "PEP que vai ser paga no mês, somando todos os analistas."}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Metric label={r.analistas === 1 ? "Analista" : "Analistas"} valor={num(r.analistas)} />
              <Metric label="Pacientes" valor={num(r.pacientes)} />
              <Metric
                label={`por analista (${num(r.pacientesPorAnalista.min)}–${num(r.pacientesPorAnalista.max)})`}
                valor={r.pacientesPorAnalista.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
              />
              <Metric label="valor por paciente" valor={semValor ? "—" : fmt(valorPorPaciente)} />
            </div>
          </div>

          {!semValor && (
            <div>
              <BarraEmpilhada partes={[
                { valor: r.apurado, cor: corApurado, rotulo: "Apurado" },
                { valor: Math.max(0, r.descontos.total), cor: corDesconto, rotulo: "Descontado" },
                { valor: Math.max(0, r.naoApurado), cor: corPendente, rotulo: "Não apurado" },
              ]} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Legenda cor={corApurado} rotulo="Apurado" valor={r.apurado} formatar={fmt} />
                <Legenda cor={corDesconto} rotulo="Descontado" valor={r.descontos.total} formatar={fmt} />
                <Legenda cor={corPendente} rotulo="Não apurado" valor={r.naoApurado} formatar={fmt} />
              </div>
            </div>
          )}

          {emAndamento && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Atendimentos em andamento: o teto conta os pacientes que já aparecem na grade e pode crescer até o fim do mês.
            </p>
          )}
          {semValor && (
            <p className={`rounded-xl px-3 py-2 text-xs ${TONE_PANEL.amber.bg} ${TONE_CHIP.amber.text}`}>
              O valor da PEP por paciente não está configurado em Parâmetros Gerais — sem ele não há teto nem valor não apurado.
            </p>
          )}
        </div>
      </section>

      {/* ── Quem fez o apurado: robô × pessoas ──────────────────────── */}
      <section className="tema-robo rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5" aria-labelledby="titulo-quem-fez">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="titulo-quem-fez" className="flex items-center gap-2 text-sm font-bold text-foreground">
            <FileCheck2 size={15} aria-hidden /> Quem fez o apurado
          </h3>
          <LegendaOrigem />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className={`rounded-xl border p-3 ${ORIGEM.robo.tinta}`}>
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Bot size={14} aria-hidden /> Robô SharePoint</p>
            <p className={`mt-1 text-2xl font-black tabular-nums ${loading ? "opacity-40" : ""}`}>{fmt(r.origem.robo)}</p>
            <p className="text-[11px] opacity-80">{num(idx.roboVigentes)} {idx.roboVigentes === 1 ? "entrega marcada" : "entregas marcadas"} pelo robô</p>
          </div>
          <div className={`rounded-xl border p-3 ${ORIGEM.humano.tinta}`}>
            <p className="flex items-center gap-1.5 text-xs font-semibold"><User size={14} aria-hidden /> Pessoas da equipe</p>
            <p className={`mt-1 text-2xl font-black tabular-nums ${loading ? "opacity-40" : ""}`}>{fmt(r.origem.humano)}</p>
            <p className="text-[11px] opacity-80">{num(idx.pessoaAprovou)} {idx.pessoaAprovou === 1 ? "entrega marcada" : "entregas marcadas"} à mão</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Undo2 size={14} aria-hidden /> Pessoas desfizeram</p>
            <p className="mt-1 text-2xl font-black tabular-nums">{num(idx.pessoaDesfez)}</p>
            <p className="text-[11px] opacity-80">
              {acerto != null ? `o robô acertou ${acerto}% do que entregou` : "o robô ainda não entregou nada neste mês"}
            </p>
          </div>
        </div>

        {r.origem.robo + r.origem.humano > 0 && (
          <div className="mt-3">
            <BarraEmpilhada partes={[
              { valor: r.origem.robo, cor: COR_ROBO, rotulo: "Robô" },
              { valor: r.origem.humano, cor: COR_PESSOA, rotulo: "Pessoas" },
            ]} />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Cada entrega vale a parte dela no valor do paciente e conta para quem a marcou.
              {Math.abs(r.origem.ajustes) >= 0.01 && <> Apurado = robô + pessoas {r.origem.ajustes < 0 ? "−" : "+"} {fmt(Math.abs(r.origem.ajustes))} de {r.origem.ajustes < 0 ? "descontos semestrais e saldo" : "devolução ou mês de teste"}.</>}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3 text-xs">
          <span className="font-semibold text-foreground">Arquivos no SharePoint neste mês:</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900">{num(idx.segue)} seguem o padrão de nome</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">{num(idx.fora)} fora do padrão (não contam)</span>
          {idx.repetidos > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{num(idx.repetidos)} repetidos</span>}
        </div>
      </section>

      {/* ── Situação + Para onde vai o teto ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Situação das entregas" icone={<ClipboardList size={15} />}>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums leading-none"
              style={{ color: r.porStatus.liberado > 0 ? corApurado : corCinza }}>
              {num(r.porStatus.liberado)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              de {num(r.analistas)} liberados para pagamento
            </span>
          </div>
          <div className="mt-3">
            <BarraEmpilhada partes={(["liberado", "conferido", "entregas_completas", "faltam_entregas", "sem_dados"] as StatusApuracaoAnalista[])
              .map(s => ({ valor: r.porStatus[s], cor: toneColor(STATUS[s].tone), rotulo: STATUS[s].rotulo }))} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {(["faltam_entregas", "entregas_completas", "conferido", "liberado"] as StatusApuracaoAnalista[]).map(s => (
              <li key={s} className="flex items-start gap-2.5" title={STATUS[s].nota}>
                <span className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ background: r.porStatus[s] > 0 ? toneColor(STATUS[s].tone) : "transparent", boxShadow: r.porStatus[s] > 0 ? undefined : "inset 0 0 0 1px currentColor" }}
                  aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-foreground">{STATUS[s].rotulo}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{STATUS[s].nota}</span>
                </span>
                <span className="shrink-0 text-sm font-black tabular-nums"
                  style={r.porStatus[s] > 0 ? { color: toneColor(STATUS[s].tone) } : { color: corCinza }}>
                  {num(r.porStatus[s])}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card titulo="Para onde vai o teto" icone={<PieChart size={15} />}>
          {semValor ? (
            <p className="text-xs text-muted-foreground">Sem valor por paciente configurado, não há teto a repartir.</p>
          ) : (
            <div className="space-y-3">
              <LinhaValor rotulo="Teto do mês" nota={`${num(r.pacientes)} pacientes × ${fmt(valorPorPaciente)}`} valor={r.teto} destaque />
              <LinhaValor rotulo="Apurado" nota="vai ser pago" valor={r.apurado} cor={r.apurado > 0 ? corApurado : undefined} carregando={loading} />
              <div>
                <LinhaValor rotulo="Descontado" nota="entregas faltando e saldo de meses anteriores" valor={r.descontos.total}
                  cor={r.descontos.total > 0 ? corDesconto : undefined} carregando={loading} />
                {!loading && (r.descontos.recorrentes > 0 || r.descontos.semestrais > 0 || r.descontos.saldoAnterior > 0 || r.descontos.devolucao > 0) && (
                  <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-3 text-[11px] tabular-nums text-muted-foreground">
                    {r.descontos.recorrentes > 0 && <li>Entregas recorrentes faltando: {fmt(r.descontos.recorrentes)}</li>}
                    {r.descontos.semestrais > 0 && <li>Entregas semestrais vencidas: {fmt(r.descontos.semestrais)}</li>}
                    {r.descontos.saldoAnterior > 0 && <li>Saldo negativo de meses anteriores: {fmt(r.descontos.saldoAnterior)}</li>}
                    {r.descontos.devolucao > 0 && <li>Devolvido (semestral entregue depois): +{fmt(r.descontos.devolucao)}</li>}
                  </ul>
                )}
                {r.modoTeste && (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Modo teste: os ajustes aparecem no detalhe, mas não descontam — o mês paga 100% do apurado.
                  </p>
                )}
              </div>
              <LinhaValor rotulo="Não apurado" nota={`${num(r.pacientesNaoApurados)} ${r.pacientesNaoApurados === 1 ? "paciente sem apuração" : "pacientes sem apuração"}`}
                valor={r.naoApurado} cor={r.naoApurado > 0 ? corPendente : undefined} carregando={loading} />
            </div>
          )}
        </Card>
      </div>

      {/* ── Analistas do mês ─────────────────────────────────────────── */}
      <Card
        titulo="Analistas do mês"
        icone={<Users size={15} />}
        acao={
          <div className="relative">
            <Search size={12} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar analista…"
              aria-label="Buscar analista"
              className="w-44 rounded-full border border-border bg-background py-1 pr-2.5 pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>
        }
      >
        <p className="-mt-1 mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          Primeiro quem ainda tem entregas faltando. Toque num analista para abrir as entregas dele.
          <span className="inline-flex items-center gap-1 font-semibold text-foreground">Status <ExplicacaoStatus /></span>
        </p>
        {visiveis.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhum analista encontrado para “{busca}”.</p>
        ) : (
          <>
            <div className="hidden px-2 pb-1 md:grid md:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7rem_4rem_7rem_1rem] md:gap-3">
              {["Analista", "Pacientes", "Teto", "Apurado", "% teto", "Status", ""].map((h, i) => (
                <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/70 ${i >= 1 && i <= 4 ? "justify-end text-right" : ""}`}>
                  {h}
                  {h === "Status" && <ExplicacaoStatus />}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-border/70">
              {visiveis.map(a => (
                <li key={a.nome}>
                  <button
                    type="button"
                    onClick={() => onSelecionar(a.nome)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7rem_4rem_7rem_1rem]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground" title={a.nome}>{a.nome}</span>
                      {a.status === "faltam_entregas" && resumoFaltas(a.situacao) && (
                        <span className={`block text-[11px] ${TONE_CHIP.amber.text}`}>{resumoFaltas(a.situacao)}</span>
                      )}
                      {a.status === "conferido" && a.situacao?.conferido && (
                        <span className="block text-[11px] text-muted-foreground">
                          Conferido{a.situacao.conferido.por ? ` por ${a.situacao.conferido.por}` : ""} em {new Date(a.situacao.conferido.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </span>
                      )}
                      {a.situacao?.conferenciaInvalidada && (
                        <span className="block text-[11px] text-muted-foreground">Uma entrega mudou depois da conferência</span>
                      )}
                      {a.pacientesSemApuracao.length > 0 && a.pacientes > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          Valor ainda não calculado: {a.pacientesSemApuracao.length} de {a.pacientes} pacientes
                        </span>
                      )}
                      {a.valorRobo + a.valorHumano > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums">
                          <span className={`inline-flex items-center gap-1 font-semibold ${ORIGEM.robo.texto}`}><Bot size={11} aria-hidden /> {fmt(a.valorRobo)}</span>
                          <span className={`inline-flex items-center gap-1 font-semibold ${ORIGEM.humano.texto}`}><User size={11} aria-hidden /> {fmt(a.valorHumano)}</span>
                        </span>
                      )}
                      {/* Mobile: os números descem para uma segunda linha. */}
                      <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground md:hidden">
                        {num(a.pacientes)} pac. · teto {semValor ? "—" : fmt(a.teto)} · apurado {semCalculo(a) ? "—" : fmt(a.apurado)}
                      </span>
                    </span>
                    <span className="hidden text-right text-sm tabular-nums text-foreground md:block">{num(a.pacientes)}</span>
                    <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">{semValor ? "—" : fmt(a.teto)}</span>
                    <span className="hidden text-right text-sm font-bold tabular-nums md:block"
                      style={a.apurado > 0 ? { color: corApurado } : undefined}>
                      {semCalculo(a) ? "—" : fmt(a.apurado)}
                    </span>
                    <span className="hidden text-right text-xs tabular-nums text-muted-foreground md:block">
                      {semCalculo(a) || a.pctTeto === null ? "—" : pct1(a.pctTeto)}
                    </span>
                    <span className="flex items-center justify-end gap-1 md:justify-start">
                      <span title={STATUS[a.status].nota}>
                        <StatusChip tone={STATUS[a.status].tone} dense>{STATUS[a.status].rotulo}</StatusChip>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:hidden" aria-hidden />
                    </span>
                    <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* ── Linhas fora da grade ─────────────────────────────────────── */}
      {!loading && r.foraDaGrade.length > 0 && (
        <details className={`group rounded-xl px-4 py-3 ${TONE_PANEL.amber.bg}`}>
          <summary className="flex cursor-pointer list-none items-start gap-2 text-xs [&::-webkit-details-marker]:hidden">
            <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${TONE_CHIP.amber.text}`} aria-hidden />
            <span className="min-w-0 flex-1 text-foreground">
              <span className="font-semibold">
                {r.foraDaGrade.length === 1
                  ? "1 paciente apurado neste mês não está na grade do mesmo analista."
                  : `${r.foraDaGrade.length} pacientes apurados neste mês não estão na grade do mesmo analista.`}
              </span>{" "}
              <span className="text-muted-foreground">
                Ficam fora da conta acima — por exemplo, paciente que trocou de analista no mês. Toque para ver.
              </span>
            </span>
          </summary>
          <ul className="mt-2 space-y-0.5 pl-6 text-[11px] tabular-nums text-muted-foreground">
            {r.foraDaGrade.map(l => (
              <li key={`${l.prestador}|${l.paciente}`}>
                <span className="font-semibold text-foreground">{l.prestador}</span> · {l.paciente} · {fmt(l.valorLiquido)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function LinhaValor({ rotulo, nota, valor, cor, destaque = false, carregando = false }: {
  rotulo: string; nota?: string; valor: number; cor?: string; destaque?: boolean; carregando?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${destaque ? "border-b border-border pb-2" : ""}`}>
      <div className="min-w-0">
        <p className={`text-xs ${destaque ? "font-bold" : "font-semibold"} text-foreground`}>{rotulo}</p>
        {nota && <p className="text-[11px] leading-snug text-muted-foreground">{nota}</p>}
      </div>
      <p className={`shrink-0 tabular-nums ${destaque ? "text-base font-black" : "text-sm font-bold"} ${carregando ? "opacity-40" : ""}`}
        style={cor ? { color: cor } : undefined}>
        {fmt(valor)}
      </p>
    </div>
  )
}
