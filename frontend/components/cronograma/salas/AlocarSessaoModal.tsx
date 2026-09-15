"use client"

// AlocarSessaoModal — aloca um profissional/terapia num slot livre, edita ou
// move uma alocação existente. Reproduz o fluxo do calculadora-remuneracao:
// "Alocar sessão livre", detecção de profissional já alocado em outro lugar
// (com aviso de troca de unidade) e exclusão de alocação. Só planejamento de
// sala — não cria nem altera nenhum agendamento real na TiTa.
//
// Profissional/terapia são validados contra nomes reais (mesmas fontes de
// sugestão já usadas na Agenda) — não aceita texto livre/digitado errado.

import { useEffect, useMemo, useState } from "react"
import { Loader2, Save, Trash2 } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import {
  criarAlocacao, atualizarAlocacao, excluirAlocacao, buscarTerapiasDoProfissional,
  type ProfissionalOpcao,
} from "@/services/salas.service"
import { normTxt, NOME_PARA_TERAPIA_ID, PACS_ADMIN } from "@/lib/cronograma/constants"
import { construirIndiceExclusividadeTerapia, verificarExclusividade } from "@/lib/cronograma/exclusividadeTerapia"
import type { AlocacaoSala, Sala, SalaTerapiaExclusiva } from "@/lib/cronograma/salasTypes"
import type { AlocacaoAtual } from "@/hooks/useOcupacaoSalas"

interface ConfirmacaoPendente {
  title: string
  description: React.ReactNode
  confirmLabel: string
  confirmColor?: string
  onConfirm: () => void
}

interface AlocarSessaoModalProps {
  sala: Sala
  dow: number
  turno: "Manhã" | "Tarde"
  diaLabel: string
  /** Presente quando editando/movendo uma alocação já existente neste slot */
  alocacaoId?: string
  profissionalInicial?: string
  terapiaInicial?: string | null
  encontrarAlocacaoDoProfissional: (
    profissionalNome: string,
    dow: number,
    turno: "Manhã" | "Tarde",
    excetoAlocacaoId?: string,
  ) => AlocacaoAtual | null
  /**
   * A alocação como está HOJE, quando se está editando uma (`alocacaoId`).
   * Serve só para poder desfazer a edição sem consulta nova — a página já tem
   * essa lista em memória. Opcional: sem ela, editar apenas não oferece
   * desfazer.
   */
  alocacaoAtual?: AlocacaoSala | null
  onClose: () => void
  /**
   * Chamado depois de gravar. Recebe o que aconteceu para o chamador poder
   * confirmar em tela e oferecer desfazer — o parâmetro é OPCIONAL, então
   * `() => void` continua válido e nenhum chamador existente quebrou.
   */
  onSaved: (resultado?: ResultadoAlocacao) => void
  /** Já carregados pela página (useOcupacaoSalas) — evita refazer essas consultas a cada abertura do modal. */
  salasTodas: Sala[]
  exclusividades: SalaTerapiaExclusiva[]
  profissionaisTodos: ProfissionalOpcao[]
  terapiasTodas: string[]
  /** Passe Z_MODAL_EMPILHADO quando o modal abrir A PARTIR de outra camada que continua montada (ex.: o drawer de alocação do detalhe da sala). */
  zIndex?: number
}

/**
 * O que acabou de acontecer, para o chamador confirmar em tela e desfazer.
 *
 * `desfazer` já vem pronto porque só aqui se sabe qual é a operação inversa —
 * e ela usa os MESMOS services da ida (`criarAlocacao`/`atualizarAlocacao`/
 * `excluirAlocacao`), sem endpoint novo. Cada desfazer também passa pela
 * trilha de auditoria, como qualquer outra escrita.
 *
 * `desfazer` é `null` no caso "mover": mover faz duas escritas (atualiza uma
 * alocação e exclui outra), então o inverso exigiria recriar uma linha
 * apagada com id novo. Prometer desfazer e entregar outra coisa é pior que
 * não oferecer — nesse caso só confirma.
 */
export interface ResultadoAlocacao {
  acao: "criada" | "editada" | "excluida" | "movida"
  profissional: string
  diaLabel: string
  turno: "Manhã" | "Tarde"
  salaNome: string
  desfazer: (() => Promise<void>) | null
}

const INPUT_CLS = "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground"

// PACS_ADMIN é a lista de placeholders administrativos (pacientes fictícios,
// horários bloqueados/em aberto) — quando aparece no campo terapia da grade
// (sessão sem terapia real definida ainda), não é uma terapia de verdade e
// nunca deve ser oferecida como opção de alocação.
const TERAPIAS_ADMIN_NORM = new Set([...PACS_ADMIN].map(nome => normTxt(nome)))
const semTerapiaAdmin = (terapias: string[]) => terapias.filter(t => !TERAPIAS_ADMIN_NORM.has(normTxt(t)))

export function AlocarSessaoModal({
  sala, dow, turno, diaLabel, alocacaoId,
  profissionalInicial = "", terapiaInicial = "",
  encontrarAlocacaoDoProfissional, alocacaoAtual, onClose, onSaved,
  salasTodas, exclusividades, profissionaisTodos, terapiasTodas: terapiasTodasBruto, zIndex,
}: AlocarSessaoModalProps) {
  const [profissional, setProfissional] = useState(profissionalInicial)
  const [profissionalId, setProfissionalId] = useState<number | null>(null)
  const [profissionalValido, setProfissionalValido] = useState(!!profissionalInicial)
  const [mostrarSugestoesProf, setMostrarSugestoesProf] = useState(false)

  const [terapia, setTerapia] = useState(terapiaInicial ?? "")
  const terapiasTodas = useMemo(() => semTerapiaAdmin(terapiasTodasBruto.filter(Boolean)).sort(), [terapiasTodasBruto])
  const [terapiasDoProfissional, setTerapiasDoProfissional] = useState<string[] | null>(null)
  const [mostrarSugestoesTerapia, setMostrarSugestoesTerapia] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoPendente | null>(null)

  // "Exclusividade de salas com terapias" (ExclusividadeTerapiaModal) — bloqueia
  // ou avisa se a terapia digitada não combina com a sala deste slot.
  const indiceExclusividade = useMemo(() => construirIndiceExclusividadeTerapia(exclusividades), [exclusividades])
  const nomeDaSalaPorId = useMemo(() => {
    const mapa = new Map(salasTodas.map(s => [s.id, `${s.unidade_nome} · ${s.nome_exibicao}`]))
    return (salaId: string) => mapa.get(salaId) ?? "sala removida"
  }, [salasTodas])

  const verificacaoExclusividade = useMemo(() => {
    const terapiaNome = terapia.trim()
    if (!terapiaNome) return { status: "permitido" as const }
    const terapiaId = NOME_PARA_TERAPIA_ID[normTxt(terapiaNome)] ?? null
    return verificarExclusividade(sala.id, terapiaId, indiceExclusividade, nomeDaSalaPorId)
  }, [terapia, sala.id, indiceExclusividade, nomeDaSalaPorId])

  // Lista completa já vem carregada pela página (useOcupacaoSalas) — o
  // filtro conforme digita é feito aqui no cliente, sem round-trip ao banco
  // a cada tecla nem a cada abertura do modal.
  const profissionalSugestoes = profissional.trim().length
    ? profissionaisTodos.filter(p => normTxt(p.nome).includes(normTxt(profissional)))
    : profissionaisTodos

  // Valida automaticamente se o texto digitado bate exatamente (case-insensitive)
  // com algum nome da lista completa — cobre o caso de o usuário digitar/colar
  // o nome completo certinho sem clicar na sugestão. Também resolve o
  // profissional_id correspondente, já que digitar não passa pelo clique em
  // selecionarProfissional().
  useEffect(() => {
    if (!profissional.trim()) { setProfissionalValido(false); setProfissionalId(null); return }
    const bate = profissionaisTodos.find(p => normTxt(p.nome) === normTxt(profissional))
    if (bate) {
      setProfissionalValido(true)
      setProfissionalId(bate.id)
    }
  }, [profissional, profissionaisTodos])

  // Quando um profissional válido está selecionado, busca só as terapias que
  // ele de fato realiza (histórico real) — restringe a lista em vez de
  // mostrar todas as terapias da clínica.
  useEffect(() => {
    if (!profissionalValido || !profissional.trim()) { setTerapiasDoProfissional(null); return }
    let cancelado = false
    buscarTerapiasDoProfissional(profissional.trim(), profissionalId).then(lista => {
      if (!cancelado) setTerapiasDoProfissional(semTerapiaAdmin(lista))
    })
    return () => { cancelado = true }
  }, [profissionalValido, profissional, profissionalId])

  function handleProfissionalChange(valor: string) {
    setProfissional(valor)
    setProfissionalValido(!!profissionalInicial && normTxt(valor) === normTxt(profissionalInicial))
    setProfissionalId(null)
    setMostrarSugestoesProf(true)
  }

  function selecionarProfissional(opcao: ProfissionalOpcao) {
    setProfissional(opcao.nome)
    setProfissionalId(opcao.id)
    setProfissionalValido(true)
    setMostrarSugestoesProf(false)
  }

  // Restringe às terapias reais do profissional selecionado quando disponíveis;
  // cai para a lista completa da clínica só se ainda não houver profissional
  // válido selecionado (ou ele não tiver histórico).
  const listaTerapiasBase = terapiasDoProfissional && terapiasDoProfissional.length ? terapiasDoProfissional : terapiasTodas
  const terapiasSugeridas = terapia.trim().length
    ? listaTerapiasBase.filter(t => normTxt(t).includes(normTxt(terapia)))
    : listaTerapiasBase

  const podeSalvar = profissionalValido && profissional.trim().length > 0 && verificacaoExclusividade.status !== "bloqueado"

  async function persistirAlocacao(nome: string, conflito: AlocacaoAtual | null) {
    setSaving(true)
    setError(null)
    try {
      const terapiaNome = terapia.trim() || null
      const terapiaId = terapiaNome ? NOME_PARA_TERAPIA_ID[normTxt(terapiaNome)] ?? null : null
      const comum = { profissional: nome, diaLabel, turno, salaNome: sala.nome_exibicao }
      let resultado: ResultadoAlocacao

      if (conflito) {
        await atualizarAlocacao(conflito.alocacao.id, {
          sala_id: sala.id, dow, turno, profissional_nome: nome, profissional_id: profissionalId, terapia_nome: terapiaNome, terapia_id: terapiaId,
        })
        if (alocacaoId && alocacaoId !== conflito.alocacao.id) await excluirAlocacao(alocacaoId)
        // Duas escritas, uma delas um DELETE: sem desfazer (ver ResultadoAlocacao).
        resultado = { ...comum, acao: "movida", desfazer: null }
      } else if (alocacaoId) {
        // O estado anterior vem por prop, da lista que `useOcupacaoSalas` já
        // tem em memória — desfazer sem consulta nova e sem service novo.
        const anterior = alocacaoAtual ?? null
        await atualizarAlocacao(alocacaoId, {
          sala_id: sala.id, dow, turno, profissional_nome: nome, profissional_id: profissionalId, terapia_nome: terapiaNome, terapia_id: terapiaId,
        })
        resultado = {
          ...comum,
          acao: "editada",
          desfazer: anterior
            ? async () => {
                await atualizarAlocacao(alocacaoId, {
                  sala_id: anterior.sala_id, dow: anterior.dow, turno: anterior.turno,
                  profissional_nome: anterior.profissional_nome, profissional_id: anterior.profissional_id,
                  terapia_nome: anterior.terapia_nome, terapia_id: anterior.terapia_id,
                })
              }
            : null,
        }
      } else {
        const criada = await criarAlocacao({ sala_id: sala.id, dow, turno, profissional_nome: nome, profissional_id: profissionalId, terapia_nome: terapiaNome, terapia_id: terapiaId })
        // O inverso de criar é excluir — e `criarAlocacao` já devolve o id.
        resultado = { ...comum, acao: "criada", desfazer: () => excluirAlocacao(criada.id) }
      }

      onSaved(resultado)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar alocação.")
    } finally {
      setSaving(false)
    }
  }

  function handleSalvar() {
    if (!podeSalvar) return
    const nome = profissional.trim()
    const conflito = encontrarAlocacaoDoProfissional(nome, dow, turno, alocacaoId)
    if (conflito) {
      const trocaUnidade = conflito.sala.unidade_nome !== sala.unidade_nome
      setConfirmacao({
        title: "Mover alocação existente?",
        description: (
          <>
            Esse profissional já está alocado em {conflito.sala.unidade_nome} · {conflito.sala.nome_exibicao} · {diaLabel} · {turno}.
            {trocaUnidade && (
              <>{"\n"}<strong>Atenção:</strong> isso configura troca de unidade ({conflito.sala.unidade_nome} → {sala.unidade_nome}).</>
            )}
            {"\n"}Deseja movê-lo para {sala.unidade_nome} · {sala.nome_exibicao}? A alocação anterior será removida.
          </>
        ),
        confirmLabel: "Mover alocação",
        confirmColor: "#d97706",
        onConfirm: () => { setConfirmacao(null); persistirAlocacao(nome, conflito) },
      })
      return
    }
    persistirAlocacao(nome, null)
  }

  function handleExcluir() {
    if (!alocacaoId) return
    const anterior = alocacaoAtual ?? null
    setConfirmacao({
      title: "Excluir alocação?",
      // Antes dizia "não pode ser desfeita". Com o desfazer do aviso isso
      // deixaria de ser verdade — e um texto que mente sobre reversibilidade
      // faz o usuário hesitar na ação certa.
      description: anterior
        ? "Confirma que deseja excluir esta alocação? Você poderá desfazer logo em seguida, pelo aviso de confirmação."
        : "Confirma que deseja excluir esta alocação?",
      confirmLabel: "Excluir",
      confirmColor: "#dc2626",
      onConfirm: async () => {
        setConfirmacao(null)
        setSaving(true)
        setError(null)
        try {
          await excluirAlocacao(alocacaoId)
          onSaved({
            acao: "excluida",
            profissional: anterior?.profissional_nome ?? profissional.trim(),
            diaLabel, turno, salaNome: sala.nome_exibicao,
            // O inverso de excluir é recriar com os MESMOS dados. O id novo é
            // diferente, e tudo bem: a alocação é identificada por
            // sala+dia+turno+profissional, não pelo id.
            desfazer: anterior
              ? async () => {
                  await criarAlocacao({
                    sala_id: anterior.sala_id, dow: anterior.dow, turno: anterior.turno,
                    profissional_nome: anterior.profissional_nome, profissional_id: anterior.profissional_id,
                    terapia_nome: anterior.terapia_nome, terapia_id: anterior.terapia_id,
                  })
                }
              : null,
          })
          onClose()
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao excluir alocação.")
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return (
    <ScheduleModal
      title={alocacaoId ? "Editar / mover alocação" : "Alocar sessão livre"}
      subtitle={`${sala.unidade_nome} · ${sala.nome_exibicao} · ${diaLabel} · ${turno}`}
      maxWidth={480}
      zIndex={zIndex}
      onClose={onClose}
      footer={
        <>
          {alocacaoId && (
            <button
              type="button"
              onClick={handleExcluir}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={saving || !podeSalvar}
            title={
              verificacaoExclusividade.status === "bloqueado" ? verificacaoExclusividade.motivo
              : !profissionalValido && profissional.trim() ? "Selecione um profissional real da lista de sugestões"
              : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5E86] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar alocação
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="relative flex flex-col gap-1 text-xs">
          <span className="font-semibold text-muted-foreground">Profissional</span>
          <input
            className={INPUT_CLS}
            value={profissional}
            onChange={e => handleProfissionalChange(e.target.value)}
            onFocus={() => setMostrarSugestoesProf(true)}
            onBlur={() => setTimeout(() => setMostrarSugestoesProf(false), 150)}
            placeholder="Digite o nome do profissional..."
            autoFocus
          />
          {mostrarSugestoesProf && (
            <div className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
              {profissionalSugestoes.length === 0 && (
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Nenhum profissional encontrado.</div>
              )}
              {profissionalSugestoes.slice(0, 30).map(opcao => (
                <button
                  key={opcao.nome}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selecionarProfissional(opcao)}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                >
                  {opcao.nome}
                </button>
              ))}
            </div>
          )}
          {/* Só aparece com o campo FECHADO (depois que o usuário saiu dele) —
              mostrar a cada tecla digitada (ex.: só "a") é alarme falso, já
              que nenhum nome real bate logo na primeira letra. */}
          {!mostrarSugestoesProf && profissional.trim() && !profissionalValido && (
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              Selecione um profissional da lista (nome deve bater com um profissional real).
            </span>
          )}
        </label>

        <label className="relative flex flex-col gap-1 text-xs">
          <span className="font-semibold text-muted-foreground">
            Terapia
            {terapiasDoProfissional && terapiasDoProfissional.length > 0 && (
              <span className="ml-1.5 font-normal normal-case text-muted-foreground/80">
                (mostrando só as que {profissional.split(" ")[0]} realiza)
              </span>
            )}
          </span>
          <input
            className={`${INPUT_CLS} disabled:cursor-not-allowed disabled:opacity-50`}
            value={terapia}
            onChange={e => setTerapia(e.target.value)}
            onFocus={() => profissionalValido && setMostrarSugestoesTerapia(true)}
            onBlur={() => setTimeout(() => setMostrarSugestoesTerapia(false), 150)}
            placeholder={profissionalValido ? "Digite a terapia..." : "Selecione o profissional primeiro"}
            disabled={!profissionalValido}
          />
          {mostrarSugestoesTerapia && profissionalValido && terapiasSugeridas.length > 0 && (
            <div className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
              {terapiasSugeridas.slice(0, 20).map(nome => (
                <button
                  key={nome}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setTerapia(nome); setMostrarSugestoesTerapia(false) }}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                >
                  {nome}
                </button>
              ))}
            </div>
          )}
          {verificacaoExclusividade.status === "bloqueado" && (
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{verificacaoExclusividade.motivo}</span>
          )}
          {verificacaoExclusividade.status === "aviso" && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{verificacaoExclusividade.motivo}</span>
          )}
        </label>

        <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          Isso é só planejamento de ocupação de sala — não cria nem altera nenhum agendamento real na TiTa.
        </div>
      </div>
      {error && <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {confirmacao && (
        <ConfirmDialog
          title={confirmacao.title}
          description={confirmacao.description}
          confirmLabel={confirmacao.confirmLabel}
          confirmColor={confirmacao.confirmColor}
          onConfirm={confirmacao.onConfirm}
          onCancel={() => setConfirmacao(null)}
        />
      )}
    </ScheduleModal>
  )
}
