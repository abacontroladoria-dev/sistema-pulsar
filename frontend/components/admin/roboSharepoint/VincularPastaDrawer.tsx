'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { Drawer } from '@/components/cronograma/ui/Drawer'
import { rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import { buscarPacientes, listarNomesDePrestadores, vincularPasta } from '@/services/roboSharepoint.service'
import type { SpPendenciaPasta } from '@/types/roboSharepoint'

// "Esta pasta é esta pessoa." Resolve de uma vez todos os arquivos presos
// atrás da pasta, e continua valendo se a pasta for renomeada (o vínculo é pelo
// id do SharePoint). Só rp/admin gravam — a RPC confere.

export function VincularPastaDrawer({ pendencia, titulo, onClose, onVinculado }: {
  pendencia: SpPendenciaPasta
  /** Título da ação, no verbo do motivo ("Escolher o cadastro certo"). */
  titulo?: string
  onClose: () => void
  onVinculado: () => void
}) {
  const [termo, setTermo] = useState('')
  const [prestadores, setPrestadores] = useState<string[]>([])
  const [pacientes, setPacientes] = useState<{ nome: string; cpf: string | null }[]>([])
  const [salvando, setSalvando] = useState(false)
  const ehPrestador = pendencia.tipo === 'prestador'

  useEffect(() => {
    if (ehPrestador) listarNomesDePrestadores().then(setPrestadores).catch(() => setPrestadores([]))
  }, [ehPrestador])

  useEffect(() => {
    if (ehPrestador) return
    const t = setTimeout(() => {
      buscarPacientes(termo).then(setPacientes).catch(() => setPacientes([]))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, ehPrestador])

  const opcoesPrestador = useMemo(() => {
    const t = termo.trim().toLocaleLowerCase('pt-BR')
    return (t ? prestadores.filter(p => p.toLocaleLowerCase('pt-BR').includes(t)) : prestadores).slice(0, 30)
  }, [prestadores, termo])

  async function escolher(nome: string, cpf?: string | null) {
    setSalvando(true)
    try {
      await vincularPasta({
        pastaId: pendencia.pasta_id,
        tipo: pendencia.tipo,
        prestadorNome: ehPrestador ? nome : null,
        pacienteNome: ehPrestador ? null : nome,
        pacienteCpf: ehPrestador ? null : cpf ?? null,
      })
      toast.success('Vínculo salvo. Os arquivos desta pasta foram reavaliados.')
      onVinculado()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o vínculo')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Drawer
      title={titulo ?? (ehPrestador ? 'Vincular pasta a um prestador' : 'Vincular pasta a um paciente')}
      subtitle={<>Pasta “{pendencia.nome_pasta}” · {rotuloMotivo(pendencia.motivo)}</>}
      onClose={onClose}
      width={460}
    >
      <div className="tema-robo">
      <label htmlFor="busca-vinculo" className="text-xs font-semibold text-slate-600">
        {ehPrestador ? 'Prestador (como está em Contratos)' : 'Paciente (cadastro do Pulsar)'}
      </label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id="busca-vinculo"
          autoFocus
          value={termo}
          onChange={e => setTermo(e.target.value)}
          placeholder={ehPrestador ? 'Digite para filtrar…' : 'Digite ao menos 3 letras do nome…'}
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {(ehPrestador ? opcoesPrestador.map(n => ({ nome: n, cpf: null })) : pacientes).map(o => (
          <li key={`${o.nome}-${o.cpf ?? ''}`}>
            <button
              type="button"
              disabled={salvando}
              onClick={() => escolher(o.nome, o.cpf)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="truncate">{o.nome}</span>
              {o.cpf && <span className="shrink-0 text-xs tabular-nums text-slate-500">CPF •••{o.cpf.slice(-4)}</span>}
            </button>
          </li>
        ))}
        {!ehPrestador && termo.trim().length >= 3 && pacientes.length === 0 && (
          <li className="px-3 py-3 text-sm text-slate-500">Nenhum paciente com esse nome no cadastro.</li>
        )}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        O vínculo vale acima do reconhecimento automático e fica registrado com o seu nome.
        {!ehPrestador && ' Os arquivos ainda precisam de uma sessão de Coordenador de Caso no mês para virar sugestão.'}
      </p>
      </div>
    </Drawer>
  )
}
