"use client"

import { maskCpf } from "@/lib/remuneracao/formatacao"
import { idExibicao } from "@/types/paciente"
import type { CorRaca, EstadoCivil, Paciente, SexoPaciente } from "@/types/paciente"
import type { PacienteForm } from "@/hooks/usePacienteDetalhe"
import {
  Campo,
  CampoData,
  CampoSelect,
  CampoSomenteLeitura,
  CampoToggleSimNao,
  Secao,
} from "../ui/campos"

const SEXOS: { valor: SexoPaciente; rotulo: string }[] = [
  { valor: "F", rotulo: "Feminino" },
  { valor: "M", rotulo: "Masculino" },
  { valor: "outro", rotulo: "Outro" },
]

// Vocabulário IBGE (PNAD) — os valores gravados são snake_case sem acento; o
// rótulo bonito vive aqui, no frontend. Ver o CHECK em 20260826100000.
const CORES_RACA: { valor: CorRaca; rotulo: string }[] = [
  { valor: "branca", rotulo: "Branca" },
  { valor: "preta", rotulo: "Preta" },
  { valor: "parda", rotulo: "Parda" },
  { valor: "amarela", rotulo: "Amarela" },
  { valor: "indigena", rotulo: "Indígena" },
  { valor: "nao_declarada", rotulo: "Não declarada" },
]

const ESTADOS_CIVIS: { valor: EstadoCivil; rotulo: string }[] = [
  { valor: "solteiro", rotulo: "Solteiro(a)" },
  { valor: "casado", rotulo: "Casado(a)" },
  { valor: "divorciado", rotulo: "Divorciado(a)" },
  { valor: "viuvo", rotulo: "Viúvo(a)" },
  { valor: "separado", rotulo: "Separado(a)" },
  { valor: "uniao_estavel", rotulo: "União estável" },
]

export function DadosPessoais({
  paciente,
  form,
  set,
  disabled,
}: {
  paciente: Paciente
  form: PacienteForm
  set: (patch: Partial<PacienteForm>) => void
  disabled: boolean
}) {
  return (
    <Secao titulo="Dados pessoais" descricao="Informações básicas do paciente">
      <Campo
        label="Nome"
        value={form.nome}
        onChange={(v) => set({ nome: v })}
        disabled={disabled}
      />
      <CampoSomenteLeitura
        label="ID"
        value={idExibicao(paciente)}
        acima={paciente.origem_cadastro === "tita" ? "Origem: TiTa" : "Origem: Pulsar"}
      />

      <Campo
        label="Nome civil (opcional)"
        value={form.nome_civil ?? ""}
        onChange={(v) => set({ nome_civil: v || null, tem_nome_civil: Boolean(v) })}
        disabled={disabled}
        largo
      />

      <CampoSelect
        label="Sexo"
        value={form.sexo}
        onChange={(v) => set({ sexo: v })}
        disabled={disabled}
        opcoes={SEXOS}
      />
      <CampoSelect
        label="Cor ou raça"
        value={form.cor_raca}
        onChange={(v) => set({ cor_raca: v })}
        disabled={disabled}
        opcoes={CORES_RACA}
      />

      <CampoSelect
        label="Estado civil"
        value={form.estado_civil}
        onChange={(v) => set({ estado_civil: v })}
        disabled={disabled}
        opcoes={ESTADOS_CIVIS}
      />
      <CampoData
        label="Data de nascimento"
        value={form.data_nascimento}
        onChange={(v) => set({ data_nascimento: v })}
        disabled={disabled}
      />

      <Campo
        label="CPF"
        value={form.cpf ? maskCpf(form.cpf) : ""}
        // Grava só dígitos: a string mascarada no banco quebraria qualquer
        // cruzamento por documento.
        onChange={(v) => set({ cpf: v.replace(/\D/g, "") || null })}
        disabled={disabled}
        inputMode="numeric"
        placeholder="000.000.000-00"
      />
      <Campo
        label="RG"
        value={form.rg ?? ""}
        onChange={(v) => set({ rg: v || null })}
        disabled={disabled}
      />

      <Campo
        label="Órgão emissor"
        value={form.rg_orgao_emissor ?? ""}
        onChange={(v) => set({ rg_orgao_emissor: v || null })}
        disabled={disabled}
        placeholder="SSP"
      />
      <Campo
        label="UF do órgão emissor"
        value={form.rg_uf ?? ""}
        // Maiúsculas e no máximo 2 letras: o CHECK do banco é ^[A-Z]{2}$, e
        // deixar minúscula chegar lá só produz erro no fim do preenchimento.
        onChange={(v) =>
          set({ rg_uf: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || null })
        }
        disabled={disabled}
        maxLength={2}
        placeholder="RJ"
      />

      <CampoData
        label="Data de emissão"
        value={form.rg_data_emissao}
        onChange={(v) => set({ rg_data_emissao: v })}
        disabled={disabled}
      />
      {/* Sem campo de celular do paciente: a coluna foi removida em
          20260828170200. O contato telefônico é o do responsável, editado na
          seção "Filiação e responsáveis". */}

      <Campo
        label="E-mail"
        type="email"
        value={form.email ?? ""}
        onChange={(v) => set({ email: v || null })}
        disabled={disabled}
        inputMode="email"
        largo
      />

      <CampoToggleSimNao
        label="Paciente falecido"
        value={form.falecido}
        onChange={(v) => set({ falecido: v })}
        disabled={disabled}
      />

      <CampoToggleSimNao
        label="Paciente fictício"
        value={form.ficticio}
        onChange={(v) => set({ ficticio: v })}
        disabled={disabled}
      />
    </Secao>
  )
}
