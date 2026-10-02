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

import { fmt } from "@/lib/remuneracao/formatacao"
import type { Tone } from "@/hooks/useToneColor"
import { usePepVisaoGeral } from "@/hooks/usePepVisaoGeral"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import {
  AnelProgresso, BarraPastel, CabecalhoPastel, NumeroPastel, SecaoPastel, iniciais, tom,
  type LinhaAjuda, type Tom,
} from "@/components/ui/pastel/pecas"
import { useCountUp } from "../RemuneracaoRPDashboard"
import { num, pct1 } from "../visaoGeral/pecas"
import {
  resumoPepCompetencia, type AnalistaDaGrade, type StatusApuracaoAnalista,
} from "@/lib/remuneracao/visaoGeralPep"
import { situacaoEntregasPorAnalista } from "@/lib/remuneracao/situacaoEntregasPep"


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

// Visual pastel (docs/PLANO_PEP_VISUAL_PASTEL.md, fases 3, 4, 5 e 7): cada
// tom do status vira um tom do kit. Azul (conferido) é "uma pessoa clicou",
// o mesmo sentido do azul de pessoa da PEP.
const TOM_STATUS: Record<Tone, Tom> = {
  green: "verde", amber: "amber", red: "vermelho", purple: "robo", blue: "pessoa", gray: "cinza",
}
const ICONE_STATUS: Record<StatusApuracaoAnalista, typeof Check> = {
  faltam_entregas: Clock, entregas_completas: ListChecks, conferido: UserCheck, liberado: BadgeCheck, sem_dados: AlertTriangle,
}
const ORDEM_BARRA: StatusApuracaoAnalista[] = ["liberado", "conferido", "entregas_completas", "faltam_entregas", "sem_dados"]
const ORDEM_LISTA: StatusApuracaoAnalista[] = ["faltam_entregas", "entregas_completas", "conferido", "liberado"]

/** O "?" dos status: a mesma `nota` que vai no title de cada selo. */
const AJUDA_STATUS: LinhaAjuda[] = [
  ...ORDEM_LISTA.map(s => ({
    t: TOM_STATUS[STATUS[s].tone], Icone: ICONE_STATUS[s],
    texto: <><strong className="font-extrabold">{STATUS[s].rotulo}.</strong> {STATUS[s].nota}</>,
  })),
  { t: "cinza", Icone: Check, texto: "O status mostra o que as pessoas já fizeram com as entregas. Abrir a página do analista não muda o status." },
]

const AJUDA_ORIGEM: LinhaAjuda[] = [
  { t: "robo", Icone: Bot, texto: "Roxo: o que o robô SharePoint marcou." },
  { t: "pessoa", Icone: User, texto: "Azul: o que uma pessoa da equipe marcou." },
  { t: "verde", Icone: Coins, texto: "Cada entrega vale a parte dela no valor do paciente e conta para quem a marcou." },
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
    <span className="text-xs text-[var(--pp-ink-muted)]">
      → faturamento em <span className="font-semibold text-[var(--pp-ink)]">{f.mesFaturamento}</span>
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
    <div className="pp flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--pp-border)] bg-[var(--pp-surface)] px-4 py-3 shadow-[var(--pp-sombra)] md:px-5">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--pp-ink-muted)]">Mês de atendimento</span>
      <SeletorMesPrevisao ano={ano} mes={mes} onChange={onMudarMes} />
      <NotaFaturamento competencia={competencia} />
      <span className={`${tom(emAndamento ? "pessoa" : "cinza")} pp-selo`}>
        <CalendarDays size={11} aria-hidden />
        {emAndamento ? "Atendimentos em andamento" : "Atendimentos encerrados"}
      </span>
      {modoTeste && <span className={`${tom("amber")} pp-selo`}>Modo teste</span>}
      {carregando && (
        <span className="flex items-center gap-1.5 text-xs text-[var(--pp-ink-muted)]">
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
  /** % do que o robô entregou que continua de pé; null = o robô não entregou nada. */
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
      {erro && (
        <p className={`${tom("vermelho")} pp flex items-start gap-2 rounded-2xl bg-[var(--c-suave)] px-4 py-3 text-sm font-semibold text-[var(--c-tinta)] shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {erro}
        </p>
      )}

      {/* ── Apurado do mês ──────────────────────────────────────────── */}
      <SecaoPastel titulo="titulo-apurado">
        <CabecalhoPastel
          id="titulo-apurado"
          titulo="Apurado do mês"
          t="verde"
          Icone={Wallet}
          apoio={loading ? "Lendo a apuração do mês…" : "PEP que vai ser paga, somando todos os analistas"}
          direita={!semValor && pctGeral !== null && !loading
            ? <AnelProgresso feitas={r.apurado} total={r.teto} texto={pct1(pctGeral)} rotulo="do teto" />
            : undefined}
        />

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-[44px] font-extrabold leading-[48px] tracking-[-0.03em] tabular-nums ${esmaece} ${r.apurado > 0 ? "text-[var(--pp-verde-tinta)]" : "text-[var(--pp-ink-muted)]"}`}>
            {fmt(apuradoAnimado)}
          </span>
          <span className="text-sm font-bold text-[var(--pp-ink-muted)]">
            de {semValor ? "—" : fmt(r.teto)} de teto
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <NumeroPastel compacto t="aco" Icone={Users} valor={num(r.analistas)} rotulo={r.analistas === 1 ? "analista" : "analistas"} />
          <NumeroPastel compacto t="aco" Icone={UserRound} valor={num(r.pacientes)} rotulo="pacientes" />
          <NumeroPastel compacto t="aco" Icone={UsersRound}
            valor={r.pacientesPorAnalista.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            rotulo="pacientes por analista" apoio={`de ${num(r.pacientesPorAnalista.min)} a ${num(r.pacientesPorAnalista.max)}`} />
          <NumeroPastel compacto t="aco" Icone={Coins} valor={semValor ? "—" : fmt(valorPorPaciente)} rotulo="valor por paciente" />
        </div>

        {!semValor && (
          <div className="mt-5">
            <BarraPastel formatar={fmt} partes={[
              { valor: r.apurado, t: "verde", rotulo: "Apurado", Icone: Check },
              { valor: Math.max(0, r.descontos.total), t: "vermelho", rotulo: "Descontado", Icone: Minus },
              { valor: Math.max(0, r.naoApurado), t: "amber", rotulo: "Não apurado", Icone: Clock },
            ]} />
          </div>
        )}

        {emAndamento && (
          <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold leading-snug text-[var(--pp-ink-muted)]">
            <CalendarDays size={14} className="mt-px shrink-0" aria-hidden />
            Atendimentos em andamento: o teto pode crescer até o fim do mês.
          </p>
        )}
        {semValor && <AvisoPastel>O valor da PEP por paciente não está configurado em Parâmetros Gerais. Sem ele não há teto nem valor não apurado.</AvisoPastel>}
      </SecaoPastel>

      {/* ── Quem fez o apurado: robô × pessoas ──────────────────────── */}
      <SecaoPastel titulo="titulo-quem-fez">
        <CabecalhoPastel
          id="titulo-quem-fez"
          titulo="Quem fez o apurado"
          tamanho="medio"
          nivel="h3"
          t="robo"
          Icone={FileCheck2}
          ajuda={AJUDA_ORIGEM}
        />

        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          <NumeroPastel t="robo" Icone={Bot} valor={<span className={esmaece}>{fmt(r.origem.robo)}</span>} rotulo="Robô SharePoint"
            apoio={`${num(idx.roboVigentes)} ${idx.roboVigentes === 1 ? "entrega marcada" : "entregas marcadas"}`} />
          <NumeroPastel t="pessoa" Icone={User} valor={<span className={esmaece}>{fmt(r.origem.humano)}</span>} rotulo="Pessoas da equipe"
            apoio={`${num(idx.pessoaAprovou)} ${idx.pessoaAprovou === 1 ? "entrega marcada" : "entregas marcadas"} à mão`} />
          <NumeroPastel t="cinza" Icone={Undo2} valor={num(idx.pessoaDesfez)} rotulo="Pessoas desfizeram"
            apoio={acerto != null ? `o robô acertou ${acerto}% do que entregou` : "o robô ainda não entregou nada"} />
        </div>

        {r.origem.robo + r.origem.humano > 0 && (
          <div className="mt-4">
            <BarraPastel formatar={fmt} partes={[
              { valor: r.origem.robo, t: "robo", rotulo: "Robô", Icone: Bot },
              { valor: r.origem.humano, t: "pessoa", rotulo: "Pessoas", Icone: User },
            ]} />
            {Math.abs(r.origem.ajustes) >= 0.01 && (
              <p className="mt-2 text-xs font-semibold leading-snug text-[var(--pp-ink-muted)]">
                Apurado = robô + pessoas {r.origem.ajustes < 0 ? "−" : "+"} {fmt(Math.abs(r.origem.ajustes))} de {r.origem.ajustes < 0 ? "descontos semestrais e saldo" : "devolução ou mês de teste"}.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--pp-border)] pt-4">
          <span className="mr-1 flex items-center gap-1.5 text-xs font-extrabold"><FolderOpen size={14} aria-hidden /> No SharePoint neste mês</span>
          <span className={`${tom("verde")} pp-pilula h-8 pl-1.5 text-[12px]`} title="Arquivos com o nome no padrão: contam para a entrega.">
            <span className="pp-pilula-bola size-5"><Check size={12} aria-hidden /></span>{num(idx.segue)} no padrão
          </span>
          <span className={`${tom("amber")} pp-pilula h-8 pl-1.5 text-[12px]`} title="Arquivos com o nome fora do padrão: não contam.">
            <span className="pp-pilula-bola size-5"><AlertTriangle size={12} aria-hidden /></span>{num(idx.fora)} fora do padrão
          </span>
          {idx.repetidos > 0 && (
            <span className={`${tom("cinza")} pp-pilula h-8 pl-1.5 text-[12px]`} title="Outro arquivo igual já conta.">
              <span className="pp-pilula-bola size-5"><Copy size={12} aria-hidden /></span>{num(idx.repetidos)} repetidos
            </span>
          )}
        </div>
      </SecaoPastel>

      {/* ── Situação + Para onde vai o teto ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <SecaoPastel titulo="titulo-situacao">
          <CabecalhoPastel
            id="titulo-situacao"
            titulo="Situação das entregas"
            tamanho="medio"
            nivel="h3"
            t="verde"
            Icone={ClipboardList}
            ajuda={AJUDA_STATUS}
            rotuloAjuda="O que cada status quer dizer"
            direita={<AnelProgresso feitas={r.porStatus.liberado} total={r.analistas} rotulo="liberados" />}
          />
          <BarraPastel legenda={false} partes={ORDEM_BARRA.map(s => ({ valor: r.porStatus[s], t: TOM_STATUS[STATUS[s].tone], rotulo: STATUS[s].rotulo }))} />
          <div className="mt-4 grid grid-cols-1 gap-3 @sm:grid-cols-2">
            {ORDEM_LISTA.map(s => (
              <NumeroPastel key={s} compacto t={TOM_STATUS[STATUS[s].tone]} Icone={ICONE_STATUS[s]} valor={num(r.porStatus[s])}
                rotulo={STATUS[s].rotulo} title={STATUS[s].nota} apagado={r.porStatus[s] === 0} />
            ))}
          </div>
        </SecaoPastel>

        <SecaoPastel titulo="titulo-teto">
          <CabecalhoPastel
            id="titulo-teto"
            titulo="Para onde vai o teto"
            tamanho="medio"
            nivel="h3"
            t="cinza"
            Icone={PieChart}
            apoio={semValor ? undefined : `${num(r.pacientes)} pacientes × ${fmt(valorPorPaciente)}`}
            direita={semValor ? undefined : (
              <p className="text-right leading-none">
                <span className="block text-[22px] font-extrabold tabular-nums">{fmt(r.teto)}</span>
                <span className="mt-1 block text-xs font-semibold text-[var(--pp-ink-muted)]">teto do mês</span>
              </p>
            )}
          />
          {semValor ? (
            <AvisoPastel>Sem valor por paciente configurado, não há teto a repartir.</AvisoPastel>
          ) : (
            <div className="space-y-3">
              <LinhaTeto t="verde" Icone={Check} rotulo="Apurado" nota="vai ser pago" valor={r.apurado} teto={r.teto} carregando={loading} />
              <LinhaTeto t="vermelho" Icone={Minus} rotulo="Descontado" nota="entregas faltando e saldo de meses anteriores" valor={r.descontos.total} teto={r.teto} carregando={loading}>
                {!loading && (r.descontos.recorrentes > 0 || r.descontos.semestrais > 0 || r.descontos.saldoAnterior > 0 || r.descontos.devolucao > 0) && (
                  <ul className="mt-2.5 space-y-1 border-t border-[var(--c-linha)] pt-2.5 text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)]">
                    {r.descontos.recorrentes > 0 && <li className="flex justify-between gap-3"><span>Recorrentes faltando</span><span>{fmt(r.descontos.recorrentes)}</span></li>}
                    {r.descontos.semestrais > 0 && <li className="flex justify-between gap-3"><span>Semestrais vencidas</span><span>{fmt(r.descontos.semestrais)}</span></li>}
                    {r.descontos.saldoAnterior > 0 && <li className="flex justify-between gap-3"><span>Saldo negativo anterior</span><span>{fmt(r.descontos.saldoAnterior)}</span></li>}
                    {r.descontos.devolucao > 0 && <li className="flex justify-between gap-3"><span>Devolvido (semestral entregue depois)</span><span>+{fmt(r.descontos.devolucao)}</span></li>}
                  </ul>
                )}
                {r.modoTeste && (
                  <p className="mt-2 text-xs font-semibold leading-snug text-[var(--pp-ink-muted)]">
                    Modo teste: os ajustes aparecem no detalhe, mas não descontam. O mês paga 100% do apurado.
                  </p>
                )}
              </LinhaTeto>
              <LinhaTeto t="amber" Icone={Clock} rotulo="Não apurado"
                nota={`${num(r.pacientesNaoApurados)} ${r.pacientesNaoApurados === 1 ? "paciente sem apuração" : "pacientes sem apuração"}`}
                valor={r.naoApurado} teto={r.teto} carregando={loading} />
            </div>
          )}
        </SecaoPastel>
      </div>

      {/* ── Analistas do mês ─────────────────────────────────────────── */}
      <SecaoPastel titulo="titulo-analistas">
        <CabecalhoPastel
          id="titulo-analistas"
          titulo="Analistas do mês"
          tamanho="medio"
          nivel="h3"
          t="aco"
          Icone={Users}
          apoio="Primeiro quem tem entregas faltando. Toque para abrir."
          ajuda={AJUDA_STATUS}
          rotuloAjuda="O que cada status quer dizer"
          direita={
            <div className="relative w-full @md:w-64">
              <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--pp-ink-muted)]" />
              <input
                type="search"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar analista…"
                aria-label="Buscar analista"
                className="pp-busca"
              />
            </div>
          }
        />
        {visiveis.length === 0 ? (
          <p className="py-6 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">Nenhum analista encontrado para “{busca}”.</p>
        ) : (
          <>
            <div className="hidden px-3 pb-2 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7rem_4rem_10rem_1rem] @3xl:gap-3">
              {["Analista", "Pacientes", "Teto", "Apurado", "% teto", "Status", ""].map((h, i) => (
                <span key={i} className={`text-[11px] font-extrabold text-[var(--pp-ink-muted)] ${i >= 1 && i <= 4 ? "text-right" : ""}`}>{h}</span>
              ))}
            </div>
            <ul className="space-y-1.5">
              {visiveis.map(a => {
                const t = TOM_STATUS[STATUS[a.status].tone]
                return (
                  <li key={a.nome}>
                    <button
                      type="button"
                      onClick={() => onSelecionar(a.nome)}
                      className={`${tom(t)} group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-2xl px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--pp-border)] transition-colors hover:bg-[var(--c-suave)] hover:shadow-[inset_0_0_0_2px_var(--c-medio)] @3xl:grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_7rem_7rem_4rem_10rem_1rem]`}
                    >
                      <span className="pp-avatar size-9 text-xs" aria-hidden>{iniciais(a.nome)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold" title={a.nome}>{a.nome}</span>
                        <span className="pp-selo pp-selo-motivo my-1 @3xl:hidden" title={STATUS[a.status].nota}>{STATUS[a.status].rotulo}</span>
                        {a.status === "faltam_entregas" && resumoFaltas(a.situacao) && (
                          <span className="block text-xs font-semibold text-[var(--c-tinta)]">{resumoFaltas(a.situacao)}</span>
                        )}
                        {a.status === "conferido" && a.situacao?.conferido && (
                          <span className="block text-xs font-semibold text-[var(--pp-ink-muted)]">
                            Conferido{a.situacao.conferido.por ? ` por ${a.situacao.conferido.por}` : ""} em {new Date(a.situacao.conferido.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </span>
                        )}
                        {a.situacao?.conferenciaInvalidada && (
                          <span className="block text-xs font-semibold text-[var(--pp-ink-muted)]">Uma entrega mudou depois da conferência</span>
                        )}
                        {a.pacientesSemApuracao.length > 0 && a.pacientes > 0 && (
                          <span className="block text-xs font-semibold text-[var(--pp-ink-muted)]">
                            Valor ainda não calculado: {a.pacientesSemApuracao.length} de {a.pacientes} pacientes
                          </span>
                        )}
                        {a.valorRobo + a.valorHumano > 0 && (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold tabular-nums">
                            <span className={`${tom("robo")} inline-flex items-center gap-1 rounded-full bg-[var(--c-suave)] px-2 py-0.5 text-[var(--c-tinta)]`}><Bot size={11} aria-hidden /> {fmt(a.valorRobo)}</span>
                            <span className={`${tom("pessoa")} inline-flex items-center gap-1 rounded-full bg-[var(--c-suave)] px-2 py-0.5 text-[var(--c-tinta)]`}><User size={11} aria-hidden /> {fmt(a.valorHumano)}</span>
                          </span>
                        )}
                        {/* Celular: os números descem para uma segunda linha. */}
                        <span className="mt-0.5 block text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)] @3xl:hidden">
                          {num(a.pacientes)} pac. · teto {semValor ? "—" : fmt(a.teto)} · apurado {semCalculo(a) ? "—" : fmt(a.apurado)}
                        </span>
                      </span>
                      <span className="hidden text-right text-sm font-semibold tabular-nums @3xl:block">{num(a.pacientes)}</span>
                      <span className="hidden text-right text-sm font-semibold tabular-nums text-[var(--pp-ink-muted)] @3xl:block">{semValor ? "—" : fmt(a.teto)}</span>
                      <span className={`hidden text-right text-sm font-extrabold tabular-nums @3xl:block ${a.apurado > 0 ? "text-[var(--pp-verde-tinta)]" : ""}`}>
                        {semCalculo(a) ? "—" : fmt(a.apurado)}
                      </span>
                      <span className="hidden text-right text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)] @3xl:block">
                        {semCalculo(a) || a.pctTeto === null ? "—" : pct1(a.pctTeto)}
                      </span>
                      <span className="hidden @3xl:flex">
                        <span className="pp-selo pp-selo-motivo" title={STATUS[a.status].nota}>{STATUS[a.status].rotulo}</span>
                      </span>
                      <ChevronRight size={15} className="shrink-0 text-[var(--pp-ink-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </SecaoPastel>

      {/* ── Linhas fora da grade ─────────────────────────────────────── */}
      {!loading && r.foraDaGrade.length > 0 && (
        <details className={`${tom("amber")} pp group rounded-2xl bg-[var(--c-suave)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
          <summary className="flex cursor-pointer list-none items-start gap-2.5 text-sm [&::-webkit-details-marker]:hidden">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--c)] text-[var(--c-sobre)]"><AlertTriangle size={14} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="font-extrabold">
                {r.foraDaGrade.length === 1
                  ? "1 paciente apurado fora da grade do analista"
                  : `${r.foraDaGrade.length} pacientes apurados fora da grade do analista`}
              </span>{" "}
              <span className="font-semibold text-[var(--pp-ink-muted)]">
                Ficam fora da conta acima (ex.: trocou de analista no mês). Toque para ver.
              </span>
            </span>
            <ChevronDown size={16} className="mt-1 shrink-0 text-[var(--pp-ink-muted)] transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 space-y-0.5 pl-10 text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)]">
            {r.foraDaGrade.map(l => (
              <li key={`${l.prestador}|${l.paciente}`}>
                <span className="font-extrabold text-[var(--pp-ink)]">{l.prestador}</span> · {l.paciente} · {fmt(l.valorLiquido)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function AvisoPastel({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${tom("amber")} mt-4 flex items-start gap-2 rounded-2xl bg-[var(--c-suave)] px-4 py-3 text-xs font-semibold leading-snug text-[var(--c-tinta)] shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
      <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> {children}
    </p>
  )
}

/** Uma fatia do teto: ícone, rótulo, valor e a barra do quanto do teto ela leva. */
function LinhaTeto({ t, Icone, rotulo, nota, valor, teto, carregando, children }: {
  t: Tom; Icone: typeof Check; rotulo: string; nota: string; valor: number; teto: number; carregando: boolean; children?: React.ReactNode
}) {
  const zerado = valor <= 0
  const fatia = teto > 0 ? Math.min(100, (Math.max(0, valor) / teto) * 100) : 0
  return (
    <div className={`${tom(zerado ? "cinza" : t)} rounded-2xl bg-[var(--c-suave)] p-3.5 shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--c)] text-[var(--c-sobre)]" aria-hidden><Icone size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold">{rotulo}</span>
          <span className="block text-xs font-semibold leading-snug text-[var(--pp-ink-muted)]">{nota}</span>
        </span>
        <span className={`shrink-0 text-right text-[20px] font-extrabold tabular-nums text-[var(--c-tinta)] ${carregando ? "opacity-40" : ""}`}>{fmt(valor)}</span>
      </div>
      <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-[var(--pp-surface)]" role="img" aria-label={`${rotulo}: ${Math.round(fatia)}% do teto`}>
        <span className="block h-full rounded-full bg-[var(--c-medio)] transition-[width] duration-500" style={{ width: `${fatia}%`, minWidth: zerado ? 0 : 6 }} />
      </span>
      {children}
    </div>
  )
}
