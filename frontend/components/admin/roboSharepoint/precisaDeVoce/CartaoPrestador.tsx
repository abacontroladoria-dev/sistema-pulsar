'use client'

import { Check, Copy, FileText, Flame, Folder, FolderOpen, Hand, Send, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { mensagemPedirPlanilha, nomeCurtoPrestador, numero } from '@/lib/roboSharepoint/rotulos'
import type { SpPrestadorSemPlanilha } from '@/types/roboSharepoint'
import { avisoFeito, confete, copiar, iniciais, tom } from './pecas'

// Um prestador sem planilha. O número grande é o que destrava (pacientes);
// a cor diz a urgência (coral = já tem arquivo esperando), o verde diz "avisado".

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

function quando(iso: string) {
  const d = new Date(iso)
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return dia === hoje
    ? d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    : dia.slice(0, 5)
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
  const t = feito ? 'verde' : urgente ? 'coral' : 'amber'

  async function copiarMensagem(e: React.MouseEvent<HTMLButtonElement>) {
    const botao = e.currentTarget
    if (await copiar(mensagemPedirPlanilha(nome, p.pastas_paciente))) {
      if (!feito) confete(botao)
      onAvisado(p.pasta_id)
      avisoFeito(`Copiado! Cole no WhatsApp de ${nome.split(/\s+/)[0]}`)
    } else {
      toast.error('Não foi possível copiar. Selecione o texto à mão.')
    }
  }

  const apoio = feito
    ? { Icone: Send, texto: `Avisado ${quando(avisadoEm)}` }
    : urgente
      ? { Icone: FileText, texto: plural(p.arquivos, 'arquivo esperando', 'arquivos esperando') }
      : { Icone: Folder, texto: 'Pasta vazia' }

  return (
    <li className={`${tom(t)} pp-cartao ${proximo ? 'is-next' : ''} ${feito ? 'is-done' : ''}`}>
      {proximo && <span className={`${tom('aco')} pp-selo pp-selo-flutua pp-selo-next`}><Hand className="h-3 w-3" aria-hidden /> Comece aqui</span>}
      {urgente && !feito && <span className={`${tom('coral')} pp-selo pp-selo-flutua pp-selo-urgente`}><Flame className="h-3 w-3" aria-hidden /> Urgente</span>}

      <div className="flex items-start gap-3">
        <span key={feito ? 'feito' : 'pendente'} className={`pp-avatar ${feito ? 'pp-pop' : ''}`} aria-hidden>
          {feito ? <Check className="h-5 w-5" strokeWidth={3} /> : iniciais(nome)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="pp-nome" title={p.nome_pasta}>{nome}</p>
          <p
            className="pp-apoio"
            title={p.vinculado_a_mao ? 'Alguém já disse quem é este prestador, mas os pacientes dele só são liberados quando a planilha chegar.' : undefined}
          >
            <apoio.Icone className="h-3.5 w-3.5" aria-hidden /> {apoio.texto}
          </p>
        </div>
        {p.web_url ? (
          <a href={p.web_url} target="_blank" rel="noreferrer" className="pp-iconbtn" aria-label={`Abrir pasta de ${nome}`} title={`Abrir pasta de ${nome}`}>
            <FolderOpen className="h-4 w-4" aria-hidden />
          </a>
        ) : (
          <span className="pp-iconbtn opacity-45 cursor-not-allowed" role="img" aria-label="Link da pasta indisponível" title="O link da pasta chega na próxima leitura do robô.">
            <FolderOpen className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>

      <div className="pp-impacto">
        <span className="pp-impacto-num">{numero(p.pastas_paciente)}</span>
        <span className="flex items-center gap-1 text-xs font-extrabold">
          <User className="h-3.5 w-3.5" aria-hidden /> {p.pastas_paciente === 1 ? 'paciente' : 'pacientes'}
        </span>
        <span className="pp-barra" aria-hidden>
          <span style={{ width: `${maxPacientes > 0 ? Math.max(8, (p.pastas_paciente / maxPacientes) * 100) : 0}%` }} />
        </span>
      </div>

      <button type="button" onClick={copiarMensagem} className={`pp-btn pp-btn-bloco ${feito ? 'pp-btn-suave' : ''}`}>
        <Copy className="h-4 w-4" aria-hidden /> {feito ? 'Copiar de novo' : 'Copiar mensagem'}
      </button>
    </li>
  )
}
