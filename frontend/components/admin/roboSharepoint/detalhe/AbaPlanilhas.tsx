'use client'

import { useEffect, useState } from 'react'
import { Check, CheckCircle2, ChevronDown, ExternalLink, FileSpreadsheet, FolderX, ShieldAlert, Users, X } from 'lucide-react'
import { StatusChip, TONE_CHIP } from '@/components/ui/tones'
import { nomeCurtoPrestador, numero, partesDoCaminho, rotuloMotivo, segundos } from '@/lib/roboSharepoint/rotulos'
import { listarPlanilhasLidas, obterPacientesDetalhe } from '@/services/roboSharepoint.service'
import type { ArquivoLido, PacienteDetalhe, ResumoExecucao, RoboEtapa, RoboExecucao } from '@/types/roboSharepoint'
import { PlanilhaDesenhada } from './PlanilhaDesenhada'
import { Aviso, Bloco, Ladrilho, Ladrilhos, Lead, Rotulo } from './Blocos'

// Ler planilhas = abrir a "Planejamento Documentos Técnicos" de cada
// prestador, em memória, e tirar dela CNPJ, pacientes e planejamento. É daqui
// que sai o CPF que liga a pasta ao cadastro — a tela diz se cada CPF é
// válido, nunca o CPF em si.

const AVISOS: Record<string, string> = {
  cnpj_ausente: 'sem CNPJ',
  cnpj_invalido: 'CNPJ inválido',
  varias_planilhas: 'havia mais de uma planilha na pasta',
  planilha_ilegivel: 'arquivo ilegível',
  sem_aba_pacientes: 'sem aba “Pacientes”',
  sem_aba_planejamento: 'sem aba “Planejamento”',
  aba_pacientes_sem_cabecalho: 'aba “Pacientes” sem coluna de CPF',
  aba_planejamento_sem_tabela: 'aba “Planejamento” sem a tabela',
}

export function AbaPlanilhas({ execucao, etapa, resumo }: { execucao: RoboExecucao; etapa?: RoboEtapa; resumo: ResumoExecucao }) {
  const [planilhas, setPlanilhas] = useState<ArquivoLido[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [pacDet, setPacDet] = useState<PacienteDetalhe[] | null>(null)

  useEffect(() => {
    let vivo = true
    obterPacientesDetalhe().then(r => { if (vivo) setPacDet(r) }).catch(() => { if (vivo) setPacDet([]) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    let vivo = true
    listarPlanilhasLidas(execucao.id)
      .then(p => {
        if (!vivo) return
        // Lidas primeiro; entre elas, a de mais pacientes.
        const n = (a: ArquivoLido) => (a.detalhe?.usada ? a.detalhe.pacientes?.length ?? 0 : -1)
        const ordenadas = [...p].sort((a, b) => n(b) - n(a))
        setPlanilhas(ordenadas)
        // A primeira planilha lida já abre desenhada.
        setAberta(atual => atual ?? ordenadas.find(x => x.detalhe?.usada)?.sp_id ?? null)
      })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Erro ao carregar as planilhas') })
    return () => { vivo = false }
  }, [execucao.id])

  const lidas = (planilhas ?? []).filter(p => p.detalhe?.usada)
  const totalPacientes = lidas.reduce((s, p) => s + (p.detalhe?.usada ? p.detalhe.pacientes?.length ?? 0 : 0), 0)
  const cpfInvalidos = lidas.reduce((s, p) => s + (p.detalhe?.usada ? (p.detalhe.pacientes ?? []).filter(x => !x.cpfValido).length : 0), 0)
  const semPlanilha = resumo.prestadores.filter(p => !p.tem_planilha)

  return (
    <div className="space-y-5">
      <Lead>
        {planilhas && planilhas.length > 0 ? (
          <>
            O robô achou <strong className="font-semibold text-foreground">{planilhas.length} planilha(s)</strong> de planejamento e leu{' '}
            <strong className="font-semibold text-foreground">{lidas.length}</strong>, uma por prestador, em {segundos(etapa?.duracao_ms, 2)}.
            {planilhas.length > lidas.length && ` ${planilhas.length - lidas.length} ficou(aram) de fora: havia outra mais recente na mesma pasta.`}{' '}
            Nelas estão <strong className="font-semibold text-foreground">{numero(totalPacientes)} pacientes</strong>.
          </>
        ) : (
          <>Nenhuma planilha nova nesta execução: elas só são relidas quando mudam no SharePoint.</>
        )}
      </Lead>

      <Ladrilhos>
        <Ladrilho icone={FileSpreadsheet} tom="gray" valor={planilhas?.length ?? 0} rotulo="planilhas encontradas" />
        <Ladrilho icone={CheckCircle2} tom="green" valor={lidas.length} rotulo="lidas" sub="uma por prestador" />
        <Ladrilho icone={Users} tom="blue" valor={totalPacientes} rotulo="pacientes nas planilhas" />
        <Ladrilho icone={ShieldAlert} tom="amber" valor={cpfInvalidos} rotulo="CPF inválido ou ausente" sub={cpfInvalidos ? 'corrigir na planilha' : 'todos válidos'} />
      </Ladrilhos>

      {erro && <Aviso tom="atencao">{erro}</Aviso>}

      {planilhas && planilhas.length > 0 && (
        <Bloco icone={FileSpreadsheet} titulo="Planilhas" subtitulo="toque numa planilha lida para ver os pacientes" contagem={`${lidas.length} de ${planilhas.length} lidas`}>
          <ul className="space-y-2">
            {planilhas.map(p => {
              const det = p.detalhe
              const usada = !!det?.usada
              const pacientes = det && det.usada ? det.pacientes ?? [] : []
              const invalidos = pacientes.filter(x => !x.cpfValido).length
              const expandida = aberta === p.sp_id
              const tom = !usada ? 'gray' : invalidos ? 'amber' : 'green'
              return (
                <li key={p.sp_id} className={`overflow-hidden rounded-xl border transition-colors ${expandida ? 'border-foreground/20' : 'border-border'} ${!usada ? 'opacity-70' : ''}`}>
                  <button type="button" aria-expanded={expandida} disabled={!usada} onClick={() => setAberta(expandida ? null : p.sp_id)}
                    className="flex w-full items-center gap-4 p-3 text-left transition-colors enabled:hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className={`flex size-14 shrink-0 flex-col items-center justify-center rounded-xl ${TONE_CHIP[tom].bg} ${TONE_CHIP[tom].text}`}>
                      <span className="text-xl font-black leading-none tabular-nums">{usada ? pacientes.length : '—'}</span>
                      <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide">pacientes</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-foreground">{partesDoCaminho(p.caminho).prestador ?? '—'}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.nome}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {usada ? <StatusChip tone="green" dense>lida</StatusChip> : <StatusChip tone="gray" dense>não usada</StatusChip>}
                        {usada && det?.usada && (det.cnpj_valido
                          ? <StatusChip tone="green" dense><Check className="h-3 w-3" aria-hidden />CNPJ válido</StatusChip>
                          : <StatusChip tone="amber" dense><X className="h-3 w-3" aria-hidden />CNPJ {det.cnpj_informado ? 'inválido' : 'ausente'}</StatusChip>)}
                        {usada && invalidos > 0 && <StatusChip tone="amber" dense>{invalidos} CPF inválido</StatusChip>}
                        {!usada && det && !det.usada && <span className="text-[11px] text-muted-foreground">{rotuloMotivo(det.motivo)}</span>}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right sm:block xl:border-l xl:border-border xl:pl-6">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Planejamento</span>
                      <span className="block text-lg font-black tabular-nums text-foreground">{det?.usada ? numero(det.planejamento_linhas ?? 0) : '—'}</span>
                      <span className="block text-[11px] text-muted-foreground">linha(s)</span>
                    </span>
                    {usada && <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expandida ? 'rotate-180' : ''}`} aria-hidden />}
                  </button>

                  {expandida && det?.usada && (
                    <div className="border-t border-border/70 bg-muted/40 px-4 py-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <Rotulo>A planilha como o robô a leu</Rotulo>
                        {p.web_url && (
                          <a href={p.web_url} target="_blank" rel="noreferrer"
                            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            Abrir planilha <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        )}
                      </div>
                      {det.razao_social && <p className="mb-3 text-xs text-muted-foreground">Razão social na planilha: <span className="font-semibold text-foreground">{det.razao_social}</span></p>}
                      {(det.avisos ?? []).length > 0 && (
                        <p className="mb-3 text-xs text-amber-800 dark:text-amber-300">Avisos: {(det.avisos ?? []).map(a => AVISOS[a] ?? a).join(' · ')}</p>
                      )}
                      <PlanilhaDesenhada detalhe={det} cruzamento={(pacDet ?? []).filter(x => x.prestador_pasta_id === p.prestador_pasta_id && x.na_planilha)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Bloco>
      )}

      {!planilhas && !erro && <p className="text-sm text-muted-foreground">Carregando planilhas…</p>}

      {semPlanilha.length > 0 && (
        <Bloco icone={FolderX} titulo="Prestadores sem planilha" subtitulo="situação do site hoje" contagem={`${semPlanilha.length} de ${resumo.prestadores.length}`}>
          <Aviso tom="atencao">
            Sem a planilha de planejamento, o robô não tem o CNPJ nem os CPFs, e tudo o que está nas pastas desses prestadores fica em
            “Não reconhecidos”. Ela vai em <strong className="font-semibold">1. Planejamento - Prestador de Serviço</strong>.
          </Aviso>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {semPlanilha.map(p => (
              <li key={p.pasta_id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="truncate text-sm font-semibold text-foreground">{nomeCurtoPrestador(p.nome)}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {numero(p.pastas_paciente)} paciente(s) · {numero(p.evidencias)} evidência(s) esperando
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}
    </div>
  )
}
