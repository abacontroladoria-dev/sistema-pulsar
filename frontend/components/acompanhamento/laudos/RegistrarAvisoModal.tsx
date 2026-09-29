"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  History,
  KeyRound,
  Loader2,
  Save,
} from "lucide-react"
import toast from "react-hot-toast"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { DatePicker } from "@/components/ui/date-picker"
import { campo, foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { isoParaBr } from "@/lib/laudos/acompanhamento"
import { SITUACAO_LAUDO_LABEL, avisoEhPrematuro, diasAteValidade } from "@/lib/laudos/filtros"
import { salvarAcompanhamento } from "@/services/laudosAcompanhamento.service"
import type {
  AutorizacaoSenha,
  ItemAcompanhamentoLaudo,
  MetaSenhas,
  SenhaDoRol,
} from "@/types/laudosAcompanhamento"
import { TOM_SENHA, dataHoraParaBr, textoStatusSenha } from "./senhaUi"

// O registro do contato: "Mensagem enviada em" + observação.
//
// UM CAMPO DE DATA, sobrescrevível — não uma lista de tentativas (decisão do
// usuário em 28/08/2026). A sequência de cobranças não se perde por isso: cada
// alteração entra em `cadastros_auditoria` com usuário, data/hora de Brasília e
// `antes → depois`, e o botão Histórico abre exatamente essa trilha. O card
// mostra o estado atual; a trilha conta a história.
//
// A FOTO é a mesma linha de `public.pacientes` que /cadastros/pacientes edita —
// o componente é literalmente o mesmo, com o mesmo bucket e o mesmo path. Trocar
// aqui aparece lá e vice-versa; não há cópia nem sincronização a manter.

export function RegistrarAvisoModal({
  item,
  hoje,
  metaSenhas,
  onFechar,
  onSalvo,
}: {
  item: ItemAcompanhamentoLaudo
  /** `meta.hoje` do servidor — a mesma base usada em toda a tela para "quantos dias faltam". */
  hoje: string
  /** A importação de senhas em uso — para dizer de que arquivo vieram. */
  metaSenhas: MetaSenhas | null
  onFechar: () => void
  /** Devolve o item atualizado para a lista não precisar recarregar tudo. */
  onSalvo: (atualizado: ItemAcompanhamentoLaudo) => void
}) {
  const [dataAviso, setDataAviso] = useState(item.mensagemEnviadaEm ?? "")
  const [observacao, setObservacao] = useState(item.observacao ?? "")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  // Abre a confirmação vermelha em vez de salvar direto — ver `confirmarSalvar`.
  const [confirmarPrematuro, setConfirmarPrematuro] = useState(false)

  const dataMudou = (item.mensagemEnviadaEm ?? "") !== dataAviso
  const sujo = dataMudou || (item.observacao ?? "") !== observacao

  /**
   * Cedo demais para marcar "avisado"? Só é avaliado quando a MENSAGEM em si
   * mudou para uma data preenchida — regra do usuário (28/08/2026): editar só
   * a observação, ou apagar a data, não é "declarar que avisou cedo demais".
   */
  const prematuro = dataMudou && dataAviso !== "" && avisoEhPrematuro(item.validade, hoje)
  const diasParaVencer = diasAteValidade(item.validade, hoje)

  /** O botão Salvar chama isto: intercepta para confirmar quando prematuro. */
  function confirmarSalvar() {
    if (prematuro) {
      setConfirmarPrematuro(true)
      return
    }
    void salvar()
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)

    const { data, error } = await salvarAcompanhamento(item, {
      mensagemEnviadaEm: dataAviso || null,
      observacao,
    })

    setSalvando(false)

    if (error || !data) {
      // Mostrado NO MODAL, não só em toast: um toast que passa deixaria o
      // usuário achando que salvou. Ver o aviso sobre RLS silenciosa no service.
      setErro(error ?? "Não foi possível salvar.")
      return
    }

    onSalvo({
      ...item,
      mensagemEnviadaEm: data.mensagem_enviada_em,
      observacao: data.observacao,
      registradoPorNome: data.atualizado_por_nome,
      registradoEm: data.atualizado_em_brasilia,
    })
    toast.success("Registro salvo.")
    onFechar()
  }

  return (
    <>
      <ScheduleModal
        // "Fulano de tal (ASSIM Saúde)" — o convênio entre parênteses depois do
        // nome (pedido do usuário, 28/09/2026).
        title={item.convenio ? `${item.nome} (${item.convenio})` : item.nome}
        subtitle={
          <>
            {/* "ID" e não "PAC" (pedido do usuário, 28/09/2026) — o card e o
                detalhe usam o mesmo rótulo. */}
            ID {item.idFavorecido ?? "—"}, LAUDO {item.idLaudo} ·{" "}
            <span
              className={
                item.situacao === "vencido"
                  ? "font-bold text-rose-600 dark:text-rose-400"
                  : "font-bold text-emerald-600 dark:text-emerald-400"
              }
            >
              {SITUACAO_LAUDO_LABEL[item.situacao]}
            </span>
          </>
        }
        warning={
          item.situacaoDivergente
            ? `O Órbita marca este laudo como ${item.situacaoOrbita || "—"}, mas a validade (${isoParaBr(item.validade)}) diz o contrário.`
            : undefined
        }
        maxWidth={640}
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
              onClick={confirmarSalvar}
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

          {/* Sem foto aqui (pedido do usuário, 28/09/2026): o espaço inteiro é do
              laudo. A foto continua editável no cadastro do paciente — link
              logo abaixo. */}
          <BlocoLaudo item={item} />

          <SecaoSenhas item={item} metaSenhas={metaSenhas} />

          {item.pacienteId !== null && (
            <Link
              href={`/cadastros/pacientes/${item.pacienteId}`}
              className={`inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline ${foco}`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir cadastro do paciente
            </Link>
          )}

          <hr className="border-border" />

          {/* ── O registro ── */}
          <div>
            <label className={rotulo}>Mensagem enviada em</label>
            {/* O MESMO calendário do "Autorizado em" do laudo, em
                /cadastros/pacientes/[id] — não o `<input type="date">` nativo,
                que muda de desenho a cada navegador e obriga a digitar a data no
                formato que ele quer. Aqui vem com "Hoje" e "Limpar", que são os
                dois cliques que esta tela mais faz. */}
            <DatePicker value={dataAviso} onChange={setDataAviso} />
            <p className="mt-1 text-xs text-muted-foreground">
              O dia em que a recepção avisou o responsável sobre a renovação. Apagar a data
              devolve o laudo à fila de pendências — e a mudança fica no histórico.
            </p>
          </div>

          <div>
            <label className={rotulo} htmlFor="observacao-aviso">
              Observação
            </label>
            <textarea
              id="observacao-aviso"
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Por qual canal, com quem falou, o que o responsável respondeu…"
              className={`mt-1 ${campo} resize-y`}
            />
          </div>

          {item.registradoPorNome && (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Último registro por <span className="font-semibold">{item.registradoPorNome}</span>
              {item.registradoEm ? ` em ${item.registradoEm}` : ""}.
            </p>
          )}
        </div>
      </ScheduleModal>

      {verHistorico && (
        <HistoricoCadastrosModal
          titulo="Histórico do acompanhamento"
          subtitulo={`Todas as alterações no acompanhamento do laudo ${item.idLaudo} — mais recentes primeiro.`}
          entidades={["laudo_acompanhamento"]}
          // `registroId` e não `pacienteId`: a trilha é DESTE laudo. O
          // `pacienteId` traria também paciente, responsável e ficha — o que a
          // tela de cadastro já faz, e aqui só afogaria o que se quer ver.
          registroId={item.idLaudo}
          onClose={() => setVerHistorico(false)}
        />
      )}

      {/* Confirmação de aviso PREMATURO — regra do usuário (28/08/2026).
          NÃO bloqueia: a recepção pode ter um motivo que a tela não vê (o
          responsável ligou por conta própria, por exemplo). Só confirma,
          porque o erro mais comum aqui é clicar Salvar sem reparar que a
          validade ainda está longe. "Confirmar mesmo assim" chama o MESMO
          `salvar()` do botão principal — a confirmação intercepta o clique,
          não substitui a gravação. */}
      {confirmarPrematuro && (
        <ScheduleModal
          title="Ainda faltam muitos dias para o laudo vencer"
          maxWidth={460}
          onClose={() => setConfirmarPrematuro(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmarPrematuro(false)}
                className={`rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
              >
                Voltar e revisar
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmarPrematuro(false)
                  void salvar()
                }}
                disabled={salvando}
                className={`inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 ${foco}`}
              >
                Confirmar mesmo assim
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>
              Tem certeza? Ainda faltam <span className="font-bold">{diasParaVencer}</span> dias
              para o laudo vencer. Espere até que faltem 15 dias.
            </p>
          </div>
        </ScheduleModal>
      )}
    </>
  )
}

/**
 * O laudo no formato da aba Laudo de /cadastros/pacientes/[id] — pedido do
 * usuário (28/09/2026): "Laudo de dd/mm/aaaa", o selo de situação, a linha
 * "Validade · Autorizado em" e a tabela Especialidade / Qt Laudo / Qt Autor.
 *
 * Os dados são os do relatório do Órbita (`Qtd laudo`/`Qtd autorizada` de cada
 * linha de especialidade), não os de `cadastros_pacientes_laudos` que aquela aba
 * lê: esta tela é a do relatório, e um laudo sem cadastro no Pulsar (58 em 343
 * medidos) também precisa mostrar a tabela. "—" = quantidade vazia no relatório.
 */
function BlocoLaudo({ item }: { item: ItemAcompanhamentoLaudo }) {
  const selo =
    item.situacao === "vencido"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400"
      : item.situacao === "vigente"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
        : "bg-muted text-muted-foreground"

  return (
    <div className="w-full min-w-0 flex-1 rounded-lg border border-border px-3 py-3">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              Laudo de {isoParaBr(item.dataLaudo)}
            </p>
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${selo}`}>
              {SITUACAO_LAUDO_LABEL[item.situacao]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Validade: {isoParaBr(item.validade)}
            {item.autorizadoEm && ` · Autorizado em ${isoParaBr(item.autorizadoEm)}`}
          </p>
        </div>
      </div>

      {item.especialidadesQtd.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="pb-1 pr-4 font-semibold">
                  Especialidade
                </th>
                <th scope="col" className="pb-1 pr-4 font-semibold">
                  Qt Laudo
                </th>
                <th scope="col" className="pb-1 font-semibold">
                  Qt Autor.
                </th>
              </tr>
            </thead>
            <tbody>
              {item.especialidadesQtd.map((e) => (
                <tr key={e.especialidade} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-4 text-foreground">{e.especialidade}</td>
                  <td className="py-1 pr-4 tabular-nums text-foreground">{e.qtdLaudo || "—"}</td>
                  <td className="py-1 tabular-nums text-foreground">{e.qtdAutorizada || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Nenhuma especialidade no relatório do Órbita.
        </p>
      )}
    </div>
  )
}

/**
 * As senhas ASSIM do laudo.
 *
 * O RESUMO (número + status de cada lado) fica sempre à vista — é o mesmo que o
 * cartão mostra. O resto (liberação, validade, "Criado em", "Atualizado em",
 * especialidades, cada autorização) fica atrás de "Ver detalhes da senha" —
 * pedido do usuário (28/09/2026): "de pano de fundo, só aparecerão quando o
 * usuário clicar para ver". `<details>` nativo: abre e fecha sem estado, com
 * teclado e leitor de tela de graça.
 */
function SecaoSenhas({
  item,
  metaSenhas,
}: {
  item: ItemAcompanhamentoLaudo
  metaSenhas: MetaSenhas | null
}) {
  const senhas = item.senhas

  return (
    <section className="rounded-lg border border-border px-3 py-3" aria-label="Senhas ASSIM">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Senhas ASSIM
      </h3>

      {!senhas ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum relatório de senhas importado. Use “Atualizar senhas” no topo da tela.
        </p>
      ) : (
        <>
          <dl className="mt-2 space-y-1.5 text-sm">
            {senhas.dentro.status === "nao_se_aplica" ? (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Dentro do ROL</dt>
                <dd className="min-w-0 font-semibold text-muted-foreground">
                  Não se aplica — convênio {item.convenio ?? "não identificado"}
                </dd>
              </div>
            ) : (
              <ResumoLado rotuloTexto="Dentro do ROL" senha={senhas.dentro} lado="dentro" />
            )}
            {senhas.fora.status !== "nao_se_aplica" && (
              <ResumoLado rotuloTexto="Fora do ROL" senha={senhas.fora} lado="fora" />
            )}
          </dl>

          {senhas.autorizacoes.length > 0 && (
            <details className="group mt-3">
              <summary
                className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-semibold text-primary hover:underline [&::-webkit-details-marker]:hidden ${foco}`}
              >
                <ChevronRight
                  className="h-4 w-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                Ver detalhes da senha
                {senhas.autorizacoes.length > 1 && ` (${senhas.autorizacoes.length} autorizações)`}
              </summary>
              <ul className="mt-3 space-y-3">
                {senhas.autorizacoes.map((a) => (
                  <DetalheAutorizacao
                    key={a.idAutorizacao}
                    autorizacao={a}
                    exibida={
                      a.idAutorizacao === senhas.dentro.idAutorizacao ||
                      a.idAutorizacao === senhas.fora.idAutorizacao
                    }
                    mostrarFora={senhas.fora.status !== "nao_se_aplica"}
                  />
                ))}
              </ul>
            </details>
          )}

          {metaSenhas && (
            <p className="mt-3 text-xs text-muted-foreground">
              Relatório {metaSenhas.arquivoNome}
              {metaSenhas.importadoEm && `, importado em ${metaSenhas.importadoEm}`}
              {metaSenhas.importadoPorNome && ` por ${metaSenhas.importadoPorNome}`}.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function ResumoLado({
  rotuloTexto,
  senha,
  lado,
}: {
  rotuloTexto: string
  senha: SenhaDoRol
  lado: "dentro" | "fora"
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{rotuloTexto}</dt>
      <dd className="min-w-0">
        {senha.senha && (
          <span className="mr-2 font-semibold tabular-nums text-foreground">{senha.senha}</span>
        )}
        <span className={`font-bold ${TOM_SENHA[senha.status].cor}`}>
          {textoStatusSenha(senha, lado)}
        </span>
      </dd>
    </div>
  )
}

/** Uma autorização do relatório, com tudo o que a ASSIM informa dela. */
function DetalheAutorizacao({
  autorizacao: a,
  exibida,
  mostrarFora,
}: {
  autorizacao: AutorizacaoSenha
  /** É a autorização cuja senha aparece no cartão. */
  exibida: boolean
  mostrarFora: boolean
}) {
  return (
    <li className="rounded-md bg-muted/40 px-3 py-2 text-xs">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-foreground">Autorização {a.idAutorizacao}</span>
        {exibida && (
          <span className="rounded bg-primary/10 px-1.5 font-semibold text-primary">
            senha exibida no cartão
          </span>
        )}
      </p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <ParDetalhe rotuloTexto="Situação dentro do ROL" valor={a.situacaoDentro || "—"} />
        <ParDetalhe rotuloTexto="Senha dentro do ROL" valor={a.senhaDentro || "—"} />
        <ParDetalhe rotuloTexto="Liberação dentro do ROL" valor={isoParaBr(a.liberacaoDentro)} />
        <ParDetalhe rotuloTexto="Validade dentro do ROL" valor={isoParaBr(a.validadeDentro)} />
        {mostrarFora && (
          <>
            <ParDetalhe rotuloTexto="Situação fora do ROL" valor={a.situacaoFora || "—"} />
            <ParDetalhe rotuloTexto="Senha fora do ROL" valor={a.senhaFora || "—"} />
            <ParDetalhe rotuloTexto="Liberação fora do ROL" valor={isoParaBr(a.liberacaoFora)} />
            <ParDetalhe rotuloTexto="Validade fora do ROL" valor={isoParaBr(a.validadeFora)} />
          </>
        )}
        <ParDetalhe rotuloTexto="Criado em" valor={dataHoraParaBr(a.criadoEmOrigem)} />
        <ParDetalhe rotuloTexto="Atualizado em" valor={dataHoraParaBr(a.atualizadoEmOrigem)} />
        <ParDetalhe rotuloTexto="Data da lista" valor={isoParaBr(a.dataLista)} />
        {a.observacoes && <ParDetalhe rotuloTexto="Observações" valor={a.observacoes} />}
      </dl>

      <TabelaEspecialidadesAutorizadas especialidades={a.especialidades} />
    </li>
  )
}

/**
 * As especialidades da autorização em tabela — terapia × quantidade autorizada
 * × ROL (pedido do usuário, 28/09/2026: a lista corrida era difícil de ler).
 * Mesmo desenho da tabela de especialidades do laudo (`BlocoLaudo`), para as
 * duas lerem igual. "Fora" em âmbar: é a senha que costuma faltar.
 */
function TabelaEspecialidadesAutorizadas({
  especialidades,
}: {
  especialidades: AutorizacaoSenha["especialidades"]
}) {
  if (especialidades.length === 0) {
    return <p className="mt-2 text-muted-foreground">Nenhuma especialidade nesta autorização.</p>
  }
  const ordenadas = [...especialidades].sort((x, y) =>
    x.especialidade.localeCompare(y.especialidade, "pt-BR"),
  )
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-2 py-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-4 font-semibold">
              Especialidade
            </th>
            <th scope="col" className="py-1 pr-4 font-semibold">
              Qt Autor.
            </th>
            <th scope="col" className="py-1 font-semibold">
              ROL
            </th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((e, n) => {
            const fora = /fora do rol/i.test(e.grupo)
            return (
              <tr key={`${e.especialidade}-${n}`} className="border-b border-border/50 last:border-0">
                <td className="py-1 pr-4 text-foreground">{e.especialidade || "—"}</td>
                <td className="py-1 pr-4 tabular-nums text-foreground">{e.quantidadeAutorizada || "—"}</td>
                <td className="py-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      fora
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {fora ? "Fora" : "Dentro"}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ParDetalhe({ rotuloTexto, valor }: { rotuloTexto: string; valor: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{rotuloTexto}</dt>
      <dd className="min-w-0 break-words font-semibold tabular-nums text-foreground">{valor}</dd>
    </>
  )
}
