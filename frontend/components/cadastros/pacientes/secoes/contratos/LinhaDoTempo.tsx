import {
  Ban,
  CircleCheck,
  FilePlus2,
  FileUp,
  Hourglass,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  ShieldAlert,
  Signature,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { dataBR, ROTULO_STATUS, ROTULO_TIPO, type TipoContrato } from "@/lib/contratos/status"
import type { EventoContrato, TipoEventoContrato } from "@/types/contratosPaciente"

// Linha do tempo de um contrato: um evento por linha, do mais novo para o mais
// antigo. Vem de pacientes_contratos_eventos, que é imutável — o que está aqui
// aconteceu, e ninguém apaga.

const EVENTO: Record<TipoEventoContrato, { rotulo: string; Icone: LucideIcon; cor: string }> = {
  criado: { rotulo: "Contrato criado", Icone: FilePlus2, cor: "text-slate-500" },
  editado: { rotulo: "Rascunho editado", Icone: Pencil, cor: "text-slate-500" },
  arquivo_anexado: { rotulo: "PDF anexado", Icone: FileUp, cor: "text-sky-600 dark:text-sky-400" },
  enviado_d4sign: { rotulo: "Enviado para a D4Sign", Icone: Send, cor: "text-sky-600 dark:text-sky-400" },
  link_enviado_whatsapp: { rotulo: "Link enviado pelo WhatsApp", Icone: MessageCircle, cor: "text-amber-600 dark:text-amber-400" },
  link_reenviado: { rotulo: "Link reenviado", Icone: RefreshCw, cor: "text-amber-600 dark:text-amber-400" },
  assinado: { rotulo: "Assinado na D4Sign", Icone: Signature, cor: "text-emerald-600 dark:text-emerald-400" },
  assinado_manual: { rotulo: "Marcado como assinado", Icone: CircleCheck, cor: "text-emerald-600 dark:text-emerald-400" },
  recusado: { rotulo: "Assinatura recusada", Icone: XCircle, cor: "text-rose-600 dark:text-rose-400" },
  cancelado: { rotulo: "Contrato cancelado", Icone: Ban, cor: "text-rose-600 dark:text-rose-400" },
  expirado: { rotulo: "Link expirou sem assinatura", Icone: Hourglass, cor: "text-violet-600 dark:text-violet-400" },
  status_corrigido: { rotulo: "Status corrigido", Icone: ShieldAlert, cor: "text-slate-500" },
}

const ORIGEM: Record<EventoContrato["origem"], string> = {
  usuario: "",
  d4sign: "D4Sign",
  sistema: "Sistema",
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null
}

/** Uma linha legível do `detalhe` jsonb — só o que a equipe precisa ler. */
function resumoDoDetalhe(e: EventoContrato): string | null {
  const d = e.detalhe ?? {}
  switch (e.tipo) {
    case "criado": {
      const tipo = texto(d.tipo)
      const ini = texto(d.data_inicio)
      const venc = texto(d.data_vencimento)
      return [tipo && ROTULO_TIPO[tipo as TipoContrato], ini && venc && `${dataBR(ini)} → ${dataBR(venc)}`]
        .filter(Boolean)
        .join(" · ")
    }
    case "editado": {
      const depois = (d.depois ?? {}) as Record<string, unknown>
      const ini = texto(depois.data_inicio)
      const venc = texto(depois.data_vencimento)
      return ini && venc ? `Agora: ${dataBR(ini)} → ${dataBR(venc)}` : null
    }
    case "assinado_manual":
      return texto(d.assinado_em) ? `Assinado em ${dataBR(texto(d.assinado_em))}` : null
    case "cancelado":
      return texto(d.motivo) ? `Motivo: ${texto(d.motivo)}` : null
    case "arquivo_anexado":
      return d.qual === "assinado" ? "PDF assinado" : d.substituiu ? "Substituiu o PDF anterior" : null
    default:
      return null
  }
}

export function LinhaDoTempo({ eventos }: { eventos: EventoContrato[] }) {
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
  }

  return (
    <ol className="space-y-3">
      {eventos.map((e) => {
        const info = EVENTO[e.tipo] ?? EVENTO.status_corrigido
        const resumo = resumoDoDetalhe(e)
        const quem = e.usuario_nome ?? ORIGEM[e.origem]
        const mudouStatus = e.status_antes && e.status_depois && e.status_antes !== e.status_depois
        return (
          <li key={e.id} className="flex gap-3">
            <span className={`mt-0.5 shrink-0 ${info.cor}`} aria-hidden="true">
              <info.Icone className="h-4 w-4" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-foreground">{info.rotulo}</p>
              {resumo && <p className="break-words text-xs text-foreground/80">{resumo}</p>}
              {mudouStatus && (
                <p className="text-xs text-muted-foreground">
                  {ROTULO_STATUS[e.status_antes!]} → {ROTULO_STATUS[e.status_depois!]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {e.criado_em_brasilia ?? ""}
                {quem && ` · ${quem}`}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
