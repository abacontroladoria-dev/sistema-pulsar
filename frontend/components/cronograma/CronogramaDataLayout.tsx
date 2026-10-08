"use client"

// CronogramaDataLayout — provedor de dados (CronogramaDataProvider: grade,
// laudos, disponibilidade) + badges de upload do header (CronogramaUploadBadges),
// compartilhado por TODAS as páginas que precisam de cRows/lRows/dispRows via
// useCronogramaData(), esteja a rota sob /cronograma/* ou sob outro segmento
// (ex.: /relacionamento-prestador/*, quando movida — ver
// app/(dashboard)/relacionamento-prestador/(cronograma)/layout.tsx). As
// checagens de página abaixo usam `includes`/`endsWith` no pathname (não um
// prefixo fixo), pra continuar funcionando independente de qual segmento pai
// hospeda a rota.

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import * as XLSX from "xlsx"
import { CronogramaDataProvider, useCronogramaData } from "@/contexts/CronogramaDataContext"
import { useHeader } from "@/contexts/HeaderContext"
import { buscarGradeComoCSVRows, buscarUltimaDataDaGrade } from "@/lib/cronograma/gradeService"
import { parseDisponibilidadeCSV } from "@/lib/cronograma/disponibilidade"
import { getRefWeek, getJanelaOcupacaoPaciente } from "@/lib/cronograma/helpers"
import { CronogramaUploadBadges } from "@/components/cronograma/CronogramaUploadBadges"
import type { LaudoRow, MetaImportacaoLaudos } from "@/types/cronograma"

// Excel de laudos costuma vir com a coluna "Paciente" (ou "ID Favorecido")
// mesclada verticalmente cobrindo todas as linhas de especialidade do mesmo
// paciente — célula mesclada só existe de fato na âncora (canto superior-
// esquerdo) da planilha; as demais ficam ausentes e sheet_to_json(defval:"")
// as preenche com "". Sem desfazer isso ANTES do sheet_to_json, toda linha
// não-âncora perde "Paciente" e é descartada em runAlgorithm (if (!pac)
// continue) — o autorizado dela some do relatório sem erro nenhum.
function desfazerMerges(ws: XLSX.WorkSheet) {
  for (const m of ws['!merges'] ?? []) {
    const anchor = ws[XLSX.utils.encode_cell(m.s)]
    if (!anchor) continue
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (!ws[addr]) ws[addr] = { ...anchor }
      }
    }
  }
}

function parseXlsx<T>(file: File): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        // raw:true evita que o SheetJS "adivinhe" datas ao ler o .xls (que na prática é uma
        // tabela HTML exportada pelo TI): sem isso, datas em formato DD/MM/AAAA com dia <= 12
        // (ex.: "01/07/2026") são reinterpretadas como MM/DD/AAAA e viram outra data (7 de
        // janeiro em vez de 1 de julho) de forma silenciosa. Com raw:true o texto original da
        // célula é preservado como string, igual em todas as linhas.
        const wb = XLSX.read(e.target?.result, { type: "array", raw: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        desfazerMerges(ws)
        resolve(XLSX.utils.sheet_to_json<T>(ws, { defval: "" }))
      } catch (err) { reject(err) }
    }
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."))
    reader.readAsArrayBuffer(file)
  })
}

// Grade vazia no período quase nunca é "sem atendimento": é a sincronização
// diária com o TiTa que não alcançou aquele mês. Dizer até onde a grade vai
// separa uma coisa da outra para quem olha o header.
async function mensagemGradeVazia(periodo: string): Promise<string> {
  const base = `Grade sem registros para ${periodo}`
  try {
    const ultima = await buscarUltimaDataDaGrade()
    if (ultima) {
      const [a, m, d] = ultima.split("-")
      return `${base}. A grade sincronizada vai só até ${d}/${m}/${a}.`
    }
  } catch { /* cai na mensagem simples */ }
  return `${base}.`
}

function CronogramaLayoutInner({ children }: { children: React.ReactNode }) {
  const { cRows, lRows, dispRows, setCRows, setLRows, setDispRows } = useCronogramaData()
  const { setRightContent } = useHeader()
  const [uploading, setUploading] = useState(false)
  const [gradeLoading, setGradeLoading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Erro da grade separado do erro dos laudos: com um estado só, a falha de um
  // escondia o badge do outro e o aviso parecia ser de ambos.
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [dispUploading, setDispUploading] = useState(false)
  const [dispError, setDispError] = useState<string | null>(null)
  // De qual importação do robô vieram os laudos que estão na tela. `null` = não
  // vieram dele (nada carregado, ou arquivo enviado à mão) — e aí o badge não
  // tem frescor de carga automática para mostrar. Não é persistido, igual ao
  // lRows: some no refresh e é recarregado junto.
  const [laudosMeta, setLaudosMeta] = useState<MetaImportacaoLaudos | null>(null)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Indicadores gerencia rightContent por conta própria (não precisa do badge de Laudos no header).
  // Ocupação (Diferença: Laudo e Oferta) PRECISA do badge — ele mostra o estado da carga
  // automática do relatório do Órbita e é a única forma de subir o Excel manualmente quando
  // ela falha; a aba de gaps não funciona sem laudos carregados.
  const isIndicadoresPage = !!pathname?.includes('/indicadores')
  // Ocupação de Salas cruza dados estruturais (cronograma_salas) com a agenda — não depende
  // dos laudos do TI, então o badge "Laudos" não é relevante aqui, mas "Grade" continua sendo.
  const isOcupacaoSalasPage = !!pathname?.includes('/ocupacao-salas')
  const isReposicaoPage = !!pathname?.includes('/reposicao')
  // Disponibilidade só é relevante na aba Novo Cronograma (solicitações ?tab=novo-cron).
  const isNovoCron = !!pathname?.includes('/solicitacoes') && searchParams.get('tab') === 'novo-cron'
  // Ocupação de Paciente busca sua própria grade com getJanelaOcupacaoPaciente() (ver
  // page.tsx da rota), não o cRows deste layout — o badge "Período" precisa mostrar essa
  // janela aqui, senão mostra a janela errada (getRefWeek()) para a única aba que não a usa.
  const isOcupacaoPacientePage = !!pathname?.includes('/ocupacao-paciente')
  // "Oportunidades Recusadas" (ex-"Acompanhamento") não consulta grade nem
  // laudo — é auditoria de recusas (rec/pacBundles/statusMap + tabela de
  // auditoria própria). Os badges de Grade/Laudos/Período não fazem sentido
  // aqui; aceita o valor antigo do tab também, pra links salvos antes da
  // renomeação (2026-08-25) continuarem escondendo o badge certo.
  const isOportunidadesRecusadasTab = !!pathname?.includes('/ocupacao') && !isOcupacaoPacientePage && !isOcupacaoSalasPage &&
    (searchParams.get('tab') === 'oportunidades-recusadas' || searchParams.get('tab') === 'acompanhamento')
  // A Grade (agenda própria do Pulsar) NÃO lê a grade do TiTa nem os laudos ao
  // abrir — decisão do usuário (07/10/2026): o TiTa só entra pelo botão
  // "Importar do TiTa" da própria página. Aqui ela não dispara nenhuma carga nem
  // ocupa o lado direito do header (a página usa o espaço).
  const isGradePage = !!pathname && /\/cronograma\/grade(\/|$)/.test(pathname)
  const gradeFetchedRef = useRef(false)
  const laudosFetchedRef = useRef(false)

  // Carrega a grade (csv_grades_profissionais, sincronizada diariamente) automaticamente
  // ao entrar no módulo. A grade é a fonte canônica no banco — não depende do upload de
  // laudos, então o badge "Grade" (status-only) preenche sozinho nas abas Saída/Ocup.
  useEffect(() => {
    if (isGradePage || gradeFetchedRef.current || cRows.length > 0) return
    gradeFetchedRef.current = true
    const rw = getRefWeek()
    setGradeLoading(true)
    setGradeError(null)
    buscarGradeComoCSVRows(rw.inicio, rw.fim)
      .then(async gradeResult => {
        if (gradeResult.length === 0) throw new Error(await mensagemGradeVazia(rw.label))
        setCRows(gradeResult)
      })
      .catch(e => {
        gradeFetchedRef.current = false // permite nova tentativa (ex.: via upload de laudos)
        setGradeError(e instanceof Error ? e.message : "Erro ao carregar a grade.")
      })
      .finally(() => setGradeLoading(false))
  }, [isGradePage, cRows.length, setCRows])

  // Carrega os laudos automaticamente do relatório do Órbita que o robô hospedado
  // no Coolify grava todo dia no Supabase (orbita_laudos_importacoes +
  // orbita_laudos_relatorio, lidos por services/laudos/relatorio.ts através de
  // /api/laudos). Religado em 2026-08-27: entre 17/07 e 27/08 este efeito só
  // fazia setUploadError(...) para forçar o botão de upload manual, porque a
  // origem anterior — a API de laudos do TI — saiu do ar.
  //
  // Sem `inicio`/`fim`: o relatório do Órbita é um snapshot completo e não tem
  // recorte por período, então o getRefWeek() saiu deste efeito (a rota ainda
  // aceita os parâmetros, e os ignora).
  //
  // O upload manual continua vivo como fallback, e é o
  // `laudosFetchedRef.current = false` no catch que o mantém: sem ele o efeito
  // se dá por executado e o badge fica preso no erro sem permitir nova
  // tentativa.
  useEffect(() => {
    if (isGradePage || laudosFetchedRef.current || lRows.length > 0) return
    laudosFetchedRef.current = true
    setUploading(true)
    setUploadError(null)
    // Barra final porque `trailingSlash: true` no next.config — sem ela a
    // requisição paga um 308 antes de chegar na rota.
    fetch("/api/laudos/")
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.ok) throw new Error("Não foi possível carregar os laudos automaticamente.")
        if (!body.rows?.length) throw new Error("Nenhum laudo encontrado no relatório do Órbita.")
        setLRows(body.rows as LaudoRow[])
        setLaudosMeta((body.meta as MetaImportacaoLaudos | undefined) ?? null)
      })
      .catch(e => {
        laudosFetchedRef.current = false // permite nova tentativa (ex.: via upload manual)
        setLaudosMeta(null)
        setUploadError(e instanceof Error ? e.message : "Erro ao carregar os laudos.")
      })
      .finally(() => setUploading(false))
  }, [isGradePage, lRows.length, setLRows])

  const handleLaudosFile = useCallback(async (file: File) => {
    const rw = getRefWeek()
    setUploading(true)
    setUploadError(null)
    try {
      const lResult = await parseXlsx<LaudoRow>(file)
      if (lResult.length === 0) throw new Error("Nenhuma linha encontrada no arquivo.")
      setLRows(lResult)
      // Arquivo escolhido à mão sobrepõe o relatório do robô: a meta do robô
      // deixa de descrever o que está na tela, e mantê-la faria o badge datar o
      // dado do usuário com a hora da carga automática.
      setLaudosMeta(null)
      // Garante a grade caso o carregamento automático tenha falhado ou ainda não ocorrido.
      if (cRows.length === 0) {
        try {
          const gradeResult = await buscarGradeComoCSVRows(rw.inicio, rw.fim)
          if (gradeResult.length === 0) throw new Error(await mensagemGradeVazia(rw.label))
          setCRows(gradeResult)
          setGradeError(null)
          gradeFetchedRef.current = true
        } catch (e) {
          setGradeError(e instanceof Error ? e.message : "Erro ao carregar a grade.")
        }
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Erro ao processar arquivo.")
    } finally {
      setUploading(false)
    }
  }, [cRows.length, setLRows, setCRows])

  const handleClear = useCallback(() => {
    setCRows([])
    setLRows([])
    setLaudosMeta(null)
    setUploadError(null)
    setGradeError(null)
    laudosFetchedRef.current = false
  }, [setCRows, setLRows])

  const handleDispFile = useCallback(async (file: File) => {
    setDispUploading(true)
    setDispError(null)
    try {
      const text = await file.text() // UTF-8 → acentos corretos do CSV do Órbita
      const rows = parseDisponibilidadeCSV(text)
      if (rows.length === 0) throw new Error("Nenhuma disponibilidade encontrada no arquivo.")
      setDispRows(rows)
    } catch (e) {
      setDispError(e instanceof Error ? e.message : "Erro ao processar a disponibilidade.")
    } finally {
      setDispUploading(false)
    }
  }, [setDispRows])

  const handleClearDisp = useCallback(() => {
    setDispRows([])
    setDispError(null)
  }, [setDispRows])

  useEffect(() => {
    if (isGradePage || isIndicadoresPage || isReposicaoPage || isOportunidadesRecusadasTab) return // página gerencia o próprio rightContent — não interferir
    setRightContent(
      <CronogramaUploadBadges
        cRows={cRows}
        lRows={lRows}
        gradeLoading={gradeLoading}
        loading={uploading}
        error={uploadError}
        gradeError={gradeError}
        onSelectFile={handleLaudosFile}
        onClear={handleClear}
        showLaudos={!isOcupacaoSalasPage}
        showDisponibilidade={isNovoCron}
        dispRows={dispRows}
        dispLoading={dispUploading}
        dispError={dispError}
        onSelectDisp={handleDispFile}
        onClearDisp={handleClearDisp}
        periodLabel={isOcupacaoPacientePage ? getJanelaOcupacaoPaciente().label : undefined}
        laudosMeta={laudosMeta}
      />
    )
    return () => setRightContent(null)
  }, [cRows, lRows, dispRows, uploading, gradeLoading, uploadError, gradeError, dispUploading, dispError, laudosMeta, handleLaudosFile, handleClear, handleDispFile, handleClearDisp, setRightContent, isGradePage, isIndicadoresPage, isOcupacaoSalasPage, isReposicaoPage, isNovoCron, isOcupacaoPacientePage, isOportunidadesRecusadasTab])

  return <div>{children}</div>
}

export function CronogramaDataLayout({ children }: { children: React.ReactNode }) {
  return (
    <CronogramaDataProvider>
      <CronogramaLayoutInner>{children}</CronogramaLayoutInner>
    </CronogramaDataProvider>
  )
}
