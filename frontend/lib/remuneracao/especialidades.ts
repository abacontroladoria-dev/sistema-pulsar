/**
 * Especialidades da Agenda — vocabulário fechado do campo `funcao` do contrato.
 *
 * Era texto livre, o que deixava a mesma especialidade gravada de N formas
 * ("Psicologia ABA", "psicologia", "PSICOLOGIA") e nenhuma delas conferível com
 * o que a agenda produz. Mesma disciplina que `convenioValores.service.ts` já
 * aplica em convênio/terapia/paciente: escolher do que existe, nunca digitar.
 *
 * ATENÇÃO ao mexer nesta lista: `normalizarFuncaoContrato` em
 * `lib/remuneracao/calculo.ts` interpreta o valor e o reduz a três destinos —
 *   AC   → "ac", "cc", ou contém "coordenador de caso" / "analista do comportamento"
 *   PS   → "ps", ou contém "aplicador aba"  ← SUBSTRING, pega Casa/Escola/(HS)/(SF)/…
 *   texto livre → qualquer outra coisa, repassada como está
 * e o balde decide qual contrato é usado quando o profissional tem dois
 * vigentes, além do rótulo que sai no export e no PDF. Tirar "Coordenador de
 * Caso" da lista, ou renomear os "Aplicador ABA", muda classificação de dinheiro.
 */

/**
 * Ordenada em tempo de carga com colação pt-BR, para acento não jogar item para
 * o fim: quem adicionar uma especialidade nova só precisa acrescentar na lista,
 * sem procurar a posição certa à mão.
 */
export const ESPECIALIDADES_AGENDA: readonly string[] = [
  "Aplicador ABA (AE)",
  "Aplicador ABA (EF)",
  "Aplicador ABA (HS)",
  "Aplicador ABA (PS)",
  "Aplicador ABA (SF)",
  "Aplicador ABA Casa",
  "Aplicador ABA Escola",
  "Aplicador Suporte",
  "Apoio Operacional",
  "Avaliação Neuropsicológica",
  "Avaliação Neuropsicopedagógica",
  "Coordenador de Caso",
  "Equoterapia",
  "Especialista Técnico de Área",
  "Estágio",
  "Facilitador Técnico",
  "Fisioterapia",
  "Fisioterapia Aquática",
  "Fonoaudiologia",
  "Musicoterapia",
  "Operações Clínicas",
  "Psicologia",
  "Psicomotricidade",
  "Psicopedagogia",
  "Psiquiatra/Neurologista",
  "Supervisão ABA",
  "Técnico Terapêutico Particular",
  "Terapia Alimentar",
  "Terapia Ocupacional",
  "Triagem",
].sort((a, b) => a.localeCompare(b, "pt-BR"))

const CONHECIDAS = new Set<string>(ESPECIALIDADES_AGENDA)

/**
 * Valor gravado que não está no vocabulário — vindo do tempo em que o campo era
 * texto livre.
 *
 * Existe porque um `<select>` cujo `value` não casa com nenhuma `<option>`
 * renderiza VAZIO, e aí o próximo "Salvar tudo" gravaria o vazio por cima sem
 * ninguém perceber. Quem chama isto deve acrescentar a opção extra com o valor
 * atual, para ele continuar visível, continuar selecionado e sobreviver ao save.
 */
export const especialidadeForaDoVocabulario = (v: string): boolean => {
  const t = v.trim()
  return !!t && !CONHECIDAS.has(t)
}
