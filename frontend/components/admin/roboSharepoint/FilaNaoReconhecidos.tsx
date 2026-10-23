'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Bot, CheckCircle2, ExternalLink, FileSpreadsheet, FileWarning, FolderSearch,
} from 'lucide-react'
import { btnSecundario, selo } from '@/components/cronograma/grade/estilo'
import { SegmentedTabs } from '@/components/cronograma/ui/SegmentedTabs'
import { CabecalhoSecao, EstadoVazio, Progresso, cartaoPadrao } from '@/components/ui/padrao'
import { numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { SpFilaPendencias, SpItem, SpPendenciaPasta } from '@/types/roboSharepoint'
import { CATEGORIAS, CartaoPasta, ORDEM_CATEGORIAS, categoriaDa, type CategoriaPasta } from './precisaDeVoce/CartaoPasta'
import { CartaoPrestador } from './precisaDeVoce/CartaoPrestador'

// "O que precisa de você" — o que o robô não conseguiu resolver sozinho, como
// tarefas diretas. Só a camada visual mudou: os dados (listarPendenciasDePasta),
// a mensagem copiada (mensagemPedirPlanilha) e a gravação do vínculo
// (sp_pep_vincular_pasta) são os mesmos.

const MOTIVOS_DE_PASTA = new Set([
  'planilha_ausente', 'cnpj_ausente', 'cnpj_invalido', 'cnpj_nao_cadastrado', 'cnpj_duplicado',
  'paciente_fora_da_planilha', 'cpf_ausente', 'cpf_invalido', 'cpf_nao_encontrado', 'cpf_duplicado_no_pulsar',
  'nome_divergente', 'prestador_nao_reconhecido', 'paciente_nao_reconhecido',
])

const arquivosDoProprio = (itens: SpItem[]) => itens.filter(i => !MOTIVOS_DE_PASTA.has(i.motivo ?? ''))

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

// ── "Avisado" fica no navegador ──────────────────────────────────────────────
// Não há onde gravar no banco que o prestador foi avisado. Guarda por 7 dias
// neste navegador: o bastante para não pedir duas vezes na mesma semana.

const CHAVE_AVISADOS = 'pep:precisa-de-voce:avisados'
const VALIDADE_AVISO_MS = 7 * 86_400_000

function lerAvisados(): Record<string, string> {
  try {
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE_AVISADOS) ?? '{}') as Record<string, string>
    const limite = Date.now() - VALIDADE_AVISO_MS
    return Object.fromEntries(Object.entries(bruto).filter(([, iso]) => Date.parse(iso) > limite))
  } catch {
    return {}
  }
}

function gravarAvisados(v: Record<string, string>) {
  try { window.localStorage.setItem(CHAVE_AVISADOS, JSON.stringify(v)) } catch { /* sem armazenamento: vale só nesta visita */ }
}

// ── Abas ─────────────────────────────────────────────────────────────────────

type AbaId = 'planilha' | 'pasta' | 'arquivo'

const PASSOS: Record<AbaId, string> = {
  planilha: 'Como resolver: 1. Copie a mensagem · 2. Envie ao prestador · 3. O robô libera quando a planilha entrar',
  pasta: 'Como resolver: 1. Toque em Escolher · 2. Selecione a pessoa certa · 3. Pasta liberada na hora',
  arquivo: 'Como resolver: 1. Abra no SharePoint · 2. Corrija o nome ou a pasta · 3. O robô confere na próxima leitura',
}

function ListaArquivos({ itens }: { itens: SpItem[] }) {
  return (
    <ul className={`${cartaoPadrao} divide-y divide-border`}>
      {itens.slice(0, 50).map(i => (
        <li key={i.sp_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground" title={i.nome}>{i.nome}</span>
              <span className={selo('red')}>{rotuloMotivo(i.motivo)}</span>
            </p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground" title={i.caminho ?? undefined}>
              {i.competencia ? `${i.competencia.split('-').reverse().join('/')} · ` : ''}{i.caminho ?? ''}
            </p>
          </div>
          {i.web_url && (
            <a href={i.web_url} target="_blank" rel="noreferrer" className={`${btnSecundario} min-h-11 shrink-0 sm:min-h-0`}>
              Abrir <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── Tela ─────────────────────────────────────────────────────────────────────

const GRADE = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'

export function FilaNaoReconhecidos({ fila, itens, onAtualizar }: {
  fila: SpFilaPendencias
  itens: SpItem[]
  onAtualizar: () => void
}) {
  const { semPlanilha, pastas } = fila
  const itensDoArquivo = useMemo(() => arquivosDoProprio(itens), [itens])

  // Planilha: primeiro quem já tem arquivo esperando, depois quem trava mais pacientes.
  const prestadores = useMemo(
    () => [...semPlanilha].sort((a, b) => Number(b.arquivos > 0) - Number(a.arquivos > 0) || b.pastas_paciente - a.pastas_paciente),
    [semPlanilha],
  )
  const [avisados, setAvisados] = useState<Record<string, string>>(() => (typeof window === 'undefined' ? {} : lerAvisados()))
  const marcarAvisado = useCallback((pastaId: string) => {
    setAvisados(prev => {
      const prox = { ...prev, [pastaId]: new Date().toISOString() }
      gravarAvisados(prox)
      return prox
    })
  }, [])
  const prestadoresPendentes = prestadores.filter(p => !avisados[p.pasta_id])
  const maxPacientes = Math.max(0, ...prestadores.map(p => p.pastas_paciente))
  const pacientesParados = prestadores.reduce((s, p) => s + p.pastas_paciente, 0)
  const [verAvisados, setVerAvisados] = useState(false)

  // Pastas: a escolha fica verde nesta visita, mesmo depois que a fila recarrega sem ela.
  const [resolvidas, setResolvidas] = useState<Map<string, { p: SpPendenciaPasta; nome: string }>>(new Map())
  const [aberta, setAberta] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<CategoriaPasta | null>(null)
  const fecharSeletor = useCallback(() => setAberta(null), [])
  const resolver = useCallback((p: SpPendenciaPasta, nome: string) => {
    setResolvidas(prev => new Map(prev).set(p.pasta_id, { p, nome }))
    setAberta(null)
    onAtualizar()
  }, [onAtualizar])

  const pastasPendentes = pastas.filter(p => !resolvidas.has(p.pasta_id))
  const todasAsPastas = useMemo(() => {
    const lista = [...pastas.filter(p => !resolvidas.has(p.pasta_id)), ...[...resolvidas.values()].map(r => r.p)]
    return lista.sort((a, b) =>
      ORDEM_CATEGORIAS.indexOf(categoriaDa(a)) - ORDEM_CATEGORIAS.indexOf(categoriaDa(b))
      || b.arquivos - a.arquivos || a.nome_pasta.localeCompare(b.nome_pasta, 'pt-BR'))
  }, [pastas, resolvidas])
  const pastasVisiveis = filtro ? todasAsPastas.filter(p => categoriaDa(p) === filtro) : todasAsPastas
  const proximaPasta = pastasVisiveis.find(p => !resolvidas.has(p.pasta_id))?.pasta_id ?? null
  const pendentesPorCategoria = (c: CategoriaPasta) => pastasPendentes.filter(p => categoriaDa(p) === c).length
  const categoriasPresentes = ORDEM_CATEGORIAS.filter(c => todasAsPastas.some(p => categoriaDa(p) === c))

  // Progresso: avisados + pastas resolvidas, sobre o total das duas abas.
  const totalPastas = new Set([...pastas.map(p => p.pasta_id), ...resolvidas.keys()]).size
  const total = prestadores.length + totalPastas
  const feitas = prestadores.length - prestadoresPendentes.length + resolvidas.size

  const abas: { id: AbaId; titulo: string; pendentes: number }[] = [
    { id: 'planilha', titulo: 'Pedir planilha', pendentes: prestadoresPendentes.length },
    { id: 'pasta', titulo: 'De quem é a pasta?', pendentes: pastasPendentes.length },
  ]
  if (itensDoArquivo.length > 0) {
    abas.push({ id: 'arquivo', titulo: 'Arquivos com problema', pendentes: itensDoArquivo.length })
  }

  const [escolhida, setEscolhida] = useState<AbaId>(() =>
    prestadores.some(p => !avisados[p.pasta_id]) ? 'planilha'
      : pastas.length ? 'pasta'
        : itensDoArquivo.length ? 'arquivo' : 'planilha')
  const ativa = abas.find(a => a.id === escolhida) ?? abas[0]

  const nadaAFazer = prestadores.length === 0 && totalPastas === 0 && itensDoArquivo.length === 0

  return (
    <div>
      <CabecalhoSecao
        id="titulo-precisa-de-voce"
        titulo="O que precisa de você"
        apoio="O que o robô não conseguiu resolver sozinho"
        ajuda={[
          { Icone: FileSpreadsheet, tone: 'amber', texto: 'Pedir planilha: copie a mensagem pronta e envie ao prestador.' },
          { Icone: FolderSearch, tone: 'blue', texto: 'De quem é a pasta?: escolha o paciente ou prestador certo com 1 toque.' },
          { Icone: FileWarning, tone: 'red', texto: 'Arquivos com problema: abra no SharePoint e corrija o nome ou a pasta.' },
          { Icone: Bot, tone: 'purple', texto: 'Depois que a planilha entra ou a pasta é vinculada, o robô libera os arquivos.' },
        ]}
        rotuloAjuda="Como funciona esta fila"
        direita={!nadaAFazer ? <Progresso feitas={feitas} total={total} rotulo="resolvidas" tone="green" /> : undefined}
      />

      {nadaAFazer ? (
        <EstadoVazio
          Icone={CheckCircle2}
          titulo="Tudo em dia!"
          texto="Nenhuma planilha faltando, nenhuma pasta sem dono e nenhum arquivo com problema."
        />
      ) : (
        <div className="space-y-4">
          <SegmentedTabs<AbaId>
            size="lg"
            value={ativa.id}
            onChange={setEscolhida}
            ariaLabel="Tarefas"
            tabs={abas.map(a => ({ value: a.id, label: a.titulo, count: a.pendentes }))}
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {PASSOS[ativa.id]}
                {ativa.id === 'planilha' && prestadoresPendentes.length > 0 && pacientesParados > 0
                  ? ` · ${plural(pacientesParados, 'paciente parado', 'pacientes parados')}`
                  : ''}
              </p>
              {ativa.id === 'pasta' && categoriasPresentes.length > 1 && pastasPendentes.length > 0 && (
                <SegmentedTabs<'todas' | CategoriaPasta>
                  size="sm"
                  value={filtro ?? 'todas'}
                  onChange={v => setFiltro(v === 'todas' ? null : v)}
                  ariaLabel="Filtrar por motivo"
                  tabs={[
                    { value: 'todas', label: 'Todas', count: pastasPendentes.length },
                    ...categoriasPresentes.map(c => ({
                      value: c,
                      label: CATEGORIAS[c].rotulo,
                      count: pendentesPorCategoria(c),
                    })),
                  ]}
                />
              )}
            </div>

            {ativa.id === 'planilha' && (
              prestadoresPendentes.length === 0 && !verAvisados ? (
                <EstadoVazio
                  Icone={CheckCircle2}
                  titulo={prestadores.length ? 'Todos os prestadores foram avisados!' : 'Todos os prestadores têm planilha!'}
                  texto="Agora é com o robô."
                  acao={
                    prestadores.length > 0 ? (
                      <button type="button" onClick={() => setVerAvisados(true)} className={btnSecundario}>
                        Ver os avisados
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className={GRADE}>
                  {prestadores.map(p => (
                    <CartaoPrestador
                      key={p.pasta_id}
                      p={p}
                      avisadoEm={avisados[p.pasta_id] ?? null}
                      proximo={p.pasta_id === prestadoresPendentes[0]?.pasta_id}
                      maxPacientes={maxPacientes}
                      onAvisado={marcarAvisado}
                    />
                  ))}
                </ul>
              )
            )}

            {ativa.id === 'pasta' && (
              pastasPendentes.length === 0 ? (
                <EstadoVazio Icone={CheckCircle2} titulo="Todas as pastas têm dono!" texto="Arquivos liberados." />
              ) : (
                <ul className={GRADE}>
                  {pastasVisiveis.map(p => (
                    <CartaoPasta
                      key={p.pasta_id}
                      p={p}
                      escolhido={resolvidas.get(p.pasta_id)?.nome ?? null}
                      proximo={p.pasta_id === proximaPasta}
                      aberto={aberta === p.pasta_id}
                      onAbrir={() => setAberta(p.pasta_id)}
                      onFechar={fecharSeletor}
                      onResolvido={resolver}
                    />
                  ))}
                </ul>
              )
            )}

            {ativa.id === 'arquivo' && <ListaArquivos itens={itensDoArquivo} />}
          </div>
        </div>
      )}
    </div>
  )
}
