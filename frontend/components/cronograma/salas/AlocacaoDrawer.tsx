"use client"

// AlocacaoDrawer — o detalhe de UMA alocação, sem tirar a grade da tela.
//
// Só APRESENTA: todo campo aqui já existe em `AlocacaoCardSlot`/`SlotOcupacaoSala`
// (ver salasTypes.ts). Editar, mover e excluir continuam no AlocarSessaoModal,
// que abre por cima (Z_MODAL_EMPILHADO) com o drawer montado atrás — não há uma
// segunda implementação dessas ações para divergir da primeira.
//
// O que o drawer NÃO mostra: nome de paciente. `BlocoOcupacaoSlot` carrega o
// `idAgendamento`, não o paciente — exibir "paciente" aqui exigiria inventar o
// dado ou buscar no backend, e este trabalho é de apresentação.

import { Drawer } from "@/components/cronograma/ui/Drawer"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { tCor } from "@/lib/cronograma/constants"
import { SITUACAO_LABEL, type AlocacaoNaCelula, type CelulaGradeSala } from "@/lib/cronograma/salasView"
import { SITUACAO_TONE, TERAPIA_MARCA_CLS } from "./salasVocabulario"
import type { Sala } from "@/lib/cronograma/salasTypes"

interface AlocacaoDrawerProps {
  sala: Sala
  celula: CelulaGradeSala
  alocacao: AlocacaoNaCelula
  onEditar: () => void
  onClose: () => void
}

export function AlocacaoDrawer({ sala, celula, alocacao, onEditar, onClose }: AlocacaoDrawerProps) {
  // Os blocos desta pessoa neste turno — o slot já os traz calculados, basta
  // filtrar pelos que são dela e estão preenchidos.
  const blocosDela = (celula.slot?.blocos ?? []).filter(
    b => b.status === "preenchido" && b.profissional === alocacao.profissionalNome,
  )

  return (
    <Drawer
      title={alocacao.profissionalNome}
      subtitle={`${celula.diaLabel} · ${celula.turno} · ${sala.nome_exibicao}`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onEditar}
          className="inline-flex min-h-11 items-center rounded-lg bg-[#2B5E86] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-slate-900"
        >
          Editar alocação
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <StatusPill tone={SITUACAO_TONE[alocacao.situacao]}>
            {SITUACAO_LABEL[alocacao.situacao]}
          </StatusPill>
        </div>

        {alocacao.violacaoExclusividade && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
            {alocacao.violacaoExclusividade.motivo}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Campo rotulo="Especialidade">
            {alocacao.terapiaNome ? (
              <span className="flex items-center gap-1.5">
                <span
                  className={TERAPIA_MARCA_CLS}
                  style={{ background: tCor(alocacao.terapiaNome, true) }}
                  aria-hidden
                />
                {alocacao.terapiaNome}
              </span>
            ) : <span className="text-muted-foreground">Não registrada</span>}
          </Campo>

          <Campo rotulo="Sessões com paciente">
            {alocacao.semCruzamentoCsv
              ? <span className="text-muted-foreground">Sem cruzamento na agenda</span>
              : `${alocacao.sessoesReais} de ${alocacao.sessoesCapacidadeTurno}`}
          </Campo>

          <Campo rotulo="Sala">{sala.nome_exibicao}</Campo>
          <Campo rotulo="Unidade">{sala.unidade_nome}</Campo>
          <Campo rotulo="Dia">{celula.diaLabel}</Campo>
          <Campo rotulo="Turno">{celula.turno}</Campo>
        </dl>

        <div>
          <h4 className="text-xs font-semibold text-foreground">Horários com sessão</h4>
          {blocosDela.length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Nenhuma sessão confirmada neste turno.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {blocosDela.map(b => (
                <li
                  key={`${b.hora}-${b.idAgendamento}`}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium tabular-nums text-foreground">{b.hora}–{b.horaFim}</span>
                  <span className="truncate text-muted-foreground">{b.terapia || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}
