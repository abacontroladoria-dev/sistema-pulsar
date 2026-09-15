import type { AIMode } from '../types/central.types'

// ============================================================================
// Quem responde esta conversa — a REGRA, sem I/O
//
// A decisão tem DOIS níveis, e a ordem entre eles é a regra inteira:
//
//   1. `conversations.ai_mode`  — alguém decidiu por ESTA conversa (a chave
//      Maia/Atendente no inbox, ou a própria IA escalando). Vence.
//   2. `agent_settings.ai_mode` — o padrão da clínica; inbox vence organização.
//      Vale enquanto ninguém decidiu nada na conversa (coluna NULL).
//
// Isto vive fora do worker porque a TELA precisa da mesma resposta: o botão
// mostra "Maia" ou "Atendente" e, se ele resolvesse a herança por conta própria,
// a recepcionista veria "Atendente" numa conversa que a Maia está respondendo —
// ou o contrário, que é pior. Uma função só, um resultado só.
//
// E vive SEPARADO de quem lê o banco (agent-settings.ts, que é `server-only`)
// porque é a decisão mais cara de errar no pipeline: uma regra que só roda com
// stack de pé acaba não sendo exercitada. Aqui ela é testável com `npx tsx` e
// nada mais — ver modo-efetivo.test.mts.
//
// Ver migration 20260915220000.
// ============================================================================

// O modo que de fato vale para a conversa, e de onde ele veio. A origem não é
// enfeite: é o que permite à tela dizer "seguindo o padrão da clínica" em vez de
// deixar a recepcionista achar que alguém desligou a IA naquela conversa.
export interface ModoEfetivo {
  modo:   string
  origem: 'conversa' | 'padrao'
}

export function resolverModoEfetivo(
  modoDaConversa: AIMode | null,
  modoPadrao: string,
): ModoEfetivo {
  if (modoDaConversa) return { modo: modoDaConversa, origem: 'conversa' }
  return { modo: modoPadrao, origem: 'padrao' }
}
