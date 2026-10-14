'use client'

import type { RoboEtapa } from '@/types/roboSharepoint'
import { numero } from '@/lib/roboSharepoint/rotulos'
import { EXTRACAO_STATUS } from '@/lib/pepDocumentos/rotulos'

// Etapa "Ler documentos" (robô 0.5.0): quantos textos o robô tirou das
// evidências e, dos que não deu para ler, por quê. Só contagens — o texto não
// vem para o painel; a conferência do conteúdo fica na tela PEP.
export function AbaDocumentos({ etapa }: { etapa: RoboEtapa | undefined }) {
  const d = (etapa?.detalhe ?? null) as Record<string, unknown> | null
  if (!etapa) return <p className="text-sm text-muted-foreground">Esta execução não leu documentos (robô anterior à versão 0.5.0).</p>
  if (!d || d.indisponivel) {
    return <p className="text-sm text-muted-foreground">O banco ainda não tem a atualização de 14/10/2026 (migration 20261014110000): o robô pulou esta etapa.</p>
  }
  const porStatus = (d.por_status ?? {}) as Record<string, number>
  const linhas = Object.entries(porStatus).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {numero(Number(d.lidos ?? 0))} documento(s) lido(s) nesta execução. O texto vai direto para o banco, numa tabela que nenhum login lê,
        e a conferência aparece em Entregas PEP.
      </p>
      {linhas.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {linhas.map(([status, n]) => (
            <li key={status} className="flex items-center justify-between gap-3 px-4 py-2">
              <span>{EXTRACAO_STATUS[status] ?? status}</span>
              <span className="font-semibold tabular-nums">{numero(n)}</span>
            </li>
          ))}
        </ul>
      )}
      {Number(d.pendentes_depois ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">{numero(Number(d.pendentes_depois))} ficaram para a próxima leitura (limite por execução).</p>
      )}
    </div>
  )
}
