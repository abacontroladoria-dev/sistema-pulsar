"use client"

// Painel do profissional escolhido na Remuneração Individual — o que vai sair no
// PDF/Word, na tela, ANTES de exportar.
//
// A prévia não calcula nada: desenha as `linhas` de montarDemonstrativo
// (lib/remuneracao/demonstrativo.ts), exatamente as mesmas que o documento
// desenha. Se o documento vai sair com dado provisório ou com linhas que não
// fecham com o total, a coluna "Antes de exportar" diz — é para isso que a
// prévia existe.
//
// A leitura operacional do mês (cobertura, sem registro, inconsistências) vem de
// composicaoRP(), a mesma régua do /rp; o detalhe linha a linha fica no
// ModalRemuneracaoRP ("Ver sessões"), sem duplicar a tabela aqui.
//
// Remonta por `key={prof}` (quem monta é RemunIndividualTab) — nada de efeito
// para resetar estado ao trocar de pessoa (§3.12 do padrão de detalhamento).

import { useMemo } from "react"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, CheckCircle2, ClipboardList, FileSpreadsheet, FileText,
  ListChecks, Repeat2, Sigma, UserRound, Users, Wallet,
} from "lucide-react"

import { fmt } from "@/lib/remuneracao/formatacao"
import { parseDateBR, formatDateBR } from "@/lib/remuneracao/datas"
import { B } from "@/lib/cronograma/constants"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { composicaoRP } from "@/lib/remuneracao/composicaoRP"
import { descreverDiferenca, sessoesDoResumo, type Demonstrativo, type LinhaDemonstrativo } from "@/lib/remuneracao/demonstrativo"
import { pendenciasDocumento } from "@/lib/remuneracao/visaoGeralIndividual"
import type { DocInfo } from "@/lib/remuneracao/documento"
import type { ProfRemunReal } from "@/lib/remuneracao/calculo"

const num = (n: number) => n.toLocaleString("pt-BR")
const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`
const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  const primeira = partes[0][0] ?? ""
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] ?? "" : ""
  return (primeira + ultima).toUpperCase()
}

/** Coluna "Cálculo" da prévia — mesmo conteúdo do documento, com o R$ da tela. */
function calculoDaLinha(l: LinhaDemonstrativo): string {
  if (l.calculoTexto) return l.calculoTexto
  const taxa = l.taxa !== undefined ? ` × ${fmt(l.taxa)}` : ""
  switch (l.tipo) {
    case "pa": return `${plural(l.qtd ?? 0, "sessão", "sessões")}${taxa}`
    case "semPA": return plural(l.qtd ?? 0, "sessão", "sessões")
    case "ppd": return `${plural(l.qtd ?? 0, "dia", "dias")}${taxa}`
    case "eta": return `${plural(l.qtd ?? 0, "semana", "semanas")}${taxa}`
    case "pep": return `${plural(l.qtd ?? 0, "paciente apurado", "pacientes apurados")}`
    default: return ""
  }
}

function Esqueleto({ className = "" }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded bg-muted motion-reduce:animate-none ${className}`} aria-hidden />
}

function Card({ titulo, icone, acao, children, className = "" }: {
  titulo: string; icone: React.ReactNode; acao?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="text-muted-foreground" aria-hidden>{icone}</span>
          {titulo}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  )
}

/** Card de contagem no formato do "Resumo das Sessões do Período" do documento. */
function CardSessoes({ icone, valor, titulo, tone, destaque = false }: {
  icone: React.ReactNode; valor: number; titulo: string; tone: Tone; destaque?: boolean
}) {
  if (destaque) {
    return (
      <div className="flex flex-col items-start gap-1 rounded-xl px-3 py-3 text-white" style={{ background: B.navy }}>
        <span className="opacity-80" aria-hidden>{icone}</span>
        <span className="text-2xl font-black tabular-nums leading-none text-emerald-300">{num(valor)}</span>
        <span className="text-[11px] font-semibold leading-snug opacity-90">{titulo}</span>
      </div>
    )
  }
  const cor = valor > 0 ? tone : "gray"
  return (
    <div className={`flex flex-col items-start gap-1 rounded-xl px-3 py-3 ${TONE_PANEL[cor].bg}`}>
      <span className={TONE_CHIP[cor].text} aria-hidden>{icone}</span>
      <span className={`text-2xl font-black tabular-nums leading-none ${TONE_CHIP[cor].text}`}>{num(valor)}</span>
      <span className="text-[11px] font-semibold leading-snug text-foreground/85">{titulo}</span>
    </div>
  )
}

type ItemProntidao = {
  id: string
  ok: boolean
  titulo: string
  texto: string
  /** Enquanto a PEP chega, o item não é nem ok nem pendência. */
  verificando?: boolean
  link?: { href: string; rotulo: string; externo?: boolean }
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  p: ProfRemunReal
  d: Demonstrativo
  info: DocInfo
  /** A PEP deste prestador ainda está chegando (só importa para CC). */
  pepCarregando: boolean
  remPeriodo: { inicio: string; fim: string } | null
  competencia: string | null
  onGerarPdf: () => void
  onGerarWord: () => void
  onResumoSessoes: () => void
  onVerSessoes: () => void
}

export function PainelProfissional({
  p, d, info, pepCarregando, remPeriodo, competencia,
  onGerarPdf, onGerarWord, onResumoSessoes, onVerSessoes,
}: Props) {
  const toneColor = useToneColor()
  const c = useMemo(() => composicaoRP(p), [p])
  const resumoSessoes = useMemo(() => sessoesDoResumo(p.sessoes), [p])

  const especialidades = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const s of p.sessoes) {
      const e = s.especialidade || "Sem especialidade"
      contagem.set(e, (contagem.get(e) ?? 0) + 1)
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e)
  }, [p])

  // Só a PEP (e portanto o total) depende do que ainda está chegando.
  const esperandoPep = pepCarregando && d.isCC
  // Enquanto a PEP chega, só as pendências de cadastro valem: PEP e diferenças
  // entre itens e total dependem dela.
  const pendencias = pendenciasDocumento(d, info)
    .filter(x => !esperandoPep || x === "semDocumento" || x === "semRazao" || x === "semContrato")

  const hrefPep = competencia
    ? `/relacionamento-prestador/pep/?competencia=${competencia}&prestador=${encodeURIComponent(p.prof)}`
    : "/relacionamento-prestador/pep/"

  const itens: ItemProntidao[] = [
    {
      id: "doc",
      ok: !info.docProvisorio,
      titulo: info.docProvisorio ? "Sem CNPJ/CPF no cadastro" : `${info.docLabel} cadastrado`,
      texto: info.docProvisorio ? `O documento sai com ${info.docNumero}.` : info.docNumero,
      link: info.docProvisorio ? { href: "/cadastros/contratos", rotulo: "Cadastros › Contratos", externo: true } : undefined,
    },
    ...(info.tipo === "pj" ? [{
      id: "razao",
      ok: !info.razaoProvisoria,
      titulo: info.razaoProvisoria ? "Sem razão social" : "Razão social",
      texto: info.razaoProvisoria ? `O documento sai com “${info.principalUpper}”.` : info.principal,
      link: info.razaoProvisoria ? { href: "/cadastros/contratos", rotulo: "Cadastros › Contratos", externo: true } : undefined,
    }] : []),
    {
      id: "contrato",
      ok: !info.contratoProvisorio,
      titulo: info.contratoProvisorio ? "Sem número de contrato" : "Contrato",
      texto: info.contratoProvisorio ? `O documento sai com o número provisório ${info.contrato}.` : info.contrato,
      link: info.contratoProvisorio ? { href: "/cadastros/contratos", rotulo: "Cadastros › Contratos", externo: true } : undefined,
    },
    ...(d.isCC ? [{
      id: "pep",
      ok: !d.pepPendente,
      verificando: esperandoPep,
      titulo: esperandoPep ? "PEP" : d.pepPendente ? "PEP não apurada" : "PEP apurada",
      texto: esperandoPep
        ? "Conferindo a apuração do mês…"
        : d.pepPendente
          ? "O documento sai com “Ainda não apurada nesta competência”."
          : `${plural(d.pepPacientes, "paciente", "pacientes")} · ${fmt(d.pepTotal)}`,
      link: !esperandoPep && d.pepPendente ? { href: hrefPep, rotulo: "Abrir Entregas PEP", externo: true } : undefined,
    }] : []),
    // Uma entrada por causa de diferença entre os itens e o total, com o nome
    // do que aconteceu e o efeito na conta — nunca um "não confere" genérico.
    ...(esperandoPep
      ? [{ id: "valores", ok: false, verificando: true, titulo: "Valores do documento", texto: "Aguardando a PEP para conferir." }]
      : d.diferencas.length === 0
        ? [{
            id: "valores", ok: true,
            titulo: "O documento mostra tudo o que vai ser pago",
            texto: `E não mostra nada que não vai ser pago. Total: ${fmt(d.total)}.`,
          }]
        : d.diferencas.map(x => {
            const t = descreverDiferenca(x)
            return { id: x.causa, ok: false, titulo: t.titulo, texto: t.efeito }
          })),
  ]

  const maiorDia = resumoSessoes.sessoesPorDia.reduce((m, g) => Math.max(m, g.rows.length), 0)
  const semBase = c.baseRemuneravel === 0
  const tomPct: Tone = semBase ? "gray" : c.pct >= 80 ? "green" : c.pct >= 50 ? "amber" : "red"
  const corTotal = toneColor(d.total > 0 ? "green" : "gray")

  const botaoSecundario = "flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-bold text-foreground transition-all hover:bg-muted/50 active:scale-95 disabled:pointer-events-none disabled:opacity-50"

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${B.navy}, ${B.blue})` }} />
        <div className="space-y-4 p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: B.navy }}>
                {iniciaisDe(p.prof)}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold wrap-break-word text-foreground">{p.prof}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground wrap-break-word">
                  {especialidades.slice(0, 2).join(" · ") || "Sem especialidade"}
                  {especialidades.length > 2 && ` +${especialidades.length - 2}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusChip tone="gray">
                    {info.tipo === "pj" ? <Building2 size={11} aria-hidden /> : <UserRound size={11} aria-hidden />}
                    {info.tipo === "pj" ? "Pessoa jurídica" : "Pessoa física"}
                  </StatusChip>
                  {p.modalidade !== "atendimento" && (
                    <StatusChip tone="amber">
                      <Wallet size={11} aria-hidden />
                      {p.modalidade === "banco_horas" ? "Banco de horas" : "Banco de horas + PA"}
                    </StatusChip>
                  )}
                  {pendencias.length === 0 && !esperandoPep ? (
                    <StatusChip tone="green"><CheckCircle2 size={11} aria-hidden /> Pronto para emitir</StatusChip>
                  ) : pendencias.length > 0 ? (
                    <StatusChip tone="amber">
                      <AlertTriangle size={11} aria-hidden />
                      {plural(pendencias.length, "pendência", "pendências")} no documento
                    </StatusChip>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3 lg:justify-end">
              {remPeriodo && (
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <CalendarDays size={12} aria-hidden /> Período
                  </div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{remPeriodo.inicio} a {remPeriodo.fim}</div>
                </div>
              )}
              <div className="border-border sm:border-l sm:pl-6">
                <div className="text-[11px] font-semibold text-muted-foreground">Total do demonstrativo</div>
                {esperandoPep
                  ? <Esqueleto className="mt-1 h-8 w-40" />
                  : <div className="text-3xl font-black tabular-nums leading-none" style={{ color: corTotal }}>{fmt(d.total)}</div>}
              </div>
            </div>
          </div>

          {/* Exportação — os mesmos ids de antes. No mobile, o PDF principal
              ocupa a linha toda e os demais dividem duas colunas. */}
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:flex sm:flex-wrap sm:gap-3">
            <button
              type="button"
              id="btn-gerar-pdf"
              onClick={onGerarPdf}
              disabled={esperandoPep}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-[#222847] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:bg-slate-600"
            >
              <FileText size={15} aria-hidden />
              PDF - Apuração do Faturamento
            </button>
            <button type="button" id="btn-gerar-word" onClick={onGerarWord} disabled={esperandoPep} className={botaoSecundario}>
              <FileSpreadsheet size={15} aria-hidden />
              <span className="sm:hidden">Word</span>
              <span className="hidden sm:inline">WORD - Apuração do Faturamento</span>
            </button>
            <button type="button" id="btn-resumo-sessoes" onClick={onResumoSessoes} className={botaoSecundario}>
              <FileText size={15} aria-hidden />
              <span className="sm:hidden">Sessões</span>
              <span className="hidden sm:inline">PDF - Apuração das Sessões</span>
            </button>
            <button
              type="button"
              onClick={onVerSessoes}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 sm:ml-auto"
            >
              <ListChecks size={15} aria-hidden />
              Ver sessões
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* ── Prévia do demonstrativo ─────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-8">
          <Card titulo="Prévia do demonstrativo" icone={<FileText size={15} />}
            acao={<span className="text-[11px] text-muted-foreground">o que sai no PDF e no Word</span>}>
            <div className="grid grid-cols-3 gap-2">
              <CardSessoes icone={<CheckCircle2 size={15} />} valor={p.evoluidasProprias} titulo="Evoluções próprias" tone="green" />
              <CardSessoes icone={<Repeat2 size={15} />} valor={p.substituicoesRealizadas} titulo="Substituições" tone="blue" />
              <CardSessoes icone={<Wallet size={15} />} valor={d.totalSessoes} titulo={d.rotuloTotalSessoes} tone="green" destaque />
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="hidden bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_12rem_8rem] sm:gap-3">
                <span>Componente</span>
                <span>Cálculo</span>
                <span className="text-right">Total no período</span>
              </div>
              {d.linhas.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum valor confirmado para o período.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.linhas.map((l, i) => {
                    const pepEsperando = l.tipo === "pep" && esperandoPep
                    const semValor = l.valor === null
                    return (
                      <li key={`${l.tipo}-${l.detalhe ?? ""}-${i}`}
                        className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 sm:grid-cols-[1fr_12rem_8rem] sm:items-center">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">{l.titulo}</span>
                          {l.detalhe && <span className="block truncate text-[11px] text-muted-foreground" title={l.detalhe}>{l.detalhe}</span>}
                        </span>
                        <span className="order-3 col-span-2 text-xs tabular-nums text-muted-foreground sm:order-none sm:col-span-1">
                          {pepEsperando ? <Esqueleto className="h-3 w-28" /> : calculoDaLinha(l)}
                        </span>
                        <span className={`text-right text-sm tabular-nums ${semValor ? "font-medium text-muted-foreground" : "font-bold text-foreground"}`}>
                          {pepEsperando ? <Esqueleto className="h-4 w-16" /> : semValor ? l.valorTexto : fmt(l.valor ?? 0)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className={`flex items-center justify-between gap-3 px-3 py-3 ${TONE_PANEL.green.bg}`}>
                <span className="text-xs font-black uppercase tracking-wide text-foreground">Total confirmado do período</span>
                {esperandoPep
                  ? <Esqueleto className="h-5 w-24" />
                  : <span className="text-lg font-black tabular-nums" style={{ color: corTotal }}>{fmt(d.total)}</span>}
              </div>
            </div>

            {d.diferencas.length > 0 && !esperandoPep && (
              <div className={`mt-3 rounded-xl px-3 py-3 ${TONE_PANEL.amber.bg}`}>
                <p className={`flex items-start gap-2 text-xs font-bold leading-snug ${TONE_CHIP.amber.text}`}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {d.divergente
                    ? <span>O total a pagar é {fmt(d.total)}, mas somando os valores mostrados acima dá {fmt(d.somaLinhas)}. Por quê:</span>
                    : <span>O total a pagar ({fmt(d.total)}) é igual à soma dos valores mostrados acima, mas só porque duas diferenças se anulam:</span>}
                </p>
                <ul className="mt-2 space-y-2 pl-6">
                  {d.diferencas.map(x => {
                    const t = descreverDiferenca(x)
                    return (
                      <li key={x.causa} className="text-xs leading-snug text-foreground">
                        <span className="block font-semibold">{t.titulo}</span>
                        <span className="block text-foreground/80">{t.explicacao}</span>
                        <span className={`block font-semibold ${TONE_CHIP.amber.text}`}>{t.efeito}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 pl-6 text-[11px] text-muted-foreground">
                  O documento sai assim mesmo; para ver cada sessão envolvida, use “Ver sessões”.
                </p>
              </div>
            )}
          </Card>

          {d.pacientesCC.length > 0 && (
            <Card titulo={`Pacientes vinculados (CC) — ${num(d.pacientesCC.length)}`} icone={<Users size={15} />}>
              <ul className="flex flex-wrap gap-1.5">
                {d.pacientesCC.map(nome => (
                  <li key={nome} className="rounded-lg bg-muted/60 px-2.5 py-1 text-xs text-foreground/90">{nome}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ── Coluna lateral ──────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-4">
          <Card titulo="Antes de exportar" icone={<ClipboardList size={15} />}>
            <ul className="space-y-2">
              {itens.map(item => {
                const tone: Tone = item.verificando ? "gray" : item.ok ? "green" : "amber"
                return (
                  <li key={item.id} className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${item.ok || item.verificando ? "" : TONE_PANEL.amber.bg}`}>
                    <span className={`mt-0.5 shrink-0 ${TONE_CHIP[tone].text}`} aria-hidden>
                      {item.verificando ? <Esqueleto className="size-3.5 rounded-full" /> : item.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">
                        <span className="sr-only">{item.verificando ? "Verificando: " : item.ok ? "OK: " : "Pendência: "}</span>
                        {item.titulo}
                      </span>
                      <span className="block text-[11px] leading-snug text-muted-foreground wrap-break-word">{item.texto}</span>
                      {item.link && (
                        <Link
                          href={item.link.href}
                          target={item.link.externo ? "_blank" : undefined}
                          rel={item.link.externo ? "noreferrer" : undefined}
                          className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${TONE_CHIP.amber.text} hover:underline`}
                        >
                          {item.link.rotulo}
                          <ArrowRight size={11} aria-hidden />
                        </Link>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card titulo="Execução no mês" icone={<Sigma size={15} />}>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums leading-none" style={{ color: toneColor(tomPct) }}>
                {semBase ? "—" : pct1(c.pct)}
              </span>
              <span className="text-xs text-muted-foreground">
                {semBase ? "sem sessões na base" : `${num(c.remuneradas)} de ${num(c.baseRemuneravel)} da base remuneradas`}
              </span>
            </div>
            <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-muted">
              <span className="block h-full w-full" style={{
                background: toneColor(tomPct),
                clipPath: `inset(0 ${100 - Math.max(0, Math.min(100, c.pct))}% 0 0)`,
                transition: "clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)",
              }} />
            </span>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {([
                ["Substituições", c.substituicoes, "purple"],
                ["Sem registro", c.pendentes, "amber"],
                ["Canceladas", c.canceladas, "gray"],
                ["Inconsistências", c.inconsistencias, "red"],
              ] as [string, number, Tone][]).map(([rotulo, valor, tone]) => (
                <div key={rotulo} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                  <dt className="text-[10px] font-semibold text-muted-foreground">{rotulo}</dt>
                  <dd className="text-sm font-bold tabular-nums" style={valor > 0 ? { color: toneColor(tone) } : undefined}>{num(valor)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card titulo="Sessões por dia" icone={<CalendarDays size={15} />}
            acao={<span className="text-[11px] tabular-nums text-muted-foreground">
              {plural(resumoSessoes.rowsProf.length, "sessão", "sessões")} · {plural(resumoSessoes.sessoesPorDia.length, "dia", "dias")}
            </span>}>
            {resumoSessoes.sessoesPorDia.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma sessão remunerada no período.</p>
            ) : (
              <>
                <div className="flex h-24 items-end gap-0.5" role="img"
                  aria-label={`Sessões remuneradas por dia: ${resumoSessoes.sessoesPorDia.map(g => `${formatDateBR(g.data)}, ${g.rows.length}`).join("; ")}`}>
                  {resumoSessoes.sessoesPorDia.map(g => {
                    const alt = maiorDia > 0 ? Math.max((g.rows.length / maiorDia) * 100, 6) : 0
                    return (
                      <span key={g.data} className="group relative flex h-full min-w-0 flex-1 items-end"
                        title={`${g.diaSemana ? `${g.diaSemana} ` : ""}${formatDateBR(g.data)} · ${plural(g.rows.length, "sessão", "sessões")}`}>
                        <span className="block w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                          style={{ height: `${alt}%`, background: toneColor("green") }} />
                      </span>
                    )
                  })}
                </div>
                <div className="mt-1 flex gap-0.5" aria-hidden>
                  {resumoSessoes.sessoesPorDia.map((g, i, arr) => {
                    // Rótulo só no primeiro, no último e a cada ~5 dias: com 22
                    // barras em 375px, número em todas vira borrão.
                    const passo = Math.max(1, Math.ceil(arr.length / 6))
                    const mostra = i === 0 || i === arr.length - 1 || i % passo === 0
                    return (
                      <span key={g.data} className="min-w-0 flex-1 text-center text-[9px] tabular-nums text-muted-foreground">
                        {mostra ? parseDateBR(g.data)?.getDate() : ""}
                      </span>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {plural(resumoSessoes.proprias, "evolução própria", "evoluções próprias")} · {plural(resumoSessoes.subs, "substituição", "substituições")} — as mesmas sessões do PDF de sessões.
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
