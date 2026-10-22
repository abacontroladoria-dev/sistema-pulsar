"use client"

import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import {
  AlertCircle,
  BadgeCheck,
  Clock,
  GraduationCap,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldQuestion,
  User,
} from "lucide-react"
import {
  listarDadosEscolares,
  salvarDadosEscolaresEquipe,
  type DadosEscolares,
  type DadosEscolaresEquipe,
  type OrigemEscola,
} from "@/services/pacienteDadosEscolares.service"
import { linkFormularioEscolar, mensagemFormularioEscolar } from "@/lib/fichaEscolar"
import { foco } from "../ui/campos"
import { BotoesCopiarLink } from "../ui/BotoesCopiarLink"
import { EditorEscola } from "./escola/EditorEscola"

// Seção "Escola" do Cadastro do paciente (aba própria até 22/10/2026).
//
// Duas fontes, no desenho da Disponibilidade (decisão do usuário, 22/10/2026):
// a família pelo link público /ficha-escolar, e a equipe aqui mesmo, quando a
// família não preencheu ou passou a informação por telefone.
//
// A equipe NÃO corrige o envio da família: cada gravação é um envio novo, com
// selo de origem ("Formulário" / "Equipe") e o nome de quem registrou, e o
// anterior fica no histórico. É o que preserva a diferença entre "a família
// informou" e "alguém da equipe registrou".
//
// Fica fora do Editar/Salvar do cadastro: tem o próprio botão e grava na hora.
//
// O selo de conferência do telefone só existe no envio do formulário e precisa
// ser lido com cuidado: "confere" e "verificar", nunca "suspeito". O telefone
// cadastrado em `responsaveis` é texto livre e o cadastro tem buracos, então
// "não confere" significa "vale uma olhada", não "é fraude".

const ROTULO_ORIGEM: Record<OrigemEscola, string> = {
  formulario: "Formulário",
  equipe: "Equipe",
}

const COR_ORIGEM: Record<OrigemEscola, string> = {
  formulario: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  equipe: "bg-muted text-muted-foreground",
}

export function AbaEscola({
  pacienteId,
  pacienteNome,
  dataNascimento,
}: {
  pacienteId: number
  pacienteNome: string
  /** O formulário público confere a data de nascimento; sem ela a família não passa. */
  dataNascimento: string | null
}) {
  const [envios, setEnvios] = useState<DadosEscolares[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setEnvios(await listarDadosEscolares(pacienteId))
    } catch {
      // Deliberadamente explícito sobre ser FALHA DE LEITURA. Se esta mensagem
      // parecesse "não há registros", a equipe concluiria que a família não
      // preencheu — e cobraria de novo um formulário já enviado.
      setErro(
        "Não foi possível consultar as informações escolares. Isto é uma falha de leitura, não quer dizer que o paciente não tenha registro."
      )
    } finally {
      setCarregando(false)
    }
  }, [pacienteId])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar(dados: DadosEscolaresEquipe) {
    setSalvando(true)
    try {
      await salvarDadosEscolaresEquipe(pacienteId, dados)
      toast.success("Escola salva.")
      setEditando(false)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a escola.")
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div className="space-y-3">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{erro}</span>
          </div>
          <button
            type="button"
            onClick={() => void carregar()}
            className={`mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted ${foco}`}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  const [atual, ...anteriores] = envios

  // ===== Preenchendo / editando (envio novo da equipe) =====
  if (editando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">
          {atual ? "Editar escola" : "Preencher escola"}
        </h2>
        <p className="mb-5 mt-0.5 text-sm text-muted-foreground">
          {atual
            ? "Salvar registra um envio novo, em seu nome. O envio atual continua no histórico."
            : "Escola em que a criança estuda. Fica registrado em seu nome."}
        </p>
        <EditorEscola
          inicial={atual ?? null}
          salvando={salvando}
          onCancelar={() => setEditando(false)}
          onSalvar={(d) => void salvar(d)}
        />
      </div>
    )
  }

  const pedir = (
    <PedirAoResponsavel pacienteNome={pacienteNome} dataNascimento={dataNascimento} jaPreenchida={!!atual} />
  )

  // ===== A preencher =====
  // Vazio é um FATO sobre este paciente ("ninguém informou ainda"), não uma
  // falha de leitura. Os dois estados chegam aqui por caminhos separados e
  // precisam continuar assim.
  if (!atual) {
    return (
      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Escola ainda não informada</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Preencha agora ou peça ao responsável pelo link.
          </p>
          <button
            type="button"
            onClick={() => setEditando(true)}
            className={`mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0 ${foco}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Preencher agora
          </button>
        </div>
        {pedir}
      </div>
    )
  }

  // ===== Preenchida =====
  return (
    <div className="min-w-0 flex-1 space-y-4">
      {/* Quando os dados foram atualizados é a primeira pergunta de quem abre
          esta seção: informação escolar de dois anos atrás não descreve mais a
          criança. Fica acima do conteúdo, não escondida num rodapé. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Última atualização:</span>
        <span className="font-medium text-foreground">{formatarDataHora(atual.criado_em)}</span>
        <span className="text-muted-foreground">({tempoDecorrido(atual.criado_em)})</span>
      </div>

      <EnvioAtual envio={atual} onEditar={() => setEditando(true)} />

      {pedir}

      {anteriores.length > 0 && (
        <details className="rounded-lg border border-border bg-card">
          <summary
            className={`cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground hover:bg-muted ${foco}`}
          >
            Envios anteriores ({anteriores.length})
            <span className="ml-2 font-normal text-muted-foreground">
              — a escola pode ter mudado
            </span>
          </summary>
          <div className="space-y-3 border-t border-border px-4 py-4">
            {anteriores.map((envio) => (
              <EnvioAnterior key={envio.id} envio={envio} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function PedirAoResponsavel({
  pacienteNome,
  dataNascimento,
  jaPreenchida,
}: {
  pacienteNome: string
  dataNascimento: string | null
  jaPreenchida: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <h3 className="text-sm font-semibold text-foreground">
        {jaPreenchida ? "Pedir atualização ao responsável" : "Pedir ao responsável"}
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Envie o link pelo WhatsApp. O responsável busca a criança pelo nome, confirma a data de nascimento e preenche pelo celular.
      </p>
      <div className="mt-3 space-y-2">
        <BotoesCopiarLink link={linkFormularioEscolar()} mensagem={mensagemFormularioEscolar(pacienteNome)} />
        {!dataNascimento && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Este paciente não tem data de nascimento no cadastro, e o formulário pede essa data para liberar o envio. Complete em Dados pessoais antes de mandar o link.
          </p>
        )}
      </div>
    </div>
  )
}

function SeloOrigem({ origem }: { origem: OrigemEscola }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR_ORIGEM[origem]}`}>
      {ROTULO_ORIGEM[origem]}
    </span>
  )
}

/** "Josiane (Mãe)" — ou null quando o envio não diz quem da família informou. */
function declarante(envio: DadosEscolares): string | null {
  if (!envio.preenchido_por_nome) return null
  return envio.preenchido_por_parentesco
    ? `${envio.preenchido_por_nome} (${envio.preenchido_por_parentesco})`
    : envio.preenchido_por_nome
}

function EnvioAtual({ envio, onEditar }: { envio: DadosEscolares; onEditar: () => void }) {
  const quem = declarante(envio)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{envio.escola_nome}</h3>
            <SeloOrigem origem={envio.origem} />
            {envio.origem === "formulario" && <SeloConferencia confere={envio.telefone_confere} />}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Informado em {formatarData(envio.criado_em)}
          </p>
        </div>
        <button
          type="button"
          onClick={onEditar}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted sm:min-h-0 ${foco}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar escola
        </button>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Item icone={<MapPin className="h-3.5 w-3.5" />} rotulo="Endereço" valor={envio.escola_endereco} />
        <Item icone={<Phone className="h-3.5 w-3.5" />} rotulo="Telefone" valor={envio.escola_telefone} />
        <Item icone={<Mail className="h-3.5 w-3.5" />} rotulo="E-mail" valor={envio.escola_email} />
        <Item icone={<User className="h-3.5 w-3.5" />} rotulo="Coordenador(a)" valor={envio.coordenador_nome} />
        <Item rotulo="Turma" valor={envio.turma} />
        <Item rotulo="Turno" valor={envio.turno} />
      </dl>

      <div className="mt-5 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          {quem ? (
            <>Preenchido por <span className="font-medium text-foreground">{quem}</span></>
          ) : (
            "Sem identificação de quem da família informou"
          )}
          {envio.preenchido_por_telefone && ` — ${envio.preenchido_por_telefone}`}
          {envio.origem === "equipe" && envio.registrado_por_nome && <> · registrado por {envio.registrado_por_nome}</>}
        </p>
        {envio.observacao && <p>Observação: {envio.observacao}</p>}
      </div>
    </div>
  )
}

function EnvioAnterior({ envio }: { envio: DadosEscolares }) {
  const detalhes = [envio.turma, envio.turno].filter(Boolean).join(" · ")
  const quem =
    envio.origem === "equipe" ? (envio.registrado_por_nome ?? "Equipe") : (envio.preenchido_por_nome ?? "")

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium text-foreground">{envio.escola_nome}</span>
        {detalhes && <span className="ml-2 text-muted-foreground">{detalhes}</span>}
      </div>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <SeloOrigem origem={envio.origem} />
        {formatarData(envio.criado_em)} · {quem}
      </span>
    </div>
  )
}

/**
 * Indício de que o envio veio mesmo da família — telefone informado batendo com
 * o de algum responsável cadastrado.
 *
 * Os três estados são distintos de propósito. `null` (não deu para comparar) NÃO
 * é o mesmo que `false`, e mostrá-los igual acusaria injustamente as famílias de
 * pacientes cujo cadastro não tem telefone.
 */
function SeloConferencia({ confere }: { confere: boolean | null }) {
  if (confere === true) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Telefone confere
      </span>
    )
  }

  if (confere === false) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
        title="O telefone informado não bate com nenhum responsável cadastrado. Pode ser um número novo — vale confirmar."
      >
        <ShieldQuestion className="h-3.5 w-3.5" aria-hidden="true" />
        Verificar telefone
      </span>
    )
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
      title="Não havia telefone cadastrado para comparar."
    >
      Sem comparação
    </span>
  )
}

function Item({
  icone,
  rotulo,
  valor,
}: {
  icone?: React.ReactNode
  rotulo: string
  valor: string | null
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icone}
        {rotulo}
      </dt>
      <dd
        className={`mt-1 text-sm ${valor ? "text-foreground" : "text-muted-foreground"}`}
        // `break-words` porque endereço é texto livre digitado no celular e vem
        // sem quebras próprias.
        style={{ overflowWrap: "anywhere" }}
      >
        {valor || "Não informado"}
      </dd>
    </div>
  )
}

function formatarData(iso: string): string {
  const data = new Date(iso)

  if (Number.isNaN(data.getTime())) return "—"

  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatarDataHora(iso: string): string {
  const data = new Date(iso)

  if (Number.isNaN(data.getTime())) return "—"

  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * "há 3 meses", "hoje" — o que responde de fato se o dado ainda vale.
 *
 * Uma data absoluta obriga quem lê a fazer a conta de cabeça; a idade do
 * registro é a informação que decide se vale confiar no que está na tela.
 */
function tempoDecorrido(iso: string): string {
  const data = new Date(iso)

  if (Number.isNaN(data.getTime())) return "—"

  const dias = Math.floor((Date.now() - data.getTime()) / 86_400_000)

  if (dias < 0) return "data futura"
  if (dias === 0) return "hoje"
  if (dias === 1) return "ontem"
  if (dias < 30) return `há ${dias} dias`

  const meses = Math.floor(dias / 30)

  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`

  const anos = Math.floor(dias / 365)

  return anos === 1 ? "há 1 ano" : `há ${anos} anos`
}
