import type { AppointmentService } from '../services/appointment.service'
import type { AppointmentRepository } from '../repositories/appointment.repository'
import type { ConversationService } from '../services/conversation.service'
import type { FichaService } from '../services/ficha.service'
import type { CampoFicha } from '../types/central.types'
import {
  SlotAlreadyBookedError,
  SlotInPastError,
  SlotNotInGradeError,
  AppointmentNotFoundError,
} from '../types/errors.types'
import { horaCurta } from './formato'
import { UNIDADES, unidadeDaSala, normalizarUnidade, type Unidade } from './unidade'
import { resolverTerapia, nomesOfertaveis, especialidadesNaGrade } from './terapia'
import { interpretarArgumentosTags, gruposFaltantesParaLead, ClassificacaoInvalidaError } from './tags'
import type { TagDefinition } from '../types/central.types'
import { TagDesconhecidaError, TagNaoAplicavelPelaMaiaError } from '../types/errors.types'

// ============================================================================
// Ferramentas do agente de atendimento
//
// Esta é a superfície que o modelo de linguagem pode acionar. Duas decisões
// definem o formato:
//
// 1. As ferramentas NÃO falam com o banco. Elas chamam o AppointmentService, o
//    mesmo que a página de Agendamentos usa. Toda regra — vaga tem que existir
//    na grade, não pode estar no passado, não pode estar prometida a outro,
//    cancelar devolve a vaga — vale igual para o humano e para a IA. Se o
//    agente tivesse caminho próprio até o banco, seria só questão de tempo até
//    as duas superfícies discordarem.
//
// 2. Toda ferramenta retorna { ok: true, ... } ou { ok: false, motivo, mensagem }
//    e NUNCA lança. Exceção que sobe até o orquestrador vira turno perdido: o
//    paciente fica sem resposta no WhatsApp. Falha é dado, não exceção — o
//    modelo recebe o motivo e reformula ("esse horário acabou de ser preenchido,
//    posso oferecer 09:20?").
//
// O campo `motivo` é código estável para o orquestrador ramificar; `mensagem` é
// texto em português que o modelo pode aproveitar direto na resposta.
// ============================================================================

export interface ContextoAgente {
  orgId:           string
  // Conversa e contato de onde a solicitação veio. Amarram o agendamento ao
  // histórico do WhatsApp — é o que permite depois responder "seu horário é…".
  contactId?:      string | null
  conversationId?: string | null
  // Paciente do TiTa, quando já identificado na conversa.
  titaPacienteId?: number | null
}

export type ResultadoFerramenta =
  | { ok: true;  [k: string]: unknown }
  | { ok: false; motivo: string; mensagem: string }

// Motivos de recusa. Estáveis porque o orquestrador ramifica neles.
export const MOTIVO = {
  VAGA_TOMADA:      'vaga_tomada',
  VAGA_INEXISTENTE: 'vaga_inexistente',
  VAGA_NO_PASSADO:  'vaga_no_passado',
  NAO_ENCONTRADO:   'nao_encontrado',
  SEM_VAGA:         'sem_vaga',
  ERRO_INTERNO:     'erro_interno',
} as const

// ----------------------------------------------------------------------------
// Definições no formato de function calling
//
// Descrições escritas para o modelo, não para o desenvolvedor: elas são o
// contrato que ele lê para decidir quando chamar cada ferramenta. Por isso
// dizem explicitamente o que NÃO fazer — inventar horário é o erro mais caro
// que um atendente automático comete, e o modelo só evita se for instruído.
//
// STRICT MODE
//
// Todas as funções declaram `strict: true`, e por isso os schemas obedecem às
// três exigências do modo estrito da OpenAI:
//
//   1. `additionalProperties: false` em todo objeto.
//   2. TODA propriedade listada em `required` — não existe chave opcional.
//   3. O que é logicamente opcional vira tipo anulável (`['string','null']`),
//      e o modelo manda `null` explicitamente quando não quer usar.
//
// A exigência (1) é a que mais importa aqui, e não por conformidade: com
// `additionalProperties: false` a própria API recusa argumento que não esteja
// no schema. Como nenhum schema declara orgId, contactId ou conversationId, o
// modelo fica impedido de sequer tentar enviá-los — a defesa passa a ser
// estrutural em vez de depender de o executor lembrar de ignorá-los. O guard em
// `executar()` continua existindo como segunda camada, para o caso de
// `strict` ser desligado ou de outro provedor não honrar a restrição.
//
// A exigência (3) não muda o comportamento do executor: ele já tratava campo
// ausente e `null` do mesmo jeito (`args.x ?? null`, `toInt()` devolvendo
// undefined, `tipoValido()` caindo em 'other').
// ----------------------------------------------------------------------------

export const DEFINICOES_FERRAMENTAS = [
  {
    type: 'function' as const,
    function: {
      name: 'consultar_especialidades_disponiveis',
      description:
        'Lista as especialidades (terapias) que têm vaga livre na agenda da clínica, com a quantidade de vagas ' +
        'e em quais unidades cada uma tem vaga. ' +
        'Use quando o responsável perguntar o que a clínica tem disponível, ou quando ele não disser qual terapia quer. ' +
        'Os nomes devolvidos aqui são os que consultar_horarios_disponiveis aceita em `terapia` — mas você não ' +
        'precisa chamar esta ferramenta antes: se o responsável já disse a especialidade, passe o nome direto.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          dataInicio: { type: ['string', 'null'], description: 'Início da busca, formato YYYY-MM-DD. Use null para começar hoje.' },
          dataFim:    { type: ['string', 'null'], description: 'Fim da busca, formato YYYY-MM-DD. Use null para usar hoje + 30 dias.' },
        },
        required: ['dataInicio', 'dataFim'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'consultar_horarios_disponiveis',
      description:
        'Lista horários realmente livres na agenda, com profissional e sala. NUNCA ofereça um horário que não tenha vindo desta ferramenta: ' +
        'a agenda da clínica só é populada algumas semanas à frente, e horários fora dela não existem. ' +
        'Se o responsável já disse em qual unidade quer ser atendido, passe esse valor em `unidade` — ' +
        'não filtre por conta própria olhando o campo `sala`, e não ofereça horário de outra unidade sem avisar. ' +
        'O mesmo vale para a especialidade: se a conversa já estabeleceu qual terapia é, passe `terapia` em TODA ' +
        'consulta seguinte, inclusive quando o responsável perguntar por outro dia. Sem ela a busca traz todas as ' +
        'especialidades e a que interessa pode ficar de fora do recorte. ' +
        'O resultado traz `listaCompleta`: quando for false, você está vendo só uma parte — nunca conclua ausência ' +
        'a partir de uma lista parcial. ' +
        'Ofereça no máximo 3 opções por mensagem para não sobrecarregar o responsável.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          terapia: {
            type: ['string', 'null'],
            description:
              'NOME da especialidade, como está no laudo do paciente e como você o diria ao responsável: ' +
              '"psicologia", "psicologia ABA", "fonoaudiologia", "terapia ocupacional". ' +
              'Acento e maiúscula não importam, e o nome parcial serve ("fono" encontra Fonoaudiologia). ' +
              'ATENÇÃO: "Psicologia" e "Psicologia ABA" são terapias DIFERENTES — passe exatamente a que o ' +
              'responsável pediu e nunca troque uma pela outra. ' +
              'Se o nome casar com mais de uma especialidade, a ferramenta devolve as opções: pergunte ao ' +
              'responsável qual delas é, não escolha por ele. ' +
              'null busca em todas as especialidades.',
          },
          unidade: {
            type: ['string', 'null'],
            // Derivado de UNIDADES, não repetido: o mesmo vocabulário é
            // validado no banco (p_unidade, que LANÇA em valor desconhecido) e
            // na rota HTTP. Três literais copiados em três lugares divergem no
            // dia em que um deles é editado.
            enum: [...UNIDADES, null],
            description: 'Unidade onde o responsável quer ser atendido. null para buscar nas três.',
          },
          dataInicio: {
            type: ['string', 'null'],
            description:
              'Início da busca, YYYY-MM-DD. OBRIGATÓRIO sempre que o responsável mencionar um dia, ' +
              'uma data ou um período ("terça", "dia 15", "semana que vem", "mês que vem"): passe a data ' +
              'correspondente aqui e a mesma (ou o fim do período) em dataFim. ' +
              'Esta lista é RECORTADA por `limite` a partir de dataInicio — se você não passar a data pedida, ' +
              'recebe as primeiras vagas da agenda inteira e NÃO fica sabendo nada sobre o dia perguntado. ' +
              'Nunca conclua que um dia não tem vaga sem ter consultado esse dia. null só para "a partir de hoje".',
          },
          dataFim: {
            type: ['string', 'null'],
            description:
              'Fim da busca, YYYY-MM-DD. Para um dia específico, repita o valor de dataInicio. ' +
              'null para hoje + 30 dias.',
          },
          limite: {
            type: ['integer', 'null'],
            description:
              'Máximo de horários a retornar. null usa o padrão de 20. ' +
              'Use um limite pequeno só quando já tiver recortado o período em dataInicio/dataFim — ' +
              'limite baixo sobre a agenda inteira devolve só os primeiros dias.',
          },
        },
        required: ['terapia', 'unidade', 'dataInicio', 'dataFim', 'limite'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'agendar_sessao',
      description:
        'Reserva uma vaga para o paciente. Os três parâmetros precisam vir EXATAMENTE de um horário devolvido por ' +
        'consultar_horarios_disponiveis — não monte a combinação por conta própria. ' +
        'Confirme com o responsável antes de chamar: esta ferramenta grava a reserva.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          // A description diz COPIE e avisa que o número é grande porque o
          // modelo mandou `1` para uma vaga cujo id é 8704 (21/09/2026). Um id
          // pequeno é o sintoma de um valor inventado: eles têm quatro ou cinco
          // dígitos, e "1" é o que sai quando se preenche um inteiro obrigatório
          // sem ter fonte para ele — o mesmo defeito que `terapiaId` teve.
          profissionalId: {
            type: 'integer',
            description:
              'COPIE o profissionalId do horário escolhido, exatamente como veio em consultar_horarios_disponiveis. '
              + 'São números de 4 ou 5 dígitos (ex.: 8704). NUNCA invente, deduza ou use um número pequeno como 1.',
          },
          data:           { type: 'string',  description: 'COPIE a data do horário escolhido, YYYY-MM-DD.' },
          hora:           { type: 'string',  description: 'COPIE a hora do horário escolhido, HH:MM.' },
          tipo: {
            type: ['string', 'null'],
            enum: ['triagem', 'retorno', 'reuniao', 'followup', 'other', null],
            description: 'triagem para primeira avaliação; retorno para paciente já em tratamento. null quando não souber.',
          },
          observacao: { type: ['string', 'null'], description: 'Informação que a recepção precisa saber (ex: preferência, restrição). null se não houver.' },
        },
        required: ['profissionalId', 'data', 'hora', 'tipo', 'observacao'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'consultar_agendamentos_do_contato',
      description:
        'Lista os agendamentos futuros já marcados para este contato. Use antes de reagendar ou cancelar, ' +
        'e quando o responsável perguntar quando é a próxima sessão. ' +
        'Não recebe parâmetro: o contato desta conversa é determinado pelo sistema.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reagendar_sessao',
      description:
        'Move um agendamento existente para outro horário livre. O horário de destino precisa ter vindo de ' +
        'consultar_horarios_disponiveis. Se o destino não estiver mais livre, o agendamento original é preservado.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          agendamentoId:  { type: 'string',  description: 'id do agendamento, obtido em consultar_agendamentos_do_contato.' },
          profissionalId: { type: 'integer', description: 'profissionalId do novo horário.' },
          data:           { type: 'string',  description: 'nova data, YYYY-MM-DD.' },
          hora:           { type: 'string',  description: 'nova hora, HH:MM.' },
          motivo:         { type: ['string', 'null'], description: 'Por que está sendo remarcado. null se o responsável não disser.' },
        },
        required: ['agendamentoId', 'profissionalId', 'data', 'hora', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cancelar_sessao',
      description:
        'Cancela um agendamento e devolve a vaga à agenda. Confirme com o responsável antes de chamar.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          agendamentoId: { type: 'string', description: 'id do agendamento, obtido em consultar_agendamentos_do_contato.' },
          motivo:        { type: ['string', 'null'], description: 'Motivo informado pelo responsável. null se não informado.' },
        },
        required: ['agendamentoId', 'motivo'],
        additionalProperties: false,
      },
    },
  },
] as const

// ----------------------------------------------------------------------------
// Ferramentas que NÃO dependem do interruptor de agendamento
//
// `DEFINICOES_FERRAMENTAS` acima só chega ao modelo quando
// `agent_settings.ai_scheduling_enabled` está ligado — é o botão de pânico da
// entrega, e ele precisa continuar desligando a agenda inteira de uma vez.
//
// Chamar gente não é agendar. Amarrar esta ferramenta àquele interruptor
// produziria o pior estado possível do sistema: com o agendamento desligado, a
// Maia conversa, não resolve nada e TAMBÉM não consegue passar para um humano.
// É justamente quando o agendamento está off que mais se precisa dela. Além
// disso, `ai_scheduling_enabled: false` é o default de uma instalação sem seed
// (agent-settings.ts falha fechada), então o caminho de pedir ajuda começaria
// morto.
//
// A lista efetiva do turno é montada no orquestrador, juntando os dois arrays.
// ----------------------------------------------------------------------------
export const FERRAMENTAS_SEMPRE = [
  {
    type: 'function' as const,
    function: {
      name: 'escalar_para_humano',
      // A description é o contrato que o modelo lê para decidir quando chamar.
      // As duas últimas frases são o conserto do defeito que motivou esta
      // ferramenta: o system prompt já mandava dizer "vou chamar alguém", o
      // modelo dizia, e ninguém era chamado. Dizer sem chamar é pior que não
      // dizer — a pessoa fica esperando um atendimento que ninguém pediu.
      description:
        'Passa esta conversa para uma pessoa da equipe e tira você do atendimento. '
        + 'Use quando o responsável pedir para falar com alguém, com um atendente, com a recepção ou com um humano; '
        + 'quando demonstrar irritação ou insatisfação com o atendimento; '
        + 'ou quando pedir algo que nenhuma outra ferramenta resolve e você não pode confirmar. '
        + 'CHAME ESTA FERRAMENTA ANTES de dizer que vai chamar alguém — dizer sem chamar deixa a pessoa esperando por um atendimento que não foi pedido. '
        + 'Depois que ela responder, escreva UMA mensagem curta avisando que alguém da equipe vai continuar. '
        + 'Não prometa prazo e não diga o nome de ninguém. '
        + 'Chame no máximo uma vez por conversa: se a resposta vier com jaEstavaEscalada, apenas fale com o responsável.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          // `motivoEscalada`, e não `motivo`, por uma razão de privacidade e não
          // de estilo: `motivo` já é parâmetro de reagendar_sessao e
          // cancelar_sessao, onde carrega texto livre do responsável e está
          // DELIBERADAMENTE fora de ARGUMENTOS_LOGAVEIS (orquestrador.ts). Este
          // precisa ser logado para a auditoria da escalada; se os dois
          // dividissem o nome, pôr um na allowlist vazaria o outro para o rastro.
          //
          // Enum fechado porque vai para o payload do evento: código estável que
          // dá para contar e filtrar, não frase que cada turno escreve diferente.
          motivoEscalada: {
            type: 'string',
            enum: ['pedido_do_usuario', 'insatisfacao', 'fora_do_alcance'],
            description:
              'pedido_do_usuario: pediu para falar com uma pessoa. '
              + 'insatisfacao: demonstrou irritação ou reclamou do atendimento. '
              + 'fora_do_alcance: precisa de algo que você não tem como resolver.',
          },
        },
        required: ['motivoEscalada'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'registrar_dados_do_paciente',
      // Esta ferramenta só é OFERECIDA quando o contato ainda não está vinculado
      // a um paciente do TiTa (o worker decide, ver deveColetar). Quem já é da
      // clínica tem esses campos no cadastro, e perguntar de novo soaria como se
      // a clínica não soubesse quem ele é.
      //
      // Retirar a capacidade é mais confiável que instruir a contenção: uma
      // regra de prompt dizendo "não pergunte a quem já é paciente" depende de o
      // modelo saber quem já é paciente, e ele não sabe.
      description:
        'Registra na ficha do paciente um dado que o responsável acabou de informar nesta conversa. '
        + 'Chame assim que ele disser qualquer um destes dados, mesmo que de passagem e mesmo um de cada vez. '
        + 'Envie APENAS os campos que ele realmente informou: mande null em todo o resto. '
        + 'NUNCA deduza, complete ou invente um valor — se ele disse só o primeiro nome, registre o primeiro nome. '
        + 'O nome do paciente é o da CRIANÇA que vai fazer as terapias; o nome do responsável é o de quem está falando com você. '
        + 'Quando a resposta vier dizendo que um campo foi recusado, use o motivo para perguntar de novo àquele ponto específico, sem repetir a pergunta igual.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          nomePaciente: {
            type: ['string', 'null'],
            description: 'Nome da criança que vai fazer as terapias, como o responsável falou. null se ele não disse.',
          },
          dataNascimento: {
            type: ['string', 'null'],
            description:
              'Data de nascimento da criança, como o responsável escreveu (ex.: "12/03/2019", "12 de março de 2019"). '
              + 'Não converta o formato. null se ele não disse.',
          },
          nomeResponsavel: {
            type: ['string', 'null'],
            description: 'Nome de quem está conversando com você e é responsável pela criança. null se ele não disse.',
          },
          turno: {
            type: ['string', 'null'],
            enum: ['manha', 'tarde', 'integral', 'indiferente', null],
            description:
              'Turno em que a criança pode fazer as terapias. '
              + 'Use indiferente quando ele disser que tanto faz — isso é uma resposta, não uma falta de resposta. '
              + 'null se o assunto não veio à tona.',
          },
          planoSaude: {
            type: ['string', 'null'],
            description: 'Nome do plano de saúde ou convênio, como o responsável falou. null se ele não disse.',
          },
        },
        required: ['nomePaciente', 'dataNascimento', 'nomeResponsavel', 'turno', 'planoSaude'],
        additionalProperties: false,
      },
    },
  },
] as const

// LIMITAÇÃO CONHECIDA: não há como deixar um recado para quem vai assumir.
//
// O desenho original tinha um parâmetro `resumo` — uma frase do que a pessoa
// precisa, para quem abrisse a conversa não começar do zero. Ele foi removido
// porque o schema não tem onde guardá-lo: não existe nota interna em `central`
// (nem tabela de notas, nem message_type para isso), e `payload` de auditoria
// não serve — é texto livre do responsável, que fica fora da trilha pela mesma
// razão que `motivo` fica fora do rastro de ferramentas.
//
// Coletar para descartar seria pior que não coletar: custaria tokens todo turno
// e daria a impressão, para quem lesse o schema, de que o recado chega a alguém.
// Quem assume lê o histórico da conversa, que tem o pedido original literal.
// Se um dia existir nota interna, é aqui que `resumo` volta.

export type NomeFerramenta =
  | typeof DEFINICOES_FERRAMENTAS[number]['function']['name']
  | typeof FERRAMENTAS_SEMPRE[number]['function']['name']
  // 'registrar_tags' fica fora dos dois arrays: seu schema é dinâmico
  // (enums vêm do catálogo da organização, ver agente/tags.ts), montado pelo
  // worker e anexado em DepsTurno.ferramentaTags — não cabe num `as const`.
  | 'registrar_tags'

// ----------------------------------------------------------------------------
// Executor
// ----------------------------------------------------------------------------

export class FerramentasAgente {
  constructor(
    private readonly agendamentos: AppointmentService,
    private readonly repo:         AppointmentRepository,
    private readonly contexto:     ContextoAgente,
    // Para `escalar_para_humano`. Opcional porque os testes das ferramentas de
    // agenda não precisam dele — e porque é melhor a ferramenta recusar dizendo
    // que não conseguiu transferir do que o worker explodir na construção.
    //
    // Vai por SERVICE e não por cliente supabase: "as ferramentas NÃO falam com o
    // banco" (ver o topo deste arquivo). A escalada tem regra — não mexer no
    // responsável, não rebaixar prioridade, auditar uma vez só — e essa regra
    // mora em ConversationService.escalarParaAtendimentoHumano, onde o worker
    // também a alcança.
    private readonly conversas:    ConversationService | null = null,
    // Para `registrar_dados_do_paciente`. Opcional pela mesma razão que
    // `conversas`: os testes das ferramentas de agenda não precisam dele, e é
    // melhor a ferramenta recusar dizendo que não conseguiu anotar do que o
    // worker explodir na construção e o responsável ficar sem resposta.
    //
    // Vai por SERVICE, não por cliente supabase: "as ferramentas NÃO falam com o
    // banco" (topo deste arquivo). A regra de que o cadastro do TiTa vence o que
    // a Maia ouviu mora em FichaService, onde o painel também a alcança — se a
    // ferramenta tivesse caminho próprio, as duas superfícies discordariam.
    private readonly fichas:       FichaService | null = null,
    // Para `registrar_tags`. Mesmo catálogo (TagDefinitionRepository.porGrupo)
    // usado para montar o schema da ferramenta (agente/tags.ts) — precisa
    // estar aqui de novo porque a validação e o merge por grupo em
    // ConversationService.atualizarTags também dependem dele. Opcional pela
    // mesma razão das demais: sem ele, a ferramenta recusa.
    private readonly porGrupoTags: Map<string, TagDefinition[]> | null = null,
  ) {}

  // A escalada pedida NESTE turno, ou null. Lida pelo worker depois de
  // `executarTurno`.
  //
  // POR QUE ESTE ESTADO EXISTE
  //
  // Escalar é a única ferramenta cujo efeito o worker precisa conhecer. As de
  // agenda terminam em si mesmas: o modelo lê o resultado, responde, e o turno
  // segue. Esta muda quem atende — e se o turno MORRER depois dela (o modelo
  // trunca, entra em loop, o provider cai), a conversa fica 'off' com o
  // responsável sem receber nada. Como a Maia acabou de ser desligada, nenhum
  // turno futuro vai falar com ele: o silêncio é permanente, não temporário.
  //
  // O worker usa este flag para garantir a despedida mesmo nesses caminhos.
  //
  // O escopo é o turno porque a instância é construída uma vez por turno no
  // worker. Não é estado global, e não sobrevive à conversa seguinte.
  private escalouNesteTurno: { motivoEscalada: string } | null = null

  // As vagas que ESTE turno ofereceu ao modelo, para `agendar_sessao` conferir
  // contra elas. Escopo de turno, como `escalouNesteTurno`: a instância é
  // construída uma vez por turno no worker.
  //
  // Guardar o mínimo — a identidade da vaga e o nome de quem atende — porque é
  // só isso que a conferência precisa devolver numa recusa. O resto da vaga
  // (sala, terapia, unidade) já foi para o modelo e não ajuda a corrigir um id.
  private vagasOferecidas: { profissionalId: number; data: string; hora: string; profissional: string | null }[] = []

  escaladaPedida(): { motivoEscalada: string } | null {
    return this.escalouNesteTurno
  }

  // Ponto único de entrada. Recebe o nome e os argumentos crus vindos do
  // modelo — nada aqui confia no formato, porque o modelo erra.
  //
  // Os argumentos passam por semChavesDeContexto() antes de qualquer uso: o
  // modelo não decide de qual organização, contato ou conversa é a operação.
  async executar(nome: string, argumentos: unknown): Promise<ResultadoFerramenta> {
    const args = semChavesDeContexto((argumentos ?? {}) as Record<string, unknown>)
    try {
      switch (nome) {
        case 'consultar_especialidades_disponiveis': return await this.consultarEspecialidades(args)
        case 'consultar_horarios_disponiveis':       return await this.consultarHorarios(args)
        case 'agendar_sessao':                       return await this.agendar(args)
        case 'consultar_agendamentos_do_contato':    return await this.consultarDoContato()
        case 'reagendar_sessao':                     return await this.reagendar(args)
        case 'cancelar_sessao':                      return await this.cancelar(args)
        case 'escalar_para_humano':                  return await this.escalarParaHumano(args)
        case 'registrar_dados_do_paciente':          return await this.registrarDadosDoPaciente(args)
        case 'registrar_tags':                       return await this.registrarTags(args)
        default:
          return recusa(MOTIVO.ERRO_INTERNO, `Ferramenta desconhecida: ${nome}`)
      }
    } catch (err) {
      return this.traduzirErro(err)
    }
  }

  private async consultarEspecialidades(args: Record<string, any>): Promise<ResultadoFerramenta> {
    // O que é oferecido sai do CATÁLOGO (terapia.ts), não do vocabulário cru da
    // grade, e a diferença é grande em duas direções.
    //
    // O que a grade traz em `terapia_nome` é a lista do que aquele profissional
    // atende naquele horário, na língua da ESCALA: 'Aplicador ABA (PS),
    // Coordenador de Caso'. Devolver isso ao modelo produzia dois danos:
    //
    //   1. O agente oferecia cargo interno como se fosse terapia. Medido em
    //      05/09/2026: 'Coordenador de Caso' (586 vagas) e 'Supervisão ABA'
    //      (319) apareciam na resposta a "o que vocês têm disponível?".
    //   2. O agente falava a língua errada. 'Aplicador ABA (PS)' (218 vagas) é
    //      o que o TiTa grava; o laudo do responsável diz 'Psicologia ABA'.
    //
    // O catálogo resolve os dois: só o ofertável entra, e com o nome do laudo.
    const vagas = await this.agendamentos.listarNomesDeTerapiaComVaga(
      args.dataInicio ?? null,
      args.dataFim ?? null,
    )
    const disponiveis = especialidadesNaGrade(vagas)

    if (disponiveis.length === 0) {
      return recusa(
        MOTIVO.SEM_VAGA,
        'Não há vaga livre na agenda no período consultado. A agenda costuma ser aberta algumas semanas antes.',
      )
    }

    return {
      ok: true,
      // Nem `terapiaId` nem contagem de vagas vão aqui, e as duas omissões são
      // deliberadas.
      //
      // O id: enquanto aparecia, o modelo tinha um número para carregar pela
      // conversa e reescrever quando a memória escorregasse — foi assim que
      // psicologia (2259) virou `terapiaId: 1`. Consultar horários pede o NOME,
      // então o id não tem uso do lado do modelo, e o que ele não vê ele não
      // inventa.
      //
      // A contagem: ela vinha de um `group by terapia_id`, e o id não
      // corresponde às especialidades do catálogo (2317 tem sete nomes). Um
      // número aproximado que o modelo repetiria ao responsável como se fosse
      // exato é pior que número nenhum.
      especialidades: disponiveis.map(nome => ({
        nome,
        // Em QUAIS unidades essa especialidade tem vaga. Sem isso o agente
        // responde "sim, temos psicomotricidade" para quem já disse que só pode
        // ir a Padre Miguel, e só descobre que não tem lá no passo seguinte.
        //
        // Derivado por nome, não pelo `group by terapia_id` de antes: aquela
        // agregação atribuía as unidades ao id, e como o id não corresponde à
        // especialidade, uma terapia podia herdar a unidade de outra que
        // compartilhasse o id.
        unidades: UNIDADES.filter(u =>
          vagas.some(v => v.unidade === u && especialidadesNaGrade([v]).includes(nome)),
        ),
      })),
    }
  }

  private async consultarHorarios(args: Record<string, any>): Promise<ResultadoFerramenta> {
    const limite  = clampInt(args.limite, 1, 50, 20)
    const unidade = normalizarUnidade(args.unidade)

    // Unidade pedida mas não reconhecida: recusa amigável, não exceção de SQL.
    // O enum do schema já restringe, mas essa é a primeira camada — `strict`
    // pode ser desligado e outro provedor pode não honrar o enum. Sem esta
    // guarda, um 'Realango' viraria erro 22023 do banco (o parâmetro é validado
    // lá de propósito), e o turno vira mensagem de erro em vez de pergunta.
    // Mesmo princípio de semChavesDeContexto(): não confiar no formato.
    if (args.unidade != null && unidade == null) {
      return recusa(
        MOTIVO.ERRO_INTERNO,
        `Unidade '${args.unidade}' não existe. As unidades são: ${UNIDADES.join(', ')}. ` +
        'Pergunte ao responsável em qual delas ele quer ser atendido.',
      )
    }

    // A especialidade chega por NOME, e o que sai daqui são os textos que casam
    // na GRADE — não um id.
    //
    // O parâmetro era `terapiaId`, e o modelo o inventava: perguntada por
    // psicologia a partir do dia 14 (04/09/2026, no rastro), a IA passou
    // `terapiaId: 1` — psicologia é 2259, e ela tinha usado o id certo um minuto
    // antes. Três reforços de prompt não impediram, porque não era
    // desobediência: o id só existe no retorno de outra ferramenta, o schema
    // exigia um inteiro, e `null` significa "todas as terapias". Ele preenchia
    // um campo obrigatório sem ter fonte para ele.
    //
    // E o id não serviria nem se o modelo o soubesse: medido em produção,
    // `terapia_id` 2317 aparece com sete `terapia_nome` diferentes. Filtrar por
    // ele mistura quem só aplica ABA com quem faz psicologia, e esconde as 12
    // vagas de psicologia que vivem sob 2317. A informação está no nome.
    //
    // A resolução é contra o que TEM vaga no período: uma especialidade sem vaga
    // na janela não é resolvível, e isso é correto — o retorno seria vazio de
    // todo jeito, e a recusa nomeada explica melhor do que `sem_vaga`.
    let terapiaNomes: readonly string[] | undefined
    let nomeResolvido: string | undefined
    if (args.terapia != null && String(args.terapia).trim() !== '') {
      const naGrade     = await this.agendamentos.listarNomesDeTerapiaComVaga(
        args.dataInicio ?? null,
        args.dataFim ?? null,
      )
      const disponiveis = especialidadesNaGrade(naGrade)
      const resolucao   = resolverTerapia(String(args.terapia), disponiveis)

      if (resolucao.tipo === 'nao_encontrada') {
        // ERRO_INTERNO, não SEM_VAGA: os dois são indistinguíveis para o modelo
        // se a mensagem não os separar, e tratá-lo como "não tem vaga" é
        // exatamente o dano que se quer impedir — a agenda pode estar cheia.
        const nomes = nomesOfertaveis(disponiveis)
        return recusa(
          MOTIVO.ERRO_INTERNO,
          `Não há especialidade chamada '${args.terapia}' entre as que têm vaga no período. ` +
          'NÃO diga ao responsável que não há horário: o nome não foi reconhecido, o que não é o mesmo ' +
          'que a agenda estar vazia. ' +
          (nomes.length > 0
            ? `As especialidades com vaga são: ${nomes.join('; ')}. ` +
              'Use um destes nomes, ou pergunte ao responsável qual delas ele quer.'
            : 'Não há nenhuma especialidade com vaga no período consultado.'),
        )
      }

      if (resolucao.tipo === 'ambigua') {
        // Escolher a primeira seria o mesmo erro do chute, do nosso lado — e
        // aqui o custo é a criança ir para a terapia errada: 'psico' começa
        // Psicologia, Psicologia ABA, Psicopedagogia e Psicomotricidade, que são
        // quatro tratamentos distintos. A pergunta ao responsável é a resposta
        // certa, e o modelo só a faz se receber os candidatos.
        return recusa(
          MOTIVO.ERRO_INTERNO,
          `'${args.terapia}' corresponde a mais de uma especialidade: ${resolucao.candidatas.join('; ')}. ` +
          'Pergunte ao responsável qual delas ele quer e consulte de novo com o nome completo. ' +
          'NÃO escolha por ele: são tratamentos diferentes.',
        )
      }

      terapiaNomes  = resolucao.casaCom
      nomeResolvido = resolucao.nome
    }

    // O filtro por unidade acontece NO BANCO (p_unidade, 20260904100100), e é
    // isso que faz o `limite` poder ir junto: antes, com o filtro em memória,
    // era preciso pedir 500 e cortar depois — e como 500 é o teto da RPC, uma
    // unidade sem vaga nas 500 primeiras linhas virava "não tem vaga" falso.
    // Agora o teto vale por unidade. Não volte a filtrar aqui.
    //
    // Pedimos UMA A MAIS que o limite para saber se a lista foi truncada. Sem
    // isso a ferramenta devolve N itens e o modelo não tem como distinguir "a
    // agenda tem exatamente N" de "a agenda tem muito mais e você viu os N
    // primeiros" — e ele trata os dois como a mesma coisa.
    //
    // O caso que motivou isto (04/09/2026, no rastro): perguntada por psicologia
    // em Realengo no dia 14, a IA consultou o dia certo mas sem terapiaId, com
    // limite 20. O dia tinha 78 vagas de várias especialidades e a única de
    // psicologia estava na POSIÇÃO 76 — porque é às 17:00, e a ordenação é por
    // hora. Ela viu 20, não achou psicologia, e respondeu que não havia. A vaga
    // existia.
    //
    // Nenhuma instrução de prompt conserta isso sozinha: o modelo estava
    // raciocinando sobre uma lista que ele tinha motivo para achar completa.
    // Sem filtro de especialidade, a consulta traz a agenda inteira — incluindo
    // 'Coordenador de Caso' (586 vagas), 'Supervisão ABA' (319) e 'Aplicador
    // Suporte' (40), que são trabalho interno e não atendimento que um
    // responsável agenda. Elas precisam sair, e SAIR AQUI custa folga.
    //
    // A folga é generosa de propósito. Cortar em `limite + 1` e filtrar depois
    // reintroduziria, na dimensão da especialidade, exatamente o defeito de teto
    // que este trabalho consertou na dimensão da unidade: as 586 vagas de
    // 'Coordenador de Caso' ocupariam as primeiras posições da ordenação por
    // data/hora e empurrariam a terapia real para fora do recorte, e a
    // ferramenta responderia "não há vaga" sobre uma agenda cheia.
    //
    // Quando `terapiaNomes` veio, o banco já filtrou: a folga é desnecessária e
    // `limite + 1` basta para detectar truncamento.
    const folga = terapiaNomes ? limite + 1 : Math.min(500, Math.max(limite * 10, 100))

    const brutas = await this.agendamentos.listarVagas({
      terapiaNomes,
      unidade,
      dataInicio: args.dataInicio ?? null,
      dataFim:    args.dataFim ?? null,
      limite:     folga,
    })

    const comFolga = terapiaNomes
      ? brutas
      : brutas.filter(v => especialidadesNaGrade([v]).length > 0)

    // `truncado` responde "há mais além do que você está vendo?". Com filtro, a
    // folga é limite+1 e a comparação é direta. Sem filtro, a lista pode ter
    // encolhido pelo descarte de cargo interno, mas se o banco devolveu a folga
    // INTEIRA ainda há mais adiante — e isso continua sendo truncamento, mesmo
    // que o que sobrou caiba no limite.
    const truncado = comFolga.length > limite || brutas.length >= folga
    const vagas    = comFolga.slice(0, limite)

    if (vagas.length === 0) {
      // Distinguir os dois casos muda a resposta ao responsável: "não temos
      // essa terapia" é diferente de "temos, mas não nessa unidade". Sem essa
      // distinção o agente descarta a especialidade inteira.
      //
      // Isso exige saber onde a terapia TEM vaga, e o filtro no banco tirou
      // essa informação da primeira consulta. A segunda ida acontece só neste
      // ramo — vazio E com unidade — que é raro e já é o caminho lento. O
      // preço é uma consulta; o de não fazê-la é o agente dizer "não temos"
      // quando tem, na unidade ao lado.
      if (unidade) {
        const emOutras = await this.agendamentos.listarVagas({
          terapiaNomes,
          dataInicio: args.dataInicio ?? null,
          dataFim:    args.dataFim ?? null,
          limite:     20,
        })
        const outras = [...new Set(emOutras.map(v => v.unidade).filter((u): u is Unidade => u != null))]
        if (outras.length > 0) {
          return recusa(
            MOTIVO.SEM_VAGA,
            `Não há horário livre para essa especialidade na unidade ${unidade}. ` +
            `Há vaga em: ${outras.join(', ')}. Diga isso ao responsável e pergunte se ele aceita outra unidade ou outra especialidade em ${unidade}.`,
          )
        }
        return recusa(
          MOTIVO.SEM_VAGA,
          `Não há horário livre para essa especialidade na unidade ${unidade}.`,
        )
      }
      return recusa(
        MOTIVO.SEM_VAGA,
        'Nenhum horário livre para essa combinação. Ofereça outra especialidade ou outro período.',
      )
    }

    // Registra o que está sendo oferecido, para `agendar_sessao` poder dizer
    // "o id é 8704, não 1" em vez de "consulte de novo". ACUMULA entre chamadas
    // do mesmo turno: o modelo consulta terça, depois quarta, e o responsável
    // pode escolher da primeira lista — descartar a anterior recusaria uma
    // escolha legítima.
    for (const v of vagas) {
      this.vagasOferecidas.push({
        profissionalId: v.profissional_id,
        data:           v.data,
        // `horaCurta` devolve null para hora ausente. Uma vaga sem hora não é
        // agendável e não precisa entrar na conferência — mas cair para '' em
        // vez de null mantém a comparação simples e nunca casa com o que o
        // modelo envia (ele manda 'HH:MM' ou a chamada já falha na guarda).
        hora:           horaCurta(v.hora_inicial) ?? '',
        profissional:   v.profissional_nome,
      })
    }

    return {
      ok: true,
      horarios: vagas.map(v => ({
        // Estes três campos são a identidade da vaga; agendar_sessao precisa
        // deles de volta sem alteração.
        profissionalId: v.profissional_id,
        data:           v.data,
        hora:           horaCurta(v.hora_inicial),
        // Contexto para o modelo compor a frase
        diaSemana:    v.dia_semana,
        horaFim:      horaCurta(v.hora_final),
        profissional: v.profissional_nome,
        // A especialidade na língua do LAUDO, não na da escala.
        //
        // `v.terapia_nome` é o que o TiTa grava — 'Aplicador ABA (PS),
        // Coordenador de Caso'. Mandá-lo ao modelo fazia o agente dizer ao
        // responsável que tem horário de "Aplicador ABA (PS)", um nome que ele
        // nunca viu: o laudo dele diz 'Psicologia ABA'. E expunha cargo interno
        // ('Coordenador de Caso') como se fizesse parte da oferta.
        //
        // Quando a busca foi por especialidade, o nome resolvido é a resposta
        // exata. Sem filtro, a vaga pode oferecer várias — aí vão as ofertáveis
        // que ela cobre, e nunca os nomes de escala.
        terapia:      nomeResolvido ?? especialidadesNaGrade([v]).join(', '),
        sala:         v.sala_nome,
        // A unidade real, agora resolvida no banco (central.vw_vagas_livres).
        // `v.unidade_nome` é 'CLÍNICA UNIVERSO ABA' em toda vaga e não
        // distingue endereço nenhum — mandá-lo para o modelo fazia as três
        // unidades parecerem uma só, e não é ele que vai aqui.
        unidade:      v.unidade,
      })),
      // A lista está completa, ou é só o começo?
      //
      // Esta é a informação cuja AUSÊNCIA fez a IA negar uma vaga que existia:
      // ela recebeu 20 de 78 e raciocinou como se fossem 78. `listaCompleta:
      // false` é o que a impede de tratar um recorte como a agenda inteira.
      //
      // O aviso vem em português e diz o que fazer, não só o que houve: o modelo
      // age sobre instrução muito mais do que sobre um booleano.
      listaCompleta: !truncado,
      ...(truncado ? {
        aviso:
          `Esta lista é PARCIAL: há mais horários além destes ${limite}. ` +
          (terapiaNomes == null
            ? 'Ela cobre TODAS as especialidades, então a que o responsável quer pode não estar aqui — ' +
              'chame de novo passando `terapia` para ver só a dela. '
            : '') +
          'NÃO conclua que não há vaga para uma especialidade, um dia ou um horário só porque não aparece nesta lista — ' +
          'refine a busca (terapia, dataInicio/dataFim) e consulte de novo antes de responder.',
      } : {}),
    }
  }

  private async agendar(args: Record<string, any>): Promise<ResultadoFerramenta> {
    const profissionalId = toInt(args.profissionalId)
    if (profissionalId == null || !args.data || !args.hora) {
      return recusa(
        MOTIVO.ERRO_INTERNO,
        'Faltam profissionalId, data ou hora. Consulte os horários disponíveis e use exatamente os valores retornados.',
      )
    }

    // ------------------------------------------------------------------------
    // A vaga precisa ser uma das que ESTA conversa ofereceu.
    //
    // O DEFEITO QUE ISTO CONSERTA (medido em 21/09/2026, conversa das 15:21)
    //
    // O modelo chamou `agendar_sessao` com `profissionalId: 1` para reservar o
    // horário da Thais, cujo id é 8704 e que ele tinha acabado de listar. O
    // banco respondeu `vaga_inexistente`, a ferramenta devolveu "consulte os
    // horários novamente e use exatamente um deles", ele consultou, recebeu a
    // MESMA lista e chamou de novo com `profissionalId: 1`. Duas vezes, até o
    // turno acabar — o responsável disse "sim" e nunca foi agendado.
    //
    // O detector de laço do orquestrador não pega isto: ele compara assinaturas
    // dentro de UM turno, e aqui cada tentativa veio num turno diferente,
    // separada por uma mensagem do responsável.
    //
    // POR QUE A RECUSA ANTIGA ALIMENTAVA O LAÇO
    //
    // Ela mandava fazer exatamente o que acabara de falhar, sem dizer QUAL dos
    // três campos estava errado. Para o modelo, "use exatamente um deles" já
    // descrevia o que ele acreditava ter feito — então ele repetia. Uma recusa
    // que não distingue as causas não é acionável, e uma instrução que manda
    // repetir a ação fracassada é um convite ao laço.
    //
    // A validação local existe porque ela sabe algo que o banco não sabe: QUAIS
    // vagas foram oferecidas nesta conversa. O banco só pode dizer "essa
    // combinação não existe na grade"; aqui dá para dizer "o id é 8704, não 1".
    // ------------------------------------------------------------------------
    const conferencia = this.conferirVagaOferecida(profissionalId, String(args.data), String(args.hora))
    if (conferencia) return conferencia

    const criado = await this.agendamentos.agendarVaga(this.contexto.orgId, {
      profissionalId,
      data:            String(args.data),
      hora:            String(args.hora),
      tipo:            tipoValido(args.tipo),
      descricao:       args.observacao ? String(args.observacao) : null,
      contactId:       this.contexto.contactId ?? null,
      conversationId:  this.contexto.conversationId ?? null,
      titaPacienteId:  this.contexto.titaPacienteId ?? null,
      criadoPorIa:     true,
    }, null)   // actorId null: quem agendou foi o agente, não um operador

    return {
      ok: true,
      agendamentoId: criado.id,
      confirmacao: {
        data:         criado.date,
        hora:         horaCurta(criado.time),
        duracaoMin:   criado.duration,
        profissional: criado.profissional_nome,
        terapia:      criado.terapia_nome,
        sala:         criado.sala_nome,
        unidade:      unidadeDaSala(criado.sala_nome),
      },
      // O agente não deve prometer que já está no sistema oficial da clínica.
      avisoInterno: 'Reserva registrada no atendimento. O lançamento no TiTa é feito pela recepção.',
    }
  }

  private async consultarDoContato(): Promise<ResultadoFerramenta> {
    if (!this.contexto.contactId) {
      return recusa(MOTIVO.NAO_ENCONTRADO, 'Não há contato identificado nesta conversa.')
    }

    const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const de = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`

    const { data } = await this.repo.list({
      orgId:     this.contexto.orgId,
      contactId: this.contexto.contactId,
      from:      de,
      // Só o que ocupa vaga: cancelado e falta não são "agendamento futuro".
      status:    ['scheduled', 'confirmed'],
      limit:     20,
      offset:    0,
    })

    if (data.length === 0) {
      return recusa(MOTIVO.NAO_ENCONTRADO, 'Este contato não tem agendamento futuro.')
    }

    return {
      ok: true,
      agendamentos: data.map(a => ({
        agendamentoId: a.id,
        data:          a.date,
        hora:          horaCurta(a.time),
        profissional:  a.profissional_nome,
        terapia:       a.terapia_nome,
        sala:          a.sala_nome,
        status:        a.status,
      })),
    }
  }

  private async reagendar(args: Record<string, any>): Promise<ResultadoFerramenta> {
    const profissionalId = toInt(args.profissionalId)
    if (!args.agendamentoId || profissionalId == null || !args.data || !args.hora) {
      return recusa(MOTIVO.ERRO_INTERNO, 'Faltam agendamentoId, profissionalId, data ou hora.')
    }

    const novo = await this.agendamentos.reagendar(
      this.contexto.orgId,
      String(args.agendamentoId),
      { profissionalId, data: String(args.data), hora: String(args.hora) },
      null,
      args.motivo ? String(args.motivo) : null,
    )

    return {
      ok: true,
      agendamentoId: novo.id,
      confirmacao: {
        data:         novo.date,
        hora:         horaCurta(novo.time),
        profissional: novo.profissional_nome,
        terapia:      novo.terapia_nome,
        sala:         novo.sala_nome,
      },
    }
  }

  private async cancelar(args: Record<string, any>): Promise<ResultadoFerramenta> {
    if (!args.agendamentoId) {
      return recusa(MOTIVO.ERRO_INTERNO, 'Falta agendamentoId.')
    }

    const cancelado = await this.agendamentos.cancelar(
      this.contexto.orgId,
      String(args.agendamentoId),
      null,
      args.motivo ? String(args.motivo) : null,
    )

    return {
      ok: true,
      agendamentoId: cancelado.id,
      cancelado: { data: cancelado.date, hora: horaCurta(cancelado.time) },
    }
  }

  // --------------------------------------------------------------------------
  // escalar_para_humano
  //
  // A única ferramenta que muda QUEM ATENDE em vez de mexer na agenda. Tudo o que
  // ela decide já está em ConversationService.escalarParaAtendimentoHumano — aqui
  // só se resolve o que é específico do agente: não escalar duas vezes no mesmo
  // turno, e dizer ao modelo o que fazer em seguida.
  //
  // NUNCA RECUSA POR JÁ ESTAR ESCALADA. Uma recusa é um sinal de "tente outra
  // coisa", e a outra coisa que o modelo tentaria é pior: insistir com argumentos
  // diferentes, ou pior ainda, desistir e não avisar o responsável. Já escalada é
  // sucesso — o estado desejado foi alcançado, só não por esta chamada.
  // --------------------------------------------------------------------------
  private async escalarParaHumano(args: Record<string, any>): Promise<ResultadoFerramenta> {
    const motivoEscalada = MOTIVOS_ESCALADA.includes(String(args.motivoEscalada))
      ? String(args.motivoEscalada)
      // O enum do schema já restringe, mas `strict` pode ser desligado para
      // depurar e outro provedor pode não honrar a restrição. Cair num valor
      // válido é melhor que gravar lixo na auditoria ou recusar a escalada por
      // causa de um rótulo — o que importa é a conversa chegar ao humano.
      : 'fora_do_alcance'

    // Segunda chamada no mesmo turno. O detector de laço do orquestrador pega a
    // repetição EXATA (mesmo nome, mesmo JSON), mas não a que troca o motivo —
    // e aquela chegaria aqui. Sem esta guarda seriam duas idas ao banco e dois
    // eventos para a mesma decisão.
    if (this.escalouNesteTurno) {
      return {
        ok: true,
        escalada: true,
        jaEstavaEscalada: true,
        avisoInterno: AVISO_JA_ESCALADA,
      }
    }

    if (!this.conversas) {
      // Sem o serviço não há como escalar. É falha de montagem (o worker não
      // passou a dependência), não algo que o modelo possa contornar — por isso
      // a mensagem manda ele parar de tentar e ser honesto com o responsável.
      return recusa(
        MOTIVO.ERRO_INTERNO,
        'Não consegui transferir para a equipe agora. Diga ao responsável que a equipe vai retornar por aqui e não repita a tentativa.',
      )
    }

    const conversationId = this.contexto.conversationId
    if (!conversationId) {
      return recusa(
        MOTIVO.ERRO_INTERNO,
        'Não consegui transferir para a equipe agora. Diga ao responsável que a equipe vai retornar por aqui e não repita a tentativa.',
      )
    }

    const { jaEstavaEscalada } = await this.conversas.escalarParaAtendimentoHumano(
      conversationId,
      motivoEscalada,
      'ferramenta_agente',
    )

    // Só DEPOIS da escrita bem-sucedida. Se `escalarParaAtendimentoHumano`
    // lançar, o catch de `executar()` devolve a recusa e este flag continua null
    // — é o que impede o worker de mandar a despedida de uma escalada que não
    // aconteceu.
    this.escalouNesteTurno = { motivoEscalada }

    return {
      ok: true,
      escalada: true,
      jaEstavaEscalada,
      avisoInterno: jaEstavaEscalada ? AVISO_JA_ESCALADA : AVISO_ESCALADA_NOVA,
    }
  }

  // --------------------------------------------------------------------------
  // registrar_dados_do_paciente
  //
  // Anota na ficha o que o responsável acabou de informar. O modelo manda os
  // cinco campos (strict exige todos), e quase sempre quatro deles são null.
  //
  // O RETORNO É A PRÓXIMA PERGUNTA DELA
  //
  // Esta ferramenta devolve `faltam` e, quando algo foi recusado, o motivo em
  // português. Não é diagnóstico para o log: é o que o modelo lê para decidir o
  // que perguntar em seguida. Uma recusa genérica ("valor inválido") faria a
  // Maia repetir a mesma pergunta com as mesmas palavras — e a repetição exata
  // cai no detector de laço do orquestrador, que escala a conversa para um
  // humano por causa de uma data mal digitada.
  // --------------------------------------------------------------------------
  private async registrarDadosDoPaciente(args: Record<string, any>): Promise<ResultadoFerramenta> {
    if (!this.fichas || !this.contexto.contactId) {
      // Falha de montagem, não algo que o modelo possa contornar. A mensagem
      // manda seguir a conversa: não anotar o nome não é motivo para interromper
      // um atendimento que está funcionando.
      return recusa(
        MOTIVO.ERRO_INTERNO,
        'Não consegui anotar agora. Siga a conversa normalmente e não repita a tentativa.',
      )
    }

    const { gravados, recusados } = await this.fichas.registrar(
      this.contexto.orgId,
      this.contexto.contactId,
      {
        patient_name:  texto(args.nomePaciente),
        birth_date:    texto(args.dataNascimento),
        guardian_name: texto(args.nomeResponsavel),
        shift:         texto(args.turno),
        health_plan:   texto(args.planoSaude),
      },
      'ia',
    )

    if (gravados.length === 0 && recusados.length === 0) {
      // O modelo chamou sem nada dentro. Acontece quando ele "confirma" um dado
      // que já tinha anotado — dizer isso evita que ele chame de novo.
      return {
        ok: true,
        anotado: false,
        avisoInterno: 'Nada novo para anotar. Continue a conversa e chame esta ferramenta só quando o responsável informar um dado novo.',
      }
    }

    const ficha = await this.fichas.montar(this.contexto.orgId, this.contexto.contactId)

    return {
      ok: true,
      anotado: gravados.length > 0,
      // Nomes em português, porque quem lê isto é o modelo montando a próxima
      // frase — não um desenvolvedor lendo um log.
      faltam: ficha.faltantes.map((c) => ROTULO_CAMPO[c]),
      ...(recusados.length > 0 && {
        recusados: recusados.map((r) => ({ campo: ROTULO_CAMPO[r.campo], motivo: r.motivo })),
      }),
      avisoInterno: ficha.faltantes.length === 0
        ? 'A ficha está completa. Não pergunte mais nada sobre cadastro.'
        : 'Não pergunte tudo de uma vez: siga o assunto da conversa e pergunte UM item por vez, quando fizer sentido.',
    }
  }

  // --------------------------------------------------------------------------
  // registrar_tags
  //
  // Grava a classificação nos 13 grupos da taxonomia. Devolve `faltam` (Regra
  // 1: sinaliza, não bloqueia) para a Maia saber o que ainda falta perguntar
  // quando o contato for lead — mesmo padrão de `registrarDadosDoPaciente`.
  // --------------------------------------------------------------------------
  private async registrarTags(args: Record<string, any>): Promise<ResultadoFerramenta> {
    if (!this.conversas || !this.porGrupoTags || !this.contexto.conversationId) {
      return recusa(
        MOTIVO.ERRO_INTERNO,
        'Não consegui registrar as tags agora. Siga a conversa normalmente e não repita a tentativa.',
      )
    }

    let classificacao
    try {
      classificacao = interpretarArgumentosTags(args, this.porGrupoTags)
    } catch (err) {
      if (err instanceof ClassificacaoInvalidaError) {
        // Devolve o motivo ao modelo — ele reformula na próxima chamada, em
        // vez de repetir os mesmos argumentos inválidos (o que cairia no
        // detector de laço do orquestrador).
        return recusa(MOTIVO.ERRO_INTERNO, `Classificação inválida: ${err.message}. Corrija e chame de novo.`)
      }
      throw err
    }

    // Achata para o formato que ConversationService.atualizarTags espera:
    // grupos single como string|null, grupos multi como array — só entram os
    // grupos que vieram não-vazios, porque um grupo ausente do objeto não
    // mexe no que já está gravado (ver o comentário de atualizarTags).
    const porGrupoValores: Record<string, string | string[] | null> = {}
    const entradas = Object.entries(classificacao) as [string, string | string[] | null][]
    for (const [grupo, valor] of entradas) {
      if (grupo === 'objecao') continue
      if (Array.isArray(valor)) {
        if (valor.length > 0) porGrupoValores[grupo] = valor
      } else if (valor !== null) {
        porGrupoValores[grupo] = valor
      }
    }

    if (Object.keys(porGrupoValores).length === 0 && classificacao.objecao === null) {
      return {
        ok: true,
        aplicado: false,
        avisoInterno: 'Nada novo para classificar. Chame esta ferramenta só quando uma informação nova aparecer ou mudar.',
      }
    }

    let tagsResultantes: string[]
    try {
      const resultado = await this.conversas.atualizarTags(
        this.contexto.conversationId,
        porGrupoValores,
        this.porGrupoTags,
        'maia',
        null,
      )
      tagsResultantes = resultado.tagsResultantes
    } catch (err) {
      if (err instanceof TagDesconhecidaError || err instanceof TagNaoAplicavelPelaMaiaError) {
        return recusa(MOTIVO.ERRO_INTERNO, `Classificação inválida: ${err.message}. Corrija e chame de novo.`)
      }
      throw err
    }

    if (classificacao.objecao !== null) {
      await this.conversas.atualizarObjecao(this.contexto.conversationId, classificacao.objecao)
    }

    return {
      ok:      true,
      aplicado: true,
      faltam:  gruposFaltantesParaLead(classificacao, tagsResultantes, this.porGrupoTags),
    }
  }

  // --------------------------------------------------------------------------
  // A vaga pedida está entre as oferecidas? Devolve a recusa, ou null se passa.
  //
  // Três casos, três mensagens DIFERENTES — e é a diferença que quebra o laço:
  // uma recusa só serve se disser o que mudar na próxima tentativa.
  // --------------------------------------------------------------------------
  private conferirVagaOferecida(
    profissionalId: number,
    data: string,
    hora: string,
  ): ResultadoFerramenta | null {
    // Nenhuma consulta neste turno: não há com o que comparar. Deixa passar e o
    // banco decide — é o comportamento de antes, e vale para o caso legítimo de
    // o modelo agendar a partir de uma lista de um turno anterior.
    if (this.vagasOferecidas.length === 0) return null

    const exata = this.vagasOferecidas.find(
      (v) => v.profissionalId === profissionalId && v.data === data && v.hora === hora,
    )
    if (exata) return null

    // O horário existe, mas com OUTRO profissional. É o caso do incidente: o
    // modelo acertou dia e hora e inventou o id. Dizer o id certo transforma a
    // recusa numa instrução que ele consegue seguir.
    const mesmoHorario = this.vagasOferecidas.filter((v) => v.data === data && v.hora === hora)
    if (mesmoHorario.length > 0) {
      const certos = mesmoHorario
        .map((v) => `profissionalId ${v.profissionalId} (${v.profissional ?? 'profissional'})`)
        .join(' ou ')
      return recusa(
        MOTIVO.VAGA_INEXISTENTE,
        `O profissionalId ${profissionalId} não é o desse horário. Em ${data} às ${hora} a vaga é com ${certos}. `
        + 'Chame agendar_sessao de novo com esse profissionalId, sem consultar os horários outra vez.',
      )
    }

    // Dia e hora que nunca foram oferecidos. Listar o que existe é mais útil que
    // mandar reconsultar: a lista que ele precisa já passou por ele.
    const amostra = this.vagasOferecidas
      .slice(0, 5)
      .map((v) => `${v.data} ${v.hora} (profissionalId ${v.profissionalId})`)
      .join('; ')
    return recusa(
      MOTIVO.VAGA_INEXISTENTE,
      `Não ofereci a vaga de ${data} às ${hora}. As que ofereci foram: ${amostra}. `
      + 'Escolha uma destas com o responsável, ou consulte outro período antes de agendar.',
    )
  }

  // Traduz erro de domínio em recusa com motivo estável.
  // Cada motivo pede uma reação diferente do agente, e é por isso que os três
  // tipos de falha de vaga não são fundidos num "não deu".
  private traduzirErro(err: unknown): ResultadoFerramenta {
    if (err instanceof SlotAlreadyBookedError) {
      return recusa(MOTIVO.VAGA_TOMADA, 'Esse horário acabou de ser preenchido. Ofereça outro horário da lista.')
    }
    if (err instanceof SlotNotInGradeError) {
      return recusa(MOTIVO.VAGA_INEXISTENTE, 'Esse horário não existe na agenda da clínica. Consulte os horários disponíveis novamente e use exatamente um deles.')
    }
    if (err instanceof SlotInPastError) {
      return recusa(MOTIVO.VAGA_NO_PASSADO, 'Esse horário já passou. Ofereça uma data futura.')
    }
    if (err instanceof AppointmentNotFoundError) {
      return recusa(MOTIVO.NAO_ENCONTRADO, 'Agendamento não encontrado. Liste os agendamentos do contato antes de remarcar ou cancelar.')
    }

    // Erro inesperado: o agente não deve improvisar sobre a agenda. Logar e
    // devolver recusa genérica para que o orquestrador escale ao humano.
    console.error('[FerramentasAgente] erro inesperado', err)
    return recusa(MOTIVO.ERRO_INTERNO, 'Não consegui consultar a agenda agora. Encaminhe para a recepção.')
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function recusa(motivo: string, mensagem: string): ResultadoFerramenta {
  return { ok: false, motivo, mensagem }
}

// O modelo manda `null` no que não sabe (strict exige todos os campos), e às
// vezes manda a string "null" ou espaços. Os três significam a mesma coisa:
// não informado. Devolver undefined é o que faz o service não mexer no campo.
function texto(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  if (s === '' || s.toLowerCase() === 'null') return undefined
  return s
}

// Como cada campo é chamado NA CONVERSA. Vai no retorno da ferramenta porque
// quem lê é o modelo montando a próxima pergunta — 'guardian_name' não é uma
// palavra que se use com a mãe de um paciente.
const ROTULO_CAMPO: Record<CampoFicha, string> = {
  patient_name:  'nome da criança',
  birth_date:    'data de nascimento',
  guardian_name: 'nome do responsável',
  shift:         'turno para as terapias',
  health_plan:   'plano de saúde',
}

// Os valores do enum de `escalar_para_humano`, para validar o que chega do modelo.
const MOTIVOS_ESCALADA: readonly string[] = [
  'pedido_do_usuario', 'insatisfacao', 'fora_do_alcance',
] as const

// Instrução de volta ao modelo. Vai no resultado da ferramenta porque é ali que
// ele lê o que fazer em seguida — e o que ele faz em seguida é a metade visível
// desta funcionalidade: sem a despedida, o responsável vê a conversa morrer.
const AVISO_ESCALADA_NOVA =
  'Pronto, a conversa está com a equipe. Agora escreva UMA mensagem curta ao responsável avisando que alguém vai continuar o atendimento. Não prometa prazo.'

const AVISO_JA_ESCALADA =
  'Esta conversa já está com a equipe. Não chame esta ferramenta de novo; apenas responda ao responsável em uma frase curta.'

// ----------------------------------------------------------------------------
// Contexto confiável: derivado do runtime, nunca do modelo
//
// Estes identificadores decidem DE QUEM é a operação. Vêm de `ContextoAgente`,
// montado pelo orquestrador a partir da conversa e do canal — nunca dos
// argumentos que o modelo produz.
//
// Por que a defesa é dupla:
//
//   1. Os schemas declaram `additionalProperties: false` com `strict: true`, e
//      nenhum deles lista estas chaves. A API recusa antes de chegar aqui.
//   2. Este filtro, que roda de qualquer forma.
//
// A segunda camada não é paranoia decorativa. O caminho do agente usa
// `createAppointmentSystemService()`, que é service role — a RLS de
// central.appointments NÃO se aplica, e o isolamento por organização passa a ser
// inteiramente responsabilidade do caller. Nesse regime, um `orgId` vindo do
// texto de um responsável no WhatsApp seria leitura e escrita em outra
// organização. O custo do filtro é um Object.entries por chamada; o custo de
// não tê-lo, no dia em que `strict` for desligado para depurar, é um vazamento
// entre organizações.
//
// Formas em snake_case e camelCase porque o modelo copia o vocabulário que vê:
// se um resultado de ferramenta mencionar `organization_id`, é essa a grafia
// que ele tentará repetir.
// ----------------------------------------------------------------------------
const CHAVES_DE_CONTEXTO: readonly string[] = [
  'orgId',          'organizationId',  'organization_id',
  'contactId',      'contact_id',
  'conversationId', 'conversation_id',
  'titaPacienteId', 'tita_paciente_id',
  // Quem executou e se foi a IA são fatos que o runtime registra; deixar o
  // modelo declará-los corromperia a auditoria de `created_by_ai`.
  'actorId',        'actor_id',
  'criadoPorIa',    'created_by_ai',
] as const

function semChavesDeContexto(args: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {}
  const rejeitadas: string[] = []

  for (const [chave, valor] of Object.entries(args)) {
    if (CHAVES_DE_CONTEXTO.includes(chave)) {
      rejeitadas.push(chave)
      continue
    }
    limpo[chave] = valor
  }

  // Descartar em silêncio esconderia tanto um bug de prompt quanto uma tentativa
  // de injeção. O valor NÃO é logado: pode conter dado de paciente.
  if (rejeitadas.length > 0) {
    console.warn(
      '[FerramentasAgente] argumentos de contexto vindos do modelo foram descartados:',
      rejeitadas.join(', '),
    )
  }

  return limpo
}

// O modelo às vezes manda número como string ("2270"). Aceitar os dois evita
// um turno inteiro perdido por causa de tipo.
function toInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (!isNaN(n)) return n
  }
  return undefined
}

function clampInt(v: unknown, min: number, max: number, padrao: number): number {
  const n = toInt(v)
  if (n == null) return padrao
  return Math.min(max, Math.max(min, n))
}

const TIPOS_ACEITOS = ['triagem', 'retorno', 'reuniao', 'followup', 'other'] as const

function tipoValido(v: unknown): 'triagem' | 'retorno' | 'reuniao' | 'followup' | 'other' {
  return (TIPOS_ACEITOS as readonly string[]).includes(String(v))
    ? (v as any)
    : 'other'
}
