'use client'

import { useMemo, useState } from 'react'
import { ExternalLink, FolderX, Link2 } from 'lucide-react'
import { rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { SpItem, SpPendenciaPasta } from '@/types/roboSharepoint'
import { VincularPastaDrawer } from './VincularPastaDrawer'

// O que o robô não conseguiu reconhecer sozinho. Primeiro as PASTAS (resolver
// uma libera todos os arquivos atrás dela), depois os arquivos cujo problema é
// do próprio arquivo (sem sessão no mês, fora do padrão…).

const MOTIVOS_DE_PASTA = new Set([
  'planilha_ausente', 'cnpj_ausente', 'cnpj_invalido', 'cnpj_nao_cadastrado', 'cnpj_duplicado',
  'paciente_fora_da_planilha', 'cpf_ausente', 'cpf_invalido', 'cpf_nao_encontrado', 'cpf_duplicado_no_pulsar',
  'nome_divergente', 'prestador_nao_reconhecido', 'paciente_nao_reconhecido',
])

export function FilaNaoReconhecidos({ pendencias, itens, onAtualizar }: {
  pendencias: SpPendenciaPasta[]
  itens: SpItem[]
  onAtualizar: () => void
}) {
  const [aberta, setAberta] = useState<SpPendenciaPasta | null>(null)
  const itensDoArquivo = useMemo(() => itens.filter(i => !MOTIVOS_DE_PASTA.has(i.motivo ?? '')), [itens])

  if (pendencias.length === 0 && itensDoArquivo.length === 0) {
    return <p className="text-sm text-slate-500">Nada pendente: tudo o que o robô leu foi reconhecido.</p>
  }

  return (
    <div className="space-y-5">
      {pendencias.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Pastas a vincular ({pendencias.length})</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {pendencias.map(p => (
              <li key={p.pasta_id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <FolderX className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="truncate">{p.nome_pasta}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {p.tipo === 'prestador' ? 'Prestador' : `Paciente${p.prestador_pasta_nome ? ` · ${p.prestador_pasta_nome.replace(/^Prestador de Serviço\s*-\s*/i, '')}` : ''}`}
                    {' · '}{rotuloMotivo(p.motivo)}
                    {p.arquivos > 0 && <> · <strong className="text-slate-700">{p.arquivos} arquivo(s) esperando</strong></>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAberta(p)}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Link2 className="h-4 w-4" aria-hidden /> Vincular
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {itensDoArquivo.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Arquivos com problema próprio ({itensDoArquivo.length})</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {itensDoArquivo.slice(0, 50).map(i => (
              <li key={i.sp_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">{i.nome}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {rotuloMotivo(i.motivo)}{i.competencia ? ` · ${i.competencia.split('-').reverse().join('/')}` : ''}{i.caminho ? ` · ${i.caminho}` : ''}
                  </p>
                </div>
                {i.web_url && (
                  <a href={i.web_url} target="_blank" rel="noreferrer"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    Abrir <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {aberta && <VincularPastaDrawer pendencia={aberta} onClose={() => setAberta(null)} onVinculado={onAtualizar} />}
    </div>
  )
}
