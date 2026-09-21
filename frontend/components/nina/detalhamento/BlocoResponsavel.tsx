'use client'

import React from 'react'
import { UserCircle, Loader2, Bot } from 'lucide-react'
import { Bloco } from './Bloco'

// ----------------------------------------------------------------------------
// Quem conduz este atendimento.
//
// POR QUE NÃO HÁ ESTADO LOCAL AQUI
//
// O responsável muda por caminhos que não passam por este bloco:
//   - responder a conversa ASSUME (assumirAoResponder), e
//   - religar a chave Maia SOLTA o responsável (setAiMode).
// Guardar a escolha em estado local faria o painel mostrar "Ana" depois de a
// Maia ter sido religada — o dado errado exatamente quando a conversa mudou de
// dono. O valor exibido vem sempre do detalhe recarregado do servidor.
//
// Por isso também o aviso quando a Maia está atendendo: sem ele, o campo vazio
// parece defeito, quando é a consequência correta de a IA estar no comando.
// ----------------------------------------------------------------------------

export interface UsuarioAtribuivel {
  id:   string
  nome: string
}

export const BlocoResponsavel: React.FC<{
  responsavelId: string | null
  usuarios:      UsuarioAtribuivel[]
  maiaAtendendo: boolean
  salvando?:     boolean
  // Ausente na fatia de leitura: sem ele o campo vira texto, não seletor.
  aoTrocar?:     (userId: string | null) => Promise<void>
}> = ({ responsavelId, usuarios, maiaAtendendo, salvando, aoTrocar }) => {
  const atual = usuarios.find(u => u.id === responsavelId) ?? null

  // Nome desconhecido acontece: alguém que perdeu o acesso à Central continua
  // sendo o responsável gravado na conversa. Mostrar o id cru não ajuda
  // ninguém, mas some-lo faria a conversa parecer sem dono.
  const rotuloAtual = atual?.nome ?? (responsavelId ? 'Usuário sem acesso à Central' : null)

  return (
    <Bloco titulo="Responsável" icone={<UserCircle className="w-3.5 h-3.5" />}>
      {aoTrocar ? (
        <div className="relative">
          <select
            value={responsavelId ?? ''}
            disabled={salvando}
            onChange={(e) => aoTrocar(e.target.value === '' ? null : e.target.value)}
            className="w-full appearance-none px-3 py-2.5 pr-9 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60 disabled:cursor-wait"
          >
            <option value="">Não atribuído</option>
            {/* Responsável fora da lista ainda precisa aparecer selecionado,
                senão o <select> cairia calado em "Não atribuído" e o primeiro
                clique em qualquer outro item pareceria uma troca inocente. */}
            {responsavelId && !atual && (
              <option value={responsavelId}>{rotuloAtual}</option>
            )}
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-xs">▾</span>}
          </span>
        </div>
      ) : (
        <p className={`text-sm ${rotuloAtual ? 'text-slate-200' : 'text-slate-500 italic'}`}>
          {rotuloAtual ?? 'Não atribuído'}
        </p>
      )}

      {maiaAtendendo && !responsavelId && (
        <p className="flex items-start gap-1.5 text-[11px] text-violet-300/80">
          <Bot className="w-3 h-3 mt-0.5 shrink-0" />
          A Maia está atendendo. Responder pelo chat assume a conversa.
        </p>
      )}
    </Bloco>
  )
}
