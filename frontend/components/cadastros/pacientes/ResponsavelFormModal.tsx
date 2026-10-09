"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { X, Loader2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import { maskCpf, onlyDigits, validarCpf } from "@/lib/remuneracao/formatacao"
import { UFS } from "@/lib/cadastros/ufs"
import {
  upsertResponsavel,
  getVinculosDeResponsaveis,
  type ContextoPacienteAuditoria,
} from "@/services/responsaveis.service"
import { useResponsaveis, refetchResponsaveis } from "@/hooks/useResponsaveis"
import type { Responsavel, ResponsavelEdit } from "@/types/responsavel"
import { Campo, CampoData, CampoSelect, foco } from "./ui/campos"

// Evoluído de NovoResponsavelModal: cria e edita, e agora avisa nos dois
// pontos onde duplicar um responsável causa dado ruim (ver plano de
// Responsáveis — "lógica de irmãos" e "editar compartilhado avisa e salva"):
//
// - Ao CRIAR, CPF (ou nome, sem CPF) batendo com alguém já cadastrado sugere
//   reusar em vez de duplicar — é o que o COMMENT da coluna `cpf` já promete.
// - Ao EDITAR alguém vinculado a mais de um paciente, a alteração vale para
//   todos — avisa quem antes de gravar, porque é a mesma pessoa.

// Sem acento, minúsculo — para "Maria" casar com "María" na comparação de
// duplicidade sem CPF.
function normalizarNome(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

const VAZIO: ResponsavelEdit = {
  nome: "",
  cpf: null,
  rg: null,
  rg_orgao_emissor: null,
  rg_uf: null,
  data_nascimento: null,
  celular: null,
  telefone_residencial: null,
  email: null,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  uf: null,
  ativo: true,
}

type PacienteVinculo = { id_paciente: number; nome: string; tipo: string }

export function ResponsavelFormModal({
  responsavel,
  contextoPaciente,
  onFechar,
  onCriado,
}: {
  /** Quando presente, o modal EDITA em vez de criar. */
  responsavel?: Responsavel
  /** De qual paciente o modal foi aberto — trilha de auditoria e "vale também para". */
  contextoPaciente?: { id: number; nome: string }
  onFechar: () => void
  onCriado: (responsavel: Responsavel) => void
}) {
  const { responsaveis } = useResponsaveis()

  // Sem useEffect de reset: o pai monta o modal condicionalmente, então o
  // estado inicial já nasce certo. Convenção do projeto.
  const [form, setForm] = useState<ResponsavelEdit>(() =>
    responsavel ? { ...responsavel } : VAZIO
  )
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const editando = Boolean(responsavel)

  // Endereço nasce RECOLHIDO: o essencial pra vincular alguém é nome, CPF,
  // contato — o endereço só importa quando diverge do endereço do PACIENTE
  // (pais separados, financeiro que mora em outro lugar), que é o caso raro,
  // não o comum. Sempre fechado, mesmo editando quem já tem endereço
  // preenchido — o resumo ao lado do título é o que evita perder de vista que
  // há dado ali sem precisar abrir.
  const [enderecoAberto, setEnderecoAberto] = useState(false)
  const resumoEndereco = [form.logradouro, form.bairro, form.cidade && form.uf ? `${form.cidade}/${form.uf}` : (form.cidade || form.uf)]
    .filter(Boolean)
    .join(", ")

  // Duplicidade na criação: quem já bate com o CPF (ou, sem CPF, com o nome
  // normalizado) que está sendo digitado agora.
  const [duplicadoIgnorado, setDuplicadoIgnorado] = useState(false)
  const [duplicadoPacientes, setDuplicadoPacientes] = useState<PacienteVinculo[]>([])

  const candidatoCpf =
    !editando && form.cpf
      ? responsaveis.find((r) => r.cpf && onlyDigits(r.cpf) === onlyDigits(form.cpf!))
      : undefined
  const candidatoNome =
    !editando && !candidatoCpf && form.nome.trim().length > 2
      ? responsaveis.find((r) => normalizarNome(r.nome) === normalizarNome(form.nome))
      : undefined
  const duplicado = candidatoCpf ?? candidatoNome
  const duplicadoForte = Boolean(candidatoCpf)

  useEffect(() => {
    if (!duplicado) {
      setDuplicadoPacientes([])
      return
    }
    let ativo = true
    getVinculosDeResponsaveis([duplicado.id]).then(({ data }) => {
      if (ativo) setDuplicadoPacientes(data.get(duplicado.id) ?? [])
    })
    return () => {
      ativo = false
    }
  }, [duplicado])

  // Alcance compartilhado na edição: os OUTROS pacientes que respondem por
  // esta mesma pessoa (excluindo o paciente de onde o modal foi aberto, que
  // já sabe que está editando).
  const [alcanceConfirmado, setAlcanceConfirmado] = useState(false)
  const [outrosPacientes, setOutrosPacientes] = useState<PacienteVinculo[]>([])

  useEffect(() => {
    if (!editando || !responsavel) return
    let ativo = true
    getVinculosDeResponsaveis([responsavel.id]).then(({ data }) => {
      if (!ativo) return
      const todos = data.get(responsavel.id) ?? []
      setOutrosPacientes(todos.filter((p) => p.id_paciente !== contextoPaciente?.id))
    })
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando, responsavel?.id])

  const set = (patch: Partial<ResponsavelEdit>) => setForm((a) => ({ ...a, ...patch }))

  async function salvar(opts?: { ignorarDuplicado?: boolean; confirmarAlcance?: boolean }) {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do responsável.")
      return
    }
    if (form.cpf && !validarCpf(form.cpf)) {
      toast.error("CPF inválido.")
      return
    }

    // Duplicidade é relatada, não bloqueada — a pessoa que está digitando
    // decide se é a mesma gente ou uma coincidência de nome.
    if (duplicado && !duplicadoIgnorado && !opts?.ignorarDuplicado) {
      return
    }
    if (editando && outrosPacientes.length > 0 && !alcanceConfirmado && !opts?.confirmarAlcance) {
      return
    }

    setSalvando(true)
    setErro(null)
    const { data, error } = await upsertResponsavel(
      { ...form, nome: form.nome.trim() },
      contextoPaciente ? { pacienteId: contextoPaciente.id, pacienteNome: contextoPaciente.nome } : undefined
    )
    setSalvando(false)

    if (error || !data) {
      setErro(error ?? "Não foi possível salvar o responsável.")
      return
    }

    // Sem isto o picker não enxerga quem acabou de ser criado/editado: o hook
    // usa cache module-level compartilhado.
    await refetchResponsaveis()
    toast.success(editando ? "Responsável atualizado." : "Responsável cadastrado.")
    onCriado(data)
  }

  const mostrarAvisoDuplicado = Boolean(duplicado) && !duplicadoIgnorado
  const mostrarAvisoAlcance = editando && outrosPacientes.length > 0 && !alcanceConfirmado

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? "Editar responsável" : "Novo responsável"}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">
            {editando ? "Editar responsável" : "Novo responsável"}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            className={`rounded-md p-1 text-muted-foreground hover:bg-muted ${foco}`}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2">
          <Campo
            label="Nome"
            value={form.nome}
            onChange={(v) => {
              set({ nome: v })
              setDuplicadoIgnorado(false)
            }}
            disabled={salvando}
            largo
          />

          {mostrarAvisoDuplicado && duplicado && (
            <div
              role="alert"
              className={`sm:col-span-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                duplicadoForte
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p>
                  {duplicadoForte ? (
                    <>
                      <strong>{duplicado.nome}</strong> já está cadastrado(a)
                    </>
                  ) : (
                    <>
                      <strong>{duplicado.nome}</strong> tem o mesmo nome — pode ser a mesma pessoa
                    </>
                  )}
                  {duplicadoPacientes.length > 0 && (
                    <>
                      {" "}
                      — responsável de{" "}
                      {duplicadoPacientes.map((p) => p.nome).join(", ")}
                    </>
                  )}
                  .
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => onCriado(duplicado)}
                    className={`text-sm font-medium underline ${foco}`}
                  >
                    Usar este cadastro
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuplicadoIgnorado(true)}
                    className={`text-sm text-muted-foreground underline ${foco}`}
                  >
                    Cadastrar mesmo assim
                  </button>
                </div>
              </div>
            </div>
          )}

          <Campo
            label="CPF"
            value={form.cpf ? maskCpf(form.cpf) : ""}
            onChange={(v) => {
              set({ cpf: v.replace(/\D/g, "") || null })
              setDuplicadoIgnorado(false)
            }}
            disabled={salvando}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <CampoData
            label="Data de nascimento"
            value={form.data_nascimento}
            onChange={(v) => set({ data_nascimento: v })}
            disabled={salvando}
          />
          <Campo
            label="RG"
            value={form.rg ?? ""}
            onChange={(v) => set({ rg: v || null })}
            disabled={salvando}
          />
          <Campo
            label="Órgão emissor"
            value={form.rg_orgao_emissor ?? ""}
            onChange={(v) => set({ rg_orgao_emissor: v || null })}
            disabled={salvando}
          />
          <CampoSelect
            label="UF do RG"
            value={form.rg_uf as string | null}
            onChange={(v) => set({ rg_uf: v })}
            disabled={salvando}
            vazio="Não informada"
            opcoes={UFS.map((uf) => ({ valor: uf, rotulo: uf }))}
          />
          <Campo
            label="Celular"
            value={form.celular ?? ""}
            onChange={(v) => set({ celular: v || null })}
            disabled={salvando}
            inputMode="tel"
          />
          <Campo
            label="Telefone residencial"
            value={form.telefone_residencial ?? ""}
            onChange={(v) => set({ telefone_residencial: v || null })}
            disabled={salvando}
            inputMode="tel"
            placeholder="(21) 3333-3333"
          />
          <Campo
            label="E-mail"
            type="email"
            value={form.email ?? ""}
            onChange={(v) => set({ email: v || null })}
            disabled={salvando}
            inputMode="email"
          />

        </div>

        {/* Recolhido por padrão — ver comentário de `enderecoAberto`. O
            resumo ao lado do título mostra o que já está preenchido sem
            precisar abrir, para editar um responsável com endereço não dar a
            impressão de que o dado sumiu. */}
        <div className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setEnderecoAberto((a) => !a)}
            aria-expanded={enderecoAberto}
            className={`flex w-full items-center justify-between gap-2 text-left ${foco}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {enderecoAberto ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              Endereço
            </span>
            {!enderecoAberto && resumoEndereco && (
              <span className="truncate text-xs text-muted-foreground">{resumoEndereco}</span>
            )}
          </button>

          {enderecoAberto && (
            <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Campo
                label="CEP"
                value={form.cep ?? ""}
                onChange={(v) => set({ cep: v || null })}
                disabled={salvando}
                inputMode="numeric"
              />
              <Campo
                label="Cidade"
                value={form.cidade ?? ""}
                onChange={(v) => set({ cidade: v || null })}
                disabled={salvando}
              />
              <Campo
                label="Logradouro"
                value={form.logradouro ?? ""}
                onChange={(v) => set({ logradouro: v || null })}
                disabled={salvando}
              />
              <Campo
                label="Bairro"
                value={form.bairro ?? ""}
                onChange={(v) => set({ bairro: v || null })}
                disabled={salvando}
              />
              <Campo
                label="Número"
                value={form.numero ?? ""}
                onChange={(v) => set({ numero: v || null })}
                disabled={salvando}
              />
              <Campo
                label="Complemento"
                value={form.complemento ?? ""}
                onChange={(v) => set({ complemento: v || null })}
                disabled={salvando}
              />
              <CampoSelect
                label="UF"
                value={form.uf as string | null}
                onChange={(v) => set({ uf: v })}
                disabled={salvando}
                vazio="Não informada"
                opcoes={UFS.map((uf) => ({ valor: uf, rotulo: uf }))}
              />
            </div>
          )}
        </div>

        {mostrarAvisoAlcance && (
          <div
            role="alert"
            className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              É a mesma pessoa em mais de um cadastro. Esta alteração vale também para:{" "}
              <strong>{outrosPacientes.map((p) => p.nome).join(", ")}</strong>.
            </span>
          </div>
        )}

        {erro && (
          <div
            role="alert"
            className="mx-4 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className={`rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted ${foco}`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar(mostrarAvisoAlcance ? { confirmarAlcance: true } : undefined)}
            disabled={salvando || mostrarAvisoDuplicado}
            className={`inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ${foco}`}
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {mostrarAvisoAlcance ? "Confirmar e salvar" : "Salvar"}
          </button>
        </footer>
      </div>
    </div>
  )
}
