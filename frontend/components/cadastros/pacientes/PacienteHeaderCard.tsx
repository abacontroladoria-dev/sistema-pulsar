"use client"

import { Pencil, X, History, UserMinus, UserCheck } from "lucide-react"
import { idExibicao } from "@/types/paciente"
import type { Paciente } from "@/types/paciente"
import { SalvarTudoBar } from "@/components/cadastros/shared/SalvarTudoBar"
import { FotoPacienteUpload } from "./FotoPacienteUpload"
import { foco } from "./ui/campos"

function dataNascimentoBR(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano}`
}

// Idade calculada em relação a HOJE, não à data de nascimento sozinha — por
// isso o mês/dia atual entram na conta, não só a diferença de anos.
function calcularIdade(iso: string | null): number | null {
  if (!iso) return null
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number)
  const hoje = new Date()
  let idade = hoje.getFullYear() - ano
  const aniversarioJaPassou =
    hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia)
  if (!aniversarioJaPassou) idade -= 1
  return idade
}

export function PacienteHeaderCard({
  paciente,
  editando,
  salvando,
  dirtyCount,
  onEditar,
  onCancelar,
  onSalvar,
  onFotoAlterada,
  onVerHistorico,
  onAlterarSituacao,
  temAltaClinica,
}: {
  paciente: Paciente
  editando: boolean
  salvando: boolean
  dirtyCount: number
  onEditar: () => void
  onCancelar: () => void
  onSalvar: () => void
  onFotoAlterada: (path: string | null) => void
  onVerHistorico: () => void
  onAlterarSituacao: () => void
  /** Há alta clínica vigente (encerrou todas as terapias) — independe de ativo/inativo. */
  temAltaClinica: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <FotoPacienteUpload
          idPaciente={paciente.id_paciente}
          fotoPath={paciente.foto_path}
          nome={paciente.nome}
          podeEditar={editando}
          onFotoAlterada={onFotoAlterada}
        />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground">{paciente.nome}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-xs uppercase tracking-wide">ID</span>{" "}
              <span className="font-mono text-base font-semibold text-foreground">
                {idExibicao(paciente)}
              </span>
            </span>
            <span>
              {dataNascimentoBR(paciente.data_nascimento)}
              {calcularIdade(paciente.data_nascimento) !== null && (
                <> ({calcularIdade(paciente.data_nascimento)} anos)</>
              )}
            </span>
            {paciente.falecido && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                Falecido
              </span>
            )}
            {!paciente.falecido && !paciente.ativo && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                Inativo
              </span>
            )}
            {!paciente.falecido && paciente.ativo && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Ativo
              </span>
            )}
            {temAltaClinica && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                Alta clínica
              </span>
            )}
            {paciente.ficticio && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                Fictício
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onVerHistorico}
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Histórico
          </button>

          {/* Inativar é AÇÃO, não campo: fica fora do formulário e não depende
              do modo de edição. */}
          <button
            type="button"
            onClick={onAlterarSituacao}
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted ${foco} ${
              paciente.ativo ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {paciente.ativo ? (
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
              className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60 ${foco}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              onClick={onEditar}
              className={`inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${foco}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </button>
          )}
        </div>
      </div>

      {/* O contador é global às duas abas: o estado do formulário mora acima
          delas, então editar em "Dados pessoais" e em "Ficha médica" soma. */}
      {editando && (
        <div className="mt-3 border-t border-border pt-3">
          <SalvarTudoBar dirtyCount={dirtyCount} saving={salvando} onSave={onSalvar} />
        </div>
      )}
    </div>
  )
}
