"use client"

import type { ReactNode } from "react"
import { History, Pencil, UserCheck, UserMinus, X } from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { SalvarTudoBar } from "@/components/cadastros/shared/SalvarTudoBar"
import type { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { formatarCelular, registroCompleto } from "@/lib/cadastros/profissionais"
import { idExibicaoProfissional, type Profissional, type ProfissionalArquivos } from "@/types/profissional"
import { TrocarFotoAvatar } from "./imagens"
import { AvatarProfissional } from "./pecas"

// Cartão de identidade da ficha do profissional — o mesmo desenho do
// PacienteHeaderCard (design padrão do Pulsar): avatar, nome, linha de dados,
// selos de situação e as ações Histórico · Inativar/Reativar · Editar.

export type ItemResumo = { rotulo: string; valor: ReactNode; apoio?: string }

export function ProfissionalHeaderCard({
  prof,
  focal,
  cor,
  seloGrade,
  resumo,
  editando,
  salvando,
  dirtyCount,
  alternandoAtivo,
  onEditar,
  onCancelar,
  onSalvar,
  onVerHistorico,
  onAlterarSituacao,
  gravarFoto,
  confirmar,
}: {
  prof: Profissional
  /** Ícone da terapia que pinta o avatar (null = estrelinhas). */
  focal: { icone: string | null; terapiaId: number | null } | null
  cor: string
  seloGrade: ReactNode
  resumo: ItemResumo[]
  editando: boolean
  salvando: boolean
  dirtyCount: number
  alternandoAtivo: boolean
  onEditar: () => void
  onCancelar: () => void
  onSalvar: () => void
  onVerHistorico: () => void
  onAlterarSituacao: () => void
  gravarFoto: (patch: Partial<ProfissionalArquivos>) => Promise<boolean>
  confirmar: ReturnType<typeof useConfirmacao>["confirmar"]
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <TrocarFotoAvatar prof={prof} gravar={gravarFoto} confirmar={confirmar}>
          <AvatarProfissional
            icone={focal?.icone ?? null}
            fotoPath={prof.foto_path}
            cor={focal?.terapiaId != null ? cor : null}
            inativo={!prof.ativo}
          />
        </TrocarFotoAvatar>

        <div className="min-w-0 flex-1">
          {/* Nome inteiro, quebrando linha — nunca cortado. */}
          <h1 className="break-words text-lg font-semibold text-foreground">{prof.nome}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-xs uppercase tracking-wide">ID</span>{" "}
              <span className="font-mono text-base font-semibold text-foreground">{idExibicaoProfissional(prof)}</span>
            </span>
            <span>{registroCompleto(prof) ?? "Sem registro profissional"}</span>
            {prof.cbo && <span>CBO {prof.cbo}</span>}
            {prof.celular && <span className="tabular-nums">{formatarCelular(prof.celular)}</span>}
            {prof.ativo ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-[var(--status-ok)]">Ativo</span>
            ) : (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">Inativo</span>
            )}
            {seloGrade}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onVerHistorico}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted sm:min-h-0 ${foco}`}
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Histórico
          </button>

          {/* Inativar é AÇÃO, não campo: fica fora do formulário. Durante a
              edição fica bloqueado para não misturar as duas gravações. */}
          <button
            type="button"
            onClick={onAlterarSituacao}
            disabled={alternandoAtivo || editando}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50 sm:min-h-0 ${foco} ${
              prof.ativo ? "text-rose-600 dark:text-rose-400" : "text-[var(--status-ok)]"
            }`}
          >
            {prof.ativo ? (
              <>
                <UserMinus className="h-4 w-4" aria-hidden="true" />
                Inativar
              </>
            ) : (
              <>
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                Reativar
              </>
            )}
          </button>

          {editando ? (
            <button
              type="button"
              onClick={onCancelar}
              disabled={salvando}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60 sm:min-h-0 ${foco}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              onClick={onEditar}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-0 ${foco}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </button>
          )}
        </div>
      </div>

      {editando && (
        <div className="mt-3 border-t border-border pt-3">
          <SalvarTudoBar dirtyCount={dirtyCount} saving={salvando} onSave={onSalvar} />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 md:grid-cols-4">
        {resumo.map(r => (
          <div key={r.rotulo} className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.rotulo}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{r.valor}</dd>
            {r.apoio && <dd className="text-xs text-muted-foreground">{r.apoio}</dd>}
          </div>
        ))}
      </dl>
    </div>
  )
}
