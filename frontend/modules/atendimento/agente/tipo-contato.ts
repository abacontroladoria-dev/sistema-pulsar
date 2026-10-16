// ============================================================================
// TIPO DE CONTATO = "Não-paciente | Trabalhe conosco" pelo sistema (16/10/2026)
//
// Caso que motivou: uma psicóloga escreveu "Gostaria de encaminhar meu
// currículo", a Maia respondeu certo (curriculo@universoaba.com.br) e a
// conversa ficou sem tag nenhuma — a Maia não chama registrar_tags (0 vezes em
// 30 dias; ver origem-campanha.ts). Quem procura emprego se reconhece pelo
// vocabulário, então é regra do sistema, como a ORIGEM.
//
// Só sinais FORTES. "vaga" sozinha não conta — nem "vaga para fono": na
// clínica "tem vaga?" é a mãe perguntando por horário de terapia (com a fono,
// com o AT) — o caso mais comum de todos.
//
// Aplicada só quando a conversa ainda não tem TIPO DE CONTATO: não passa por
// cima de paciente_ativo/inativo (sistema), nem do que a atendente escolheu.
// ============================================================================

export const TAG_TRABALHE_CONOSCO = 'nao_paciente_trabalhe_conosco'

const SINAIS: RegExp[] = [
  /\bcurricul(o|um|os)\b/,
  /\b(meu|o|um|nosso) cv\b/,
  /\btrabalhe conosco\b/,
  /\b(trabalhar|atuar|fazer parte) (com voces|com vcs|com vc|na clinica|na equipe|na universo|ai|de voces)\b/,
  /\b(vaga|vagas|oportunidade|oportunidades) (de|para) (emprego|trabalho|estagio|estagiario|estagiaria)\b/,
  /\b(estagiar|vaga de estagio|estagio (em|na|no|para)|processo seletivo)\b/,
]

// Currículo também é coisa de escola — "o currículo escolar dele" é da família.
const NEGACOES: RegExp[] = [/\bcurricul(o|um) (escolar|da escola|do colegio|pedagogico|adaptado)\b/]

const normalizar = (t: string) => t
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Alguma das mensagens da pessoa é de quem procura trabalho na clínica? */
export function pareceTrabalheConosco(textos: readonly string[]): boolean {
  return textos.some((bruto) => {
    const t = normalizar(bruto ?? '')
    if (!t || NEGACOES.some((n) => n.test(t))) return false
    return SINAIS.some((s) => s.test(t))
  })
}
