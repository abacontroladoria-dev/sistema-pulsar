'use client'

import { useMemo, useState } from 'react'
import {
  ArrowRight, Bot, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, FileSpreadsheet, FileText, FileWarning,
  FolderOpen, Search, Send, UserCheck, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { grupoMotivo, mensagemPedirPlanilha, nomeCurtoPrestador, numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { SpFilaPendencias, SpItem, SpPendenciaPasta, SpPrestadorSemPlanilha } from '@/types/roboSharepoint'
import { VincularPastaDrawer } from './VincularPastaDrawer'

// "O que precisa de você" — o que o robô não conseguiu resolver sozinho, como
// TAREFAS para quem nem sabe o que é PEP. Três cartões no topo, um por ação
// (pedir a planilha / dizer de quem é a pasta / ver arquivos com problema),
// ordenados pelo que destravam. Cada tarefa traz o "como resolver" em 3 passos
// e a lista pronta para agir; o detalhe técnico fica no "Por que isso acontece?".
//
// Cores (DESIGN.md, Status Lock Rule): âmbar = esperando alguém de fora (o
// prestador); brand = ação que se faz aqui; rosa = problema no arquivo. Âmbar
// nunca pinta botão — os botões são todos brand-outline.

const MOTIVOS_DE_PASTA = new Set([
  'planilha_ausente', 'cnpj_ausente', 'cnpj_invalido', 'cnpj_nao_cadastrado', 'cnpj_duplicado',
  'paciente_fora_da_planilha', 'cpf_ausente', 'cpf_invalido', 'cpf_nao_encontrado', 'cpf_duplicado_no_pulsar',
  'nome_divergente', 'prestador_nao_reconhecido', 'paciente_nao_reconhecido',
])

const arquivosDoProprio = (itens: SpItem[]) => itens.filter(i => !MOTIVOS_DE_PASTA.has(i.motivo ?? ''))

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

/** "9 prestadores sem planilha · 6 pastas para vincular" — cada unidade no seu lugar. */
export function resumoPendencias(fila: SpFilaPendencias, itens: SpItem[]) {
  const partes: string[] = []
  const n = fila.semPlanilha.length
  const p = fila.pastas.length
  const a = arquivosDoProprio(itens).length
  if (n) partes.push(`${plural(n, 'prestador', 'prestadores')} sem planilha`)
  if (p) partes.push(`${plural(p, 'pasta', 'pastas')} sem dono`)
  if (a) partes.push(`${plural(a, 'arquivo', 'arquivos')} com problema`)
  return partes.length ? partes.join(' · ') : 'tudo em dia'
}

// ── Tons ─────────────────────────────────────────────────────────────────────
// Classes escritas por inteiro (o Tailwind só gera o que lê no código).

type Tom = 'amber' | 'brand' | 'rose'
const TOM: Record<Tom, { cartao: string; ativo: string; icone: string; numero: string; passo: string }> = {
  amber: {
    cartao: 'border-amber-200 bg-amber-50/50 hover:bg-amber-50',
    ativo: 'border-amber-300 bg-amber-50 ring-2 ring-amber-300',
    icone: 'bg-amber-100 text-amber-800',
    numero: 'text-amber-900',
    passo: 'bg-amber-100 text-amber-800 ring-amber-200',
  },
  brand: {
    cartao: 'border-brand/25 bg-brand-surface/40 hover:bg-brand-surface/70',
    ativo: 'border-brand/50 bg-brand-surface/70 ring-2 ring-brand/50',
    icone: 'bg-white text-brand-fg ring-1 ring-brand/25',
    numero: 'text-slate-900',
    passo: 'bg-brand-surface text-brand-fg ring-brand/25',
  },
  rose: {
    cartao: 'border-rose-200 bg-rose-50/50 hover:bg-rose-50',
    ativo: 'border-rose-300 bg-rose-50 ring-2 ring-rose-300',
    icone: 'bg-rose-100 text-rose-700',
    numero: 'text-rose-900',
    passo: 'bg-rose-100 text-rose-700 ring-rose-200',
  },
}

const botao = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50'

type Passo = { icone: typeof Send; titulo: string; texto: string }
type TarefaId = 'planilha' | 'pasta' | 'arquivo'
type Tarefa = {
  id: TarefaId; tom: Tom; icone: typeof Send; verbo: string
  quantidade: number; unidade: [string, string]; destrava: string
  passos: Passo[]; porque: React.ReactNode
}

// ── Peças ────────────────────────────────────────────────────────────────────

function CartaoTarefa({ t, ativo, onClick }: { t: Tarefa; ativo: boolean; onClick: () => void }) {
  const tom = TOM[t.tom]
  const Icone = t.icone
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      aria-controls={`tarefa-${t.id}`}
      className={`group flex w-full flex-col gap-2 rounded-2xl border p-3.5 text-left sm:gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:p-5 ${ativo ? tom.ativo : tom.cartao}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tom.icone}`}>
          <Icone className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-right">
          <span className={`block text-3xl font-bold leading-none tabular-nums ${tom.numero}`}>{numero(t.quantidade)}</span>
          <span className="mt-1 block text-xs font-medium text-slate-600">{t.quantidade === 1 ? t.unidade[0] : t.unidade[1]}</span>
        </span>
      </span>
      <span>
        <span className="block text-base font-bold text-slate-900">{t.verbo}</span>
        <span className="mt-0.5 block text-sm text-slate-600">{t.destrava}</span>
      </span>
      <span className="flex items-center gap-1 text-xs font-semibold text-brand-fg">
        {ativo ? 'Lista aberta abaixo' : 'Ver a lista'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${ativo ? 'rotate-180' : ''}`} aria-hidden />
      </span>
    </button>
  )
}

function ComoResolver({ passos, tom }: { passos: Passo[]; tom: Tom }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3 sm:gap-2">
      {passos.map((p, i) => (
        <li key={p.titulo} className="relative flex items-start gap-3 rounded-xl bg-slate-50 p-3 sm:pr-6">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ${TOM[tom].passo}`}>
            <p.icone className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-800">{p.titulo}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{p.texto}</span>
          </span>
          {i < passos.length - 1 && (
            <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-white text-slate-400 sm:block" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  )
}

function PorQue({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        Por que isso acontece?
        <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-1 pt-2 text-xs leading-relaxed text-slate-600">{children}</div>
    </details>
  )
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    // Navegador sem permissão de área de transferência: textarea + execCommand.
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

function CartaoPrestador({ p }: { p: SpPrestadorSemPlanilha }) {
  const nome = nomeCurtoPrestador(p.nome_pasta)
  const [copiado, setCopiado] = useState(false)

  async function copiarMensagem() {
    if (await copiar(mensagemPedirPlanilha(nome, p.pastas_paciente))) {
      setCopiado(true)
      toast.success(`Mensagem para ${nome} copiada. Cole no WhatsApp ou no e-mail.`)
      setTimeout(() => setCopiado(false), 2500)
    } else {
      toast.error('Não foi possível copiar. Selecione o texto à mão.')
    }
  }

  return (
    <li className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-surface text-sm font-bold text-brand-fg" aria-hidden>
          {iniciais(nome)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-slate-800" title={p.nome_pasta}>{nome}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
              <Users className="h-3.5 w-3.5" aria-hidden /> {plural(p.pastas_paciente, 'paciente travado', 'pacientes travados')}
            </span>
            {p.arquivos > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                <FileText className="h-3.5 w-3.5" aria-hidden /> {plural(p.arquivos, 'arquivo esperando', 'arquivos esperando')}
              </span>
            )}
            {p.vinculado_a_mao && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                title="Alguém já disse quem é este prestador, mas os pacientes dele só são liberados quando a planilha chegar.">
                Já identificado
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
        <button type="button" onClick={copiarMensagem} className={botao}>
          {copiado ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copiado ? 'Copiada!' : 'Copiar mensagem'}
        </button>
        {p.web_url ? (
          <a href={p.web_url} target="_blank" rel="noreferrer" className={botao}>
            <FolderOpen className="h-4 w-4" aria-hidden /> Abrir pasta
          </a>
        ) : (
          <span className={`${botao} cursor-not-allowed text-slate-400`} title="O link da pasta chega na próxima leitura do robô.">
            <FolderOpen className="h-4 w-4" aria-hidden /> Abrir pasta
          </span>
        )}
      </div>
    </li>
  )
}

function GruposDePastas({ pastas, onEscolher }: { pastas: SpPendenciaPasta[]; onEscolher: (p: SpPendenciaPasta) => void }) {
  const grupos = useMemo(() => {
    const m = new Map<string, SpPendenciaPasta[]>()
    for (const p of pastas) {
      const k = p.motivo ?? '—'
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [pastas])

  return (
    <div className="space-y-5">
      {grupos.map(([motivo, lista]) => {
        const g = grupoMotivo(motivo)
        return (
          <section key={motivo} aria-label={g.titulo}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-slate-800">{g.titulo}</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{lista.length}</span>
            </div>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-600">{g.porque}</p>
            <ul className="mt-2.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lista.map(p => (
                <li key={p.pasta_id} className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <div className="p-4">
                    <p className="text-sm font-bold leading-snug text-slate-800">{p.nome_pasta}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {p.tipo === 'prestador' ? 'Pasta de prestador' : `Prestador: ${nomeCurtoPrestador(p.prestador_pasta_nome)}`}
                      </span>
                      {p.arquivos > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          <FileText className="h-3.5 w-3.5" aria-hidden /> {plural(p.arquivos, 'arquivo esperando', 'arquivos esperando')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-auto border-t border-slate-100 p-3">
                    <button type="button" onClick={() => onEscolher(p)} className={`${botao} w-full`}>
                      <UserCheck className="h-4 w-4" aria-hidden /> {g.botao}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ListaArquivos({ itens }: { itens: SpItem[] }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {itens.slice(0, 50).map(i => (
        <li key={i.sp_id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800" title={i.nome}>{i.nome}</p>
            <span className="mt-1.5 inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
              {rotuloMotivo(i.motivo)}
            </span>
            <p className="mt-1.5 truncate text-xs text-slate-500" title={i.caminho ?? undefined}>
              {i.competencia ? `${i.competencia.split('-').reverse().join('/')} · ` : ''}{i.caminho ?? ''}
            </p>
          </div>
          {i.web_url && (
            <a href={i.web_url} target="_blank" rel="noreferrer" className={`${botao} shrink-0`}>
              Abrir <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── Tela ─────────────────────────────────────────────────────────────────────

export function FilaNaoReconhecidos({ fila, itens, onAtualizar }: {
  fila: SpFilaPendencias
  itens: SpItem[]
  onAtualizar: () => void
}) {
  const [aberta, setAberta] = useState<SpPendenciaPasta | null>(null)
  const itensDoArquivo = useMemo(() => arquivosDoProprio(itens), [itens])
  const { semPlanilha, pastas } = fila

  const pacientesTravados = semPlanilha.reduce((s, p) => s + p.pastas_paciente, 0)
  const arquivosTravados = semPlanilha.reduce((s, p) => s + p.arquivos, 0)

  const todas: Tarefa[] = [
    {
      id: 'planilha', tom: 'amber', icone: FileSpreadsheet, verbo: 'Pedir a planilha',
      quantidade: semPlanilha.length, unidade: ['prestador', 'prestadores'],
      destrava: pacientesTravados > 0 ? `${plural(pacientesTravados, 'paciente travado', 'pacientes travados')} até ela chegar` : 'Falta a planilha de planejamento',
      passos: [
        { icone: Send, titulo: 'Avise o prestador', texto: 'Toque em “Copiar mensagem” e mande por WhatsApp ou e-mail.' },
        { icone: FileSpreadsheet, titulo: 'Ele coloca a planilha', texto: 'Na pasta “1. Planejamento”, dentro da pasta dele no SharePoint.' },
        { icone: Bot, titulo: 'O robô faz o resto', texto: 'Na leitura seguinte, todos os pacientes dele são liberados sozinhos.' },
      ],
      porque: (
        <>
          É da planilha de planejamento que o robô tira o CNPJ do prestador e o CPF de cada paciente. Sem ela, nenhum paciente
          do prestador pode ser reconhecido
          {arquivosTravados > 0 && <> — hoje são <strong className="text-slate-800">{plural(arquivosTravados, 'arquivo esperando', 'arquivos esperando')}</strong></>}.
          Por isso não adianta dizer à mão quem é o prestador: a planilha é o único caminho.
        </>
      ),
    },
    {
      id: 'pasta', tom: 'brand', icone: UserCheck, verbo: 'Dizer de quem é a pasta',
      quantidade: pastas.length, unidade: ['pasta', 'pastas'],
      destrava: 'Você resolve aqui mesmo, em um toque',
      passos: [
        { icone: Search, titulo: 'Veja o motivo', texto: 'Cada grupo abaixo diz por que o robô não reconheceu a pasta.' },
        { icone: UserCheck, titulo: 'Escolha a pessoa certa', texto: 'Busque pelo nome e toque nela.' },
        { icone: CheckCircle2, titulo: 'Pronto', texto: 'Os arquivos da pasta são liberados na hora, e o robô lembra nas próximas leituras.' },
      ],
      porque: (
        <>
          O robô tem a planilha, mas não conseguiu ligar a pasta a uma pessoa do Pulsar: o nome não está na planilha, ou o CPF
          aponta para dois cadastros. Quando você escolhe, a escolha fica registrada com o seu nome e vale mesmo se a pasta for
          renomeada.
        </>
      ),
    },
    {
      id: 'arquivo', tom: 'rose', icone: FileWarning, verbo: 'Ver arquivos com problema',
      quantidade: itensDoArquivo.length, unidade: ['arquivo', 'arquivos'],
      destrava: 'Fora do lugar, sem mês ou sem sessão no mês',
      passos: [
        { icone: Search, titulo: 'Veja o motivo', texto: 'Cada arquivo diz o que está errado.' },
        { icone: ExternalLink, titulo: 'Corrija no SharePoint', texto: 'Toque em “Abrir” e ajuste o nome ou a pasta.' },
        { icone: Bot, titulo: 'O robô confere de novo', texto: 'Toda noite, às 03:00, ou em “Executar agora”.' },
      ],
      porque: <>A pasta do arquivo está certa, mas o arquivo em si tem um problema: está fora das pastas esperadas, o mês não foi identificado, ou o paciente não teve sessão de Coordenador de Caso no mês.</>,
    },
  ]
  const tarefas = todas.filter(t => t.quantidade > 0)

  const [escolhida, setEscolhida] = useState<TarefaId | null>(null)
  const ativa = tarefas.find(t => t.id === escolhida) ?? tarefas[0] ?? null

  if (!ativa) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
        <p className="text-base font-bold text-emerald-800">Tudo em dia</p>
        <p className="text-sm text-emerald-800/80">O robô reconheceu tudo o que leu. Não há nada para você fazer agora.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className={`grid gap-3 ${tarefas.length === 3 ? 'md:grid-cols-3' : tarefas.length === 2 ? 'md:grid-cols-2' : ''}`}>
        {tarefas.map(t => <CartaoTarefa key={t.id} t={t} ativo={t.id === ativa.id} onClick={() => setEscolhida(t.id)} />)}
      </div>

      <div id={`tarefa-${ativa.id}`} className="space-y-4" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900">Como resolver: {ativa.verbo.toLocaleLowerCase('pt-BR')}</h3>
        </div>
        <ComoResolver passos={ativa.passos} tom={ativa.tom} />

        {ativa.id === 'planilha' && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {semPlanilha.map(p => <CartaoPrestador key={p.pasta_id} p={p} />)}
          </ul>
        )}
        {ativa.id === 'pasta' && <GruposDePastas pastas={pastas} onEscolher={setAberta} />}
        {ativa.id === 'arquivo' && <ListaArquivos itens={itensDoArquivo} />}

        <PorQue>{ativa.porque}</PorQue>
      </div>

      {aberta && (
        <VincularPastaDrawer
          pendencia={aberta}
          titulo={grupoMotivo(aberta.motivo).botao}
          onClose={() => setAberta(null)}
          onVinculado={onAtualizar}
        />
      )}
    </div>
  )
}
