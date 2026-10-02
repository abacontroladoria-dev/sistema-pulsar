'use client'

import { ArrowRight, CalendarCheck2, ExternalLink, FileMinus2, FilePen, FilePlus2, FileX2, FolderInput, Lock, RotateCcw, Undo2 } from 'lucide-react'
import { TONE_CHIP } from '@/components/ui/tones'
import type { Tone } from '@/hooks/useToneColor'
import { ChipOrigem } from '@/components/cronograma/remuneracao/pep/origem'
import { dataHora, diasNaPasta, EVENTOS_EVIDENCIA, mesBR, nomeCurtoPrestador } from '@/lib/roboSharepoint/rotulos'
import type { EventoEvidencia, EventoEvidenciaTipo } from '@/types/roboSharepoint'

// Uma linha do histórico das evidências (sp_pep_evidencias_historico,
// 20261003100000), escrita para uma pessoa ler: o que era o arquivo, de quem,
// quando aconteceu e o que isso fez com a entrega. Pedido do usuário
// (02/10/2026): "um registro histórico muito bem pensado e claro à vista do
// ser humano, mostrando o que era e quando foi apagado".

const VISUAL: Record<EventoEvidenciaTipo, { icone: typeof FileX2; tom: Tone }> = {
  apareceu: { icone: FilePlus2, tom: 'green' },
  voltou: { icone: RotateCcw, tom: 'green' },
  sumiu: { icone: FileX2, tom: 'red' },
  deixou_de_ser_evidencia: { icone: FileMinus2, tom: 'red' },
  entrega_desfeita: { icone: Undo2, tom: 'red' },
  mes_liberado_mantido: { icone: Lock, tom: 'amber' },
  renomeou: { icone: FilePen, tom: 'gray' },
  moveu: { icone: FolderInput, tom: 'gray' },
  saiu_do_padrao: { icone: FilePen, tom: 'amber' },
}

/** Pasta do prestador ("Prestador de Serviço - Fulana (X LTDA)") ou nome já reconhecido. */
const prestador = (n: string | null) => (n && /^prestador/i.test(n) ? nomeCurtoPrestador(n) : n)

function Consequencia({ e }: { e: EventoEvidencia }) {
  const motivo = e.detalhe?.motivo === 'saiu_da_pasta_do_item' ? 'o arquivo saiu da pasta do item' : 'a evidência foi apagada do SharePoint'
  if (e.evento === 'entrega_desfeita') {
    if (e.detalhe?.registro_ja_nao_existia) return <>A entrega já tinha sido excluída na tela; o arquivo foi solto.</>
    if (e.detalhe?.registro_excluido) return <>A entrega deixou de existir: {motivo} e era a única evidência.</>
    if (e.unidades_antes != null && e.unidades_depois != null && e.unidades_antes !== e.unidades_depois) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          Unidades entregues: <strong className="tabular-nums">{e.unidades_antes}</strong>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          <strong className="tabular-nums">{e.unidades_depois}</strong>
          <span>— {motivo}. O valor do mês é recalculado.</span>
        </span>
      )
    }
    return <>A evidência saiu da entrega ({motivo}); outra evidência mantém a entrega.</>
  }
  if (e.evento === 'mes_liberado_mantido') {
    return <>O mês {mesBR(e.detalhe?.competencia_liberada ?? e.competencia)} já estava liberado: a entrega e o valor não mudaram. Se o mês for reaberto, a próxima leitura ajusta.</>
  }
  if (e.evento === 'saiu_do_padrao') {
    return <>Continua entregue (o arquivo está na pasta), mas o nome novo fere o padrão. Vale corrigir o nome no SharePoint.</>
  }
  if (e.evento === 'sumiu' || e.evento === 'deixou_de_ser_evidencia') {
    const dias = diasNaPasta(e.criado_em_sp, e.em)
    return (
      <>
        {e.criado_em_sp ? <>Estava na pasta desde {dataHora(e.criado_em_sp)}{dias != null ? ` (${dias === 0 ? 'menos de 1 dia' : `${dias} dia${dias === 1 ? '' : 's'}`})` : ''}. </> : null}
        {e.situacao === 'confirmado' ? 'Estava entregue.' : 'Ainda não era entrega.'}
      </>
    )
  }
  if (e.evento === 'renomeou' && e.nome_anterior) return <>Antes: <span className="font-medium">{e.nome_anterior}</span></>
  if (e.evento === 'moveu' && e.caminho_anterior) return <>Antes em: <span className="font-medium">{e.caminho_anterior}</span></>
  return null
}

export function CartaoEvento({ e, compacto = false }: { e: EventoEvidencia; compacto?: boolean }) {
  const v = VISUAL[e.evento]
  const Icone = v.icone
  const t = TONE_CHIP[v.tom]
  const saiu = e.evento === 'sumiu' || e.evento === 'deixou_de_ser_evidencia' || e.evento === 'entrega_desfeita' || e.evento === 'mes_liberado_mantido'
  const linkVivo = e.web_url && !(e.evento === 'sumiu' || (e.evento !== 'deixou_de_ser_evidencia' && e.detalhe?.motivo === 'arquivo_removido'))
  const contexto = [prestador(e.prestador_nome), e.paciente_nome, e.sigla, e.competencia ? mesBR(e.competencia) : null].filter(Boolean)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text}`}>
          <Icone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-sm font-bold ${t.text}`}>{EVENTOS_EVIDENCIA[e.evento].rotulo}</span>
            {e.entregue_por && <ChipOrigem origem={e.entregue_por} />}
            {e.entregue_por && e.entregue_em && <span className="text-[11px] text-muted-foreground">entregue em {dataHora(e.entregue_em)}</span>}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1">
            {linkVivo ? (
              <a href={e.web_url!} target="_blank" rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 rounded text-sm font-semibold text-foreground hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-sky-400">
                <span className="truncate">{e.nome ?? e.sp_id}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">(abre no SharePoint)</span>
              </a>
            ) : (
              <span className={`truncate text-sm font-semibold ${saiu ? 'text-muted-foreground line-through decoration-1' : 'text-foreground'}`}>{e.nome ?? e.sp_id}</span>
            )}
          </p>
          {contexto.length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{contexto.join(' · ')}</p>}
          {!compacto && (
            <p className="mt-1.5 text-xs leading-relaxed text-foreground/80"><Consequencia e={e} /></p>
          )}
          {compacto && (e.evento === 'entrega_desfeita' || e.evento === 'mes_liberado_mantido' || e.evento === 'saiu_do_padrao') && (
            <p className="mt-1.5 text-xs leading-relaxed text-foreground/80"><Consequencia e={e} /></p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground sm:w-36 sm:flex-col sm:items-end sm:border-0 sm:pt-0 sm:text-right">
        <CalendarCheck2 className="h-3.5 w-3.5 sm:hidden" aria-hidden />
        <span>
          <span className="block text-[11px]">percebido em</span>
          <span className="block font-semibold tabular-nums text-foreground">{dataHora(e.em)}</span>
        </span>
      </div>
    </div>
  )
}
