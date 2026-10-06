"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { CampoCor, campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { normTxt } from "@/lib/cronograma/constants"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { ICONES_TERAPIA, IconeTerapia } from "@/lib/cadastros/iconesTerapia"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
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
    icone: terapia?.icone ?? null,
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
        {/* Prévia: como a terapia aparece no card do profissional (avatar e chip) */}
        <div style={estiloTons(form.cor_hex)} className="ua-tons flex items-center gap-4 rounded-xl border border-border bg-[var(--t-50)] p-3">
          <span className="ua-avatar h-14 w-14">
            <IconeTerapia chave={form.icone} className="h-7 w-7" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 space-y-1.5">
            <span className="ua-role"><span className="truncate">{form.nome.trim() || "Nome da terapia"}</span></span>
            <div><span className="ua-chip"><span className="truncate">{form.nome.trim() || "Nome da terapia"}</span></span></div>
          </div>
          <span className="ml-auto self-start text-xs text-muted-foreground">prévia no card</span>
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

        <div>
          <span className={rotulo}>Ícone no card do profissional</span>
          <div role="radiogroup" aria-label="Ícone" className="mt-1.5 grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {ICONES_TERAPIA.map(o => {
              const marcado = (form.icone ?? "sparkles") === o.chave
              return (
                <button
                  key={o.chave}
                  type="button"
                  role="radio"
                  aria-checked={marcado}
                  aria-label={o.rotulo}
                  title={o.rotulo}
                  onClick={() => setForm(f => ({ ...f, icone: o.chave === "sparkles" ? null : o.chave }))}
                  style={marcado ? estiloTons(form.cor_hex) : undefined}
                  className={`ua-tons flex aspect-square items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    marcado
                      ? "border-[var(--t-300)] bg-[var(--t-50)] text-[var(--t-700)] ring-1 ring-[var(--t-300)]"
                      : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <o.Icone className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Aparece no avatar de todos os profissionais que têm esta terapia como principal.</p>
        </div>

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
