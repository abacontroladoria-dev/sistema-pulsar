'use client'

import React from 'react'
import { CheckSquare, Loader2, Plus, Circle, CheckCircle2 } from 'lucide-react'
import type { Task } from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio, BotaoAdicionar } from './Bloco'

// ----------------------------------------------------------------------------
// O que ficou pendente com esta pessoa.
//
// Concluídas e canceladas não aparecem: o bloco responde "o que falta fazer",
// e histórico de tarefa feita empurraria a pendência para fora da vista no
// espaço curto do painel.
//
// O prazo vencido é a única coisa destacada aqui. Sem isso, a tarefa atrasada
// se parece com a tarefa de amanhã, que é justamente a confusão que faz alguém
// esquecer de ligar de volta.
// ----------------------------------------------------------------------------

function formatarPrazo(iso: string | null, agora: number): { texto: string; vencido: boolean } | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null

  const d = new Date(t)
  const data = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { texto: `${data} ${hora}`, vencido: t < agora }
}

export const BlocoTarefas: React.FC<{
  tarefas:    Task[]
  carregando: boolean
  // Ausentes enquanto a fatia de tarefas não existe: o botão aparece desativado,
  // porque um bloco sem nenhuma ação visível esconde que a funcionalidade vem.
  aoDesignar?: () => void
  aoConcluir?: (id: string) => Promise<void>
}> = ({ tarefas, carregando, aoDesignar, aoConcluir }) => {
  const agora = Date.now()

  return (
    <Bloco titulo="Tarefas" icone={<CheckSquare className="w-3.5 h-3.5" />}>
      {carregando ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando
        </p>
      ) : (
        <div className="space-y-2">
          <BotaoAdicionar onClick={() => aoDesignar?.()} disabled={!aoDesignar}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Designar tarefa
            </span>
          </BotaoAdicionar>

          {tarefas.length === 0 ? (
            <Vazio>Nenhuma tarefa</Vazio>
          ) : (
            <ul className="space-y-1.5">
              {tarefas.map(t => {
                const prazo = formatarPrazo(t.due_at, agora)
                return (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50"
                  >
                    <button
                      type="button"
                      disabled={!aoConcluir}
                      onClick={() => aoConcluir?.(t.id)}
                      title="Marcar como concluída"
                      aria-label={`Concluir: ${t.title}`}
                      className="mt-0.5 shrink-0 text-slate-500 hover:text-emerald-400 transition-colors disabled:hover:text-slate-500 group"
                    >
                      <Circle className="w-4 h-4 group-hover:hidden" />
                      <CheckCircle2 className="w-4 h-4 hidden group-hover:block" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200 break-words">{t.title}</p>
                      {prazo && (
                        <span
                          className={`text-[10px] font-medium tabular-nums ${
                            prazo.vencido ? 'text-rose-300' : 'text-slate-400'
                          }`}
                        >
                          {prazo.vencido ? 'Venceu ' : 'Até '}{prazo.texto}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Bloco>
  )
}
