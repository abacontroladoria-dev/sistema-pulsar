'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, ExternalLink, FileQuestion, FileSpreadsheet, Lightbulb, Sparkles, Target, Users } from 'lucide-react'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { nomeCurtoPrestador, numero, rotuloMotivo, segundos } from '@/lib/roboSharepoint/rotulos'
import { obterPacientesDetalhe, obterSituacaoReconhecimento } from '@/services/roboSharepoint.service'
import type { PacienteDetalhe, RoboEtapa, RoboExecucao, SituacaoReconhecimento } from '@/types/roboSharepoint'
import { Aviso, Barra, Bloco, corBarra, Ladrilho, Ladrilhos, Lead, LinhaRanking, Progresso } from './Blocos'
import { CartaoSugestao } from './CartaoSugestao'
import { ListaArquivos, type FiltroArquivos } from './ListaArquivos'
import { ListaPacientes } from './ListaPacientes'

// Reconhecer = o banco ligando o que o robô leu às pessoas do Pulsar:
// pasta de prestador → CNPJ → Contratos; pasta de paciente → CPF da planilha
// → cadastro, com o nome conferido; arquivo → sessão de Coordenador de Caso
// no mês. Mostra a situação ATUAL (depois da última execução gravada).

type Foco = 'prestadores' | 'pacientes' | 'sugestoes' | 'presos' | null

export function AbaReconhecer({ execucao, etapa, ehUltima }: { execucao: RoboExecucao; etapa?: RoboEtapa; ehUltima: boolean }) {
  const [sit, setSit] = useState<SituacaoReconhecimento | null>(null)
  const [pacientes, setPacientes] = useState<PacienteDetalhe[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [foco, setFoco] = useState<Foco>(null)
  const [motivo, setMotivo] = useState<string | null>(null)
  const presosRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    obterSituacaoReconhecimento()
      .then(s => { if (vivo) setSit(s) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Erro ao carregar o reconhecimento') })
    obterPacientesDetalhe()
      .then(p => { if (vivo) setPacientes(p) })
      .catch(() => { if (vivo) setPacientes([]) })
    return () => { vivo = false }
  }, [])

  const pacientesPorPrestador = useMemo(() => {
    const m = new Map<string, SituacaoReconhecimento['pacientes']>()
    for (const p of sit?.pacientes ?? []) {
      const k = p.prestador_pasta_id ?? '—'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return m
  }, [sit])

  const d = (etapa?.detalhe ?? {}) as Record<string, number>
  const simulacao = execucao.modo === 'simulacao'
  const prestOk = (sit?.prestadores ?? []).filter(p => p.status === 'reconhecido').length
  const pacOk = (sit?.pacientes ?? []).filter(p => p.status === 'reconhecido').length
  const presos = sit?.itens_por_status?.nao_reconhecido ?? 0
  const maxMotivo = Math.max(...(sit?.itens_motivos ?? []).map(m => m.n), 1)
  const mostrar = (f: Exclude<Foco, null>) => !foco || foco === f
  const alternar = (f: Exclude<Foco, null>) => setFoco(foco === f ? null : f)

  const prestadores = useMemo(() => [...(sit?.prestadores ?? [])].sort((a, b) =>
    Number(b.status === 'reconhecido') - Number(a.status === 'reconhecido') || a.nome_pasta.localeCompare(b.nome_pasta)), [sit])

  const filtroPresos: FiltroArquivos = motivo
    ? { situacao: 'nao_reconhecido', motivoPulsar: motivo, rotulo: rotuloMotivo(motivo) }
    : { situacao: 'nao_reconhecido', rotulo: 'Não reconhecidos' }

  return (
    <div className="space-y-5">
      <Lead>
        {simulacao ? 'Nesta simulação o banco reconheceria' : 'O banco reconheceu'}{' '}
        <strong className="font-semibold text-foreground">{numero(prestOk)} de {numero(sit?.prestadores.length)} prestadores</strong> e{' '}
        <strong className="font-semibold text-foreground">{numero(pacOk)} de {numero(sit?.pacientes.length)} pastas de paciente</strong>.{' '}
        <strong className="font-semibold text-foreground">{numero(sit?.sugestoes.length)} arquivo(s)</strong> viraram sugestão para a PEP.
        Levou {segundos(etapa?.duracao_ms, 2)}, dos quais {numero(d.ms_banco ?? execucao.resumo?.ms_banco)} ms dentro do banco.
      </Lead>

      {simulacao ? (
        <Aviso>Simulação: o banco reconheceu e desfez tudo em seguida. Abaixo está a situação gravada <strong>hoje</strong>.</Aviso>
      ) : !ehUltima ? (
        <Aviso>Abaixo está a situação <strong>de hoje</strong>, depois da execução mais recente, não a desta execução.</Aviso>
      ) : null}

      {erro && <Aviso tom="atencao">{erro}</Aviso>}

      {sit && (
        <>
          <Ladrilhos>
            <Ladrilho icone={Building2} tom="green" valor={prestOk} rotulo="prestadores reconhecidos" sub={`de ${sit.prestadores.length}`}
              ativo={foco === 'prestadores'} apagado={!!foco && foco !== 'prestadores'} onClick={() => alternar('prestadores')} />
            <Ladrilho icone={Users} tom="green" valor={pacientes?.length ?? sit.pacientes.length} rotulo="pacientes" sub={`${pacOk} pastas reconhecidas`}
              ativo={foco === 'pacientes'} apagado={!!foco && foco !== 'pacientes'} onClick={() => alternar('pacientes')} />
            <Ladrilho icone={Lightbulb} tom="blue" valor={sit.sugestoes.length} rotulo="sugestões para a PEP" sub="esperando o RP"
              ativo={foco === 'sugestoes'} apagado={!!foco && foco !== 'sugestoes'} onClick={() => alternar('sugestoes')} />
            <Ladrilho icone={FileQuestion} tom="amber" valor={presos} rotulo="arquivos não reconhecidos" sub="ver os motivos"
              ativo={foco === 'presos'} apagado={!!foco && foco !== 'presos'} onClick={() => alternar('presos')} />
          </Ladrilhos>

          {!foco && (
            <Bloco icone={Target} titulo="Quanto foi reconhecido" subtitulo="o que falta quase sempre é a planilha de planejamento">
              <div className="grid gap-4 sm:grid-cols-2">
                <Progresso rotulo="Prestadores (CNPJ → Contratos)" feitos={prestOk} total={sit.prestadores.length} />
                <Progresso rotulo="Pastas de paciente (CPF → cadastro)" feitos={pacOk} total={sit.pacientes.length} />
              </div>
            </Bloco>
          )}

          {mostrar('sugestoes') && (
            <Bloco icone={Lightbulb} titulo="Sugestões para a PEP" subtitulo="os três sinais concordaram; nada vira entrega sem alguém do RP confirmar" contagem={numero(sit.sugestoes.length)}>
              {sit.sugestoes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma sugestão pendente.</p>
              ) : (
                <ul className="space-y-3">{sit.sugestoes.map(s => <CartaoSugestao key={s.sp_id} s={s} />)}</ul>
              )}
            </Bloco>
          )}

          {mostrar('prestadores') && (
            <Bloco icone={Building2} titulo="Prestadores" subtitulo="pasta do prestador → CNPJ da planilha → Contratos" contagem={`${prestOk} de ${sit.prestadores.length}`}>
              <ul className="grid gap-2 xl:grid-cols-2">
                {prestadores.map(p => {
                  const todos = pacientesPorPrestador.get(p.pasta_id) ?? []
                  const ok = todos.filter(x => x.status === 'reconhecido').length
                  const reconhecido = p.status === 'reconhecido'
                  const tom = reconhecido ? 'green' : 'amber'
                  return (
                    <li key={p.pasta_id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                      <span className={`flex size-14 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text}`}>
                        <span className="text-xl font-black leading-none tabular-nums">{ok}</span>
                        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide">de {todos.length}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-foreground">{nomeCurtoPrestador(p.nome_pasta)}</span>
                          <StatusChip tone={tom} dense>{reconhecido ? 'reconhecido' : 'não reconhecido'}</StatusChip>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {reconhecido ? `No Pulsar: ${p.prestador_nome}` : rotuloMotivo(p.motivo)}
                        </span>
                        {todos.length > 0 && (
                          <span className="mt-2 flex items-center gap-2">
                            <Barra pct={(ok / todos.length) * 100} cor={corBarra(ok === todos.length ? 'green' : 'amber')} />
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">pacientes</span>
                          </span>
                        )}
                      </span>
                      {p.planilha_web_url ? (
                        <a href={p.planilha_web_url} target="_blank" rel="noreferrer" title={p.planilha_nome ?? 'Planilha'}
                          aria-label={`Abrir a planilha de ${nomeCurtoPrestador(p.nome_pasta)}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <FileSpreadsheet className="h-4 w-4" aria-hidden />
                        </a>
                      ) : (
                        <StatusChip tone="amber" dense>sem planilha</StatusChip>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Bloco>
          )}

          {mostrar('pacientes') && (
            <Bloco icone={Users} titulo="Pacientes, um por um" subtitulo="da planilha e das pastas: os 4 sinais, quem é no Pulsar e o que já existe no SharePoint"
              contagem={pacientes ? numero(pacientes.length) : undefined}>
              {pacientes ? <ListaPacientes pacientes={pacientes} /> : <p className="text-sm text-muted-foreground">Carregando pacientes…</p>}
            </Bloco>
          )}

          {!foco && (
            <Bloco icone={Sparkles} titulo="Arquivos novos nesta execução" subtitulo="o robô os viu pela primeira vez nesta leitura">
              <ListaArquivos execucaoId={execucao.id} filtro={{ soNovos: true }} />
            </Bloco>
          )}

          {mostrar('presos') && sit.itens_motivos.length > 0 && (
            <Bloco icone={FileQuestion} titulo="Por que arquivos não viraram sugestão" subtitulo="toque num motivo para ver os arquivos presos nele" contagem={numero(presos)}>
              <div className="space-y-0.5">
                {sit.itens_motivos.map(m => (
                  <LinhaRanking key={m.motivo} rotulo={rotuloMotivo(m.motivo)} n={m.n} max={maxMotivo} tom="amber"
                    ativa={motivo === m.motivo} apagada={!!motivo && motivo !== m.motivo}
                    onClick={() => {
                      setMotivo(motivo === m.motivo ? null : m.motivo)
                      setTimeout(() => presosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
                    }} />
                ))}
              </div>
              <div ref={presosRef} className="mt-4 scroll-mt-24 border-t border-border/70 pt-4">
                <ListaArquivos key={motivo ?? 'todos'} execucaoId={execucao.id} filtro={filtroPresos} onLimparFiltro={motivo ? () => setMotivo(null) : undefined} />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ExternalLink className="h-3 w-3" aria-hidden /> A lista mostra os arquivos lidos nesta execução; a fila completa fica em “Não reconhecidos” no painel.
              </p>
            </Bloco>
          )}
        </>
      )}

      {!sit && !erro && <p className="text-sm text-muted-foreground">Carregando reconhecimento…</p>}
    </div>
  )
}
