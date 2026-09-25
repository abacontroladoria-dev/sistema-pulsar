"use client"

import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useHeader } from "@/contexts/HeaderContext"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"
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
  School,
  LayoutGrid,
  List,
} from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { ICONES, getTomAvatar, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import { usePacientes } from "@/hooks/usePacientes"
import type { ResumoEscolar } from "@/services/pacienteDadosEscolares.service"
import { maskCpfCnpj, onlyDigits } from "@/lib/remuneracao/formatacao"
import { idExibicao } from "@/types/paciente"
import type { Paciente } from "@/types/paciente"
import { NovoPacienteModal } from "./pacientes/NovoPacienteModal"
import { campo, foco } from "./pacientes/ui/campos"

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
type ModoExibicao = "grade" | "lista"

const CHAVE_MODO = "pacientes:modoExibicao"

// Mesmas colunas no cabeçalho e em cada linha — definidas uma vez para os dois
// nunca desalinharem.
const COLUNAS_LISTA =
  "md:grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.7fr)]"

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
  const filtrados = useMemo(() => {
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

  function irPara(destino: number) {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    // Trocar de página mantendo o scroll no rodapé deixaria o usuário no fim de
    // uma lista que acabou de mudar inteira.
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const { setRightContent } = useHeader()

  useEffect(() => {
    setRightContent(
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            className={`${campo} pl-9 ${buscaTexto ? "pr-9" : ""} w-72`}
            placeholder="Buscar nome, CPF ou ID"
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
              className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
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
        <SeletorModo value={modo} onChange={trocarModo} />
        <button
          type="button"
          onClick={() => setVerHistorico(true)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Histórico
        </button>
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
    // `contagemEscola` entra por identidade, e isso é estável: vem de useMemo,
    // então só troca quando a contagem realmente muda.
  }, [buscaTexto, situacoes, escolas, contagemEscola, modo, trocarModo, setRightContent])

  return (
    // Mais largo que as outras telas de cadastro: o grid precisa de espaço para
    // as 4–5 colunas em tela larga sem espremer o card — e a lista, para as
    // sete colunas sem truncar nome.
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os pacientes. {error}</span>
        </div>
      )}

      {loading ? (
        modo === "lista" ? <ListaEsqueleto /> : <GridEsqueleto />
      ) : filtrados.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          {busca
            ? "Nenhum paciente encontrado para essa busca."
            : escolas.size === 0
              ? "Marque ao menos uma opção no filtro de Escola para ver pacientes."
              : escolas.size < ESCOLAS.length
                ? escolas.has("pendente")
                  ? "Todos os pacientes deste recorte já informaram a escola."
                  : "Nenhum paciente deste recorte informou a escola ainda."
                : "Nenhum paciente cadastrado ainda."}
        </p>
      ) : modo === "lista" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
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
              />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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
            />
          ))}
        </ul>
      )}

      {!loading && filtrados.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Mostrando {inicio + 1}–{Math.min(inicio + PACIENTES_POR_PAGINA, filtrados.length)} de{" "}
            {filtrados.length} {filtrados.length === 1 ? "paciente" : "pacientes"}
            {busca && ` (filtrado de ${pacientes.length})`}
          </p>

          {totalPaginas > 1 && (
            <nav className="flex items-center gap-2" aria-label="Paginação de pacientes">
              <button
                type="button"
                onClick={() => irPara(paginaAtual - 1)}
                disabled={paginaAtual <= 1}
                className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent ${foco}`}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                Página {paginaAtual} de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => irPara(paginaAtual + 1)}
                disabled={paginaAtual >= totalPaginas}
                className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent ${foco}`}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
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
    </div>
  )
}

/**
 * Botão que expande um painel de checkboxes — Ativos/Inativos/Fictícios,
 * complementares (marcar mais de um SOMA ao resultado, não restringe mais).
 * Substitui o antigo checkbox "Somente ativos", que só dava pra excluir
 * inativos, nunca isolar só eles.
 */
function FiltroSituacao({
  value,
  onChange,
}: {
  value: Set<SituacaoFiltro>
  onChange: (v: Set<SituacaoFiltro>) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  function alternar(situacao: SituacaoFiltro) {
    const novo = new Set(value)
    if (novo.has(situacao)) novo.delete(situacao)
    else novo.add(situacao)
    onChange(novo)
  }

  const resumo =
    value.size === 0
      ? "Nenhuma"
      : value.size === SITUACOES.length
        ? "Todas"
        : SITUACOES.filter((s) => value.has(s.valor)).map((s) => s.rotulo).join(", ")

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`inline-flex w-56 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
      >
        <ListFilter className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Situação: {resumo}</span>
      </button>
      {aberto && (
        <div
          role="listbox"
          aria-label="Filtrar por situação"
          className="absolute left-0 top-[calc(100%+4px)] z-[100] w-48 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {SITUACOES.map((s) => {
            const marcado = value.has(s.valor)
            return (
              <button
                key={s.valor}
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() => alternar(s.valor)}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${foco}`}
              >
                {s.rotulo}
                {marcado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
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
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  function alternar(escola: EscolaFiltro) {
    const novo = new Set(value)
    if (novo.has(escola)) novo.delete(escola)
    else novo.add(escola)
    onChange(novo)
  }

  const resumo =
    value.size === 0
      ? "Nenhuma"
      : value.size === ESCOLAS.length
        ? "Todas"
        : value.has("respondida")
          ? "Informada"
          : "Pendente"

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`inline-flex w-56 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
      >
        <GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Escola: {resumo}</span>
      </button>
      {aberto && (
        <div
          role="listbox"
          aria-label="Filtrar por ficha escolar"
          className="absolute left-0 top-[calc(100%+4px)] z-[100] w-64 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {ESCOLAS.map((e) => {
            const marcado = value.has(e.valor)
            const quantos = contagem?.[e.valor]
            return (
              <button
                key={e.valor}
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() => alternar(e.valor)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${foco}`}
              >
                <span className="flex-1 truncate">{e.rotulo}</span>
                {/* Emerald para informada, amber para pendente — as mesmas cores
                    do selo no cartão, para o número e o cartão falarem a mesma
                    língua. */}
                {quantos !== undefined && (
                  <span
                    className={`shrink-0 tabular-nums ${
                      e.valor === "pendente"
                        ? "font-semibold text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {quantos}
                  </span>
                )}
                <Check
                  className={`h-4 w-4 shrink-0 text-primary ${marcado ? "" : "invisible"}`}
                  aria-hidden="true"
                />
              </button>
            )
          })}
          {contagem === null && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Não foi possível ler as fichas agora. Recarregue a página para filtrar por
              escola.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Grade | lista — o "Modo de exibição" da tela, dois botões só de ícone. */
function SeletorModo({
  value,
  onChange,
}: {
  value: ModoExibicao
  onChange: (v: ModoExibicao) => void
}) {
  const opcoes = [
    { valor: "grade" as const, icone: LayoutGrid, rotulo: "Exibir em grade" },
    { valor: "lista" as const, icone: List, rotulo: "Exibir em lista" },
  ]

  return (
    <div
      role="group"
      aria-label="Modo de exibição"
      className="inline-flex shrink-0 rounded-md border border-border p-0.5"
    >
      {opcoes.map(({ valor, icone: Icone, rotulo }) => {
        const ativo = value === valor
        return (
          <button
            key={valor}
            type="button"
            onClick={() => onChange(valor)}
            aria-pressed={ativo}
            aria-label={rotulo}
            title={rotulo}
            className={`inline-flex h-8 w-8 items-center justify-center rounded ${
              ativo ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            } ${foco}`}
          >
            <Icone className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

const CardPaciente = memo(function CardPaciente({
  paciente,
  telefoneResponsavel,
  fichaEscolar,
  escolaIndisponivel,
}: {
  paciente: Paciente
  telefoneResponsavel: string | null
  fichaEscolar: ResumoEscolar | null
  escolaIndisponivel: boolean
}) {
  const tom = getTomAvatar(paciente.id_paciente)

  return (
    <li>
      {/* O card inteiro é o alvo de clique — num diretório, mirar só o nome é
          um alvo pequeno demais para o tamanho do cartão. */}
      <Link
        href={`/cadastros/pacientes/${paciente.id_paciente}`}
        className={`group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-foreground/15 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${foco}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            ID <span className="font-semibold text-foreground">{idExibicao(paciente)}</span>
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            <Situacao paciente={paciente} />
            {paciente.ficticio && (
              <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                Fictício
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <AvatarLista paciente={paciente} tom={tom} />
          <h2
            className="mt-4 w-full truncate text-base font-bold leading-snug text-foreground"
            title={paciente.nome}
          >
            {paciente.nome}
          </h2>
        </div>

        <hr className="my-4 border-border" />

        <dl className="space-y-3 pb-4 text-sm">
          <LinhaDado icone={IdCard} rotulo="CPF" valor={paciente.cpf ? maskCpfCnpj(paciente.cpf) : null} />
          <LinhaDado icone={Cake} rotulo="Nascimento" valor={dataBR(paciente.data_nascimento)} />
          {/* O telefone útil é o de quem responde pelo paciente: a clínica
              atende sobretudo menores, e paciente.telefone estava vazio na
              maioria dos cadastros enquanto o do responsável vinha preenchido
              do TiTa. */}
          <LinhaDado icone={Phone} rotulo="Celular" valor={telefoneResponsavel} />
        </dl>

        {/* Fictício não é criança — não tem escola a informar, e um selo de
            pendência ali seria uma cobrança impossível de atender. */}
        {!paciente.ficticio && !escolaIndisponivel && (
          <SeloEscola ficha={fichaEscolar} />
        )}
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
}: {
  paciente: Paciente
  telefoneResponsavel: string | null
  fichaEscolar: ResumoEscolar | null
  escolaIndisponivel: boolean
}) {
  const tom = getTomAvatar(paciente.id_paciente)
  const nascimento = dataBR(paciente.data_nascimento)

  return (
    <li className="border-b border-border last:border-b-0">
      {/* ring-inset: o contêiner tem overflow-hidden e cortaria o anel de foco. */}
      <Link
        href={`/cadastros/pacientes/${paciente.id_paciente}`}
        className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition-colors hover:bg-muted/50 motion-reduce:transition-none ${COLUNAS_LISTA} ${foco} focus-visible:ring-inset`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AvatarLista paciente={paciente} tom={tom} tamanho="sm" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="truncate font-medium text-primary group-hover:underline"
                title={paciente.nome}
              >
                {paciente.nome}
              </span>
              {paciente.ficticio && (
                <span className="inline-flex shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
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
      <span className="block truncate text-xs font-medium text-amber-600 dark:text-amber-400">
        Não informada
      </span>
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
 * A resposta da família na própria lista: qual escola, e há quanto tempo.
 *
 * Mostra o NOME DA ESCOLA, não só "respondida". Saber que respondeu resolve a
 * cobrança; saber onde a criança estuda é o motivo de ter perguntado — e é o
 * dado que hoje só existe entrando na ficha.
 *
 * Cores herdadas da tela: emerald já é "em ordem" (paciente Ativo) e amber já é
 * "requer atenção" (Fictício, "Verificar telefone" na aba Escola). Nenhum matiz
 * novo — na lista, uma cor nova significaria uma categoria nova.
 */
function SeloEscola({ ficha }: { ficha: ResumoEscolar | null }) {
  if (!ficha) {
    return (
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
        <School className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Escola não informada
      </div>
    )
  }

  return (
    <div className="mt-auto flex items-baseline gap-2 border-t border-border pt-3 text-xs">
      <School
        className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={ficha.escola_nome}>
        {ficha.escola_nome}
      </span>
      <span className="shrink-0 text-muted-foreground" title={`Informada ${tempoDecorrido(ficha.criado_em)}`}>
        {tempoDecorrido(ficha.criado_em)}
      </span>
    </div>
  )
}

function LinhaDado({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof IdCard
  rotulo: string
  valor: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {rotulo}
      </dt>
      <dd className="truncate text-left font-semibold text-foreground">{valor || "—"}</dd>
    </div>
  )
}

// Falecido e inativo são estados independentes (ver 20260826100000): um paciente
// pode estar inativo por alta e continuar vivo. O falecimento é o rótulo mais
// relevante quando os dois valem, por isso vem primeiro.
function Situacao({ paciente }: { paciente: Paciente }) {
  if (paciente.falecido) {
    return (
      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
        Falecido
      </span>
    )
  }
  if (!paciente.ativo) {
    return (
      <span className="inline-flex rounded-full bg-rose-500/10 px-2 py-0.5 text-sm font-medium text-rose-600 dark:text-rose-400">
        Inativo
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
      Ativo
    </span>
  )
}

// O esqueleto imita a FORMA do card (avatar redondo, nome, três linhas de
// dado), não um bloco genérico — assim o layout não salta quando os dados
// chegam.
function GridEsqueleto() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            <div className="h-4 w-12 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-4 flex flex-col items-center">
            <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
            <div className="mt-4 h-3 w-28 animate-pulse rounded bg-muted" />
          </div>
          <hr className="my-4 border-border" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j}>
                <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-3 w-24 animate-pulse rounded bg-muted" />
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
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
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

function AvatarLista({
  paciente,
  tom,
  tamanho = "lg",
}: {
  paciente: Paciente
  tom: { bg: string; fg: string }
  /** "lg" no card (96px), "sm" na linha da lista (40px). */
  tamanho?: "lg" | "sm"
}) {
  const caixa =
    tamanho === "sm"
      ? "h-10 w-10 shrink-0"
      : "h-24 w-24 transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
  const icone = tamanho === "sm" ? "h-5 w-5" : "h-11 w-11"

  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    if (!paciente.foto_path) {
      setUrl(null)
      return
    }
    getFotoUrlAssinada(paciente.foto_path).then((assinada) => {
      if (ativo) setUrl(assinada)
    })
    return () => {
      ativo = false
    }
  }, [paciente.foto_path])

  if (url) {
    return (
      <div className={`flex overflow-hidden rounded-full border border-border bg-muted ${caixa}`}>
        <img src={url} alt={`Foto de ${paciente.nome}`} className="h-full w-full object-cover" />
      </div>
    )
  }

  // Mesmo ID que decide a cor (`tom`, no chamador): o mesmo paciente mantém o
  // mesmo bicho aqui e em Acompanhamento de Laudos. Acesso por ÍNDICE em
  // `ICONES`, não chamada de função — ver o comentário lá.
  const Icone = ICONES[indiceIconeAvatar(paciente.id_paciente)]

  return (
    <span
      className={`flex items-center justify-center rounded-full ${caixa}`}
      style={{ backgroundColor: tom.bg, color: tom.fg }}
      aria-hidden="true"
    >
      <Icone className={icone} strokeWidth={1.75} />
    </span>
  )
}
