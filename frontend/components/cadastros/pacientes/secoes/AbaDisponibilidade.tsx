"use client"

import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import {
  AlertCircle,
  BadgeCheck,
  CalendarClock,
  Clock,
  Copy,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  ShieldQuestion,
  UserRoundCog,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  deColunas,
  diferencas,
  disponibilidadeVazia,
  paraColunas,
} from "@/lib/disponibilidadePaciente"
import {
  buscarDisponibilidade,
  ErroDisponibilidade,
  liberarEdicaoResponsavel,
  salvarDisponibilidadeEquipe,
  type DisponibilidadePaciente,
  type VersaoDisponibilidade,
} from "@/services/pacienteDisponibilidade.service"
import { foco } from "../ui/campos"
import { EditorDisponibilidade, type ResultadoEditor } from "./disponibilidade/EditorDisponibilidade"
import { HistoricoDisponibilidade, trocaDePessoaAtual } from "./disponibilidade/HistoricoDisponibilidade"
import { ResumoDisponibilidade } from "./disponibilidade/ResumoDisponibilidade"
import { COR_ORIGEM, ROTULO_ORIGEM, declarante, formatarData, formatarDataHora, tempoDecorrido } from "./disponibilidade/formato"

// Aba "Disponibilidade": quanto tempo a criança pode passar na clínica.
//
// Fica FORA do fluxo Editar/Salvar do cadastro (como Escola e Altas): tem o
// próprio botão de editar e grava na hora. O motivo é o modelo do dado — cada
// gravação é uma versão nova num histórico imutável, não um campo do
// formulário do paciente que se descarta com "Cancelar".
//
// Dois estados de tela, e eles precisam ser inconfundíveis:
//   - A PREENCHER: nenhuma versão. A tela empurra as duas saídas — preencher
//     agora (equipe) ou mandar o link para a família.
//   - PREENCHIDA: a versão atual em destaque, quem declarou, o prazo do
//     responsável e a linha do tempo abaixo.
//
// A falha de leitura tem estado próprio e nunca se parece com "a preencher":
// confundir os dois faria a recepção cobrar da família um formulário já enviado.

export const CAMINHO_FORMULARIO = "/disponibilidade-paciente/"

export function AbaDisponibilidade({
  pacienteId,
  pacienteNome,
  pacienteCpf,
}: {
  pacienteId: number
  pacienteNome: string
  pacienteCpf: string | null
}) {
  const [dados, setDados] = useState<DisponibilidadePaciente | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [confirmarLiberar, setConfirmarLiberar] = useState(false)
  const [liberando, setLiberando] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      setDados(await buscarDisponibilidade(pacienteId))
    } catch (e) {
      setErro(
        e instanceof ErroDisponibilidade
          ? e.message
          : "Não foi possível consultar a disponibilidade. Isto é uma falha de leitura, não quer dizer que o paciente não tenha registro."
      )
    } finally {
      setCarregando(false)
    }
  }, [pacienteId])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  const atual = dados?.versoes[0] ?? null

  async function salvar(resultado: ResultadoEditor) {
    if (atual && diferencas(deColunas(atual), resultado.disponibilidade).length === 0) {
      const confirmar = window.confirm(
        "Nada mudou nos horários. Registrar mesmo assim como conferido? (vira uma versão nova no histórico)"
      )
      if (!confirmar) return
    }

    setSalvando(true)
    try {
      const versao = await salvarDisponibilidadeEquipe(pacienteId, {
        ...paraColunas(resultado.disponibilidade),
        preenchido_por_nome: resultado.preenchido_por_nome,
        preenchido_por_parentesco: resultado.preenchido_por_parentesco,
        observacao: resultado.observacao,
      })
      toast.success(`Disponibilidade salva (versão ${versao.numero_versao}).`)
      setEditando(false)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a disponibilidade.")
    } finally {
      setSalvando(false)
    }
  }

  async function liberar() {
    setLiberando(true)
    try {
      const prazo = await liberarEdicaoResponsavel(pacienteId)
      setConfirmarLiberar(false)
      // Mostra o prazo devolvido pelo banco na hora; a releitura abaixo traz a
      // liberação para a linha do tempo. Se a releitura falhar, o prazo exibido
      // continua sendo o que o banco confirmou.
      setDados((d) => (d ? { ...d, prazoEdicaoAte: prazo } : d))
      toast.success(`Edição liberada até ${formatarDataHora(prazo)}.`)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível liberar a edição.")
    } finally {
      setLiberando(false)
    }
  }

  if (carregando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div className="space-y-3">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{erro ?? "Não foi possível consultar a disponibilidade."}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCarregando(true)
              void carregar()
            }}
            className={`mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted ${foco}`}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // ===== Editando (nova versão) =====
  if (editando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">
          {atual ? "Editar disponibilidade" : "Preencher disponibilidade"}
        </h2>
        <p className="mb-5 mt-0.5 text-sm text-muted-foreground">
          {atual
            ? `Salvar cria a versão ${atual.numero_versao + 1}. A versão ${atual.numero_versao} continua no histórico.`
            : "Horários em que a criança pode estar na clínica, na grade de sessões de 40 minutos."}
        </p>
        <EditorDisponibilidade
          inicial={atual ? deColunas(atual) : disponibilidadeVazia()}
          salvando={salvando}
          onCancelar={() => setEditando(false)}
          onSalvar={(r) => void salvar(r)}
        />
      </div>
    )
  }

  // ===== A preencher =====
  if (!atual) {
    return (
      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Disponibilidade ainda não informada</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Sem ela não dá para saber quantas das horas do laudo a família consegue cumprir. Preencha agora ou peça ao responsável.
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

        <PedirAoResponsavel pacienteNome={pacienteNome} pacienteCpf={pacienteCpf} prazoEdicaoAte={dados.prazoEdicaoAte} />

        {dados.liberacoes.length > 0 && (
          <HistoricoDisponibilidade versoes={[]} liberacoes={dados.liberacoes} />
        )}
      </div>
    )
  }

  // ===== Preenchida =====
  const troca = trocaDePessoaAtual(dados.versoes)

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Última atualização:</span>
        <span className="font-medium text-foreground">{formatarDataHora(atual.criado_em)}</span>
        <span className="text-muted-foreground">({tempoDecorrido(atual.criado_em)})</span>
      </div>

      {troca && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <UserRoundCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Alterada por outra pessoa.</span> Antes:{" "}
            <span className="font-medium">{declarante(troca.antes)}</span> em {formatarData(troca.antes.criado_em)}. Agora:{" "}
            <span className="font-medium">{declarante(troca.depois)}</span> em {formatarData(troca.depois.criado_em)}. Confirme com a família antes de montar os horários.{" "}
            <a href="#historico-disponibilidade" className={`font-semibold underline ${foco}`}>
              Ver histórico
            </a>
          </span>
        </div>
      )}

      <VersaoAtual versao={atual} onEditar={() => setEditando(true)} />

      <EdicaoResponsavel
        prazoEdicaoAte={dados.prazoEdicaoAte}
        onLiberar={() => setConfirmarLiberar(true)}
        pacienteNome={pacienteNome}
        pacienteCpf={pacienteCpf}
      />

      <HistoricoDisponibilidade versoes={dados.versoes} liberacoes={dados.liberacoes} />

      <Dialog open={confirmarLiberar} onOpenChange={(aberto) => !liberando && setConfirmarLiberar(aberto)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar edição por 48 horas?</DialogTitle>
            <DialogDescription>
              O responsável poderá corrigir a disponibilidade de {pacienteNome.split(" ")[0]} pelo link até{" "}
              {formatarDataHora(new Date(Date.now() + 48 * 3_600_000).toISOString())}. Depois disso o formulário trava de novo.
              A liberação fica registrada no histórico com o seu nome.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmarLiberar(false)}
              disabled={liberando}
              className={`min-h-11 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60 sm:min-h-0 ${foco}`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void liberar()}
              disabled={liberando}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70 sm:min-h-0 ${foco}`}
            >
              {liberando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
              {liberando ? "Liberando…" : "Liberar por 48h"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function VersaoAtual({ versao, onEditar }: { versao: VersaoDisponibilidade; onEditar: () => void }) {
  const quem = declarante(versao)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">Disponibilidade atual</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR_ORIGEM[versao.origem]}`}>
              {ROTULO_ORIGEM[versao.origem]}
            </span>
            {versao.origem === "formulario" && <SeloTelefone confere={versao.telefone_confere} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {quem ? (
              <>Preenchido por <span className="font-medium text-foreground">{quem}</span></>
            ) : (
              "Sem identificação de quem da família informou"
            )}
            {versao.origem === "equipe" && versao.registrado_por_nome && <> · registrado por {versao.registrado_por_nome}</>}
            {" "}em {formatarDataHora(versao.criado_em)} · versão {versao.numero_versao}
            {versao.preenchido_por_telefone && <> · {versao.preenchido_por_telefone}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={onEditar}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted sm:min-h-0 ${foco}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Editar disponibilidade
        </button>
      </div>
      <div className="mt-4">
        <ResumoDisponibilidade disponibilidade={deColunas(versao)} />
      </div>
    </div>
  )
}

/** Mesma leitura do selo da aba Escola: "confere" / "verificar", nunca "suspeito". */
function SeloTelefone({ confere }: { confere: boolean | null }) {
  if (confere === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        <BadgeCheck className="h-3 w-3" aria-hidden="true" />
        Telefone confere
      </span>
    )
  }
  if (confere === false) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        title="O telefone informado não bate com nenhum responsável cadastrado. Pode ser um número novo — vale confirmar."
      >
        <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
        Verificar telefone
      </span>
    )
  }
  return null
}

type EstadoPrazo = { tipo: "nunca" } | { tipo: "aberto"; ate: string } | { tipo: "travado"; desde: string }

function estadoDoPrazo(prazo: string | null): EstadoPrazo {
  if (!prazo) return { tipo: "nunca" }
  return new Date(prazo).getTime() > Date.now() ? { tipo: "aberto", ate: prazo } : { tipo: "travado", desde: prazo }
}

function EdicaoResponsavel({
  prazoEdicaoAte,
  onLiberar,
  pacienteNome,
  pacienteCpf,
}: {
  prazoEdicaoAte: string | null
  onLiberar: () => void
  pacienteNome: string
  pacienteCpf: string | null
}) {
  const estado = estadoDoPrazo(prazoEdicaoAte)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <h3 className="text-sm font-semibold text-foreground">Edição pelo responsável</h3>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          {estado.tipo === "travado" ? (
            <>
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-foreground">
                <span className="font-medium">Travada</span> desde {formatarDataHora(estado.desde)}
              </span>
            </>
          ) : estado.tipo === "aberto" ? (
            <>
              <LockOpen className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="text-foreground">
                <span className="font-medium">Aberta</span> até {formatarDataHora(estado.ate)}
              </span>
            </>
          ) : (
            <>
              <LockOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">O responsável ainda não enviou pelo link — o formulário está aberto.</span>
            </>
          )}
        </p>
        {estado.tipo === "travado" && (
          <button
            type="button"
            onClick={onLiberar}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0 ${foco}`}
          >
            <LockOpen className="h-4 w-4" aria-hidden="true" />
            Liberar edição por 48h
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        O responsável tem 5 dias, contados do primeiro envio, para corrigir pelo link. Depois disso só a equipe reabre.
      </p>
      <div className="mt-3 border-t border-border pt-3">
        <BotoesLink pacienteNome={pacienteNome} pacienteCpf={pacienteCpf} />
      </div>
    </div>
  )
}

function PedirAoResponsavel({
  pacienteNome,
  pacienteCpf,
  prazoEdicaoAte,
}: {
  pacienteNome: string
  pacienteCpf: string | null
  prazoEdicaoAte: string | null
}) {
  const estado = estadoDoPrazo(prazoEdicaoAte)

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <h3 className="text-sm font-semibold text-foreground">Pedir ao responsável</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Envie o link pelo WhatsApp. O responsável entra com o CPF da criança e preenche pelo celular.
      </p>
      {estado.tipo === "aberto" && (
        <p className="mt-2 text-xs text-muted-foreground">Edição liberada até {formatarDataHora(estado.ate)}.</p>
      )}
      <div className="mt-3">
        <BotoesLink pacienteNome={pacienteNome} pacienteCpf={pacienteCpf} />
      </div>
    </div>
  )
}

function BotoesLink({ pacienteNome, pacienteCpf }: { pacienteNome: string; pacienteCpf: string | null }) {
  const semCpf = !pacienteCpf || pacienteCpf.replace(/\D/g, "").length !== 11

  function link() {
    return `${window.location.origin}${CAMINHO_FORMULARIO}`
  }

  function mensagem() {
    const primeiro = pacienteNome.trim().split(/\s+/)[0] ?? ""
    return `Olá! Para organizarmos os horários de terapia de ${primeiro}, preencha a disponibilidade neste link: ${link()} — use o CPF da criança para entrar.`
  }

  async function copiar(texto: string, sucesso: string) {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(sucesso)
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente: " + texto)
    }
  }

  const botao = `inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted sm:min-h-0 ${foco}`

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copiar(link(), "Link copiado.")} className={botao}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copiar link
        </button>
        <button type="button" onClick={() => void copiar(mensagem(), "Mensagem copiada.")} className={botao}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copiar mensagem
        </button>
      </div>
      {semCpf && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Este paciente não tem CPF válido no cadastro, então o formulário não vai encontrá-lo. Complete o CPF na aba Cadastro antes de enviar o link.
        </p>
      )}
    </div>
  )
}
