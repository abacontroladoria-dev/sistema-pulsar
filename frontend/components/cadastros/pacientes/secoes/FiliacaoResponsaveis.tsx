"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Plus, ClipboardCopy, AlertCircle, ExternalLink, Copy, Users2, X } from "lucide-react"
import { maskCpfCnpj } from "@/lib/remuneracao/formatacao"
import { useResponsaveis } from "@/hooks/useResponsaveis"
import { getVinculosDeResponsaveis, getVinculosDoPaciente } from "@/services/responsaveis.service"
import { PARENTESCOS, TIPOS_VINCULO } from "@/types/responsavel"
import type {
  Parentesco,
  Responsavel,
  TipoVinculoResponsavel,
  VinculoResponsavelEdit,
} from "@/types/responsavel"
import type { PacienteForm } from "@/hooks/usePacienteDetalhe"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { ResponsavelFormModal } from "../ResponsavelFormModal"
import { ResponsavelPainel } from "../ResponsavelPainel"
import { CopiarResponsaveisModal } from "../CopiarResponsaveisModal"
import { campo, foco, rotulo, Secao } from "../ui/campos"

/**
 * Nome puro de uma opção no combobox.
 *
 * O CPF e o selo de inativo NÃO entram aqui: no SearchCombobox o valor de uma
 * opção É o próprio texto exibido (`sufixoOpcao` é a "prop em vez de sufixo no
 * texto", como o comentário de lá explica) — se o rótulo carregasse "(CPF)"
 * embutido, o campo ficaria mostrando "Nome (056.210.717-78)" para sempre
 * depois de escolhido, não só durante a busca. CPF e inativo aparecem como
 * sufixo NA LISTA, via `sufixoOpcao` abaixo.
 */
function rotuloResponsavel(r: Responsavel): string {
  return r.nome
}

const FILIACOES = new Set<TipoVinculoResponsavel>(["filiacao_1", "filiacao_2"])

// Filiação e responsáveis são ENTIDADES (public.responsaveis), não texto solto:
// irmãos atendidos na clínica compartilham responsável. As colunas legadas
// pacientes.responsavel_* seguem existindo, mas como espelho do TiTa — esta tela
// não escreve nelas. Ver 20260826100200.

export function FiliacaoResponsaveis({
  form,
  set,
  disabled,
}: {
  form: PacienteForm
  set: (patch: Partial<PacienteForm>) => void
  disabled: boolean
}) {
  const { responsaveis, loading, error } = useResponsaveis()
  const [modalTipo, setModalTipo] = useState<TipoVinculoResponsavel | null>(null)
  const [painelResponsavelId, setPainelResponsavelId] = useState<number | null>(null)
  const [copiarAberto, setCopiarAberto] = useState(false)

  // Junta o que a tela mandou com o que já estava — SUBSTITUI só os tipos que
  // vieram na cópia, preserva o resto. A regra de filiação 1 ≠ filiação 2 vale
  // aqui também: se um item bater com quem já ficou na outra filiação, é
  // descartado e avisado, em vez de criar o mesmo engano que o combobox evita.
  function aplicarVinculos(novos: VinculoResponsavelEdit[], origemNome: string) {
    const tiposNovos = new Set(novos.map((v) => v.tipo))
    const mantidos = form.vinculos.filter((v) => !tiposNovos.has(v.tipo))
    const aceitos: VinculoResponsavelEdit[] = []
    const rejeitados: string[] = []

    for (const v of novos) {
      if (FILIACOES.has(v.tipo)) {
        const conflito = [...mantidos, ...aceitos].find(
          (o) => o.responsavel_id === v.responsavel_id && FILIACOES.has(o.tipo)
        )
        if (conflito) {
          rejeitados.push(TIPOS_VINCULO.find((t) => t.tipo === v.tipo)?.rotulo ?? v.tipo)
          continue
        }
      }
      aceitos.push(v)
    }

    set({ vinculos: [...mantidos, ...aceitos] })
    if (rejeitados.length > 0) {
      toast.error(
        `Não copiado: ${rejeitados.join(", ")} — a mesma pessoa já ocupa a outra filiação deste paciente.`
      )
    } else {
      toast.success(`Vínculos copiados de ${origemNome}.`)
    }
  }

  // Sugestão de irmão: só a partir de um vínculo REAL já existente — nunca
  // adivinha parentesco por sobrenome. Sugere, nunca aplica sozinho.
  const [sugestao, setSugestao] = useState<{
    paciente: { id_paciente: number; nome: string }
    novos: VinculoResponsavelEdit[]
  } | null>(null)
  const [sugestaoDispensada, setSugestaoDispensada] = useState<number | null>(null)

  const idsVinculados = form.vinculos.map((v) => v.responsavel_id).join(",")

  useEffect(() => {
    if (disabled || !form.id_paciente || !idsVinculados) {
      setSugestao(null)
      return
    }
    let ativo = true
    getVinculosDeResponsaveis(form.vinculos.map((v) => v.responsavel_id)).then(({ data }) => {
      if (!ativo) return
      let candidato: { id_paciente: number; nome: string } | null = null
      for (const lista of data.values()) {
        const outro = lista.find((p) => p.id_paciente !== form.id_paciente)
        if (outro) {
          candidato = { id_paciente: outro.id_paciente, nome: outro.nome }
          break
        }
      }
      if (!candidato || candidato.id_paciente === sugestaoDispensada) {
        setSugestao(null)
        return
      }
      const idCandidato = candidato.id_paciente
      getVinculosDoPaciente(idCandidato).then(({ data: vinculosCandidato }) => {
        if (!ativo) return
        const tiposAtuais = new Set(form.vinculos.map((v) => v.tipo))
        const demais = vinculosCandidato
          .filter((v) => !tiposAtuais.has(v.tipo))
          .map((v) => ({ tipo: v.tipo, responsavel_id: v.responsavel_id, parentesco: v.parentesco }))
        if (demais.length === 0) {
          setSugestao(null)
          return
        }
        setSugestao({ paciente: candidato!, novos: demais })
      })
    })
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsVinculados, form.id_paciente, disabled, sugestaoDispensada])

  function vincularA(tipo: TipoVinculoResponsavel, responsavelId: number | null) {
    const outros = form.vinculos.filter((v) => v.tipo !== tipo)
    if (responsavelId === null) {
      set({ vinculos: outros })
      return
    }

    // Filiação 1 e 2 representam DUAS pessoas diferentes (ex.: mãe e pai) —
    // a mesma pessoa nas duas é sempre engano de seleção, nunca intencional.
    // Já financeiro/pedagógico legitimamente costumam ser a mesma pessoa que
    // a filiação (a mãe é filiação E responsável financeira), então só as
    // duas filiações entram nesse bloqueio.
    if (FILIACOES.has(tipo)) {
      const jaUsadoEm = outros.find(
        (v) => v.responsavel_id === responsavelId && FILIACOES.has(v.tipo)
      )
      if (jaUsadoEm) {
        const rotuloConflito = TIPOS_VINCULO.find((t) => t.tipo === jaUsadoEm.tipo)?.rotulo ?? jaUsadoEm.tipo
        toast.error(`Este responsável já está em "${rotuloConflito}". Filiação 1 e 2 precisam ser pessoas diferentes.`)
        return
      }
    }

    const atual = form.vinculos.find((v) => v.tipo === tipo)
    set({
      vinculos: [
        ...outros,
        { tipo, responsavel_id: responsavelId, parentesco: atual?.parentesco ?? null },
      ],
    })
  }

  function definirParentesco(tipo: TipoVinculoResponsavel, parentesco: string) {
    set({
      vinculos: form.vinculos.map((v) =>
        v.tipo === tipo ? { ...v, parentesco: parentesco || null } : v
      ),
    })
  }

  function copiarEndereco(responsavel: Responsavel) {
    set({
      cep: responsavel.cep,
      logradouro: responsavel.logradouro,
      numero: responsavel.numero,
      complemento: responsavel.complemento,
      bairro: responsavel.bairro,
      cidade: responsavel.cidade,
      uf: responsavel.uf,
    })
  }

  return (
    <Secao
      titulo="Filiação e responsáveis"
      descricao="Quem responde pelo paciente. Um mesmo responsável pode atender vários pacientes."
      acao={
        !disabled && (
          <button
            type="button"
            onClick={() => setCopiarAberto(true)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted ${foco}`}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copiar de outro paciente
          </button>
        )
      }
    >
      {error && (
        <div
          role="alert"
          className="sm:col-span-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os responsáveis. {error}</span>
        </div>
      )}

      {sugestao && !disabled && (
        <div
          role="status"
          className="sm:col-span-2 flex items-start justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
          <div className="flex items-start gap-2">
            <Users2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Este paciente compartilha responsável com <strong>{sugestao.paciente.nome}</strong>.
              Copiar os demais responsáveis dela?
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                aplicarVinculos(sugestao.novos, sugestao.paciente.nome)
                setSugestao(null)
              }}
              className={`text-sm font-medium text-primary underline ${foco}`}
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => setSugestaoDispensada(sugestao.paciente.id_paciente)}
              className={`rounded p-0.5 text-muted-foreground hover:bg-muted ${foco}`}
              aria-label="Dispensar sugestão"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {TIPOS_VINCULO.map(({ tipo, rotulo: label }) => {
        const vinculo = form.vinculos.find((v) => v.tipo === tipo)
        // Busca no cadastro INTEIRO (getResponsaveis não filtra mais por
        // `ativo`), senão um responsável inativado desaparece do <select> e o
        // form apaga o vínculo em silêncio ao salvar. Ver bug B1 do plano.
        const responsavel = vinculo
          ? responsaveis.find((r) => r.id === vinculo.responsavel_id)
          : undefined
        // Rede de segurança: o vínculo aponta pra um id que nem está no
        // cadastro carregado (linha apagada, RLS parcial). Nunca deixar isso
        // cair silenciosamente em "Não informado" — trava o campo e avisa.
        const naoCarregado = Boolean(vinculo) && !responsavel

        // Oferece ativos + o já vinculado (mesmo inativo). Um inativo nunca
        // aparece como opção NOVA, mas o vínculo existente sempre tem sua
        // opção, rotulada, pra não sumir do combobox.
        const opcoes = responsaveis.filter(
          (r) => r.ativo || r.id === vinculo?.responsavel_id
        )

        // Rótulo → id: o SearchCombobox trabalha com strings, então o nome É
        // o valor. Duas pessoas homônimas colidiriam no mesmo rótulo —
        // desambigua só quando isso acontece, com "#id" no final, pra não
        // poluir o caso comum. O CPF fica de fora do rótulo (ver comentário
        // de rotuloResponsavel); é a lista, não o valor, que precisa dele
        // para diferenciar dois "Maria Silva" na hora de escolher.
        const contagemRotulo = new Map<string, number>()
        for (const r of opcoes) {
          const rot = rotuloResponsavel(r)
          contagemRotulo.set(rot, (contagemRotulo.get(rot) ?? 0) + 1)
        }
        const rotuloUnico = (r: Responsavel) => {
          const base = rotuloResponsavel(r)
          return (contagemRotulo.get(base) ?? 0) > 1 ? `${base} — #${r.id}` : base
        }

        const idPorRotulo = new Map(opcoes.map((r) => [rotuloUnico(r), r.id]))
        // Caminho inverso, só para o sufixo da lista: rótulo -> registro
        // completo, de onde tira o CPF e o `ativo` a exibir ao lado do nome.
        const responsavelPorRotulo = new Map(opcoes.map((r) => [rotuloUnico(r), r]))
        const rotuloNaoCarregado = naoCarregado
          ? `Responsável #${vinculo!.responsavel_id} — não carregado`
          : null
        if (naoCarregado) idPorRotulo.set(rotuloNaoCarregado!, vinculo!.responsavel_id)

        const valorAtual = responsavel ? rotuloUnico(responsavel) : (rotuloNaoCarregado ?? "")

        const parentescoForaDaLista =
          vinculo?.parentesco && !PARENTESCOS.includes(vinculo.parentesco as Parentesco)
            ? vinculo.parentesco
            : null

        return (
          <div key={tipo} className="sm:col-span-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <label className={rotulo}>{label}</label>
              <div className="mt-1">
                <SearchCombobox
                  value={valorAtual}
                  onChange={(rot) => vincularA(tipo, rot ? (idPorRotulo.get(rot) ?? null) : null)}
                  opcoes={[...idPorRotulo.keys()]}
                  placeholder="Digite para buscar um responsável..."
                  ariaLabel={label}
                  disabled={disabled || loading || naoCarregado}
                  sufixoOpcao={(rot) => {
                    const r = responsavelPorRotulo.get(rot)
                    if (!r) return null
                    return (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {r.cpf && maskCpfCnpj(r.cpf)}
                        {!r.ativo && (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-medium text-[var(--status-atencao)]">
                            Inativo
                          </span>
                        )}
                      </span>
                    )
                  }}
                />
              </div>

              {naoCarregado && (
                <p
                  role="alert"
                  className="mt-1 flex items-start gap-1 text-xs text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Não foi possível carregar este responsável. O vínculo não foi perdido —
                  não salve o paciente até conseguir ver o nome aqui.
                </p>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                {responsavel && (
                  // Pílula em emerald — mesmo tom já usado em cadastros para
                  // "confirmado/em dia" (badge "Ativo" de PacienteHeaderCard,
                  // botão salvar de SalvarTudoBar) — destacada dos outros dois
                  // botões da linha (texto puro) porque é a ação mais comum
                  // depois de vincular alguém: conferir se escolheu a pessoa
                  // certa.
                  <button
                    type="button"
                    onClick={() => setPainelResponsavelId(responsavel.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-600/60 hover:bg-emerald-500/20 dark:text-emerald-400 ${foco}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Ver Cadastro do Responsável
                  </button>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => setModalTipo(tipo)}
                    className={`inline-flex items-center gap-1 text-primary hover:underline ${foco}`}
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    Novo responsável
                  </button>
                )}
                {responsavel && !disabled && (
                  <button
                    type="button"
                    onClick={() => copiarEndereco(responsavel)}
                    className={`inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline ${foco}`}
                  >
                    <ClipboardCopy className="h-3 w-3" aria-hidden="true" />
                    Copiar endereço
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className={rotulo} htmlFor={`parentesco-${tipo}`}>
                Parentesco
              </label>
              <select
                id={`parentesco-${tipo}`}
                className={`mt-1 ${campo}`}
                value={vinculo?.parentesco ?? ""}
                onChange={(e) => definirParentesco(tipo, e.target.value)}
                disabled={disabled || !vinculo}
              >
                <option value="">
                  {vinculo ? "Não informado" : "Selecione um responsável"}
                </option>
                {PARENTESCOS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {/* Valor fora da lista: só acontece com linha anterior ao CHECK
                    de 20260828170000. Aparece como opção própria em vez de o
                    <select> cair no primeiro item e trocar o parentesco de uma
                    pessoa em silêncio ao salvar. */}
                {parentescoForaDaLista && (
                  <option value={parentescoForaDaLista}>
                    {parentescoForaDaLista} (fora da lista)
                  </option>
                )}
              </select>
            </div>
          </div>
        )
      })}

      {/* Montado condicionalmente para nascer limpo. */}
      {modalTipo && (
        <ResponsavelFormModal
          // Para a trilha do responsável aparecer no Histórico deste paciente,
          // que é de onde o cadastro foi feito.
          contextoPaciente={
            form.id_paciente ? { id: form.id_paciente, nome: form.nome } : undefined
          }
          onFechar={() => setModalTipo(null)}
          onCriado={(novo) => {
            vincularA(modalTipo, novo.id)
            setModalTipo(null)
          }}
        />
      )}

      {painelResponsavelId !== null && (
        <ResponsavelPainel
          responsavelId={painelResponsavelId}
          contextoPaciente={
            form.id_paciente ? { pacienteId: form.id_paciente, pacienteNome: form.nome } : undefined
          }
          onFechar={() => setPainelResponsavelId(null)}
        />
      )}

      {copiarAberto && (
        <CopiarResponsaveisModal
          idPacienteAtual={form.id_paciente}
          vinculosAtuais={form.vinculos}
          onFechar={() => setCopiarAberto(false)}
          onCopiar={(vinculos) => {
            // Nome de quem foi copiado não é conhecido aqui (só o id) — o
            // próprio modal já mostrou de quem eram os vínculos antes de
            // confirmar, então a mensagem genérica basta.
            aplicarVinculos(vinculos, "outro paciente")
            setCopiarAberto(false)
          }}
        />
      )}
    </Secao>
  )
}
