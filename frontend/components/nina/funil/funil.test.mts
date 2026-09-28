// npx tsx components/nina/funil/funil.test.mts

import {
  separarEstagios, estagioVisivel, negocioVisivel, podeReceber, buscaCasa,
  diasUteisEntre, tempoNaPosicao, prazoEstourado,
} from './funil.js'
import type { DealUI, KanbanColumnUI } from '@/services/crm/adapter'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

function est(slug: string, order: number, extra: Partial<KanbanColumnUI> = {}): KanbanColumnUI {
  return { id: slug, slug, title: slug, description: null, color: '#000', order,
    trilha: 'ambas', exigeMotivo: false, autoWin: false, autoLose: false, isSystem: false, ...extra }
}
function neg(extra: Partial<DealUI> = {}): DealUI {
  return { id: 'd', title: 'Ana Souza', status: 'open', stageId: 'novo', trilha: null, resgate: false,
    motivo: null, stageChangedAt: null, ownerId: null, contactId: null, contactName: 'Maitê Lima',
    contactPhone: '+55 21 99876-5432', conversationId: null, closedReason: null, closedAt: null,
    createdByAi: false, source: null, createdAt: null, updatedAt: null, ...extra }
}

console.log('separarEstagios')
{
  const r = separarEstagios([
    est('perdido', 13, { autoLose: true }), est('novo', 1), est('iniciou', 11, { autoWin: true }), est('qualif', 3),
  ])
  checar('andamento em ordem', r.andamento.map(e => e.slug), ['novo', 'qualif'])
  checar('encerrados em ordem', r.encerrados.map(e => e.slug), ['iniciou', 'perdido'])
}

console.log('trilha')
{
  const conv = est('eleg', 6, { trilha: 'convenio' })
  checar('todas mostra posição de convênio', estagioVisivel(conv, 'todas'), true)
  checar('particular esconde posição de convênio', estagioVisivel(conv, 'particular'), false)
  checar('ambas aparece em particular', estagioVisivel(est('novo', 1), 'particular'), true)
  checar('negócio sem trilha aparece em convênio', negocioVisivel(neg(), 'convenio'), true)
  checar('negócio particular some em convênio', negocioVisivel(neg({ trilha: 'particular' }), 'convenio'), false)
  checar('particular não pode ir para convênio', podeReceber(conv, { trilha: 'particular' }), false)
  checar('sem trilha pode ir para convênio', podeReceber(conv, { trilha: null }), true)
}

console.log('busca')
{
  checar('ignora acento', buscaCasa(neg(), 'maite'), true)
  checar('pelo título', buscaCasa(neg(), 'souza'), true)
  checar('pelo telefone', buscaCasa(neg(), '99876'), true)
  checar('não casa', buscaCasa(neg(), 'joão'), false)
  checar('vazio casa tudo', buscaCasa(neg(), '  '), true)
}

console.log('tempo')
{
  // 2026-09-25 é sexta.
  checar('sexta → segunda = 1 dia útil', diasUteisEntre(new Date('2026-09-25T10:00'), new Date('2026-09-28T10:00')), 1)
  checar('sexta → quarta = 3 dias úteis', diasUteisEntre(new Date('2026-09-25T10:00'), new Date('2026-09-30T09:00')), 3)
  const agora = new Date('2026-09-28T12:00:00')
  checar('minutos', tempoNaPosicao('2026-09-28T11:20:00', agora), 'há 40 min')
  checar('horas', tempoNaPosicao('2026-09-28T07:00:00', agora), 'há 5 h')
  checar('dias', tempoNaPosicao('2026-09-25T12:00:00', agora), 'há 3 dias')
  checar('sem data', tempoNaPosicao(null, agora), null)
  checar('elegibilidade na sexta, segunda: no prazo', prazoEstourado('aguardando_elegibilidade', '2026-09-25T10:00', agora), false)
  checar('elegibilidade na sexta, quarta: estourado',
    prazoEstourado('aguardando_elegibilidade', '2026-09-25T10:00', new Date('2026-09-30T10:00')), true)
  checar('posição sem prazo nunca estoura', prazoEstourado('qualificado', '2026-01-01T00:00', agora), false)
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
if (falhas > 0) process.exit(1)
