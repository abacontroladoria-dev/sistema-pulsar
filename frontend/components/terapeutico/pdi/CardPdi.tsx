"use client"

import { memo, useEffect, useState } from "react"
import {
  AlertTriangle,
  ClockAlert,
  Moon,
  MoonStar,
  Sun,
  SunMoon,
  TreePine,
  UserX,
} from "lucide-react"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"
import { ICONES, getTomAvatar, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { ESPECIALISTAS_PDI, type ItemPdi } from "@/lib/pdi/filtros"

// O cartão do Controle de Prazos do PDI. MOLDE do CardLaudo (avatar de 96px,
// hover -translate-y-1.5, <hr> + blocos de dado) — mas sem a grade dupla de
// duas caixas de identificação: aqui há só UM id relevante (o paciente), e a
// informação que precisa saltar aos olhos é o STATUS do ciclo, não um número.
//
// "Observações" NUNCA aparece aqui — pedido do plano: é texto livre da
// Amanda/Gracielle, só faz sentido dentro do modal de edição.
//
// Dias/turno clínico e ambiente natural são badges PEQUENOS e compactos —
// pedido do plano ("sem virar uma tabela dentro do card"): por isso viram
// ícone + texto curto numa linha que quebra, não um <dl> de rótulo/valor
// como o resto do cartão.

const STATUS_COR: Record<ItemPdi["status"], { texto: string; contorno: string }> = {
  "Dentro do prazo": {
    texto: "text-emerald-600 dark:text-emerald-400",
    contorno: "border-emerald-500/40 bg-emerald-500/5",
  },
  "Aguardando Implementação": {
    texto: "text-sky-600 dark:text-sky-400",
    contorno: "border-sky-500/40 bg-sky-500/5",
  },
  Atrasado: {
    texto: "text-rose-600 dark:text-rose-400",
    contorno: "border-rose-500/40 bg-rose-500/5",
  },
  "Próximo do prazo": {
    texto: "text-amber-600 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
}

const ESPECIALISTA_LABEL: Record<number, string> = {
  [ESPECIALISTAS_PDI.AMANDA]: "Amanda Ribeiro",
  [ESPECIALISTAS_PDI.GRACIELLE]: "Gracielle Rayane",
}

export const CardPdi = memo(function CardPdi({
  item,
  onAbrir,
}: {
  item: ItemPdi
  onAbrir: () => void
}) {
  const tom = getTomAvatar(item.pacienteId)
  const cor = STATUS_COR[item.status]
  const coordenadorIrregular = item.coordenadorIds.length !== 1

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        className={`group flex h-full w-full flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-foreground/15 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${
          item.ativoNaGrade ? "" : "opacity-70"
        } ${foco}`}
        aria-label={`Abrir Controle de Prazos do PDI de ${item.nome}`}
      >
        {/* ── Status do ciclo — pedido do usuário (05/09/2026): a caixa de
            id/"paciente" foi removida, esta fica sozinha e ocupa a largura
            inteira do cartão. ── */}
        <div className={`rounded-lg border px-2 py-1.5 text-center ${cor.contorno}`}>
          <p className={`truncate text-[11px] font-bold leading-tight ${cor.texto}`}>
            {item.status}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
            Prioridade {item.prioridade}
          </p>
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <Avatar item={item} tom={tom} />
          <h2
            className="mt-4 w-full truncate text-base font-bold leading-snug text-foreground"
            title={item.nome}
          >
            {item.nome}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.especialistaTitaId
              ? `Especialista: ${ESPECIALISTA_LABEL[item.especialistaTitaId] ?? "—"}`
              : "Sem especialista atribuído"}
          </p>
          {/* `ativoNaGrade === false` — sem agendamento futuro na grade
              sincronizada (ver ItemPdi.ativoNaGrade). NÃO é o `ativo` de
              cadastro logo abaixo (outro fato, outra fonte) — os dados do
              card continuam completos, é só um aviso visual (mesmo padrão do
              badge "Sem cadastro no Pulsar"). */}
          {!item.ativoNaGrade && (
            <span
              title="Sem agendamento futuro na grade sincronizada — o PDI pode ter sido encerrado"
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
            >
              <MoonStar className="h-3 w-3 shrink-0" aria-hidden="true" />
              Inativo
            </span>
          )}
        </div>

        {/* Avisos — cadastro duplicado, coordenador irregular e o alerta de
            prazo, quando existem. Ficam ACIMA da <hr>, junto da
            identificação, porque são o motivo de abrir o cartão: quem varre
            a tela procura exceção primeiro. */}
        {/* O aviso de "prazo vencido" foi REMOVIDO daqui (pedido do usuário,
            05/09/2026) — era 100% redundante com a caixa de Status logo
            acima ("Atrasado" já aparece lá). O único aviso que sobra é
            "Próximo do prazo", lido direto de `status` (não existe mais um
            campo `alerta` separado — ver o cabeçalho de lib/pdi/status.ts). */}
        {(item.cadastroDuplicadoTita ||
          coordenadorIrregular ||
          item.status === "Próximo do prazo") && (
          <div className="mt-3 space-y-1.5">
            {item.cadastroDuplicadoTita && (
              <p
                className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
                title="Mais de um cadastro no TiTa com este nome — confirmar qual é o registro correto antes de usar este card."
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Cadastro duplicado no TiTa
              </p>
            )}
            {coordenadorIrregular && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                <UserX className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {item.coordenadorIds.length === 0
                    ? "Sem Coordenador de Caso escalado para a 1ª semana do mês seguinte."
                    : "Mais de um Coordenador de Caso escalado para a 1ª semana do mês seguinte."}
                </span>
              </p>
            )}
            {item.status === "Próximo do prazo" && (
              <p className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <ClockAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Vence em {item.diasRestantes} {item.diasRestantes === 1 ? "dia" : "dias"}
              </p>
            )}
          </div>
        )}

        <hr className="my-4 border-border" />

        {/* Datas do ciclo. O selo "!" de "confirmar se dá pra automatizar"
            (pedido do plano original) foi removido a pedido do usuário
            (05/09/2026) — aparecia em TODO paciente sem exceção e confundia,
            lido como se fosse um alerta por paciente. */}
        <dl className="space-y-2 text-sm">
          <LinhaData rotulo="Data da Avaliação" valor={item.dataAvaliacao} />
          <LinhaData rotulo="Data de validade" valor={item.dataValidade} />
          <LinhaData rotulo="Prazo Fechamento" valor={item.prazoFechamento} />
        </dl>

        {/* Badges compactos de agenda — pedido do plano: nunca uma tabela. */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.diasClinicos.length > 0 && (
            <Badge texto={item.diasClinicos.map((d) => d.slice(0, 3)).join(", ")} title="Dias clínicos" />
          )}
          {item.turnoClinico && (
            <Badge
              icone={item.turnoClinico === "manhã" ? Sun : item.turnoClinico === "tarde" ? Moon : SunMoon}
              texto={item.turnoClinico}
              title="Turno clínico"
            />
          )}
          {item.temAgendamentoAmbienteNatural && (
            <Badge icone={TreePine} texto="Ambiente natural" title="Tem agendamento em ambiente natural" />
          )}
        </div>

        {/* `ativo === false` é INATIVO (fato do cadastro); `semCadastroPulsar`
            é uma condição diferente — não há cadastro em public.pacientes
            para dizer se está ativo ou não. Mesmo tratamento visual que
            Acompanhamento de Laudos dá a `situacaoPaciente === "sem_cadastro"`. */}
        {item.ativo === false && (
          <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Paciente inativo
          </p>
        )}
        {item.semCadastroPulsar && (
          <p className="mt-3 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <UserX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Sem cadastro no Pulsar — nome e foto vêm do relatório
          </p>
        )}
      </button>
    </li>
  )
})

function LinhaData({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-right text-sm font-semibold tabular-nums text-foreground">
        {valor ? isoParaBr(valor) : "—"}
      </dd>
    </div>
  )
}

function Badge({
  icone: Icone,
  texto,
  title,
}: {
  icone?: typeof Sun
  texto: string
  title: string
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground"
    >
      {Icone && <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {texto}
    </span>
  )
}

function isoParaBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  if (!ano || !mes || !dia) return "—"
  return `${dia}/${mes}/${ano}`
}

function Avatar({ item, tom }: { item: ItemPdi; tom: { bg: string; fg: string } }) {
  const [foto, setFoto] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    let ativo = true
    const path = item.fotoPath
    if (!path) return
    getFotoUrlAssinada(path).then((assinada) => {
      if (ativo && assinada) setFoto({ path, url: assinada })
    })
    return () => {
      ativo = false
    }
  }, [item.fotoPath])

  const url = foto && foto.path === item.fotoPath ? foto.url : null

  if (url) {
    return (
      <div className="flex h-24 w-24 overflow-hidden rounded-full border border-border bg-muted transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none">
        <img src={url} alt={`Foto de ${item.nome}`} className="h-full w-full object-cover" />
      </div>
    )
  }

  const Icone = ICONES[indiceIconeAvatar(item.pacienteId)]

  return (
    <span
      className="flex h-24 w-24 items-center justify-center rounded-full transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
      style={{ backgroundColor: tom.bg, color: tom.fg }}
      aria-hidden="true"
    >
      <Icone className="h-11 w-11" strokeWidth={1.75} />
    </span>
  )
}
