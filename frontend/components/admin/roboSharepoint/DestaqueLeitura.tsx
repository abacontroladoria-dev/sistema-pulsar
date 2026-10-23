'use client'

import type { ReactNode } from 'react'
import { ArrowRight, Bot, Camera, Clock, FileCheck2, FileText, FolderSearch, FolderTree, Loader2, RefreshCw, ScanSearch, TriangleAlert } from 'lucide-react'
import { aviso, btnSecundario, selo } from '@/components/cronograma/grade/estilo'
import type { Tone } from '@/components/cronograma/ui/tones'
import { CabecalhoSecao, Cartao, Indicador } from '@/components/ui/padrao'
import { dataHora, haQuanto, numero } from '@/lib/roboSharepoint/rotulos'
import type { ResumoExecucao, RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'

// O topo do painel: "O que o robô encontrou no SharePoint". É a 1ª coisa que
// se vê ao entrar (pedido de 02/10/2026), então fala de RESULTADO e não de
// desempenho: o tempo de cada etapa fica em "Informações técnicas".
//
// Desde 20261003100000 (pedido de 02/10/2026: "o que preciso saber é o que
// ESTÁ NA PASTA agora, não o que mudou"), com `estadoAtual` os números são o
// retrato da pasta — todos os arquivos, todos os prestadores — e "Ver o que
// foi lido" abre esse retrato. Sem a migration, volta ao de antes: o que a
// última execução leu.

function BotaoVer({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${btnSecundario} min-h-11 sm:min-h-0`}
    >
      <FolderSearch className="h-4 w-4" aria-hidden />
      Ver o que foi lido
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
    </button>
  )
}

function Estado({ tone, Icone, gira = false, children }: { tone: Tone; Icone: typeof FileText; gira?: boolean; children: ReactNode }) {
  return (
    <div className={aviso(tone)}>
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${gira ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      <p>{children}</p>
    </div>
  )
}

export function DestaqueLeitura({ execucao, estadoAtual, retratoDe, painelEsperadas, onAbrir }: {
  execucao: RoboExecucao | null
  /** O que está na pasta agora (sp_pep_resumo_execucao(NULL)). Ausente = migration pendente. */
  estadoAtual?: ResumoExecucao | null
  /** Leitura que tirou o retrato (a última concluída). */
  retratoDe?: RoboExecucao | null
  /** Painel das evidências esperadas × na pasta (PainelEsperadas). Ausente = sem Grade do mês. */
  painelEsperadas?: ReactNode
  onAbrir: (etapa: RoboEtapaNome) => void
}) {
  const etapa = execucao?.etapas.find(e => e.etapa === 'listar')
  const d = (etapa?.detalhe ?? null) as Record<string, unknown> | null
  const n = (k: string) => (d && typeof d[k] === 'number' ? (d[k] as number) : null)
  const arquivos = n('arquivos_novos_ou_alterados')
  const pastas = n('pastas')
  const completa = d?.leitura === 'completa'
  const erro = d && typeof d.erro === 'string' ? d.erro : null
  const lendo = execucao?.status === 'executando' && etapa?.status !== 'concluida'
  const pronta = etapa?.status === 'concluida' && !erro
  const atual = estadoAtual ?? null
  const quando = retratoDe ?? execucao

  if (atual && !lendo) {
    return (
      <Cartao titulo="titulo-destaque">
        <CabecalhoSecao
          id="titulo-destaque"
          titulo="O que está no SharePoint agora"
          Icone={FolderTree}
          apoio={quando ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden /> retrato de {haQuanto(quando.iniciado_em)}</span> : undefined}
          ajuda={[
            { tone: 'blue', Icone: Camera, texto: 'É o retrato da pasta: todos os arquivos de todos os prestadores.' },
            ...(quando ? [{ tone: 'slate' as const, Icone: Clock, texto: `Retrato da leitura de ${dataHora(quando.iniciado_em)}.` }] : []),
            { tone: 'purple', Icone: Bot, texto: 'O robô lê o site toda noite, às 03:00, ou em “Executar agora”.' },
          ]}
          rotuloAjuda="O que é este retrato?"
          direita={<BotaoVer onClick={() => onAbrir('listar')} />}
        />

        <div className={`grid gap-4 ${painelEsperadas ? 'xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xl:items-start' : ''}`}>
          <div className={`grid gap-3 ${painelEsperadas ? 'sm:grid-cols-3 xl:grid-cols-1' : 'sm:grid-cols-3'}`}>
            <Indicador Icone={FileText} valor={numero(atual.total)} rotulo={atual.total === 1 ? 'Arquivo na pasta' : 'Arquivos na pasta'} />
            <Indicador
              tone="green"
              Icone={FileCheck2}
              valor={numero(atual.por_tipo.evidencia ?? 0)}
              rotulo="Evidências na pasta"
              apoio="todos os meses, qualquer nome"
              title="De todos os meses e profissionais, com qualquer nome"
            />
            <Indicador Icone={FolderTree} valor={numero(atual.pastas.total)} rotulo="Pastas no site" apoio="prestadores, seções e pacientes" />
          </div>

          {painelEsperadas}
        </div>
      </Cartao>
    )
  }

  return (
    <Cartao titulo="titulo-destaque">
      <CabecalhoSecao
        id="titulo-destaque"
        titulo="O que o robô encontrou no SharePoint"
        Icone={FolderTree}
        apoio={execucao
          ? (lendo ? 'lendo o site agora…' : <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden /> leitura de {dataHora(execucao.iniciado_em)} · {haQuanto(execucao.iniciado_em)}</span>)
          : 'O robô ainda não leu o site.'}
        direita={pronta ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={selo('slate')}>
              {completa ? <ScanSearch className="h-3 w-3" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
              {completa ? 'leitura completa' : 'só o que mudou'}
            </span>
            <BotaoVer onClick={() => onAbrir('listar')} />
          </div>
        ) : undefined}
      />

      {lendo ? (
        <div aria-live="polite">
          <Estado tone="slate" Icone={Loader2} gira>O robô está percorrendo as pastas. Os números aparecem assim que esta etapa terminar.</Estado>
        </div>
      ) : erro ? (
        <Estado tone="red" Icone={TriangleAlert}>A leitura do SharePoint falhou: {erro}</Estado>
      ) : pronta ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Indicador
            Icone={FileText}
            valor={numero(arquivos)}
            rotulo={arquivos === 1 ? 'Arquivo novo ou alterado' : 'Arquivos novos ou alterados'}
            apoio={arquivos === 0 ? 'nada mudou desde a leitura anterior' : undefined}
            apagado={arquivos === 0}
          />
          <Indicador Icone={FolderTree} valor={numero(pastas)} rotulo="Pastas no site" apoio="prestadores, seções e pacientes" />
        </div>
      ) : (
        <Estado tone="slate" Icone={FolderTree}>
          {execucao ? 'Esta execução não chegou a ler o SharePoint.' : 'Quando o robô rodar, aqui aparecem quantos arquivos novos ou alterados e quantas pastas ele encontrou.'}
        </Estado>
      )}
    </Cartao>
  )
}
