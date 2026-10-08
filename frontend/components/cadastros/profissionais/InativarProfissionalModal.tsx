"use client"

import { useEffect, useRef, useState } from "react"
import { CircleSlash, Loader2, ShieldCheck, Trash2, UserRoundX } from "lucide-react"
import toast from "react-hot-toast"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { useModalLayer, Z_MODAL } from "@/components/cronograma/ui/useModalLayer"
import { DatePicker } from "@/components/ui/date-picker"
import { avisoFeito, tom } from "@/components/ui/pastel/pecas"
import { dataBR, hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { GradeNaoInstaladaError, inativarProfissional, sessoesAPartir } from "@/services/grade.service"

// Inativar profissional (decisão do usuário, 07/10/2026). O agendamento
// anterior à saída NUNCA é apagado — o profissional saiu, mas a sessão existiu.
// Dali em diante, quem inativa escolhe:
//   • manter (padrão): as sessões ficam na Grade como "precisa de reposição";
//   • excluir: saem da agenda, com o registro da exclusão.
// A disponibilidade que vale na véspera da saída termina nela.

type Escolha = "manter" | "excluir"

export function InativarProfissionalModal({
  profissional, onFechar, onFeito, inativarSemGrade,
}: {
  profissional: { id: number; nome: string }
  onFechar: () => void
  onFeito: () => void
  /** Banco sem as migrations da Grade: inativa só o cadastro (caminho antigo). */
  inativarSemGrade: () => Promise<boolean>
}) {
  const hoje = hojeBrasilia()
  const [saida, setSaida] = useState(hoje)
  const [escolha, setEscolha] = useState<Escolha>("manter")
  const [motivo, setMotivo] = useState("")
  const [contagem, setContagem] = useState<{ data: string; sessoes: number; pacientes: number } | null>(null)
  const [semGrade, setSemGrade] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  useModalLayer(cardRef, onFechar)

  useEffect(() => {
    let vivo = true
    sessoesAPartir(profissional.id, saida)
      .then(r => vivo && setContagem({ data: saida, ...r }))
      .catch(e => { if (vivo && e instanceof GradeNaoInstaladaError) setSemGrade(true) })
    return () => { vivo = false }
  }, [profissional.id, saida])
  const n = contagem?.data === saida ? contagem : null

  const confirmar = async () => {
    setSalvando(true)
    try {
      if (semGrade) {
        if (await inativarSemGrade()) {
          avisoFeito("Profissional inativado")
          onFeito()
          onFechar()
        }
        return
      }
      const r = await inativarProfissional({ profissionalId: profissional.id, dataSaida: saida, agendamentos: escolha, motivo: motivo.trim() || null })
      avisoFeito(r.agendamentos === "excluir" && r.sessoes
        ? `Inativado · ${r.sessoes} sessões excluídas`
        : r.sessoes ? `Inativado · ${r.sessoes} sessões para reposição` : "Profissional inativado")
      onFeito()
      onFechar()
    } catch (e) {
      if (e instanceof GradeNaoInstaladaError) {
        setSemGrade(true)
        if (await inativarSemGrade()) {
          avisoFeito("Profissional inativado")
          onFeito()
          onFechar()
        }
        return
      }
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/45 p-4" style={{ zIndex: Z_MODAL }}
      onClick={e => { if (e.target === e.currentTarget) onFechar() }}>
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="inativar-titulo"
        className={`pp ${tom("vermelho")} max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[24px] bg-[var(--pp-surface)] p-6 shadow-[var(--pp-sombra-alta)] outline-none`}>
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--c)] text-[var(--c-sobre)]" aria-hidden>
            <CircleSlash className="h-6 w-6" />
          </span>
          <div>
            <h2 id="inativar-titulo" className="text-[18px] font-extrabold leading-6">Inativar {profissional.nome}</h2>
            <p className="mt-1 text-sm font-semibold text-[var(--pp-ink-muted)]">Cadastro, disponibilidade e histórico continuam guardados.</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <span className={rotulo}>Data de saída (primeiro dia sem o profissional)</span>
            <div className="mt-1"><DatePicker value={saida} onChange={v => v && setSaida(v)} /></div>
          </div>

          <p className={`${tom("verde")} flex items-start gap-2 rounded-xl bg-[var(--c-suave)] px-3 py-2 text-sm font-semibold text-[var(--c-tinta)]`}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Sessões anteriores a {dataBR(saida)} nunca são apagadas.
          </p>

          {!semGrade && (
            <fieldset className="space-y-2">
              <legend className={rotulo}>
                Agendamentos a partir de {dataBR(saida < hoje ? hoje : saida)}
                {n && <span className="font-semibold normal-case text-[var(--pp-ink-muted)]"> — {n.sessoes} sessão(ões) de {n.pacientes} paciente(s)</span>}
              </legend>
              <Opcao ativa={escolha === "manter"} onClick={() => setEscolha("manter")} t="amber" Icone={UserRoundX}
                titulo="Manter (padrão)" texto="Continuam na Grade marcadas como “profissional inativo — precisa de reposição”, para outro profissional assumir ou substituir." />
              <Opcao ativa={escolha === "excluir"} onClick={() => setEscolha("excluir")} t="vermelho" Icone={Trash2}
                titulo="Excluir" texto="Saem da agenda. A exclusão fica registrada com seu nome; o paciente perde a sessão e entra na fila de reposição pelo histórico." />
            </fieldset>
          )}
          {semGrade && (
            <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">A Grade ainda não está instalada neste banco: só o cadastro é inativado (sem data de saída nem agendamentos).</p>
          )}

          <div>
            <label className={rotulo} htmlFor="motivo-inativar">Motivo (opcional)</label>
            <input id="motivo-inativar" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} className={`${campo} mt-1 h-11 w-full`}
              placeholder="Ex.: pediu desligamento" />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={onFechar} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11`}>Cancelar</button>
          <button type="button" onClick={confirmar} disabled={salvando} className={`${tom("vermelho")} pp-btn min-h-11`}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CircleSlash className="h-4 w-4" aria-hidden />}
            Inativar
          </button>
        </div>
      </div>
    </div>
  )
}

function Opcao({ ativa, onClick, t, Icone, titulo, texto }: {
  ativa: boolean; onClick: () => void; t: Parameters<typeof tom>[0]; Icone: typeof Trash2; titulo: string; texto: string
}) {
  return (
    <button type="button" role="radio" aria-checked={ativa} onClick={onClick}
      className={`${tom(t)} flex w-full items-start gap-3 rounded-[16px] p-3 text-left transition-shadow ${
        ativa ? "bg-[var(--c-suave)] shadow-[inset_0_0_0_2px_var(--c-medio)]" : "bg-[var(--pp-muted)] hover:bg-[var(--c-suave)]"}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--c)] text-[var(--c-sobre)]" aria-hidden><Icone className="h-4 w-4" /></span>
      <span>
        <span className="block text-sm font-extrabold">{titulo}</span>
        <span className="block text-xs font-semibold text-[var(--pp-ink-muted)]">{texto}</span>
      </span>
    </button>
  )
}
