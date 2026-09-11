"use client"

import { useMemo, useState } from "react"
import { AlertCircle, History, Loader2, Save, Users } from "lucide-react"
import toast from "react-hot-toast"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { DatePicker } from "@/components/ui/date-picker"
import { campo, foco, rotulo, CampoSelect } from "@/components/cadastros/pacientes/ui/campos"
import { ESPECIALISTAS_PDI, type ItemPdi, type EspecialistaPdiId } from "@/lib/pdi/filtros"
import { dataImplementacaoPic, prazoFechamento, prazoRelatorio } from "@/lib/pdi/datas"
import { calcularPrioridade, calcularStatus, diasRestantes } from "@/lib/pdi/status"
import { salvarPdiPrazos } from "@/services/pdiPrazos.service"

// O modal de edição do Controle de Prazos do PDI. MOLDE de
// RegistrarAvisoModal.tsx: mesmo ScheduleModal, mesmo botão de Histórico no
// rodapé, mesmo padrão de erro exibido NO MODAL (não só em toast — ver o
// aviso sobre RLS silenciosa no service), mesmo `onSalvo` devolvendo o item
// atualizado para a lista não recarregar tudo.
//
// Diferença central: as TRÊS datas derivadas (Prazo Relatório, Implementação
// do PIC, Prazo Fechamento) são recalculadas AO VIVO no formulário a partir
// da Data da Avaliação digitada — pedido do plano — usando as mesmas funções
// puras de lib/pdi/datas.ts que o servidor usa para montar `ItemPdi`. Isso é
// o que faz o formulário responder na hora, antes mesmo de salvar, e também
// o que garante que o valor mostrado bate exatamente com o que o servidor vai
// calcular a partir do mesmo dado.

const ESPECIALISTA_LABEL: Record<EspecialistaPdiId, string> = {
  [ESPECIALISTAS_PDI.AMANDA]: "Amanda Ribeiro",
  [ESPECIALISTAS_PDI.GRACIELLE]: "Gracielle Rayane",
}

/** `CampoSelect` só aceita valores string — converte de/para `EspecialistaPdiId` (number) na borda. */
const ESPECIALISTA_OPCOES = (Object.values(ESPECIALISTAS_PDI) as EspecialistaPdiId[]).map((id) => ({
  valor: String(id),
  rotulo: ESPECIALISTA_LABEL[id],
}))

function isoParaBr(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  if (!ano || !mes || !dia) return "—"
  return `${dia}/${mes}/${ano}`
}

export function PdiDetalheModal({
  item,
  hoje,
  onFechar,
  onSalvo,
  zIndex,
}: {
  item: ItemPdi
  /** `meta.hoje` do servidor — mesma base usada pela lista para status/prioridade. */
  hoje: string
  /** Repassado ao ScheduleModal para empilhar sobre outro modal já aberto (ver PainelAnalistaShell). */
  zIndex?: number
  onFechar: () => void
  /** Devolve o item atualizado para a lista não precisar recarregar tudo. */
  onSalvo: (atualizado: ItemPdi) => void
}) {
  const [especialistaTitaId, setEspecialistaTitaId] = useState<EspecialistaPdiId | null>(
    item.especialistaTitaId as EspecialistaPdiId | null,
  )
  const [dataAvaliacao, setDataAvaliacao] = useState(item.dataAvaliacao ?? "")
  const [dataValidade, setDataValidade] = useState(item.dataValidade ?? "")
  const [observacoes, setObservacoes] = useState(item.observacoes ?? "")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)

  const sujo =
    (item.especialistaTitaId ?? null) !== especialistaTitaId ||
    (item.dataAvaliacao ?? "") !== dataAvaliacao ||
    (item.dataValidade ?? "") !== dataValidade ||
    (item.observacoes ?? "") !== observacoes

  // Recálculo AO VIVO — mesmas funções puras que o servidor usa (ver o
  // cabeçalho). `dataAvaliacao` vazia não tem prazo a calcular: as três ficam
  // `null`, e o form mostra "—", igual ao servidor mostraria "Aguardando
  // Implementação" sem avaliação nenhuma.
  const derivadas = useMemo(() => {
    if (!dataAvaliacao) return { relatorio: null, implementacao: null, fechamento: null }
    const relatorio = prazoRelatorio(dataAvaliacao)
    const implementacao = dataImplementacaoPic(relatorio)
    const fechamento = prazoFechamento(implementacao)
    return { relatorio, implementacao, fechamento }
  }, [dataAvaliacao])

  // `dataValidade` NÃO entra mais aqui — decisão do usuário (05/09/2026): os
  // quatro status vêm só da comparação hoje×prazoFechamento, ponto final (ver
  // o cabeçalho de lib/pdi/status.ts::calcularStatus).
  const statusPrevisto = useMemo(
    () => calcularStatus({ prazoFechamento: derivadas.fechamento, hoje }),
    [derivadas.fechamento, hoje],
  )
  const dias = diasRestantes(derivadas.fechamento, hoje)
  const prioridadePrevista = calcularPrioridade(statusPrevisto)

  async function salvar() {
    setSalvando(true)
    setErro(null)

    const { data, error } = await salvarPdiPrazos(item.pacienteId, item.nome, {
      especialistaTitaId,
      dataAvaliacao: dataAvaliacao || null,
      dataValidade: dataValidade || null,
      observacoes,
    })

    setSalvando(false)

    if (error || !data) {
      setErro(error ?? "Não foi possível salvar.")
      return
    }

    // O item devolvido recalcula status/prioridade com o MESMO dado que
    // acabou de ser gravado — evita a lista mostrar um card desatualizado até
    // o próximo carregamento completo.
    onSalvo({
      ...item,
      especialistaTitaId: data.especialista_tita_id,
      dataAvaliacao: data.data_avaliacao,
      dataValidade: data.data_validade,
      observacoes: data.observacoes,
      prazoRelatorio: derivadas.relatorio,
      dataImplementacaoPic: derivadas.implementacao,
      prazoFechamento: derivadas.fechamento,
      status: statusPrevisto,
      prioridade: prioridadePrevista,
      diasRestantes: dias,
    })
    toast.success("Controle de Prazos do PDI salvo.")
    onFechar()
  }

  return (
    <>
      <ScheduleModal
        title={item.nome}
        subtitle={
          <>
            ID {item.pacienteId} ·{" "}
            <span className="font-bold text-foreground">{statusPrevisto}</span>
          </>
        }
        maxWidth={640}
        zIndex={zIndex}
        onClose={onFechar}
        footer={
          <>
            <button
              type="button"
              onClick={() => setVerHistorico(true)}
              className={`mr-auto inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
            >
              <History className="h-4 w-4" aria-hidden="true" />
              Histórico
            </button>
            <button
              type="button"
              onClick={onFechar}
              className={`rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando || !sujo}
              className={`inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ${foco}`}
            >
              {salvando ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Salvar
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}

          {/* ── Editáveis ── */}
          <CampoSelect
            label="Especialista"
            value={especialistaTitaId !== null ? String(especialistaTitaId) : null}
            onChange={(v) => setEspecialistaTitaId(v ? (Number(v) as EspecialistaPdiId) : null)}
            disabled={false}
            opcoes={ESPECIALISTA_OPCOES}
            vazio="Sem especialista atribuído"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={rotulo}>Data da Avaliação</label>
              <DatePicker value={dataAvaliacao} onChange={setDataAvaliacao} />
            </div>
            <div>
              {/* Destaque vermelho REMOVIDO (05/09/2026): a regra "Data de
                  validade preenchida sobrepõe Atrasado" foi eliminada — este
                  campo não influencia mais o Status (ver o cabeçalho de
                  lib/pdi/status.ts::calcularStatus), então não há mais nada
                  aqui que precise de confirmação com Amanda/Gracielle. */}
              <label className={rotulo}>Data de validade</label>
              <DatePicker value={dataValidade} onChange={setDataValidade} />
            </div>
          </div>

          <div>
            <label className={rotulo} htmlFor="observacoes-pdi">
              Observações
            </label>
            <textarea
              id="observacoes-pdi"
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Situação atual, pendências, combinados com a família ou a equipe…"
              className={`mt-1 ${campo} resize-y`}
            />
          </div>

          {/* Aplicadores ABA da agenda do paciente — pedido do usuário
              (05/09/2026): o card só mostra a contagem, aqui dá pra ver
              quem são, QUAL sigla cada um faz (PS/EF/SF/AE/HS/AV — a mesma
              pessoa pode acumular mais de uma) e em quais dias. Somente
              leitura — vem da grade sincronizada, não é editável aqui. */}
          <div>
            <label className={rotulo}>Aplicadores ABA</label>
            {item.aplicadores.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum aplicador na agenda atual.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                {item.aplicadores.map((a) => (
                  <li
                    key={a.profissionalId}
                    className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                      <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{a.nome}</span>
                      <span className="flex shrink-0 gap-1">
                        {a.siglas.map((sigla) => (
                          <span
                            key={sigla}
                            title={`Aplicador ABA (${sigla})`}
                            className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-muted-foreground"
                          >
                            {sigla}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 truncate text-right text-xs text-muted-foreground">
                      {a.dias.map((d) => d.slice(0, 3)).join(", ") || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <hr className="border-border" />

          {/* ── Derivadas — somente leitura, recalculadas ao vivo ── */}
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <Par rotuloTexto="Prazo Relatório" valor={isoParaBr(derivadas.relatorio)} />
            <Par rotuloTexto="Implementação PIC" valor={isoParaBr(derivadas.implementacao)} />
            <Par rotuloTexto="Prazo Fechamento" valor={isoParaBr(derivadas.fechamento)} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Calculadas a partir da Data da Avaliação: +15 dias corridos (Relatório), +7 dias
            (Implementação do PIC) e +6 meses de calendário (Fechamento).
          </p>
        </div>
      </ScheduleModal>

      {verHistorico && (
        <HistoricoCadastrosModal
          titulo="Histórico do Controle de Prazos do PDI"
          subtitulo={`Todas as alterações no ciclo de ${item.nome} — mais recentes primeiro.`}
          entidades={["pdi_controle_prazos"]}
          registroId={String(item.pacienteId)}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </>
  )
}

function Par({ rotuloTexto, valor }: { rotuloTexto: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotuloTexto}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{valor}</dd>
    </div>
  )
}
