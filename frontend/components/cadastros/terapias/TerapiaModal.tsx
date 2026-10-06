"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { CampoCor, campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { normTxt } from "@/lib/cronograma/constants"
import { COR_NEUTRA, luminancia } from "@/lib/cadastros/terapias"
import { TIPO_TERAPIA_LABEL, type CadastroTerapia, type CadastroTerapiaEdit, type TipoTerapia } from "@/types/terapia"

export function TerapiaModal({
  terapia,
  todas,
  onSalvar,
  onClose,
}: {
  /** Undefined = nova terapia. */
  terapia?: CadastroTerapia
  /** Catálogo inteiro: paleta de cores e aviso de nome repetido. */
  todas: CadastroTerapia[]
  onSalvar: (input: CadastroTerapiaEdit) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<CadastroTerapiaEdit>({
    nome: terapia?.nome ?? "",
    tipo: terapia?.tipo ?? "terapia",
    cor_hex: terapia?.cor_hex ?? COR_NEUTRA,
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const paleta = useMemo(
    () => todas.map(t => t.cor_hex).filter(c => c !== COR_NEUTRA),
    [todas]
  )
  const repetida = useMemo(() => {
    const n = normTxt(form.nome)
    if (!n) return null
    return todas.find(t => t.id !== terapia?.id && normTxt(t.nome) === n) ?? null
  }, [form.nome, todas, terapia?.id])

  const nomeValido = form.nome.trim().length >= 2
  const podeSalvar = nomeValido && !repetida && !salvando
  const textoEscuro = luminancia(form.cor_hex) > 0.45

  const salvar = async () => {
    if (!podeSalvar) return
    setSalvando(true)
    setErro(null)
    try {
      await onSalvar({ ...form, nome: form.nome.trim() })
      onClose()
    } catch (e) {
      setErro(String((e as Error)?.message ?? e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <ScheduleModal
      title={terapia ? "Editar terapia" : "Nova terapia"}
      subtitle="Cadastrou? Já pode ser usada na disponibilidade dos profissionais."
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!podeSalvar}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        {/* Prévia: como a terapia aparece nos chips e cards */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold"
            style={{ backgroundColor: form.cor_hex, color: textoEscuro ? "#0f172a" : "#ffffff" }}
          >
            {form.nome.trim() || "Nome da terapia"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: form.cor_hex }} aria-hidden="true" />
            prévia no card
          </span>
        </div>

        <div>
          <label htmlFor="terapia-nome" className={rotulo}>Nome da terapia ou procedimento</label>
          <input
            id="terapia-nome"
            type="text"
            autoFocus
            maxLength={120}
            value={form.nome}
            onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") void salvar() }}
            className={`${campo} mt-1`}
            placeholder="Ex.: Psicomotricidade"
          />
          {repetida && (
            <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
              Já existe &quot;{repetida.nome}&quot;{repetida.ativo ? "" : " (inativa — reative-a na lista)"}.
            </p>
          )}
        </div>

        <div>
          <span className={rotulo}>Tipo</span>
          <div className="mt-1 inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Tipo">
            {(Object.keys(TIPO_TERAPIA_LABEL) as TipoTerapia[]).map(t => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.tipo === t}
                onClick={() => setForm(f => ({ ...f, tipo: t }))}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  form.tipo === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {TIPO_TERAPIA_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <CampoCor
          label="Cor (hexadecimal)"
          value={form.cor_hex}
          onChange={cor => setForm(f => ({ ...f, cor_hex: cor }))}
          disabled={false}
          sugestoes={paleta}
          dica="Usada no destaque do card do profissional, nos chips e na linha do tempo da disponibilidade."
        />

        {terapia?.tita_terapia_id && (
          <p className="text-xs text-muted-foreground">
            Vinculada à terapia #{terapia.tita_terapia_id} da TiTa — o vínculo continua valendo se o nome mudar.
          </p>
        )}

        {erro && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
            {erro}
          </p>
        )}
      </div>
    </ScheduleModal>
  )
}
