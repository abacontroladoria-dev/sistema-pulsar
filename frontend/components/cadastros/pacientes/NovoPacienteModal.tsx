"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"
import { X, Loader2 } from "lucide-react"
import { maskCpf, validarCpfCnpj } from "@/lib/remuneracao/formatacao"
import { upsertPaciente } from "@/services/pacientes.service"
import { refetchPacientes } from "@/hooks/usePacientes"
import type { SexoPaciente } from "@/types/paciente"
import { Campo, CampoData, CampoSelect, foco } from "./ui/campos"

// Cadastro mínimo: o resto se preenche na tela de detalhe, que é onde o
// formulário completo vive. A matrícula NÃO vai no payload — quem a gera é o
// trigger do banco (20260826100100), e mandá-la daqui quebraria isso.

const SEXOS: { valor: SexoPaciente; rotulo: string }[] = [
  { valor: "F", rotulo: "Feminino" },
  { valor: "M", rotulo: "Masculino" },
  { valor: "outro", rotulo: "Outro" },
]

export function NovoPacienteModal({ onFechar }: { onFechar: () => void }) {
  const router = useRouter()
  const [nome, setNome] = useState("")
  const [cpf, setCpf] = useState<string | null>(null)
  const [dataNascimento, setDataNascimento] = useState<string | null>(null)
  const [sexo, setSexo] = useState<SexoPaciente | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim()) {
      toast.error("Informe o nome do paciente.")
      return
    }
    if (cpf && !validarCpfCnpj(cpf)) {
      toast.error("CPF incompleto.")
      return
    }

    setSalvando(true)
    setErro(null)
    const res = await upsertPaciente({
      nome: nome.trim(),
      tem_nome_civil: null,
      nome_civil: null,
      cpf,
      data_nascimento: dataNascimento,
      sexo,
      cor_raca: null,
      estado_civil: null,
      rg: null,
      rg_orgao_emissor: null,
      rg_uf: null,
      rg_data_emissao: null,
      email: null,
      telefone_residencial: null,
      falecido: false,
      ativo: true,
      ficticio: false,
      observacoes: null,
      lgpd_consentimento_em: null,
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
      responsavel_nome: null,
      responsavel_cpf: null,
      responsavel_email: null,
      responsavel_telefone: null,
      responsavel_parentesco: null,
      responsavel_financeiro: null,
      responsavel_financeiro_id: null,
    })

    if (!res.ok) {
      setSalvando(false)
      // O motivo real do banco aparece na tela — RLS e CHECK deixam de virar
      // "não foi possível cadastrar" sem explicação.
      setErro(res.error ?? "Não foi possível cadastrar o paciente.")
      return
    }

    await refetchPacientes()

    setSalvando(false)
    toast.success("Paciente cadastrado.")
    onFechar()

    // `res.id` vem do próprio insert; não é preciso reler a lista e casar por
    // nome, que erraria com dois pacientes homônimos.
    if (res.id) router.push(`/cadastros/pacientes/${res.id}`)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Novo paciente"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Novo paciente</h2>
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
            value={nome}
            onChange={setNome}
            disabled={salvando}
            largo
          />
          <Campo
            label="CPF"
            value={cpf ? maskCpf(cpf) : ""}
            onChange={(v) => setCpf(v.replace(/\D/g, "") || null)}
            disabled={salvando}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <CampoData
            label="Data de nascimento"
            value={dataNascimento}
            onChange={setDataNascimento}
            disabled={salvando}
          />
          <CampoSelect
            label="Sexo"
            value={sexo}
            onChange={setSexo}
            disabled={salvando}
            opcoes={SEXOS}
            largo
          />
          <p className="sm:col-span-2 text-xs text-muted-foreground">
            O ID é gerado pelo sistema no momento do cadastro. Os demais dados são
            preenchidos na tela do paciente.
          </p>

          {erro && (
            <div
              role="alert"
              className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {erro}
            </div>
          )}
        </div>

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
            onClick={() => void salvar()}
            disabled={salvando}
            className={`inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ${foco}`}
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Cadastrar
          </button>
        </footer>
      </div>
    </div>
  )
}
