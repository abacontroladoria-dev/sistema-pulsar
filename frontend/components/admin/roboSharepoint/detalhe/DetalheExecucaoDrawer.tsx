'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Circle, History, X } from 'lucide-react'
import { Drawer, Z_DRAWER } from '@/components/cronograma/ui/Drawer'
import { useCountUp } from '@/components/cronograma/remuneracao/RemuneracaoRPDashboard'
import { dataHora, ETAPAS, GATILHOS, MODOS, numero, segundos } from '@/lib/roboSharepoint/rotulos'
import { ehEstadoAtual } from '@/lib/roboSharepoint/referencias'
import { obterResumoExecucao } from '@/services/roboSharepoint.service'
import type { ResumoExecucao, RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'
import { Aviso, CamadaModal } from './Blocos'
import { AbaAutenticar } from './AbaAutenticar'
import { AbaListar } from './AbaListar'
import { AbaClassificar } from './AbaClassificar'
import { AbaPlanilhas } from './AbaPlanilhas'
import { AbaReconhecer } from './AbaReconhecer'

// "O que o robô leu": uma execução aberta etapa por etapa. Abre na etapa do
// card clicado; o trilho de cima troca de etapa sem fechar. Cabeçalho no
// padrão da Rem. Mês - Total (faixa degradê, número que conta).

const RESUMO_VAZIO: ResumoExecucao = {
  registrado: false, total: 0, por_tipo: {}, por_sigla: {}, motivos: [], sem_prestador: 0, prestadores: [],
  pastas: { total: 0, prestadores: 0, pacientes: 0 },
}

/** O registro arquivo por arquivo começou no robô 0.2.0. */
const registraArquivos = (versao: string | null) => {
  const [a, b] = (versao ?? '0.0').split('.').map(Number)
  return a > 0 || (a === 0 && b >= 2)
}

function Metrica({ valor, rotulo, formato }: { valor: number; rotulo: string; formato?: (n: number) => string }) {
  const v = useCountUp(valor)
  return (
    <div className="px-4 first:pl-0">
      <p className="text-base font-bold leading-tight tabular-nums text-foreground">{formato ? formato(v) : numero(Math.round(v))}</p>
      <p className="text-[11px] font-medium leading-tight text-muted-foreground">{rotulo}</p>
    </div>
  )
}

export function DetalheExecucaoDrawer({ execucao, etapaInicial, ehUltima, ultimaCompleta, onAbrirExecucao, zIndex = Z_DRAWER, onClose, simples = false, competencia }: {
  execucao: RoboExecucao
  etapaInicial: RoboEtapaNome
  ehUltima: boolean
  /** Última execução que leu o site inteiro — para quando esta não leu nada. */
  ultimaCompleta?: RoboExecucao | null
  onAbrirExecucao?: (e: RoboExecucao, etapa: RoboEtapaNome) => void
  zIndex?: number
  onClose: () => void
  /**
   * Tela PEP (pedido de 02/10/2026): só "Listar o SharePoint" — sem o trilho
   * das 5 etapas, sem tempo, sem "evidências"/"sugestões" no cabeçalho. Fica
   * só o que a lista embaixo mostra: os arquivos e as pastas.
   */
  simples?: boolean
  /** Mês de atendimento do PDF por prestador ('AAAA-MM'); padrão: o mês atual. */
  competencia?: string
}) {
  const [etapa, setEtapa] = useState<RoboEtapaNome>(simples ? 'listar' : etapaInicial)
  const [resumo, setResumo] = useState<ResumoExecucao | null>(null)
  const [erroResumo, setErroResumo] = useState<string | null>(null)
  const topoRef = useRef<HTMLDivElement | null>(null)

  const [idCarregado, setIdCarregado] = useState(execucao.id)
  if (idCarregado !== execucao.id) { setIdCarregado(execucao.id); setResumo(null); setEtapa(etapaInicial) }

  useEffect(() => {
    let vivo = true
    obterResumoExecucao(execucao.id)
      .then(r => { if (vivo) setResumo(r) })
      .catch(e => { if (vivo) { setErroResumo(e instanceof Error ? e.message : 'erro'); setResumo(RESUMO_VAZIO) } })
    return () => { vivo = false }
  }, [execucao.id])

  useEffect(() => { topoRef.current?.scrollIntoView({ block: 'start' }) }, [etapa])

  const porEtapa = new Map(execucao.etapas.map(e => [e.etapa, e]))
  const atual = porEtapa.get(etapa)
  // Estado atual (20261003100000): o retrato da pasta, sempre registrado arquivo por arquivo.
  const estadoAtual = ehEstadoAtual(execucao.id)
  const comRegistro = (estadoAtual || registraArquivos(execucao.versao)) && !erroResumo
  const precisaRegistro = etapa === 'listar' || etapa === 'classificar' || etapa === 'planilhas'
  const vazio = comRegistro && resumo && resumo.total === 0 && (resumo.por_tipo.removido ?? 0) === 0
  const hero = useCountUp(resumo?.total ?? 0)
  const listar = (porEtapa.get('listar')?.detalhe ?? {}) as Record<string, string | number>
  const pastas = estadoAtual ? (resumo?.pastas.total ?? 0) : Number(listar.pastas ?? 0)

  return (
    <Drawer
      title="O que o robô leu"
      subtitle={estadoAtual
        ? <>O que está na pasta agora · retrato da leitura de {dataHora(execucao.iniciado_em)}</>
        : <>{dataHora(execucao.iniciado_em)} · {GATILHOS[execucao.gatilho]}{execucao.solicitado_por_nome ? ` por ${execucao.solicitado_por_nome}` : ''}{execucao.modo !== 'producao' ? ` · ${MODOS[execucao.modo]}` : ''}</>}
      width="min(1320px, 96vw)"
      zIndex={zIndex}
      onClose={onClose}
    >
      {/* Modais abertos de dentro do painel (arquivo) ficam uma camada acima dele. */}
      <CamadaModal.Provider value={zIndex + 10}>
      <div className="tema-robo">
      <div ref={topoRef} className="-mt-4 h-0" aria-hidden />

      {/* Resumo da execução */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#3aaa5c,#2A92C0)' }} />
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {estadoAtual ? 'Na pasta agora' : listar.leitura === 'completa' ? 'Leitura completa' : 'Só o que mudou'}
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-black leading-none tabular-nums text-foreground sm:text-5xl">{numero(Math.round(hero))}</span>
              <span className="text-xs font-semibold text-muted-foreground">{estadoAtual ? 'arquivo(s) na pasta' : 'arquivo(s) lido(s)'}</span>
            </p>
          </div>
          <div className="flex divide-x divide-border">
            <Metrica valor={pastas} rotulo="pastas" />
            {simples && estadoAtual && <Metrica valor={resumo?.por_tipo.evidencia ?? 0} rotulo="evidências" />}
            {!simples && <Metrica valor={resumo?.por_tipo.evidencia ?? 0} rotulo="evidências" />}
            {!simples && <Metrica valor={execucao.resumo?.sugeridos ?? 0} rotulo="sugestões" />}
            {!simples && <Metrica valor={execucao.duracao_ms ?? 0} rotulo="no total" formato={n => segundos(n)} />}
          </div>
        </div>
      </section>

      {/* Trilho das etapas (fora da tela PEP) */}
      {!simples && (
      <div className="sticky -top-4 z-10 -mx-5 mb-5 bg-card px-5 py-2">
        <div role="tablist" aria-label="Etapas da execução" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1">
          {ETAPAS.map(({ etapa: nome, rotulo }, i) => {
            const e = porEtapa.get(nome)
            const ativo = etapa === nome
            const Icone = e?.status === 'erro' ? X : e?.status === 'concluida' ? Check : Circle
            const cor = e?.status === 'erro' ? 'text-rose-600 dark:text-rose-400' : e?.status === 'concluida' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/40'
            return (
              <button key={nome} type="button" role="tab" aria-selected={ativo} onClick={() => setEtapa(nome)}
                className={`flex min-h-11 min-w-[9rem] flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ativo ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${ativo ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{rotulo}</span>
                  <span className="flex items-center gap-1 text-[11px] tabular-nums">
                    <Icone className={`h-3 w-3 ${cor}`} aria-hidden />{segundos(e?.duracao_ms, 2)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      )}

      <div role="tabpanel" aria-label={ETAPAS.find(e => e.etapa === etapa)?.rotulo}>
        {atual?.status === 'erro' && (
          <div className="mb-5">
            <Aviso tom="atencao">Esta etapa falhou: {String((atual.detalhe as { erro?: string } | null)?.erro ?? execucao.erro ?? 'erro desconhecido')}</Aviso>
          </div>
        )}

        {etapa === 'autenticar' && <AbaAutenticar execucao={execucao} etapa={atual} />}

        {etapa !== 'autenticar' && !resumo && <p className="text-sm text-muted-foreground">Carregando o que foi lido…</p>}

        {resumo && precisaRegistro && !comRegistro && (
          <Aviso>
            {erroResumo
              ? 'Não foi possível carregar o registro por arquivo. O banco já tem a atualização de 01/10/2026 (migration 20261001130000)?'
              : 'Esta execução foi feita por uma versão do robô que ainda não registrava arquivo por arquivo. Os totais estão nos cards.'}
            {ultimaCompleta && ultimaCompleta.id !== execucao.id && onAbrirExecucao && (
              <BotaoUltima e={ultimaCompleta} onClick={() => onAbrirExecucao(ultimaCompleta, etapa)} />
            )}
          </Aviso>
        )}

        {resumo && precisaRegistro && comRegistro && vazio && estadoAtual && (
          <Aviso>Não há nenhum arquivo nas pastas dos prestadores agora.</Aviso>
        )}

        {resumo && precisaRegistro && comRegistro && vazio && !estadoAtual && (
          <Aviso>
            Nada mudou no SharePoint desde a leitura anterior, então esta execução não precisou ler nenhum arquivo. É o normal no dia a dia.
            {ultimaCompleta && ultimaCompleta.id !== execucao.id && onAbrirExecucao && (
              <BotaoUltima e={ultimaCompleta} onClick={() => onAbrirExecucao(ultimaCompleta, etapa)} />
            )}
          </Aviso>
        )}

        {resumo && comRegistro && !vazio && etapa === 'listar' && <AbaListar execucao={execucao} etapa={atual} resumo={resumo} competencia={competencia} simples={simples} />}
        {resumo && comRegistro && !vazio && etapa === 'classificar' && <AbaClassificar execucao={execucao} resumo={resumo} />}
        {resumo && comRegistro && !vazio && etapa === 'planilhas' && <AbaPlanilhas execucao={execucao} etapa={atual} resumo={resumo} />}
        {resumo && etapa === 'enviar' && <AbaReconhecer execucao={execucao} etapa={atual} ehUltima={ehUltima} />}
      </div>
      </div>
      </CamadaModal.Provider>
    </Drawer>
  )
}

function BotaoUltima({ e, onClick }: { e: RoboExecucao; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="mt-3 flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <History className="h-4 w-4" aria-hidden />
      Abrir a última leitura completa ({dataHora(e.iniciado_em)})
    </button>
  )
}
