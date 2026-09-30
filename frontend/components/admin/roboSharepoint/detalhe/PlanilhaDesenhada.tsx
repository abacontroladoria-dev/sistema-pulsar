'use client'

import { useState } from 'react'
import { Check, FolderCheck, FolderX, X } from 'lucide-react'
import { StatusChip } from '@/components/ui/tones'
import { ITENS_PEP, numero } from '@/lib/roboSharepoint/rotulos'
import type { DetalhePlanilha, PacienteDetalhe } from '@/types/roboSharepoint'

// A "Planejamento Documentos Técnicos" de um prestador redesenhada como
// planilha — letras nas colunas, números nas linhas, as duas abas embaixo —
// com o que o robô entendeu de cada linha ao lado. O CPF nunca aparece: só
// se o dígito verificador bateu.

type Lida = Extract<DetalhePlanilha, { usada: true }>

const LETRAS = ['A', 'B', 'C', 'D', 'E']
const mesBR = (c: string | null | undefined) => (c ? c.split('-').reverse().join('/') : '')

function Grade({ cabecalho, linhas, inicio }: { cabecalho: string[]; linhas: React.ReactNode[][]; inicio: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-muted/60 text-[11px] text-muted-foreground">
            <th className="w-10 border-b border-r border-border" />
            {cabecalho.map((_, i) => <th key={i} className="border-b border-r border-border px-2 py-1 text-center font-medium last:border-r-0">{LETRAS[i]}</th>)}
          </tr>
          <tr>
            <td className="border-b border-r border-border bg-muted/60 px-2 py-1 text-center text-[11px] text-muted-foreground">{inicio}</td>
            {cabecalho.map(h => (
              <th key={h} className="border-b border-r border-border bg-[#2F5597] px-3 py-2 text-left text-xs font-bold text-white last:border-r-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="hover:bg-muted/30">
              <td className="border-b border-r border-border bg-muted/60 px-2 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground">{inicio + 1 + i}</td>
              {l.map((c, j) => <td key={j} className="border-b border-r border-border px-3 py-1.5 align-middle text-foreground last:border-r-0">{c}</td>)}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr><td colSpan={cabecalho.length + 1} className="px-3 py-6 text-center text-sm text-muted-foreground">Aba vazia.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function PlanilhaDesenhada({ detalhe, cruzamento }: {
  detalhe: Lida
  /** pacientes daquele prestador, já casados com pasta e cadastro */
  cruzamento: PacienteDetalhe[]
}) {
  const [aba, setAba] = useState<'planejamento' | 'pacientes'>('pacientes')
  const porNome = new Map(cruzamento.map(p => [p.nome.trim().toLowerCase(), p]))
  const pacientes = detalhe.pacientes ?? []
  const planejamento = detalhe.planejamento ?? []

  return (
    <div className="space-y-3">
      {/* Cabeçalho da planilha (A1:B3) */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { r: 'Prestador (Razão Social)', v: detalhe.razao_social ?? '—' },
          { r: 'CNPJ', v: detalhe.cnpj_valido ? <StatusChip tone="green"><Check className="h-3 w-3" aria-hidden />válido</StatusChip> : <StatusChip tone="amber"><X className="h-3 w-3" aria-hidden />{detalhe.cnpj_informado ? 'inválido' : 'ausente'}</StatusChip> },
          { r: 'e-mail', v: <span className="text-muted-foreground">não lido pelo robô</span> },
        ].map(c => (
          <div key={c.r} className="flex items-center gap-2 overflow-hidden rounded-lg border border-border">
            <span className="shrink-0 self-stretch bg-[#2F5597] px-2.5 py-2 text-[11px] font-bold text-white">{c.r}</span>
            <span className="min-w-0 truncate px-1 text-[13px] font-medium text-foreground">{c.v}</span>
          </div>
        ))}
      </div>

      {aba === 'pacientes' ? (
        <Grade
          inicio={2}
          cabecalho={['Nome / código do paciente', 'CPF', 'Pasta no SharePoint', 'No Pulsar']}
          linhas={pacientes.map(p => {
            const x = porNome.get(p.nome.trim().toLowerCase())
            return [
              <span key="n" className="font-medium">{p.nome}</span>,
              p.cpfValido ? <StatusChip key="c" tone="green" dense><Check className="h-3 w-3" aria-hidden />válido</StatusChip>
                : <StatusChip key="c" tone="amber" dense>{p.cpfInformado === false ? 'sem CPF' : 'inválido'}</StatusChip>,
              x?.pasta_id ? <span key="p" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><FolderCheck className="h-3.5 w-3.5" aria-hidden />achada</span>
                : <span key="p" className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><FolderX className="h-3.5 w-3.5" aria-hidden />sem pasta</span>,
              x?.status === 'reconhecido' ? <span key="u" className="truncate">{x.paciente_nome}</span>
                : <span key="u" className="text-amber-700 dark:text-amber-400">não reconhecido</span>,
            ]
          })}
        />
      ) : (
        <Grade
          inicio={7}
          cabecalho={['Paciente', 'Documento', 'Item do PEP', 'Competência']}
          linhas={planejamento.map(l => [
            <span key="p" className="font-medium">{l.paciente}</span>,
            <span key="d">{l.documento ?? '—'}</span>,
            l.sigla ? <span key="s" className="text-xs"><strong>{l.sigla}</strong> · {ITENS_PEP.find(i => i.sigla === l.sigla)?.nome}</span> : <span key="s" className="text-amber-700 dark:text-amber-400">documento não reconhecido</span>,
            <span key="c" className="tabular-nums">{mesBR(l.competencia) || <span className="text-muted-foreground">sem data</span>}</span>,
          ])}
        />
      )}

      {/* Abas da pasta de trabalho */}
      <div className="flex items-center gap-1 border-t border-border pt-2" role="tablist" aria-label="Abas da planilha">
        {([['planejamento', 'Planejamento', planejamento.length], ['pacientes', 'Pacientes', pacientes.length]] as const).map(([k, r, n]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`h-9 rounded-b-lg border-x border-b px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              aba === k ? 'border-border bg-card text-emerald-700 shadow-sm dark:text-emerald-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {r} <span className="tabular-nums text-muted-foreground">({numero(n)})</span>
          </button>
        ))}
        {planejamento.length === 0 && detalhe.planejamento === undefined && (
          <span className="ml-2 text-[11px] text-muted-foreground">as linhas do Planejamento aparecem a partir da próxima leitura do robô</span>
        )}
      </div>
    </div>
  )
}
