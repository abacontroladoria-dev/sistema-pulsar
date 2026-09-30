'use client'

import { CalendarClock, KeyRound, Lock, ShieldCheck, Timer } from 'lucide-react'
import { segundos } from '@/lib/roboSharepoint/rotulos'
import type { RoboEtapa, RoboExecucao } from '@/types/roboSharepoint'
import { Bloco, Ladrilho, Ladrilhos, Lead } from './Blocos'

// Autenticar não lê arquivo: prova quem é o robô. Interessa com que chave
// ele entrou, até quando ela vale e o que ela deixa fazer.

type Certificado = { assunto?: string; thumbprintSha1?: string; validoAte?: string; diasRestantes?: number }

export function AbaAutenticar({ execucao, etapa }: { execucao: RoboExecucao; etapa?: RoboEtapa }) {
  const c = (execucao.certificado ?? {}) as Certificado
  const validoAte = c.validoAte ? new Date(c.validoAte).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null
  const digital = c.thumbprintSha1 ? c.thumbprintSha1.replace(/(.{4})(?=.)/g, '$1 ') : null
  const dias = c.diasRestantes ?? 0

  const linhas: { rotulo: string; valor: React.ReactNode }[] = [
    { rotulo: 'Aplicativo no Entra ID', valor: 'Pulsar - Robo PEP SharePoint' },
    { rotulo: 'Certificado', valor: c.assunto ?? '—' },
    { rotulo: 'Válido até', valor: validoAte ?? '—' },
    { rotulo: 'Impressão digital (SHA-1)', valor: digital ? <span className="font-mono text-[13px]">{digital}</span> : '—' },
    { rotulo: 'Permissão', valor: 'Leitura, em um único site (Sites.Selected)' },
    { rotulo: 'Site', valor: 'Repositório de Documentos e Registros Técnicos - Prestador de Serviço' },
  ]

  return (
    <div className="space-y-5">
      <Lead>
        O robô entrou na Microsoft com o certificado <strong className="font-semibold text-foreground">{c.assunto ?? '—'}</strong> em{' '}
        <strong className="font-semibold text-foreground">{segundos(etapa?.duracao_ms, 2)}</strong>. Aqui ele ainda não lê arquivo nenhum:
        só obtém a permissão de leitura.
      </Lead>

      <Ladrilhos colunas={3}>
        <Ladrilho icone={CalendarClock} tom={dias < 30 ? 'amber' : 'green'} valor={dias} rotulo="dias de validade" sub={validoAte ? `até ${validoAte}` : undefined} />
        <Ladrilho icone={Timer} tom="gray" valor={etapa?.duracao_ms ?? 0} rotulo="para entrar" formato={n => segundos(n, 2)} />
        <Ladrilho icone={Lock} tom="blue" valor={1} rotulo="site com acesso" sub="só leitura" />
      </Ladrilhos>

      <Bloco icone={KeyRound} titulo="Credencial desta execução" subtitulo="o que o Entra ID confere a cada entrada">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {linhas.map(l => (
            <div key={l.rotulo} className="rounded-xl bg-muted/40 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{l.rotulo}</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{l.valor}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
          Com esta chave o robô não cria, não muda e não apaga nada no SharePoint, e não enxerga outros sites. Revogar o certificado no
          Entra ID desliga o robô na hora.
        </p>
      </Bloco>
    </div>
  )
}
