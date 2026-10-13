"use client"

import { useEffect, useState } from "react"
import { X, History, Pencil, UserX, UserCheck } from "lucide-react"
import { maskCpfCnpj } from "@/lib/remuneracao/formatacao"
import { useModalDialog } from "@/hooks/useModalDialog"
import { useResponsaveis } from "@/hooks/useResponsaveis"
import { getVinculosDeResponsaveis, type ContextoPacienteAuditoria } from "@/services/responsaveis.service"
import { TIPOS_VINCULO } from "@/types/responsavel"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { ResponsavelFormModal } from "./ResponsavelFormModal"
import { InativarResponsavelModal } from "./InativarResponsavelModal"
import { CampoSomenteLeitura, foco } from "./ui/campos"

// Substitui a antiga tela /cadastros/responsaveis (apagada): "Ver Cadastro"
// agora expande este painel na própria tela do paciente, em vez de navegar
// pra outro lugar. Lê sempre do hook (nunca de um snapshot passado por
// prop) pra refletir sozinho qualquer Editar/Inativar feito aqui dentro.

function dataBR(iso: string | null): string {
  if (!iso) return ""
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano}`
}

export function ResponsavelPainel({
  responsavelId,
  contextoPaciente,
  onFechar,
}: {
  responsavelId: number
  /** Pro Editar/Inativar feitos aqui caírem no Histórico deste paciente. */
  contextoPaciente?: ContextoPacienteAuditoria
  onFechar: () => void
}) {
  const { responsaveis } = useResponsaveis()
  const responsavel = responsaveis.find((r) => r.id === responsavelId)

  const [pacientes, setPacientes] = useState<{ id_paciente: number; nome: string; tipo: string }[]>([])
  const [carregandoPacientes, setCarregandoPacientes] = useState(true)
  const [editando, setEditando] = useState(false)
  const [inativando, setInativando] = useState(false)
  const [historico, setHistorico] = useState(false)

  const { refDialogo, propsDialogo } = useModalDialog(true, onFechar, "titulo-painel-responsavel")

  useEffect(() => {
    let ativo = true
    setCarregandoPacientes(true)
    getVinculosDeResponsaveis([responsavelId]).then(({ data }) => {
      if (ativo) {
        setPacientes(data.get(responsavelId) ?? [])
        setCarregandoPacientes(false)
      }
    })
    return () => {
      ativo = false
    }
  }, [responsavelId])

  if (!responsavel) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-lg">
          Responsável não encontrado.
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onFechar}
              className={`rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted ${foco}`}
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const endereco = [
    responsavel.logradouro,
    responsavel.numero,
    responsavel.bairro,
    responsavel.cidade,
    responsavel.uf,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          ref={refDialogo}
          {...propsDialogo}
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 id="titulo-painel-responsavel" className="truncate text-base font-semibold text-foreground">
                {responsavel.nome}
              </h2>
              {!responsavel.ativo && (
                <span className="text-xs font-medium text-[var(--status-atencao)]">
                  Inativo
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onFechar}
              className={`shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted ${foco}`}
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2">
            <CampoSomenteLeitura label="CPF" value={responsavel.cpf ? maskCpfCnpj(responsavel.cpf) : ""} />
            <CampoSomenteLeitura label="Data de nascimento" value={dataBR(responsavel.data_nascimento)} />
            <CampoSomenteLeitura
              label="RG"
              value={[responsavel.rg, responsavel.rg_orgao_emissor, responsavel.rg_uf]
                .filter(Boolean)
                .join(" / ")}
            />
            <CampoSomenteLeitura label="Celular" value={responsavel.celular ?? ""} />
            <CampoSomenteLeitura label="Telefone residencial" value={responsavel.telefone_residencial ?? ""} />
            <CampoSomenteLeitura label="E-mail" value={responsavel.email ?? ""} />
            <CampoSomenteLeitura label="Endereço" value={endereco} largo />
          </div>

          <div className="border-t border-border px-4 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pacientes vinculados
            </h3>
            {carregandoPacientes ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : pacientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum outro paciente vinculado.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {pacientes.map((p) => (
                  <li key={`${p.id_paciente}-${p.tipo}`}>
                    <a
                      href={`/cadastros/pacientes/${p.id_paciente}`}
                      className={`text-primary hover:underline ${foco}`}
                    >
                      {p.nome}
                    </a>
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({TIPOS_VINCULO.find((t) => t.tipo === p.tipo)?.rotulo ?? p.tipo})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setHistorico(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted ${foco}`}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Histórico
            </button>
            <button
              type="button"
              onClick={() => setInativando(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${foco} ${
                responsavel.ativo
                  ? "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              }`}
            >
              {responsavel.ativo ? (
                <UserX className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {responsavel.ativo ? "Inativar" : "Reativar"}
            </button>
            <button
              type="button"
              onClick={() => setEditando(true)}
              className={`inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${foco}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Editar
            </button>
          </footer>
        </div>
      </div>

      {/* Montados condicionalmente para nascerem limpos. */}
      {editando && (
        <ResponsavelFormModal
          responsavel={responsavel}
          contextoPaciente={
            contextoPaciente?.pacienteId
              ? { id: contextoPaciente.pacienteId, nome: contextoPaciente.pacienteNome ?? "" }
              : undefined
          }
          onFechar={() => setEditando(false)}
          onCriado={() => setEditando(false)}
        />
      )}

      {inativando && (
        <InativarResponsavelModal
          responsavel={responsavel}
          contextoPaciente={contextoPaciente}
          onFechar={() => setInativando(false)}
          onConcluido={() => setInativando(false)}
        />
      )}

      {historico && (
        <HistoricoCadastrosModal
          titulo={`Histórico de ${responsavel.nome}`}
          entidades={["responsavel"]}
          registroId={responsavel.id}
          onClose={() => setHistorico(false)}
        />
      )}
    </>
  )
}
