"use client"

import { useCallback, useMemo, useState } from "react"
import {
  AlertTriangle, CalendarMinus, CalendarPlus, CalendarSync, CheckCircle2, ChevronDown, CloudDownload, History, Loader2,
  Lock, RefreshCw, RotateCcw, SearchX, ShieldCheck, type LucideIcon,
} from "lucide-react"
import toast from "react-hot-toast"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { rodadaDeGrade } from "@/components/tita/adaptadoresRelatorio"
import { CorpoRelatorio, RelatorioSincronizacaoTita, formatarDataHora, type RodadaRelatorio } from "@/components/tita/RelatorioSincronizacaoTita"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import { janelaImportacaoTita } from "@/lib/grade/janelaTita"
import {
  aplicarImportacaoCompleta, atualizarCopiaTita, lerImportacaoGrade, listarImportacoesGrade, listarItensImportacaoGrade,
  previaImportacao, type ImportacaoGrade, type PreviaImportacao,
} from "@/services/grade.service"
import { aviso, btnPrimario, btnSecundario, rotuloCampo } from "./estilo"

// "Importar do TiTa" — SOMENTE LEITURA. Lê a cópia da grade do TiTa que o sync
// já gravou no Supabase (csv_grades_profissionais) e traz para a agenda do
// Pulsar. Nenhuma chamada ao TiTa; nada volta para lá.
//
// Regra (15/10/2026): O TiTa MANDA nas sessões que vieram dele — o que mudou lá
// muda aqui, o que sumiu sai, o que foi excluído aqui e continua lá volta.
// Sessões CRIADAS NO PULSAR nunca são tocadas (o banco recusa).
// Antes da migration 20261016100000 o banco segue a regra antiga ("o Pulsar
// manda", sumidos só com a caixa marcada): a tela detecta e mostra a caixa.

const ROTULO_PENDENCIA = {
  paciente_sem_cadastro: "Paciente sem cadastro no Pulsar",
  profissional_sem_cadastro: "Profissional sem cadastro no Pulsar",
  terapia_sem_catalogo: "Terapia fora do Cadastro de Terapias",
} as const

export function PainelImportarTita({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [janela, setJanela] = useState(() => janelaImportacaoTita())
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null)
  const [lendo, setLendo] = useState(false)
  const [excluirSumidos, setExcluirSumidos] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<RodadaRelatorio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pedindoCopia, setPedindoCopia] = useState(false)
  const [historico, setHistorico] = useState<ImportacaoGrade[] | null>(null)

  // Banco com "o TiTa manda" devolve os contadores novos.
  const regraNova = previa?.contadores.restaurados !== undefined

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

  const pedirCopia = async () => {
    setPedindoCopia(true)
    try {
      await atualizarCopiaTita(janela.inicio, janela.fim)
      toast.success("Cópia pedida ao TiTa. Ele confere um dia por vez (cerca de 1 minuto por dia útil); gere a prévia de novo depois.", { duration: 9000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 })
    } finally {
      setPedindoCopia(false)
    }
  }

  const aplicar = async () => {
    if (!previa) return
    setErro(null)
    try {
      await aplicarImportacaoCompleta(previa, (feitos, total) => setProgresso({ feitos, total }), regraNova || excluirSumidos)
      const [imp, itens] = await Promise.all([lerImportacaoGrade(previa.importacao_id), listarItensImportacaoGrade(previa.importacao_id)])
      setResultado(rodadaDeGrade(imp, itens))
      toast.success("Importação concluída")
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

  const abrirHistorico = async () => {
    try {
      setHistorico(await listarImportacoesGrade(10))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  const rodadasHistorico = useMemo(() => (historico ?? []).map(i => rodadaDeGrade(i)), [historico])
  const detalhar = useCallback(async (r: RodadaRelatorio) => {
    const imp = historico?.find(i => i.id === r.id)
    return imp ? rodadaDeGrade(imp, await listarItensImportacaoGrade(imp.id)) : r
  }, [historico])

  const c = previa?.contadores
  const nada = c && !c.novos && !c.vinculos && !c.bloqueios_novos && !c.sumidos
    && !c.alterados && !c.restaurados && !c.bloqueios_sumidos
  const velha = !!previa?.copia_velha

  if (historico) {
    return (
      <RelatorioSincronizacaoTita
        subtitulo="Agenda trazida da cópia da grade do TiTa."
        rodadas={rodadasHistorico}
        detalhar={detalhar}
        vazio="Nenhuma importação aplicada ainda."
        onClose={() => setHistorico(null)}
      />
    )
  }

  return (
    <Drawer title="Importar do TiTa" subtitle="Lê a grade do TiTa já sincronizada. Nada é enviado ao TiTa." width={600} onClose={progresso ? () => {} : onFechar}
      footer={previa && !resultado && (
        <>
          <button type="button" onClick={() => setPrevia(null)} disabled={!!progresso} className={btnSecundario}>Voltar</button>
          <button type="button" onClick={aplicar} disabled={!!progresso || velha} className={btnPrimario}>
            {progresso ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
            {progresso ? `Aplicando ${progresso.feitos} de ${progresso.total}…` : nada ? "Registrar conferência" : "Aplicar"}
          </button>
        </>
      )}>
      <div className="space-y-5">
        {resultado ? (
          <div className="space-y-4">
            <CorpoRelatorio key={resultado.id} rodada={resultado} onNavegar={onFechar} />
            <button type="button" onClick={onFechar} className={btnPrimario}>Ver a grade</button>
          </div>
        ) : !previa ? (
          <>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Traz as sessões “Agendado” da unidade, agrupadas em séries semanais.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />O TiTa manda nas sessões que vieram dele: o que mudou lá muda aqui, o que saiu de lá sai daqui.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Sessões criadas aqui no Pulsar nunca são tocadas.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />Primeiro você vê a prévia; só depois aplica.</li>
            </ul>
            <div>
              <p className={`${rotuloCampo} mb-1`}>Período a ler</p>
              <DateRangePicker inicio={janela.inicio} fim={janela.fim} onChange={setJanela} />
            </div>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={gerarPrevia} disabled={lendo} className={btnPrimario}>
                {lendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <SearchX className="h-4 w-4" aria-hidden />} Gerar prévia
              </button>
              <button type="button" onClick={abrirHistorico} className={btnSecundario}>
                <History className="h-4 w-4" aria-hidden /> Importações anteriores
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Frescor do que foi lido */}
            <div className={aviso(velha ? "red" : previa.dias_sincronizados >= previa.dias_uteis ? "green" : "amber")}>
              <div className="min-w-0 flex-1 space-y-2">
                <p>
                  {dataBR(previa.janela_inicio)} a {dataBR(previa.janela_fim)} · {previa.dias_sincronizados} de {previa.dias_uteis} dias úteis sincronizados com o TiTa
                  {previa.frescor && ` · última sincronização ${formatarDataHora(previa.frescor)}`}
                  {previa.dias_sincronizados < previa.dias_uteis && " — dias sem sincronização não entram nem contam como “saíram”."}
                </p>
                {velha && (
                  <p className="font-semibold">
                    A cópia está velha: um dia foi conferido em {formatarDataHora(previa.frescor_pior)}. Com o TiTa mandando, ela excluiria
                    sessões que ainda existem. Atualize a cópia e gere a prévia de novo.
                  </p>
                )}
                <button type="button" onClick={pedirCopia} disabled={pedindoCopia} className={btnSecundario}>
                  {pedindoCopia ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  Atualizar a cópia do TiTa agora
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Numero Icone={CalendarPlus} valor={c!.novos} rotulo="sessões novas" apoio={`${c!.series_novas} séries novas`} />
              {regraNova && <Numero Icone={CalendarSync} valor={c!.alterados ?? 0} rotulo="alteradas no TiTa" apoio="a antiga sai, a nova entra" />}
              {regraNova && <Numero Icone={CalendarMinus} valor={c!.sumidos} rotulo="saem" apoio="não estão mais no TiTa" alerta />}
              {regraNova && <Numero Icone={RotateCcw} valor={c!.restaurados ?? 0} rotulo="voltam" apoio="excluídas aqui, ainda no TiTa" alerta={(c!.desfaz_pulsar ?? 0) > 0} />}
              <Numero Icone={Lock} valor={c!.bloqueios_novos + (c!.bloqueios_sumidos ?? 0)} rotulo="bloqueios"
                apoio={regraNova ? `${c!.bloqueios_novos} novos · ${c!.bloqueios_sumidos ?? 0} saem` : "horário bloqueado / administrativo"} />
              <Numero Icone={AlertTriangle} valor={c!.pendencias} rotulo="pendências de cadastro" apoio="não entram" alerta />
            </div>
            <p className="text-xs text-muted-foreground">
              {c!.existentes} já estão iguais no Pulsar
              {regraNova && (c!.ja_no_pulsar ?? 0) > 0 && ` · ${c!.ja_no_pulsar} já foram criadas no Pulsar (ficam como estão)`}
              {c!.vinculos > 0 && ` · ${c!.vinculos} repetições automáticas ganham o id do TiTa`}
              {!regraNova && c!.ignorados ? ` · ${c!.ignorados} ignoradas por série excluída no Pulsar` : ""} · {c!.lidas} sessões lidas.
            </p>

            {regraNova && (c!.desfaz_pulsar ?? 0) > 0 && (
              <p className={aviso("amber")}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {c!.desfaz_pulsar} sessão(ões) excluída(s) aqui voltam, porque o TiTa manda nelas. Para mudar de verdade, mude no TiTa
                  ou crie a sessão aqui no Pulsar.
                </span>
              </p>
            )}

            {!regraNova && c!.sumidos > 0 && (
              <div className="space-y-2 rounded-lg border border-rose-300 p-3 dark:border-rose-800">
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{c!.sumidos} sessões que vieram do TiTa não estão mais lá</p>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={excluirSumidos} onChange={e => setExcluirSumidos(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
                  Excluir no Pulsar também (fica registrado; série que acabou no TiTa é encerrada)
                </label>
              </div>
            )}

            {(previa.alterados?.length ?? 0) > 0 && (
              <Lista titulo={`Alteradas no TiTa (${c!.alterados})`}
                itens={previa.alterados!.map(s => `${s.paciente}: ${s.de} → ${dataBR(s.data)} ${s.hora}${s.sala ? ` · ${s.sala}` : ""} · ${s.profissional}`)} />
            )}
            {previa.sumidos.length > 0 && (
              <Lista titulo={`${regraNova ? "Saem" : "Não estão mais no TiTa"} (${c!.sumidos})`}
                itens={previa.sumidos.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional} (${s.terapia})`)} />
            )}
            {(previa.restaurados?.length ?? 0) > 0 && (
              <Lista titulo={`Voltam (${c!.restaurados})`}
                itens={previa.restaurados!.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional}${s.desfaz_pulsar ? " — excluída aqui por alguém" : ""}`)} />
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
            {(previa.ignorados?.length ?? 0) > 0 && (
              <Lista titulo="Ignoradas (série excluída no Pulsar)" itens={previa.ignorados!.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional}`)} />
            )}
            {previa.novos.length > 0 && (
              <Lista titulo="Exemplos do que entra" itens={previa.novos.map(s => `${dataBR(s.data)} ${s.hora} · ${s.paciente} × ${s.profissional} (${s.terapia})`)} />
            )}

            {nada && <p className="rounded-lg bg-muted px-3 py-3 text-sm text-foreground">Nada a mudar: a agenda do Pulsar já está igual ao TiTa nesse período.</p>}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          </>
        )}
      </div>
    </Drawer>
  )
}

/** Número da prévia: bloco simples, apagado quando zero. */
function Numero({ Icone, valor, rotulo, apoio, alerta = false }: {
  Icone: LucideIcon; valor: number; rotulo: string; apoio: string; alerta?: boolean
}) {
  const realce = alerta && valor > 0
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-border p-3 ${valor ? "" : "opacity-60"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted ${realce ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} aria-hidden>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className={`text-xl font-bold leading-6 tabular-nums ${realce ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
          {valor} <span className="text-sm font-medium">{rotulo}</span>
        </p>
        <p className="text-xs text-muted-foreground">{apoio}</p>
      </div>
    </div>
  )
}

function Lista({ titulo, itens, apoio, aberta = false }: {
  titulo: string; itens: string[]; apoio?: string; aberta?: boolean
}) {
  return (
    <details open={aberta} className="group rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground">
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />{titulo}
      </summary>
      <div className="px-3 pb-3">
        {apoio && <p className="mb-2 text-xs text-muted-foreground">{apoio}</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-foreground">
          {itens.map((t, i) => <li key={i} className="tabular-nums">{t}</li>)}
        </ul>
      </div>
    </details>
  )
}
