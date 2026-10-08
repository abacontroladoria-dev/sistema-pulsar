"use client"

import { useState } from "react"
import {
  AlertTriangle, CalendarPlus, CheckCircle2, ChevronDown, CloudDownload, Link2, Loader2, Lock, SearchX,
} from "lucide-react"
import toast from "react-hot-toast"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Comemoracao, NumeroPastel, avisoFeito, tom } from "@/components/ui/pastel/pecas"
import { dataBR, hojeBrasilia, somarDias } from "@/lib/disponibilidadeProfissional"
import { inicioDaSemana } from "@/lib/grade/motor"
import {
  aplicarLote, concluirImportacao, previaImportacao, type AplicadoImportacao, type PreviaImportacao,
} from "@/services/grade.service"

// "Importar do TiTa" — SOMENTE LEITURA. Lê a cópia da grade do TiTa que o sync
// diário já gravou no Supabase (csv_grades_profissionais) e traz para a agenda
// do Pulsar. Nenhuma chamada ao TiTa; nada volta para lá.
//
// Regras que a tela explica: o que foi excluído no Pulsar nunca volta; o que
// sumiu do TiTa só sai daqui se a caixa for marcada; quem não tem cadastro no
// Pulsar fica como pendência.

const LOTE = 15

/** Segunda da semana atual até o fim do mês seguinte (o que o sync cobre), no máximo 120 dias. */
function janelaPadrao() {
  const hoje = hojeBrasilia()
  const inicio = somarDias(inicioDaSemana(hoje), 1)
  const [a, m] = hoje.split("-").map(Number)
  const fimMesSeguinte = new Date(Date.UTC(a, m + 1, 0)).toISOString().slice(0, 10)
  const limite = somarDias(inicio, 120)
  return { inicio, fim: fimMesSeguinte < limite ? fimMesSeguinte : limite }
}

const ROTULO_PENDENCIA = {
  paciente_sem_cadastro: "Paciente sem cadastro no Pulsar",
  profissional_sem_cadastro: "Profissional sem cadastro no Pulsar",
  terapia_sem_catalogo: "Terapia fora do Cadastro de Terapias",
} as const

export function PainelImportarTita({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [janela, setJanela] = useState(janelaPadrao)
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null)
  const [lendo, setLendo] = useState(false)
  const [excluirSumidos, setExcluirSumidos] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<AplicadoImportacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const gerarPrevia = async () => {
    setLendo(true)
    setErro(null)
    setPrevia(null)
    setResultado(null)
    try {
      setPrevia(await previaImportacao(janela.inicio, janela.fim))
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setLendo(false)
    }
  }

  const aplicar = async () => {
    if (!previa) return
    const lotes: number[][] = []
    for (let i = 0; i < previa.profissionais.length; i += LOTE) lotes.push(previa.profissionais.slice(i, i + LOTE))
    setProgresso({ feitos: 0, total: lotes.length })
    setErro(null)
    try {
      for (let i = 0; i < lotes.length; i++) {
        await aplicarLote(previa.importacao_id, excluirSumidos, lotes[i])
        setProgresso({ feitos: i + 1, total: lotes.length })
      }
      const r = lotes.length ? await concluirImportacao(previa.importacao_id) : null
      setResultado(r ?? { vinculos: 0, series_novas: 0, sessoes_novas: 0, bloqueios: 0, sumidos_excluidos: 0, series_encerradas: 0 })
      avisoFeito("Importação concluída")
      onImportado()
    } catch (e) {
      // Lotes aplicados ficam aplicados; reimportar não duplica (o id da sessão do TiTa é a chave).
      const msg = e instanceof Error ? e.message : String(e)
      setErro(`${msg} — o que já foi aplicado fica; gere outra prévia e aplique de novo para completar.`)
      toast.error(msg, { duration: 8000 })
    } finally {
      setProgresso(null)
    }
  }

  const c = previa?.contadores
  const nada = c && !c.novos && !c.vinculos && !c.bloqueios_novos && !c.sumidos

  return (
    <Drawer title="Importar do TiTa" subtitle="Lê a grade do TiTa já sincronizada. Nada é enviado ao TiTa." width={600} onClose={onFechar}
      footer={previa && !resultado && (
        <>
          <button type="button" onClick={() => setPrevia(null)} disabled={!!progresso} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11`}>Voltar</button>
          <button type="button" onClick={aplicar} disabled={!!progresso || !!nada} className={`${tom("violeta")} pp-btn min-h-11`}>
            {progresso ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
            {progresso ? `Aplicando ${progresso.feitos} de ${progresso.total}…` : "Aplicar"}
          </button>
        </>
      )}>
      <div className="pp space-y-5">
        {resultado ? (
          <Comemoracao titulo="Importação concluída" texto={
            `${resultado.sessoes_novas} sessões novas em ${resultado.series_novas} séries, ${resultado.vinculos} vinculadas, ${resultado.bloqueios} bloqueios` +
            (resultado.sumidos_excluidos ? `, ${resultado.sumidos_excluidos} excluídas por não estarem mais no TiTa` : "") + "."}>
            <button type="button" onClick={onFechar} className={`${tom("verde")} pp-btn mt-2 min-h-11`}>Ver a grade</button>
          </Comemoracao>
        ) : !previa ? (
          <>
            <ul className="space-y-2 text-sm font-semibold text-[var(--pp-ink-muted)]">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Traz as sessões “Agendado” da unidade, agrupadas em séries semanais.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />O que foi excluído aqui no Pulsar nunca volta, e nada editado aqui é sobrescrito.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Primeiro você vê a prévia; só depois aplica.</li>
            </ul>
            <div>
              <p className="mb-1 text-xs font-bold text-[var(--pp-ink-muted)]">Período a ler</p>
              <DateRangePicker inicio={janela.inicio} fim={janela.fim} onChange={setJanela} />
            </div>
            {erro && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-400">{erro}</p>}
            <button type="button" onClick={gerarPrevia} disabled={lendo} className={`${tom("violeta")} pp-btn min-h-11`}>
              {lendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <SearchX className="h-4 w-4" aria-hidden />} Gerar prévia
            </button>
          </>
        ) : (
          <>
            {/* Frescor do que foi lido */}
            <p className={`${tom(previa.dias_sincronizados >= previa.dias_uteis ? "verde" : "amber")} rounded-xl bg-[var(--c-suave)] px-3 py-2 text-sm font-semibold text-[var(--c-tinta)]`}>
              {dataBR(previa.janela_inicio)} a {dataBR(previa.janela_fim)} · {previa.dias_sincronizados} de {previa.dias_uteis} dias úteis sincronizados com o TiTa
              {previa.frescor && ` · última sincronização ${new Date(previa.frescor).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`}
              {previa.dias_sincronizados < previa.dias_uteis && " — dias sem sincronização não entram nem contam como “sumidos”."}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumeroPastel compacto t="verde" Icone={CalendarPlus} valor={c!.novos} rotulo="sessões novas" apoio={`${c!.series_novas} séries novas`} apagado={!c!.novos} />
              <NumeroPastel compacto t="aco" Icone={Link2} valor={c!.vinculos} rotulo="vinculadas" apoio="já estavam no Pulsar sem o id do TiTa" apagado={!c!.vinculos} />
              <NumeroPastel compacto t="cinza" Icone={Lock} valor={c!.bloqueios_novos} rotulo="bloqueios" apoio="horário bloqueado / administrativo" apagado={!c!.bloqueios_novos} />
              <NumeroPastel compacto t="amber" Icone={AlertTriangle} valor={c!.pendencias} rotulo="pendências de cadastro" apoio="não entram" apagado={!c!.pendencias} />
            </div>
            <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">
              {c!.existentes} já estão no Pulsar (nada a fazer){c!.ignorados ? ` · ${c!.ignorados} ignoradas por série excluída no Pulsar` : ""} · {c!.lidas} linhas lidas.
            </p>

            {c!.sumidos > 0 && (
              <div className={`${tom("vermelho")} space-y-2 rounded-[18px] bg-[var(--c-suave)] p-4 shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
                <p className="text-sm font-extrabold text-[var(--c-tinta)]">{c!.sumidos} sessões que vieram do TiTa não estão mais lá</p>
                <label className="flex items-start gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={excluirSumidos} onChange={e => setExcluirSumidos(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--pp-foco)]" />
                  Excluir no Pulsar também (fica registrado; série que acabou no TiTa é encerrada)
                </label>
                <Lista titulo="Ver as sessões" itens={previa.sumidos.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional} (${s.terapia})`)} />
              </div>
            )}

            {previa.pendencias.length > 0 && (
              <Lista titulo={`Pendências de cadastro (${previa.pendencias.length})`} aberta
                itens={previa.pendencias.map(p => `${ROTULO_PENDENCIA[p.motivo]}: ${p.nome ?? "?"}${p.tita_id ? ` (id TiTa ${p.tita_id})` : ""} — ${p.sessoes} sessão(ões)`)} />
            )}
            {previa.sem_disponibilidade.length > 0 && (
              <Lista titulo={`Sem disponibilidade cadastrada (${previa.sem_disponibilidade.length})`}
                apoio="As sessões entram, mas a grade não sabe o que é horário livre. Cadastre em Profissionais → Disponibilidade."
                itens={previa.sem_disponibilidade.map(p => `${p.nome} — ${p.sessoes} sessão(ões)`)} />
            )}
            {previa.ignorados.length > 0 && (
              <Lista titulo="Ignoradas (série excluída no Pulsar)" itens={previa.ignorados.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional}`)} />
            )}
            {previa.novos.length > 0 && (
              <Lista titulo="Exemplos do que entra" itens={previa.novos.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional} (${s.terapia})`)} />
            )}

            {nada && <p className="rounded-xl bg-[var(--pp-muted)] px-3 py-3 text-sm font-semibold">Nada novo: a agenda do Pulsar já está igual ao TiTa nesse período.</p>}
            {erro && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-400">{erro}</p>}
          </>
        )}
      </div>
    </Drawer>
  )
}

function Lista({ titulo, itens, apoio, aberta = false }: {
  titulo: string; itens: string[]; apoio?: string; aberta?: boolean
}) {
  return (
    <details open={aberta} className="group rounded-[16px] bg-[var(--pp-surface)] shadow-[inset_0_0_0_1px_var(--pp-border)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-extrabold">
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />{titulo}
      </summary>
      <div className="px-4 pb-3">
        {apoio && <p className="mb-2 text-xs font-semibold text-[var(--pp-ink-muted)]">{apoio}</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {itens.map((t, i) => <li key={i} className="tabular-nums">{t}</li>)}
        </ul>
      </div>
    </details>
  )
}
