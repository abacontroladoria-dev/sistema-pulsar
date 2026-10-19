'use client'

import React, { useState } from 'react'
import { Megaphone, Copy, Check, ExternalLink } from 'lucide-react'
import type { AnuncioCatalogado, AnuncioDaConversa } from '@/modules/atendimento/types/central.types'
import { Bloco, BotaoAcao } from './Bloco'

// ----------------------------------------------------------------------------
// Anúncio da Meta que trouxe a pessoa (Click-to-WhatsApp).
//
// Somente leitura, como o Canal: o ID vem do clique no anúncio
// (conversations.anuncio, primeiro toque) e os nomes vêm da Marketing API
// (central.meta_ad_catalog). Sem catálogo — token ausente ou anúncio que a
// conta não enxerga — mostra o que o próprio clique trouxe: título e ID.
//
// `campanha` aparece aqui também: é o campo que o matcher de frases e o
// catálogo preenchem, e até então só era visto no funil.
//
// Some inteiro quando não há anúncio nem campanha: conversa orgânica não
// precisa de um bloco dizendo "nenhum anúncio".
// ----------------------------------------------------------------------------

type Catalogo = Pick<AnuncioCatalogado, 'ad_name' | 'ad_status' | 'adset_name' | 'campaign_name' | 'lookup_error'>

const ROTULO_STATUS: Record<string, string> = {
  ACTIVE:   'ativo',
  PAUSED:   'pausado',
  ARCHIVED: 'arquivado',
  DELETED:  'apagado',
  CAMPAIGN_PAUSED: 'campanha pausada',
  ADSET_PAUSED:    'conjunto pausado',
}

export const BlocoAnuncio: React.FC<{
  anuncio:  AnuncioDaConversa | null | undefined
  catalogo: Catalogo | null | undefined
  campanha: string | null
}> = ({ anuncio, catalogo, campanha }) => {
  const [copiado, setCopiado] = useState(false)
  if (!anuncio && !campanha) return null

  const nomeCampanha = catalogo?.campaign_name ?? null
  // `campanha` repetiria a campanha da Meta quando foi o catálogo que a gravou.
  const campanhaDoCampo = campanha && campanha !== nomeCampanha ? campanha : null
  const statusRotulo = catalogo?.ad_status ? (ROTULO_STATUS[catalogo.ad_status] ?? catalogo.ad_status.toLowerCase()) : null

  async function copiar() {
    if (!anuncio?.ad_id) return
    try {
      await navigator.clipboard.writeText(anuncio.ad_id)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sem permissão de área de transferência: o ID continua visível para copiar à mão.
    }
  }

  return (
    <Bloco
      titulo={anuncio ? (anuncio.pago ? 'Anúncio' : 'Publicação') : 'Campanha'}
      icone={<Megaphone className="w-3.5 h-3.5" />}
      acao={
        anuncio?.url ? (
          <a
            href={anuncio.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir o anúncio"
            aria-label="Abrir o anúncio"
            className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-cyan-400 hover:bg-muted transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {anuncio && (nomeCampanha || catalogo?.adset_name || catalogo?.ad_name) && (
          <dl className="space-y-1 text-sm">
            {nomeCampanha && <Linha rotulo="Campanha" valor={nomeCampanha} />}
            {catalogo?.adset_name && <Linha rotulo="Conjunto" valor={catalogo.adset_name} />}
            {catalogo?.ad_name && <Linha rotulo="Anúncio" valor={catalogo.ad_name} />}
          </dl>
        )}

        {campanhaDoCampo && (
          <p className="text-sm text-foreground break-words">{campanhaDoCampo}</p>
        )}

        {anuncio?.titulo && !catalogo?.ad_name && (
          <p className="text-sm text-foreground break-words">&ldquo;{anuncio.titulo}&rdquo;</p>
        )}

        {anuncio?.ad_id && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 pl-1">
            <span className="font-mono truncate">ID {anuncio.ad_id}</span>
            <BotaoAcao titulo={copiado ? 'Copiado' : 'Copiar o ID do anúncio'} onClick={copiar}>
              {copiado ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </BotaoAcao>
            {anuncio.plataforma && <span className="shrink-0 capitalize">· {anuncio.plataforma}</span>}
            {statusRotulo && <span className="shrink-0">· {statusRotulo}</span>}
          </div>
        )}

        {anuncio?.ad_id && (!catalogo || catalogo.lookup_error) && (
          <p className="text-[11px] text-muted-foreground/60 pl-1">
            {catalogo?.lookup_error ? 'A Meta não informou o nome da campanha' : 'Nome da campanha ainda não consultado'}
          </p>
        )}
      </div>
    </Bloco>
  )
}

const Linha: React.FC<{ rotulo: string; valor: string }> = ({ rotulo, valor }) => (
  <div className="flex gap-2 min-w-0">
    <dt className="text-muted-foreground shrink-0 w-[4.5rem]">{rotulo}</dt>
    <dd className="text-foreground min-w-0 break-words">{valor}</dd>
  </div>
)
