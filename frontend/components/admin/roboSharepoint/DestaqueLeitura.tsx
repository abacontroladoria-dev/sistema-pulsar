'use client'

import { ArrowRight, Bot, Camera, Clock, FileCheck2, FileText, FolderSearch, FolderTree, Loader2, RefreshCw, ScanSearch, TriangleAlert } from 'lucide-react'
import { CabecalhoPastel, NumeroPastel, SecaoPastel, tom, type Tom } from '@/components/ui/pastel/pecas'
import { dataHora, haQuanto, numero } from '@/lib/roboSharepoint/rotulos'
import type { ReactNode } from 'react'
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

// Visual pastel (docs/PLANO_PEP_VISUAL_PASTEL.md, fase 1): sem a faixa
// degradê; três números em cartão e a porta para a lista como cartão de ação.

/**
 * Grande e convidativo (pedido de 02/10/2026): é a porta para a lista dos
 * arquivos. Aço pastel cheio, texto escuro — legível no claro e no escuro.
 */
function BotaoVer({ onClick, sub }: { onClick: () => void; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${tom('aco')} group flex min-h-[76px] w-full items-center gap-4 rounded-[24px] bg-[var(--c)] px-5 py-3 text-left text-[var(--c-sobre)] shadow-[var(--pp-sombra-alta)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-[var(--c-forte)] active:scale-[.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--pp-surface)] text-[var(--c-tinta)]">
        <FolderSearch className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[17px] font-extrabold leading-tight">Ver o que foi lido</span>
        <span className="mt-0.5 block text-[13px] font-bold opacity-80">{sub}</span>
      </span>
      <ArrowRight className="ml-auto h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden />
    </button>
  )
}

function Estado({ t, Icone, gira = false, children }: { t: Tom; Icone: typeof FileText; gira?: boolean; children: ReactNode }) {
  return (
    <div className={`${tom(t)} flex items-center gap-3 rounded-[20px] bg-[var(--c-suave)] p-5 text-sm font-semibold text-[var(--c-tinta)] shadow-[inset_0_0_0_1px_var(--c-linha)]`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--c)] text-[var(--c-sobre)]">
        <Icone className={`h-5 w-5 ${gira ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      </span>
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
      <SecaoPastel titulo="titulo-destaque">
        <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-start @4xl:justify-between">
          <CabecalhoPastel
            id="titulo-destaque"
            titulo="O que está no SharePoint agora"
            t="aco"
            Icone={FolderTree}
            apoio={quando ? <><Clock className="h-3.5 w-3.5" aria-hidden /> retrato de {haQuanto(quando.iniciado_em)}</> : undefined}
            ajuda={[
              { t: 'aco', Icone: Camera, texto: 'É o retrato da pasta: todos os arquivos de todos os prestadores.' },
              ...(quando ? [{ t: 'cinza' as Tom, Icone: Clock, texto: `Retrato da leitura de ${dataHora(quando.iniciado_em)}.` }] : []),
              { t: 'robo', Icone: Bot, texto: 'O robô lê o site toda noite, às 03:00, ou em “Executar agora”.' },
            ]}
            rotuloAjuda="O que é este retrato?"
          />
          <div className="@4xl:w-[24rem] @4xl:shrink-0">
            <BotaoVer onClick={() => onAbrir('listar')} sub="prestador por prestador" />
          </div>
        </div>

        <div className={`grid gap-4 ${painelEsperadas ? '@4xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] @4xl:items-start' : ''}`}>
          <div className={`grid gap-3 ${painelEsperadas ? '@xl:grid-cols-3 @4xl:grid-cols-1' : '@xl:grid-cols-3'}`}>
            <NumeroPastel compacto t="aco" Icone={FileText} valor={numero(atual.total)} rotulo={atual.total === 1 ? 'arquivo na pasta' : 'arquivos na pasta'} />
            <NumeroPastel compacto t="verde" Icone={FileCheck2} valor={numero(atual.por_tipo.evidencia ?? 0)} rotulo="evidências na pasta"
              apoio="todos os meses, qualquer nome" title="De todos os meses e profissionais, com qualquer nome" />
            <NumeroPastel compacto t="cinza" Icone={FolderTree} valor={numero(atual.pastas.total)} rotulo="pastas no site" apoio="prestadores, seções e pacientes" />
          </div>

          {painelEsperadas}
        </div>
      </SecaoPastel>
    )
  }

  return (
    <SecaoPastel titulo="titulo-destaque">
      <CabecalhoPastel
        id="titulo-destaque"
        titulo="O que o robô encontrou no SharePoint"
        t="aco"
        Icone={FolderTree}
        apoio={execucao
          ? (lendo ? 'lendo o site agora…' : <><Clock className="h-3.5 w-3.5" aria-hidden /> leitura de {dataHora(execucao.iniciado_em)} · {haQuanto(execucao.iniciado_em)}</>)
          : 'O robô ainda não leu o site.'}
        direita={pronta ? (
          <span className={`${tom('aco')} pp-selo`}>
            {completa ? <ScanSearch className="h-3.5 w-3.5" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            {completa ? 'leitura completa' : 'só o que mudou'}
          </span>
        ) : undefined}
      />

      {lendo ? (
        <div aria-live="polite">
          <Estado t="aco" Icone={Loader2} gira>O robô está percorrendo as pastas. Os números aparecem assim que esta etapa terminar.</Estado>
        </div>
      ) : erro ? (
        <Estado t="vermelho" Icone={TriangleAlert}>A leitura do SharePoint falhou: {erro}</Estado>
      ) : pronta ? (
        <div className="space-y-3">
          <div className="grid gap-3 @xl:grid-cols-2">
            <NumeroPastel t="aco" Icone={FileText} valor={numero(arquivos)} rotulo={arquivos === 1 ? 'arquivo novo ou alterado' : 'arquivos novos ou alterados'}
              apoio={arquivos === 0 ? 'nada mudou desde a leitura anterior' : undefined} apagado={arquivos === 0} />
            <NumeroPastel t="cinza" Icone={FolderTree} valor={numero(pastas)} rotulo="pastas no site" apoio="prestadores, seções e pacientes" />
          </div>
          <BotaoVer onClick={() => onAbrir('listar')} sub="as pastas e os arquivos, um por um" />
        </div>
      ) : (
        <Estado t="cinza" Icone={FolderTree}>
          {execucao ? 'Esta execução não chegou a ler o SharePoint.' : 'Quando o robô rodar, aqui aparecem quantos arquivos novos ou alterados e quantas pastas ele encontrou.'}
        </Estado>
      )}
    </SecaoPastel>
  )
}
