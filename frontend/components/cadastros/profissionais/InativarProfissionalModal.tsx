"use client"

import { useEffect, useState } from "react"
import { CircleSlash, Loader2, ShieldCheck, Trash2, UserRoundX } from "lucide-react"
import toast from "react-hot-toast"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, btnPerigoCheio, btnSecundario, opcaoForm } from "@/components/cronograma/grade/estilo"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { DatePicker } from "@/components/ui/date-picker"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { dataBR, hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { GradeNaoInstaladaError, inativarProfissional, sessoesAPartir } from "@/services/grade.service"

// Inativar profissional (decisão do usuário, 07/10/2026). O agendamento
// anterior à saída NUNCA é apagado — o profissional saiu, mas a sessão existiu.
// Dali em diante, quem inativa escolhe:
//   • manter (padrão): as sessões ficam na Grade como "precisa de reposição";
//   • excluir: saem da agenda, com o registro da exclusão — pede motivo e
//     uma segunda confirmação, porque não volta.
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
  const { confirmar: pedirConfirmacao, dialogo } = useConfirmacao()

  useEffect(() => {
    let vivo = true
    sessoesAPartir(profissional.id, saida)
      .then(r => vivo && setContagem({ data: saida, ...r }))
      .catch(e => { if (vivo && e instanceof GradeNaoInstaladaError) setSemGrade(true) })
    return () => { vivo = false }
  }, [profissional.id, saida])
  const n = contagem?.data === saida ? contagem : null
  const excluindo = !semGrade && escolha === "excluir"
  const faltaMotivo = excluindo && motivo.trim().length < 3

  const confirmar = async () => {
    if (faltaMotivo) return
    if (excluindo && n && n.sessoes > 0) {
      const ok = await pedirConfirmacao({
        titulo: `Excluir ${n.sessoes} sessão${n.sessoes === 1 ? "" : "ões"}?`,
        texto: `As sessões de ${profissional.nome} a partir de ${dataBR(saida < hoje ? hoje : saida)} (${n.pacientes} paciente${n.pacientes === 1 ? "" : "s"}) saem da agenda.\nA exclusão fica registrada com seu nome e o motivo.`,
        confirmar: "Excluir e inativar",
        t: "vermelho",
        Icone: Trash2,
      })
      if (!ok) return
    }
    setSalvando(true)
    try {
      if (semGrade) {
        if (await inativarSemGrade()) {
          toast.success("Profissional inativado")
          onFeito()
          onFechar()
        }
        return
      }
      const r = await inativarProfissional({ profissionalId: profissional.id, dataSaida: saida, agendamentos: escolha, motivo: motivo.trim() || null })
      toast.success(r.agendamentos === "excluir" && r.sessoes
        ? `Inativado · ${r.sessoes} sessões excluídas`
        : r.sessoes ? `Inativado · ${r.sessoes} sessões para reposição` : "Profissional inativado")
      onFeito()
      onFechar()
    } catch (e) {
      if (e instanceof GradeNaoInstaladaError) {
        setSemGrade(true)
        if (await inativarSemGrade()) {
          toast.success("Profissional inativado")
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
    <>
    <ScheduleModal
      title={`Inativar ${profissional.nome}`}
      subtitle="Cadastro, disponibilidade e histórico continuam guardados."
      maxWidth={560}
      onClose={onFechar}
      footer={
        <>
          <button type="button" onClick={onFechar} className={btnSecundario}>Cancelar</button>
          <button type="button" onClick={confirmar} disabled={salvando || faltaMotivo} className={btnPerigoCheio}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CircleSlash className="h-4 w-4" aria-hidden />}
            Inativar
          </button>
        </>
      }
    >
        <div className="space-y-4">
          <div>
            <span className={rotulo}>Data de saída (primeiro dia sem o profissional)</span>
            <div className="mt-1"><DatePicker value={saida} onChange={v => v && setSaida(v)} /></div>
          </div>

          <p className={aviso("green")}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Sessões anteriores a {dataBR(saida)} nunca são apagadas.
          </p>

          {!semGrade && (
            <fieldset className="space-y-2" role="radiogroup">
              <legend className={rotulo}>
                Agendamentos a partir de {dataBR(saida < hoje ? hoje : saida)}
                {n && <span className="font-normal text-muted-foreground"> — {n.sessoes} sessão(ões) de {n.pacientes} paciente(s)</span>}
              </legend>
              <Opcao ativa={escolha === "manter"} onClick={() => setEscolha("manter")} Icone={UserRoundX}
                titulo="Manter (padrão)" texto="Continuam na Grade marcadas como “profissional inativo — precisa de reposição”, para outro profissional assumir ou substituir." />
              <Opcao ativa={escolha === "excluir"} onClick={() => setEscolha("excluir")} Icone={Trash2} perigo
                titulo="Excluir" texto="Saem da agenda. A exclusão fica registrada com seu nome e o motivo; o histórico do paciente continua mostrando as sessões excluídas." />
            </fieldset>
          )}
          {semGrade && (
            <p className="text-xs text-muted-foreground">A Grade ainda não está instalada neste banco: só o cadastro é inativado (sem data de saída nem agendamentos).</p>
          )}

          <div>
            <label className={rotulo} htmlFor="motivo-inativar">Motivo {excluindo ? "(obrigatório para excluir)" : "(opcional)"}</label>
            <input id="motivo-inativar" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} className={`${campo} mt-1 h-9 w-full`}
              placeholder="Ex.: pediu desligamento" aria-invalid={faltaMotivo && motivo.length > 0 ? true : undefined} />
          </div>
        </div>
    </ScheduleModal>
    {dialogo}
    </>
  )
}

function Opcao({ ativa, onClick, Icone, titulo, texto, perigo = false }: {
  ativa: boolean; onClick: () => void; Icone: typeof Trash2; titulo: string; texto: string; perigo?: boolean
}) {
  return (
    <button type="button" role="radio" aria-checked={ativa} onClick={onClick}
      className={`${opcaoForm(ativa)} w-full !justify-start gap-3 py-3 text-left`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted ${perigo ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`} aria-hidden>
        <Icone className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{titulo}</span>
        <span className="block text-xs font-normal text-muted-foreground">{texto}</span>
      </span>
    </button>
  )
}
