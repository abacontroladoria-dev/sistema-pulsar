"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import {
  DIAS,
  calcularTotais,
  formatarHoras,
  lerRascunho,
  opcoesEscola,
  opcoesFim,
  opcoesInicio,
  paraMinutos,
  rascunhoDe,
  type DiaChave,
  type Disponibilidade,
  type OpcaoHorario,
  type Rascunho,
} from "@/lib/disponibilidadePaciente"
import { PARENTESCOS } from "@/types/responsavel"
import { campo, foco, rotulo } from "../../ui/campos"

// Editor interno da disponibilidade (equipe do Pulsar).
//
// Salvar NÃO sobrescreve: cria uma versão nova, e a anterior continua no
// histórico. Por isso o rótulo do botão é "Salvar nova versão" — quem edita
// precisa saber que a declaração da família não está sendo apagada.
//
// "Informado por" é opcional e existe para o caso mais comum de edição interna:
// a mãe liga e a recepção registra. Sem esse campo a trilha diria só "Ana da
// recepção mudou", e se perderia QUEM da família pediu a mudança — que é
// justamente o que importa quando pai e mãe declaram coisas diferentes.
//
// Horários em `<select>` nativo: no celular abre o seletor do sistema, que é a
// forma mais rápida de tocar num horário. As listas são a grade de sessões
// (decisão do usuário), mais o valor atual quando ele veio de fora da grade.

export type ResultadoEditor = {
  disponibilidade: Disponibilidade
  preenchido_por_nome: string | null
  preenchido_por_parentesco: string | null
  observacao: string | null
}

export function EditorDisponibilidade({
  inicial,
  salvando,
  onCancelar,
  onSalvar,
}: {
  inicial: Disponibilidade
  salvando: boolean
  onCancelar: () => void
  onSalvar: (resultado: ResultadoEditor) => void
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(inicial))
  const [informadoNome, setInformadoNome] = useState("")
  const [informadoParentesco, setInformadoParentesco] = useState("")
  const [observacao, setObservacao] = useState("")
  const [tentouSalvar, setTentouSalvar] = useState(false)

  const { disponibilidade, erros } = useMemo(() => lerRascunho(rascunho), [rascunho])
  const totais = calcularTotais(disponibilidade)
  const erroDe = (c: DiaChave | "escola") => (tentouSalvar ? erros.find((e) => e.campo === c)?.mensagem : undefined)

  function mudarDia(chave: DiaChave, parcial: Partial<Rascunho["dias"][DiaChave]>) {
    setRascunho((r) => {
      const atual = { ...r.dias[chave], ...parcial }
      // Trocar o início para depois do fim invalida o fim: limpa em vez de
      // deixar um par impossível que só o banco recusaria.
      const ini = paraMinutos(atual.inicio)
      const fim = paraMinutos(atual.fim)
      if (ini !== null && fim !== null && fim <= ini) atual.fim = ""
      return { ...r, dias: { ...r.dias, [chave]: atual } }
    })
  }

  function mudarEscola(parcial: Partial<Pick<Rascunho, "escolaInicio" | "escolaFim">>) {
    setRascunho((r) => {
      const prox = { ...r, ...parcial }
      const ini = paraMinutos(prox.escolaInicio)
      const fim = paraMinutos(prox.escolaFim)
      if (ini !== null && fim !== null && fim <= ini) prox.escolaFim = ""
      return prox
    })
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault()
    setTentouSalvar(true)
    if (erros.length > 0) return
    onSalvar({
      disponibilidade,
      preenchido_por_nome: informadoNome.trim() || null,
      preenchido_por_parentesco: informadoNome.trim() && informadoParentesco ? informadoParentesco : null,
      observacao: observacao.trim() || null,
    })
  }

  return (
    <form onSubmit={salvar} className="space-y-6" noValidate>
      {/* ── Escola ── */}
      <fieldset className="space-y-3">
        <legend className={rotulo}>Escola</legend>
        <div className="inline-flex flex-wrap rounded-md border border-border p-0.5" role="group" aria-label="Frequenta escola?">
          {([
            [true, "Frequenta"],
            [false, "Não frequenta"],
            [null, "Não informado"],
          ] as const).map(([valor, texto]) => (
            <button
              key={String(valor)}
              type="button"
              aria-pressed={rascunho.frequenta_escola === valor}
              onClick={() => setRascunho((r) => ({ ...r, frequenta_escola: valor }))}
              className={`min-h-11 rounded px-3 py-1 text-sm font-medium sm:min-h-0 ${foco} ${
                rascunho.frequenta_escola === valor ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        {rascunho.frequenta_escola === true && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <SelecaoHorario
              id="escola-inicio"
              rotuloCampo="Entrada"
              valor={rascunho.escolaInicio}
              opcoes={opcoesEscola(rascunho.escolaInicio)}
              aoMudar={(v) => mudarEscola({ escolaInicio: v })}
            />
            <SelecaoHorario
              id="escola-fim"
              rotuloCampo="Saída"
              valor={rascunho.escolaFim}
              opcoes={opcoesEscola(rascunho.escolaFim, rascunho.escolaInicio || null)}
              aoMudar={(v) => mudarEscola({ escolaFim: v })}
            />
          </div>
        )}
        {erroDe("escola") && <MensagemErro texto={erroDe("escola")!} />}
      </fieldset>

      {/* ── Dias ── */}
      <fieldset className="space-y-2">
        <legend className={rotulo}>Disponibilidade na clínica</legend>
        <ul className="space-y-2">
          {DIAS.map((dia) => {
            const e = rascunho.dias[dia.chave]
            const erro = erroDe(dia.chave)
            return (
              <li
                key={dia.chave}
                className={`rounded-md border px-3 py-2.5 ${
                  erro ? "border-destructive/60" : e.ativo ? "border-emerald-200 dark:border-emerald-900" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex min-h-11 min-w-[9rem] cursor-pointer items-center gap-2 text-sm font-medium text-foreground sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={e.ativo}
                      onChange={(ev) => mudarDia(dia.chave, { ativo: ev.target.checked })}
                      className="h-4 w-4 accent-[#222847]"
                    />
                    {dia.longo}
                  </label>
                  {e.ativo ? (
                    <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-xs">
                      <SelecaoHorario
                        id={`${dia.chave}-inicio`}
                        rotuloCampo="Início"
                        valor={e.inicio}
                        opcoes={opcoesInicio(e.inicio)}
                        aoMudar={(v) => mudarDia(dia.chave, { inicio: v })}
                      />
                      <SelecaoHorario
                        id={`${dia.chave}-fim`}
                        rotuloCampo="Fim"
                        valor={e.fim}
                        opcoes={opcoesFim(e.inicio || null, e.fim)}
                        aoMudar={(v) => mudarDia(dia.chave, { fim: v })}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Não vem neste dia</span>
                  )}
                </div>
                {erro && <MensagemErro texto={erro} />}
              </li>
            )
          })}
        </ul>
        <p className="pt-1 text-sm text-foreground" aria-live="polite">
          <span className="font-semibold tabular-nums">{formatarHoras(totais.minutosSemana)}</span>
          <span className="text-muted-foreground"> por semana · </span>
          <span className="font-semibold tabular-nums">{totais.sessoes40}</span>
          <span className="text-muted-foreground"> sessões de 40 min</span>
        </p>
      </fieldset>

      {/* ── Quem informou ── */}
      <fieldset className="space-y-3">
        <legend className={rotulo}>Informado por (opcional)</legend>
        <p className="text-xs text-muted-foreground">
          Quem da família passou esta informação — por exemplo, a mãe que ligou. Fica registrado no histórico junto com o seu usuário.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="informado-nome" className="text-xs text-muted-foreground">Nome</label>
            <input
              id="informado-nome"
              type="text"
              maxLength={120}
              value={informadoNome}
              onChange={(e) => setInformadoNome(e.target.value)}
              className={`${campo} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="informado-parentesco" className="text-xs text-muted-foreground">Parentesco</label>
            <select
              id="informado-parentesco"
              value={informadoParentesco}
              onChange={(e) => setInformadoParentesco(e.target.value)}
              className={`${campo} mt-1`}
            >
              <option value="">Não informado</option>
              {PARENTESCOS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="observacao" className="text-xs text-muted-foreground">Observação</label>
          <textarea
            id="observacao"
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: informação dada por telefone"
            className={`${campo} mt-1 resize-none`}
          />
        </div>
      </fieldset>

      {tentouSalvar && erros.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Confira os horários marcados acima antes de salvar.</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancelar}
          disabled={salvando}
          className={`min-h-11 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60 sm:min-h-0 ${foco}`}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70 sm:min-h-0 ${foco}`}
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {salvando ? "Salvando…" : "Salvar nova versão"}
        </button>
      </div>
    </form>
  )
}

function SelecaoHorario({
  id,
  rotuloCampo,
  valor,
  opcoes,
  aoMudar,
}: {
  id: string
  rotuloCampo: string
  valor: string
  opcoes: OpcaoHorario[]
  aoMudar: (v: string) => void
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-xs text-muted-foreground">{rotuloCampo}</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} className={`${campo} mt-0.5 min-h-11 tabular-nums sm:min-h-0`}>
        <option value="">—</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.valor}{o.foraDaGrade ? " (fora da grade)" : ""}
          </option>
        ))}
      </select>
    </div>
  )
}

function MensagemErro({ texto }: { texto: string }) {
  return <p className="mt-1.5 text-xs font-medium text-destructive">{texto}</p>
}
