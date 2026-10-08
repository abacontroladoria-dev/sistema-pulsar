"use client"

import { memo, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink } from "lucide-react"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"
import { ICONES, getTomAvatar, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { ROTULO_TIPO_CURTO, TIPOS_CONTRATO, dataBR } from "@/lib/contratos/status"
import { dispensadoDeContrato, proximoVencimento, semContratoDeTerapias } from "@/lib/contratos/filtros"
import { SelosContrato } from "@/components/cadastros/pacientes/secoes/contratos/Selos"
import type { ItemStatusContratos } from "@/types/contratosPaciente"
import { idExibicao } from "@/types/paciente"

// Cartão de paciente da Status Contratos. Moldura, hover e avatar do
// CardLaudo/CardPaciente (mesma foto, do mesmo bucket, pelo mesmo serviço).
//
// O cartão inteiro é um LINK para a aba Contratos da ficha
// (/cadastros/pacientes/{id}?aba=contratos), aberto em NOVA GUIA (pedido do
// usuário, 08/10/2026): a Status Contratos fica aberta, com filtros e página,
// enquanto a recepção trata um paciente de cada vez. Esta tela é só leitura.
//
// No corpo, uma linha "Tipo:" por contrato que o paciente TEM — não os três
// tipos fixos com "—" (pedido do usuário, 08/10/2026).

export const CardContrato = memo(function CardContrato({ item }: { item: ItemStatusContratos }) {
  const tom = getTomAvatar(item.pacienteId)
  const porTipo = new Map(item.contratos.map((c) => [c.tipo, c]))
  const proximo = proximoVencimento(item.contratos)
  // Mesma regra do card "Sem contrato" (lib/contratos/filtros.ts): paciente só
  // com Triagem na grade não cobra — ainda é avaliação de entrada.
  const semTerapias = semContratoDeTerapias(item)
  // A tela só lista os tipos que o paciente TEM (ver comentário acima) — sem
  // isto, "Sem contrato de Terapias" ao lado de um selo "Assinado" de OUTRO
  // tipo (ex.: Avaliação) parece contradição. Só entra quando há mesmo outro
  // tipo pra confundir.
  const temOutroTipoAssinado = semTerapias && item.contratos.some((c) => c.tipo !== "terapias")
  // Só com Triagem (sem semTerapias por dispensa, não por ter contrato): o
  // positivo não pode dizer "em dia" de um contrato que não existe.
  const emAvaliacao = !semTerapias && dispensadoDeContrato(item)

  return (
    <li>
      <Link
        href={`/cadastros/pacientes/${item.pacienteId}?aba=contratos`}
        target="_blank"
        rel="noopener noreferrer"
        className={`group flex h-full w-full flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-foreground/15 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${foco}`}
        aria-label={`Abrir contratos de ${item.nome} (nova guia)`}
      >
        <div className="flex items-start justify-between gap-2 text-[11px]">
          {/* Mesmo número de /cadastros/pacientes (idExibicao): o ID do TiTa
              quando o paciente veio de lá (é o único que a recepção confere do
              lado de lá), nunca a PK interna do Pulsar. Pedido do usuário,
              09/10/2026 — continua dizendo só "ID", não "ID TiTa". */}
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            ID {idExibicao({ origem_cadastro: item.origemCadastro, id_paciente: item.pacienteId, tita_paciente_id: item.titaPacienteId })}
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            {item.ficticio ? (
              <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Fictício</span>
            ) : (
              !item.ativo && <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">Inativo</span>
            )}
            {item.naGrade && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                Com agendamento
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

        {item.contratos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold">Tipo:</span> nenhum contrato
          </p>
        ) : (
          <ul className="space-y-2.5">
            {TIPOS_CONTRATO.filter((t) => porTipo.has(t)).map((t) => {
              const c = porTipo.get(t)!
              return (
                <li key={t} className="space-y-1">
                  <p className="text-xs text-foreground">
                    <span className="text-muted-foreground">Tipo:</span>{" "}
                    <span className="font-semibold">{ROTULO_TIPO_CURTO[t]}</span>
                  </p>
                  <SelosContrato status={c.status} vigencia={c.vigencia} />
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-auto space-y-2 pt-4">
          {semTerapias ? (
            <p className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {temOutroTipoAssinado
                ? "Sem contrato de TERAPIAS valendo — o assinado acima é de outro tipo."
                : "Sem contrato de Terapias valendo."}
            </p>
          ) : (
            // Sem isto, o lugar do aviso ficava vazio quando está tudo certo —
            // pedido do usuário (09/10/2026): mostrar também o lado positivo.
            // "Em avaliação" quando a dispensa é por só ter Triagem (não tem
            // contrato nenhum ainda — "em dia" seria afirmar algo que não existe).
            <p className="flex items-start gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {emAvaliacao ? "Ainda em avaliação (Triagem) — contrato não cobrado ainda." : "Contrato de Terapias em dia."}
            </p>
          )}
          {/* `flex-wrap`: em cartão estreito (4-5 colunas), data + "Abrir
              cadastro" não cabem numa linha só. Sem isto, o espaço que sobrava
              para a data virava 0 (flex encolhe até o mínimo quando o
              conteúdo tem `overflow` não-visível) e a data sumia por trás de
              reticências — mas "dd/mm/aaaa" é largura fixa, não precisa de
              `truncate` nunca; o segundo span é quem cede a vez, quebrando
              para a linha de baixo. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border pt-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {proximo ? (
                <span>
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
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
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
