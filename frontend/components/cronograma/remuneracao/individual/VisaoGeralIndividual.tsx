"use client"

// Visão geral da Remuneração Individual — o que a tela mostra ANTES de alguém
// ser escolhido no seletor.
//
// Duas partes, com regras diferentes de nome (decisão do usuário, 25/09/2026):
//   • Dinheiro e especialidade são agregados SEM nome — grupo pequeno vai para
//     "Outras" (ver especialidadesAnonimas em visaoGeralIndividual.ts).
//   • "Documentos do mês" identifica: cada pendência expande e mostra quem é,
//     e para as que vêm de sessão específica, a sessão (data, hora,
//     especialidade, id) — para achar o profissional e o atendimento sem
//     precisar adivinhar o nome no seletor primeiro.
//
// Vocabulário visual do dashboard do /rp (RemuneracaoRPDashboard): hero com
// count-up, métricas de apoio, barras CSS com clip-path. Tons pelo
// padrão de detalhamento (docs/padrao-detalhamento-modal.md §3.5): verde =
// dinheiro/remunerado, âmbar = pendência, vermelho = inconsistência, e zero
// não tem cor.

import Link from "next/link"
import {
  AlertTriangle, BadgeCheck, Building2, CalendarDays, ChevronDown, ExternalLink, FileWarning, Layers, UserRound, Users,
} from "lucide-react"

import { fmt } from "@/lib/remuneracao/formatacao"
import { formatDateBR } from "@/lib/remuneracao/datas"
import { B } from "@/lib/cronograma/constants"
import { useToneColor, type Tone } from "@/hooks/useToneColor"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { useCountUp } from "../RemuneracaoRPDashboard"
import { BarraEmpilhada, BarraH, Card, Legenda, Metric, num, pct1 } from "../visaoGeral/pecas"
import {
  K_MINIMO, type FaixaValor, type OcorrenciaPendencia, type PendenciaDocumento, type ResumoGeralIndividual,
} from "@/lib/remuneracao/visaoGeralIndividual"
import { CAUSAS_DIFERENCA, type CausaDiferenca } from "@/lib/remuneracao/demonstrativo"


/** "R$ 2 mil", "R$ 2,5 mil", "R$ 800" — rótulo de faixa, não valor de folha. */
function fmtCompacto(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
}

function rotuloFaixa(f: FaixaValor, i: number): string {
  return i === 0 ? `até ${fmtCompacto(f.ate)}` : `${fmtCompacto(f.de)} – ${fmtCompacto(f.ate)}`
}

const PENDENCIAS: { id: PendenciaDocumento; rotulo: string; nota: string }[] = [
  { id: "semDocumento", rotulo: "Sem CNPJ/CPF", nota: "o documento sai com 00.000.000/0000-00" },
  { id: "semRazao", rotulo: "PJ sem razão social", nota: "sai “RAZÃO SOCIAL NÃO CADASTRADA”" },
  { id: "semContrato", rotulo: "Sem número de contrato", nota: "sai um número provisório" },
  { id: "pepPendente", rotulo: "PEP não apurada", nota: "Coordenador de Caso sem apuração no mês" },
  // Uma linha por causa de diferença entre itens e total — o nome diz o que
  // aconteceu e a nota diz o que isso faz com a conta.
  ...(Object.entries(CAUSAS_DIFERENCA) as [CausaDiferenca, { titulo: string; resumo: string }][])
    .map(([id, c]) => ({ id, rotulo: c.titulo, nota: c.resumo })),
]

// ─── Peças ───────────────────────────────────────────────────────────────────
// Card, Metric, BarraH, BarraEmpilhada e Legenda vivem em ../visaoGeral/pecas.tsx
// (compartilhadas com a visão geral de Entregas PEP).

/** Mesma ocorrência pode repetir profissional (uma por sessão) — agrupa para mostrar o nome uma vez só. */
function agruparPorProfissional(ocorrencias: OcorrenciaPendencia[]): [string, OcorrenciaPendencia[]][] {
  const mapa = new Map<string, OcorrenciaPendencia[]>()
  for (const o of ocorrencias) mapa.set(o.profissional, [...(mapa.get(o.profissional) ?? []), o])
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
}

/**
 * Uma pendência, expansível: fechada mostra a contagem (como antes); aberta
 * mostra quem é — e a sessão exata, quando a causa vem de uma.
 */
function LinhaPendencia({ rotulo, nota, ocorrencias }: { rotulo: string; nota: string; ocorrencias: OcorrenciaPendencia[] }) {
  const porProfissional = agruparPorProfissional(ocorrencias)
  const n = porProfissional.length
  return (
    <li className={`rounded-xl ${TONE_PANEL.amber.bg}`}>
      <details className="group/pendencia">
        <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <FileWarning size={14} className={`mt-0.5 shrink-0 ${TONE_CHIP.amber.text}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-foreground">{rotulo}</span>
            <span className="block text-[11px] leading-snug text-muted-foreground">{nota}</span>
          </span>
          <span className={`flex shrink-0 flex-col items-end leading-none ${TONE_CHIP.amber.text}`}>
            <span className="text-sm font-black tabular-nums">{num(n)}</span>
            <span className="mt-0.5 text-[10px] font-semibold">{n === 1 ? "profissional" : "profissionais"}</span>
          </span>
          <ChevronDown size={14} className={`mt-0.5 shrink-0 text-muted-foreground transition-transform group-open/pendencia:rotate-180`} aria-hidden />
        </summary>
        <div className="max-h-60 space-y-2 overflow-y-auto border-t border-amber-300/40 px-3 py-2 dark:border-amber-800/40">
          {porProfissional.map(([nome, itens]) => (
            <div key={nome}>
              <p className="text-xs font-semibold text-foreground">{nome}</p>
              {itens[0].sessao ? (
                <ul className="mt-0.5 space-y-0.5">
                  {itens.map((it, i) => (
                    <li key={i}>
                      {/* target="_blank" abre numa guia nova — esta tela nunca navega,
                          nunca recarrega. `prestador` + `sessao` fazem a Remuneração
                          Mensal abrir direto nesta pessoa, com a sessão localizada e
                          expandida (RemunRPTab.tsx lê esses dois parâmetros). */}
                      <Link
                        href={`/relacionamento-prestador/rp/?prestador=${encodeURIComponent(nome)}&sessao=${encodeURIComponent(it.sessao!.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="group/sessao -mx-1 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[11px] tabular-nums text-muted-foreground hover:bg-amber-200/50 hover:text-foreground dark:hover:bg-amber-900/40"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {formatDateBR(it.sessao!.data)} · {it.sessao!.hora} · {it.sessao!.especialidade} · sessão {it.sessao!.id}
                        </span>
                        <ExternalLink size={11} className="shrink-0 opacity-60 group-hover/sessao:opacity-100" aria-hidden />
                        <span className="sr-only">— abre a Remuneração Mensal em outra guia</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : itens[0].valor !== undefined ? (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{fmt(itens[0].valor)}</p>
              ) : null}
            </div>
          ))}
        </div>
      </details>
    </li>
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  resumo: ResumoGeralIndividual
  /** "Agosto de 2026" — o mesmo rótulo do seletor no header. */
  periodoTexto: string
  /** A PEP de todos ainda está chegando: total e "PEP não apurada" podem mudar. */
  pepCarregando?: boolean
}

export function VisaoGeralIndividual({ resumo: r, periodoTexto, pepCarregando = false }: Props) {
  const toneColor = useToneColor()
  const totalAnimado = useCountUp(r.dinheiro.total)

  const corVerde = toneColor("green")
  const corAmbar = toneColor("amber")
  const corVermelho = toneColor("red")
  const corCinza = toneColor("gray")
  const corDoPct = (pct: number, semBase: boolean): Tone => (semBase ? "gray" : pct >= 80 ? "green" : pct >= 50 ? "amber" : "red")

  const { documentos: d, sessoes: s } = r
  const maiorFaixa = r.dinheiro.faixas.reduce((m, f) => Math.max(m, f.qtd), 0)
  const maiorEsp = r.especialidades.reduce((m, e) => Math.max(m, e.valor ?? 0), 0)
  const temOculto = r.especialidades.some(e => e.valor === null)

  return (
    <div className="space-y-4">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${B.navy}, ${B.blue})` }} />
        <div className="space-y-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <CalendarDays size={15} className="text-muted-foreground" aria-hidden />
              Visão geral · {periodoTexto}
            </h2>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className={`text-4xl font-black tabular-nums leading-none sm:text-5xl ${pepCarregando ? "opacity-60" : ""}`} style={{ color: corVerde }}>
                  {fmt(totalAnimado)}
                </span>
              </div>
              <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
                soma dos demonstrativos do mês{pepCarregando && " · atualizando PEP…"}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Metric label={`Profissiona${r.profissionais !== 1 ? "is" : "l"}`} valor={num(r.profissionais)} />
              <Metric label="Média por profissional" valor={fmt(r.dinheiro.media)} />
              <Metric label="Mediana" valor={fmt(r.dinheiro.mediana)} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Documentos + Execução ────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Documentos do mês" icone={<BadgeCheck size={15} />}>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums leading-none" style={{ color: d.prontos > 0 ? corVerde : corCinza }}>
              {num(d.prontos)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              de {num(r.profissionais)} prontos para emitir
            </span>
          </div>
          <div className="mt-3">
            <BarraEmpilhada partes={[
              { valor: d.prontos, cor: corVerde, rotulo: "Prontos" },
              { valor: d.comPendencia, cor: corAmbar, rotulo: "Com pendência" },
            ]} />
          </div>

          {d.comPendencia === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Todos os documentos saem com o cadastro completo e mostram exatamente o que vai ser pago.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {PENDENCIAS.filter(x => d.porPendencia[x.id] > 0).map(x => (
                <LinhaPendencia key={x.id} rotulo={x.rotulo} nota={x.nota} ocorrencias={d.ocorrenciasPendencia[x.id]} />
              ))}
            </ul>
          )}
          {d.comPendencia > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Um profissional pode ter mais de uma pendência. Toque numa pendência para ver quem é;
              escolha o nome no seletor para abrir o demonstrativo completo dele.
            </p>
          )}
        </Card>

        <Card titulo="Execução das sessões" icone={<Layers size={15} />}>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums leading-none"
              style={{ color: toneColor(corDoPct(s.coberturaGeral, s.baseRemuneravel === 0)) }}>
              {s.baseRemuneravel > 0 ? pct1(s.coberturaGeral) : "—"}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">da base remunerável evoluída</span>
          </div>
          <div className="mt-3">
            <BarraH fracao={s.coberturaGeral / 100} cor={toneColor(corDoPct(s.coberturaGeral, s.baseRemuneravel === 0))} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric label="Remuneradas" valor={num(s.remuneradas)} cor={s.remuneradas > 0 ? corVerde : undefined} />
            <Metric label="Substituições" valor={num(s.substituicoes)} cor={s.substituicoes > 0 ? toneColor("purple") : undefined} />
            <Metric label="Sem registro" valor={num(s.pendentes)} cor={s.pendentes > 0 ? corAmbar : undefined} />
            <Metric label="Inconsistências" valor={num(s.inconsistencias)} cor={s.inconsistencias > 0 ? corVermelho : undefined} />
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Profissionais por cobertura</p>
            <BarraEmpilhada partes={[
              { valor: s.faixasCobertura.alta, cor: corVerde, rotulo: "80% ou mais" },
              { valor: s.faixasCobertura.media, cor: corAmbar, rotulo: "50% a 80%" },
              { valor: s.faixasCobertura.baixa, cor: corVermelho, rotulo: "abaixo de 50%" },
              { valor: s.faixasCobertura.semBase, cor: corCinza, rotulo: "sem base" },
            ]} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Legenda cor={corVerde} rotulo="≥ 80%" valor={s.faixasCobertura.alta} />
              <Legenda cor={corAmbar} rotulo="50–80%" valor={s.faixasCobertura.media} />
              <Legenda cor={corVermelho} rotulo="< 50%" valor={s.faixasCobertura.baixa} />
              {s.faixasCobertura.semBase > 0 && <Legenda cor={corCinza} rotulo="sem base" valor={s.faixasCobertura.semBase} />}
            </div>
          </div>
        </Card>
      </div>

      {/* ── Distribuição do valor + Contratos ────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card titulo="Distribuição do valor" icone={<Users size={15} />} className="lg:col-span-2">
          {r.dinheiro.faixas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum valor apurado no mês ainda.</p>
          ) : (
            <>
              <p className="-mt-1 mb-3 text-xs text-muted-foreground">Quantos profissionais em cada faixa do demonstrativo.</p>
              <ul className="space-y-2">
                {r.dinheiro.faixas.map((f, i) => (
                  <li key={f.de} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 sm:grid-cols-[10rem_1fr_3rem]">
                    <span className="truncate text-xs font-medium tabular-nums text-foreground/85">{rotuloFaixa(f, i)}</span>
                    <BarraH fracao={maiorFaixa > 0 ? f.qtd / maiorFaixa : 0} cor={f.qtd > 0 ? corVerde : corCinza} />
                    <span className="text-right text-sm font-bold tabular-nums" style={{ color: f.qtd > 0 ? undefined : corCinza }}>{num(f.qtd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card titulo="Contratos" icone={<Building2 size={15} />}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Documento emitido como</p>
              <BarraEmpilhada partes={[
                { valor: r.pj, cor: B.navy, rotulo: "CNPJ" },
                { valor: r.pf, cor: B.blue, rotulo: "CPF" },
              ]} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 size={12} aria-hidden /> CNPJ <span className="font-bold tabular-nums text-foreground">{num(r.pj)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserRound size={12} aria-hidden /> CPF <span className="font-bold tabular-nums text-foreground">{num(r.pf)}</span>
                </span>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Modalidade</p>
              <BarraEmpilhada partes={[
                { valor: r.modalidade.atendimento, cor: corVerde, rotulo: "Por atendimento" },
                { valor: r.modalidade.hibrido, cor: B.blue, rotulo: "Banco de horas + PA" },
                { valor: r.modalidade.banco_horas, cor: corAmbar, rotulo: "Banco de horas" },
              ]} />
              <div className="mt-2 flex flex-col gap-1">
                <Legenda cor={corVerde} rotulo="Por atendimento" valor={r.modalidade.atendimento} />
                <Legenda cor={B.blue} rotulo="Banco de horas + PA" valor={r.modalidade.hibrido} />
                <Legenda cor={corAmbar} rotulo="Banco de horas" valor={r.modalidade.banco_horas} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Por especialidade ────────────────────────────────────────────── */}
      <Card titulo="Por especialidade" icone={<Layers size={15} />}>
        {r.especialidades.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem valores para detalhar por especialidade ainda.</p>
        ) : (
          <>
            <div className="hidden px-2 pb-1 sm:grid sm:grid-cols-[35fr_20fr_30fr_15fr] sm:gap-4">
              <span className="text-[10px] font-semibold text-muted-foreground/70">Especialidade</span>
              <span className="text-[10px] font-semibold text-muted-foreground/70">Profissionais</span>
              <span className="col-span-2 text-[10px] font-semibold text-muted-foreground/70">Valor no mês</span>
            </div>
            <ul>
              {r.especialidades.map(e => (
                <li key={e.nome}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 sm:grid-cols-[35fr_20fr_30fr_15fr] sm:gap-4">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground/90" title={e.nome}>{e.nome}</span>
                  <span className="text-right text-[11px] text-muted-foreground tabular-nums sm:text-left">
                    {num(e.profissionais)} profissiona{e.profissionais !== 1 ? "is" : "l"}
                  </span>
                  <span className="col-span-2 sm:col-span-1">
                    {e.valor === null
                      ? <span className="block h-2 w-full rounded-full border border-dashed border-muted-foreground/40" aria-hidden />
                      : <BarraH fracao={maiorEsp > 0 ? Math.max(e.valor / maiorEsp, 0.03) : 0} cor={corVerde} />}
                  </span>
                  <span className="col-span-2 text-right text-sm font-bold tabular-nums sm:col-span-1">
                    {e.valor === null ? (
                      <StatusChip tone="gray" dense>
                        {e.motivoOculto === "grupoPequeno" ? "grupo pequeno" : "oculto"}
                      </StatusChip>
                    ) : (
                      <span style={{ color: corVerde }}>{fmt(e.valor)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Especialidade com menos de {K_MINIMO} profissionais entra em “Outras especialidades”.
            {temOculto && " Quando esse grupo ainda fica pequeno, o valor dele e o do menor grupo visível ficam ocultos — senão sairiam por subtração do total."}
            {" "}Os valores são os mesmos do dashboard da Remuneração Mensal; um profissional com mais de uma especialidade conta em cada uma.
          </span>
        </p>
      </Card>

      <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
        <UserRound size={13} aria-hidden />
        Escolha um profissional no seletor acima para ver o demonstrativo dele antes de exportar.
      </p>
    </div>
  )
}
