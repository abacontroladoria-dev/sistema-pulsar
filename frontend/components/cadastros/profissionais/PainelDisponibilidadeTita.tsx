"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { AlertCircle, AlertTriangle, CheckCircle2, CloudDownload, History, Loader2, Replace, UserX } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { DatePicker } from "@/components/ui/date-picker"
import { rodadaDeDisponibilidade } from "@/components/tita/adaptadoresRelatorio"
import { CorpoRelatorio, formatarDataHora, type RodadaRelatorio } from "@/components/tita/RelatorioSincronizacaoTita"
import { janelaGradeTita } from "@/lib/disponibilidadeDaGradeTita"
import { dataBR, hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { medirFrescorGrade, type FrescorGrade } from "@/lib/grade/fonte"
import {
  gravarDisponibilidadeTita, lerImportacaoCompleta, prepararPreviaDisponibilidade, type PreviaDisponibilidadeTita,
} from "@/services/disponibilidadeTita.service"
import type { CadastroTerapia } from "@/types/terapia"

// "Gravar no Pulsar a disponibilidade do TiTa" — todos os profissionais de uma
// vez, SÓ quando alguém clica (nenhuma rotina automática). Lê a cópia da grade
// do TiTa que o sync já gravou no Supabase; nada é enviado ao TiTa.
//
// Prévia → Gravar → Relatório. A prévia é gravada no banco e relida de lá: o
// que aparece na tela é exatamente o que o "Gravar" vai aplicar.
// Regra (15/10/2026): o TiTa PREVALECE; a versão editada no Pulsar fica no histórico.

const btnPrimario =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
const btnSecundario =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"

type Fase =
  | { t: "inicio" }
  | { t: "lendo"; passo: string }
  | { t: "previa"; previa: PreviaDisponibilidadeTita; rodada: RodadaRelatorio }
  | { t: "gravando"; feitos: number; total: number }
  | { t: "feito"; rodada: RodadaRelatorio }

export function PainelDisponibilidadeTita({
  catalogo,
  onFechar,
  onGravado,
  onVerHistorico,
}: {
  catalogo: CadastroTerapia[]
  onFechar: () => void
  onGravado: () => void
  onVerHistorico: () => void
}) {
  const hoje = hojeBrasilia()
  const janela = janelaGradeTita(hoje)
  const [vigenteDe, setVigenteDe] = useState(hoje)
  const [fase, setFase] = useState<Fase>({ t: "inicio" })
  const [erro, setErro] = useState<string | null>(null)
  const [frescor, setFrescor] = useState<FrescorGrade | null>(null)
  const { confirmar, dialogo } = useConfirmacao()

  useEffect(() => {
    let vivo = true
    medirFrescorGrade(janela.de, janela.ate, 280).then(f => { if (vivo) setFrescor(f) }).catch(() => {})
    return () => { vivo = false }
  }, [janela.de, janela.ate])

  const lerDoBanco = async (id: string) => {
    const { imp, itens } = await lerImportacaoCompleta(id)
    return rodadaDeDisponibilidade(imp, itens)
  }

  const gerarPrevia = async () => {
    setErro(null)
    try {
      setFase({ t: "lendo", passo: "Lendo a grade do TiTa…" })
      const previa = await prepararPreviaDisponibilidade({ vigenteDe, catalogo, onPasso: passo => setFase({ t: "lendo", passo }) })
      setFase({ t: "previa", previa, rodada: await lerDoBanco(previa.id) })
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setFase({ t: "inicio" })
    }
  }

  const gravar = async () => {
    if (fase.t !== "previa") return
    const { previa } = fase
    if (previa.editadasNoPulsar > 0 && !(await confirmar({
      titulo: "O TiTa prevalece",
      texto: `${previa.editadasNoPulsar === 1 ? "1 profissional tem" : `${previa.editadasNoPulsar} profissionais têm`} disponibilidade editada no Pulsar que será substituída pela do TiTa. A versão editada continua no histórico e pode ser restaurada.`,
      confirmar: "Gravar mesmo assim",
      cancelar: "Revisar",
      t: "aco",
      Icone: Replace,
    }))) return

    setErro(null)
    try {
      const r = await gravarDisponibilidadeTita(previa, (feitos, total) => setFase({ t: "gravando", feitos, total }))
      setFase({ t: "feito", rodada: await lerDoBanco(previa.id) })
      if (r.erros) toast.error(`${r.aplicados} gravados, ${r.erros} com erro — veja no relatório.`, { duration: 8000 })
      else toast.success(previa.aGravar.length ? `Disponibilidade gravada para ${r.aplicados} profissionais` : "Conferido: nada a gravar")
      onGravado()
    } catch (e) {
      // O que já foi gravado fica; gerar outra prévia mostra o que falta.
      setErro(`${e instanceof Error ? e.message : String(e)} — o que já foi gravado fica; gere outra prévia para completar.`)
      setFase({ t: "inicio" })
    }
  }

  const ocupado = fase.t === "lendo" || fase.t === "gravando"

  return (
    <Drawer
      title="Disponibilidade do TiTa"
      subtitle="Grava no Pulsar a disponibilidade de todos conforme a grade do TiTa. Nada é enviado ao TiTa."
      width="min(600px, 95vw)"
      onClose={ocupado ? () => {} : onFechar}
      footer={fase.t === "previa" ? (
        <>
          <button type="button" onClick={() => setFase({ t: "inicio" })} className={btnSecundario}>Voltar</button>
          <button type="button" onClick={gravar} className={btnPrimario}>
            <CloudDownload className="h-4 w-4" aria-hidden />
            {fase.previa.aGravar.length ? `Gravar no Pulsar (${fase.previa.aGravar.length})` : "Registrar conferência"}
          </button>
        </>
      ) : fase.t === "feito" ? (
        <button type="button" onClick={onFechar} className={btnPrimario}>Fechar</button>
      ) : undefined}
    >
      <div className="flex flex-col gap-5 p-5">
        {erro && <InlineNotice tone="red" icon={<AlertCircle className="h-4 w-4" />}>{erro}</InlineNotice>}

        {fase.t === "inicio" && (
          <>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Monta a disponibilidade de cada profissional com a grade do TiTa de {dataBR(janela.de)} a {dataBR(janela.ate)} (Livre e Agendado), do mesmo jeito que o botão “Preencher a partir da grade do TiTa”.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                O TiTa prevalece: quem estiver diferente ganha uma versão nova. A anterior, mesmo editada aqui, fica no histórico e pode ser restaurada.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Nada é gravado antes da prévia. Só roda quando você clica: não há rotina diária.</li>
            </ul>

            {frescor?.visto && (
              <InlineNotice tone={frescor.desatualizado ? "amber" : "green"} icon={frescor.desatualizado ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}>
                {frescor.desatualizado
                  ? `A cópia da grade do TiTa está velha: o dia menos recente foi conferido em ${formatarDataHora(frescor.visto)}. A prévia mostraria um retrato antigo.`
                  : `Cópia da grade do TiTa conferida em ${formatarDataHora(frescor.visto)}.`}
              </InlineNotice>
            )}

            <div className="max-w-[14rem]">
              <span className="text-xs font-semibold text-muted-foreground">Vale a partir de</span>
              <div className="mt-1"><DatePicker value={vigenteDe} onChange={v => setVigenteDe(v || hoje)} min={hoje} /></div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={gerarPrevia} className={btnPrimario}>
                <CloudDownload className="h-4 w-4" aria-hidden /> Gerar prévia
              </button>
              <button type="button" onClick={onVerHistorico} className={btnSecundario}>
                <History className="h-4 w-4" aria-hidden /> Ver gravações anteriores
              </button>
            </div>
          </>
        )}

        {fase.t === "lendo" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {fase.passo}</p>
        )}

        {fase.t === "gravando" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Gravando {fase.feitos} de {fase.total} lotes… não feche esta janela.
          </p>
        )}

        {fase.t === "previa" && (
          <>
            {fase.previa.foraDoCadastro.length > 0 && (
              <InlineNotice tone="amber" icon={<UserX className="h-4 w-4" />}>
                {fase.previa.foraDoCadastro.length === 1 ? "1 profissional da grade do TiTa ainda não está" : `${fase.previa.foraDoCadastro.length} profissionais da grade do TiTa ainda não estão`} no
                cadastro do Pulsar e fica{fase.previa.foraDoCadastro.length === 1 ? "" : "m"} de fora: {fase.previa.foraDoCadastro.join(", ")}. Use “Importar do TiTa” antes, se precisar deles.
              </InlineNotice>
            )}
            <CorpoRelatorio key={fase.previa.id} rodada={fase.rodada} onNavegar={onFechar} />
          </>
        )}

        {fase.t === "feito" && <CorpoRelatorio key={fase.rodada.id} rodada={fase.rodada} onNavegar={onFechar} />}
      </div>
      {dialogo}
    </Drawer>
  )
}
