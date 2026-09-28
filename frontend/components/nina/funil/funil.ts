import type { DealUI, KanbanColumnUI } from '@/services/crm/adapter'

// ============================================================================
// Regras de tela do funil da diretoria — funções puras, testadas em
// funil.test.mts. O componente só desenha o que sai daqui.
// ============================================================================

export type FiltroTrilha = 'todas' | 'particular' | 'convenio'

// Posição em andamento é coluna do board; posição de fechamento (auto_win ou
// auto_lose) vai para a área "Encerrados". São 11 + 6 no funil da diretoria:
// 17 colunas lado a lado não caberiam em tela nenhuma, e o que se trabalha é o
// que está em andamento.
export function separarEstagios(estagios: KanbanColumnUI[]) {
  const ordenados = [...estagios].sort((a, b) => a.order - b.order)
  return {
    andamento:   ordenados.filter(e => !e.autoWin && !e.autoLose),
    encerrados:  ordenados.filter(e => e.autoWin || e.autoLose),
  }
}

// Com uma trilha escolhida, somem as posições da OUTRA trilha. 'ambas' fica
// sempre.
export function estagioVisivel(estagio: KanbanColumnUI, filtro: FiltroTrilha): boolean {
  return filtro === 'todas' || estagio.trilha === 'ambas' || estagio.trilha === filtro
}

// Negócio sem trilha aparece nas duas: ainda não se sabe, e escondê-lo de uma
// das equipes seria escondê-lo de quem pode descobrir.
export function negocioVisivel(negocio: DealUI, filtro: FiltroTrilha): boolean {
  return filtro === 'todas' || negocio.trilha === null || negocio.trilha === filtro
}

// O negócio pode ir para esta posição? Mesma regra que o servidor aplica
// (DealService.moverParaEstagio): posição de uma trilha só não recebe negócio
// da outra. A tela usa para apagar o alvo de soltura em vez de deixar soltar e
// receber o 422.
export function podeReceber(estagio: KanbanColumnUI, negocio: Pick<DealUI, 'trilha'>): boolean {
  return estagio.trilha === 'ambas' || negocio.trilha === null || negocio.trilha === estagio.trilha
}

export function buscaCasa(negocio: DealUI, termo: string): boolean {
  const t = normalizar(termo.trim())
  if (!t) return true
  const digitos = termo.replace(/\D/g, '')
  return normalizar(negocio.title).includes(t)
      || normalizar(negocio.contactName ?? '').includes(t)
      || (digitos.length >= 3 && (negocio.contactPhone ?? '').replace(/\D/g, '').includes(digitos))
}

// "maite" acha "Maitê": a busca ignora acento (mesma armadilha do ilike, ver
// reference_busca_acento_nome_normalizado).
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// ----------------------------------------------------------------------------
// Tempo parado na posição
// ----------------------------------------------------------------------------

// Prazos internos da planilha. Só "Aguardando elegibilidade" tem um escrito
// (48 horas úteis = 2 dias úteis). Posição sem prazo não fica vermelha nunca:
// inventar prazo seria inventar cobrança.
const PRAZO_DIAS_UTEIS: Record<string, number> = {
  aguardando_elegibilidade: 2,
}

export function diasUteisEntre(inicio: Date, fim: Date): number {
  if (fim <= inicio) return 0
  let dias = 0
  const cursor = new Date(inicio)
  cursor.setHours(0, 0, 0, 0)
  const ultimo = new Date(fim)
  ultimo.setHours(0, 0, 0, 0)
  while (cursor < ultimo) {
    cursor.setDate(cursor.getDate() + 1)
    const dia = cursor.getDay()
    if (dia !== 0 && dia !== 6) dias++
  }
  return dias
}

export function tempoNaPosicao(desdeIso: string | null, agora: Date = new Date()): string | null {
  if (!desdeIso) return null
  const desde = new Date(desdeIso)
  const ms = agora.getTime() - desde.getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  const min = Math.floor(ms / 60_000)
  if (min < 60)  return min <= 1 ? 'agora' : `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)    return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}

export function prazoEstourado(
  slug: string | null,
  desdeIso: string | null,
  agora: Date = new Date(),
): boolean {
  if (!slug || !desdeIso) return false
  const prazo = PRAZO_DIAS_UTEIS[slug]
  if (prazo === undefined) return false
  return diasUteisEntre(new Date(desdeIso), agora) > prazo
}

export const ROTULO_TRILHA: Record<'particular' | 'convenio', string> = {
  particular: 'Particular',
  convenio:   'Convênio',
}
