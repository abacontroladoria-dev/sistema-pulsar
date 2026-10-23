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
import {
  AlertTriangle, BadgeCheck, Bot, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, Clock, Coins, Copy,
  FileCheck2, FolderOpen, ListChecks, Loader2, Minus, PieChart, Search, Undo2, User, UserCheck, UserRound, Users,
  UsersRound, Wallet,
} from "lucide-react"

import { campo, foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, selo } from "@/components/cronograma/grade/estilo"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import { TONE_SOFT, type Tone } from "@/components/cronograma/ui/tones"
import {
  BarraPartes, CabecalhoSecao, CaixaErro, Cartao, EstadoVazio, Indicador, Progresso, cartaoPadrao,
  type LinhaAjudaPadrao,
} from "@/components/ui/padrao"
import { usePepVisaoGeral } from "@/hooks/usePepVisaoGeral"
import { fmt } from "@/lib/remuneracao/formatacao"
import { situacaoEntregasPorAnalista } from "@/lib/remuneracao/situacaoEntregasPep"
import {
  resumoPepCompetencia, type AnalistaDaGrade, type StatusApuracaoAnalista,
} from "@/lib/remuneracao/visaoGeralPep"
import { useCountUp } from "../RemuneracaoRPDashboard"
import { num, pct1 } from "../visaoGeral/pecas"

const normKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()

function competenciaAtual(): string {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`
}

// `nota` é o texto de "quando aparece": vai na lista ao lado e no tooltip
// (title) de cada status — o mesmo texto nos dois lugares.
const STATUS: Record<StatusApuracaoAnalista, { rotulo: string; tone: Tone; nota: string }> = {
  faltam_entregas: { rotulo: "Faltam entregas", tone: "amber", nota: "O mês tem item esperado sem entrega, ou sugestão esperando uma pessoa. Sai dos dados, sem ninguém clicar." },
  entregas_completas: { rotulo: "Entregas completas", tone: "slate", nota: "Tudo o que era esperado foi entregue, mas ninguém conferiu ainda." },
  conferido: { rotulo: "Conferido", tone: "blue", nota: "Uma pessoa clicou “Marcar como conferido”. Fica gravado quem e quando." },
  liberado: { rotulo: "Liberado para pagamento", tone: "green", nota: "É o “Liberado” de hoje. O mês fica travado." },
  sem_dados: { rotulo: "Sem dados", tone: "slate", nota: "Não foi possível ler as entregas deste mês. Recarregue a página." },
}

const ICONE_STATUS: Record<StatusApuracaoAnalista, typeof Check> = {
  faltam_entregas: Clock, entregas_completas: ListChecks, conferido: UserCheck, liberado: BadgeCheck, sem_dados: AlertTriangle,
}
const ORDEM_BARRA: StatusApuracaoAnalista[] = ["liberado", "conferido", "entregas_completas", "faltam_entregas", "sem_dados"]
const ORDEM_LISTA: StatusApuracaoAnalista[] = ["faltam_entregas", "entregas_completas", "conferido", "liberado"]

/** O "?" dos status: a mesma `nota` que vai no title de cada selo. */
const AJUDA_STATUS: LinhaAjudaPadrao[] = [
  ...ORDEM_LISTA.map(s => ({
    tone: STATUS[s].tone,
    Icone: ICONE_STATUS[s],
    texto: <><strong className="font-semibold">{STATUS[s].rotulo}.</strong> {STATUS[s].nota}</>,
  })),
  { tone: "slate", Icone: Check, texto: "O status mostra o que as pessoas já fizeram com as entregas. Abrir a página do analista não muda o status." },
]

const AJUDA_ORIGEM: LinhaAjudaPadrao[] = [
  { tone: "purple", Icone: Bot, texto: "Roxo: o que o robô SharePoint marcou." },
  { tone: "blue", Icone: User, texto: "Azul: o que uma pessoa da equipe marcou." },
  { tone: "green", Icone: Coins, texto: "Cada entrega vale a parte dela no valor do paciente e conta para quem a marcou." },
]

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
    <div className={`${cartaoPadrao} flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3`}>
      <span className={rotulo}>Mês de atendimento</span>
      <SeletorMesPrevisao ano={ano} mes={mes} onChange={onMudarMes} />
      <NotaFaturamento competencia={competencia} />
      <span className={selo(emAndamento ? "blue" : "slate")}>
        <CalendarDays size={11} aria-hidden />
        {emAndamento ? "Atendimentos em andamento" : "Atendimentos encerrados"}
      </span>
      {modoTeste && <span className={selo("amber")}>Modo teste</span>}
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
  return (
    <PainelVisaoGeralPep competencia={competencia} valorPorPaciente={valorPorPaciente} r={r} idx={idx} acerto={acerto}
      loading={loading} erro={erro} onSelecionar={onSelecionar} />
  )
}

type IndicesDoMes = {
  roboAprovou: number; roboVigentes: number; pessoaAprovou: number; pessoaDesfez: number
  segue: number; fora: number; repetidos: number
}

/** O desenho da Visão geral, sem buscar nada (os dados chegam prontos de VisaoGeralPep). */
export function PainelVisaoGeralPep({ competencia, valorPorPaciente, r, idx, acerto, loading, erro, onSelecionar }: {
  competencia: string
  valorPorPaciente: number
  r: ReturnType<typeof resumoPepCompetencia>
  idx: IndicesDoMes
  /** % do que o robô entregou que continua de pé; null = o robô ainda não entregou nada. */
  acerto: number | null
  loading: boolean
  erro: string | null
  onSelecionar: (nome: string) => void
}) {
  const apuradoAnimado = useCountUp(r.apurado)
  const [busca, setBusca] = useState("")

  const pctGeral = r.teto > 0 ? (r.apurado / r.teto) * 100 : null
  const emAndamento = competencia === competenciaAtual()

  const q = normKey(busca)
  const visiveis = q ? r.porAnalista.filter(a => normKey(a.nome).includes(q)) : r.porAnalista

  // Sem V configurado, "teto" e "não apurado" não fazem sentido — diz, em vez
  // de mostrar R$ 0,00 como se fosse o valor.
  const semValor = valorPorPaciente <= 0
  const esmaece = loading ? "opacity-40" : ""

  return (
    <div className="space-y-4">
      {erro && <CaixaErro mensagem={erro} />}

      {/* ── Apurado do mês ──────────────────────────────────────────── */}
      <Cartao titulo="titulo-apurado">
        <CabecalhoSecao
          id="titulo-apurado"
          titulo="Apurado do mês"
          Icone={Wallet}
          apoio={loading ? "Lendo a apuração do mês…" : "PEP que vai ser paga, somando todos os analistas"}
          direita={!semValor && pctGeral !== null && !loading
            ? <Progresso feitas={r.apurado} total={r.teto} texto={pct1(pctGeral)} rotulo="do teto" tone="green" />
            : undefined}
        />

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-xl font-semibold tabular-nums ${esmaece} ${r.apurado > 0 ? TONE_SOFT.green.text : "text-muted-foreground"}`}>
            {fmt(apuradoAnimado)}
          </span>
          <span className="text-sm text-muted-foreground">
            de {semValor ? "—" : fmt(r.teto)} de teto
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador Icone={Users} valor={num(r.analistas)} rotulo={r.analistas === 1 ? "Analista" : "Analistas"} />
          <Indicador Icone={UserRound} valor={num(r.pacientes)} rotulo="Pacientes" />
          <Indicador
            Icone={UsersRound}
            valor={r.pacientesPorAnalista.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            rotulo="Pacientes por analista"
            apoio={`de ${num(r.pacientesPorAnalista.min)} a ${num(r.pacientesPorAnalista.max)}`}
          />
          <Indicador Icone={Coins} valor={semValor ? "—" : fmt(valorPorPaciente)} rotulo="Valor por paciente" />
        </div>

        {!semValor && (
          <div className="mt-4">
            <BarraPartes formatar={fmt} partes={[
              { valor: r.apurado, tone: "green", rotulo: "Apurado" },
              { valor: Math.max(0, r.descontos.total), tone: "red", rotulo: "Descontado" },
              { valor: Math.max(0, r.naoApurado), tone: "amber", rotulo: "Não apurado" },
            ]} />
          </div>
        )}

        {emAndamento && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarDays size={14} className="mt-px shrink-0" aria-hidden />
            Atendimentos em andamento: o teto pode crescer até o fim do mês.
          </p>
        )}
        {semValor && (
          <p className={`mt-3 ${aviso("amber")}`}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>O valor da PEP por paciente não está configurado em Parâmetros Gerais. Sem ele não há teto nem valor não apurado.</span>
          </p>
        )}
      </Cartao>

      {/* ── Quem fez o apurado: robô × pessoas ──────────────────────── */}
      <Cartao titulo="titulo-quem-fez">
        <CabecalhoSecao
          id="titulo-quem-fez"
          titulo="Quem fez o apurado"
          nivel="h3"
          Icone={FileCheck2}
          ajuda={AJUDA_ORIGEM}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Indicador
            tone="purple"
            Icone={Bot}
            valor={<span className={esmaece}>{fmt(r.origem.robo)}</span>}
            rotulo="Robô SharePoint"
            apoio={`${num(idx.roboVigentes)} ${idx.roboVigentes === 1 ? "entrega marcada" : "entregas marcadas"}`}
            apagado={r.origem.robo <= 0}
          />
          <Indicador
            tone="blue"
            Icone={User}
            valor={<span className={esmaece}>{fmt(r.origem.humano)}</span>}
            rotulo="Pessoas da equipe"
            apoio={`${num(idx.pessoaAprovou)} ${idx.pessoaAprovou === 1 ? "entrega marcada" : "entregas marcadas"} à mão`}
            apagado={r.origem.humano <= 0}
          />
          <Indicador
            tone="slate"
            Icone={Undo2}
            valor={num(idx.pessoaDesfez)}
            rotulo="Pessoas desfizeram"
            apoio={acerto != null ? `o robô acertou ${acerto}% do que entregou` : "o robô ainda não entregou nada"}
            apagado={idx.pessoaDesfez === 0}
          />
        </div>

        {r.origem.robo + r.origem.humano > 0 && (
          <div className="mt-4">
            <BarraPartes formatar={fmt} partes={[
              { valor: r.origem.robo, tone: "purple", rotulo: "Robô" },
              { valor: r.origem.humano, tone: "blue", rotulo: "Pessoas" },
            ]} />
            {Math.abs(r.origem.ajustes) >= 0.01 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Apurado = robô + pessoas {r.origem.ajustes < 0 ? "−" : "+"} {fmt(Math.abs(r.origem.ajustes))} de {r.origem.ajustes < 0 ? "descontos semestrais e saldo" : "devolução ou mês de teste"}.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <FolderOpen size={14} aria-hidden /> No SharePoint neste mês
          </span>
          <span className={selo("green")} title="Arquivos com o nome no padrão: contam para a entrega.">
            <Check size={11} aria-hidden />{num(idx.segue)} no padrão
          </span>
          <span className={selo("amber")} title="Arquivos com o nome fora do padrão: não contam.">
            <AlertTriangle size={11} aria-hidden />{num(idx.fora)} fora do padrão
          </span>
          {idx.repetidos > 0 && (
            <span className={selo("slate")} title="Outro arquivo igual já conta.">
              <Copy size={11} aria-hidden />{num(idx.repetidos)} repetidos
            </span>
          )}
        </div>
      </Cartao>

      {/* ── Situação + Para onde vai o teto ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Cartao titulo="titulo-situacao">
          <CabecalhoSecao
            id="titulo-situacao"
            titulo="Situação das entregas"
            nivel="h3"
            Icone={ClipboardList}
            ajuda={AJUDA_STATUS}
            rotuloAjuda="O que cada status quer dizer"
            direita={<Progresso feitas={r.porStatus.liberado} total={r.analistas} rotulo="liberados" tone="green" />}
          />
          <BarraPartes legenda={false} partes={ORDEM_BARRA.map(s => ({ valor: r.porStatus[s], tone: STATUS[s].tone, rotulo: STATUS[s].rotulo }))} />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ORDEM_LISTA.map(s => (
              <Indicador
                key={s}
                tone={STATUS[s].tone}
                Icone={ICONE_STATUS[s]}
                valor={num(r.porStatus[s])}
                rotulo={STATUS[s].rotulo}
                title={STATUS[s].nota}
                apagado={r.porStatus[s] === 0}
              />
            ))}
          </div>
        </Cartao>

        <Cartao titulo="titulo-teto">
          <CabecalhoSecao
            id="titulo-teto"
            titulo="Para onde vai o teto"
            nivel="h3"
            Icone={PieChart}
            apoio={semValor ? undefined : `${num(r.pacientes)} pacientes × ${fmt(valorPorPaciente)}`}
            direita={semValor ? undefined : (
              <p className="text-right leading-none">
                <span className="block text-xl font-semibold tabular-nums text-foreground">{fmt(r.teto)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">teto do mês</span>
              </p>
            )}
          />
          {semValor ? (
            <p className={aviso("amber")}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>Sem valor por paciente configurado, não há teto a repartir.</span>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                    <th className="pb-2 pr-3 font-semibold">Parcela</th>
                    <th className="pb-2 px-3 text-right font-semibold">Valor</th>
                    <th className="pb-2 pl-3 text-right font-semibold">% teto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  <LinhaTeto tone="green" Icone={Check} rotulo="Apurado" nota="vai ser pago" valor={r.apurado} teto={r.teto} carregando={loading} />
                  <LinhaTeto tone="red" Icone={Minus} rotulo="Descontado" nota="entregas faltando e saldo de meses anteriores" valor={r.descontos.total} teto={r.teto} carregando={loading}>
                    {!loading && (r.descontos.recorrentes > 0 || r.descontos.semestrais > 0 || r.descontos.saldoAnterior > 0 || r.descontos.devolucao > 0) && (
                      <ul className="mt-2 space-y-1 border-t border-border/50 pt-2 text-xs tabular-nums text-muted-foreground">
                        {r.descontos.recorrentes > 0 && <li className="flex justify-between gap-3"><span>Recorrentes faltando</span><span>{fmt(r.descontos.recorrentes)}</span></li>}
                        {r.descontos.semestrais > 0 && <li className="flex justify-between gap-3"><span>Semestrais vencidas</span><span>{fmt(r.descontos.semestrais)}</span></li>}
                        {r.descontos.saldoAnterior > 0 && <li className="flex justify-between gap-3"><span>Saldo negativo anterior</span><span>{fmt(r.descontos.saldoAnterior)}</span></li>}
                        {r.descontos.devolucao > 0 && <li className="flex justify-between gap-3"><span>Devolvido (semestral entregue depois)</span><span>+{fmt(r.descontos.devolucao)}</span></li>}
                      </ul>
                    )}
                    {r.modoTeste && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Modo teste: os ajustes aparecem no detalhe, mas não descontam. O mês paga 100% do apurado.
                      </p>
                    )}
                  </LinhaTeto>
                  <LinhaTeto
                    tone="amber"
                    Icone={Clock}
                    rotulo="Não apurado"
                    nota={`${num(r.pacientesNaoApurados)} ${r.pacientesNaoApurados === 1 ? "paciente sem apuração" : "pacientes sem apuração"}`}
                    valor={r.naoApurado}
                    teto={r.teto}
                    carregando={loading}
                  />
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>

      {/* ── Analistas do mês ─────────────────────────────────────────── */}
      <Cartao titulo="titulo-analistas">
        <CabecalhoSecao
          id="titulo-analistas"
          titulo="Analistas do mês"
          nivel="h3"
          Icone={Users}
          apoio="Primeiro quem tem entregas faltando. Toque para abrir."
          ajuda={AJUDA_STATUS}
          rotuloAjuda="O que cada status quer dizer"
          direita={
            <div className="relative w-full sm:w-64">
              <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar analista…"
                aria-label="Buscar analista"
                className={`${campo} pl-8`}
              />
            </div>
          }
        />
        {visiveis.length === 0 ? (
          <EstadoVazio Icone={Users} titulo={`Nenhum analista encontrado para “${busca}”.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">Analista</th>
                  <th className="pb-2 px-3 text-right font-semibold">Pacientes</th>
                  <th className="pb-2 px-3 text-right font-semibold">Teto</th>
                  <th className="pb-2 px-3 text-right font-semibold">Apurado</th>
                  <th className="pb-2 px-3 text-right font-semibold">% teto</th>
                  <th className="pb-2 px-3 font-semibold">Status</th>
                  <th className="pb-2 pl-2 w-6" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visiveis.map(a => {
                  const st = STATUS[a.status]
                  return (
                    <tr
                      key={a.nome}
                      onClick={() => onSelecionar(a.nome)}
                      className="group cursor-pointer transition-colors hover:bg-muted/50"
                    >
                      <td className="py-3 pr-3 align-top">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); onSelecionar(a.nome) }}
                          className={`text-left text-sm font-semibold text-foreground break-words ${foco}`}
                        >
                          {a.nome}
                        </button>
                        {a.status === "faltam_entregas" && resumoFaltas(a.situacao) && (
                          <span className={`mt-0.5 block text-xs ${TONE_SOFT.amber.text}`}>{resumoFaltas(a.situacao)}</span>
                        )}
                        {a.status === "conferido" && a.situacao?.conferido && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Conferido{a.situacao.conferido.por ? ` por ${a.situacao.conferido.por}` : ""} em {new Date(a.situacao.conferido.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </span>
                        )}
                        {a.situacao?.conferenciaInvalidada && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">Uma entrega mudou depois da conferência</span>
                        )}
                        {a.pacientesSemApuracao.length > 0 && a.pacientes > 0 && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Valor ainda não calculado: {a.pacientesSemApuracao.length} de {a.pacientes} pacientes
                          </span>
                        )}
                        {a.valorRobo + a.valorHumano > 0 && (
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 tabular-nums">
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
                              <Bot size={11} aria-hidden /> {fmt(a.valorRobo)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                              <User size={11} aria-hidden /> {fmt(a.valorHumano)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right align-top tabular-nums text-foreground">{num(a.pacientes)}</td>
                      <td className="py-3 px-3 text-right align-top tabular-nums text-muted-foreground">{semValor ? "—" : fmt(a.teto)}</td>
                      <td className={`py-3 px-3 text-right align-top font-semibold tabular-nums ${a.apurado > 0 ? TONE_SOFT.green.text : "text-foreground"}`}>
                        {semCalculo(a) ? "—" : fmt(a.apurado)}
                      </td>
                      <td className="py-3 px-3 text-right align-top text-xs tabular-nums text-muted-foreground">
                        {semCalculo(a) || a.pctTeto === null ? "—" : pct1(a.pctTeto)}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <span className={selo(st.tone)} title={st.nota}>{st.rotulo}</span>
                      </td>
                      <td className="py-3 pl-2 align-top text-right">
                        <ChevronRight size={15} className="inline-block text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      {/* ── Linhas fora da grade ─────────────────────────────────────── */}
      {!loading && r.foraDaGrade.length > 0 && (
        <details className={`group rounded-lg ${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text} px-4 py-3 text-sm`}>
          <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">
                {r.foraDaGrade.length === 1
                  ? "1 paciente apurado fora da grade do analista"
                  : `${r.foraDaGrade.length} pacientes apurados fora da grade do analista`}
              </span>{" "}
              <span className="text-muted-foreground">
                Ficam fora da conta acima (ex.: trocou de analista no mês). Toque para ver.
              </span>
            </span>
            <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 space-y-1 pl-6 text-xs tabular-nums text-muted-foreground">
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

/** Uma fatia do teto como linha de tabela: ícone, rótulo, valor e % do teto. */
function LinhaTeto({ tone, Icone, rotulo: nome, nota, valor, teto, carregando, children }: {
  tone: Tone; Icone: typeof Check; rotulo: string; nota: string; valor: number; teto: number; carregando: boolean; children?: React.ReactNode
}) {
  const zerado = valor <= 0
  const fatia = teto > 0 ? Math.min(100, (Math.max(0, valor) / teto) * 100) : 0
  const cor = zerado ? "text-muted-foreground" : TONE_SOFT[tone].text
  return (
    <tr>
      <td className="py-3 pr-3 align-top">
        <div className="flex items-start gap-2">
          <Icone size={15} className={`mt-0.5 shrink-0 ${cor}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{nome}</p>
            <p className="text-xs text-muted-foreground">{nota}</p>
            {children}
          </div>
        </div>
      </td>
      <td className={`py-3 px-3 text-right align-top font-semibold tabular-nums ${cor} ${carregando ? "opacity-40" : ""}`}>
        {fmt(valor)}
      </td>
      <td className="py-3 pl-3 text-right align-top text-xs tabular-nums text-muted-foreground">
        {Math.round(fatia)}%
      </td>
    </tr>
  )
}
