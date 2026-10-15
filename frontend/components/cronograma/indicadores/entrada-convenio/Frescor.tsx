"use client"

// Selo do topo do Painel de Entrada em uma linha: de quando são os dados. O
// detalhe técnico (rodada x Doc, horários de leitura) fica no tooltip; os avisos
// de "sem dado novo" e "leitura falhou" continuam visíveis, porque mudam a
// confiança em tudo o que vem abaixo.

import { AlertTriangle, FileWarning } from "lucide-react"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import { fmtDataHora, frescor, hojeBrasilia, type PainelEntradaResposta } from "@/lib/indicadores/entradaConvenio"

export function Frescor({ painel }: { painel: PainelEntradaResposta }) {
  const s = painel.snapshot
  const leitura = painel.ultima_leitura
  const falhou = leitura?.status === "erro" && (!s || leitura.lido_em > s.lido_em)
  if (!s) return null
  const f = frescor(s, hojeBrasilia())
  const tom = painel.desatualizado ? TONE_SOFT.amber : TONE_SOFT.green

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${tom.bg} ${tom.text}`}>
          <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
          {f.texto}
          {painel.desatualizado && painel.dias_uteis_atras != null && ` · ${painel.dias_uteis_atras} dias úteis sem atualização`}
        </span>
        <InfoTooltip ariaLabel="De onde vêm estes dados" largura={320}>
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">{f.detalhe}.</p>
            <p>
              A tarefa agendada calcula o painel a partir do ClickUp às 7h40 e 12h40 (seg a sex). O Pulsar lê às 7h55, 8h25
              e 9h25, e às 12h55, 13h25 e 13h55.
            </p>
            <p>O Pulsar só exibe: se um número parecer errado, a correção é no registro do ClickUp.</p>
          </div>
        </InfoTooltip>
      </div>
      {painel.desatualizado && (
        <InlineNotice tone="amber" icon={<AlertTriangle size={14} />}>
          Sem dado novo há mais de 1 dia útil: os números abaixo podem não refletir o ClickUp de hoje.
        </InlineNotice>
      )}
      {falhou && leitura && (
        <InlineNotice tone="red" icon={<FileWarning size={14} />}>
          A leitura de {fmtDataHora(leitura.lido_em)} falhou ({leitura.erro}). O painel mostra a rodada anterior.
        </InlineNotice>
      )}
    </div>
  )
}
