'use client'

import { useRef, useState } from 'react'
import { FileCheck2, FileMinus2, Files, FileSpreadsheet, FileWarning, Grid3x3, ListChecks } from 'lucide-react'
import { ITENS_PEP, numero, rotuloMotivo } from '@/lib/roboSharepoint/rotulos'
import type { ResumoExecucao, RoboExecucao, TipoArquivoLido } from '@/types/roboSharepoint'
import { Bloco, Ladrilho, Ladrilhos, Lead, LinhaRanking, Sigla } from './Blocos'
import { ListaArquivos, type FiltroArquivos } from './ListaArquivos'
import { MatrizEvidencias, type CelulaEscolhida } from './MatrizEvidencias'

// Classificar = decidir o que cada arquivo É, só pelo caminho de pastas:
// evidência de qual item do PEP, planilha de planejamento, ou algo que o PEP
// não usa. Ladrilhos e linhas filtram a lista do fim.

export function AbaClassificar({ execucao, resumo }: { execucao: RoboExecucao; resumo: ResumoExecucao }) {
  const [filtro, setFiltro] = useState<FiltroArquivos>({})
  const listaRef = useRef<HTMLDivElement>(null)
  const t = resumo.por_tipo
  // A célula da matriz é só outra forma de escrever o filtro.
  const celula: CelulaEscolhida | null = filtro.prestadorPastaId && filtro.sigla
    ? { prestadorPastaId: filtro.prestadorPastaId, pacientePastaId: filtro.pacientePastaId ?? null, sigla: filtro.sigla, rotulo: filtro.rotulo ?? '' }
    : null
  const maxSigla = Math.max(...ITENS_PEP.map(i => resumo.por_sigla[i.sigla] ?? 0), 1)
  const maxMotivo = Math.max(...resumo.motivos.map(m => m.n), 1)
  const alvoTipo = filtro.sigla || filtro.motivo ? null : filtro.tipo ?? null
  const escolherTipo = (tipo: TipoArquivoLido, rotulo: string) =>
    setFiltro(alvoTipo === tipo ? {} : { tipo, rotulo })

  return (
    <div className="space-y-5">
      <Lead>
        Dos <strong className="font-semibold text-foreground">{numero(resumo.total)} arquivos</strong>,{' '}
        <strong className="font-semibold text-foreground">{numero(t.evidencia ?? 0)}</strong> estão numa pasta de item do PEP e contam como evidência,{' '}
        {numero(t.planilha ?? 0)} são planilhas de planejamento e {numero((t.ignorado ?? 0) + (t.fora_padrao ?? 0))} ficaram de fora.
        A decisão vem do caminho de pastas; nenhum documento é aberto.
      </Lead>

      <Ladrilhos>
        <Ladrilho icone={FileCheck2} tom="blue" valor={t.evidencia ?? 0} rotulo="evidências"
          ativo={alvoTipo === 'evidencia'} apagado={!!alvoTipo && alvoTipo !== 'evidencia'} onClick={() => escolherTipo('evidencia', 'Evidências')} />
        <Ladrilho icone={FileSpreadsheet} tom="gray" valor={t.planilha ?? 0} rotulo="planilhas"
          ativo={alvoTipo === 'planilha'} apagado={!!alvoTipo && alvoTipo !== 'planilha'} onClick={() => escolherTipo('planilha', 'Planilhas')} />
        <Ladrilho icone={FileMinus2} tom="gray" valor={t.ignorado ?? 0} rotulo="fora do PEP" sub="o robô ignora, como deve"
          ativo={alvoTipo === 'ignorado'} apagado={!!alvoTipo && alvoTipo !== 'ignorado'} onClick={() => escolherTipo('ignorado', 'Fora do PEP')} />
        <Ladrilho icone={FileWarning} tom="amber" valor={t.fora_padrao ?? 0} rotulo="fora do padrão" sub="precisam de revisão"
          ativo={alvoTipo === 'fora_padrao'} apagado={!!alvoTipo && alvoTipo !== 'fora_padrao'} onClick={() => escolherTipo('fora_padrao', 'Fora do padrão')} />
      </Ladrilhos>

      <Bloco icone={Grid3x3} titulo="As evidências no formato da PEP"
        subtitulo="por prestador: pacientes nas linhas, itens nas colunas; toque num número para ver os arquivos"
        contagem={`${numero(t.evidencia ?? 0)} evidências`}>
        <MatrizEvidencias
          execucaoId={execucao.id}
          escolhida={celula}
          onEscolher={c => {
            setFiltro(c ? { tipo: 'evidencia', sigla: c.sigla, prestadorPastaId: c.prestadorPastaId, pacientePastaId: c.pacientePastaId, rotulo: c.rotulo } : {})
            if (c) setTimeout(() => listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
          }}
        />
      </Bloco>

      <Bloco icone={ListChecks} titulo="Evidências por item do PEP" subtitulo="a subpasta define o item" contagem={`${numero(t.evidencia ?? 0)} evidências`}>
        <div className="space-y-0.5">
          {ITENS_PEP.map(i => (
            <LinhaRanking
              key={i.sigla}
              marca={<Sigla sigla={i.sigla} />}
              rotulo={i.nome}
              detalhe={i.onde}
              n={resumo.por_sigla[i.sigla] ?? 0}
              max={maxSigla}
              tom="blue"
              ativa={!celula && filtro.sigla === i.sigla}
              apagada={!celula && !!filtro.sigla && filtro.sigla !== i.sigla}
              onClick={() => setFiltro(filtro.sigla === i.sigla ? {} : { tipo: 'evidencia', sigla: i.sigla, rotulo: `${i.sigla} · ${i.nome}` })}
            />
          ))}
        </div>
      </Bloco>

      {resumo.motivos.length > 0 && (
        <Bloco icone={FileMinus2} titulo="Por que ficaram de fora" subtitulo="fora do PEP é esperado; fora do padrão pede revisão">
          <div className="space-y-0.5">
            {resumo.motivos.map(m => (
              <LinhaRanking
                key={`${m.tipo}-${m.motivo}`}
                rotulo={rotuloMotivo(m.motivo)}
                detalhe={m.tipo === 'fora_padrao' ? 'fora do padrão de pastas' : 'fora do PEP'}
                n={m.n}
                max={maxMotivo}
                tom={m.tipo === 'fora_padrao' ? 'amber' : 'gray'}
                ativa={filtro.motivo === m.motivo}
                apagada={!!filtro.motivo && filtro.motivo !== m.motivo}
                onClick={() => setFiltro(filtro.motivo === m.motivo ? {} : { tipo: m.tipo, motivo: m.motivo, rotulo: rotuloMotivo(m.motivo) })}
              />
            ))}
          </div>
        </Bloco>
      )}

      <Bloco icone={Files} titulo="Arquivos" subtitulo="a lista acompanha o que estiver selecionado acima">
        <div ref={listaRef} className="scroll-mt-24" />
        <ListaArquivos
          execucaoId={execucao.id}
          filtro={filtro}
          contagens={{ ...t, total: resumo.total + (t.removido ?? 0) }}
          onLimparFiltro={() => setFiltro({})}
        />
      </Bloco>
    </div>
  )
}
