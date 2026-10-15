"use client"

// Detalhe de um paciente do Painel de Entrada: etapa atual, disponibilidade,
// histórico por etapa, datas e links do ClickUp. Painel lateral para a lista
// continuar visível atrás (no celular vira tela cheia).

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import {
  AVISO_INICIO_DO_NOME,
  ETAPAS_DISPONIBILIDADE,
  ROTULO_DISPONIBILIDADE,
  fmtDiaMes,
  linksDoPaciente,
  type DisponibilidadePainel,
  type PacienteEntrada,
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

export function PacienteEntradaDrawer({ paciente: p, disp, onClose }: {
  paciente: PacienteEntrada
  disp: DisponibilidadePainel | undefined
  onClose: () => void
}) {
  const a = p.atual
  const links = linksDoPaciente(p)
  const subtitulo = [
    p.convenio,
    p.tipo === "Neuro" ? "Avaliação neuro" : "Terapias",
    `via ${p.rota === "Família" ? "família" : "convênio"}`,
  ].join(" · ")

  return (
    <Drawer title={p.paciente} subtitle={subtitulo} width={460} onClose={onClose}>
      {a ? (
        <Bloco titulo="Etapa atual">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-foreground">{a.nome}</span>
              <PilulaPrazo status={a.status} dense={false} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {a.setor} · <span className="tabular-nums">{a.dias ?? "—"} de {a.prazo} d.u.</span>
            </div>
            {a.pendencia && <p className="mt-2 text-sm font-semibold text-foreground">{a.pendencia}</p>}
            {a.obs && <p className="mt-1 text-xs text-muted-foreground">{a.obs}</p>}
            {a.sem_registro && a.sem_registro.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Sem data registrada: {a.sem_registro.join(", ").toLowerCase()}
              </p>
            )}
          </div>
        </Bloco>
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
            <p className="mt-1 text-xs text-muted-foreground">Entrada → início: {p.total_uteis} dias úteis.</p>
          )}
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
          {disp && <p className="text-xs text-muted-foreground">{ROTULO_DISPONIBILIDADE[disp.estado].dica}</p>}
          {disp?.casamento === "inicio_do_nome" && (
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{AVISO_INICIO_DO_NOME}</p>
          )}
          {(!a || ETAPAS_DISPONIBILIDADE.has(a.etapa)) && disp?.estado !== "preenchida_familia" && (
            <div className="flex flex-wrap gap-2">
              <BotaoCopiarMensagem pacienteNome={p.paciente} rotulo="Copiar mensagem para a família" />
            </div>
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

      {p.historico.length > 0 && (
        <Bloco titulo="Etapas concluídas">
          <ol className="flex flex-col gap-1.5">
            {p.historico.map(h => (
              <li key={`${h.etapa}-${h.fim}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{h.nome}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {h.setor} · fim {fmtDiaMes(h.fim)} ·{" "}
                    <span className="tabular-nums">{h.dias ?? "—"} de {h.prazo} d.u.</span>
                    {h.combinado && " · etapas sem data no meio"}
                  </div>
                </div>
                <PilulaPrazo status={h.status} />
              </li>
            ))}
          </ol>
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

      {(p.alertas ?? []).length > 0 && (
        <Bloco titulo="Registro a corrigir">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
            {(p.alertas ?? []).map((al, i) => <li key={i}>{al}</li>)}
          </ul>
        </Bloco>
      )}

      {links.length > 0 && (
        <Bloco titulo="ClickUp">
          <div className="flex flex-wrap gap-2">
            {links.map(l => (
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
