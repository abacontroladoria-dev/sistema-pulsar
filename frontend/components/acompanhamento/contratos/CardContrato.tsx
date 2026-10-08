"use client"

import { memo, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, CalendarClock } from "lucide-react"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"
import { ICONES, getTomAvatar, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { ROTULO_TIPO_CURTO, TIPOS_CONTRATO, cobreHoje, dataBR } from "@/lib/contratos/status"
import { proximoVencimento } from "@/lib/contratos/filtros"
import { SelosContrato } from "@/components/cadastros/pacientes/secoes/contratos/Selos"
import type { ItemStatusContratos } from "@/types/contratosPaciente"

// Cartão de paciente da Status Contratos. Moldura, hover e avatar do
// CardLaudo/CardPaciente (mesma foto, do mesmo bucket, pelo mesmo serviço).
//
// O cartão inteiro é um LINK para a aba Contratos da ficha
// (/cadastros/pacientes/{id}?aba=contratos): esta tela é só leitura, e o lugar
// de agir é lá. Ctrl+clique abre em outra aba, como se espera de um link.

export const CardContrato = memo(function CardContrato({ item }: { item: ItemStatusContratos }) {
  const tom = getTomAvatar(item.pacienteId)
  const porTipo = new Map(item.contratos.map((c) => [c.tipo, c]))
  const proximo = proximoVencimento(item.contratos)
  const terapias = porTipo.get("terapias")
  const semTerapias =
    item.naGrade &&
    !(terapias && terapias.status !== "recusado" && terapias.status !== "expirado" && cobreHoje(terapias.vigencia))

  return (
    <li>
      <Link
        href={`/cadastros/pacientes/${item.pacienteId}?aba=contratos`}
        className={`group flex h-full w-full flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-foreground/15 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${foco}`}
        aria-label={`Abrir contratos de ${item.nome}`}
      >
        <div className="flex items-start justify-between gap-2 text-[11px]">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">PAC {item.pacienteId}</span>
          <span className="flex flex-wrap justify-end gap-1">
            {!item.ativo && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Inativo</span>
            )}
            {item.naGrade && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                Na grade
              </span>
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-col items-center text-center">
          <Avatar fotoPath={item.fotoPath} nome={item.nome} pacienteId={item.pacienteId} tom={tom} />
          <h2 className="mt-3 w-full truncate text-base font-bold leading-snug text-foreground" title={item.nome}>
            {item.nome}
          </h2>
          <p className="mt-0.5 w-full truncate text-xs text-muted-foreground">{item.convenio ?? "Sem convênio"}</p>
        </div>

        <hr className="my-4 border-border" />

        <dl className="space-y-2">
          {TIPOS_CONTRATO.map((t) => {
            const c = porTipo.get(t)
            return (
              <div key={t} className="flex items-center justify-between gap-2">
                <dt className="truncate text-xs text-muted-foreground">{ROTULO_TIPO_CURTO[t]}</dt>
                <dd className="shrink-0">
                  {c ? (
                    <SelosContrato status={c.status} vigencia={c.vigencia} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>

        <div className="mt-auto space-y-2 pt-4">
          {semTerapias && (
            <p className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Na grade sem contrato de Terapias valendo.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {proximo ? (
                <span className="truncate">
                  {proximo.vigencia === "vencido" ? "Venceu" : "Vence"}{" "}
                  <span
                    className={`font-semibold tabular-nums ${
                      proximo.vigencia === "vencido"
                        ? "text-rose-600 dark:text-rose-400"
                        : proximo.vigencia === "a_vencer"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground"
                    }`}
                  >
                    {dataBR(proximo.dataVencimento)}
                  </span>
                </span>
              ) : (
                "Sem vencimento"
              )}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-foreground group-hover:underline">
              Abrir cadastro
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
    </li>
  )
})

function Avatar({
  fotoPath,
  nome,
  pacienteId,
  tom,
}: {
  fotoPath: string | null
  nome: string
  pacienteId: number
  tom: { bg: string; fg: string }
}) {
  // Guarda o PAR (path, url) — mesmo raciocínio do Avatar de CardLaudo: trocar
  // a foto nunca deixa a URL antiga aparecer sob o path novo.
  const [foto, setFoto] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    let ativo = true
    if (!fotoPath) return
    getFotoUrlAssinada(fotoPath).then((assinada) => {
      if (ativo && assinada) setFoto({ path: fotoPath, url: assinada })
    })
    return () => {
      ativo = false
    }
  }, [fotoPath])

  const url = foto && foto.path === fotoPath ? foto.url : null
  if (url) {
    return (
      <div className="flex h-20 w-20 overflow-hidden rounded-full border border-border bg-muted transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none">
        <img src={url} alt={`Foto de ${nome}`} className="h-full w-full object-cover" />
      </div>
    )
  }

  const Icone = ICONES[indiceIconeAvatar(pacienteId)]
  return (
    <span
      className="flex h-20 w-20 items-center justify-center rounded-full transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
      style={{ backgroundColor: tom.bg, color: tom.fg }}
      aria-hidden="true"
    >
      <Icone className="h-9 w-9" strokeWidth={1.75} />
    </span>
  )
}
