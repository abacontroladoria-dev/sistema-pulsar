'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Check, Folder, IdCard, Pointer, Search, UserSearch, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { grupoMotivo, nomeCurtoPrestador } from '@/lib/roboSharepoint/rotulos'
import { buscarPacientes, listarNomesDePrestadores, vincularPasta } from '@/services/roboSharepoint.service'
import type { SpPendenciaPasta } from '@/types/roboSharepoint'
import { abreviar, avisoFeito, confete, iniciais, tom, type Tom } from '@/components/ui/pastel/pecas'

// Uma pasta sem dono. O motivo vira cor + selo curto ("Nome?", "CPF duplo",
// "CNPJ?"); a frase inteira do motivo fica no title. "Nome?" é verde-azulado,
// não azul: na PEP azul quer dizer pessoa. "Escolher" abre as opções
// coladas à base do cartão — a mesma busca e a mesma RPC (sp_pep_vincular_pasta)
// da gaveta de antes.

export type CategoriaPasta = 'nome' | 'cpf' | 'cnpj'

export const CATEGORIAS: Record<CategoriaPasta, { t: Tom; Icone: typeof Folder; rotulo: string; explica: string }> = {
  nome: { t: 'teal', Icone: UserSearch, rotulo: 'Nome?', explica: 'O nome da pasta não está na planilha do prestador. Escolha o paciente certo.' },
  cpf: { t: 'rosa', Icone: IdCard, rotulo: 'CPF duplo', explica: 'Há duas fichas com o mesmo CPF. Escolha a ficha certa.' },
  cnpj: { t: 'coral', Icone: Building2, rotulo: 'CNPJ?', explica: 'Este CNPJ não está em nenhum contrato. Escolha o prestador.' },
}
export const ORDEM_CATEGORIAS: CategoriaPasta[] = ['nome', 'cpf', 'cnpj']

/** Pasta de prestador = CNPJ; CPF em dois cadastros = CPF duplo; o resto (achar o paciente pelo nome) = Nome?. */
export function categoriaDa(p: SpPendenciaPasta): CategoriaPasta {
  if (p.tipo === 'prestador') return 'cnpj'
  return p.motivo === 'cpf_duplicado_no_pulsar' ? 'cpf' : 'nome'
}

type Opcao = { nome: string; cpf: string | null }

function Seletor({ pendencia, categoria, onCancelar, onEscolhido }: {
  pendencia: SpPendenciaPasta
  categoria: CategoriaPasta
  onCancelar: () => void
  onEscolhido: (nome: string, origem: Element) => void
}) {
  const ehPrestador = pendencia.tipo === 'prestador'
  // Começa com o nome da pasta (duas primeiras palavras) para a lista já vir
  // preenchida; a pessoa corrige se precisar.
  const inicial = (ehPrestador ? nomeCurtoPrestador(pendencia.nome_pasta) : pendencia.nome_pasta)
    .trim().split(/\s+/).slice(0, ehPrestador ? 1 : 2).join(' ')
  const [termo, setTermo] = useState(inicial)
  const [prestadores, setPrestadores] = useState<string[]>([])
  const [pacientes, setPacientes] = useState<Opcao[]>([])
  const [salvando, setSalvando] = useState(false)

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

  const opcoes: Opcao[] = useMemo(() => {
    if (!ehPrestador) return pacientes
    const t = termo.trim().toLocaleLowerCase('pt-BR')
    return (t ? prestadores.filter(p => p.toLocaleLowerCase('pt-BR').includes(t)) : prestadores)
      .slice(0, 30).map(nome => ({ nome, cpf: null }))
  }, [ehPrestador, pacientes, prestadores, termo])

  async function escolher(o: Opcao, origem: Element) {
    setSalvando(true)
    try {
      await vincularPasta({
        pastaId: pendencia.pasta_id,
        tipo: pendencia.tipo,
        prestadorNome: ehPrestador ? o.nome : null,
        pacienteNome: ehPrestador ? null : o.nome,
        pacienteCpf: ehPrestador ? null : o.cpf ?? null,
      })
      onEscolhido(o.nome, origem)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o vínculo')
      setSalvando(false)
    }
  }

  const id = `pp-busca-${pendencia.pasta_id}`
  return (
    <div className="pp-seletor" role="dialog" aria-label={`De quem é a pasta ${pendencia.nome_pasta}?`}>
      <label htmlFor={id} className="sr-only">{ehPrestador ? 'Buscar prestador' : 'Buscar paciente'}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pp-ink-muted)]" aria-hidden />
        <input
          id={id}
          autoFocus
          value={termo}
          onChange={e => setTermo(e.target.value)}
          placeholder={ehPrestador ? 'Digite para filtrar…' : 'Ao menos 3 letras do nome…'}
          className="pp-busca"
          autoComplete="off"
        />
      </div>

      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto p-0.5">
        {opcoes.map(o => (
          <li key={`${o.nome}-${o.cpf ?? ''}`}>
            <button type="button" disabled={salvando} onClick={e => escolher(o, e.currentTarget)} className="pp-opcao">
              <span className="pp-avatar" aria-hidden>
                {categoria === 'cpf' ? <IdCard className="h-4 w-4" /> : iniciais(o.nome)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-extrabold text-[var(--pp-ink)]">{o.nome}</span>
                <span className="block truncate text-[11px] font-semibold tabular-nums text-[var(--pp-ink-muted)]">
                  {o.cpf ? `CPF •••${o.cpf.slice(-4)}` : ehPrestador ? 'Contrato' : 'Sem CPF no cadastro'}
                </span>
              </span>
            </button>
          </li>
        ))}
        {opcoes.length === 0 && (
          <li className="px-1 py-2 text-xs font-semibold text-[var(--pp-ink-muted)]">
            {!ehPrestador && termo.trim().length < 3 ? 'Digite ao menos 3 letras.' : 'Ninguém com esse nome. Tente outra parte do nome.'}
          </li>
        )}
      </ul>

      <button type="button" onClick={onCancelar} className="pp-btn pp-btn-suave w-full">
        <X className="h-4 w-4" aria-hidden /> Cancelar
      </button>
    </div>
  )
}

export function CartaoPasta({ p, escolhido, proximo, aberto, onAbrir, onFechar, onResolvido }: {
  p: SpPendenciaPasta
  /** Nome escolhido nesta sessão; null = pendente. */
  escolhido: string | null
  proximo: boolean
  aberto: boolean
  onAbrir: () => void
  onFechar: () => void
  onResolvido: (p: SpPendenciaPasta, nome: string) => void
}) {
  const categoria = categoriaDa(p)
  const cat = CATEGORIAS[categoria]
  const feito = escolhido != null
  const raiz = useRef<HTMLLIElement>(null)
  const botao = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) onFechar() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onFechar(); botao.current?.focus() } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto, onFechar])

  const prestador = p.tipo === 'prestador' ? 'Pasta de prestador' : abreviar(nomeCurtoPrestador(p.prestador_pasta_nome))
  const arquivos = p.arquivos > 0 ? ` · ${p.arquivos} ${p.arquivos === 1 ? 'arquivo esperando' : 'arquivos esperando'}` : ''

  return (
    <li ref={raiz} className={`${tom(feito ? 'verde' : cat.t)} pp-cartao ${proximo ? 'is-next' : ''} ${feito ? 'is-done' : ''} ${aberto ? 'is-open' : ''}`}>
      {proximo && <span className={`${tom('aco')} pp-selo pp-selo-flutua pp-selo-next`}><Pointer className="h-3 w-3" aria-hidden /> Comece aqui</span>}

      <div className="flex items-start gap-3">
        <span key={feito ? 'feito' : 'pendente'} className={`pp-avatar ${feito ? 'pp-pop' : ''}`} aria-hidden>
          {feito ? <Check className="h-5 w-5" strokeWidth={3} /> : <cat.Icone className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="pp-nome" title={p.nome_pasta}>{p.tipo === 'prestador' ? nomeCurtoPrestador(p.nome_pasta) : p.nome_pasta}</p>
          {feito ? (
            <p className="pp-apoio text-[var(--c-tinta)]"><Check className="h-3.5 w-3.5" aria-hidden /> {escolhido}</p>
          ) : (
            <p className="pp-apoio" title={`${p.prestador_pasta_nome ?? p.nome_pasta}${arquivos}`}>
              <Folder className="h-3.5 w-3.5" aria-hidden /> {prestador}
            </p>
          )}
        </div>
        {!feito && (
          <span className="pp-selo pp-selo-motivo" title={`${grupoMotivo(p.motivo).titulo}. ${grupoMotivo(p.motivo).porque}`}>{cat.rotulo}</span>
        )}
      </div>

      {!feito && (
        <button
          ref={botao}
          type="button"
          onClick={aberto ? onFechar : onAbrir}
          aria-expanded={aberto}
          className="pp-btn pp-btn-bloco"
        >
          <Pointer className="h-4 w-4" aria-hidden /> Escolher
        </button>
      )}

      {aberto && !feito && (
        <Seletor
          pendencia={p}
          categoria={categoria}
          onCancelar={() => { onFechar(); botao.current?.focus() }}
          onEscolhido={(nome, origem) => {
            confete(origem)
            avisoFeito('Liberado!')
            onResolvido(p, nome)
          }}
        />
      )}
    </li>
  )
}
