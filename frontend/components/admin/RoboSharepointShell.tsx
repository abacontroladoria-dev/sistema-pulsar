'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, CalendarClock, CheckCircle2, ChevronDown, ClipboardList, FlaskConical, Gauge, History, Loader2, Play, ShieldCheck, TriangleAlert, Wrench, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

import { useHeader } from '@/contexts/HeaderContext'
import { ComoFunciona, OQueEnxergaEComoDecide } from '@/components/admin/roboSharepoint/ComoFunciona'
import { EntregaAutomatica } from '@/components/admin/roboSharepoint/EntregaAutomatica'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import { LinhaDoTempo } from '@/components/admin/roboSharepoint/LinhaDoTempo'
import { DestaqueLeitura } from '@/components/admin/roboSharepoint/DestaqueLeitura'
import { HistoricoExecucoes } from '@/components/admin/roboSharepoint/HistoricoExecucoes'
import { FilaNaoReconhecidos, resumoPendencias } from '@/components/admin/roboSharepoint/FilaNaoReconhecidos'
import { CustoExecucao } from '@/components/admin/roboSharepoint/CustoExecucao'
import { HistoricoCompletoDrawer } from '@/components/admin/roboSharepoint/HistoricoCompletoDrawer'
import { DetalheExecucaoDrawer } from '@/components/admin/roboSharepoint/detalhe/DetalheExecucaoDrawer'
import { useRoboSharepoint } from '@/hooks/useRoboSharepoint'
import { dataHora, GATILHOS, haQuanto } from '@/lib/roboSharepoint/rotulos'
import { executarAgora } from '@/services/roboSharepoint.service'
import type { RoboEtapaNome, RoboExecucao, RoboSaude } from '@/types/roboSharepoint'

// Painel do robô SharePoint → PEP (plano de 30/09/2026).
//
// Responde três perguntas, nesta ordem:
//   1. O que o robô leu e encontrou?          → estado + resultado etapa por etapa (ao vivo enquanto roda)
//   2. Quanto isso custou ao Pulsar?          → tempo total, tempo no banco, chamadas
//   3. O que ficou para uma pessoa resolver?  → "O que precisa de você" (tarefas)
//
// Só admin e diretoria (código `robo_sharepoint`). O robô em si não tem porta
// pública: "Executar agora" passa pela rota do servidor, que fala com ele na
// rede interna do Coolify.

const cartao = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6'

function Titulo({ icone: Icone, children, extra }: { icone: typeof Bot; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
        <Icone className="h-4 w-4 text-brand-fg" aria-hidden /> {children}
      </h2>
      {extra}
    </div>
  )
}

function EstadoAgora({ saude, ultima }: { saude: RoboSaude | null; ultima: RoboExecucao | null }) {
  const executando = ultima?.status === 'executando' || saude?.executando
  let rotulo = 'Aguardando o próximo horário'
  let cor = 'bg-slate-100 text-slate-600'
  let Icone = CalendarClock
  if (saude && !saude.configurado) { rotulo = 'Não configurado neste ambiente'; cor = 'bg-slate-100 text-slate-600'; Icone = TriangleAlert }
  else if (saude && saude.online === false) { rotulo = 'Robô fora do ar'; cor = 'bg-rose-50 text-rose-700'; Icone = XCircle }
  else if (saude?.erro_fatal) { rotulo = 'Parado por erro de configuração'; cor = 'bg-rose-50 text-rose-700'; Icone = XCircle }
  else if (executando) { rotulo = 'Executando agora'; cor = 'bg-sky-50 text-sky-700'; Icone = Loader2 }
  else if (ultima?.status === 'erro') { rotulo = 'Última execução falhou'; cor = 'bg-rose-50 text-rose-700'; Icone = XCircle }
  else if (ultima?.status === 'concluido') { rotulo = 'Em dia'; cor = 'bg-emerald-50 text-emerald-700'; Icone = CheckCircle2 }

  const dias = saude?.certificado_dias_restantes ?? ultima?.certificado?.diasRestantes ?? null

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-brand-surface p-2.5"><Bot className="h-6 w-6 text-brand-fg" aria-hidden /></div>
        <div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cor}`} aria-live="polite">
            <Icone className={`h-3.5 w-3.5 ${executando ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> {rotulo}
          </span>
          {saude?.modo === 'homologacao' && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Homologação: só a pasta de teste
            </span>
          )}
          {saude?.erro_fatal && <p className="mt-1 text-xs text-rose-700">{saude.erro_fatal}</p>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Última execução</dt>
          <dd className="font-semibold text-slate-800">{ultima ? haQuanto(ultima.iniciado_em) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Execução</dt>
          <dd className="font-semibold text-slate-800">
            Diariamente, às 03:00 (GMT-3)
            {saude?.proxima && <span className="block text-xs font-normal text-slate-500">próxima: {dataHora(saude.proxima)}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Certificado</dt>
          <dd className={`font-semibold ${dias != null && dias < 30 ? 'text-amber-700' : 'text-slate-800'}`}>
            {dias != null ? `vence em ${dias} dias` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function RoboSharepointShell() {
  const { execucoes, pendencias, itensPresos, saude, carregando, erro, carregarPendencias, carregarSaude } = useRoboSharepoint()
  const { role } = useUsuarioAtual()
  const [pedindo, setPedindo] = useState(false)
  const [historicoAberto, setHistoricoAberto] = useState(false)
  // "Informações técnicas" nasce recolhido: só aparece quando a pessoa expande.
  const [tecnicoAberto, setTecnicoAberto] = useState(false)
  const [detalhe, setDetalhe] = useState<{ execucao: RoboExecucao; etapa: RoboEtapaNome } | null>(null)

  const ultima = execucoes[0] ?? null
  const ultimaConcluida = execucoes.find(e => e.status !== 'executando') ?? null
  // A "situação de agora" do reconhecimento é a da última execução que gravou (não simulada).
  const idUltimaGravada = execucoes.find(e => e.status === 'concluido' && e.modo !== 'simulacao')?.id ?? null
  // Última leitura do site inteiro já registrada arquivo por arquivo (robô 0.2+).
  const ultimaCompleta = execucoes.find(e => e.status === 'concluido'
    && (e.etapas.find(x => x.etapa === 'listar')?.detalhe as { leitura?: string } | null)?.leitura === 'completa'
    && !/^0\.[01]\./.test(e.versao ?? '0.0.')) ?? null
  const executando = ultima?.status === 'executando'
  const podeExecutar = !!saude?.configurado && saude.online !== false && !saude.erro_fatal && !executando

  const pedirExecucao = useCallback(async () => {
    setPedindo(true)
    try {
      await executarAgora()
      toast.success('Pedido enviado. Acompanhe a linha do tempo.')
      carregarSaude()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível pedir a execução')
    } finally {
      setPedindo(false)
    }
  }, [carregarSaude])

  // Título e "Executar agora" vão para o cabeçalho do layout, como nas outras
  // telas: ele reserva o canto direito (pr-20) para o sino de alertas, que é
  // fixo. Dentro da página, o botão ficava por baixo do sino.
  const { setHeader, setRightContent } = useHeader()
  useEffect(() => {
    setHeader('Robô SharePoint', 'Lê o repositório de documentos dos prestadores e marca as entregas na tela Entregas PEP')
    return () => { setHeader('', ''); setRightContent(null) }
  }, [setHeader, setRightContent])

  const configurado = !!saude?.configurado
  useEffect(() => {
    setRightContent(
      <button
        type="button"
        onClick={pedirExecucao}
        disabled={!podeExecutar || pedindo}
        title={!configurado ? 'O robô ainda não está configurado neste ambiente' : undefined}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {pedindo || executando ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {executando ? 'Executando…' : 'Executar agora'}
      </button>,
    )
  }, [setRightContent, pedirExecucao, podeExecutar, pedindo, executando, configurado])

  return (
    <div className="space-y-6">

      {erro && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{erro}</p>}

      {/* 1ª coisa da página: o resultado da leitura do SharePoint, sem o
          tempo da etapa (esse fica na linha do tempo, em Informações técnicas). */}
      {!carregando && <DestaqueLeitura execucao={ultima} onAbrir={etapa => ultima && setDetalhe({ execucao: ultima, etapa })} />}

      <section className={cartao}>
        {carregando ? <p className="text-sm text-slate-500">Carregando…</p> : <EstadoAgora saude={saude} ultima={ultima} />}
      </section>

      <EntregaAutomatica ehAdmin={role === 'admin'} />

      <ComoFunciona />

      <OQueEnxergaEComoDecide />

      <section className={cartao}>
        <Titulo icone={ClipboardList} extra={<span className="text-xs text-slate-500">{resumoPendencias(pendencias, itensPresos)}</span>}>
          O que precisa de você
        </Titulo>
        <FilaNaoReconhecidos fila={pendencias} itens={itensPresos} onAtualizar={carregarPendencias} />
      </section>

      {/* Informações técnicas: o detalhe para quem acompanha o robô. Só muda a
          posição destas três seções; conteúdo, botões e drawers são os mesmos. */}
      <section className="space-y-4 border-t border-slate-200 pt-6" aria-labelledby="titulo-tecnico">
        <button
          type="button"
          onClick={() => setTecnicoAberto(a => !a)}
          aria-expanded={tecnicoAberto}
          aria-controls="conteudo-tecnico"
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:px-6"
        >
          <span className="min-w-0">
            <span id="titulo-tecnico" className="flex items-center gap-2 text-base font-bold text-slate-800">
              <Wrench className="h-4 w-4 text-brand-fg" aria-hidden /> Informações técnicas
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">Resultado da última leitura, custo para o Pulsar e últimas 30 execuções</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-fg">
            {tecnicoAberto ? 'Recolher' : 'Mostrar'}
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${tecnicoAberto ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>

        {tecnicoAberto && (
        <div id="conteudo-tecnico" className="space-y-4">
        <section className={cartao} aria-labelledby="titulo-linha">
          <Titulo icone={Gauge} extra={ultima && (
            <span className="text-xs text-slate-500">
              {dataHora(ultima.iniciado_em)} · {GATILHOS[ultima.gatilho]}{ultima.solicitado_por_nome ? ` por ${ultima.solicitado_por_nome}` : ''}
            </span>
          )}>
            <span id="titulo-linha">{executando ? 'O robô está lendo agora' : 'Resultado da última leitura'}</span>
          </Titulo>
          <LinhaDoTempo execucao={ultima} onAbrir={etapa => ultima && setDetalhe({ execucao: ultima, etapa })} />
        </section>

        <section className={cartao}>
          <Titulo icone={ShieldCheck} extra={
            <div className="flex flex-wrap items-center gap-3">
              {ultimaConcluida && <span className="text-xs text-slate-500">execução de {dataHora(ultimaConcluida.iniciado_em)}</span>}
              <button type="button" onClick={() => setHistoricoAberto(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><History className="h-4 w-4" aria-hidden /> Custo de todas as execuções</button>
            </div>
          }>Custo para o Pulsar</Titulo>
          <CustoExecucao execucao={ultimaConcluida} />
        </section>

        <section className={cartao}>
          <Titulo icone={History} extra={<button type="button" onClick={() => setHistoricoAberto(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><History className="h-4 w-4" aria-hidden /> Histórico completo</button>}>Últimas 30 execuções</Titulo>
          <HistoricoExecucoes execucoes={execucoes} />
        </section>
        </div>
        )}
      </section>

      {historicoAberto && <HistoricoCompletoDrawer idUltimaGravada={idUltimaGravada} ultimaCompleta={ultimaCompleta} onClose={() => setHistoricoAberto(false)} />}
      {detalhe && (
        <DetalheExecucaoDrawer
          execucao={execucoes.find(e => e.id === detalhe.execucao.id) ?? detalhe.execucao}
          etapaInicial={detalhe.etapa}
          ehUltima={detalhe.execucao.id === idUltimaGravada}
          ultimaCompleta={ultimaCompleta}
          onAbrirExecucao={(execucao, etapa) => setDetalhe({ execucao, etapa })}
          onClose={() => setDetalhe(null)}
        />
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        O robô só lê um site do SharePoint (permissão Sites.Selected, papel leitura), entra com certificado e fala com o
        Pulsar por um token próprio, revogável. Com a entrega automática ligada, ele marca a entrega de quem segue o padrão de
        nome (em roxo, na tela Entregas PEP); o RP desfaz quando ele errar, e tudo fica no histórico.
      </p>
    </div>
  )
}
