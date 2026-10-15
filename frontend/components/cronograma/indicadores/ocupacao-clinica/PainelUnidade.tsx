"use client"

// PainelUnidade — o detalhe de uma unidade num painel lateral (Drawer): a barra
// com a legenda, manhã × tarde, o mapa com os dois números, quem está em cada
// situação (lista nominal) e o que antes ficava espremido no cartão (salas por
// status/capacidade, terapias). "Lista completa" abre o modal de auditoria
// bloco a bloco por cima, sem fechar o painel.

import Link from "next/link"
import type { ReactNode } from "react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { CAPACIDADE_LABEL_CURTO } from "@/lib/cronograma/salasTypes"
import {
  HORARIOS_TEMPO_INTEGRAL_SEMANA,
  pctComPaciente,
  pctComProfissional,
  type OcupacaoClinicaUnidade,
  type PendenciaProfissional,
  type SituacaoCadeira,
  type TurnoClinica,
} from "@/lib/cronograma/ocupacaoClinica"
import { BarraCapacidade, LegendaCapacidade } from "./BarraCapacidade"
import { ParDeNumeros } from "./CartaoUnidade"
import { MapaSemana } from "./MapaSemana"
import { SITUACAO, fmtNum, fmtPct, plural } from "./visual"

interface Props {
  unidade: OcupacaoClinicaUnidade
  periodo: string
  rotuloStatus: (codigo: string) => string
  onAuditoria: (turno: TurnoClinica) => void
  onClose: () => void
}

export function PainelUnidade({ unidade: u, periodo, rotuloStatus, onAuditoria, onClose }: Props) {
  const status = [
    `${fmtNum(u.salasOperacionais)} em uso`,
    ...Object.entries(u.porStatus).map(([codigo, n]) => `${fmtNum(n)} ${rotuloStatus(codigo)}`),
  ].join(" · ")
  const capacidades = (["unico", "duplo", "multiplo"] as const)
    .filter(c => u.salasPorCapacidade[c] > 0)
    .map(c => `${fmtNum(u.salasPorCapacidade[c])} ${CAPACIDADE_LABEL_CURTO[c]}`)
    .join(" · ")
  const maxTerapia = u.terapias[0]?.sessoes ?? 1
  const tempoIntegral = Math.round(u.contagem.vazia / HORARIOS_TEMPO_INTEGRAL_SEMANA)

  return (
    <Drawer
      title={u.unidade}
      subtitle={<span className="text-sm">{plural(u.salasTotal, "sala", "salas")} ({status}) · {periodo}</span>}
      width={580}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <Link href="/relacionamento-prestador/ocupacao-salas" className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted">
            Abrir na Ocupação de Salas
          </Link>
          {(["Manhã", "Tarde"] as const).map(t => (
            <button key={t} type="button" onClick={() => onAuditoria(t)} className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted">
              Lista completa · {t}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-7 pb-2">
        <div className="flex flex-col gap-4">
          <ParDeNumeros contagem={u.contagem} />
          <BarraCapacidade contagem={u.contagem} tamanho="lg" />
          <LegendaCapacidade contagem={u.contagem} />
        </div>

        <Secao titulo="Manhã e tarde">
          <div className="flex flex-col gap-3">
            {(["Manhã", "Tarde"] as const).map(t => {
              const c = u.porTurno[t]
              return (
                <div key={t} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3">
                  <span className="text-sm font-bold text-foreground">{t}</span>
                  <div className="flex flex-col gap-1">
                    <BarraCapacidade contagem={c} chave={false} />
                    <span className="text-sm text-muted-foreground">
                      <b className="text-foreground">{fmtPct(pctComPaciente(c))}</b> com paciente · <b className="text-foreground">{fmtPct(pctComProfissional(c))}</b> com profissional
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Secao>

        <Secao titulo="Semana">
          <MapaSemana unidade={u} detalhado />
        </Secao>

        <Secao titulo="Onde está a folga">
          <div className="flex flex-col gap-2">
            <ListaSituacao situacao="aberta" itens={u.pendencias.aberta} total={u.contagem.aberta} />
            <ListaSituacao situacao="administrativo" itens={u.pendencias.administrativo} total={u.contagem.administrativo} />
            <ListaSituacao situacao="regularizar" itens={u.pendencias.regularizar} total={u.contagem.regularizar} />
            <Gaveta
              marca={<span className={`h-3 w-3 rounded-[3px] ${SITUACAO.regularizar.cor}`} />}
              titulo="Sessões fora do mapa"
              descricao="Atende na unidade, mas não está alocado em nenhuma sala naquele dia, turno e horário."
              total={u.foraDoMapa.sessoes}
              unidadeTotal="sessões"
            >
              <Pessoas itens={u.foraDoMapa.profissionais} unidade="sessão" unidades="sessões" />
            </Gaveta>
            <Gaveta
              marca={<span className={`h-3 w-3 rounded-[3px] ${SITUACAO.vazia.cor}`} />}
              titulo={SITUACAO.vazia.rotulo}
              descricao={`${SITUACAO.vazia.descricao} Dá ≈ ${plural(tempoIntegral, "profissional", "profissionais")} em tempo integral (${HORARIOS_TEMPO_INTEGRAL_SEMANA} horários por semana cada).`}
              total={u.contagem.vazia}
              unidadeTotal="horários"
            >
              <ul className="flex flex-col gap-2">
                {u.porSala.filter(s => s.contagem.total > s.contagem.paciente).slice(0, 10).map(s => (
                  <li key={s.salaId} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                    <span className="truncate font-semibold text-foreground" title={s.sala}>{s.sala}</span>
                    <BarraCapacidade contagem={s.contagem} chave={false} />
                    <span className="text-right tabular-nums text-muted-foreground">{fmtPct(pctComPaciente(s.contagem))}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Salas com menos paciente primeiro. O número é o % com paciente da sala.</p>
            </Gaveta>
          </div>
        </Secao>

        <Secao titulo="Salas">
          <p className="text-sm text-foreground">{status}</p>
          {capacidades && <p className="text-sm text-muted-foreground">Capacidade: {capacidades} · {plural(u.cadeiras, "cadeira", "cadeiras")}</p>}
          {u.inconsistencias > 0 && (
            <p className="mt-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
              {plural(u.inconsistencias, "conflito", "conflitos")} de sala: mais profissionais que a capacidade ou terapia fora da sala exclusiva.
            </p>
          )}
        </Secao>

        {u.terapias.length > 0 && (
          <Secao titulo="Terapias com paciente nas salas">
            <ul className="flex flex-col gap-1.5">
              {u.terapias.slice(0, 8).map(t => (
                <li key={t.terapia} className="grid grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-foreground" title={t.terapia}>{t.terapia}</span>
                  <span className="h-2 overflow-hidden rounded bg-muted"><span className={`block h-full ${SITUACAO.aberta.cor}`} style={{ width: `${(t.sessoes / maxTerapia) * 100}%` }} /></span>
                  <span className="text-right tabular-nums text-muted-foreground">{fmtNum(t.sessoes)}</span>
                </li>
              ))}
            </ul>
          </Secao>
        )}
      </div>
    </Drawer>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function ListaSituacao({ situacao, itens, total }: { situacao: Exclude<SituacaoCadeira, "paciente" | "vazia">; itens: PendenciaProfissional[]; total: number }) {
  const info = SITUACAO[situacao]
  return (
    <Gaveta
      marca={<span className={`h-3 w-3 rounded-[3px] ${info.cor}`} />}
      titulo={info.rotulo}
      descricao={`${info.descricao} ${info.acao}`}
      total={total}
      unidadeTotal="horários"
    >
      <Pessoas itens={itens} unidade="horário" unidades="horários" />
    </Gaveta>
  )
}

/** Uma situação recolhível: cabeçalho com o total, lista ao abrir. */
function Gaveta({ marca, titulo, descricao, total, unidadeTotal, children }: {
  marca: ReactNode
  titulo: string
  descricao: string
  total: number
  unidadeTotal: string
  children: ReactNode
}) {
  if (total === 0) return null
  return (
    <details className="group rounded-xl border border-border">
      <summary className="grid cursor-pointer list-none grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className="mt-1.5" aria-hidden>{marca}</span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">{titulo}</span>
          <span className="block text-sm text-muted-foreground">{descricao}</span>
        </span>
        <span className="text-right">
          <span className="block font-black tabular-nums text-foreground">{fmtNum(total)}</span>
          <span className="block text-xs text-muted-foreground">{unidadeTotal}</span>
          <span className="block text-xs font-semibold text-sky-700 group-open:hidden dark:text-sky-400">ver quem</span>
        </span>
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  )
}

function Pessoas({ itens, unidade, unidades }: { itens: PendenciaProfissional[]; unidade: string; unidades: string }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {itens.map(p => (
        <li key={p.profissional} className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
          <span className="min-w-0">
            <span className="block font-semibold text-foreground">{p.profissional}</span>
            <span className="block text-muted-foreground">{[p.terapia, p.salas.join(", ")].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{plural(p.horarios, unidade, unidades)}</span>
        </li>
      ))}
    </ul>
  )
}
