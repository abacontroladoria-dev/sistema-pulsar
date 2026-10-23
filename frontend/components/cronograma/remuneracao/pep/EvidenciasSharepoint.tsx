"use client"

import { useMemo, useState } from "react"
import { Bot, Check, ExternalLink, FilePenLine, FileX2, Hourglass, Loader2, RotateCcw, Undo2, User, X } from "lucide-react"
import { campo, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, btnPerigo, btnPerigoCheio, btnPrimario, btnSecundario, selo } from "@/components/cronograma/grade/estilo"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { CabecalhoSecao, Cartao, Indicador } from "@/components/ui/padrao"
import { MOTIVOS_PADRAO, nomeEsperado, porQueEsperando } from "@/lib/roboSharepoint/rotulos"
import type { PepCatalogoItem } from "@/types/pep"
import type { SpItem } from "@/types/roboSharepoint"
import { ORIGEM, SeloUnidade } from "./origem"

// "O que o robô fez neste mês" — o robô SharePoint ENTREGA sozinho o arquivo
// que segue o padrão de nome (20261002100000); a pessoa só desfaz quando ele
// errar. Este cartão mostra, para o analista e o mês abertos:
//   • quanto o robô entregou e quanto uma pessoa entregou (unidades e R$);
//   • a lista do que o robô entregou, com o arquivo a um clique e "Desfazer";
//   • o que está esperando uma pessoa (fora do padrão, sem planejamento…),
//     com o motivo, o nome que o arquivo deveria ter e "Marcar como entrega";
//   • o que alguém já desfez, com quem e por quê;
//   • as entregas que saíram junto com a evidência apagada do SharePoint
//     (20261003100000: a entrega acompanha a pasta, do robô ou de pessoa);
//   • as entregas que valem mas cujo arquivo precisa ser renomeado ("Ajustar
//     nomenclatura", 14/10/2026): marcadas por pessoa com o nome fora do
//     padrão, ou renomeadas fora do padrão depois de entregues.
// Roxo = robô, azul = pessoa (./origem).

export type AvaliacaoSugestao = { pode: true } | { pode: false; motivo: string }

type Aba = "robo" | "esperando" | "ajustar" | "desfeitas" | "sairam"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

function dataBR(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

function BotaoArquivo({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`${btnSecundario} min-h-11 sm:min-h-0`}>
      <ExternalLink size={15} aria-hidden /> Abrir no SharePoint
    </a>
  )
}

export function EvidenciasSharepoint({ itens, catalogo, avaliar, onConfirmar, onIgnorar, onDesfazer, valores, unidadesPessoa, liberado }: {
  itens: SpItem[]
  catalogo: PepCatalogoItem[]
  avaliar: (item: SpItem) => AvaliacaoSugestao
  onConfirmar: (item: SpItem) => Promise<boolean>
  onIgnorar: (item: SpItem) => Promise<boolean>
  onDesfazer: (item: SpItem, motivo: string) => Promise<boolean>
  /** Σ valor_robo / valor_humano da apuração do analista no mês. */
  valores: { robo: number; humano: number } | null
  /** Unidades marcadas por pessoas no mês (registros − parte do robô). */
  unidadesPessoa: number
  liberado: boolean
}) {
  const itemPorId = useMemo(() => new Map(catalogo.map(c => [c.id, c])), [catalogo])
  const doRobo = useMemo(() => itens.filter(i => i.status === "confirmado" && i.entregue_por === "robo"), [itens])
  const esperando = useMemo(() => itens.filter(i => i.status === "sugerido"), [itens])
  const desfeitas = useMemo(() => itens.filter(i => i.status === "revertido"), [itens])
  // Entregues e depois apagados do SharePoint: a unidade saiu (o robô retirou).
  const sairam = useMemo(() => itens.filter(i => i.status === "removido" && !!i.entregue_por), [itens])
  // Entregue (robô ou pessoa), ainda na pasta, com o nome fora do padrão.
  const ajustar = useMemo(
    () => itens.filter(i => i.status === "confirmado" && !i.removido_em && (i.padrao === "fora" || i.padrao === "duplicado")),
    [itens]
  )
  const [escolhida, setEscolhida] = useState<Aba | null>(null)
  const aba: Aba = escolhida ?? (esperando.length > 0 ? "esperando" : "robo")
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [desfazendo, setDesfazendo] = useState<string | null>(null)
  const [motivo, setMotivo] = useState("")

  if (doRobo.length + esperando.length + ajustar.length + desfeitas.length + sairam.length === 0) return null

  const aprovadas = doRobo.length + desfeitas.length
  const acerto = aprovadas > 0 ? Math.round((doRobo.length / aprovadas) * 100) : null

  async function agir(i: SpItem, fn: () => Promise<boolean>) {
    setOcupado(i.sp_id)
    try { return await fn() } finally { setOcupado(null) }
  }

  const sigla = (i: SpItem) => (i.item_id ? itemPorId.get(i.item_id)?.sigla : null) ?? i.sigla ?? "—"
  const titulo = (i: SpItem) => `${sigla(i)} · ${i.paciente_nome ?? "Geral (sem paciente)"}`

  const ABAS: { id: Aba; rotulo: string; n: number; icone: typeof Bot }[] = [
    { id: "robo", rotulo: "Robô entregou", n: doRobo.length, icone: Bot },
    { id: "esperando", rotulo: "Esperando você", n: esperando.length, icone: Hourglass },
    ...(ajustar.length ? [{ id: "ajustar" as const, rotulo: "Ajustar nomenclatura", n: ajustar.length, icone: FilePenLine }] : []),
    { id: "desfeitas", rotulo: "Desfeitas", n: desfeitas.length, icone: Undo2 },
    ...(sairam.length ? [{ id: "sairam" as const, rotulo: "Saíram da pasta", n: sairam.length, icone: FileX2 }] : []),
  ]

  return (
    <Cartao className="space-y-4">
      <CabecalhoSecao
        id="titulo-robo-mes"
        Icone={Bot}
        titulo="O que o robô fez neste mês"
        apoio="Toda noite o robô lê o SharePoint e marca sozinho o que segue o padrão de nome. Você só desfaz quando ele errar."
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Indicador
          Icone={Bot}
          valor={String(doRobo.length)}
          rotulo="entregas do robô"
          apoio={valores ? `${brl(valores.robo)} na apuração` : undefined}
          tone="purple"
        />
        <Indicador
          Icone={User}
          valor={String(unidadesPessoa)}
          rotulo="entregas de pessoas"
          apoio={valores ? `${brl(valores.humano)} na apuração` : undefined}
          tone="blue"
        />
        <Indicador
          Icone={Undo2}
          valor={String(desfeitas.length)}
          rotulo="desfeitas por pessoas"
          apoio={acerto != null ? `robô acertou ${acerto}%` : undefined}
          tone="slate"
        />
        <Indicador
          Icone={Hourglass}
          valor={String(esperando.length)}
          rotulo="esperando você"
          apoio={esperando.length ? "veja o motivo de cada um" : "nada pendente"}
          tone="amber"
        />
      </div>

      <SegmentedTabs<Aba>
        value={aba}
        onChange={setEscolhida}
        ariaLabel="O que o robô fez"
        tabs={ABAS.map(a => ({
          value: a.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <a.icone size={14} aria-hidden /> {a.rotulo}
            </span>
          ),
          count: a.n,
        }))}
      />

      <ul className="divide-y divide-border rounded-lg border border-border" role="tabpanel">
        {aba === "robo" && doRobo.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">O robô ainda não entregou nada deste analista neste mês.</li>
        )}
        {aba === "robo" && doRobo.map(i => (
          <li key={i.sp_id} className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <SeloUnidade origem="robo" tamanho={20} />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{titulo(i)}</p>
                  <p className="break-all text-xs text-muted-foreground">{i.nome}</p>
                  <p className="text-xs text-muted-foreground">Entregue pelo robô em {dataBR(i.resolvido_em)}</p>
                  {i.removido_em && (
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Arquivo apagado do SharePoint em {dataBR(i.removido_em)} — o mês está liberado, então a entrega fica.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!i.removido_em && <BotaoArquivo url={i.web_url} />}
                {!liberado && (
                  <button
                    type="button"
                    onClick={() => { setDesfazendo(desfazendo === i.sp_id ? null : i.sp_id); setMotivo("") }}
                    className={`${btnPerigo} min-h-11 sm:min-h-0`}
                  >
                    <RotateCcw size={15} aria-hidden /> Desfazer
                  </button>
                )}
              </div>
            </div>
            {desfazendo === i.sp_id && (
              <div className={`${aviso("red")} flex-col gap-2`}>
                <label htmlFor={`motivo-${i.sp_id}`} className={rotulo}>
                  Por que o robô errou? (fica no histórico)
                </label>
                <textarea
                  id={`motivo-${i.sp_id}`}
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="ex.: não é o PIC deste paciente"
                  className={campo}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!motivo.trim() || ocupado === i.sp_id}
                    onClick={async () => { if (await agir(i, () => onDesfazer(i, motivo.trim()))) setDesfazendo(null) }}
                    className={`${btnPerigoCheio} min-h-11 sm:min-h-0`}
                  >
                    {ocupado === i.sp_id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                    Desfazer a entrega
                  </button>
                  <button
                    type="button"
                    onClick={() => setDesfazendo(null)}
                    className={`${btnSecundario} min-h-11 sm:min-h-0`}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}

        {aba === "esperando" && esperando.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nada esperando você.</li>
        )}
        {aba === "esperando" && esperando.map(i => {
          const av = avaliar(i)
          const esperado = i.padrao === "fora" || i.padrao === "duplicado" ? nomeEsperado(sigla(i), i.paciente_nome, i.competencia) : null
          return (
            <li key={i.sp_id} className="space-y-2 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <SeloUnidade origem={null} tamanho={20} />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">{titulo(i)}</p>
                    <p className="break-all text-xs text-muted-foreground">{i.nome}</p>
                    <span className={`mt-1.5 ${selo("amber")} whitespace-normal`}>
                      {porQueEsperando(i)}
                    </span>
                    {esperado && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nome esperado: <code className="rounded bg-muted px-1 py-0.5 font-semibold text-foreground">{esperado}</code>.
                        {" "}Pode marcar como entrega: ela vale e fica com o aviso “Ajustar nomenclatura” até o arquivo ser renomeado.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BotaoArquivo url={i.web_url} />
                  <button
                    type="button"
                    disabled={!av.pode || ocupado === i.sp_id}
                    onClick={() => agir(i, () => onConfirmar(i))}
                    title="A pessoa assume a entrega (fica azul)"
                    className={`${btnPrimario} min-h-11 sm:min-h-0`}
                  >
                    {ocupado === i.sp_id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
                    Marcar como entrega
                  </button>
                  <button
                    type="button"
                    disabled={ocupado === i.sp_id}
                    onClick={() => agir(i, () => onIgnorar(i))}
                    className={`${btnSecundario} min-h-11 sm:min-h-0`}
                  >
                    <X size={14} aria-hidden /> Ignorar
                  </button>
                </div>
              </div>
              {!av.pode && <p className="text-xs text-amber-800 dark:text-amber-300">{av.motivo}</p>}
            </li>
          )
        })}

        {aba === "ajustar" && ajustar.map(i => {
          const quem = i.entregue_por === "robo" ? "robo" : "humano"
          const esperado = nomeEsperado(sigla(i), i.paciente_nome, i.competencia, Number(i.nome_padrao?.seq ?? 1) || 1)
          return (
            <li key={i.sp_id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <SeloUnidade origem={quem} tamanho={20} />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{titulo(i)}</p>
                  <p className="break-all text-xs text-muted-foreground">{i.nome}</p>
                  <span className={`mt-1.5 ${selo("amber")} whitespace-normal`}>
                    <FilePenLine size={12} aria-hidden />
                    {i.padrao === "duplicado" ? MOTIVOS_PADRAO.repetido : MOTIVOS_PADRAO[i.padrao_motivo ?? ""] ?? "Nome fora do padrão"}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A entrega vale ({quem === "robo" ? "robô" : "pessoa"}{i.resolvido_em ? `, ${dataBR(i.resolvido_em)}` : ""}). Renomeie no SharePoint
                    {esperado ? <>: <code className="rounded bg-muted px-1 py-0.5 font-semibold text-foreground">{esperado}</code></> : null}
                  </p>
                </div>
              </div>
              <BotaoArquivo url={i.web_url} />
            </li>
          )
        })}

        {aba === "desfeitas" && desfeitas.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Ninguém desfez entrega do robô neste mês.</li>
        )}
        {aba === "desfeitas" && desfeitas.map(i => (
          <li key={i.sp_id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Undo2 size={12} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground line-through decoration-muted-foreground">{titulo(i)}</p>
                <p className="break-all text-xs text-muted-foreground">{i.nome}</p>
                <p className="break-words text-xs text-muted-foreground">
                  Desfeita por <strong className="text-foreground">{i.revertido_por_nome ?? "pessoa"}</strong> em {dataBR(i.revertido_em)}
                  {i.revertido_motivo ? <> — “{i.revertido_motivo}”</> : null}
                </p>
              </div>
            </div>
            <BotaoArquivo url={i.web_url} />
          </li>
        ))}

        {aba === "sairam" && sairam.map(i => {
          const quem = i.entregue_por === "robo" ? "robo" : "humano"
          return (
            <li key={i.sp_id} className="flex min-w-0 items-start gap-3 px-4 py-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                <FileX2 size={12} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground">{titulo(i)}</p>
                <p className="break-all text-xs text-muted-foreground line-through decoration-muted-foreground">{i.nome}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`inline-flex items-center gap-1 font-semibold ${ORIGEM[quem].texto}`}>
                    {quem === "robo" ? <Bot size={12} aria-hidden /> : <User size={12} aria-hidden />} Entregue por {quem === "robo" ? "robô" : "pessoa"}
                    {i.resolvido_em ? ` em ${dataBR(i.resolvido_em)}` : ""}
                  </span>
                  <span>·</span>
                  <span>
                    {i.robo_obs === "saiu_da_pasta_do_item" ? "saiu da pasta do item" : "apagado do SharePoint"}
                    {i.removido_em ? ` em ${dataBR(i.removido_em)}` : ""}: a unidade saiu da entrega e o valor foi recalculado.
                  </span>
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </Cartao>
  )
}
