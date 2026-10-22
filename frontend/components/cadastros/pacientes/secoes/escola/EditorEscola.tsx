"use client"

import { useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { PARENTESCOS } from "@/types/responsavel"
import type { DadosEscolares, DadosEscolaresEquipe } from "@/services/pacienteDadosEscolares.service"
import { Campo, CampoSelect, campo, foco, rotulo } from "../../ui/campos"

// Editor interno dos dados escolares (equipe do Pulsar), no desenho do editor
// da Disponibilidade.
//
// Salvar NÃO sobrescreve: registra um envio novo, marcado como "Equipe", e o
// anterior (inclusive o da família) continua no histórico. Por isso o botão diz
// "Salvar" e o subtítulo da seção explica isso — quem edita precisa saber que a
// declaração da família não está sendo apagada.
//
// Os campos vêm preenchidos com o envio mais recente: o caso comum é trocar uma
// coisa (a turma do ano novo), não redigitar a escola inteira.
//
// "Informado por" é opcional, como na Disponibilidade: a mãe liga e a recepção
// registra. Sem ele a trilha diria só quem da equipe digitou.

const TURNOS = ["Manhã", "Tarde", "Integral"] as const

// Mesmos tetos da rota pública e da constraint da tabela.
const CURTO = 120
const LONGO = 300

export function EditorEscola({
  inicial,
  salvando,
  onCancelar,
  onSalvar,
}: {
  inicial: DadosEscolares | null
  salvando: boolean
  onCancelar: () => void
  onSalvar: (dados: DadosEscolaresEquipe) => void
}) {
  const [escolaNome, setEscolaNome] = useState(inicial?.escola_nome ?? "")
  const [endereco, setEndereco] = useState(inicial?.escola_endereco ?? "")
  const [telefone, setTelefone] = useState(inicial?.escola_telefone ?? "")
  const [email, setEmail] = useState(inicial?.escola_email ?? "")
  const [coordenador, setCoordenador] = useState(inicial?.coordenador_nome ?? "")
  const [turma, setTurma] = useState(inicial?.turma ?? "")
  const [turno, setTurno] = useState<string | null>(inicial?.turno ?? null)
  const [informadoNome, setInformadoNome] = useState("")
  const [informadoParentesco, setInformadoParentesco] = useState<string | null>(null)
  const [observacao, setObservacao] = useState("")
  const [tentouSalvar, setTentouSalvar] = useState(false)

  const semNome = escolaNome.trim().length === 0
  const texto = (v: string) => v.trim() || null

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    setTentouSalvar(true)
    if (semNome) return
    onSalvar({
      escola_nome: escolaNome.trim(),
      escola_endereco: texto(endereco),
      escola_telefone: texto(telefone),
      escola_email: texto(email),
      coordenador_nome: texto(coordenador),
      turma: texto(turma),
      turno,
      preenchido_por_nome: texto(informadoNome),
      preenchido_por_parentesco: informadoParentesco,
      observacao: texto(observacao),
    })
  }

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      <fieldset className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <legend className="sr-only">Escola</legend>
        <Campo
          label="Nome da escola *"
          value={escolaNome}
          onChange={setEscolaNome}
          disabled={false}
          maxLength={CURTO}
          largo
          aviso={tentouSalvar && semNome ? "Informe o nome da escola." : undefined}
        />
        <Campo label="Endereço" value={endereco} onChange={setEndereco} disabled={false} maxLength={LONGO} largo placeholder="Rua, número, bairro" />
        <Campo label="Telefone da escola" value={telefone} onChange={setTelefone} disabled={false} maxLength={CURTO} inputMode="tel" />
        <Campo label="E-mail da escola" value={email} onChange={setEmail} disabled={false} maxLength={CURTO} inputMode="email" type="email" />
        <Campo label="Coordenador(a)" value={coordenador} onChange={setCoordenador} disabled={false} maxLength={CURTO} />
        <Campo label="Turma" value={turma} onChange={setTurma} disabled={false} maxLength={CURTO} placeholder="Ex.: 2º ano B" />
        <CampoSelect<string>
          label="Turno"
          value={turno}
          onChange={setTurno}
          disabled={false}
          opcoes={TURNOS.map((t) => ({ valor: t, rotulo: t }))}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={rotulo}>Informado por (opcional)</legend>
        <p className="text-xs text-muted-foreground">
          Quem da família passou esta informação — por exemplo, a mãe que ligou. Fica registrado no histórico junto com o seu usuário.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Nome" value={informadoNome} onChange={setInformadoNome} disabled={false} maxLength={CURTO} />
          <CampoSelect<string>
            label="Parentesco"
            value={informadoParentesco}
            onChange={setInformadoParentesco}
            disabled={false}
            opcoes={PARENTESCOS.map((p) => ({ valor: p, rotulo: p }))}
          />
        </div>
        <div>
          <label htmlFor="escola-observacao" className={rotulo}>Observação</label>
          <textarea
            id="escola-observacao"
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: informação dada por telefone"
            className={`${campo} mt-1 resize-none`}
          />
        </div>
      </fieldset>

      {tentouSalvar && semNome && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Informe o nome da escola antes de salvar.</span>
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
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  )
}
