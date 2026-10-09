"use client"

import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react"
import Link from "next/link"
import toast from "react-hot-toast"
import { useHeader } from "@/contexts/HeaderContext"
import { getFotoUrlAssinada, precarregarFotosAssinadas } from "@/services/pacientesFoto.service"
import {
  Search,
  UserPlus,
  AlertCircle,
  History,
  IdCard,
  Cake,
  Phone,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Check,
  X,
  GraduationCap,
  ChevronDown,
  FileSignature,
  CloudDownload,
  Loader2,
} from "lucide-react"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { usePacientes, refetchPacientes } from "@/hooks/usePacientes"
import {
  importarPacientesDaTita,
  getUltimaImportacaoPacientes,
  getHistoricoImportacoesPacientes,
} from "@/services/pacientes.service"
import type { PacienteImportacaoLog } from "@/types/pacienteImportacao"
import { ModalDetalheImportacao } from "./pacientes/ModalDetalheImportacao"
import type { ResumoEscolar } from "@/services/pacienteDadosEscolares.service"
import { maskCpfCnpj, onlyDigits } from "@/lib/remuneracao/formatacao"
import { idExibicao } from "@/types/paciente"
import type { Paciente } from "@/types/paciente"
import { NovoPacienteModal } from "./pacientes/NovoPacienteModal"
import { campo, foco } from "./pacientes/ui/campos"
import { BarraAlfabeto, LinhaDado, SeletorModo, type ModoExibicao } from "./shared/ListaCadastro"

// Listagem do cadastro de pacientes. Os fictícios (Horário Administrativo,
// Notificação Prévia e afins) ficam de fora — não são pessoas. Os inativos
// entram: a tela de cadastro precisa enxergá-los para reativar.

// Renderizar 900+ cards de uma vez custa caro no DOM, e ninguém rola uma lista
// desse tamanho. A busca continua varrendo a base inteira — só a exibição é
// fatiada.
const PACIENTES_POR_PAGINA = 75

/** Sem acento, minúsculo — para a busca casar "Joao" com "João". */
function norm(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

function dataBR(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano}`
}

type SituacaoFiltro = "ativo" | "inativo" | "ficticio"

const SITUACOES: { valor: SituacaoFiltro; rotulo: string }[] = [
  { valor: "ativo", rotulo: "Ativos" },
  { valor: "inativo", rotulo: "Inativos" },
  { valor: "ficticio", rotulo: "Fictícios" },
]

// Quem respondeu o formulário da escola. Só duas respostas possíveis porque o
// dado é a EXISTÊNCIA de linha em pacientes_dados_escolares — não há meio
// preenchido: `escola_nome` é not null, então toda linha tem conteúdo útil.
type EscolaFiltro = "respondida" | "pendente"

const ESCOLAS: { valor: EscolaFiltro; rotulo: string }[] = [
  { valor: "respondida", rotulo: "Escola informada" },
  { valor: "pendente", rotulo: "Escola pendente" },
]

// Grade para reconhecer rosto, lista para varrer muitos nomes de uma vez. A
// escolha é conveniência de quem está no navegador — por isso localStorage, e
// por isso a tela funciona igual se ele falhar (aba anônima, dados bloqueados).
const CHAVE_MODO = "pacientes:modoExibicao"

// Mesmas colunas no cabeçalho e em cada linha — definidas uma vez para os dois
// nunca desalinharem.
const COLUNAS_LISTA =
  "md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)]"

// 44px de altura no toque (as atendentes usam no celular); compacto no desktop.
const BOTAO_PAGINA =
  "inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent sm:min-h-0"

// Tons de estado: tokens --status-* do globals.css (contraste medido lá).
const TOM = {
  ok: "text-[var(--status-ok)]",
  atencao: "text-[var(--status-atencao)]",
  alerta: "text-[var(--status-alerta)]",
} as const
const SELO = "inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"

// Sombra quase imperceptível: só descola o cartão do fundo.
const SOMBRA = "shadow-[0_1px_2px_rgba(15,23,42,0.04)]"

/** "há 3 dias" / "há 2 meses" — a idade da resposta importa mais que a data. */
function tempoDecorrido(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 0) return "hoje"
  if (dias === 1) return "ontem"
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`
  const anos = Math.floor(meses / 12)
  return `há ${anos} ${anos === 1 ? "ano" : "anos"}`
}

export function PacientesCadastro() {
  const {
    pacientes,
    telefonesResponsaveis,
    fichasEscolares,
    fichasEscolaresIndisponivel,
    pacientesComContrato,
    contratosIndisponivel,
    loading,
    error,
  } = usePacientes()
  // Texto e filtro são estados SEPARADOS: `buscaTexto` segue o teclado sem
  // atraso (o <input> nunca perde tecla), e `busca` — quem de fato refiltra
  // e re-renderiza a grade de até 75 cards — só se atualiza 200ms depois que
  // a digitação para. Sem isso, cada tecla batia refiltro + re-render da
  // grade inteira, e digitação rápida derrubava letra.
  const [buscaTexto, setBuscaTexto] = useState("")
  const [busca, setBusca] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setBusca(buscaTexto), 200)
    return () => clearTimeout(t)
  }, [buscaTexto])
  const [modalAberto, setModalAberto] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const [modalDetalhe, setModalDetalhe] = useState(false)
  const [importando, setImportando] = useState(false)
  const [ultimaImportacao, setUltimaImportacao] = useState<PacienteImportacaoLog | null>(null)
  const [historicoImportacao, setHistoricoImportacao] = useState<PacienteImportacaoLog[]>([])

  const carregarStatusImportacao = useCallback(async () => {
    try {
      const [ultimo, hist] = await Promise.all([
        getUltimaImportacaoPacientes(),
        getHistoricoImportacoesPacientes(10),
      ])
      setUltimaImportacao(ultimo)
      setHistoricoImportacao(hist)
    } catch (err) {
      console.error("Falha ao carregar status de importação de pacientes:", err)
    }
  }, [])

  useEffect(() => {
    void carregarStatusImportacao()
  }, [carregarStatusImportacao])

  const importar = useCallback(async () => {
    setImportando(true)
    try {
      const r = await importarPacientesDaTita()
      const partes = [
        r.novos ? `${r.novos} novo${r.novos === 1 ? "" : "s"}` : null,
        r.vinculados_por_cpf
          ? `${r.vinculados_por_cpf} vinculado${r.vinculados_por_cpf === 1 ? "" : "s"} pelo CPF`
          : null,
        r.atualizados ? `${r.atualizados} com dados do TiTa atualizados` : null,
      ].filter(Boolean)
      toast.success(
        partes.length
          ? `TiTa: ${partes.join(" · ")}.`
          : `TiTa conferido: ${r.vistos_na_tita} pacientes, nada novo.`,
        { duration: 6000 }
      )
      await refetchPacientes()
      await carregarStatusImportacao()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
    } finally {
      setImportando(false)
    }
  }, [carregarStatusImportacao])
  // Complementar: cada situação soma ao resultado, não filtra em cascata.
  // Default espelha o comportamento antigo (ativos + inativos, fictícios de
  // fora) — só passa a incluir fictício quem marcar de propósito.
  const [situacoes, setSituacoes] = useState<Set<SituacaoFiltro>>(
    () => new Set(["ativo", "inativo"])
  )
  // Default com as duas marcadas = a lista completa de antes. O filtro de escola
  // é uma LENTE opcional: quem abre a tela para outra coisa não é obrigado a
  // reparar nele, e o chip no cartão já responde a pergunta sem filtrar nada.
  const [escolas, setEscolas] = useState<Set<EscolaFiltro>>(
    () => new Set(["respondida", "pendente"])
  )
  const [pagina, setPagina] = useState(1)
  // `null` = "Todos". É um filtro a mais, não uma busca — por isso separado de
  // `busca`: os dois convivem (marcar "M" e digitar "aria" acha só Maria).
  const [letra, setLetra] = useState<string | null>(null)

  // Nasce em "grade" (o que o servidor renderiza) e só depois lê a preferência
  // salva — ler o localStorage no useState quebraria a hidratação.
  const [modo, setModo] = useState<ModoExibicao>("grade")
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODO)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lê storage externo só após hidratar; no primeiro render o servidor não tem esse valor
      if (salvo === "grade" || salvo === "lista") setModo(salvo)
    } catch {
      // Sem storage, fica no default.
    }
  }, [])

  // Estável (useCallback) porque entra no header montado por efeito.
  const trocarModo = useCallback((novo: ModoExibicao) => {
    setModo(novo)
    try {
      localStorage.setItem(CHAVE_MODO, novo)
    } catch {
      // Só não lembra da escolha na próxima visita.
    }
  }, [])

  // A BUSCA roda sobre a lista inteira, não sobre a página. A paginação é
  // aplicada DEPOIS do filtro — por isso digitar um nome encontra o paciente
  // esteja ele na página 1 ou na 12.
  //
  // Sem a letra ainda: a barra de A-Z precisa saber quais letras têm gente
  // ANTES de se aplicar a si mesma, senão marcar "M" some com as outras opções
  // possíveis da tela.
  const filtradosSemLetra = useMemo(() => {
    let lista = pacientes.filter((p) => situacoes.has(p.ficticio ? "ficticio" : p.ativo ? "ativo" : "inativo"))

    // Complementar como o de Situação. Nenhuma marcada devolve lista vazia — é o
    // mesmo contrato do outro filtro, e o contador explica o vazio.
    if (escolas.size < ESCOLAS.length) {
      lista = lista.filter((p) =>
        escolas.has(fichasEscolares.has(p.id_paciente) ? "respondida" : "pendente")
      )
    }

    const termo = norm(busca)
    if (!termo) return lista

    const digitos = onlyDigits(busca)
    return lista.filter((p) => {
      if (norm(p.nome).includes(termo)) return true
      if (p.nome_civil && norm(p.nome_civil).includes(termo)) return true
      if (!digitos) return false
      if (p.cpf && onlyDigits(p.cpf).includes(digitos)) return true
      // Busca pelo MESMO número que o cartão exibe. Antes casava contra a
      // matrícula formatada, que não era o que estava escrito na tela — digitar
      // o ID lido no cartão não achava o paciente.
      return idExibicao(p).includes(digitos)
    })
  }, [pacientes, busca, situacoes, escolas, fichasEscolares])

  // Quais letras têm ao menos um paciente sob os filtros de cima — para a
  // barra A-Z desabilitar (não esconder: a posição de cada letra é fixa) quem não
  // vai achar nada.
  const letrasDisponiveis = useMemo(() => {
    const s = new Set<string>()
    for (const p of filtradosSemLetra) {
      const c = norm(p.nome).charAt(0).toUpperCase()
      if (c >= "A" && c <= "Z") s.add(c)
    }
    return s
  }, [filtradosSemLetra])

  const filtrados = useMemo(() => {
    if (!letra) return filtradosSemLetra
    return filtradosSemLetra.filter((p) => norm(p.nome).toUpperCase().startsWith(letra))
  }, [filtradosSemLetra, letra])

  // Contagem sobre os pacientes REAIS e visíveis pelo filtro de Situação, não
  // sobre a base inteira: fictício (Horário Administrativo, Notificação Prévia)
  // não é criança e nunca vai ter escola — contá-lo como pendente inflaria o
  // número com linhas que ninguém precisa cobrar.
  //
  // Ignora o próprio filtro de escola de propósito: os dois números têm de somar
  // o mesmo total sempre. Se cada um contasse o recorte já filtrado, marcar
  // "Pendente" zeraria o número de "Informada" e o painel viraria um espelho da
  // seleção em vez de um retrato do cadastro.
  const contagemEscola = useMemo(() => {
    if (fichasEscolaresIndisponivel) return null
    let respondida = 0
    let pendente = 0
    for (const p of pacientes) {
      if (p.ficticio) continue
      if (!situacoes.has(p.ativo ? "ativo" : "inativo")) continue
      if (fichasEscolares.has(p.id_paciente)) respondida += 1
      else pendente += 1
    }
    return { respondida, pendente }
  }, [pacientes, situacoes, fichasEscolares, fichasEscolaresIndisponivel])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PACIENTES_POR_PAGINA))

  // Uma busca que reduz o resultado pode deixar a página atual fora do
  // intervalo; sem isto a tela ficaria vazia sem explicação.
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * PACIENTES_POR_PAGINA

  const daPagina = useMemo(
    () => filtrados.slice(inicio, inicio + PACIENTES_POR_PAGINA),
    [filtrados, inicio]
  )

  // Assina as fotos da página num lote só. Roda no render (e não num efeito)
  // de propósito: efeitos dos filhos rodam antes dos do pai, e os avatares
  // abririam cada um sua requisição antes de o lote existir.
  useMemo(() => {
    precarregarFotosAssinadas(daPagina.flatMap((p) => (p.foto_path ? [p.foto_path] : [])))
  }, [daPagina])

  function irPara(destino: number) {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    // Trocar de página mantendo o scroll no rodapé deixaria o usuário no fim de
    // uma lista que acabou de mudar inteira.
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const { setRightContent } = useHeader()

  // No header ficam só as AÇÕES. Busca e filtros desceram para a barra da
  // página (padrão de Contratos): numa linha só com as ações, o header quebrava
  // em três andares no celular das atendentes.
  useEffect(() => {
    setRightContent(
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setVerHistorico(true)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
          aria-label="Histórico"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Histórico</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={importar}
            disabled={importando}
            title="Atualizar (import. do TiTa) — sincroniza imediatamente com a base oficial do TiTa e traz novos pacientes e dados alterados"
            aria-label="Atualizar (import. do TiTa)"
            className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 ${foco}`}
          >
            {importando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CloudDownload className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Atualizar (import. do TiTa)</span>
            <span className="sm:hidden">Atualizar</span>
          </button>
          {ultimaImportacao && (
            <button
              type="button"
              onClick={() => setModalDetalhe(true)}
              title="Ver o que mudou na sincronização do TiTa"
              aria-label="Ver mais da sincronização do TiTa"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${foco}`}
            >
              <span className="hidden xl:inline text-muted-foreground">
                {ultimaImportacao.status === "erro"
                  ? "Sincronização 04:00 falhou"
                  : `${ultimaImportacao.novos} novos · ${ultimaImportacao.atualizados} alterados`}
              </span>
              <span className="font-semibold text-primary underline">Ver mais</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${foco}`}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Novo paciente
        </button>
      </div>
    )
    return () => setRightContent(null)
  }, [setRightContent, importar, importando, ultimaImportacao])

  return (
    // Mais largo que as outras telas de cadastro: o grid precisa de espaço para
    // as 4–5 colunas em tela larga sem espremer o card — e a lista, para as
    // sete colunas sem truncar nome.
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6">
      {/* Busca, filtros e A–Z num bloco só: tudo que recorta a lista mora junto,
          e a lista abaixo é a resposta. */}
      <div className={`mb-5 rounded-xl border border-border/70 bg-card ${SOMBRA}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
        <div className="relative w-full md:w-80 lg:w-96">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            className={`${campo} w-full pl-9 ${buscaTexto ? "pr-11 sm:pr-9" : ""}`}
            placeholder="Buscar por nome, CPF ou ID…"
            value={buscaTexto}
            onChange={(e) => {
              setBuscaTexto(e.target.value)
              setPagina(1)
            }}
            aria-label="Buscar paciente"
          />
          {buscaTexto && (
            <button
              type="button"
              onClick={() => {
                setBuscaTexto("")
                setPagina(1)
              }}
              // 40px no toque (o campo inteiro tem essa altura), 24px no mouse.
              className={`absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 sm:right-1.5 sm:h-6 sm:w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <FiltroSituacao
          value={situacoes}
          onChange={(v) => {
            setSituacoes(v)
            setPagina(1)
          }}
        />
        <FiltroEscola
          value={escolas}
          contagem={contagemEscola}
          onChange={(v) => {
            setEscolas(v)
            setPagina(1)
          }}
        />
        <div className="ml-auto flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          {!loading && (
            // Contagem única da tela (o rodapé ficou só com a paginação). Vale
            // para todos os filtros, não só para a busca.
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
              <span className="text-sm font-semibold text-foreground">{filtrados.length}</span> de{" "}
              {pacientes.length} {pacientes.length === 1 ? "paciente" : "pacientes"}
            </span>
          )}
          <SeletorModo value={modo} onChange={trocarModo} destaque />
        </div>
      </div>
      <div className="px-3 pb-3">
        <BarraAlfabeto
          embutida
          value={letra}
          disponiveis={letrasDisponiveis}
          onChange={(v) => {
            setLetra(v)
            setPagina(1)
          }}
        />
      </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os pacientes. {error}</span>
        </div>
      )}

      {ultimaImportacao?.status === "erro" && (
        <div className="mb-4">
          <InlineNotice tone="red" icon={<AlertCircle className="h-4 w-4 shrink-0" />}>
            <div className="flex flex-wrap items-center justify-between gap-3 w-full">
              <span>
                A sincronização automática do TiTa falhou às 04:00:{" "}
                {ultimaImportacao.erro_mensagem ?? "Erro inesperado ao consultar a base do TiTa."}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setModalDetalhe(true)}
                  className="font-semibold underline hover:opacity-80"
                >
                  Ver detalhes
                </button>
                <button
                  type="button"
                  onClick={importar}
                  disabled={importando}
                  className="font-bold underline hover:opacity-80 disabled:opacity-50"
                >
                  {importando ? "Importando..." : "Tentar importar agora"}
                </button>
              </div>
            </div>
          </InlineNotice>
        </div>
      )}
      {loading ? (
        modo === "lista" ? <ListaEsqueleto /> : <GridEsqueleto />
      ) : error && pacientes.length === 0 ? (
        // A carga falhou: o alerta acima já diz o porquê. Um "nenhum paciente
        // cadastrado" aqui seria falso.
        null
      ) : filtrados.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          {busca
            ? "Nenhum paciente encontrado para essa busca."
            : letra
              ? `Nenhum paciente com o nome começando em "${letra}" neste recorte.`
              : escolas.size === 0
                ? "Marque ao menos uma opção no filtro de Escola para ver pacientes."
                : escolas.size < ESCOLAS.length
                  ? escolas.has("pendente")
                    ? "Todos os pacientes deste recorte já informaram a escola."
                    : "Nenhum paciente deste recorte informou a escola ainda."
                  : "Nenhum paciente cadastrado ainda."}
        </p>
      ) : modo === "lista" ? (
        <div className={`overflow-hidden rounded-xl border border-border/70 bg-card ${SOMBRA}`}>
          <div
            className={`hidden gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground md:grid ${COLUNAS_LISTA}`}
            aria-hidden="true"
          >
            <span>Paciente</span>
            <span>ID</span>
            <span>CPF</span>
            <span>Nascimento</span>
            <span>Celular</span>
            <span>Escola</span>
            <span>Contrato</span>
            <span>Situação</span>
          </div>
          <ul>
            {daPagina.map((p) => (
              <LinhaPaciente
                key={p.id_paciente}
                paciente={p}
                // Resolvidos aqui pelo mesmo motivo do card: manter o `memo`.
                telefoneResponsavel={telefonesResponsaveis.get(p.id_paciente) ?? null}
                fichaEscolar={fichasEscolares.get(p.id_paciente) ?? null}
                escolaIndisponivel={fichasEscolaresIndisponivel}
                temContrato={temContrato(p, pacientesComContrato, contratosIndisponivel)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {daPagina.map((p) => (
            <CardPaciente
              key={p.id_paciente}
              paciente={p}
              // Resolvido aqui, e não dentro do card, para o `memo` continuar
              // valendo: uma string muda de identidade só quando muda de valor,
              // enquanto o Map inteiro invalidaria todos os cards a cada carga.
              telefoneResponsavel={telefonesResponsaveis.get(p.id_paciente) ?? null}
              // Resolvido aqui pelo mesmo motivo do telefone: o objeto da ficha
              // só troca de identidade quando a carga traz outro, enquanto o Map
              // inteiro invalidaria todos os cards.
              fichaEscolar={fichasEscolares.get(p.id_paciente) ?? null}
              escolaIndisponivel={fichasEscolaresIndisponivel}
              // Boolean (ou null) e não o Set: o memo do card só invalida
              // quando a resposta DESTE paciente muda.
              temContrato={temContrato(p, pacientesComContrato, contratosIndisponivel)}
            />
          ))}
        </ul>
      )}

      {!loading && totalPaginas > 1 && (
        // Só a paginação: a contagem mora na barra de filtros, no topo.
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Paginação de pacientes">
          <button
            type="button"
            onClick={() => irPara(paginaAtual - 1)}
            disabled={paginaAtual <= 1}
            className={`${BOTAO_PAGINA} ${foco}`}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Anterior
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Página {paginaAtual} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => irPara(paginaAtual + 1)}
            disabled={paginaAtual >= totalPaginas}
            className={`${BOTAO_PAGINA} ${foco}`}
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      )}

      {/* Montado condicionalmente para nascer limpo — convenção do projeto,
          em vez de um useEffect de reset. */}
      {modalAberto && <NovoPacienteModal onFechar={() => setModalAberto(false)} />}
      {verHistorico && (
        <HistoricoCadastrosModal
          subtitulo="Todas as alterações em pacientes, responsáveis, fichas médicas, laudos e altas — mais recentes primeiro."
          entidades={[
            "paciente",
            "responsavel",
            "ficha_medica",
            "laudo",
            "alta",
            "alta_individualidade",
          ]}
          onClose={() => setVerHistorico(false)}
        />
      )}
      {modalDetalhe && (
        <ModalDetalheImportacao
          log={ultimaImportacao}
          historico={historicoImportacao}
          onClose={() => setModalDetalhe(false)}
        />
      )}
    </div>
  )
}

/**
 * Gatilho + painel de opções marcáveis, compartilhado pelos dois filtros.
 *
 * Teclado: abrir leva o foco à primeira opção; ↑/↓, Home/End navegam; Esc ou
 * Tab fecham e devolvem o foco ao gatilho. Clique fora também fecha.
 */
function PopoverFiltro({
  icone: Icone,
  nome,
  valor,
  rotuloPainel,
  larguraPainel,
  children,
  rodape,
}: {
  icone: typeof ListFilter
  /** "Situação", "Escola" — em tom apagado, antes do valor. */
  nome: string
  /** O recorte atual ("Todos", "Ativos"…). */
  valor: string
  rotuloPainel: string
  larguraPainel: string
  children: React.ReactNode
  rodape?: React.ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const gatilho = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  const opcoes = () =>
    Array.from(painel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])

  useEffect(() => {
    if (!aberto) return
    opcoes()[0]?.focus()
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  function fechar() {
    setAberto(false)
    gatilho.current?.focus()
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const lista = opcoes()
    const atual = lista.indexOf(document.activeElement as HTMLElement)
    let destino: number | null = null
    if (e.key === "ArrowDown") destino = (atual + 1) % lista.length
    else if (e.key === "ArrowUp") destino = (atual - 1 + lista.length) % lista.length
    else if (e.key === "Home") destino = 0
    else if (e.key === "End") destino = lista.length - 1
    else if (e.key === "Escape") {
      e.preventDefault()
      fechar()
      return
    } else if (e.key === "Tab") {
      setAberto(false)
      return
    }
    if (destino !== null) {
      e.preventDefault()
      lista[destino]?.focus()
    }
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !aberto) {
            e.preventDefault()
            setAberto(true)
          }
        }}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-label={`${nome}: ${valor}`}
        className={`inline-flex min-h-11 w-full items-center gap-2 rounded-lg border border-border/80 px-3 py-2 text-sm hover:bg-muted sm:min-h-0 sm:w-auto sm:min-w-44 ${foco}`}
      >
        <Icone className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">{nome}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">{valor}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {aberto && (
        <div
          ref={painel}
          role="listbox"
          aria-multiselectable="true"
          aria-label={rotuloPainel}
          onKeyDown={aoTeclar}
          className={`absolute left-0 top-[calc(100%+4px)] z-[100] ${larguraPainel} rounded-md border border-border bg-popover p-1 shadow-lg`}
        >
          {children}
          {rodape}
        </div>
      )}
    </div>
  )
}

/** Uma opção do `PopoverFiltro`: alvo de 44px no toque, marca à direita. */
function OpcaoFiltro({
  marcado,
  onAlternar,
  children,
}: {
  marcado: boolean
  onAlternar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={marcado}
      onClick={onAlternar}
      className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted sm:min-h-0 ${foco}`}
    >
      {children}
      <Check
        className={`h-4 w-4 shrink-0 text-primary ${marcado ? "" : "invisible"}`}
        aria-hidden="true"
      />
    </button>
  )
}

function alternarEm<T>(conjunto: Set<T>, item: T): Set<T> {
  const novo = new Set(conjunto)
  if (novo.has(item)) novo.delete(item)
  else novo.add(item)
  return novo
}

/**
 * Ativos/Inativos/Fictícios, complementares (marcar mais de um SOMA ao
 * resultado, não restringe mais). Substitui o antigo checkbox "Somente ativos",
 * que só dava pra excluir inativos, nunca isolar só eles.
 */
function FiltroSituacao({
  value,
  onChange,
}: {
  value: Set<SituacaoFiltro>
  onChange: (v: Set<SituacaoFiltro>) => void
}) {
  // Ativos + inativos é o padrão e é "todos os pacientes": fictício não é
  // paciente, então só aparece no rótulo quando entra de propósito.
  const reais = value.has("ativo") && value.has("inativo")
  const resumo =
    value.size === 0
      ? "Nenhuma"
      : reais
        ? value.has("ficticio")
          ? "Todos + fictícios"
          : "Todos"
        : SITUACOES.filter((s) => value.has(s.valor)).map((s) => s.rotulo).join(", ")

  return (
    <PopoverFiltro
      icone={ListFilter}
      nome="Situação"
      valor={resumo}
      rotuloPainel="Filtrar por situação"
      larguraPainel="w-48"
    >
      {SITUACOES.map((s) => (
        <OpcaoFiltro
          key={s.valor}
          marcado={value.has(s.valor)}
          onAlternar={() => onChange(alternarEm(value, s.valor))}
        >
          <span className="flex-1">{s.rotulo}</span>
        </OpcaoFiltro>
      ))}
    </PopoverFiltro>
  )
}

/**
 * Quem respondeu o formulário da escola.
 *
 * Os números ficam DENTRO do painel, um por opção, e não no gatilho: no gatilho
 * um número solto não dizia de que lado ele era (4 respondidas? 4 pendentes?) e
 * competia com o rótulo. Ao lado de cada opção ele fica autoexplicativo, e mostra
 * os dois lados — quantas faltam e quantas já vieram.
 */
function FiltroEscola({
  value,
  contagem,
  onChange,
}: {
  value: Set<EscolaFiltro>
  /** `null` quando a leitura falhou — o painel então não afirma número nenhum. */
  contagem: { respondida: number; pendente: number } | null
  onChange: (v: Set<EscolaFiltro>) => void
}) {
  const resumo =
    value.size === 0
      ? "Nenhuma"
      : value.size === ESCOLAS.length
        ? "Todas"
        : value.has("respondida")
          ? "Informada"
          : "Pendente"

  return (
    <PopoverFiltro
      icone={GraduationCap}
      nome="Escola"
      valor={resumo}
      rotuloPainel="Filtrar por ficha escolar"
      larguraPainel="w-64"
      rodape={
        contagem === null && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Não foi possível ler as fichas agora. Recarregue a página para filtrar por
            escola.
          </p>
        )
      }
    >
      {ESCOLAS.map((e) => {
        const quantos = contagem?.[e.valor]
        return (
          <OpcaoFiltro
            key={e.valor}
            marcado={value.has(e.valor)}
            onAlternar={() => onChange(alternarEm(value, e.valor))}
          >
            <span className="flex-1 truncate">{e.rotulo}</span>
            {/* Amber para pendente — a mesma cor do selo no cartão, para o
                número e o cartão falarem a mesma língua. */}
            {quantos !== undefined && (
              <span
                className={`shrink-0 tabular-nums ${
                  e.valor === "pendente" ? `font-semibold ${TOM.atencao}` : "text-muted-foreground"
                }`}
              >
                {quantos}
              </span>
            )}
          </OpcaoFiltro>
        )
      })}
    </PopoverFiltro>
  )
}

const CardPaciente = memo(function CardPaciente({
  paciente,
  telefoneResponsavel,
  fichaEscolar,
  escolaIndisponivel,
  temContrato,
}: {
  paciente: Paciente
  telefoneResponsavel: string | null
  fichaEscolar: ResumoEscolar | null
  escolaIndisponivel: boolean
  /** `null` = não se aplica (fictício) ou a leitura falhou: a linha some. */
  temContrato: boolean | null
}) {
  return (
    <li>
      {/* O card inteiro é o alvo de clique — num diretório, mirar só o nome é
          um alvo pequeno demais para o tamanho do cartão. */}
      <Link
        href={`/cadastros/pacientes/${paciente.id_paciente}`}
        className={`group flex h-full flex-col rounded-xl border border-border/70 bg-card p-4 ${SOMBRA} transition-colors hover:border-sidebar-primary/40 motion-reduce:transition-none ${foco}`}
      >
        <div className="flex items-start gap-3">
          <AvatarLista paciente={paciente} tamanho="md" />
          <div className="min-w-0 flex-1 pt-0.5">
            {/* Uma linha só, com o nome inteiro no title: duas linhas
                desalinhavam a grade por causa de um nome comprido. */}
            <h2
              className="truncate text-[15px] font-semibold leading-snug text-foreground"
              title={paciente.nome}
            >
              {paciente.nome}
            </h2>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              ID {idExibicao(paciente)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Situacao paciente={paciente} />
            {paciente.ficticio && (
              <span className={`${SELO} bg-amber-500/10 ${TOM.atencao}`}>
                Fictício
              </span>
            )}
          </div>
        </div>

        <dl className="mt-4 space-y-2 text-[13px]">
          <LinhaDado icone={IdCard} rotulo="CPF" valor={paciente.cpf ? maskCpfCnpj(paciente.cpf) : null} />
          <LinhaDado icone={Cake} rotulo="Nascimento" valor={dataBR(paciente.data_nascimento)} />
          {/* O telefone útil é o de quem responde pelo paciente: a clínica
              atende sobretudo menores, e paciente.telefone estava vazio na
              maioria dos cadastros enquanto o do responsável vinha preenchido
              do TiTa. */}
          <LinhaDado icone={Phone} rotulo="Celular" valor={telefoneResponsavel} />
          {temContrato !== null && (
            <LinhaDado icone={FileSignature} rotulo="Contrato">
              <SeloContrato tem={temContrato} />
            </LinhaDado>
          )}
        </dl>

        {/* Fictício não é criança — não tem escola a informar, e "não
            informada" ali seria uma cobrança impossível de atender. */}
        {!paciente.ficticio && !escolaIndisponivel && <LinhaEscola ficha={fichaEscolar} />}
      </Link>
    </li>
  )
})

/**
 * Uma linha do modo lista. A linha inteira é o link, como o card inteiro é no
 * modo grade.
 *
 * No celular só cabem foto, nome, ID/nascimento e situação — CPF, celular e
 * escola ficam para a ficha, em vez de forçar rolagem lateral na tela das
 * atendentes.
 */
const LinhaPaciente = memo(function LinhaPaciente({
  paciente,
  telefoneResponsavel,
  fichaEscolar,
  escolaIndisponivel,
  temContrato,
}: {
  paciente: Paciente
  telefoneResponsavel: string | null
  fichaEscolar: ResumoEscolar | null
  escolaIndisponivel: boolean
  temContrato: boolean | null
}) {
  const nascimento = dataBR(paciente.data_nascimento)

  return (
    <li className="border-b border-border last:border-b-0">
      {/* ring-inset: o contêiner tem overflow-hidden e cortaria o anel de foco. */}
      <Link
        href={`/cadastros/pacientes/${paciente.id_paciente}`}
        className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition-colors hover:bg-muted/50 motion-reduce:transition-none ${COLUNAS_LISTA} ${foco} focus-visible:ring-inset`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AvatarLista paciente={paciente} tamanho="sm" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="truncate font-medium text-foreground group-hover:underline"
                title={paciente.nome}
              >
                {paciente.nome}
              </span>
              {paciente.ficticio && (
                <span className={`${SELO} bg-amber-500/10 ${TOM.atencao}`}>
                  Fictício
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
              ID {idExibicao(paciente)} · {nascimento}
            </p>
          </div>
        </div>
        <span className="hidden tabular-nums text-foreground md:block">{idExibicao(paciente)}</span>
        <span className="hidden truncate tabular-nums text-foreground md:block">
          {paciente.cpf ? maskCpfCnpj(paciente.cpf) : "—"}
        </span>
        <span className="hidden tabular-nums text-foreground md:block">{nascimento}</span>
        <span className="hidden truncate tabular-nums text-foreground md:block">
          {telefoneResponsavel || "—"}
        </span>
        <span className="hidden min-w-0 md:block">
          <CelulaEscola
            ficha={fichaEscolar}
            // Mesmas regras do selo no card: fictício não tem escola a informar,
            // e sem leitura das fichas a célula não afirma nada.
            aplicavel={!paciente.ficticio && !escolaIndisponivel}
          />
        </span>
        <span className="hidden min-w-0 md:block">
          {temContrato === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <SeloContrato tem={temContrato} />
          )}
        </span>
        <span className="justify-self-end md:justify-self-start">
          <Situacao paciente={paciente} />
        </span>
      </Link>
    </li>
  )
})

function CelulaEscola({ ficha, aplicavel }: { ficha: ResumoEscolar | null; aplicavel: boolean }) {
  if (!aplicavel) return <span className="text-muted-foreground">—</span>
  if (!ficha) {
    return (
      <span className="block truncate text-muted-foreground">Não informada</span>
    )
  }
  return (
    <span
      className="block truncate text-foreground"
      title={`${ficha.escola_nome} — informada ${tempoDecorrido(ficha.criado_em)}`}
    >
      {ficha.escola_nome}
    </span>
  )
}

/**
 * A resposta da família na própria lista: qual escola. Mostra o NOME da
 * escola, não só "respondida" — é o dado que hoje só existe entrando na ficha.
 * Há quanto tempo veio fica no title, para não pesar no cartão.
 *
 * Pendência sem cor de alarme: o filtro "Escola" já conta e isola os
 * pendentes; no cartão, o ícone verde marca quem respondeu e o resto fica
 * neutro.
 */
function LinhaEscola({ ficha }: { ficha: ResumoEscolar | null }) {
  return (
    <p
      className={`mt-2 flex min-w-0 items-center gap-2 text-[13px] ${ficha ? "text-foreground" : "text-muted-foreground"}`}
      title={ficha ? `${ficha.escola_nome} — informada ${tempoDecorrido(ficha.criado_em)}` : undefined}
    >
      <GraduationCap
        className={`h-3.5 w-3.5 shrink-0 ${ficha ? TOM.ok : ""}`}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="sr-only">Escola: </span>
      <span className="truncate">{ficha ? ficha.escola_nome : "Escola não informada"}</span>
    </p>
  )
}

/**
 * Existência de contrato (registro não cancelado), não vigência. Um ponto e
 * texto em tom normal: compacto, e não disputa com o selo de situação.
 */
function SeloContrato({ tem }: { tem: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${tem ? "bg-emerald-500" : "bg-amber-500"}`}
        aria-hidden="true"
      />
      <span className={tem ? "text-foreground" : "text-muted-foreground"}>
        {tem ? "Com contrato" : "Sem contrato"}
      </span>
    </span>
  )
}

/**
 * `null` quando não há o que afirmar: fictício não é paciente de verdade, e
 * leitura que falhou não é "sem contrato".
 */
function temContrato(p: Paciente, com: Set<number>, indisponivel: boolean): boolean | null {
  if (p.ficticio || indisponivel) return null
  return com.has(p.id_paciente)
}

// Falecido e inativo são estados independentes (ver 20260826100000): um paciente
// pode estar inativo por alta e continuar vivo. O falecimento é o rótulo mais
// relevante quando os dois valem, por isso vem primeiro.
function Situacao({ paciente }: { paciente: Paciente }) {
  if (paciente.falecido) {
    return (
      <span className={`${SELO} bg-muted text-muted-foreground`}>
        Falecido
      </span>
    )
  }
  if (!paciente.ativo) {
    return (
      <span className={`${SELO} bg-rose-500/10 ${TOM.alerta}`}>
        Inativo
      </span>
    )
  }
  return (
    <span className={`${SELO} bg-emerald-500/10 ${TOM.ok}`}>
      Ativo
    </span>
  )
}

// O esqueleto imita a FORMA do card (avatar redondo, nome, três linhas de
// dado), não um bloco genérico — assim o layout não salta quando os dados
// chegam.
function GridEsqueleto() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={`rounded-xl border border-border/70 bg-card p-4 ${SOMBRA}`}>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-3 w-28 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-14 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-5 w-12 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="flex justify-between">
                <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Mesmo formato da linha real: foto, nome e o selo à direita.
function ListaEsqueleto() {
  return (
    <div className={`overflow-hidden rounded-xl border border-border/70 bg-card ${SOMBRA}`}>
      <div className="hidden h-9 border-b border-border bg-muted/50 md:block" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-48 max-w-[50%] animate-pulse rounded bg-muted" />
          <div className="ml-auto h-5 w-14 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  )
}

// Quatro tons só, todos claros e do mesmo peso: a cor ajuda a separar um card
// do vizinho, não diz nada sobre o paciente — por isso poucos e sem saturação.
const TONS_INICIAIS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
] as const

// Conectivos não viram inicial: "Ana da Silva" é AS, não AD.
const CONECTIVOS = new Set(["da", "das", "de", "do", "dos", "e"])

/** Primeira e última palavra do nome: "Adrian Araújo Lima" → "AL". */
function iniciais(nome: string): string {
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p && !CONECTIVOS.has(p.toLowerCase()))
  if (partes.length === 0) return "?"
  const primeira = partes[0].charAt(0)
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : ""
  return (primeira + ultima).toUpperCase()
}

function AvatarLista({
  paciente,
  tamanho = "md",
}: {
  paciente: Paciente
  /** "md" no card (48px), "sm" na linha da lista (40px). */
  tamanho?: "md" | "sm"
}) {
  const caixa = tamanho === "sm" ? "h-10 w-10 shrink-0 text-xs" : "h-12 w-12 shrink-0 text-sm"

  // A URL fica presa ao path que a gerou: se o path muda (ou some), a URL
  // antiga deixa de valer sem precisar zerar estado dentro do efeito.
  const [assinada, setAssinada] = useState<{ path: string; url: string | null } | null>(null)
  const url = paciente.foto_path && assinada?.path === paciente.foto_path ? assinada.url : null

  useEffect(() => {
    const path = paciente.foto_path
    if (!path) return
    let ativo = true
    getFotoUrlAssinada(path).then((u) => {
      if (ativo) setAssinada({ path, url: u })
    })
    return () => {
      ativo = false
    }
  }, [paciente.foto_path])

  if (url) {
    return (
      <div className={`flex overflow-hidden rounded-full border border-border bg-muted ${caixa}`}>
        <img src={url} loading="lazy" decoding="async" width={64} height={64} alt={`Foto de ${paciente.nome}`} className="h-full w-full object-cover" />
      </div>
    )
  }

  // Tom pelo ID (estável entre visitas), não pelo nome — renomear não troca a cor.
  const tom = TONS_INICIAIS[Math.abs(paciente.id_paciente) % TONS_INICIAIS.length]

  return (
    <span
      className={`flex select-none items-center justify-center rounded-full font-semibold tracking-wide ${tom} ${caixa}`}
      aria-hidden="true"
    >
      {iniciais(paciente.nome)}
    </span>
  )
}
