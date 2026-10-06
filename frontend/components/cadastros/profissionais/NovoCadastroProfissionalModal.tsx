"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import toast from "react-hot-toast"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { refetchProfissionais } from "@/hooks/useProfissionais"
import { normTxt } from "@/lib/cronograma/constants"
import { formatarCelular } from "@/lib/cadastros/profissionais"
import { maskCpfCnpj, onlyDigits } from "@/lib/remuneracao/formatacao"
import { criarProfissional } from "@/services/profissionais.service"
import { idExibicaoProfissional, type ProfissionalLista } from "@/types/profissional"

// Cadastro manual — quem ainda não existe na TiTa (contratação nova). Pede só o
// essencial; o resto se completa na ficha, que abre logo depois de salvar.

export function NovoCadastroProfissionalModal({
  existentes,
  onFechar,
}: {
  /** Para avisar CPF ou nome já cadastrado antes de duplicar. */
  existentes: ProfissionalLista[]
  onFechar: () => void
}) {
  const router = useRouter()
  const { terapias } = useCadastroTerapias()
  const [nome, setNome] = useState("")
  const [cpf, setCpf] = useState("")
  const [celular, setCelular] = useState("")
  const [email, setEmail] = useState("")
  const [terapiaIds, setTerapiaIds] = useState<Set<number>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const opcoes = useMemo(
    () => terapias.filter(t => t.ativo).map(t => ({ id: t.id, nome: t.nome })),
    [terapias]
  )

  const cpfDigitos = onlyDigits(cpf)
  const duplicadoCpf = cpfDigitos.length === 11 ? existentes.find(p => p.cpf === cpfDigitos) : undefined
  const duplicadoNome = nome.trim().length > 3
    ? existentes.find(p => normTxt(p.nome) === normTxt(nome))
    : undefined

  const cpfInvalido = cpfDigitos.length > 0 && cpfDigitos.length !== 11
  const celDigitos = onlyDigits(celular)
  const celInvalido = celDigitos.length > 0 && (celDigitos.length < 10 || celDigitos.length > 11)
  const emailInvalido = email.trim().length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const podeSalvar = nome.trim().length >= 2 && !cpfInvalido && !celInvalido && !emailInvalido && !duplicadoCpf && !salvando

  const salvar = async () => {
    if (!podeSalvar) return
    setSalvando(true)
    setErro(null)
    try {
      const prof = await criarProfissional(
        {
          nome: nome.trim(),
          cpf: cpfDigitos || null,
          celular: celDigitos || null,
          email: email.trim() || null,
          tipo_registro: null, uf_registro: null, codigo_registro: null, cbo: null,
          cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
          terapia_focal_id: null, ativo: true, observacoes: null,
        },
        [...terapiaIds]
      )
      toast.success(`${prof.nome} cadastrado(a).`)
      void refetchProfissionais()
      router.push(`/cadastros/profissionais/${prof.id}`)
    } catch (e) {
      setErro(String((e as Error)?.message ?? e))
      setSalvando(false)
    }
  }

  return (
    <ScheduleModal
      title="Novo profissional"
      subtitle="Para quem ainda não está na TiTa. Quando aparecer lá com o mesmo CPF, a importação vincula este cadastro em vez de criar outro."
      maxWidth={560}
      onClose={onFechar}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!podeSalvar}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar e abrir ficha
          </button>
        </div>
      }
    >
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="novo-prof-nome" className={rotulo}>Nome completo *</label>
          <input id="novo-prof-nome" autoFocus maxLength={200} value={nome} onChange={e => setNome(e.target.value)} className={`${campo} mt-1`} />
          {duplicadoNome && !duplicadoCpf && (
            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              Já existe um cadastro com esse nome (ID {idExibicaoProfissional(duplicadoNome)}). Confira antes de criar outro.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="novo-prof-cpf" className={rotulo}>CPF</label>
          <input id="novo-prof-cpf" inputMode="numeric" value={maskCpfCnpj(cpf)} onChange={e => setCpf(onlyDigits(e.target.value).slice(0, 11))} className={`${campo} mt-1`} aria-invalid={cpfInvalido || !!duplicadoCpf} />
          {cpfInvalido && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">O CPF tem 11 dígitos.</p>}
          {duplicadoCpf && (
            <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
              Esse CPF já é de {duplicadoCpf.nome}.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="novo-prof-cel" className={rotulo}>Celular</label>
          <input id="novo-prof-cel" inputMode="tel" value={formatarCelular(celular) ?? ""} onChange={e => setCelular(onlyDigits(e.target.value).slice(0, 11))} className={`${campo} mt-1`} placeholder="(21) 99999-9999" aria-invalid={celInvalido} />
          {celInvalido && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">DDD + número.</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="novo-prof-email" className={rotulo}>E-mail</label>
          <input id="novo-prof-email" type="email" inputMode="email" maxLength={200} value={email} onChange={e => setEmail(e.target.value)} className={`${campo} mt-1`} aria-invalid={emailInvalido} />
          {emailInvalido && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">E-mail inválido.</p>}
        </div>
        <div className="sm:col-span-2">
          <span className={rotulo}>Terapias que pode prestar</span>
          <div className="mt-1">
            <MultiSearchCombobox
              opcoes={opcoes}
              selecionados={terapiaIds}
              onToggle={id => setTerapiaIds(prev => {
                const n = new Set(prev)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })}
              ariaLabel="Terapias habilitadas"
              nomePlural="terapias"
              placeholder="Nenhuma terapia selecionada"
              resumoCompleto
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Só estas poderão ser escolhidas na disponibilidade.</p>
        </div>
        {erro && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 sm:col-span-2 dark:bg-rose-950/30 dark:text-rose-400">
            {erro}
          </p>
        )}
      </div>
    </ScheduleModal>
  )
}
