"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarPlus, CalendarRange, Calculator } from "lucide-react"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { useHeader } from "@/contexts/HeaderContext"
import { OcupPacMode } from "@/components/cronograma/solicitacoes/OcupPacMode"
import { CriarNovoCronogramaPacMode } from "@/components/cronograma/solicitacoes/CriarNovoCronogramaPacMode"
import { OrcamentoPacMode } from "@/components/cronograma/solicitacoes/OrcamentoPacMode"
import { WorkspaceEmptyState } from "@/components/cronograma/ui/CronogramaWorkspace"
import { buscarGradeComoCSVRows } from "@/lib/cronograma/gradeService"
import { medirFrescorGrade } from "@/lib/grade/fonte"
import { filtrarLivresSemGradeAberta } from "@/lib/cronograma/gradeTitaOcupacao"
import { reconciliarAgendadosComAgendaTita } from "@/lib/cronograma/reconciliarAgendaTita"
import { construirSuspensaoTemporaria, type SuspensaoLinkInfo } from "@/lib/cronograma/suspensaoTemporaria"
import { getJanelaOcupacaoPaciente } from "@/lib/cronograma/helpers"
import type { CsvRow } from "@/types/cronograma"

type ModoOcupacao = "aumentar" | "novo" | "orcamento"

const MODOS: { key: ModoOcupacao; label: string; icon: typeof CalendarPlus }[] = [
  { key: "aumentar", label: "Aumentar Cronograma", icon: CalendarPlus },
  { key: "novo", label: "Criar Novo Cronograma", icon: CalendarRange },
  { key: "orcamento", label: "Orçamento", icon: Calculator },
]

// Ocupação de Paciente precisa de uma janela de grade diferente do resto do
// módulo Cronograma (ver getJanelaOcupacaoPaciente) — por isso busca a sua
// própria cópia aqui em vez de usar o cRows compartilhado por
// CronogramaDataProvider (usado pelas outras abas via layout.tsx, com a janela
// getRefWeek() inalterada). As três modalidades compartilham essa mesma cópia.
export default function OcupacaoPacientePage() {
  const { lRows, cfg, rec, inv, sRec, sInv } = useCronogramaData()
  const { setHeader } = useHeader()
  const [cRows, setCRows] = useState<CsvRow[]>([])
  const [suspensaoSet, setSuspensaoSet] = useState<Set<string>>(new Set())
  const [suspensaoInfo, setSuspensaoInfo] = useState<Map<string, SuspensaoLinkInfo>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  // Quantas horas faz que a TiTa não reconfirma a grade desta janela. Ver o
  // aviso mais abaixo e medirFrescorGrade() em lib/grade/fonte.ts.
  const [gradeVelhaHoras, setGradeVelhaHoras] = useState<number | null>(null)
  const fetchedRef = useRef(false)
  const [modo, setModo] = useState<ModoOcupacao>("aumentar")

  useEffect(() => {
    setHeader("Ocupação · Paciente", "Aumente a ocupação de sessões por paciente")
  }, [setHeader])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    const janela = getJanelaOcupacaoPaciente()

    // Frescor da captura, em paralelo e sem travar a tela: uma consulta de UMA
    // linha. Em 10/09/2026 esta janela ficou 9 dias congelada em silêncio — o
    // sync morria todo dia e ninguém via, porque o cron descarta a resposta.
    // Falhar aqui não pode esconder a grade, então o catch é mudo de propósito.
    void medirFrescorGrade(janela.inicio, janela.fim, 280)
      .then(f => setGradeVelhaHoras(f.desatualizado ? f.horas : null))
      .catch(() => {})

    // Duas correções sobre a mesma cópia, e elas atacam lados opostos:
    //
    //   reconciliarAgendadosComAgendaTita — o que JÁ EXISTE. O CSV de
    //     agendamentos atrasa (em 10/09/2026 ficou 9 dias congelado, calado), e
    //     aí some sessão remarcada e sobra horário velho. Para linha Agendado,
    //     quem manda é a agenda_tita.
    //   filtrarLivresSemGradeAberta — o que é OFERTÁVEL. O CSV sozinho oferecia
    //     horário já ocupado (C1) e horário em que a profissional não tem grade
    //     aberta (C2, caso Evelyn Andressa na segunda de manhã).
    //
    // A ordem importa: reconciliar ANTES de filtrar. A C1 pergunta "este horário
    // já está ocupado?" olhando as linhas Agendado — rodando sobre o Agendado
    // velho do CSV, ela decidiria por um retrato desatualizado.
    //
    // Ver os cabeçalhos de reconciliarAgendaTita.ts e gradeTitaOcupacao.ts.
    // Aplicado aqui, na origem da cópia, para valer nas três modalidades sem
    // alterar assinatura de nenhuma função do módulo — e sem alcançar a
    // Simulação de Novo Prestador, que lê o cRows do CronogramaDataProvider.
    //
    // O Set de suspensão temporária é montado do mesmo jeito, na mesma origem
    // — uma consulta só, compartilhada por "Aumentar Cronograma" e "Criar Novo
    // Cronograma" (ver suspensaoTemporaria.ts). "Orçamento" não recebe: usa
    // paciente sintético ("Simulação"), sem id_paciente_pulsar real.
    buscarGradeComoCSVRows(janela.inicio, janela.fim)
      .then(rows => reconciliarAgendadosComAgendaTita(rows, janela.inicio, janela.fim))
      .then(rows => filtrarLivresSemGradeAberta(rows, janela.inicio))
      .then(rows => {
        setCRows(rows)
        void construirSuspensaoTemporaria(rows).then(({ set, info }) => {
          setSuspensaoSet(set)
          setSuspensaoInfo(info)
        })
      })
      .catch(e => {
        fetchedRef.current = false
        setErro(e instanceof Error ? e.message : "Erro ao carregar a grade.")
      })
  }, [])

  // O relatório de laudos é pré-requisito das TRÊS modalidades, não um dado
  // opcional: "Aumentar Cronograma" mede déficit contra a quantidade autorizada,
  // "Criar Novo Cronograma" monta a lista de elegíveis a partir do laudo (e tira
  // dele o ID Favorecido usado para gravar na TiTa), e o "Orçamento" compara o
  // simulado com o autorizado. Sem ele, as telas responderiam com números
  // silenciosamente errados — então a página inteira fica travada até o anexo,
  // em vez de deixar consultar e induzir a decisão equivocada.
  const laudosCarregados = lRows.length > 0

  return (
    <>
      {erro && <p className="pb-2 text-sm text-destructive">{erro}</p>}

      {/* Grade velha é pior que grade vazia: a tela continua respondendo, com o
          retrato de dias atrás. Some sessão que existe e oferta horário que já
          foi ocupado — sem nada em tela, o operador liga para a família antes de
          descobrir. Âmbar, não vermelho: a tela funciona, o dado é que atrasou. */}
      {gradeVelhaHoras !== null && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong className="font-semibold">Grade desatualizada.</strong>{" "}
          A TiTa não reconfirma estes dias há {Math.floor(gradeVelhaHoras / 24) >= 1
            ? `${Math.floor(gradeVelhaHoras / 24)} dia(s)`
            : `${Math.round(gradeVelhaHoras)} hora(s)`}
          . Pode faltar sessão recém-remarcada e sobrar horário que já foi ocupado —
          confira na TiTa antes de confirmar implantação.
        </div>
      )}

      {/* Alternador de modalidade — alinhado ao eixo esquerdo do conteúdo (o
          layout do dashboard já dá o p-6; nada de padding extra aqui, senão a
          workbench bar de cada modo desalinha da barra do Modo 1). */}
      <div className="mb-3">
        <div className="inline-flex items-center gap-1 bg-slate-100 rounded-2xl p-1">
          {MODOS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setModo(key)}
              disabled={!laudosCarregados}
              aria-disabled={!laudosCarregados}
              title={laudosCarregados ? undefined : "Anexe o relatório de laudos para liberar"}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                !laudosCarregados ? "text-slate-400 cursor-not-allowed"
                  : modo === key ? "bg-white text-brand-fg shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {!laudosCarregados && (
        <WorkspaceEmptyState
          emoji="📋"
          titulo="Anexe o relatório de laudos para começar"
          subtitulo="Use o badge “Laudos” no topo da página. As três modalidades dependem das quantidades autorizadas do laudo, por isso ficam bloqueadas até o anexo."
        />
      )}

      {laudosCarregados && modo === "aumentar" && (
        <OcupPacMode cRows={cRows} lRows={lRows} cfg={cfg} rec={rec} inv={inv} sRec={sRec} sInv={sInv} suspensaoSet={suspensaoSet} suspensaoInfo={suspensaoInfo} />
      )}
      {laudosCarregados && modo === "novo" && (
        <CriarNovoCronogramaPacMode cRows={cRows} lRows={lRows} suspensaoSet={suspensaoSet} />
      )}
      {laudosCarregados && modo === "orcamento" && <OrcamentoPacMode cRows={cRows} />}
    </>
  )
}
