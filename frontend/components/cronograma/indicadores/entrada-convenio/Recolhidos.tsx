"use client"

// Seções recolhidas do Painel de Entrada: o que é consulta, não cobrança.
// Registros a corrigir (agrupados por paciente, clicáveis), como está o fluxo
// (números de acompanhamento, etapas, quem já começou, concluídos) e as regras.

import { CalendarCheck, FileWarning, PlayCircle, UserPlus } from "lucide-react"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import {
  avisosPorPaciente,
  concluidosEEncerrados,
  fmtDiaMes,
  jaIniciaram,
  textoDiasUteis,
  textoPrazo,
  type DadosPainel,
  type EtapaResumo,
  type PacienteEntrada,
} from "@/lib/indicadores/entradaConvenio"
import { Recolhivel } from "./comum"

// ─── Registros a corrigir ────────────────────────────────────────────────────

export function AvisosDeRegistro({ pacs, onAbrir }: { pacs: PacienteEntrada[]; onAbrir: (p: PacienteEntrada) => void }) {
  const grupos = avisosPorPaciente(pacs)
  const total = grupos.reduce((s, g) => s + g.avisos.length, 0)
  return (
    <Recolhivel
      titulo={<>Registros a corrigir no ClickUp <span className="tabular-nums text-muted-foreground">({total})</span></>}
      apoio={grupos.length
        ? `${total} ${total === 1 ? "aviso" : "avisos"} em ${grupos.length} ${grupos.length === 1 ? "paciente" : "pacientes"}. O que está fora do ClickUp ou desatualizado distorce o painel.`
        : "Nada a corrigir."}
    >
      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada a corrigir.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {grupos.map(({ paciente: p, avisos }, i) => {
            const prazo = p.atual && p.situacao === "em andamento" ? textoPrazo(p.atual) : null
            return (
              <li key={`${p.paciente}-${i}`}>
                <button
                  type="button"
                  onClick={() => onAbrir(p)}
                  className="h-full w-full rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-semibold text-foreground">{p.paciente}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {p.atual && p.situacao === "em andamento" ? `Com ${p.atual.setor}` : p.situacao}
                    {prazo && <span className={TONE_SOFT[prazo.tom].text}> · {prazo.texto}</span>}
                  </span>
                  <span className="mt-1 flex flex-col gap-0.5 text-xs text-foreground">
                    {avisos.map((a, j) => (
                      <span key={j} className="flex gap-1.5"><span aria-hidden className="text-muted-foreground">•</span>{a}</span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Recolhivel>
  )
}

// ─── Como está o fluxo ───────────────────────────────────────────────────────

function corDaBarra(pct: number | null): string {
  if (pct == null) return "bg-muted"
  if (pct >= 80) return "bg-emerald-500"
  if (pct >= 50) return "bg-amber-500"
  return "bg-rose-500"
}

function Regua({ etapas }: { etapas: EtapaResumo[] }) {
  return (
    <ol className="grid overflow-hidden rounded-2xl border border-border sm:grid-cols-4 xl:grid-cols-8">
      {etapas.map((e, i) => (
        <li
          key={e.etapa}
          title={`Mediana: ${e.mediana ?? "—"} dias úteis · ${e.n} ${e.n === 1 ? "paciente passou" : "pacientes passaram"} por esta etapa`}
          className="flex items-center gap-3 border-b border-border p-3 text-xs sm:flex-col sm:items-stretch sm:gap-1 sm:border-r"
        >
          <div className="min-w-0 flex-1">
            <span className="block text-[11px] text-muted-foreground">Etapa {i} · {e.setor}</span>
            <span className="block text-sm font-semibold leading-tight text-foreground">{e.nome}</span>
            <span className="block text-muted-foreground">{e.prazo === 0 ? "mesmo dia" : `até ${e.prazo} dias úteis`}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 sm:mt-1 sm:items-stretch">
            <span className="tabular-nums"><b className="text-base font-black text-foreground">{e.em_aberto}</b> <span className="text-muted-foreground">agora</span></span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-full" aria-hidden>
              <div className={`h-full ${corDaBarra(e.pct_no_prazo)}`} style={{ width: `${e.pct_no_prazo ?? 0}%` }} />
            </div>
            <span className="tabular-nums text-muted-foreground">
              {e.pct_no_prazo == null ? "sem histórico" : `${e.pct_no_prazo}% no prazo`}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function ListaSimples({ itens, vazio, onAbrir, direita }: {
  itens: PacienteEntrada[]
  vazio: string
  onAbrir: (p: PacienteEntrada) => void
  direita: (p: PacienteEntrada) => React.ReactNode
}) {
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  return (
    <ul className="flex max-h-72 flex-col overflow-y-auto text-xs">
      {itens.map((p, i) => (
        <li key={`${p.paciente}-${i}`} className="border-b border-border/60 last:border-0">
          <button
            type="button"
            onClick={() => onAbrir(p)}
            className="flex min-h-11 w-full items-center justify-between gap-2 py-1.5 text-left hover:bg-muted/40 sm:min-h-0"
          >
            <span className="min-w-0">
              <span className="font-semibold text-foreground">{p.paciente}</span>
              <span className="text-muted-foreground"> · {p.convenio} · entrada {fmtDiaMes(p.entrada)}</span>
            </span>
            <span className="shrink-0">{direita(p)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ComoEstaOFluxo({ d, onAbrir }: { d: DadosPainel; onAbrir: (p: PacienteEntrada) => void }) {
  const r = d.resumo
  const iniciaram = jaIniciaram(d.pacientes)
  const finalizados = concluidosEEncerrados(d.pacientes)
  const numero = (v: number) => <div className="text-2xl font-black tabular-nums text-foreground">{v}</div>

  return (
    <Recolhivel titulo="Como está o fluxo" apoio="Entradas, etapas, quem já começou e quem saiu do fluxo">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard tone="purple" icon={<UserPlus size={15} />} label="Entradas (últimos 5 dias úteis)" tinted={false}>{numero(r.novas_5du)}</StatCard>
          <StatCard tone="amber" icon={<FileWarning size={15} />} label="Entraram sem formulário" tinted={false}>{numero(r.sem_formulario)}</StatCard>
          <StatCard tone="blue" icon={<CalendarCheck size={15} />} label="Aguardando início" tinted={false}>{numero(r.para_iniciar)}</StatCard>
          <StatCard tone="green" icon={<PlayCircle size={15} />} label="Já iniciaram" tinted={false}>{numero(r.iniciados)}</StatCard>
        </div>

        <section aria-labelledby="entrada-regua" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="entrada-regua" className="text-sm font-bold text-foreground">Etapas do fluxo</h3>
            <span className="text-xs text-muted-foreground">Quantos estão em cada etapa agora e quanto do histórico cumpriu o prazo</span>
          </div>
          <Regua etapas={d.etapas} />
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-labelledby="entrada-iniciaram" className="flex flex-col gap-2">
            <h3 id="entrada-iniciaram" className="text-sm font-bold text-foreground">
              Já iniciaram <span className="tabular-nums text-muted-foreground">({iniciaram.length})</span>
            </h3>
            <ListaSimples
              itens={iniciaram}
              vazio="Ninguém ainda."
              onAbrir={onAbrir}
              direita={p => <span className="tabular-nums text-muted-foreground">início {fmtDiaMes(p.inicio)}</span>}
            />
          </section>
          <section aria-labelledby="entrada-finalizados" className="flex flex-col gap-2">
            <h3 id="entrada-finalizados" className="text-sm font-bold text-foreground">
              Concluídos e encerrados <span className="tabular-nums text-muted-foreground">({finalizados.length})</span>
            </h3>
            <ListaSimples
              itens={finalizados}
              vazio="Nenhum ainda."
              onAbrir={onAbrir}
              direita={p => (
                <span className="flex items-center gap-2">
                  {p.total_uteis != null && <span className="tabular-nums text-muted-foreground">{p.total_uteis} dias úteis</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    p.situacao === "concluído" ? `${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}` : `${TONE_SOFT.slate.bg} ${TONE_SOFT.slate.text}`
                  }`}>
                    {p.situacao === "concluído" ? (p.tipo === "Neuro" ? "avaliação feita" : "tratamento iniciado") : "encerrado"}
                  </span>
                </span>
              )}
            />
          </section>
        </div>
      </div>
    </Recolhivel>
  )
}

// ─── Regras ──────────────────────────────────────────────────────────────────

export function Regras({ etapas }: { etapas: EtapaResumo[] }) {
  const meta = etapas.reduce((s, e) => s + e.prazo, 0)
  return (
    <Recolhivel titulo="Regras do painel">
      <div className="flex flex-col gap-1.5 text-xs text-foreground">
        <p>
          Prazos vigentes (dias úteis; meta ponta a ponta {meta}):{" "}
          {etapas.map((e, i) => `${i} ${e.nome.toLowerCase()} (${e.setor}, ${textoDiasUteis(e.prazo)})`).join(" · ")}.
          {" "}Na Leve, a autorização da operadora vence 1 dia útil antes do início previsto, pedida dentro do mês. Na etapa 7, o Terapêutico marca a subtarefa &quot;Cronograma iniciado&quot;.
        </p>
        <p>1. Toda entrada abre formulário em Solicitações Autorização no mesmo dia, pela família (Comercial) ou pelo convênio (Autorização).</p>
        <p>2. Mudou de etapa, muda o status da task. Combinado só no chat não conta para o painel.</p>
        <p>3. Tentativas de contato com a família ficam registradas como comentário na task.</p>
        <p>4. Depois da entrevista, o status no CRM muda no mesmo dia. No cronograma, a Data de Apresentação e a data da 1ª sessão são obrigatórias.</p>
        <p>5. O card só vai para Concluído depois que o paciente vem à 1ª sessão. Cronograma excluído fica como Cancelado, nunca como Concluído.</p>
        <p>6. Nome completo do paciente em todas as tasks e formulários: é por ele que o painel acha a disponibilidade no cadastro do Pulsar.</p>
        <p className="text-muted-foreground">Calculado pela tarefa agendada a partir do ClickUp (Solicitações Autorização, CRM Universo ABA, Cronograma Pacientes e chat de autorização). O Pulsar aplica os prazos vigentes (botão &quot;Prazos&quot;) sobre os dias de cada etapa.</p>
      </div>
    </Recolhivel>
  )
}
