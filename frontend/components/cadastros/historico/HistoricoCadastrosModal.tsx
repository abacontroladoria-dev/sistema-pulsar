"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  History,
  AlertCircle,
} from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { TONE_SOLID, type Tone } from "@/components/cronograma/ui/tones"
import { getAuditoria, nomesDeIds } from "@/services/cadastrosAuditoria.service"
import {
  camposAlterados,
  camposSnapshot,
  dataHoraAuditoria,
  nomeContextual,
  resumoAlteracao,
  type NomesDeIds,
} from "@/lib/cadastros/auditoriaFormat"
import {
  ACAO_LABEL,
  ENTIDADE_LABEL,
  type AcaoAuditada,
  type EntidadeAuditada,
  type RegistroAuditoria,
} from "@/types/auditoria"

// Histórico de alterações dos cadastros. Mesmo desenho do HistoricoAuditoriaModal
// de Ocupação de Salas: lista cronológica de cards colapsáveis, badge de ação,
// resumo sempre visível, antes → depois no corpo, e só paginação.
//
// SEM FILTROS, de propósito. A versão anterior tinha busca, tipo, ação, usuário e
// período; um histórico que depende de filtro deixa de responder "o que
// aconteceu aqui" e passa a responder "o que o filtro deixou passar". O único
// recorte é o `pacienteId`, que não é filtro escolhido pelo usuário: é a
// identidade da tela que abriu o modal.

const ITENS_POR_PAGINA = 30

const ACAO_TONE: Record<AcaoAuditada, Tone> = {
  criar: "green",
  editar: "blue",
  excluir: "red",
  inativar: "amber",
  reativar: "green",
}

export function HistoricoCadastrosModal({
  titulo = "Histórico de alterações",
  subtitulo,
  entidades,
  pacienteId,
  registroId,
  onClose,
}: {
  titulo?: string
  subtitulo?: string
  /** Restringe ao módulo — ex.: as entidades de paciente, ou as duas de convênio. */
  entidades: EntidadeAuditada[]
  /** Quando presente, mostra só a trilha desse paciente (inclui responsável e ficha). */
  pacienteId?: number
  /**
   * Quando presente, mostra só a trilha de UM registro — ex.: um responsável
   * específico, independente de qual paciente estava aberto quando ele foi
   * editado. `pacienteId` sozinho não cobriria isso: um responsável editado a
   * partir de outro paciente teria um `pacienteId` diferente na trilha.
   */
  registroId?: string | number
  onClose: () => void
}) {
  const [itens, setItens] = useState<RegistroAuditoria[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [expandidoId, setExpandidoId] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [nomes, setNomes] = useState<NomesDeIds>({})

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, total: t, error } = await getAuditoria({
      entidades,
      pacienteId,
      registroId,
      pagina,
      limite: ITENS_POR_PAGINA,
    })
    // Antes de mostrar a página: sem o nome, a linha piscaria "11 → 18" e trocaria.
    setNomes(await nomesDeIds(data))
    setItens(data)
    setTotal(t)
    setErro(error)
    // O item aberto era da página anterior; manter o id deixaria um card
    // expandido no lugar errado da lista.
    setExpandidoId(null)
    setCarregando(false)
    // `entidades` é literal no chamador; serializar evita refetch a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entidades.join(","), pacienteId, registroId, pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const totalPaginas = Math.max(1, Math.ceil(total / ITENS_POR_PAGINA))

  return (
    <ScheduleModal
      title={titulo}
      subtitle={
        subtitulo ??
        "Criações, edições e inativações — mais recentes primeiro. Clique em um item para ver o antes e o depois."
      }
      maxWidth={860}
      onClose={onClose}
    >
      <div className="space-y-3">
        {erro ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Não foi possível carregar o histórico. {erro}</span>
          </div>
        ) : carregando ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando histórico…
          </div>
        ) : itens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <History className="h-6 w-6 opacity-40" aria-hidden="true" />
            Nenhuma alteração registrada ainda.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {itens.map((item) => (
              <ItemHistorico
                key={item.id}
                item={item}
                nomes={nomes}
                expandido={expandidoId === item.id}
                onToggle={() => setExpandidoId(expandidoId === item.id ? null : item.id)}
              />
            ))}
          </ul>
        )}

        {/* ── Paginação ── */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1 || carregando}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Anterior
            </button>
            <span className="text-xs text-muted-foreground">
              Página {pagina} de {totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas || carregando}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Próxima
            </button>
          </div>
        )}
      </div>
    </ScheduleModal>
  )
}

function ItemHistorico({
  item,
  nomes,
  expandido,
  onToggle,
}: {
  item: RegistroAuditoria
  nomes: NomesDeIds
  expandido: boolean
  onToggle: () => void
}) {
  const tone = TONE_SOLID[ACAO_TONE[item.acao]]
  const alteracoes = camposAlterados(item.tabela, item.antes, item.depois, nomes)
  const snapshot =
    item.acao === "criar"
      ? camposSnapshot(item.tabela, item.depois, nomes)
      : item.acao === "excluir"
        ? camposSnapshot(item.tabela, item.antes, nomes)
        : []
  // O resumo vem gravado do momento da alteração. Edição da ficha médica é
  // recalculada aqui para as linhas antigas, gravadas com o id do plano
  // ("Plano de saúde: 11 → 18"), também mostrarem o nome.
  const resumo =
    item.acao === "editar" && item.tabela === "ficha_medica" && nomes.plano_saude_id
      ? resumoAlteracao(
          { tabela: item.tabela, registroId: item.registro_id, acao: item.acao, antes: item.antes, depois: item.depois },
          nomes
        )
      : item.resumo

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expandido}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
          {expandido ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone.bg} ${tone.text}`}
            >
              {ACAO_LABEL[item.acao]}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
              {ENTIDADE_LABEL[item.tabela]}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {nomeContextual(item)}
            </span>
          </span>
          <span className="mt-1 block text-[12px] text-muted-foreground">
            {resumo ?? "—"}
          </span>
        </span>

        <span className="shrink-0 text-right text-[11px] text-muted-foreground">
          <span className="block">{item.usuario_nome ?? "Usuário desconhecido"}</span>
          <span className="block">{dataHoraAuditoria(item)}</span>
        </span>
      </button>

      {expandido && (
        <div className="border-t border-border px-3 py-2 pl-[34px]">
          {item.motivo && (
            <p className="mb-2 text-sm text-foreground">
              <span className="font-semibold">Motivo:</span> {item.motivo}
            </p>
          )}

          {alteracoes.length > 0 && (
            <div className="space-y-1">
              {alteracoes.map((c) => (
                <div key={c.campo} className="text-sm text-foreground">
                  <span className="font-semibold">{c.label}:</span> {c.antes}{" "}
                  <span className="text-muted-foreground">→</span> {c.depois}
                </div>
              ))}
            </div>
          )}

          {snapshot.length > 0 && (
            <div className="space-y-1">
              {snapshot.map((c) => (
                <div key={c.campo} className="text-sm text-foreground">
                  <span className="font-semibold">{c.label}:</span> {c.valor}
                </div>
              ))}
            </div>
          )}

          {alteracoes.length === 0 && snapshot.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sem detalhe de campos para este registro.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
