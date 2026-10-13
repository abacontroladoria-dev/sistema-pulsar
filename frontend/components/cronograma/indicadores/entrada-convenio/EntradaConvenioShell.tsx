"use client"

// Painel de Entrada de Pacientes de Convênio (Leve, ASSIM, FUSEx) — aba
// /cronograma/indicadores?tab=entrada-convenio.
//
// Mostra a última rodada calculada pela tarefa agendada da Carol (calc.py, fluxo
// v4) e copiada do Doc do ClickUp pela Edge Function painel-entrada-convenio.
// As seções são as do HTML original do pacote de implantação, com o kit do
// sistema: resumo, régua do fluxo, onde está parado, apresentação e início,
// lista de pacientes (detalhe no Drawer), registro a corrigir, concluídos.
//
// Nada aqui recalcula prazo: se o número parecer errado, a correção é no
// registro do ClickUp (ou na tarefa da Carol), não nesta tela.

import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import {
  AlertTriangle, CalendarCheck, Clock, Loader2, PlayCircle, RefreshCw, Timer, Users, UserPlus, FileWarning,
} from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { TONE_SOFT, type Tone } from "@/components/cronograma/ui/tones"
import { usePainelEntradaConvenio } from "@/hooks/usePainelEntradaConvenio"
import {
  ETAPAS_DISPONIBILIDADE,
  FILTRO_INICIAL,
  SETOR_DESCRICAO,
  STATUS_FILTRAVEIS,
  TODOS,
  alertasDeRegistro,
  concluidosEEncerrados,
  fmtDataHora,
  fmtDiaMes,
  filtrarPacientes,
  mapaDisponibilidade,
  nomeCurto,
  opcoesFiltro,
  porSetor,
  raias,
  type DadosPainel,
  type DisponibilidadePainel,
  type EtapaResumo,
  type FiltroPacientes,
  type PacienteEntrada,
  type PainelEntradaResposta,
} from "@/lib/indicadores/entradaConvenio"
import { BotaoCopiarMensagem, PilulaPrazo, SeloDisponibilidade } from "./comum"
import { PacienteEntradaDrawer } from "./PacienteEntradaDrawer"

// ─── Frescor ─────────────────────────────────────────────────────────────────

function Frescor({ painel }: { painel: PainelEntradaResposta }) {
  const s = painel.snapshot
  const leitura = painel.ultima_leitura
  const falhou = leitura?.status === "erro" && (!s || leitura.lido_em > s.lido_em)
  const quando = s?.publicado_em ? fmtDataHora(s.publicado_em) : s ? fmtDiaMes(s.gerado_em) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {s && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
              painel.desatualizado ? `${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text}` : `${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}`
            }`}
          >
            {painel.desatualizado ? <AlertTriangle size={12} aria-hidden /> : <Clock size={12} aria-hidden />}
            Dados de {quando}
            {painel.desatualizado && ` · ${painel.dias_uteis_atras} dias úteis sem rodada nova`}
          </span>
        )}
        <span>Rodadas às 7h40 e 12h40 (seg a sex), lidas pelo Pulsar às 7h55 e 12h55.</span>
      </div>
      {painel.desatualizado && (
        <InlineNotice tone="amber" icon={<AlertTriangle size={14} />}>
          A tarefa agendada que calcula o painel não grava dado novo há mais de 1 dia útil. Os números abaixo podem não refletir o ClickUp de hoje.
        </InlineNotice>
      )}
      {falhou && leitura && (
        <InlineNotice tone="red" icon={<FileWarning size={14} />}>
          A última leitura do Doc ({fmtDataHora(leitura.lido_em)}) falhou: {leitura.erro}. O painel mostra a rodada anterior.
        </InlineNotice>
      )}
    </div>
  )
}

// ─── Resumo ──────────────────────────────────────────────────────────────────

function Kpi({ tone, icon, label, valor, onClick, ativo, title }: {
  tone: Tone
  icon: React.ReactNode
  label: string
  valor: React.ReactNode
  onClick?: () => void
  ativo?: boolean
  title?: string
}) {
  const conteudo = (
    <StatCard tone={tone} icon={icon} label={label} tinted={!!ativo || tone === "red"}>
      <div className="text-2xl font-black tabular-nums text-foreground">{valor}</div>
    </StatCard>
  )
  if (!onClick) return <div title={title}>{conteudo}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={title}
      className="rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {conteudo}
    </button>
  )
}

function Resumo({ d, filtro, setFiltro }: { d: DadosPainel; filtro: FiltroPacientes; setFiltro: (f: FiltroPacientes) => void }) {
  const r = d.resumo
  const acimaMeta = r.mediana_total_uteis != null && r.mediana_total_uteis > r.meta_total_uteis
  const irParaLista = (f: FiltroPacientes) => {
    setFiltro(f)
    document.getElementById("entrada-lista")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Kpi tone="blue" icon={<Users size={15} />} label="Em andamento" valor={r.em_andamento}
        onClick={() => irParaLista(FILTRO_INICIAL)} title="Ver todos em andamento" />
      <Kpi tone={r.atrasados ? "red" : "slate"} icon={<AlertTriangle size={15} />} label="Fora do prazo" valor={r.atrasados}
        ativo={filtro.status === "atrasado"}
        onClick={() => irParaLista({ ...FILTRO_INICIAL, status: "atrasado" })} title="Filtrar a lista pelos atrasados" />
      <Kpi tone="purple" icon={<UserPlus size={15} />} label="Entradas (5 d.u.)" valor={r.novas_5du} />
      <Kpi tone="blue" icon={<CalendarCheck size={15} />} label="Para apresentar" valor={r.para_apresentar} />
      <Kpi tone="green" icon={<PlayCircle size={15} />} label="Aguardando início" valor={r.para_iniciar} />
      <Kpi tone={r.sem_formulario ? "amber" : "slate"} icon={<FileWarning size={15} />} label="Sem formulário" valor={r.sem_formulario}
        title="Entraram sem formulário em Solicitações Autorização" />
      <Kpi tone={acimaMeta ? "red" : "green"} icon={<Timer size={15} />} label="Mediana até o início"
        valor={<>{r.mediana_total_uteis ?? "—"} <span className="text-sm font-bold text-muted-foreground">/ {r.meta_total_uteis} d.u.</span></>}
        title={`Mediana da entrada à 1ª sessão; meta ${r.meta_total_uteis} dias úteis`} />
    </div>
  )
}

// ─── Régua do fluxo ──────────────────────────────────────────────────────────

function corDaBarra(pct: number | null): string {
  if (pct == null) return "bg-muted"
  if (pct >= 80) return "bg-emerald-500"
  if (pct >= 50) return "bg-amber-500"
  return "bg-rose-500"
}

function Regua({ etapas, meta }: { etapas: EtapaResumo[]; meta: number }) {
  return (
    <section aria-labelledby="entrada-regua" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entrada-regua" className="text-sm font-bold text-foreground">Régua do fluxo</h2>
        <span className="text-xs text-muted-foreground">Prazos em dias úteis · meta ponta a ponta <b className="tabular-nums">{meta}</b> d.u.</span>
      </div>
      <ol className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-4 xl:grid-cols-8">
        {etapas.map((e, i) => (
          <li key={e.etapa} className="flex flex-col gap-1.5 border-b border-r border-border p-3 text-xs">
            <span className="font-black text-sky-700 dark:text-sky-400">Etapa {i}</span>
            <span className="text-sm font-semibold leading-tight text-foreground">{e.nome}</span>
            <span className="text-muted-foreground">{e.setor}</span>
            <span className="self-start rounded-full bg-muted px-2 py-0.5 tabular-nums text-foreground">
              {e.prazo === 0 ? "mesmo dia" : `até ${e.prazo} d.u.`}
            </span>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">Agora</dt><dd className="font-semibold">{e.em_aberto}</dd>
              <dt className="text-muted-foreground">Mediana</dt><dd className="font-semibold">{e.mediana ?? "—"} d.u.</dd>
              <dt className="text-muted-foreground">No prazo</dt>
              <dd className="font-semibold">{e.pct_no_prazo == null ? "—" : `${e.pct_no_prazo}%`} <span className="font-normal text-muted-foreground">de {e.n}</span></dd>
            </dl>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={`h-full ${corDaBarra(e.pct_no_prazo)}`} style={{ width: `${e.pct_no_prazo ?? 0}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ─── Onde está parado + raias ────────────────────────────────────────────────

function Cartao({ titulo, apoio, children }: { titulo: React.ReactNode; apoio?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="flex items-center justify-between gap-2 text-sm font-bold text-foreground">{titulo}</h3>
        {apoio && <p className="text-[11px] text-muted-foreground">{apoio}</p>}
      </div>
      {children}
    </div>
  )
}

function OndeEstaParado({ pacs, onAbrir }: { pacs: PacienteEntrada[]; onAbrir: (p: PacienteEntrada) => void }) {
  const grupos = porSetor(pacs)
  return (
    <section aria-labelledby="entrada-setores" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entrada-setores" className="text-sm font-bold text-foreground">Onde está parado</h2>
        <span className="text-xs text-muted-foreground">Em andamento, pelo setor responsável pela etapa atual</span>
      </div>
      {grupos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum paciente parado.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {grupos.map(g => (
            <Cartao key={g.setor} titulo={g.setor} apoio={SETOR_DESCRICAO[g.setor]}>
              <div className="flex gap-4 tabular-nums">
                <span><b className="text-xl font-black">{g.pacientes.length}</b> <span className="text-xs text-muted-foreground">parados</span></span>
                <span><b className={`text-xl font-black ${g.atrasados.length ? TONE_SOFT.red.text : ""}`}>{g.atrasados.length}</b> <span className="text-xs text-muted-foreground">fora do prazo</span></span>
              </div>
              {g.atrasados.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs">
                  {g.atrasados.slice(0, 4).map(p => (
                    <li key={p.paciente}>
                      <button type="button" onClick={() => onAbrir(p)} className="text-left hover:underline">
                        {nomeCurto(p.paciente, 2)} · <span className="tabular-nums">{p.atual.dias} d.u.</span> em {p.atual.nome.toLowerCase()}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          ))}
        </div>
      )}
    </section>
  )
}

function Raias({ pacs, onAbrir }: { pacs: PacienteEntrada[]; onAbrir: (p: PacienteEntrada) => void }) {
  const r = raias(pacs)
  const vazio = <li className="text-muted-foreground">Ninguém nesta etapa.</li>
  const item = (p: PacienteEntrada, direita: React.ReactNode) => (
    <li key={p.paciente} className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5 first:border-0 first:pt-0">
      <button type="button" onClick={() => onAbrir(p)} className="min-w-0 truncate text-left hover:underline">
        {nomeCurto(p.paciente)} <span className="text-muted-foreground">· {p.convenio}</span>
      </button>
      {direita}
    </li>
  )
  return (
    <section aria-labelledby="entrada-raias" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entrada-raias" className="text-sm font-bold text-foreground">Apresentação e início</h2>
        <span className="text-xs text-muted-foreground">Quem falta apresentar, quem falta começar e quem já começou</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Cartao titulo={<>Para apresentar <span className="tabular-nums">{r.paraApresentar.length}</span></>} apoio="Etapa 5 · Cronograma · até 1 d.u.">
          <ul className="flex flex-col gap-1.5 text-xs">
            {r.paraApresentar.length ? r.paraApresentar.map(p => item(p, <PilulaPrazo status={p.atual.status} />)) : vazio}
          </ul>
        </Cartao>
        <Cartao titulo={<>Aguardando início <span className="tabular-nums">{r.aguardandoInicio.length}</span></>} apoio="Etapa 7 · Terapêutico confirma a 1ª sessão · até 5 d.u.">
          <ul className="flex flex-col gap-1.5 text-xs">
            {r.aguardandoInicio.length ? r.aguardandoInicio.map(p => item(p, <PilulaPrazo status={p.atual.status} />)) : vazio}
          </ul>
        </Cartao>
        <Cartao titulo={<>Já iniciaram <span className="tabular-nums">{r.iniciados.length}</span></>} apoio='Subtarefa "Cronograma iniciado" marcada'>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-xs">
            {r.iniciados.length
              ? r.iniciados.map(p => item(p, <span className="shrink-0 tabular-nums text-muted-foreground">início {fmtDiaMes(p.inicio)}</span>))
              : vazio}
          </ul>
        </Cartao>
      </div>
    </section>
  )
}

// ─── Lista de pacientes ──────────────────────────────────────────────────────

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        ativo ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

function GrupoChips({ rotulo, valores, atual, onEscolher, formatar = v => v }: {
  rotulo: string
  valores: string[]
  atual: string
  onEscolher: (v: string) => void
  formatar?: (v: string) => string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      {[TODOS, ...valores].map(v => (
        <Chip key={v} ativo={atual === v} onClick={() => onEscolher(v)}>{v === TODOS ? TODOS : formatar(v)}</Chip>
      ))}
    </div>
  )
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function ListaPacientes({ pacs, disp, filtro, setFiltro, onAbrir }: {
  pacs: PacienteEntrada[]
  disp: Map<string, DisponibilidadePainel>
  filtro: FiltroPacientes
  setFiltro: (f: FiltroPacientes) => void
  onAbrir: (p: PacienteEntrada) => void
}) {
  const { setores, convenios } = useMemo(() => opcoesFiltro(pacs), [pacs])
  const lista = useMemo(() => filtrarPacientes(pacs, filtro), [pacs, filtro])
  const selo = (p: (typeof lista)[number]) =>
    ETAPAS_DISPONIBILIDADE.has(p.atual.etapa) ? <SeloDisponibilidade disp={disp.get(p.paciente)} /> : null
  const nota = (p: (typeof lista)[number]) => p.atual.pendencia ?? p.atual.obs ?? (p.alertas ?? [])[0] ?? null

  return (
    <section id="entrada-lista" aria-labelledby="entrada-lista-titulo" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entrada-lista-titulo" className="text-sm font-bold text-foreground">Pacientes em andamento</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{lista.length} paciente{lista.length === 1 ? "" : "s"}</span>
      </div>
      <div className="flex flex-col gap-2">
        <GrupoChips rotulo="Setor" valores={setores} atual={filtro.setor} onEscolher={v => setFiltro({ ...filtro, setor: v })} />
        <GrupoChips rotulo="Situação" valores={STATUS_FILTRAVEIS} atual={filtro.status} onEscolher={v => setFiltro({ ...filtro, status: v })} formatar={maiuscula} />
        {convenios.length > 1 && (
          <GrupoChips rotulo="Convênio" valores={convenios} atual={filtro.convenio} onEscolher={v => setFiltro({ ...filtro, convenio: v })} />
        )}
      </div>

      {lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum paciente com esse filtro.</p>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden">
            {lista.map(p => (
              <li key={p.paciente}>
                <button
                  type="button"
                  onClick={() => onAbrir(p)}
                  className={`w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm ${p.atual.status === "atrasado" ? "border-l-4 border-l-rose-500" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-foreground">{p.paciente}</span>
                    <PilulaPrazo status={p.atual.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.convenio} · {p.atual.nome} · {p.atual.setor} · <span className="tabular-nums">{p.atual.dias ?? "—"}/{p.atual.prazo} d.u.</span>
                  </div>
                  {nota(p) && <p className="mt-1 line-clamp-2 text-xs text-foreground">{nota(p)}</p>}
                  {selo(p) && <div className="mt-2">{selo(p)}</div>}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Paciente</th>
                  <th className="px-3 py-2 font-semibold">Convênio</th>
                  <th className="px-3 py-2 font-semibold">Etapa atual</th>
                  <th className="px-3 py-2 font-semibold">Setor</th>
                  <th className="px-3 py-2 text-right font-semibold">D.u. / prazo</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="px-3 py-2 font-semibold">Disponibilidade</th>
                  <th className="px-3 py-2 font-semibold">Pendência</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(p => (
                  <tr
                    key={p.paciente}
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.paciente}: ver detalhes`}
                    onClick={() => onAbrir(p)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(p) } }}
                    className="cursor-pointer border-b border-border/60 align-top transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className={`min-w-[200px] px-3 py-2 ${p.atual.status === "atrasado" ? "shadow-[inset_3px_0_0_var(--color-rose-500)]" : ""}`}>
                      <div className="font-semibold text-foreground">{p.paciente}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.tipo === "Neuro" ? "Avaliação neuro" : "Terapias"} · via {p.rota === "Família" ? "família" : "convênio"} · entrada {fmtDiaMes(p.entrada)}
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.convenio}</td>
                    <td className="px-3 py-2">{p.atual.nome}</td>
                    <td className="px-3 py-2">{p.atual.setor}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.atual.dias ?? "—"} / {p.atual.prazo}</td>
                    <td className="px-3 py-2"><PilulaPrazo status={p.atual.status} /></td>
                    <td className="px-3 py-2">{selo(p) ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[44ch] px-3 py-2">
                      {nota(p) ? <span className="line-clamp-2">{nota(p)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Registro a corrigir, concluídos, regras ─────────────────────────────────

function RegistroACorrigir({ pacs }: { pacs: PacienteEntrada[] }) {
  const itens = alertasDeRegistro(pacs)
  return (
    <section aria-labelledby="entrada-registro" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entrada-registro" className="text-sm font-bold text-foreground">Registro a corrigir</h2>
        <span className="text-xs text-muted-foreground">O que está fora do ClickUp ou desatualizado distorce o painel</span>
      </div>
      {itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nada a corrigir.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {itens.map((it, i) => (
            <li key={i} className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
              <b className="block text-foreground">{it.paciente}</b>
              {it.alerta}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Recolhivel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-bold text-foreground">{titulo}</summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

function ConcluidosEEncerrados({ pacs, onAbrir }: { pacs: PacienteEntrada[]; onAbrir: (p: PacienteEntrada) => void }) {
  const lista = concluidosEEncerrados(pacs)
  return (
    <Recolhivel titulo={`Concluídos e encerrados (${lista.length})`}>
      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum ainda.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-xs">
          {lista.map(p => (
            <li key={p.paciente} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0">
              <button type="button" onClick={() => onAbrir(p)} className="text-left font-semibold hover:underline">
                {p.paciente} <span className="font-normal text-muted-foreground">· {p.convenio} · entrada {fmtDiaMes(p.entrada)}</span>
              </button>
              <span className="flex items-center gap-2">
                {p.total_uteis != null && <span className="tabular-nums text-muted-foreground">{p.total_uteis} d.u.</span>}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  p.situacao === "concluído" ? `${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}` : `${TONE_SOFT.slate.bg} ${TONE_SOFT.slate.text}`
                }`}>
                  {p.situacao === "concluído" ? (p.tipo === "Neuro" ? "avaliação feita" : "tratamento iniciado") : "encerrado"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Recolhivel>
  )
}

function Regras() {
  return (
    <Recolhivel titulo="Regras do painel">
      <div className="flex flex-col gap-1.5 text-xs text-foreground">
        <p>Etapas: 0 abrir formulário (Autorização ou Comercial, mesmo dia) · 1 elegibilidade (Autorização, 1 d.u.) · 2 agendar entrevista (Comercial, 1) · 3 entrevista ou avaliação (Terapêutico, 5) · 4 montar cronograma (Cronograma, 5) · 5 apresentar e aprovar com a família (Cronograma, 1) · 6 autorização da operadora (Autorização, 1; na Leve, até 1 d.u. antes do início previsto, pedida dentro do mês) · 7 iniciar: Terapêutico marca a subtarefa &quot;Cronograma iniciado&quot; (5).</p>
        <p>1. Toda entrada abre formulário em Solicitações Autorização no mesmo dia, pela família (Comercial) ou pelo convênio (Autorização).</p>
        <p>2. Mudou de etapa, muda o status da task. Combinado só no chat não conta para o painel.</p>
        <p>3. Tentativas de contato com a família ficam registradas como comentário na task.</p>
        <p>4. Depois da entrevista, o status no CRM muda no mesmo dia. No cronograma, a Data de Apresentação e a data da 1ª sessão são obrigatórias.</p>
        <p>5. O card só vai para Concluído depois que o paciente vem à 1ª sessão. Cronograma excluído fica como Cancelado, nunca como Concluído.</p>
        <p>6. Nome completo do paciente em todas as tasks e formulários: é por ele que o painel acha a disponibilidade no cadastro do Pulsar.</p>
        <p className="text-muted-foreground">Calculado pela tarefa agendada a partir do ClickUp (Solicitações Autorização, CRM Universo ABA, Cronograma Pacientes e chat de autorização). O Pulsar só exibe.</p>
      </div>
    </Recolhivel>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function EntradaConvenioShell() {
  const { loading, erro, instalado, podeAtualizar, painel, atualizando, atualizar } = usePainelEntradaConvenio()
  const { setRightContent } = useHeader()
  const [filtro, setFiltro] = useState<FiltroPacientes>(FILTRO_INICIAL)
  const [aberto, setAberto] = useState<PacienteEntrada | null>(null)

  const disp = useMemo(() => mapaDisponibilidade(painel?.disponibilidade ?? []), [painel])

  useEffect(() => {
    setRightContent(
      <div className="flex flex-wrap items-center gap-2">
        <BotaoCopiarMensagem rotulo="Copiar link de disponibilidade" />
        {podeAtualizar && (
          <button
            type="button"
            disabled={atualizando}
            onClick={async () => {
              const r = await atualizar()
              if (r.ok) toast.success(r.mensagem)
              else toast.error(r.mensagem)
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 dark:bg-sky-600 dark:hover:bg-sky-700"
          >
            <RefreshCw size={13} className={atualizando ? "animate-spin" : ""} aria-hidden />
            Atualizar agora
          </button>
        )}
      </div>,
    )
    return () => setRightContent(null)
  }, [podeAtualizar, atualizando, atualizar, setRightContent])

  if (loading && !painel) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando o painel de entrada...
      </div>
    )
  }
  if (erro) return <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{erro}</div>
  if (!instalado) {
    return (
      <InlineNotice tone="amber" icon={<AlertTriangle size={14} />}>
        O painel ainda não foi instalado no banco (migration 20261013100000_painel_entrada_convenio.sql pendente).
      </InlineNotice>
    )
  }
  if (!painel?.snapshot) {
    const l = painel?.ultima_leitura
    return (
      <div className="flex flex-col gap-3">
        <InlineNotice tone="blue" icon={<Clock size={14} />}>
          Ainda não há rodada copiada do ClickUp. O Pulsar lê o Doc às 7h55 e 12h55 (seg a sex)
          {podeAtualizar ? ', ou na hora pelo botão "Atualizar agora"' : ""}.
        </InlineNotice>
        {l && (
          <InlineNotice tone={l.status === "erro" ? "red" : "slate"} icon={<FileWarning size={14} />}>
            Última tentativa em {fmtDataHora(l.lido_em)}: {l.erro ?? l.status}.
          </InlineNotice>
        )}
      </div>
    )
  }

  const d = painel.snapshot.dados
  return (
    <div className="flex flex-col gap-6">
      <Frescor painel={painel} />
      <Resumo d={d} filtro={filtro} setFiltro={setFiltro} />
      <Regua etapas={d.etapas} meta={d.resumo.meta_total_uteis} />
      <OndeEstaParado pacs={d.pacientes} onAbrir={setAberto} />
      <Raias pacs={d.pacientes} onAbrir={setAberto} />
      <ListaPacientes pacs={d.pacientes} disp={disp} filtro={filtro} setFiltro={setFiltro} onAbrir={setAberto} />
      <RegistroACorrigir pacs={d.pacientes} />
      <ConcluidosEEncerrados pacs={d.pacientes} onAbrir={setAberto} />
      <Regras />
      {aberto && (
        <PacienteEntradaDrawer paciente={aberto} disp={disp.get(aberto.paciente)} onClose={() => setAberto(null)} />
      )}
    </div>
  )
}

