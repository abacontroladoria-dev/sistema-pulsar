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
import { buscarGradeTitaAoVivo, filtrarLivresSemGradeAberta } from "@/lib/cronograma/gradeTitaOcupacao"
import { reconciliarAgendadosComAgendaTita } from "@/lib/cronograma/reconciliarAgendaTita"
import { construirSuspensaoTemporaria, type SuspensaoLinkInfo } from "@/lib/cronograma/suspensaoTemporaria"
import { getJanelaOcupacaoPaciente } from "@/lib/cronograma/helpers"
import { LIMITE_PACIENTES_CC_PADRAO, type CarteiraCC } from "@/lib/cronograma/coordenadorCaso"
import { buscarCarteiraCoordenadorCaso, buscarLimiteCoordenadorCaso } from "@/lib/cronograma/coordenadorCasoCarga"
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
  // Para qual grade/laudo os bloqueios do cadastro já foram lidos. Enquanto
  // não baterem com os atuais, o "Criar Novo" espera — para não gerar
  // sugestão de especialidade suspensa/com alta.
  const [bloqueiosDe, setBloqueiosDe] = useState<{ cRows: CsvRow[]; lRows: unknown[] } | null>(null)
  // Não deu para conferir suspensões/altas do cadastro: aviso na página.
  const [bloqueiosFalhou, setBloqueiosFalhou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Quantas horas faz que o TiTa não reconfirma a grade desta janela. Ver o
  // aviso mais abaixo e medirFrescorGrade() em lib/grade/fonte.ts.
  const [gradeVelhaHoras, setGradeVelhaHoras] = useState<number | null>(null)
  const fetchedRef = useRef(false)
  const [modo, setModo] = useState<ModoOcupacao>("aumentar")
  // Carteira dos Coordenadores de Caso: undefined = carregando, null = falhou.
  // Ver coordenadorCaso.ts — "Aumentar" e "Criar Novo" usam; "Orçamento" não.
  const [carteiraCC, setCarteiraCC] = useState<CarteiraCC | null | undefined>(undefined)
  const [limiteCC, setLimiteCC] = useState(LIMITE_PACIENTES_CC_PADRAO)

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

    // Em paralelo e sem travar a grade: falhar aqui só tira o Coordenador de
    // Caso das sugestões (não dá para conferir o teto de pacientes sem ela).
    void buscarCarteiraCoordenadorCaso(janela.fim)
      .then(setCarteiraCC)
      .catch(e => {
        console.error("[ocupacao-paciente] carteira dos Coordenadores de Caso", e)
        setCarteiraCC(null)
      })
    void buscarLimiteCoordenadorCaso().then(setLimiteCC)

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
    // A grade em que a filtragem se apoia é pedida ao TiTa NA HORA, e já aqui,
    // antes da grade e da agenda: são ~7s que correm em paralelo em vez de se
    // somarem. A cópia do banco é de madrugada, e o TiTa muda durante o dia —
    // caso Lívia dos Santos Barboza, 19/10/2026: quarta refeita na Fazendinha
    // às 14:10, ofertada como Realengo até a madrugada seguinte. Se o TiTa não
    // responder, a filtragem usa a cópia, como antes. Ver gradeTitaOcupacao.ts.
    const gradeAoVivo = buscarGradeTitaAoVivo(janela.inicio, janela.fim)
    buscarGradeComoCSVRows(janela.inicio, janela.fim)
      .then(rows => reconciliarAgendadosComAgendaTita(rows, janela.inicio, janela.fim))
      .then(rows => filtrarLivresSemGradeAberta(rows, janela.inicio, janela.fim, gradeAoVivo))
      .then(rows => setCRows(rows))
      .catch(e => {
        fetchedRef.current = false
        setErro(e instanceof Error ? e.message : "Erro ao carregar a grade.")
      })
  }, [])

  // Bloqueios do cadastro (suspensão temporária, alta registrada, alta
  // clínica) — uma consulta só, compartilhada por "Aumentar Cronograma" e
  // "Criar Novo Cronograma" (ver suspensaoTemporaria.ts). Depende da grade E do
  // laudo: o paciente do "Criar Novo" só é achado pelo ID Favorecido do laudo,
  // que pode chegar depois da grade. "Orçamento" não recebe: usa paciente
  // sintético ("Simulação"), sem cadastro.
  useEffect(() => {
    if (cRows.length === 0 && lRows.length === 0) return
    let ativo = true
    construirSuspensaoTemporaria(cRows, lRows)
      .then(({ set, info, erro }) => {
        if (!ativo) return
        setSuspensaoSet(set)
        setSuspensaoInfo(info)
        setBloqueiosFalhou(!!erro)
      })
      .catch(e => {
        console.error("[ocupacao-paciente] bloqueios do cadastro", e)
        if (ativo) setBloqueiosFalhou(true)
      })
      .finally(() => { if (ativo) setBloqueiosDe({ cRows, lRows }) })
    return () => { ativo = false }
  }, [cRows, lRows])
  const bloqueiosCarregando = bloqueiosDe?.cRows !== cRows || bloqueiosDe?.lRows !== lRows

  // O relatório de laudos é pré-requisito das TRÊS modalidades, não um dado
  // opcional: "Aumentar Cronograma" mede déficit contra a quantidade autorizada,
  // "Criar Novo Cronograma" monta a lista de elegíveis a partir do laudo (e tira
  // dele o ID Favorecido usado para gravar no TiTa), e o "Orçamento" compara o
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
          O TiTa não reconfirma estes dias há {Math.floor(gradeVelhaHoras / 24) >= 1
            ? `${Math.floor(gradeVelhaHoras / 24)} dia(s)`
            : `${Math.round(gradeVelhaHoras)} hora(s)`}
          . Pode faltar sessão recém-remarcada e sobrar horário que já foi ocupado —
          confira no TiTa antes de confirmar implantação.
        </div>
      )}

      {/* Sem o cadastro, especialidade suspensa ou com alta aparece como
          liberada — o operador precisa saber antes de ligar para a família. */}
      {bloqueiosFalhou && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong className="font-semibold">Suspensões e altas não conferidas.</strong>{" "}
          Não foi possível ler o cadastro dos pacientes, então especialidade suspensa ou com alta
          pode aparecer como sugestão. Entre com seu usuário e recarregue a página.
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
        <OcupPacMode cRows={cRows} lRows={lRows} cfg={cfg} rec={rec} inv={inv} sRec={sRec} sInv={sInv} suspensaoSet={suspensaoSet} suspensaoInfo={suspensaoInfo} carteiraCC={carteiraCC} limiteCC={limiteCC} />
      )}
      {laudosCarregados && modo === "novo" && (
        <CriarNovoCronogramaPacMode cRows={cRows} lRows={lRows} suspensaoSet={suspensaoSet} suspensaoInfo={suspensaoInfo} bloqueiosCarregando={bloqueiosCarregando} carteiraCC={carteiraCC} limiteCC={limiteCC} />
      )}
      {laudosCarregados && modo === "orcamento" && <OrcamentoPacMode cRows={cRows} />}
    </>
  )
}
