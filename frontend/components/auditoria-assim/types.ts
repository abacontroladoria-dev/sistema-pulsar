export type AuditoriaAssimItem = {
  bloco_id: string | null
  paciente_id: string | null
  paciente_nome: string | null
  /**
   * A carteirinha pontuada (`empresa.matricula.dep`) que a RPC monta a partir de
   * `agenda_tita.numero_carteirinha`. É a chave que casa com
   * `autorizacoes_assim.matricula`, e por isso a Análise de Reincidência depende
   * dela. Nula nas linhas de falta, que são sintetizadas no serviço.
   */
  carteirinha: string | null
  data_atendimento: string | null
  hora_inicial: string | null
  codigo_tuss: string | null
  convenio_nome: string | null
  terapias: string | null
  profissionais: string | null
  quantidade_sessoes: number | null
  guia: string | null
  status_assim: string | null
  codigo_erro: string | null
  descricao_erro: string | null
  data_execucao: string | null
  situacao: string | null
  prioridade: number | null
  dias_atraso: number | null
  possui_autorizacao: boolean | null
  possui_solicitacao: boolean | null
  observacao: string | null
  motivo_glosa: string | null
  teve_token: boolean | null
  token: string | null
  /**
   * O campo `biofacial` do extrato da ASSIM — COMO a validação foi feita, ou por
   * que não pôde ser. Chega já resolvido pela precedência vínculo → posicional
   * que a RPC aplica (`COALESCE(vin.biofacial, mt.biofacial)`), como `guia` e
   * `status_assim` também chegam: a regra mora no SQL, não duplicada aqui.
   *
   * Texto CRU e truncado em 25 chars pelo extrato ('8-DISPOSITIVO INDISPONIVEL'
   * tem 26 e chega cortado), de vocabulário não fechado. Só o número antes do
   * primeiro '-' é estável — comparar SEMPRE por prefixo (`dispositivoIndisponivel`
   * em situacoes.ts), nunca pelo rótulo inteiro e nunca pelo texto de
   * `forma_validacao_do_biofacial`, que devolve 'Token' quando o `8-` veio com
   * token e faria o predicado perder justamente esses casos.
   *
   * Nulo quando a ASSIM não respondeu e nas linhas de falta, sintetizadas no
   * serviço.
   */
  biofacial: string | null
  criado_por: string | null
  forma_autorizacao: string | null
  horario_autorizacao: string | null
  /**
   * De onde veio a guia acima: `'robo'` (o Pulsar a capturou no recibo),
   * `'relatorio'` (veio do extrato da ASSIM, logo foi tirada direto no portal),
   * `'reconciliacao'` (reparo manual, mesmo significado), ou nula.
   *
   * Existe porque `criado_por` responde outra pergunta — quem ABRIU a solicitação — e
   * era lido como autoria da autorização. Traduzir para texto é papel de
   * `lib/guiaOrigem.ts`; nunca comparar com os literais fora dele.
   *
   * Nula em duas situações distintas, ambas sem rótulo na tela: sessão anterior a
   * 25/08/2026 (a coluna não era escrita) e linha de falta, sintetizada no serviço.
   */
  guia_origem: string | null
  observacao_manual: string | null
  observacao_manual_atualizado_em: string | null
  observacao_manual_atualizado_por_nome: string | null
  token_conferido: boolean | null
  token_conferido_em: string | null
  token_conferido_por_nome: string | null
  /**
   * A guia que a Reconciliação apontou como cobertura desta sessão.
   *
   * NÃO vem da RPC, e a distinção é a razão deste campo existir. Vincular não
   * reescreve o pareamento posicional: `get_auditoria_assim_periodo` reflete o
   * vínculo na `situacao` (GLOSA_RESOLVIDA, ou LIBERADA quando não houve glosa)
   * e o narra em prosa no fim de `observacao`, mas a coluna `guia` continua
   * sendo a ANTIGA — a que a ASSIM recusou. Sem este campo a tela dizia "Glosa
   * Resolvida" sem dizer o que resolveu: o número só existia no rabo de uma
   * legenda truncada, e o operador tinha de abrir o detalhamento para descobrir
   * quem tinha coberto.
   *
   * Nulo em toda sessão sem cobertura por vínculo — que é a esmagadora maioria.
   */
  vinculo: VinculoCobertura | null
  /**
   * Metadados crus da reclassificação manual ativa deste bloco — de onde para
   * onde, quem decidiu, quando e por quê.
   *
   * Só existe porque `situacao` já reflete a decisão (GLOSA vira FALTA, por
   * exemplo) e a seção "Motivo da glosa" do detalhamento é condicionada a
   * `ehGlosa(situacao)`: reclassificar uma glosa some com a única seção que
   * mostrava o motivo original, e nada tomava o lugar dela além de uma frase
   * corrida dentro de `observacao`. Nula em todo bloco sem reclassificação
   * ativa — que é a esmagadora maioria.
   */
  reclassificacao_situacao_anterior: string | null
  reclassificacao_justificativa: string | null
  reclassificacao_por: string | null
  reclassificacao_em: string | null
}

export type KpisAuditoriaAssim = {
  total: number
  liberadas: number
  faltas: number
  faltas_terapeuta: number
  nao_solicitadas: number
  sincronizando: number
  retorno_nao_confirmado: number
  canceladas: number
  glosas: number
  /**
   * Glosas que uma autorização externa passou a cobrir (aba Reconciliação).
   * Fora de `glosas` de propósito: aquele card dimensiona trabalho a fazer, e
   * estas não pedem nada. Aparece como dica no card de Glosas — ver a nota em
   * situacoes.ts.
   */
  glosas_resolvidas: number
  tokens: number
}

export type AuditoriaFilters = {
  paciente: string
  situacao: string
  data: string
  horario_bloco: string
}

/**
 * Uma linha do resumo diário pré-calculado — a fonte da visão gerencial.
 *
 * É a linha da auditoria **despida de identidade**: em vez de uma sessão de um
 * paciente, uma combinação de dimensões e quantas sessões caíram nela. Por isso
 * o modal responde total, evolução e quebra com UMA consulta, e por isso ele
 * abre instantâneo — a conta cara já rodou no cron.
 *
 * `situacao` é **crua**, exatamente como a RPC a devolve. O banco não sabe o que
 * é um card: quem agrupa situação em KPI é `kpisAuditoria.ts`, o mesmo código
 * que a tela diária usa. Se o SQL decidisse isso, o número do modal e o número
 * do card teriam duas definições e divergiriam no primeiro estado novo.
 *
 * `sala_nome` é **crua, não a unidade**. O de-para sala→unidade é `mapearUnidade`
 * e já é aplicado pelo resto do sistema; traduzir no SQL criaria uma segunda
 * cópia da regra para envelhecer sozinha.
 *
 * Os textos anuláveis chegam como `'—'`, nunca `null`: são parte da chave
 * primária do resumo, e NULL não se compara a NULL.
 */
export type ResumoDiarioLinha = {
  data: string
  /** Separa homônimos, que existem nesta base. O nome é o que se lê e se busca. */
  paciente_id: string
  paciente_nome: string
  situacao: string
  teve_token: boolean
  codigo_tuss: string
  terapia: string
  sala_nome: string
  codigo_glosa: string
  sessoes: number
  /** Quando o cron recalculou este dia. Vira o carimbo de frescor da tela. */
  atualizado_em: string
}

/**
 * Uma autorização como a ASSIM a registrou, lida direto de `autorizacoes_assim`.
 *
 * Existe separada de `AuditoriaAssimItem` porque a auditoria é dirigida pela
 * SESSÃO: ela só mostra autorização que casou com uma sessão agendada. A que
 * sobrou — a excedente, que é justamente a que estoura a cota semanal e provoca
 * a glosa 1601 — não tem sessão para se pendurar e por isso não existe em
 * `AuditoriaAssimItem` nenhum.
 *
 * `data_execucao` é `timestamp without time zone` guardando hora de São Paulo.
 * Lido cru pelo PostgREST chega sem sufixo de fuso: formatar por fatia de
 * string, nunca via `new Date()`.
 */
export type AutorizacaoAssimSemana = {
  guia: string
  matricula: string | null
  paciente_nome: string | null
  data_execucao: string | null
  status: string | null
  codigo_tuss: string | null
  codigo_erro: string | null
  descricao_erro: string | null
  teve_token: boolean | null
  token: string | null
}

/**
 * O placar de um TUSS na semana: a cota (o que estava agendado) contra o que a
 * ASSIM de fato processou.
 *
 * `excedente` mede sobre `liberadas`, não sobre `autorizadas` — recusa não
 * consome cota. Os dois números ficam visíveis para que a diferença entre
 * "pediram demais" e "pediram e levaram demais" não se perca.
 */
export type PlacarTuss = {
  codigo_tuss: string
  terapias: string
  agendadas: number
  /**
   * Das `agendadas`, as que já aconteceram (data <= hoje, ou a semana inteira se
   * ela já passou). É sobre estas — nunca sobre a semana toda — que "autorização
   * faltando" faz sentido: numa segunda-feira, cobrar cobertura do que a clínica
   * ainda vai atender na sexta transformaria toda a agenda em pendência.
   */
  decorridas: number
  autorizadas: number
  liberadas: number
  /** `Liberado *` — saiu e foi desfeita. Não entra em `liberadas`. */
  canceladas: number
  /** Positivo = autorização a mais do que sessão agendada. Mede sobre `liberadas`. */
  excedente: number
  /**
   * Sessão já ocorrida sem liberação que a cubra, contada UMA A UMA por
   * `sessaoSemCobertura` — não é `decorridas − liberadas`. A diferença é o que
   * permite a grade apontar o cartão: cada unidade deste número é uma sessão
   * que existe na tela. Nunca negativo.
   *
   * Mede COBERTURA, e por isso inclui a sessão glosada: a recusa não cobriu
   * nada. Para CONTAR ESPÉCIES na listagem é `naoSolicitada` que serve — ver
   * abaixo.
   */
  faltante: number
  /**
   * Das `faltante`, as que ninguém sequer respondeu — sem a glosada e sem a
   * cancelada, que outra espécie da listagem já conta.
   *
   * Existe por um defeito real (Yure Bernardo, agosto/2026): a linha somava
   * "5 glosas + 9 não solicitadas" = 14 sobre nove sessões, porque as cinco
   * recusas entravam nas duas espécies. `faltante` continua sendo o número
   * certo para a pergunta "esta sessão está coberta?" — e este é o certo para
   * "quantas pendências distintas este paciente tem?". Ver `sessaoNaoSolicitada`.
   */
  naoSolicitada: number
}

/**
 * As quatro espécies de pendência que a listagem mensal indexa.
 *
 * Ficam num tipo só porque a listagem as trata igual: cada uma é um badge, um
 * contador e um filtro — e um quinto valor entrando aqui tem de ganhar as três
 * formas de uma vez.
 *
 * Eram CINCO até 2026-08-26, e duas delas — `sem-vinculo` e `sobrando` — eram o
 * mesmo fato contado por dois caminhos: a primeira nomeava as guias que
 * sobraram do pareamento (`get_guias_orfas`), a segunda media o saldo
 * `liberadas − agendadas` por TUSS. Uma guia que sobrou do pareamento é, quase
 * sempre, exatamente a que estourou a cota — e `contarPendencias` SOMAVA as
 * duas, então essa guia entrava duas vezes no total que a operação usa para
 * dimensionar trabalho. Na tela eram dois badges do mesmo âmbar, lado a lado,
 * dizendo a mesma coisa.
 *
 * A grade nunca acreditou nessa separação: `cartaoPendente` sempre foi
 * `estado === 'sem-vinculo' || excedente` — uma união. Agora a contagem faz o
 * mesmo, e por isso `autorizacao-a-mais` conta GUIAS DISTINTAS, não a soma de
 * dois números (ver `contarPendencias`).
 *
 * Cuidado ao ler o repositório: `'sem-vinculo'` continua existindo como
 * `EstadoAutorizacao` em `reconciliacao/vinculo.ts`, que é outro tipo e outra
 * pergunta — lá é o estado de UMA guia na grade, aqui é uma espécie de
 * pendência de um paciente no mês.
 */
export type TipoPendencia = 'glosa' | 'cancelamento' | 'autorizacao-a-mais' | 'faltando'

/** Os quatro contadores de um paciente no mês, mais o total. */
export type ContagemPendencias = Record<TipoPendencia, number> & { total: number }

/**
 * Uma linha da listagem "Autorizações com pendências".
 *
 * `carteirinhas` é plural porque a carteirinha, e não o nome, é o que casa com
 * `autorizacoes_assim.matricula` — e um mesmo paciente pode ter mais de uma
 * (dependente que troca de titular, recadastro). Somá-las aqui é o que faz o
 * modal abrir sem buscar nada: ele recorta, dentro do mês já carregado, a
 * semana a mostrar por estas chaves.
 *
 * `pacienteIds` com mais de um elemento significa homônimos somados na mesma
 * linha — dito em tela, nunca escolhido em silêncio.
 */
export type PacientePendencias = {
  /** Carteirinha quando existe, `nome:<NOME>` quando o paciente só tem falta. */
  chave: string
  nome: string
  carteirinhas: string[]
  pacienteIds: string[]
  /** `convenio_nome` da agenda. Nesta aba é sempre um plano da ASSIM. */
  plano: string | null
  /** Inferida da sala agendada. Nula quando a origem não informou. */
  unidade: string | null
  contagem: ContagemPendencias
  sessoes: number
  /** Instante da autorização mais recente do mês. Não é a data do atendimento. */
  ultimaAutorizacao: string | null
}

/**
 * Um cartão dentro de uma célula da grade semanal.
 *
 * Duas espécies, porque a grade mostra duas coisas no mesmo eixo: a SESSÃO que a
 * clínica agendou (posicionada pelo horário do atendimento) e a AUTORIZAÇÃO que
 * não casou com sessão nenhuma (posicionada pelo dia em que a ASSIM a
 * registrou). A segunda é justamente a que não aparece em tela nenhuma do
 * sistema — é ela que estoura a cota semanal.
 *
 * As duas carregam `terapia` porque a grade é indexada por HORÁRIO, não por
 * terapia: o nome dela deixou de ser o cabeçalho da linha e passou a ser
 * informação do cartão, senão o atendimento chega ao olho como um par de números
 * sem assunto.
 */
export type CartaoGrade =
  | {
      tipo: 'sessao'
      chave: string
      /** `hora_inicial` do atendimento. */
      hora: string
      codigo_tuss: string | null
      guia: string | null
      situacao: string | null
      terapia: string | null
      /** Profissional, ou o motivo quando a linha é uma falta. */
      legenda: string | null
      /**
       * A sessão já ocorreu e ninguém a liberou. É o "faltando" da listagem
       * virado objeto: sem esta marca o número existia e a sessão não, e a
       * pessoa tinha de adivinhar qual das cinco do dia era a descoberta.
       */
      semCobertura: boolean
      /**
       * A sessão já aconteceu (com os 30 min de tolerância).
       *
       * Separado de `semCobertura` porque as duas respondem perguntas
       * diferentes, e a que faltava era esta: sem ela o cartão não conseguia
       * distinguir "ninguém pediu autorização e a sessão já passou" (problema)
       * de "ninguém pediu ainda porque a sessão é sexta" (normal). Os dois
       * chegavam como NAO_SOLICITADA e saíam vermelhos.
       */
      decorrida: boolean
      /**
       * O texto da recusa, ainda cru. Pode vir já decomposto pela RPC
       * (`descricao_erro`) ou no formato "1601-REINCIDENCIA NO ATEN" cortado em
       * 25 caracteres (`motivo_glosa`) — quem resolve é `lib/glosa`, no cartão,
       * porque só lá existe o de-para de códigos.
       */
      motivoBruto: string | null
      teve_token: boolean | null
      token: string | null
      /**
       * A guia que passou a cobrir esta sessão por triagem manual. Nula no caso
       * normal, em que a cobertura saiu do pareamento posicional do banco.
       *
       * A RPC já reflete o vínculo na `situacao` (GLOSA_RESOLVIDA quando havia
       * glosa, LIBERADA quando não havia), mas só isso não basta na grade: o
       * segundo ramo é indistinguível de uma sessão liberada normalmente, e o
       * primeiro não diz QUAL guia a cobriu. Sem esta referência a metade de cá
       * do par ficava muda — a guia dizia que cobria uma sessão e a sessão não
       * dizia que fora coberta.
       */
      vinculo: VinculoAutorizacao | null
      /**
       * A linha da RPC, inteira, para o detalhamento do cartão.
       *
       * O cartão continua com os campos copiados acima porque é ele quem os
       * desenha e quem decide a silhueta a partir deles; `origem` existe para a
       * gaveta de detalhe, que mostra os outros vinte — observação manual,
       * conferência da filipeta, forma de autorização, quem solicitou. Carregar
       * a referência não custa nada (o objeto já está em memória) e evita a
       * alternativa: copiar mais vinte campos aqui, um por um, e ter de mexer
       * neste tipo toda vez que a gaveta quiser mostrar mais um.
       */
      origem: AuditoriaAssimItem
    }
  | {
      tipo: 'autorizacao'
      chave: string
      /** Hora de `data_execucao` — quando a ASSIM registrou, não quando atendeu. */
      hora: string
      codigo_tuss: string | null
      guia: string
      /**
       * O nome da terapia do TUSS da guia, quando a semana o revela. Guia de um
       * TUSS sem sessão nenhuma (a "sobrando" pura) não tem de onde tirar nome —
       * fica nula, e o cartão mostra só o código.
       */
      terapia: string | null
      /** Ver `EstadoAutorizacao` em reconciliacao/vinculo.ts. */
      estado: 'sem-vinculo' | 'vinculada' | 'sem-sessao' | 'fora-da-semana'
      /**
       * A triagem desta guia, quando ela já foi triada. É a fonte de `estado`
       * nos dois desfechos (`vinculada`, `sem-sessao`) e do que o cartão e a
       * gaveta imprimem sobre ela — a sessão coberta, quem decidiu e quando.
       */
      vinculo: VinculoAutorizacao | null
      /**
       * Esta liberação passou da cota do TUSS na semana. O "sobrando" da
       * listagem virado objeto, por atribuição posicional em `data_execucao` —
       * ver `guiasExcedentes` em useAnaliseReincidencia.
       */
      excedente: boolean
      status: string | null
      descricao_erro: string | null
      teve_token: boolean | null
      token: string | null
      /** A linha de `autorizacoes_assim`, inteira, para o detalhamento. */
      origem: AutorizacaoAssimSemana
    }

/**
 * Uma linha da grade: uma faixa de horário e os 5 dias úteis dela.
 *
 * A linha é a HORA CHEIA ("14:00"), não o horário exato do atendimento. A sessão
 * da clínica cai em passos de 40 minutos e `data_execucao` de uma guia é o
 * instante em que a ASSIM respondeu — 14:34, 09:07. Uma linha por horário exato
 * daria uma escala de dezenas de faixas com um cartão em cada, que é o oposto de
 * uma agenda: o horário cheio agrupa, e o minuto exato continua impresso no
 * cartão.
 */
export type LinhaGrade = {
  /** "08:00" … "18:00", ou "—" na faixa dos atendimentos sem horário. */
  hora: string
  /** Indexado pela data ISO do dia útil. */
  celulas: Record<string, CartaoGrade[]>
}

/** O que a Análise de Reincidência precisa saber para abrir já resolvida. */
export type AlvoAnalise = {
  pacienteNome: string | null
  /** Vem preenchida quando se abre pela linha; pela busca livre, nasce nula. */
  carteirinha: string | null
  /** Qualquer dia da semana a exibir — o hook recua até a segunda. */
  data: string
}

export type TokenMensalItem = {
  bloco_id: string | null
  paciente_id: string | null
  paciente_nome: string | null
  data_atendimento: string | null
  hora_inicial: string | null
  codigo_tuss: string | null
  terapias: string | null
  profissionais: string | null
  guia: string | null
  token: string | null
  data_execucao: string | null
  criado_por: string | null
  forma_autorizacao: string | null
  token_conferido: boolean | null
  token_conferido_em: string | null
  token_conferido_por_nome: string | null
}

/**
 * Uma guia da ASSIM que sobrou do match posicional da Conferência.
 *
 * `ordem_autorizacao` / `sessoes_na_particao` não são enfeite de depuração: são
 * a prova do porquê a guia está aqui. "ordem 2 de 1 sessão" diz, na própria
 * linha, que a partição tinha uma sessão só e esta é a segunda autorização —
 * exatamente o caso da glosa reautorizada por fora.
 */
export type GuiaOrfa = {
  guia: string
  /** Carteirinha pontuada `empresa.matricula.dep`, como vem de autorizacoes_assim. */
  carteirinha: string | null
  paciente_id: number | null
  paciente_nome: string | null
  /** Instante da autorização no portal — NÃO é a data do atendimento. */
  data_execucao: string | null
  codigo_tuss: string | null
  status: string | null
  teve_token: boolean | null
  token: string | null
  biofacial: string | null
  ordem_autorizacao: number | null
  sessoes_na_particao: number | null
}

/**
 * O desfecho de uma triagem da Reconciliação, como `autorizacoes_vinculos` o
 * guarda — e o dado que faltava para a tela saber que a ação aconteceu.
 *
 * Sem ele a grade lia o depois pelo que NÃO estava mais lá: a guia saía de
 * `get_guias_orfas` e a tela concluía "não é órfã e não casa com sessão desta
 * semana", que é literalmente o estado `fora-da-semana` — e o cartão da guia
 * recém-vinculada aparecia rotulado "Outra semana", afirmando o contrário do que
 * o operador acabara de fazer. Ausência não é veredito; o veredito mora aqui.
 *
 * A tabela é um livro de triagem manual (ordem de dezenas de linhas por mês), e
 * por isso o cliente carrega as ATIVAS inteiras em vez de recortar por período:
 * a janela de vínculo é de 7 dias retroativos e atravessa a virada do mês, então
 * qualquer recorte por data deixaria de fora exatamente o vínculo que cruza a
 * borda — que é o caso que esta tela existe para tratar.
 */
export type VinculoAutorizacao = {
  id: string
  /** A guia da ASSIM que foi triada. É a chave da triagem: uma ativa por guia. */
  guia: string
  /** `vinculo` = cobre `bloco_id`; `sem_sessao` = autorização extra, sem sessão. */
  tipo: 'vinculo' | 'sem_sessao'
  /** A sessão coberta. Sempre nula em `sem_sessao` (a constraint da tabela exige). */
  bloco_id: string | null
  /** A guia glosada que esta substituiu, congelada no momento do vínculo. */
  guia_original: string | null
  observacao: string | null
  vinculado_por: string | null
  vinculado_em: string | null
}

/**
 * O mesmo vínculo, visto do lado da sessão coberta — o que a aba Auditoria
 * precisa saber para dizer QUEM resolveu a glosa.
 *
 * A diferença para `VinculoAutorizacao` é uma coluna só, e ela vem de outra
 * tabela: `data_execucao` é o instante em que a ASSIM registrou a guia que
 * cobriu, e mora em `autorizacoes_assim`. É a metade da resposta que o número
 * sozinho não dá — "a liberação saiu quando?" costuma ser dias depois da
 * sessão, e é isso que explica por que o match posicional errou.
 *
 * `timestamp without time zone` guardando hora de São Paulo, como toda
 * `data_execucao` neste módulo: formatar por fatia de string, nunca via
 * `new Date()`. `vinculado_em` é o oposto — `timestamptz` de verdade, e aí a
 * conversão do navegador é a certa.
 */
export type VinculoCobertura = VinculoAutorizacao & {
  data_execucao: string | null
}

/**
 * As situações para as quais uma sessão pode ser reclassificada à mão.
 *
 * Espelha a constraint `auditoria_situacao_overrides_nova_ck` — e a ordem é a
 * mesma em que os botões aparecem, do desfecho mais comum para o mais raro.
 *
 * `LIBERADA` e `GLOSA_RESOLVIDA` estão FORA, e não por esquecimento: afirmar
 * cobertura exige uma guia, e o caminho para isso é o vínculo desta mesma aba.
 * O banco recusa esses dois valores; esta lista existe para que a tela nem os
 * ofereça.
 */
export const SITUACOES_RECLASSIFICAVEIS = [
  'FALTA',
  'FALTA_TERAPEUTA',
  'CANCELADA',
  'NAO_SOLICITADA',
] as const

export type SituacaoReclassificavel = (typeof SITUACOES_RECLASSIFICAVEIS)[number]

/**
 * Uma reclassificação manual de situação, como `auditoria_situacao_overrides` a
 * guarda — o log de quem sobrepôs a derivação automática, e por quê.
 *
 * `situacao_anterior` é congelada no instante da decisão, nunca relida: é o "de"
 * do log, e ele tem de continuar dizendo o que a pessoa viu quando decidiu. A
 * derivação pode mudar depois (o relatório da ASSIM chega, o robô conclui a
 * linha), e um "de" relido contaria a história de agora em vez da história da
 * decisão.
 *
 * Uma sessão tem no máximo UMA ativa (`desfeito_em is null`), garantida por
 * unique parcial. As desfeitas continuam na tabela e aparecem no histórico —
 * desfazer preserva o rastro, não o apaga.
 */
export type ReclassificacaoSituacao = {
  id: string
  bloco_id: string
  situacao_anterior: string
  situacao_nova: string
  justificativa: string
  reclassificado_por: string
  reclassificado_em: string
  desfeito_por: string | null
  desfeito_em: string | null
  desfeito_motivo: string | null
}

/** Uma sessão que a guia órfã selecionada poderia estar cobrindo. */
export type CandidataVinculo = {
  bloco_id: string
  paciente_id: string | null
  paciente_nome: string | null
  data_atendimento: string | null
  hora_inicial: string | null
  codigo_tuss: string | null
  terapias: string | null
  profissionais: string | null
  quantidade_sessoes: number | null
  /** Mesma `situacao` que a Conferência mostra — vem da mesma RPC. */
  situacao: string | null
  /** A guia que hoje está casada com esta sessão (a glosada, tipicamente). */
  guia_atual: string | null
  status_assim: string | null
  motivo_glosa_codigo: string | null
  motivo_glosa_descricao: string | null
  /** Anotação escrita à mão no modal da Conferência (auditoria_glosa_motivos). */
  nota_manual: string | null
  observacao: string | null
  /** Solicitação original do Pulsar, quando existe. Nula no cenário sem solicitação. */
  fila_id: string | null
  /** Negativo = autorização saiu ANTES da sessão. */
  distancia_horas: number | null
  ja_vinculado: boolean | null
  /** Falso para sessão já LIBERADA ou já vinculada: visível, mas não escolhível. */
  elegivel: boolean | null
}
