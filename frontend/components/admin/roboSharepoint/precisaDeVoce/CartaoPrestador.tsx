'use client'

import { Check, Copy, FileText, Flame, Folder, FolderOpen, Hand, Send, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { btnIcone, btnPrimario, btnSecundario, selo } from '@/components/cronograma/grade/estilo'
import { cartaoPadrao } from '@/components/ui/padrao'
import { mensagemPedirPlanilha, nomeCurtoPrestador, numero } from '@/lib/roboSharepoint/rotulos'
import type { SpPrestadorSemPlanilha } from '@/types/roboSharepoint'

// Um prestador sem planilha. O número destaca o que destrava (pacientes);
// os selos indicam a urgência (já tem arquivo esperando) e o estado "avisado".

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

function quando(iso: string) {
  const d = new Date(iso)
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return dia === hoje
    ? d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    : dia.slice(0, 5)
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

export function CartaoPrestador({ p, avisadoEm, proximo, maxPacientes, onAvisado }: {
  p: SpPrestadorSemPlanilha
  /** ISO de quando a mensagem foi copiada; null = ainda não. */
  avisadoEm: string | null
  proximo: boolean
  maxPacientes: number
  onAvisado: (pastaId: string) => void
}) {
  const nome = nomeCurtoPrestador(p.nome_pasta)
  const urgente = p.arquivos > 0
  const feito = avisadoEm != null

  async function copiarMensagem() {
    if (await copiarTexto(mensagemPedirPlanilha(nome, p.pastas_paciente))) {
      onAvisado(p.pasta_id)
      toast.success(`Copiado! Cole no WhatsApp de ${nome.split(/\s+/)[0]}`)
    } else {
      toast.error('Não foi possível copiar. Selecione o texto à mão.')
    }
  }

  const apoio = feito
    ? { Icone: Send, texto: `Avisado ${quando(avisadoEm)}` }
    : urgente
      ? { Icone: FileText, texto: plural(p.arquivos, 'arquivo esperando', 'arquivos esperando') }
      : { Icone: Folder, texto: 'Pasta vazia' }

  const pct = maxPacientes > 0 ? Math.max(8, (p.pastas_paciente / maxPacientes) * 100) : 0

  return (
    <li className={`${cartaoPadrao} flex flex-col justify-between gap-3 p-4`}>
      <div>
        {(proximo || (urgente && !feito) || feito) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {proximo && !feito && (
              <span className={selo('blue')}>
                <Hand className="h-3 w-3" aria-hidden /> Comece aqui
              </span>
            )}
            {urgente && !feito && (
              <span className={selo('red')}>
                <Flame className="h-3 w-3" aria-hidden /> Urgente
              </span>
            )}
            {feito && (
              <span className={selo('green')}>
                <Check className="h-3 w-3" aria-hidden /> Avisado
              </span>
            )}
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words text-md font-semibold text-foreground" title={p.nome_pasta}>{nome}</p>
            <p
              className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
              title={p.vinculado_a_mao ? 'Alguém já disse quem é este prestador, mas os pacientes dele só são liberados quando a planilha chegar.' : undefined}
            >
              <apoio.Icone className="h-3.5 w-3.5 shrink-0" aria-hidden /> {apoio.texto}
            </p>
          </div>
          {p.web_url ? (
            <a
              href={p.web_url}
              target="_blank"
              rel="noreferrer"
              className={`${btnIcone} min-h-11 min-w-11 sm:min-h-0 sm:min-w-0`}
              aria-label={`Abrir pasta de ${nome}`}
              title={`Abrir pasta de ${nome}`}
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <span
              className={`${btnIcone} min-h-11 min-w-11 cursor-not-allowed opacity-45 sm:min-h-0 sm:min-w-0`}
              role="img"
              aria-label="Link da pasta indisponível"
              title="O link da pasta chega na próxima leitura do robô."
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5 rounded-md bg-muted/40 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold tabular-nums text-foreground">{numero(p.pastas_paciente)}</span>
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <User className="h-3.5 w-3.5" aria-hidden /> {p.pastas_paciente === 1 ? 'paciente' : 'pacientes'}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={`block h-full rounded-full ${feito ? 'bg-emerald-500' : 'bg-foreground/60'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <button
        type="button"
        onClick={copiarMensagem}
        className={`w-full min-h-11 sm:min-h-0 ${feito ? btnSecundario : btnPrimario}`}
      >
        <Copy className="h-4 w-4" aria-hidden /> {feito ? 'Copiar de novo' : 'Copiar mensagem'}
      </button>
    </li>
  )
}
