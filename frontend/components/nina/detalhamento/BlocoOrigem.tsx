'use client'

import React, { useState } from 'react'
import { Globe2, Pencil, Loader2, Check, X } from 'lucide-react'
import { Bloco, Vazio, BotaoAcao } from './Bloco'

// ----------------------------------------------------------------------------
// De onde veio.
//
// `contacts.source` é texto livre — não há UTM nem tabela de atribuição neste
// schema. Então o campo é um input, não um seletor: inventar uma lista fechada
// ("Indicação", "Instagram", "Google") obrigaria quem atende a escolher o item
// errado sempre que a resposta real não estivesse lá.
//
// O QUE ESTE COMPONENTE PROTEGE
//
// O detalhe da conversa recarrega a cada 5s. Se o input lesse direto do prop,
// um tique no meio da digitação apagaria o que a pessoa escreveu. Por isso o
// rascunho é estado local, semeado UMA vez no clique do lápis e descartado no
// salvar ou cancelar — o prop nunca volta a tocá-lo enquanto a edição está
// aberta.
// ----------------------------------------------------------------------------

export const BlocoOrigem: React.FC<{
  origem:   string | null
  // Ausente enquanto a fatia de escrita não existe: sem ele, o lápis não aparece.
  aoSalvar?: (valor: string | null) => Promise<void>
}> = ({ origem, aoSalvar }) => {
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)

  function abrir() {
    setRascunho(origem ?? '')   // semeado UMA vez, aqui
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setRascunho('')
  }

  async function salvar() {
    if (!aoSalvar || salvando) return
    const limpo = rascunho.trim()
    setSalvando(true)
    try {
      // String vazia vira null: "" e "nunca informado" são a mesma coisa para
      // quem lê, e gravar "" faria o campo parecer preenchido numa consulta.
      await aoSalvar(limpo === '' ? null : limpo)
      setEditando(false)
      setRascunho('')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Bloco
      titulo="Origem"
      icone={<Globe2 className="w-3.5 h-3.5" />}
      acao={
        aoSalvar && !editando ? (
          <BotaoAcao titulo="Editar a origem" onClick={abrir}>
            <Pencil className="w-3.5 h-3.5" />
          </BotaoAcao>
        ) : undefined
      }
    >
      {editando ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); salvar() }
              if (e.key === 'Escape') { e.preventDefault(); cancelar() }
            }}
            placeholder="Ex.: indicação, Instagram, fachada"
            maxLength={120}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
          />
          <BotaoAcao titulo="Salvar" onClick={salvar} disabled={salvando}>
            {salvando
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Check className="w-4 h-4 text-emerald-400" />}
          </BotaoAcao>
          <BotaoAcao titulo="Cancelar" onClick={cancelar} disabled={salvando}>
            <X className="w-3.5 h-3.5" />
          </BotaoAcao>
        </div>
      ) : origem ? (
        <p className="text-sm text-slate-200">{origem}</p>
      ) : (
        <Vazio>Não identificada{aoSalvar ? ' — informe se souber' : ''}</Vazio>
      )}
    </Bloco>
  )
}
