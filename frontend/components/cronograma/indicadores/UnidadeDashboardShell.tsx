"use client"

// UnidadeDashboardShell — aba Indicadores › Ocupação Clínica.
//
// Cada unidade responde três perguntas de relance: quanto do espaço tem
// profissional, quanto tem paciente e o que fazer com a diferença. A unidade de
// medida é o horário de cadeira (ver lib/cronograma/ocupacaoClinica.ts), e uma
// barra só carrega os dois números. Detalhe em painel lateral; "Comparar" põe
// as unidades lado a lado numa tabela.
//
// Fonte: useOcupacaoSalas() — o mesmo cruzamento cronograma_salas ×
// grade do TiTa da Ocupação de Salas. Nada aqui grava.

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, Download, Loader2 } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { DatePicker } from "@/components/ui/date-picker"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/useModalLayer"
import { semanaCorrenteRange, useOcupacaoSalas } from "@/hooks/useOcupacaoSalas"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { listarFeriadosDoPeriodo } from "@/services/feriados.service"
import { listarBlocosDetalhados } from "@/lib/cronograma/salas"
import { calcularOcupacaoClinica, fechamentosDaSemana, totalDaRede, type FeriadoSemana, type TurnoClinica } from "@/lib/cronograma/ocupacaoClinica"
import { OcupacaoDetalheModal } from "./OcupacaoDetalheModal"
import { CartaoUnidade, LinhaTerceirizada } from "./ocupacao-clinica/CartaoUnidade"
import { FaixaRede } from "./ocupacao-clinica/FaixaRede"
import { PainelUnidade } from "./ocupacao-clinica/PainelUnidade"
import { TabelaComparar } from "./ocupacao-clinica/TabelaComparar"
import { DestaquesComparacao } from "./ocupacao-clinica/DestaquesComparacao"
import { ChaveVisao } from "./ocupacao-clinica/ChaveVisao"
import { exportarOcupacaoClinica } from "./ocupacao-clinica/exportar"

import type { Visao } from "./ocupacao-clinica/ChaveVisao"

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Segunda a sábado da semana que contém `dataIso` (a grade das salas vai até sábado). */
function semanaDe(dataIso: string): { inicio: string; fim: string } {
  const [y, m, d] = dataIso.split("-").map(Number)
  const dia = new Date(y, m - 1, d)
  const deslocamento = (dia.getDay() + 6) % 7 // segunda = 0 … domingo = 6
  const seg = new Date(y, m - 1, d - deslocamento)
  const sab = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 5)
  return { inicio: iso(seg), fim: iso(sab) }
}

function rotuloSemana(inicio: string, fim: string): string {
  const [y1, m1, d1] = inicio.split("-")
  const [y2, m2, d2] = fim.split("-")
  if (y1 !== y2) return `${d1}/${m1}/${y1} a ${d2}/${m2}/${y2}`
  if (m1 !== m2) return `${d1}/${m1} a ${d2}/${m2}/${y2}`
  return `${d1} a ${d2}/${m2}/${y2}`
}

export function UnidadeDashboardShell() {
  const padrao = useMemo(() => semanaCorrenteRange(), [])
  const [semana, setSemana] = useState(padrao)
  const ocup = useOcupacaoSalas(semana.inicio, semana.fim)
  const { salasComOcupacao, linhas, turnosBloqueioAdmin, loading, error } = ocup
  const { labels: statusLabels } = useStatusLabels()
  const { setRightContent } = useHeader()

  const [visao, setVisao] = useState<Visao>("unidades")
  const [aberta, setAberta] = useState<string | null>(null)
  const [auditoria, setAuditoria] = useState<{ unidade: string; turno: TurnoClinica } | null>(null)

  // Feriados da semana: o horário fechado sai da conta (motor), e o mapa mostra
  // "Feriado" no turno. Sem aviso: a semana com feriado continua comparável.
  // Os números só aparecem depois que os feriados da semana chegam, para não
  // mudarem na frente de quem está olhando.
  const [feriados, setFeriados] = useState<{ inicio: string; lista: FeriadoSemana[] } | null>(null)
  useEffect(() => {
    let cancelado = false
    listarFeriadosDoPeriodo(semana.inicio, semana.fim).then(lista => { if (!cancelado) setFeriados({ inicio: semana.inicio, lista }) })
    return () => { cancelado = true }
  }, [semana.inicio, semana.fim])
  const feriadosProntos = feriados?.inicio === semana.inicio
  const fechamentos = useMemo(
    () => (feriadosProntos ? fechamentosDaSemana(feriados!.lista, semana.inicio) : []),
    [feriadosProntos, feriados, semana.inicio],
  )
  const carregando = loading || !feriadosProntos

  const unidades = useMemo(
    () => (feriadosProntos ? calcularOcupacaoClinica(salasComOcupacao, linhas, turnosBloqueioAdmin, fechamentos) : []),
    [feriadosProntos, salasComOcupacao, linhas, turnosBloqueioAdmin, fechamentos],
  )
  const rede = useMemo(() => totalDaRede(unidades), [unidades])
  const proprias = unidades.filter(u => !u.terceirizada)
  const terceirizadas = unidades.filter(u => u.terceirizada)
  const unidadeAberta = unidades.find(u => u.unidade === aberta) ?? null

  const rotuloStatus = useCallback(
    (codigo: string) => statusLabels[codigo]?.label_curto ?? codigo,
    [statusLabels],
  )

  const exportar = useCallback(() => {
    exportarOcupacaoClinica({ unidades, salasComOcupacao, fechamentos, rotuloStatus, inicio: semana.inicio, fim: semana.fim })
  }, [unidades, salasComOcupacao, fechamentos, rotuloStatus, semana])

  useEffect(() => {
    setRightContent(
      <button type="button" onClick={exportar} disabled={carregando}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 active:scale-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        <Download size={13} />
        Exportar XLSX
      </button>,
    )
    return () => setRightContent(null)
  }, [exportar, carregando, setRightContent])

  const periodo = `Semana de ${rotuloSemana(semana.inicio, semana.fim)}`
  const ehPadrao = semana.inicio === padrao.inicio

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DatePicker
            value={semana.inicio}
            onChange={v => v && setSemana(semanaDe(v))}
            rotuloGatilho={`${periodo} — escolher outra semana`}
            classeGatilho="inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-base font-bold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            conteudoGatilho={<>
              <span className="truncate">{periodo}</span>
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </>}
          />
          <ChaveVisao visao={visao} onChange={setVisao} />
          {!ehPadrao && (
            <button type="button" onClick={() => setSemana(padrao)} className="min-h-10 rounded-lg px-2 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400">
              Voltar à semana padrão
            </button>
          )}
          {carregando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando" />}
        </div>
      </div>

      {error && <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {carregando && unidades.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando a ocupação das unidades...
        </div>
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${carregando ? "opacity-60" : ""}`} aria-busy={carregando}>
          {visao === "unidades" ? (
            <>
              {proprias.length > 0 && (
                <FaixaRede contagem={rede.contagem} salasOperacionais={rede.salasOperacionais} unidades={rede.unidades} pessoasParaAjustar={rede.pessoasParaAjustar} />
              )}
              {/* Colunas automáticas: 3 unidades cabem lado a lado numa tela larga, sem uma sobrar sozinha. */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
                {proprias.map(u => <CartaoUnidade key={u.unidade} unidade={u} fechamentos={fechamentos} onAbrir={() => setAberta(u.unidade)} />)}
              </div>
              {terceirizadas.map(u => <LinhaTerceirizada key={u.unidade} unidade={u} onAbrir={() => setAberta(u.unidade)} />)}
            </>
          ) : (
            <>
              <DestaquesComparacao unidades={proprias} onAbrir={setAberta} />
              <TabelaComparar unidades={unidades} onAbrir={setAberta} />
            </>
          )}

          {!carregando && unidades.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">Nenhuma sala cadastrada na Ocupação de Salas.</p>
          )}
        </div>
      )}

      {unidadeAberta && (
        <PainelUnidade
          unidade={unidadeAberta}
          periodo={periodo}
          fechamentos={fechamentos}
          rotuloStatus={rotuloStatus}
          onAuditoria={turno => setAuditoria({ unidade: unidadeAberta.unidade, turno })}
          onClose={() => setAberta(null)}
        />
      )}

      {auditoria && (
        <OcupacaoDetalheModal
          detalhe={{ tipo: "bloco", unidade: auditoria.unidade, turno: auditoria.turno, linhas: listarBlocosDetalhados(salasComOcupacao, auditoria.unidade, auditoria.turno) }}
          zIndex={Z_MODAL_EMPILHADO}
          onClose={() => setAuditoria(null)}
        />
      )}
    </div>
  )
}
