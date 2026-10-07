"use client"

// Controles da fonte de dados das abas RP e Individual, injetados no header.
//
// A grade vem do BANCO por padrão (vw_grade_base, via buscarGradeParaRP) — é o
// mesmo dado que o CSV exportado do TiTa, capturado todo dia pelo sync. O
// upload continua aqui como alternativa manual: cobre períodos anteriores ao
// início da captura de execução e o dia em que o sync falhar. Quem carregou por
// último vence.
//
// O relatório de PE (agendamentos_profissionais) não tem equivalente no banco e
// segue exclusivamente por upload.

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Upload, Loader2, X, RefreshCw, Database, AlertTriangle } from "lucide-react"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import { validarModeloRelatorio, parseHtmlTable, type CsvGradeRow } from "@/lib/remuneracao/relatorio"
import { parseGradeCsv } from "@/lib/remuneracao/uploadParsers"
import { periodoDoMes, type PeriodoRP, type ControlesGradeRP } from "@/hooks/useRemuneracao"
import { SeletorMesPrevisao } from "@/components/cronograma/indicadores/SeletorMesPrevisao"
import { GradeIncompletaModal } from "./GradeIncompletaModal"

function parsePeFile(file: File): Promise<CsvGradeRow[]> {
  const isExcel = /\.(xls|xlsx)$/i.test(file.name)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."))
    reader.onload = ev => {
      let parsed: CsvGradeRow[] = []
      try {
        if (isExcel) {
          const wb = XLSX.read(ev.target?.result, { type: "array" })
          const ws = wb.Sheets[wb.SheetNames[0]]
          parsed = XLSX.utils.sheet_to_json<CsvGradeRow>(ws, { defval: "" })
        } else {
          const text = String(ev.target?.result || "")
          parsed = parseHtmlTable(text) as unknown as CsvGradeRow[]
          if (!parsed.length && /\.csv$/i.test(file.name)) {
            parsed = Papa.parse<CsvGradeRow>(text, { header: true, skipEmptyLines: true }).data
          }
          if (!parsed.length) {
            const wb = XLSX.read(text, { type: "string" })
            const ws = wb.Sheets[wb.SheetNames[0]]
            parsed = XLSX.utils.sheet_to_json<CsvGradeRow>(ws, { defval: "" })
          }
        }
      } catch {
        reject(new Error("Não consegui ler o relatório de PE/disponibilidade. Envie CSV, XLS, XLSX ou HTML com tabela."))
        return
      }
      const validacao = validarModeloRelatorio("pe", parsed)
      if (!validacao.ok && validacao.faltantes.length) {
        reject(new Error(`Modelo do arquivo mudou. Colunas esperadas não encontradas: ${validacao.faltantes.join(", ")}.`))
        return
      }
      resolve(parsed)
    }
    if (isExcel) reader.readAsArrayBuffer(file)
    else reader.readAsText(file, "UTF-8")
  })
}

/** "2026-07-01" → "01/07". */
function diaMes(iso: string): string {
  const [, m, d] = iso.split("-")
  return d && m ? `${d}/${m}` : iso
}

const BOTAO_PILULA = "flex items-center gap-1.5 rounded-full border border-dashed border-[#2A92C0]/60 bg-[#2A92C0]/5 text-[#2A92C0] hover:bg-[#2A92C0]/10 px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"

interface Props {
  c: ControlesGradeRP
  // Esconde o badge de "Upload PE" — usado na aba Entregas PEP, onde a PEP do
  // Analista do Comportamento vem do registro manual, não desse relatório.
  hidePe?: boolean
  // Esconde a linha de status da grade (badge "Grade · N registros", aviso
  // "N sem execução" e o botão "CSV") — usado na aba Entregas PEP, onde essa
  // leitura é só suporte e a linha competia com o seletor de mês.
  hideStatusRow?: boolean
}

// Recebe por prop, não por contexto: o header renderiza este componente fora do
// RemuneracaoRPProvider. Ver o comentário de `controlesGrade` em useRemuneracao.ts.
export function RemuneracaoUploadBadges({ c, hidePe = false, hideStatusRow = false }: Props) {
  const {
    evoRows, peRows, csvName, carregarGrade, carregarPE, limparGrade, limparPE,
    fonteGrade, periodo, setPeriodo, periodoCarregado, coberturaGrade,
    carregarGradeDoBanco, carregarGradeAuto, gradeLoading,
    gradeErro, gradeErroResumo, gradeErroDica, gradeErroQtd, gradeAviso,
  } = c

  const gradeInputRef = useRef<HTMLInputElement>(null)
  const peInputRef = useRef<HTMLInputElement>(null)

  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadErro, setUploadErro] = useState<string | null>(null)
  const [peLoading, setPeLoading] = useState(false)
  const [peError, setPeError] = useState<string | null>(null)
  const [modalAberto, setModalAberto] = useState(false)

  // Primeira carga automática. Fica aqui, e não no provider, porque o provider
  // vive no layout do segmento — e este componente só monta nas duas abas que
  // realmente usam a grade, não em /analise nem em /legenda.
  useEffect(() => { carregarGradeAuto() }, [carregarGradeAuto])

  const gradeLoaded = evoRows.length > 0
  const peLoaded = peRows.length > 0
  const ocupado = gradeLoading || uploadLoading

  const [ano, mes] = periodo.de.split("-").map(Number)
  const desatualizado = fonteGrade !== "banco"
    || !periodoCarregado
    || periodoCarregado.de !== periodo.de
    || periodoCarregado.ate !== periodo.ate

  function irParaMes(a: number, m: number) {
    const p = periodoDoMes(a, m)
    setPeriodo(p)
    void carregarGradeDoBanco(p)
  }

  function ajustarData(campo: keyof PeriodoRP, valor: string) {
    setPeriodo({ ...periodo, [campo]: valor })
  }

  async function onGradeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setUploadLoading(true)
    setUploadErro(null)
    try {
      const rows = await parseGradeCsv(file)
      // Aguardado: carregarGrade lê a presença do período do arquivo antes de
      // publicar as linhas, e é esse trecho que o "Lendo..." deste botão precisa
      // cobrir. Sem o await, o botão voltava ao normal com a leitura em voo.
      await carregarGrade(rows, file.name)
    } catch (err) {
      setUploadErro(err instanceof Error ? err.message : "Falha ao ler o arquivo.")
    } finally {
      setUploadLoading(false)
    }
  }

  async function onPeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setPeLoading(true)
    setPeError(null)
    try {
      const rows = await parsePeFile(file)
      carregarPE(rows, file.name)
    } catch (err) {
      setPeError(err instanceof Error ? err.message : "Falha ao ler o arquivo.")
    } finally {
      setPeLoading(false)
    }
  }

  const erroDeUpload = uploadErro || peError

  // Abre sozinho quando uma carga TERMINA reprovada — é a hora em que a pessoa
  // está olhando e ainda não sabe por que a tela está vazia. A chave inclui o
  // período para que trocar de mês e reprovar de novo reabra; sem ela, fechar
  // uma vez silenciaria todos os meses seguintes.
  const chaveReprovacao = gradeErroResumo ? `${gradeErroResumo}|${periodo.de}|${periodo.ate}` : null
  const ultimaReprovacaoVista = useRef<string | null>(null)
  useEffect(() => {
    if (chaveReprovacao && chaveReprovacao !== ultimaReprovacaoVista.current) {
      ultimaReprovacaoVista.current = chaveReprovacao
      setModalAberto(true)
    }
    if (!chaveReprovacao) ultimaReprovacaoVista.current = null
  }, [chaveReprovacao])

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Período da leitura do banco */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SeletorMesPrevisao ano={ano} mes={mes} onChange={irParaMes} />

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1 text-[11px] text-muted-foreground">
          <input
            type="date"
            value={periodo.de}
            onChange={e => ajustarData("de", e.target.value)}
            className="bg-transparent text-foreground outline-none"
            aria-label="Data inicial"
          />
          <span>→</span>
          <input
            type="date"
            value={periodo.ate}
            onChange={e => ajustarData("ate", e.target.value)}
            className="bg-transparent text-foreground outline-none"
            aria-label="Data final"
          />
        </div>

        <button
          type="button"
          onClick={() => !ocupado && carregarGradeDoBanco()}
          disabled={ocupado}
          className={
            desatualizado
              ? "flex items-center gap-1.5 rounded-full bg-[#2A92C0] px-3 py-1 text-xs font-semibold text-white transition-all hover:bg-[#2A92C0]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              : "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed"
          }
        >
          {gradeLoading
            ? <Loader2 size={11} className="animate-spin" />
            : desatualizado ? <Database size={11} /> : <RefreshCw size={11} />}
          {gradeLoading ? "Lendo..." : desatualizado ? "Carregar" : "Atualizar"}
        </button>
      </div>

      <input ref={gradeInputRef} type="file" accept=".csv" className="hidden" onChange={onGradeChange} />
      <input ref={peInputRef} type="file" accept=".csv,.xls,.xlsx,.html" className="hidden" onChange={onPeChange} />

      {!hideStatusRow && (
      <div className="flex items-center gap-2">
        {/* Badge 1: Grade */}
        {gradeLoaded ? (
          <span className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 px-3 py-1 text-xs font-medium">
            <CheckCircle2 size={11} className="text-green-500" />
            Grade · {evoRows.length.toLocaleString("pt-BR")} registros
            <span className="text-green-600/70 dark:text-green-500/70">
              {fonteGrade === "banco" && periodoCarregado
                ? `· ${diaMes(periodoCarregado.de)} a ${diaMes(periodoCarregado.ate)}`
                : csvName ? `· ${csvName}` : ""}
            </span>
            <button onClick={limparGrade} className="ml-0.5 text-green-600/50 hover:text-destructive transition-colors" title="Remover Grade">
              <X size={11} />
            </button>
          </span>
        ) : gradeErroResumo ? (
          // Alça para reabrir o modal. O cabeçalho nunca carrega a explicação:
          // ela não cabe em uma linha, e foi assim que este bloco passou por
          // cima dos controles.
          <button
            type="button"
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <AlertTriangle size={11} aria-hidden />
            {gradeErroResumo}
            {gradeErroQtd !== undefined && (
              <span className="tabular-nums font-semibold">· {gradeErroQtd.toLocaleString("pt-BR")}</span>
            )}
          </button>
        ) : (
          // Sem spinner: quem mostra progresso é o botão que foi acionado, e o
          // corpo da página. Três indicadores para uma carga só era ruído.
          <span className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            <Database size={11} />
            Sem grade carregada
          </span>
        )}

        {/* Sessões que o banco não sabe se aconteceram — não some dentro do
            balde "Não evoluído", que é o maior da tela. O detalhamento
            (gradeAviso) vai no title, não numa linha própria: o header tem
            altura fixa, e uma terceira linha de texto estourava essa altura
            e vazava visualmente para fora da caixa. */}
        {fonteGrade === "banco" && coberturaGrade && coberturaGrade.semExecucao > 0 && (
          <span
            className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
            title={gradeAviso ?? "Sessões agendadas sem execução registrada no banco. Entram no cálculo como não evoluídas."}
          >
            <AlertTriangle size={10} />
            {coberturaGrade.semExecucao.toLocaleString("pt-BR")} sem execução
          </span>
        )}

        {/* Upload manual da grade — alternativa, não o caminho principal */}
        <button
          onClick={() => !ocupado && gradeInputRef.current?.click()}
          disabled={ocupado}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          title="Substituir pela grade de um arquivo CSV exportado do TiTa"
        >
          {uploadLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          {uploadLoading ? "Lendo..." : "CSV"}
        </button>

        {/* Badge 2: PE — some inteiro na aba Entregas PEP (hidePe), já que a
            fonte da PEP do Analista do Comportamento é o registro manual. */}
        {!hidePe && (
          peLoaded ? (
            <span className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 px-3 py-1 text-xs font-medium">
              <CheckCircle2 size={11} className="text-green-500" />
              PE · {peRows.length.toLocaleString("pt-BR")} registros
              <button onClick={limparPE} className="ml-0.5 text-green-600/50 hover:text-destructive transition-colors" title="Remover PE">
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => !peLoading && peInputRef.current?.click()}
              disabled={peLoading}
              className={BOTAO_PILULA}
            >
              {peLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {peLoading ? "Lendo..." : "Upload PE"}
            </button>
          )
        )}

        {/* Falha de upload é curta e local ao botão que a causou. Vira badge,
            não parágrafo: o header tem altura fixa (h-20) e uma linha extra
            de texto vazava para fora da caixa — o texto completo mora no
            title. */}
        {erroDeUpload && (
          <span
            className="flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-[11px] font-medium text-destructive"
            title={erroDeUpload}
          >
            <AlertTriangle size={10} />
            Falha no upload
          </span>
        )}
      </div>
      )}

      <GradeIncompletaModal
        aberto={modalAberto}
        onOpenChange={setModalAberto}
        resumo={gradeErroResumo ?? ""}
        erro={gradeErro ?? ""}
        dica={gradeErroDica ?? ""}
        quantidade={gradeErroQtd}
        periodo={periodo}
        carregando={gradeLoading}
        onRecarregar={() => { void carregarGradeDoBanco() }}
        onUsarCsv={() => { setModalAberto(false); gradeInputRef.current?.click() }}
      />
    </div>
  )
}
