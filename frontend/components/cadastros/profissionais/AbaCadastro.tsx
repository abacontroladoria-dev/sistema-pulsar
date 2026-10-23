"use client"

import { useId, useMemo } from "react"
import { RefreshCw } from "lucide-react"
import { CampoSelect, Secao, campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { errosDoForm, type FormProfissional } from "@/hooks/useProfissionalDetalhe"
import { formatarCelular } from "@/lib/cadastros/profissionais"
import { UFS } from "@/lib/cadastros/ufs"
import { maskCpfCnpj } from "@/lib/remuneracao/formatacao"
import { TIPOS_REGISTRO, type CampoTita, type Profissional } from "@/types/profissional"

// Aba Cadastro da ficha do profissional. Somente leitura até "Editar" (no
// cabeçalho da ficha). Campo que veio do TiTa e hoje difere dele mostra o valor
// de lá, com "usar este" — a importação nunca sobrescreve o que a equipe editou.
//
// Uma seção por vez, escolhida no menu lateral (SubNavVertical), como na ficha
// do paciente.

export type SecaoCadastroProf = "contato" | "registro" | "endereco" | "observacoes" | "imagens"

/** Campos de cada seção — o menu lateral marca a seção com alteração não salva. */
export const CAMPOS_DA_SECAO: Record<Exclude<SecaoCadastroProf, "imagens">, (keyof FormProfissional)[]> = {
  contato: ["nome", "cpf", "celular", "email"],
  registro: ["tipo_registro", "uf_registro", "codigo_registro", "cbo"],
  endereco: ["cep", "cidade", "logradouro", "numero", "complemento", "bairro", "uf"],
  observacoes: ["observacoes"],
}

const so = (v: string) => v.replace(/\D/g, "")
const mascaraCep = (v: string) => { const d = so(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d }

export function AbaCadastro({
  prof,
  form,
  set,
  editando,
  secao,
  imagens,
}: {
  prof: Profissional
  form: FormProfissional
  set: (patch: Partial<FormProfissional>) => void
  editando: boolean
  secao: SecaoCadastroProf
  /** Foto de perfil + assinatura/carimbo (gravadas na hora, fora do "Editar"). */
  imagens?: React.ReactNode
}) {
  const erros = useMemo(() => (editando ? errosDoForm(form) : {}), [editando, form])
  const disabled = !editando
  const tita = prof.dados_tita ?? {}

  const opcoesRegistro = useMemo(() => {
    const todos = new Set(TIPOS_REGISTRO)
    if (form.tipo_registro) todos.add(form.tipo_registro)
    if (tita.tipo_registro) todos.add(tita.tipo_registro)
    return [...todos].map(t => ({ valor: t, rotulo: t }))
  }, [form.tipo_registro, tita.tipo_registro])

  /** "No TiTa: X · usar este" quando o valor de lá é outro. */
  const divergencia = (campoTita: CampoTita, atual: string | null, formatar: (v: string) => string = v => v) => {
    const deLa = tita[campoTita]
    if (!deLa || (atual ?? "").trim() === deLa) return null
    return (
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <RefreshCw className="h-3 w-3" aria-hidden />
        No TiTa: <span className="font-semibold text-foreground">{formatar(deLa)}</span>
        {editando && (
          <button
            type="button"
            onClick={() => set({ [campoTita]: deLa } as Partial<FormProfissional>)}
            className="rounded px-1 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            usar este
          </button>
        )}
      </p>
    )
  }

  if (secao === "imagens") return <>{imagens}</>

  if (secao === "contato") {
    return (
      <Secao titulo="Contato" descricao="Como falar com o profissional">
        <CampoTexto label="Nome completo" valor={form.nome ?? ""} onChange={v => set({ nome: v })} disabled={disabled} erro={erros.nome} largo maxLength={200}
          extra={divergencia("nome", form.nome)} />
        <CampoTexto label="CPF" valor={maskCpfCnpj(form.cpf ?? "")} onChange={v => set({ cpf: so(v).slice(0, 11) || null })} disabled={disabled} erro={erros.cpf} inputMode="numeric"
          extra={divergencia("cpf", form.cpf, maskCpfCnpj)} />
        <CampoTexto label="Celular" valor={formatarCelular(form.celular) ?? ""} onChange={v => set({ celular: so(v).slice(0, 13) || null })} disabled={disabled} erro={erros.celular} inputMode="tel" placeholder="(21) 99999-9999"
          extra={divergencia("celular", form.celular, v => formatarCelular(v) ?? v)} />
        <CampoTexto label="E-mail" valor={form.email ?? ""} onChange={v => set({ email: v || null })} disabled={disabled} erro={erros.email} inputMode="email" largo maxLength={200} />
      </Secao>
    )
  }

  if (secao === "registro") {
    return (
      <Secao titulo="Registro profissional" descricao="Conselho de classe e ocupação (CBO)">
        <div>
          <CampoSelect label="Tipo de registro" value={form.tipo_registro} onChange={v => set({ tipo_registro: v })} disabled={disabled} opcoes={opcoesRegistro} vazio="Não informado" />
          {divergencia("tipo_registro", form.tipo_registro)}
        </div>
        <div>
          <CampoSelect label="UF do registro" value={form.uf_registro} onChange={v => set({ uf_registro: v })} disabled={disabled} opcoes={UFS.map(u => ({ valor: u, rotulo: u }))} vazio="Não informada" />
          {divergencia("uf_registro", form.uf_registro)}
        </div>
        <CampoTexto label="Código de registro" valor={form.codigo_registro ?? ""} onChange={v => set({ codigo_registro: v || null })} disabled={disabled} erro={erros.codigo_registro} maxLength={40} placeholder="Ex.: 05/12345"
          extra={divergencia("codigo_registro", form.codigo_registro)} />
        <CampoTexto label="CBO" valor={form.cbo ?? ""} onChange={v => set({ cbo: v || null })} disabled={disabled} erro={erros.cbo} maxLength={10} placeholder="Ex.: 2515-05"
          extra={divergencia("cbo", form.cbo)} />
      </Secao>
    )
  }

  if (secao === "endereco") {
    return (
      <Secao titulo="Endereço" descricao="Residência do profissional">
        <CampoTexto label="CEP" valor={mascaraCep(form.cep ?? "")} onChange={v => set({ cep: so(v).slice(0, 8) || null })} disabled={disabled} erro={erros.cep} inputMode="numeric" placeholder="00000-000" />
        <CampoTexto label="Cidade" valor={form.cidade ?? ""} onChange={v => set({ cidade: v || null })} disabled={disabled} maxLength={100} />
        <CampoTexto label="Logradouro" valor={form.logradouro ?? ""} onChange={v => set({ logradouro: v || null })} disabled={disabled} largo maxLength={200} />
        <CampoTexto label="Número" valor={form.numero ?? ""} onChange={v => set({ numero: v || null })} disabled={disabled} maxLength={20} />
        <CampoTexto label="Complemento" valor={form.complemento ?? ""} onChange={v => set({ complemento: v || null })} disabled={disabled} maxLength={100} />
        <CampoTexto label="Bairro" valor={form.bairro ?? ""} onChange={v => set({ bairro: v || null })} disabled={disabled} maxLength={100} />
        <CampoSelect label="UF" value={form.uf} onChange={v => set({ uf: v })} disabled={disabled} opcoes={UFS.map(u => ({ valor: u, rotulo: u }))} vazio="Não informada" />
      </Secao>
    )
  }

  return (
    <Secao titulo="Observações" descricao="Anotações internas da equipe">
      <div className="sm:col-span-2">
        <label className="sr-only" htmlFor="prof-obs">Observações</label>
        <textarea
          id="prof-obs"
          value={form.observacoes ?? ""}
          onChange={e => set({ observacoes: e.target.value || null })}
          disabled={disabled}
          rows={6}
          maxLength={2000}
          className={`${campo} resize-y`}
          placeholder={disabled ? "Sem observações." : "Ex.: prefere atender pela manhã às quintas."}
        />
      </div>
    </Secao>
  )
}

function CampoTexto({
  label, valor, onChange, disabled, erro, largo, maxLength, inputMode, placeholder, extra,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  disabled: boolean
  erro?: string
  largo?: boolean
  maxLength?: number
  inputMode?: "text" | "numeric" | "tel" | "email"
  placeholder?: string
  extra?: React.ReactNode
}) {
  const id = useId()
  return (
    <div className={largo ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className={rotulo}>{label}</label>
      <input
        id={id}
        type="text"
        value={valor}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={disabled ? undefined : placeholder}
        aria-invalid={!!erro}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className={`${campo} mt-1 ${erro ? "border-rose-400 focus:ring-rose-400" : ""}`}
      />
      {erro && <p id={`${id}-erro`} className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-400">{erro}</p>}
      {extra}
    </div>
  )
}
