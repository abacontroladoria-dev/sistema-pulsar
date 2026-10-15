"use client"

// PainelUnidade — o detalhe de uma unidade num painel lateral (Drawer): a barra
// com a legenda, manhã × tarde, o mapa com os dois números, o que dá para
// fazer com cada folga (com os nomes) e o que antes ficava espremido no
// cartão (salas por tipo, terapias). "Lista completa" abre o modal de
// auditoria horário a horário por cima, sem fechar o painel.

import Link from "next/link"
import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/useModalLayer"
import {
  HORARIOS_TEMPO_INTEGRAL_SEMANA,
  pctComPaciente,
  pctComProfissional,
  type FechamentoDia,
  type OcupacaoClinicaUnidade,
  type PendenciaProfissional,
  type TurnoClinica,
} from "@/lib/cronograma/ocupacaoClinica"
import { BarraCapacidade, LegendaCapacidade } from "./BarraCapacidade"
import { ParDeNumeros } from "./CartaoUnidade"
import { MapaSemana } from "./MapaSemana"
import { LINK_REGULARIZACOES, SITUACAO, fmtNum, fmtPct, plural } from "./visual"

const TIPO_SALA = { unico: ["individual", "individuais"], duplo: ["dupla", "duplas"], multiplo: ["múltipla", "múltiplas"] } as const

interface Props {
  unidade: OcupacaoClinicaUnidade
  periodo: string
  fechamentos: FechamentoDia[]
  rotuloStatus: (codigo: string) => string
  onAuditoria: (turno: TurnoClinica) => void
  onClose: () => void
}

export function PainelUnidade({ unidade: u, periodo, fechamentos, rotuloStatus, onAuditoria, onClose }: Props) {
  const status = [
    `${fmtNum(u.salasOperacionais)} em uso`,
    ...Object.entries(u.porStatus).map(([codigo, n]) => `${fmtNum(n)} ${rotuloStatus(codigo)}`),
  ].join(" · ")
  const tipos = (["unico", "duplo", "multiplo"] as const)
    .filter(c => u.salasPorCapacidade[c] > 0)
    .map(c => `${fmtNum(u.salasPorCapacidade[c])} ${TIPO_SALA[c][u.salasPorCapacidade[c] === 1 ? 0 : 1]}`)
    .join(" · ")
  const maxTerapia = u.terapias[0]?.sessoes ?? 1
  const tempoIntegral = Math.round(u.contagem.vazia / HORARIOS_TEMPO_INTEGRAL_SEMANA)
  const { semAgendaNoTurno, foraDoHorario } = u.pendencias.regularizar
  const temAjuste = semAgendaNoTurno.length > 0 || u.semSalaDefinida.sessoes > 0

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
          <LegendaCapacidade contagem={u.contagem} camadaExplicacao={Z_MODAL_EMPILHADO} />
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
          <MapaSemana unidade={u} fechamentos={fechamentos} detalhado />
        </Secao>

        <Secao titulo="O que fazer com a folga">
          <div className="flex flex-col gap-2">
            <Gaveta cor={SITUACAO.aberta.cor} titulo="Livre para agendar" total={plural(u.contagem.aberta, "vaga", "vagas")}
              texto="O profissional já está na sala com horário livre no TiTa, ainda sem paciente. Dá para agendar paciente novo nesses horários."
              vazia={u.pendencias.aberta.length === 0}>
              <Pessoas itens={u.pendencias.aberta} unidade="vaga" unidades="vagas" />
            </Gaveta>
            <Gaveta cor={SITUACAO.administrativo.cor} titulo="Administrativo" total={plural(u.contagem.administrativo, "vaga", "vagas")}
              texto="O profissional ocupa a sala em horário administrativo ou bloqueado no TiTa. Vale conferir se esse horário precisa mesmo ser dentro da sala."
              vazia={u.pendencias.administrativo.length === 0}>
              <Pessoas itens={u.pendencias.administrativo} unidade="vaga" unidades="vagas" />
            </Gaveta>
            <Gaveta cor={SITUACAO.regularizar.cor} titulo="Atende só parte do turno" total={plural(u.regularizarPorMotivo.foraDoHorario, "vaga", "vagas")}
              texto="A pessoa tem a sala reservada no turno todo, mas a agenda dela no TiTa é menor: a sala fica parada nos horários que sobram. Dá para ampliar a agenda dela ou usar a sala com outro profissional nesses horários."
              vazia={foraDoHorario.length === 0}>
              <Pessoas itens={foraDoHorario} unidade="vaga" unidades="vagas" />
            </Gaveta>
            <Gaveta cor={SITUACAO.vazia.cor} titulo="Sem profissional" total={plural(u.contagem.vazia, "vaga", "vagas")}
              texto={`Ninguém reservado na sala. Esse espaço comporta cerca de ${plural(tempoIntegral, "profissional", "profissionais")} em tempo integral (${HORARIOS_TEMPO_INTEGRAL_SEMANA} vagas por semana cada). Salas mais vazias:`}
              vazia={u.contagem.vazia === 0}>
              <ul className="flex flex-col gap-2">
                {u.porSala.filter(s => s.contagem.total > s.contagem.paciente).slice(0, 10).map(s => (
                  <li key={s.salaId} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                    <span className="truncate font-semibold text-foreground" title={s.sala}>{s.sala}</span>
                    <BarraCapacidade contagem={s.contagem} chave={false} />
                    <span className="text-right tabular-nums text-muted-foreground">{fmtPct(pctComPaciente(s.contagem))} com paciente</span>
                  </li>
                ))}
              </ul>
            </Gaveta>
          </div>
        </Secao>

        {temAjuste && (
          <Secao titulo="Ajustar o mapa de salas">
            <p className="text-sm text-muted-foreground">
              Enquanto isso não for corrigido, a ocupação desta unidade fica errada. Os dois casos se resolvem na tela de Regularizações da Ocupação de Salas.
            </p>
            <div className="flex flex-col gap-2">
              <Gaveta cor={SITUACAO.regularizar.cor} titulo="Reservada sem nenhuma agenda no turno" total={plural(semAgendaNoTurno.length, "pessoa", "pessoas")}
                texto="A pessoa tem sala reservada, mas não tem nada no TiTa no turno inteiro. Se ela não atende mais nesse turno, tire a reserva e a sala volta a ficar disponível. Se atende, falta abrir a agenda dela no TiTa."
                vazia={semAgendaNoTurno.length === 0}>
                <Pessoas itens={semAgendaNoTurno} unidade="vaga" unidades="vagas" />
              </Gaveta>
              <Gaveta cor={SITUACAO.regularizar.cor} titulo="Atende sem sala definida" total={plural(u.semSalaDefinida.profissionais.length, "pessoa", "pessoas")}
                texto={`A pessoa tem paciente na unidade, mas não está reservada em nenhuma sala nesse horário: ${plural(u.semSalaDefinida.sessoes, "sessão fica", "sessões ficam")} fora da conta. Reserve a sala em que ela atende.`}
                vazia={u.semSalaDefinida.profissionais.length === 0}>
                <Pessoas itens={u.semSalaDefinida.profissionais} unidade="sessão" unidades="sessões" />
              </Gaveta>
            </div>
            <Link href={LINK_REGULARIZACOES} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-lg bg-[#2B5E86] px-4 text-sm font-bold text-white hover:bg-[#24506F]">
              Ajustar em Regularizações <ExternalLink size={14} aria-hidden /><span className="sr-only">(abre em outra guia)</span>
            </Link>
          </Secao>
        )}

        <Secao titulo="Salas">
          <p className="text-sm text-foreground">{status}</p>
          {tipos && <p className="text-sm text-muted-foreground">{tipos} · cabem até {plural(u.atendimentosSimultaneos, "profissional", "profissionais")} atendendo ao mesmo tempo</p>}
          {u.inconsistencias > 0 && (
            <p className="mt-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
              {plural(u.inconsistencias, "sala tem", "salas têm")} conflito em algum turno: mais pessoas reservadas do que cabem, ou terapia fora da sala exclusiva dela.
            </p>
          )}
        </Secao>

        {u.terapias.length > 0 && (
          <Secao titulo="Terapias com paciente nas salas (sessões)">
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

/** Uma situação recolhível: o que é e o que fazer no cabeçalho, nomes ao abrir. */
function Gaveta({ cor, titulo, total, texto, vazia, children }: {
  cor: string
  titulo: string
  total: string
  texto: string
  vazia: boolean
  children: ReactNode
}) {
  if (vazia) return null
  return (
    <details className="group rounded-xl border border-border">
      <summary className="grid cursor-pointer list-none grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className={`mt-1.5 h-3 w-3 rounded-[3px] ${cor}`} aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">{titulo}</span>
          <span className="block text-sm text-muted-foreground">{texto}</span>
        </span>
        <span className="text-right">
          <span className="block whitespace-nowrap font-black tabular-nums text-foreground">{total}</span>
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
            {p.turnos.length > 0 && <span className="block text-muted-foreground">{p.turnos.join(", ")}</span>}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{plural(p.horarios, unidade, unidades)}</span>
        </li>
      ))}
    </ul>
  )
}
