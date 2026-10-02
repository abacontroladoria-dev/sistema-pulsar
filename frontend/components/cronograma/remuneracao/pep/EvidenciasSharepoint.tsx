"use client"

import { useMemo, useState } from "react"
import { Bot, Check, ExternalLink, FileX2, Hourglass, Loader2, RotateCcw, Undo2, User, X } from "lucide-react"
import { nomeEsperado, porQueEsperando } from "@/lib/roboSharepoint/rotulos"
import type { PepCatalogoItem } from "@/types/pep"
import type { SpItem } from "@/types/roboSharepoint"
import { ORIGEM, SeloUnidade } from "./origem"

// "O que o robô fez neste mês" — o robô SharePoint ENTREGA sozinho o arquivo
// que segue o padrão de nome (20261002100000); a pessoa só desfaz quando ele
// errar. Este cartão mostra, para o analista e o mês abertos:
//   • quanto o robô entregou e quanto uma pessoa entregou (unidades e R$);
//   • a lista do que o robô entregou, com o arquivo a um clique e "Desfazer";
//   • o que está esperando uma pessoa (fora do padrão, sem planejamento…),
//     com o motivo, o nome que o arquivo deveria ter e "Marcar como entrega";
//   • o que alguém já desfez, com quem e por quê;
//   • as entregas que saíram junto com a evidência apagada do SharePoint
//     (20261003100000: a entrega acompanha a pasta, do robô ou de pessoa).
// Roxo = robô, azul = pessoa (./origem).

export type AvaliacaoSugestao = { pode: true } | { pode: false; motivo: string }

type Aba = "robo" | "esperando" | "desfeitas" | "sairam"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

function dataBR(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

function BotaoArquivo({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-blue-900 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/40">
      <ExternalLink size={15} aria-hidden /> Abrir no SharePoint
    </a>
  )
}

function Indicador({ icone: Icone, valor, rotulo, sub, tom }: {
  icone: typeof Bot; valor: string; rotulo: string; sub?: string; tom: string
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${tom}`}>
      <Icone size={20} className="shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 text-xs font-semibold">{rotulo}</p>
        {sub && <p className="text-[11px] opacity-80">{sub}</p>}
      </div>
    </div>
  )
}

export function EvidenciasSharepoint({ itens, catalogo, avaliar, onConfirmar, onIgnorar, onDesfazer, valores, unidadesPessoa, liberado }: {
  itens: SpItem[]
  catalogo: PepCatalogoItem[]
  avaliar: (item: SpItem) => AvaliacaoSugestao
  onConfirmar: (item: SpItem) => Promise<boolean>
  onIgnorar: (item: SpItem) => Promise<boolean>
  onDesfazer: (item: SpItem, motivo: string) => Promise<boolean>
  /** Σ valor_robo / valor_humano da apuração do analista no mês. */
  valores: { robo: number; humano: number } | null
  /** Unidades marcadas por pessoas no mês (registros − parte do robô). */
  unidadesPessoa: number
  liberado: boolean
}) {
  const itemPorId = useMemo(() => new Map(catalogo.map(c => [c.id, c])), [catalogo])
  const doRobo = useMemo(() => itens.filter(i => i.status === "confirmado" && i.entregue_por === "robo"), [itens])
  const esperando = useMemo(() => itens.filter(i => i.status === "sugerido"), [itens])
  const desfeitas = useMemo(() => itens.filter(i => i.status === "revertido"), [itens])
  // Entregues e depois apagados do SharePoint: a unidade saiu (o robô retirou).
  const sairam = useMemo(() => itens.filter(i => i.status === "removido" && !!i.entregue_por), [itens])
  const [escolhida, setEscolhida] = useState<Aba | null>(null)
  const aba: Aba = escolhida ?? (esperando.length > 0 ? "esperando" : "robo")
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [desfazendo, setDesfazendo] = useState<string | null>(null)
  const [motivo, setMotivo] = useState("")

  if (doRobo.length + esperando.length + desfeitas.length + sairam.length === 0) return null

  const aprovadas = doRobo.length + desfeitas.length
  const acerto = aprovadas > 0 ? Math.round((doRobo.length / aprovadas) * 100) : null

  async function agir(i: SpItem, fn: () => Promise<boolean>) {
    setOcupado(i.sp_id)
    try { return await fn() } finally { setOcupado(null) }
  }

  const sigla = (i: SpItem) => (i.item_id ? itemPorId.get(i.item_id)?.sigla : null) ?? i.sigla ?? "—"
  const titulo = (i: SpItem) => `${sigla(i)} · ${i.paciente_nome ?? "Geral (sem paciente)"}`

  const ABAS: { id: Aba; rotulo: string; n: number; icone: typeof Bot }[] = [
    { id: "robo", rotulo: "Robô entregou", n: doRobo.length, icone: Bot },
    { id: "esperando", rotulo: "Esperando você", n: esperando.length, icone: Hourglass },
    { id: "desfeitas", rotulo: "Desfeitas", n: desfeitas.length, icone: Undo2 },
    ...(sairam.length ? [{ id: "sairam" as const, rotulo: "Saíram da pasta", n: sairam.length, icone: FileX2 }] : []),
  ]

  return (
    <section className="tema-robo overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="titulo-robo-mes">
      <div className="flex h-1 w-full" aria-hidden><span className="w-1/2 bg-violet-600" /><span className="w-1/2 bg-blue-600" /></div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <Bot size={22} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="titulo-robo-mes" className="text-base font-bold text-foreground">O que o robô fez neste mês</h3>
            <p className="text-sm text-muted-foreground">
              Toda noite o robô lê o SharePoint e marca sozinho o que segue o padrão de nome. Você só desfaz quando ele errar.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Indicador icone={Bot} valor={String(doRobo.length)} rotulo="entregas do robô"
            sub={valores ? `${brl(valores.robo)} na apuração` : undefined} tom={ORIGEM.robo.tinta} />
          <Indicador icone={User} valor={String(unidadesPessoa)} rotulo="entregas de pessoas"
            sub={valores ? `${brl(valores.humano)} na apuração` : undefined} tom={ORIGEM.humano.tinta} />
          <Indicador icone={Undo2} valor={String(desfeitas.length)} rotulo="desfeitas por pessoas"
            sub={acerto != null ? `robô acertou ${acerto}%` : undefined}
            tom="border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
          <Indicador icone={Hourglass} valor={String(esperando.length)} rotulo="esperando você"
            sub={esperando.length ? "veja o motivo de cada um" : "nada pendente"}
            tom="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" />
        </div>

        <div role="tablist" aria-label="O que o robô fez" className="flex flex-wrap gap-2">
          {ABAS.map(a => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setEscolhida(a.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                ${aba === a.id ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900" : "border-border bg-background text-foreground hover:bg-muted/50"}`}>
              <a.icone size={15} aria-hidden /> {a.rotulo}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${aba === a.id ? "bg-white/20" : "bg-muted"}`}>{a.n}</span>
            </button>
          ))}
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border" role="tabpanel">
          {aba === "robo" && doRobo.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">O robô ainda não entregou nada deste analista neste mês.</li>
          )}
          {aba === "robo" && doRobo.map(i => (
            <li key={i.sp_id} className="space-y-3 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <SeloUnidade origem="robo" tamanho={22} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{titulo(i)}</p>
                    <p className="truncate text-xs text-muted-foreground" title={i.nome}>{i.nome}</p>
                    <p className="text-[11px] text-muted-foreground">Entregue pelo robô em {dataBR(i.resolvido_em)}</p>
                    {i.removido_em && (
                      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                        Arquivo apagado do SharePoint em {dataBR(i.removido_em)} — o mês está liberado, então a entrega fica.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!i.removido_em && <BotaoArquivo url={i.web_url} />}
                  {!liberado && (
                    <button type="button" onClick={() => { setDesfazendo(desfazendo === i.sp_id ? null : i.sp_id); setMotivo("") }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300">
                      <RotateCcw size={15} aria-hidden /> Desfazer
                    </button>
                  )}
                </div>
              </div>
              {desfazendo === i.sp_id && (
                <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                  <label htmlFor={`motivo-${i.sp_id}`} className="block text-xs font-semibold text-rose-900 dark:text-rose-200">
                    Por que o robô errou? (fica no histórico)
                  </label>
                  <textarea id={`motivo-${i.sp_id}`} value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                    placeholder="ex.: não é o PIC deste paciente"
                    className="w-full rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm dark:border-rose-900 dark:bg-slate-900" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!motivo.trim() || ocupado === i.sp_id}
                      onClick={async () => { if (await agir(i, () => onDesfazer(i, motivo.trim()))) setDesfazendo(null) }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                      {ocupado === i.sp_id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                      Desfazer a entrega
                    </button>
                    <button type="button" onClick={() => setDesfazendo(null)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:bg-muted/50">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}

          {aba === "esperando" && esperando.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nada esperando você.</li>
          )}
          {aba === "esperando" && esperando.map(i => {
            const av = avaliar(i)
            const esperado = i.padrao === "fora" || i.padrao === "duplicado" ? nomeEsperado(sigla(i), i.paciente_nome, i.competencia) : null
            return (
              <li key={i.sp_id} className="space-y-2 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <SeloUnidade origem={null} tamanho={22} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">{titulo(i)}</p>
                      <p className="truncate text-xs text-muted-foreground" title={i.nome}>{i.nome}</p>
                      <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
                        {porQueEsperando(i)}
                      </span>
                      {esperado && (
                        <p className="mt-1 text-xs text-muted-foreground">Nome esperado: <code className="rounded bg-muted px-1 py-0.5 font-semibold text-foreground">{esperado}</code></p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <BotaoArquivo url={i.web_url} />
                    <button type="button" disabled={!av.pode || ocupado === i.sp_id} onClick={() => agir(i, () => onConfirmar(i))}
                      title="A pessoa assume a entrega (fica azul)"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                      {ocupado === i.sp_id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
                      Marcar como entrega
                    </button>
                    <button type="button" disabled={ocupado === i.sp_id} onClick={() => agir(i, () => onIgnorar(i))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50">
                      <X size={14} aria-hidden /> Ignorar
                    </button>
                  </div>
                </div>
                {!av.pode && <p className="text-xs text-amber-800 dark:text-amber-300">{av.motivo}</p>}
              </li>
            )
          })}

          {aba === "desfeitas" && desfeitas.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Ninguém desfez entrega do robô neste mês.</li>
          )}
          {aba === "desfeitas" && desfeitas.map(i => (
            <li key={i.sp_id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200"><Undo2 size={13} aria-hidden /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground line-through decoration-slate-400">{titulo(i)}</p>
                  <p className="truncate text-xs text-muted-foreground" title={i.nome}>{i.nome}</p>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    Desfeita por <strong>{i.revertido_por_nome ?? "pessoa"}</strong> em {dataBR(i.revertido_em)}
                    {i.revertido_motivo ? <> — “{i.revertido_motivo}”</> : null}
                  </p>
                </div>
              </div>
              <BotaoArquivo url={i.web_url} />
            </li>
          ))}

          {aba === "sairam" && sairam.map(i => {
            const quem = i.entregue_por === "robo" ? "robo" : "humano"
            return (
              <li key={i.sp_id} className="flex min-w-0 items-start gap-3 px-4 py-3">
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"><FileX2 size={13} aria-hidden /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{titulo(i)}</p>
                  <p className="truncate text-xs text-muted-foreground line-through decoration-slate-400" title={i.nome}>{i.nome}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                    <span className={`inline-flex items-center gap-1 font-semibold ${ORIGEM[quem].texto}`}>
                      {quem === "robo" ? <Bot size={12} aria-hidden /> : <User size={12} aria-hidden />} Entregue por {quem === "robo" ? "robô" : "pessoa"}
                      {i.resolvido_em ? ` em ${dataBR(i.resolvido_em)}` : ""}
                    </span>
                    <span>·</span>
                    <span>
                      {i.robo_obs === "saiu_da_pasta_do_item" ? "saiu da pasta do item" : "apagado do SharePoint"}
                      {i.removido_em ? ` em ${dataBR(i.removido_em)}` : ""}: a unidade saiu da entrega e o valor foi recalculado.
                    </span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
