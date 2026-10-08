"use client"

import { useMemo, useState } from "react"
import {
  ArrowUpRight, CalendarRange, ChevronDown, CircleSlash, FastForward, FileClock, GitCompare, History, Plus, Replace, RotateCcw, UserRound, Users,
} from "lucide-react"
import { CabecalhoPastel, SecaoPastel, tom, type Tom } from "@/components/ui/pastel/pecas"
import {
  curtoDia, dataBR, diferencasEntreVersoes, periodoBR, rascunhoDeVersao, totaisDaSemana, type Diferenca,
} from "@/lib/disponibilidadeProfissional"
import type { EventoDisponibilidade, VersaoDisponibilidade } from "@/types/disponibilidadeProfissional"
import type { CadastroTerapia } from "@/types/terapia"
import { SeloSituacao, TOM_SITUACAO } from "./pecasDisponibilidade"

// Aba Histórico: todas as versões da disponibilidade (nada é apagado), o que
// mudou de uma para a seguinte, e a trilha de eventos — quem criou, encerrou,
// ajustou ou restaurou, quando e por quê.

const EVENTO: Record<EventoDisponibilidade["tipo"], { t: Tom; Icone: typeof Plus; verbo: string }> = {
  criar: { t: "teal", Icone: Plus, verbo: "criou" },
  encerrar: { t: "vermelho", Icone: CircleSlash, verbo: "encerrou" },
  alterar_vigencia: { t: "aco", Icone: CalendarRange, verbo: "ajustou a vigência de" },
  restaurar: { t: "azul", Icone: RotateCcw, verbo: "restaurou como" },
  substituir: { t: "cinza", Icone: Replace, verbo: "substituiu" },
  antecipar: { t: "verde", Icone: FastForward, verbo: "fez valer a partir de hoje" },
  carga_capacidade: { t: "aco", Icone: Users, verbo: "copiou \"Pacientes por horário\" dos Indicadores para" },
}

const ORIGEM: Record<VersaoDisponibilidade["origem"], string> = {
  manual: "Montada à mão",
  preenchido_tita: "Montada a partir da grade do TiTa",
  restaurada: "Restaurada de versão anterior",
}

const COR_DIF: Record<Diferenca["tipo"], string> = {
  adicionada: "text-emerald-700 dark:text-emerald-400",
  removida: "text-rose-700 dark:text-rose-400",
  alterada: "text-amber-700 dark:text-amber-400",
  dia: "text-[var(--pp-ink)]",
}
const ROTULO_DIF: Record<Diferenca["tipo"], string> = { adicionada: "+", removida: "−", alterada: "≈", dia: "•" }

export function AbaHistorico({
  versoes,
  eventos,
  catalogo,
  onAbrirVersao,
  onVerAlteracoesCadastro,
}: {
  versoes: VersaoDisponibilidade[]
  eventos: EventoDisponibilidade[]
  catalogo: CadastroTerapia[]
  onAbrirVersao: (id: string) => void
  onVerAlteracoesCadastro: () => void
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const porNumero = useMemo(() => [...versoes].sort((a, b) => b.numero - a.numero), [versoes])
  const numeroDe = useMemo(() => new Map(versoes.map(v => [v.id, v.numero])), [versoes])
  const nomeTerapia = useMemo(() => {
    const m = new Map(catalogo.map(t => [t.id, t.nome]))
    // Nome gravado na própria faixa vence: a terapia pode ter sido renomeada depois.
    for (const v of versoes) for (const f of v.faixas) for (const t of f.terapias) m.set(t.terapia_id, t.terapia_nome)
    return (id: number) => m.get(id) ?? `#${id}`
  }, [catalogo, versoes])
  const nomeLocal = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of versoes) for (const f of v.faixas) m.set(f.local_id, f.local_nome)
    return (id: string | null) => (id ? m.get(id) ?? "local removido" : "sem local")
  }, [versoes])

  const alternar = (id: string) =>
    setAbertas(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-5">
      <SecaoPastel titulo="hist-versoes">
        <CabecalhoPastel
          id="hist-versoes"
          titulo="Versões da disponibilidade"
          t="azul"
          Icone={History}
          apoio={versoes.length ? `${versoes.length} ${versoes.length === 1 ? "versão guardada" : "versões guardadas"} — nenhuma é apagada` : "Nenhuma versão ainda"}
          direita={
            <button type="button" onClick={onVerAlteracoesCadastro} className={`${tom("cinza")} pp-btn pp-btn-suave`}>
              <FileClock className="h-4 w-4" aria-hidden /> Alterações no cadastro
            </button>
          }
        />

        {porNumero.length === 0 ? (
          <p className="rounded-[20px] bg-[var(--pp-muted)] px-4 py-8 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">
            Quando a primeira disponibilidade for salva, ela aparece aqui — e toda mudança depois vira uma nova linha.
          </p>
        ) : (
          <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-0.5 before:bg-[var(--pp-border)]">
            {porNumero.map(v => {
              const anterior = versoes.find(x => x.numero === v.numero - 1) ?? null
              const difs = anterior
                ? diferencasEntreVersoes(rascunhoDeVersao(anterior), rascunhoDeVersao(v), nomeTerapia, nomeLocal)
                : null
              const sessoes = totaisDaSemana(rascunhoDeVersao(v)).sessoes
              const aberta = abertas.has(v.id)
              return (
                <li key={v.id} className={`${tom(TOM_SITUACAO[v.situacao])} relative flex gap-3`}>
                  <span className="relative z-10 mt-3 flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--c)] text-[13px] font-extrabold text-[var(--c-sobre)] ring-4 ring-[var(--pp-surface)]">
                    {v.numero}
                  </span>
                  <div className={`min-w-0 flex-1 rounded-[20px] p-4 ${
                    v.situacao === "encerrada" || v.situacao === "substituida"
                      ? "bg-[var(--pp-muted)] shadow-[inset_0_0_0_1px_var(--pp-border)]"
                      : "bg-[var(--pp-surface)] shadow-[var(--pp-sombra),inset_0_0_0_1.5px_var(--c-linha)]"
                  }`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-extrabold">Versão nº {v.numero}</p>
                      <SeloSituacao situacao={v.situacao} compacto />
                      <span className="text-[13px] font-bold tabular-nums text-[var(--pp-ink-muted)]">{periodoBR(v.vigente_de, v.vigente_ate)}</span>
                      <button type="button" onClick={() => onAbrirVersao(v.id)} className="ml-auto inline-flex items-center gap-1 text-[13px] font-bold text-[var(--pp-foco)] hover:underline">
                        Abrir <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-[var(--pp-ink-muted)]">
                      <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" aria-hidden />{v.criado_por_nome ?? "—"}</span>
                      <span>· {new Date(v.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</span>
                      <span>· {ORIGEM[v.origem]}{v.origem === "restaurada" && v.restaurada_de && numeroDe.get(v.restaurada_de) ? ` (nº ${numeroDe.get(v.restaurada_de)})` : ""}</span>
                      <span>· {sessoes} sessões/semana</span>
                      <span>· {v.dias_ativos.length ? v.dias_ativos.map(curtoDia).join(", ") : "nenhum dia"}</span>
                    </p>
                    {v.motivo && <p className="mt-2 text-[13px] font-semibold">“{v.motivo}”</p>}
                    {v.substituida_em && (
                      <p className="mt-2 text-[13px] font-bold text-[var(--pp-ink-muted)]">
                        Substituída{v.substituida_por && numeroDe.get(v.substituida_por) ? ` pela versão nº ${numeroDe.get(v.substituida_por)}` : ""} em{" "}
                        {new Date(v.substituida_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} — não chegou a valer como planejada.
                      </p>
                    )}

                    {difs && (
                      <div className="mt-3">
                        <button type="button" onClick={() => alternar(v.id)} aria-expanded={aberta}
                          className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--pp-ink-muted)] hover:text-[var(--pp-ink)]">
                          <GitCompare className="h-3.5 w-3.5" aria-hidden />
                          {difs.length ? `${difs.length} mudança${difs.length === 1 ? "" : "s"} em relação à nº ${anterior!.numero}` : `Mesmo conteúdo da nº ${anterior!.numero}`}
                          {difs.length > 0 && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberta ? "rotate-180" : ""}`} aria-hidden />}
                        </button>
                        {aberta && difs.length > 0 && (
                          <ul className="mt-2 space-y-1 rounded-[14px] bg-[var(--pp-muted)] p-3 text-[12px] font-semibold">
                            {difs.map((d, i) => (
                              <li key={i} className={`flex gap-2 ${COR_DIF[d.tipo]}`}>
                                <span className="w-8 shrink-0 font-extrabold">{curtoDia(d.dia)}</span>
                                <span className="w-3 shrink-0 font-extrabold" aria-label={d.tipo}>{ROTULO_DIF[d.tipo]}</span>
                                <span className="min-w-0">{d.texto}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </SecaoPastel>

      <SecaoPastel titulo="hist-eventos">
        <CabecalhoPastel id="hist-eventos" titulo="Trilha de eventos" t="cinza" Icone={FileClock} tamanho="medio" nivel="h3"
          apoio="Quem fez o quê, quando e por quê" />
        {eventos.length === 0 ? (
          <p className="text-sm font-semibold text-[var(--pp-ink-muted)]">Nenhum evento ainda.</p>
        ) : (
          <ul className="divide-y divide-[var(--pp-border)]">
            {eventos.map(e => {
              const cfg = EVENTO[e.tipo]
              const n = e.versao_id ? numeroDe.get(e.versao_id) : undefined
              const periodoAntes = e.antes?.vigente_de ? periodoBR(e.antes.vigente_de, e.antes.vigente_ate ?? null) : null
              const periodoDepois = e.depois?.vigente_de ? periodoBR(e.depois.vigente_de, e.depois.vigente_ate ?? null) : null
              return (
                <li key={e.id} className={`${tom(cfg.t)} flex gap-3 py-3`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--c)] text-[var(--c-sobre)]">
                    <cfg.Icone className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="font-semibold">
                      <span className="font-extrabold">{e.usuario_nome ?? "Alguém"}</span> {cfg.verbo} a versão nº {n ?? "?"}
                      {e.tipo === "criar" && periodoDepois && <> · {periodoDepois}</>}
                      {e.tipo === "substituir" && e.depois?.substituida_por && numeroDe.get(e.depois.substituida_por) && (
                        <> pela nº {numeroDe.get(e.depois.substituida_por)}</>
                      )}
                      {(e.tipo === "encerrar" || e.tipo === "alterar_vigencia" || e.tipo === "antecipar") && periodoDepois && (
                        <> · <span className="text-[var(--pp-ink-muted)] line-through decoration-1">{periodoAntes}</span> → {periodoDepois}</>
                      )}
                    </p>
                    {e.motivo && <p className="mt-0.5 font-semibold text-[var(--pp-ink-muted)]">“{e.motivo}”</p>}
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--pp-ink-muted)]">
                    {e.criado_em_brasilia ?? dataBR(e.criado_em)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </SecaoPastel>
    </div>
  )
}
