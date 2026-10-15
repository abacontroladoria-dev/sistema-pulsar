"use client"

// Detalhe de um paciente do Painel de Entrada. De cima para baixo: o que falta
// agora (com o botão para a tarefa certa do ClickUp), o caminho pelas etapas
// 0 a 7, disponibilidade, registros a corrigir, datas e os demais links.
// Painel lateral para a lista continuar visível atrás (no celular vira tela cheia).

import Link from "next/link"
import { AlertTriangle, Check, ExternalLink } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import {
  AVISO_INICIO_DO_NOME,
  ETAPAS_DISPONIBILIDADE,
  ROTULO_DISPONIBILIDADE,
  caminhoDoPaciente,
  envioDoLinkDisponibilidade,
  fmtDiaMes,
  linkDaEtapa,
  linksDoPaciente,
  proximaAcao,
  responsavelDo,
  textoPrazo,
  textosDosAlertas,
  type DisponibilidadePainel,
  type EstadoPasso,
  type EtapaResumo,
  type PacienteEmAndamento,
  type PacienteEntrada,
  type PassoCaminho,
} from "@/lib/indicadores/entradaConvenio"
import { BotaoCopiarMensagem, PilulaPrazo, SeloDisponibilidade } from "./comum"

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium tabular-nums text-foreground">{valor}</span>
    </div>
  )
}

// ─── O que falta agora ───────────────────────────────────────────────────────

function OQueFalta({ p }: { p: PacienteEmAndamento }) {
  const a = p.atual
  const acao = proximaAcao(p)
  const prazo = textoPrazo(a)
  const resp = responsavelDo(a.setor)
  const link = linkDaEtapa(p)
  const moldura = prazo.tom === "red" ? "border-rose-300 dark:border-rose-900" : prazo.tom === "amber" ? "border-amber-300 dark:border-amber-900" : "border-border"

  return (
    <Bloco titulo="O que falta agora">
      <div className={`flex flex-col gap-2 rounded-xl border p-3 ${moldura} ${TONE_SOFT[prazo.tom].bg}`}>
        <div className="flex flex-wrap items-center gap-2">
          <PilulaPrazo prazo={a} dense={false} />
          <span className="text-xs text-muted-foreground">{prazo.dica}</span>
        </div>
        <p className="text-base font-bold leading-snug text-foreground">
          {acao.travado && <span className={TONE_SOFT.amber.text}>Travado: </span>}
          {acao.texto}
        </p>
        {acao.travado && <p className="-mt-1 text-xs text-muted-foreground">Etapa: {a.nome}</p>}
        <p className="text-sm text-foreground">
          Com <b>{a.setor}</b>{resp.pessoas ? <>: {resp.pessoas}</> : null}
        </p>
        {a.obs && <p className="text-xs text-muted-foreground">{a.obs}</p>}
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-lg bg-sky-700 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 dark:bg-sky-600 dark:hover:bg-sky-700"
          >
            <ExternalLink size={13} aria-hidden />
            Abrir no ClickUp ({link.rotulo})
          </a>
        )}
      </div>
    </Bloco>
  )
}

// ─── Caminho E0 → E7 ─────────────────────────────────────────────────────────

const MARCA: Record<EstadoPasso, { classe: string; feito: boolean; rotulo: string }> = {
  feito: { classe: "bg-emerald-500 text-white", feito: true, rotulo: "Feita no prazo" },
  feito_atrasado: { classe: "bg-rose-500 text-white", feito: true, rotulo: "Feita fora do prazo" },
  feito_fora_de_ordem: { classe: "bg-violet-500 text-white", feito: true, rotulo: "Feita com datas fora de ordem" },
  feito_sem_data: { classe: "bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100", feito: true, rotulo: "Feita sem data" },
  atual: { classe: "bg-card ring-4 ring-sky-500/30 border-2 border-sky-600", feito: false, rotulo: "Etapa atual" },
  a_fazer: { classe: "bg-card border-2 border-border", feito: false, rotulo: "A fazer" },
}

function descricaoPasso(s: PassoCaminho): string {
  const prazo = s.dias != null ? `${s.dias} de ${s.prazo} dias úteis` : null
  switch (s.estado) {
    case "atual":
      return ["Agora", prazo].filter(Boolean).join(" · ")
    case "a_fazer":
      return "A fazer"
    case "feito_sem_data":
      return s.nota ?? "Feita sem data"
    default:
      return [
        `Fim ${fmtDiaMes(s.fim)}`,
        prazo,
        s.estado === "feito_atrasado" ? "fora do prazo" : s.estado === "feito_fora_de_ordem" ? "datas fora de ordem" : null,
      ].filter(Boolean).join(" · ")
  }
}

function Caminho({ passos }: { passos: PassoCaminho[] }) {
  return (
    <ol className="ml-2 border-l border-border">
      {passos.map(s => {
        const m = MARCA[s.estado]
        return (
          <li key={s.etapa} className="relative pb-3 pl-5 last:pb-0">
            <span
              aria-hidden
              className={`absolute -left-[9px] top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full ${m.classe}`}
            >
              {m.feito && <Check size={11} strokeWidth={3} />}
            </span>
            <div className={`text-sm leading-tight ${s.estado === "atual" ? "font-bold text-foreground" : s.estado === "a_fazer" ? "text-muted-foreground" : "font-medium text-foreground"}`}>
              <span className="sr-only">{m.rotulo}: </span>
              {s.nome}
            </div>
            <div className={`text-[11px] ${s.estado === "feito_atrasado" ? TONE_SOFT.red.text : "text-muted-foreground"}`}>
              {descricaoPasso(s)}
            </div>
            {s.nota && s.estado !== "feito_sem_data" && <div className="text-[11px] text-muted-foreground">{s.nota}</div>}
          </li>
        )
      })}
    </ol>
  )
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function PacienteEntradaDrawer({ paciente: p, disp, etapas, onClose }: {
  paciente: PacienteEntrada
  disp: DisponibilidadePainel | undefined
  etapas: EtapaResumo[]
  onClose: () => void
}) {
  const a = p.atual
  const andamento: PacienteEmAndamento | null = p.situacao === "em andamento" && a ? { ...p, atual: a } : null
  const principal = andamento ? linkDaEtapa(andamento) : null
  const outrosLinks = linksDoPaciente(p).filter(l => l.chave !== principal?.chave)
  const avisos = textosDosAlertas(p)
  const envio = envioDoLinkDisponibilidade(disp)
  const subtitulo = [
    p.convenio,
    p.tipo === "Neuro" ? "Avaliação neuro" : "Terapias",
    `via ${p.rota === "Família" ? "família" : "convênio"}`,
  ].join(" · ")

  return (
    <Drawer title={p.paciente} subtitle={subtitulo} width={460} onClose={onClose}>
      {andamento ? (
        <OQueFalta p={andamento} />
      ) : (
        <Bloco titulo="Situação">
          <p className="text-sm text-foreground">
            {p.situacao === "encerrado"
              ? `Encerrado${p.encerrado ? ` em ${fmtDiaMes(p.encerrado.data)}: ${p.encerrado.motivo}` : ""}`
              : p.tipo === "Neuro"
                ? "Avaliação realizada."
                : `Tratamento iniciado em ${fmtDiaMes(p.inicio)}.`}
          </p>
          {p.total_uteis != null && (
            <p className="mt-1 text-xs text-muted-foreground">Da entrada ao início: {p.total_uteis} dias úteis.</p>
          )}
        </Bloco>
      )}

      {etapas.length > 0 && (
        <Bloco titulo="Caminho do paciente">
          <Caminho passos={caminhoDoPaciente(p, etapas)} />
        </Bloco>
      )}

      <Bloco titulo="Disponibilidade da família">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SeloDisponibilidade disp={disp} dense={false} />
            {disp?.preenchida_em && (
              <span className="text-xs text-muted-foreground">em {fmtDiaMes(disp.preenchida_em.slice(0, 10))}</span>
            )}
          </div>
          {/* Bloqueado: o aviso "Ainda não mande o link" abaixo já explica o motivo. */}
          {disp && !envio.bloqueio && <p className="text-xs text-muted-foreground">{ROTULO_DISPONIBILIDADE[disp.estado].dica}</p>}
          {disp?.casamento === "inicio_do_nome" && (
            <p className={`text-xs font-semibold ${TONE_SOFT.amber.text}`}>{AVISO_INICIO_DO_NOME}</p>
          )}
          {(!a || ETAPAS_DISPONIBILIDADE.has(a.etapa)) && (
            envio.pode ? (
              <div className="flex flex-wrap gap-2">
                <BotaoCopiarMensagem pacienteNome={p.paciente} rotulo="Copiar mensagem para a família" />
              </div>
            ) : envio.bloqueio && envio.motivo ? (
              <p className={`flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold ${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text}`}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span>Ainda não mande o link. {envio.motivo}</span>
              </p>
            ) : null
          )}
          {disp?.paciente_id != null && (
            <Link
              href={`/cadastros/pacientes/${disp.paciente_id}`}
              className="text-xs font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
            >
              Abrir o cadastro do paciente
            </Link>
          )}
        </div>
      </Bloco>

      {avisos.length > 0 && (
        <Bloco titulo="Registros a corrigir no ClickUp">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
            {avisos.map((al, i) => <li key={i}>{al}</li>)}
          </ul>
        </Bloco>
      )}

      <Bloco titulo="Datas">
        <Linha rotulo="Entrada do pedido" valor={fmtDiaMes(p.entrada)} />
        <Linha rotulo="Formulário aberto" valor={p.aberto ? fmtDiaMes(p.aberto) : "sem formulário"} />
        <Linha rotulo="Cronograma aprovado" valor={fmtDiaMes(p.apresentacao)} />
        <Linha rotulo="Início combinado" valor={fmtDiaMes(p.inicio_previsto)} />
        <Linha rotulo="1ª sessão" valor={fmtDiaMes(p.inicio)} />
        {p.dias_desde_entrada != null && <Linha rotulo="Dias úteis desde a entrada" valor={p.dias_desde_entrada} />}
      </Bloco>

      {outrosLinks.length > 0 && (
        <Bloco titulo={principal ? "Outras tarefas no ClickUp" : "ClickUp"}>
          <div className="flex flex-wrap gap-2">
            {outrosLinks.map(l => (
              <a
                key={l.chave}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted sm:min-h-0 sm:py-1.5"
              >
                <ExternalLink size={12} aria-hidden /> {l.rotulo}
                <span className="font-mono font-normal text-muted-foreground">{l.id}</span>
              </a>
            ))}
          </div>
        </Bloco>
      )}
    </Drawer>
  )
}
