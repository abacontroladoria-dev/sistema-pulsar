// ============================================================================
// O que sai para o responsável no fim do turno — a REGRA, sem I/O
//
// Nasceu para fechar um buraco específico: a ferramenta `escalar_para_humano`
// muda quem atende NO MEIO do turno (iteração 2 de 6, digamos). Se o turno
// morrer depois disso — o modelo trunca, entra em loop, o provider cai — o
// orquestrador devolve 'escalar' ou 'aguardar', e o worker, até aqui, não
// mandava nada nesses casos.
//
// Para falha técnica isso está certo: não há texto confiável para enviar. Mas
// quando a conversa ACABOU de ser passada para um humano a pedido do
// responsável, o silêncio é definitivo, não temporário:
//
//   1. a ferramenta gravou ai_mode = 'off';
//   2. o turno morreu sem produzir a despedida;
//   3. a próxima mensagem da pessoa chega, o worker lê 'off' e devolve
//      `silencio` (agrupamento.worker.ts, ramo `aiMode === 'off'`);
//   4. ninguém nunca mais fala com ela pela IA.
//
// A pessoa pediu ajuda, o sistema tirou a Maia, e a conversa emudeceu. Por isso
// existe um texto de segurança — fixo, não gerado pelo modelo, porque neste
// ponto justamente o modelo é que falhou.
//
// O caso mais fácil de esquecer é `aguardar`: parece inofensivo ("volta para a
// fila e tenta de novo"), mas o retry vai encontrar a conversa em 'off' e sair
// pelo silêncio do passo 3. Para quem foi escalado, `aguardar` é tão terminal
// quanto `escalar`.
//
// Função PURA e em arquivo próprio: a regra de "o que o responsável recebe" é
// cara demais para só ser exercitada com stack de pé. Ver entrega.test.mts.
// ============================================================================

// Mínimo que esta regra precisa saber do turno. Não é o ResultadoTurno inteiro
// de propósito — depender do tipo do orquestrador traria `usos`, `detalhe` e
// LlmUso para dentro de uma decisão que não olha nada disso.
export interface ResumoDoTurno {
  tipo:  'responder' | 'escalar' | 'aguardar'
  // Só em 'responder'. É o texto que o modelo escreveu.
  texto?: string
}

export type AcaoEntrega =
  // Enfileirar para o WhatsApp.
  | { acao: 'enviar';   texto: string; fallback: boolean }
  // Gravar como rascunho para um humano revisar (modo 'assisted').
  | { acao: 'rascunho'; texto: string; fallback: boolean }
  // Nada sai. É o comportamento correto para falha técnica sem escalada.
  | { acao: 'nada' }

// O texto de segurança. Curto, sem prazo e sem nome de ninguém — as mesmas
// restrições que a description da ferramenta impõe ao modelo, porque aqui ele
// está sendo substituído.
//
// "Vou chamar" e não "chamei": do ponto de vista do responsável o que importa é
// que alguém vem, e a conversa já está na fila humana quando esta frase sai.
export const TEXTO_ESCALADA_FALLBACK =
  'Vou chamar alguém da equipe para continuar seu atendimento por aqui.'

export function decidirEntrega(
  turno:    ResumoDoTurno,
  // A escalada pedida pela ferramenta NESTE turno (FerramentasAgente.escaladaPedida()).
  escalou:  boolean,
  // O modo efetivo com que o turno RODOU. Note que não é o modo atual da
  // conversa: se houve escalada, a conversa já está em 'off' agora. O que decide
  // entre enviar e rascunhar é como o turno começou.
  aiMode:   'assisted' | 'autonomous',
): AcaoEntrega {
  // Em 'assisted' nada é enviado direto ao responsável, nem o texto de segurança.
  // A clínica configurou revisão humana; furá-la justamente no momento em que um
  // humano está sendo chamado seria contraditório — e a promessa de 'assisted' é
  // o tipo de coisa que, quebrada uma vez, se descobre por uma mensagem já
  // entregue.
  const modoDeSaida = aiMode === 'assisted' ? 'rascunho' as const : 'enviar' as const

  if (turno.tipo === 'responder') {
    const texto = (turno.texto ?? '').trim()
    // O caminho normal, com ou sem escalada: o modelo se despediu, e é o texto
    // dele que sai. Não se acrescenta o fallback aqui — seriam duas mensagens
    // dizendo a mesma coisa.
    if (texto) return { acao: modoDeSaida, texto, fallback: false }

    // 'responder' com texto vazio não deveria existir (o orquestrador transforma
    // isso em escalar/sem_texto), mas se chegar, cai na mesma rede abaixo.
  }

  // Daqui para baixo o turno não produziu texto. Sem escalada, silêncio é o certo:
  // é falha técnica, e inventar uma frase para o responsável mascararia o defeito.
  if (!escalou) return { acao: 'nada' }

  // Com escalada, silêncio é permanente. A rede.
  return { acao: modoDeSaida, texto: TEXTO_ESCALADA_FALLBACK, fallback: true }
}
