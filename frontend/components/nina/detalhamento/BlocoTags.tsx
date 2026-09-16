'use client'

import React, { useState } from 'react'
import { Tag, Plus, Loader2, X } from 'lucide-react'
import type { TagDefinition } from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio, BotaoAcao } from './Bloco'

// ----------------------------------------------------------------------------
// Rótulos da pessoa.
//
// As tags vivem no CONTATO, não na conversa (as duas colunas existem no banco).
// Elas descrevem quem é ('convênio', 'particular', 'documentação'), e por isso
// acompanham a pessoa quando ela volta meses depois numa conversa nova.
//
// A cor vem de tag_definitions.color — hex do banco, não classe do Tailwind.
// Por isso é style inline: as classes do Tailwind são estáticas em build, e
// `bg-[${cor}]` não existiria no CSS final. A cor entra com transparência no
// fundo e cheia no texto, o que mantém contraste legível para qualquer matiz
// que alguém cadastre depois.
//
// Chave desconhecida (no contato mas fora do catálogo) é DESENHADA assim mesmo,
// em cinza. Escondê-la faria a pessoa perder um rótulo sem nunca saber que ele
// existia — e o banco aceita qualquer string nesta coluna.
// ----------------------------------------------------------------------------

function comAlfa(hex: string | null, alfa: string): string | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined
  return `${hex}${alfa}`
}

const Chip: React.FC<{
  rotulo:    string
  cor:       string | null
  aoRemover?: () => void
}> = ({ rotulo, cor, aoRemover }) => (
  <span
    className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full text-[11px] font-medium border"
    style={{
      backgroundColor: comAlfa(cor, '22'),
      borderColor:     comAlfa(cor, '55'),
      color:           cor ?? undefined,
    }}
  >
    <span className={cor ? '' : 'text-slate-300'}>{rotulo}</span>
    {aoRemover && (
      <button
        type="button"
        onClick={aoRemover}
        title={`Remover ${rotulo}`}
        aria-label={`Remover ${rotulo}`}
        className="opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    )}
  </span>
)

export const BlocoTags: React.FC<{
  tags:      string[] | null
  catalogo:  TagDefinition[]
  // Ausente enquanto a fatia de escrita não existe: sem ele o "+" não aparece
  // e os chips não ganham o X.
  aoSalvar?: (chaves: string[]) => Promise<void>
}> = ({ tags, catalogo, aoSalvar }) => {
  const [aberto, setAberto]     = useState(false)
  const [salvando, setSalvando] = useState(false)

  const atuais   = tags ?? []
  const porChave = new Map(catalogo.map(t => [t.key, t]))

  // Substituição total do array, sempre. Um add/remove incremental calculado
  // sobre o prop correria com o polling de 5s: dois cliques rápidos e o segundo
  // parte de uma lista velha, ressuscitando a tag que o primeiro tirou.
  async function gravar(proximas: string[]) {
    if (!aoSalvar || salvando) return
    setSalvando(true)
    try {
      await aoSalvar(proximas)
    } finally {
      setSalvando(false)
    }
  }

  // Agrupado por categoria, como o catálogo foi cadastrado (Triagem,
  // Atendimento, Financeiro, Urgência). 14 chips soltos numa lista só seriam
  // uma parede; agrupados, a pessoa procura pelo assunto.
  const porCategoria = new Map<string, TagDefinition[]>()
  for (const t of catalogo) {
    const cat = t.category ?? 'Outras'
    if (!porCategoria.has(cat)) porCategoria.set(cat, [])
    porCategoria.get(cat)!.push(t)
  }

  return (
    <Bloco
      titulo="Tags"
      icone={<Tag className="w-3.5 h-3.5" />}
      acao={
        aoSalvar ? (
          <BotaoAcao
            titulo={aberto ? 'Fechar' : 'Adicionar tag'}
            onClick={() => setAberto(v => !v)}
            disabled={salvando || catalogo.length === 0}
          >
            {salvando
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : aberto ? <X className="w-3.5 h-3.5" /> : <Plus className="w-4 h-4" />}
          </BotaoAcao>
        ) : undefined
      }
    >
      {atuais.length === 0 ? (
        <Vazio>Nenhuma tag</Vazio>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {atuais.map(chave => {
            const def = porChave.get(chave)
            return (
              <Chip
                key={chave}
                rotulo={def?.label ?? chave}
                cor={def?.color ?? null}
                aoRemover={aoSalvar ? () => gravar(atuais.filter(c => c !== chave)) : undefined}
              />
            )
          })}
        </div>
      )}

      {aberto && aoSalvar && (
        <div className="mt-1 p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
          {[...porCategoria.entries()].map(([categoria, itens]) => {
            const disponiveis = itens.filter(t => !atuais.includes(t.key))
            if (disponiveis.length === 0) return null
            return (
              <div key={categoria} className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {categoria}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {disponiveis.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      disabled={salvando}
                      onClick={() => gravar([...atuais, t.key])}
                      className="transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                      <Chip rotulo={t.label} cor={t.color} />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Bloco>
  )
}
