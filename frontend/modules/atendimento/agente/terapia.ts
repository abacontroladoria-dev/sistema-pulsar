// Resolve o NOME de especialidade que o responsável usa para o texto que casa
// na grade do TiTa.
//
// POR QUE ISTO EXISTE — PARTE 1: o id que o modelo não sabia
//
// `consultar_horarios_disponiveis` pedia `terapiaId`, um inteiro que o modelo
// não tem como saber: ele só existe no retorno de outra ferramenta, e precisava
// ser carregado pela conversa inteira. Quando essa memória escorregava, o modelo
// não tinha como responder "não sei o id" — o schema exigia um inteiro, e `null`
// significa "todas as terapias", que é outra coisa. Ele preenchia um campo
// obrigatório sem ter fonte para ele.
//
// Caso real (04/09/2026, no rastro de tool calls): perguntada por psicologia a
// partir do dia 14, a IA passou `terapiaId: 1`. Psicologia é 2259, e ela tinha
// usado o id certo um minuto antes. Três reforços de prompt foram aplicados e
// nenhum impediu a reincidência, porque não era desobediência.
//
// POR QUE ISTO EXISTE — PARTE 2: o id não identifica a terapia
//
// Medido em produção (05/09/2026): `terapia_id` 2317 aparece com SETE
// `terapia_nome` diferentes, e 2260 com três. O nome de uma vaga é a lista de
// tudo que aquele profissional atende naquele horário, não a terapia da vaga:
//
//   2317  'Aplicador ABA (PS)'                                    135 vagas
//   2317  'Aplicador ABA (PS), Psicologia'                         12
//   2317  'Aplicador ABA (PS), Psicologia ABA'                     21
//   2317  'Aplicador ABA (PS), Coordenador de Caso, Psicopedagogia' 21
//   2259  'Psicologia'                                             61
//
// Então filtrar por id é errado nos dois sentidos: `terapiaId: 2317` traz as 135
// vagas de quem só aplica ABA junto com as de psicologia, e `terapiaId: 2259`
// esconde as 12 vagas de psicologia que vivem sob 2317. O filtro precisa cair
// sobre o NOME. Este módulo produz o texto para esse filtro.
//
// POR QUE ISTO EXISTE — PARTE 3: duas línguas para a mesma terapia
//
// O TiTa grava o nome da AÇÃO na escala ('Aplicador ABA (PS)'); o laudo que o
// responsável tem em mãos diz 'Psicologia ABA'. Ninguém nunca vai escrever
// "aplicador" no WhatsApp. Sem um de-para, quem pede psicologia ABA não acha as
// 205 vagas que existem, e o agente responde que não há — o mesmo falso negativo
// que este trabalho inteiro existe para eliminar.
//
// E 'Psicologia ABA' NÃO é uma grafia de 'Psicologia': são terapias diferentes,
// com TUSS diferente. Confundi-las oferece a terapia errada ao responsável.
//
// O QUE ESTE MÓDULO NÃO FAZ
//
// Não adivinha. Quando o texto casa com mais de uma especialidade, devolve
// `ambigua` com os candidatos, e quem chama transforma isso numa pergunta.
// Escolher a primeira seria o mesmo erro do chute, só que do nosso lado.

// ----------------------------------------------------------------------------
// O catálogo de oferta
//
// `nome` é o que o agente FALA e o que o responsável escreve — a língua do
// laudo. `casaCom` são os textos que aparecem em `terapia_nome` na grade — a
// língua da escala. `sinonimos` são outras formas de pedir a mesma coisa.
//
// Só o que está aqui é ofertável. Uma especialidade nova na grade não é
// oferecida até alguém acrescentá-la, e essa é a escolha certa: o modo de falha
// de uma allowlist é a vaga não aparecer (visível, alguém reclama), enquanto o
// de uma denylist é oferecer trabalho interno a uma mãe (invisível até
// acontecer).
// ----------------------------------------------------------------------------
export interface EspecialidadeOfertavel {
  // Como o agente a chama ao falar com o responsável.
  nome:      string
  // Textos que, aparecendo em `terapia_nome`, significam esta especialidade.
  // O casamento é por parte do nome-lista, não por igualdade da linha inteira.
  casaCom:   readonly string[]
  // Outras formas de o responsável pedir a mesma coisa.
  sinonimos?: readonly string[]
}

export const ESPECIALIDADES: readonly EspecialidadeOfertavel[] = [
  // O de-para que motivou este catálogo. 'Aplicador ABA (PS)' é o que o TiTa
  // grava e o que NUNCA deve ser dito ao responsável; 'Psicologia ABA' é o que
  // está no laudo dele.
  {
    nome:      'Psicologia ABA',
    casaCom:   ['Aplicador ABA (PS)', 'Psicologia ABA'],
    sinonimos: ['aba', 'psicologia aba', 'analise do comportamento', 'psicologia comportamental'],
  },
  // Terapia distinta da anterior, com TUSS próprio. O match exato é o que impede
  // 'psicologia' de escorregar para a ABA.
  { nome: 'Psicologia',           casaCom: ['Psicologia'] },

  { nome: 'Fonoaudiologia',       casaCom: ['Fonoaudiologia'],       sinonimos: ['fono'] },
  { nome: 'Terapia Ocupacional',  casaCom: ['Terapia Ocupacional'],  sinonimos: ['to'] },
  { nome: 'Psicopedagogia',       casaCom: ['Psicopedagogia'] },
  { nome: 'Psicomotricidade',     casaCom: ['Psicomotricidade'] },
  { nome: 'Fisioterapia',         casaCom: ['Fisioterapia'] },
  { nome: 'Fisioterapia Aquática', casaCom: ['Fisioterapia Aquática'], sinonimos: ['hidroterapia', 'fisioterapia aquatica'] },
  { nome: 'Musicoterapia',        casaCom: ['Musicoterapia'] },
  { nome: 'Terapia Alimentar',    casaCom: ['Terapia Alimentar'] },
  { nome: 'Equoterapia',          casaCom: ['Equoterapia'] },
  { nome: 'Arteterapia',          casaCom: ['Arteterapia'] },
  { nome: 'Avaliação Neuropsicológica', casaCom: ['Avaliação Neuropsicológica'], sinonimos: ['neuropsicologica', 'avaliacao neuropsicologica'] },
  { nome: 'Triagem',              casaCom: ['Triagem'],              sinonimos: ['primeira consulta', 'avaliacao inicial'] },
  { nome: 'Visita Guiada',        casaCom: ['Visita Guiada'],        sinonimos: ['visita', 'conhecer a clinica'] },
]

// FORA DO CATÁLOGO POR DECISÃO DA CLÍNICA (05/09/2026) — não é omissão:
//
//   Coordenador de Caso           586 vagas
//   Supervisão ABA                319
//   Aplicador Suporte              40
//   Operações Clínicas              5
//   Especialista Técnico de Área    1
//
// São 951 vagas — quase metade da grade — de trabalho interno, não de
// atendimento que um responsável agenda por WhatsApp. Até 05/09/2026 o agente
// as oferecia: a pergunta "o que vocês têm disponível?" listava 'Coordenador de
// Caso' como se fosse terapia.
//
// Não acrescente nenhuma delas sem a clínica pedir. A direção do erro é
// assimétrica: omitir uma vaga ofertável é visível (alguém pergunta por ela e
// alguém reclama), enquanto oferecer supervisão interna a uma mãe não é — ela
// aceita o horário e o erro só aparece na recepção.

// ----------------------------------------------------------------------------
// Normalização
//
// Remover diacríticos é obrigatório aqui, ao contrário de unidade.ts: nomes de
// terapia TÊM acento ('Nutrição', 'Avaliação Neuropsicológica') e o responsável
// digita sem. A lição já custou caro no projeto — `ilike` não ignora acento, e
// 'maite' não acha 'Maitê'.
//
// A faixa combinante é escrita em escape unicode de propósito: o caractere
// literal é invisível no diff e vira armadilha para quem editar depois.
//
// Parênteses NÃO viram espaço. Fazê-los sumir junta 'Aplicador ABA (PS)' e
// 'Aplicador ABA (SF)' num prefixo comum, e faz 'psicologia aba' alcançar
// 'Arteterapia (Psicologia ABA)' por substring — duas terapias diferentes
// colididas por uma decisão de normalização. Eles ficam, e o casamento é
// estrutural (ver `casaNome`).
// ----------------------------------------------------------------------------
export function chaveTerapia(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// O `terapia_nome` da grade é a LISTA do que o profissional atende naquele
// horário: 'Aplicador ABA (PS), Coordenador de Caso, Psicopedagogia'. Cada parte
// é uma especialidade candidata daquela vaga.
export function partesDoNome(nome: string | null | undefined): string[] {
  if (!nome) return []
  return nome.split(',').map(p => chaveTerapia(p)).filter(p => p.length > 0)
}

// ----------------------------------------------------------------------------
// A resolução
// ----------------------------------------------------------------------------
export type ResolucaoTerapia =
  | { tipo: 'encontrada'; nome: string; casaCom: readonly string[] }
  | { tipo: 'nao_encontrada' }
  | { tipo: 'ambigua'; candidatas: string[] }

// Todos os textos pelos quais uma especialidade pode ser pedida.
function formasDePedir(e: EspecialidadeOfertavel): string[] {
  return [e.nome, ...(e.sinonimos ?? []), ...e.casaCom].map(chaveTerapia)
}

export function resolverTerapia(
  texto: string | null | undefined,
  // As especialidades que TÊM vaga, pelos nomes do catálogo. Quem chama as
  // calcula com `especialidadesNaGrade`. Omitir restringe ao catálogo inteiro.
  disponiveis?: readonly string[],
): ResolucaoTerapia {
  const alvo = texto ? chaveTerapia(texto) : ''
  if (!alvo) return { tipo: 'nao_encontrada' }

  const universo = disponiveis
    ? ESPECIALIDADES.filter(e => disponiveis.includes(e.nome))
    : ESPECIALIDADES

  // Rodada 1 — alguma forma de pedir é EXATAMENTE o texto.
  //
  // Precisa vir primeiro e sozinha: 'psicologia' é prefixo de 'psicologia aba',
  // que é OUTRA terapia. Sem o exato ganhando, quem pede psicologia recebe ABA.
  const exatas = universo.filter(e => formasDePedir(e).some(f => f === alvo))
  if (exatas.length === 1) {
    return { tipo: 'encontrada', nome: exatas[0].nome, casaCom: exatas[0].casaCom }
  }
  if (exatas.length > 1) {
    return { tipo: 'ambigua', candidatas: exatas.map(e => e.nome) }
  }

  // Rodada 2 — alguma forma COMEÇA com o texto ('fono' → Fonoaudiologia).
  //
  // Aqui a ambiguidade é a resposta certa muito mais vezes: 'psico' começa
  // Psicologia, Psicologia ABA, Psicopedagogia e Psicomotricidade. Devolver a
  // primeira seria escolher a terapia da criança por ela.
  const prefixo = universo.filter(e => formasDePedir(e).some(f => f.startsWith(alvo)))
  if (prefixo.length === 1) {
    return { tipo: 'encontrada', nome: prefixo[0].nome, casaCom: prefixo[0].casaCom }
  }
  if (prefixo.length > 1) {
    return { tipo: 'ambigua', candidatas: prefixo.map(e => e.nome) }
  }

  // Rodada 3 — alguma forma CONTÉM o texto ('ocupacional' → Terapia Ocupacional).
  //
  // Última e a mais frouxa. Só chega aqui o que não casou de jeito nenhum acima,
  // e por isso o risco de sequestro (um nome exato roubado por outro que o
  // contém) já está eliminado pelas rodadas anteriores.
  const contem = universo.filter(e => formasDePedir(e).some(f => f.includes(alvo)))
  if (contem.length === 1) {
    return { tipo: 'encontrada', nome: contem[0].nome, casaCom: contem[0].casaCom }
  }
  if (contem.length > 1) {
    return { tipo: 'ambigua', candidatas: contem.map(e => e.nome) }
  }

  return { tipo: 'nao_encontrada' }
}

// ----------------------------------------------------------------------------
// Da grade para o catálogo
// ----------------------------------------------------------------------------

// Uma vaga OFERECE uma especialidade quando algum `casaCom` dela é uma das
// partes do nome-lista daquela vaga.
//
// Igualdade de parte, não substring da linha inteira. É o que impede
// 'Arteterapia (Psicologia ABA)' — uma parte só, com o qualificador entre
// parênteses — de ser contada como Psicologia ABA.
export function vagaOferece(terapiaNome: string | null | undefined, especialidade: EspecialidadeOfertavel): boolean {
  const partes = partesDoNome(terapiaNome)
  return especialidade.casaCom.some(c => partes.includes(chaveTerapia(c)))
}

// Os nomes de catálogo presentes numa amostra de vagas, na ordem do catálogo.
//
// É o que responde "o que a clínica tem disponível?" sem despejar cargos
// internos nem os nomes de escala que o responsável não reconhece.
export function especialidadesNaGrade(
  vagas: readonly { terapia_nome: string | null }[],
): string[] {
  return ESPECIALIDADES
    .filter(e => vagas.some(v => vagaOferece(v.terapia_nome, e)))
    .map(e => e.nome)
}

// Os nomes que o modelo pode usar, para compor a mensagem de recusa.
//
// Sem a lista de nomes válidos na recusa, o modelo tende a tentar outro palpite,
// e um palpite DIFERENTE não é detectado como laço pelo orquestrador — ele
// giraria até o teto de iterações.
export function nomesOfertaveis(disponiveis?: readonly string[], maximo = 25): string[] {
  const nomes = disponiveis
    ? ESPECIALIDADES.filter(e => disponiveis.includes(e.nome)).map(e => e.nome)
    : ESPECIALIDADES.map(e => e.nome)
  return nomes.slice(0, maximo)
}
