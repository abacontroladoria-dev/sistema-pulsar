'use client'

import React from 'react'
import { X, Copy, User, Calendar } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { EvolucaoPendenteAuditoria } from '@/types/auditoriaEvolucoes'
import type { GrupoEvolucaoDuplicada } from '@/services/auditoriaEvolucoes.service'
import { compararTextosParaDestaque } from '@/services/auditoriaEvolucoes.service'
import type { TrechoComparado } from '@/services/auditoriaEvolucoes.service'

interface Props {
  grupo: GrupoEvolucaoDuplicada | null
  item: EvolucaoPendenteAuditoria | null
  isOpen: boolean
  onClose: () => void
}

const dataHoraFormatada = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR')

function TextoComColunas({ trechos }: { trechos: TrechoComparado[] }) {
  return (
    <>
      {trechos.map((t, i) =>
        t.coincide ? (
          <mark
            key={i}
            className="rounded bg-rose-200 px-0.5 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100"
          >
            {t.texto}
          </mark>
        ) : (
          <React.Fragment key={i}>{t.texto}</React.Fragment>
        )
      )}
    </>
  )
}

/**
 * Comparador lado a lado: UMA coluna por paciente do grupo, nunca só um par
 * fixo — um grupo com 3+ pacientes precisa mostrar todos de uma vez, senão
 * quem abre não sabe que há mais gente além do par que apareceu. Cada
 * evolução aparece sozinha (sem o resto do histórico do paciente), porque
 * aqui o assunto é este texto batendo, não a evolução geral dele.
 *
 * O destaque compara cada coluna contra a evolução que foi clicada (a
 * referência): com N pacientes não há "o par", há um texto que se repetiu
 * e o resto que bateu com ele.
 */
export function ModalComparadorDuplicadas({ grupo, item, isOpen, onClose }: Props) {
  if (!isOpen || !grupo || !item) return null

  // Uma coluna por paciente distinto — se o mesmo paciente aparecer em mais de
  // uma sessão do grupo, só a primeira entra: o comparador é entre pacientes,
  // não entre sessões do mesmo paciente.
  const vistos = new Set<string>()
  const pacientesDoGrupo = grupo.itens.filter(i => {
    const chave = i.paciente_id ? String(i.paciente_id) : i.paciente_nome
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })

  // A referência clicada sempre abre a fileira; as demais seguem na ordem do grupo.
  const chaveItem = item.paciente_id ? String(item.paciente_id) : item.paciente_nome
  const outros = pacientesDoGrupo.filter(
    p => (p.paciente_id ? String(p.paciente_id) : p.paciente_nome) !== chaveItem
  )
  const pessoas = [item, ...outros]

  const colunas = pessoas.map(pessoa => {
    if (pessoa.grade_id === item.grade_id) {
      // A própria referência: nada para destacar contra si mesma, mostra o texto puro.
      return { pessoa, trechos: [{ texto: pessoa.texto_original || '', coincide: false }] }
    }
    const { b: trechos } = compararTextosParaDestaque(item.texto_original || '', pessoa.texto_original || '')
    return { pessoa, trechos }
  })

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onClose() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="h-[85vh] w-[90vw] max-w-6xl gap-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-6xl"
      >
        {/* ── Cabeçalho: profissional em comum + o % que motivou o alerta ── */}
        <header className="relative flex flex-col gap-3 border-b border-border px-5 py-4 md:px-6 lg:flex-row lg:items-center lg:gap-x-6">
          <div className="min-w-0 space-y-1 lg:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                Evolução duplicada entre pacientes
              </span>
            </div>
            <DialogTitle className="flex items-center gap-2 truncate text-base font-bold text-foreground">
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
              {grupo.profissional_nome}
            </DialogTitle>
          </div>

          <div
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
            title="Semelhança de texto entre as evoluções abaixo"
          >
            <Copy className="h-3.5 w-3.5" />
            {pessoas.length} pacientes · {Math.round(grupo.similaridadeMinima * 100)}% de semelhança
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar comparador"
            className="absolute top-3 right-3 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X size={18} />
          </button>
        </header>

        {/*
          Uma coluna por paciente do grupo — 2 colunas dividem a largura toda,
          3+ colunas ganham `min-w` fixo e o corpo rola de lado: melhor um
          scroll horizontal explícito do que espremer 4 pacientes até o texto
          virar ilegível.
        */}
        <div className="flex min-h-0 divide-x divide-border overflow-x-auto overflow-y-hidden">
          {colunas.map(({ pessoa, trechos }, i) => (
            <div
              key={pessoa.grade_id}
              className="flex min-h-0 min-w-72 flex-1 flex-col"
              style={{ flexBasis: `${100 / colunas.length}%` }}
            >
              <div className={`shrink-0 border-b border-border px-5 py-2.5 ${i === 0 ? 'bg-rose-50 dark:bg-rose-950/30' : 'bg-muted/40'}`}>
                <p className="flex items-center gap-1.5 truncate text-xs font-bold text-foreground">
                  {pessoa.paciente_nome}
                  {i === 0 && (
                    <span className="shrink-0 rounded-full bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                      Referência
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {dataHoraFormatada(pessoa.data_sessao)}
                  {pessoa.terapia_nome && <span>· {pessoa.terapia_nome}</span>}
                </p>
              </div>
              <div className="overflow-y-auto p-5 text-xs leading-relaxed text-foreground">
                {pessoa.texto_original ? (
                  <TextoComColunas trechos={trechos} />
                ) : (
                  <span className="font-semibold text-rose-700 dark:text-rose-300">Sem texto registrado</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
