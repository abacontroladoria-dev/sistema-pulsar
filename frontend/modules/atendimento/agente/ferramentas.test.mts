// Exercita as ferramentas do agente contra o Supabase LOCAL, sem LLM nenhum.
//
// O ponto do teste é provar que o caminho da IA passa pelas MESMAS regras do
// caminho humano: vaga tem que existir na grade, não pode estar no passado,
// não pode estar prometida a outro, e cancelar devolve a vaga.
//
// Rodar com a stack local de pé:
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<service role local> \
//   npx tsx modules/atendimento/agente/ferramentas.test.mts
//
// Não usa framework de teste para não acoplar o módulo a um runner: é um script
// que sai com código 1 se qualquer asserção falhar.
//
// PRÉ-REQUISITO DE DADOS
//
// O teste precisa de vaga LIVRE E FUTURA na grade local. Um dump antigo de
// csv_grades_profissionais tem a grade toda no passado, e aí `sem_vaga` é a
// resposta CORRETA de todas as consultas — não há o que testar. Antes disso
// virava um TypeError cru em `terapia.terapiaId`, que parecia bug do código.
// Agora o script diz o que falta e sai com 0: dado ausente não é falha de
// código, e um verde falso seria pior.
//
// Para checar antes de rodar:
//   select count(*) from central.vw_vagas_livres
//    where data >= (now() at time zone 'America/Sao_Paulo')::date;

import { createClient } from '@supabase/supabase-js'
import { AppointmentRepository } from '../repositories/appointment.repository.js'
import { AvailabilityRepository } from '../repositories/availability.repository.js'
import { AuditRepository } from '../repositories/audit.repository.js'
import { AppointmentService } from '../services/appointment.service.js'
import { FerramentasAgente, MOTIVO } from './ferramentas.js'
import { UNIDADES } from './unidade.js'

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ORG = 'a0000000-0000-0000-0000-000000000001'

if (!KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (use a chave da stack LOCAL).')
  process.exit(1)
}
if (!URL.includes('127.0.0.1') && !URL.includes('localhost')) {
  console.error(`Recusando rodar contra ${URL}: este teste grava e apaga agendamentos, use a stack local.`)
  process.exit(1)
}

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok   ${descricao}`)
  } else {
    falhas++
    console.log(`  FALHA ${descricao}`)
    if (extra !== undefined) console.log('        ', JSON.stringify(extra))
  }
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } })

const repo = new AppointmentRepository(supabase)
const service = new AppointmentService(
  repo,
  new AvailabilityRepository(supabase),
  new AuditRepository(supabase),
)
const ferramentas = new FerramentasAgente(service, repo, {
  orgId: ORG,
  contactId: null,
  conversationId: null,
})

const criados: string[] = []

try {
  console.log('\n1. consultar_especialidades_disponiveis')
  const esp: any = await ferramentas.executar('consultar_especialidades_disponiveis', {})

  // Grade local sem vaga futura: 'sem_vaga' é a resposta CORRETA, e seguir
  // daqui só produziria TypeError em `terapia.terapiaId`. Sair com 0 e dizer o
  // que falta é o honesto — o que falta é dado, não código.
  if (esp.ok === false && esp.motivo === MOTIVO.SEM_VAGA) {
    const { count } = await (supabase as any)
      .schema('central').from('vw_vagas_livres')
      .select('*', { count: 'exact', head: true })

    console.log('\n  PULADO — a grade local não tem vaga LIVRE e FUTURA.')
    console.log(`  A view central.vw_vagas_livres tem ${count ?? '?'} linha(s), todas no passado.`)
    console.log('  Isto NÃO é falha de código: sem vaga futura, "sem_vaga" é a resposta certa')
    console.log('  de toda consulta, e não há caminho de agendamento para exercitar.')
    console.log('  Para rodar de verdade, semeie csv_grades_profissionais com datas futuras.\n')
    process.exit(0)
  }

  checar(esp.ok === true, 'retorna ok', esp)
  checar(Array.isArray(esp.especialidades) && esp.especialidades.length > 0, 'lista ao menos uma especialidade')
  // A lista é de nomes do CATÁLOGO (terapia.ts), não do vocabulário cru da
  // grade. Duas omissões deliberadas: o id, porque enquanto aparecia o modelo
  // tinha um número para carregar pela conversa e reescrever quando a memória
  // escorregasse; e a contagem de vagas, porque vinha de um group by terapia_id
  // que não corresponde às especialidades do catálogo (2317 tem sete nomes).
  const nomes: string[] = esp.especialidades.map((e: any) => e.nome)
  const nomeTerapia = nomes[0]
  checar(typeof nomeTerapia === 'string' && nomeTerapia.length > 0,
    'especialidade traz o NOME do catálogo', esp.especialidades)
  checar(!nomes.some(n => n.startsWith('Aplicador')),
    'nenhum nome de escala ("Aplicador ...") é oferecido ao responsável', nomes)
  checar(!nomes.some(n => n === 'Coordenador de Caso' || n === 'Supervisão ABA'),
    'nenhum cargo interno é oferecido como terapia', nomes)

  console.log('\n2. consultar_horarios_disponiveis')
  const hor: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    // Caixa trocada de propósito: o modelo escreve como o responsável falou.
    terapia: nomeTerapia.toLowerCase(),
    limite: 5,
  })
  checar(hor.ok === true, 'retorna ok', hor)
  checar(hor.horarios?.length > 0, 'lista ao menos um horário')
  const vaga = hor.horarios?.[0]
  checar(/^\d{2}:\d{2}$/.test(vaga?.hora ?? ''), 'hora vem como HH:MM, sem segundos', vaga?.hora)
  checar(!!vaga?.profissional, 'horário identifica o profissional', vaga)

  // A unidade vem RESOLVIDA do banco (central.vw_vagas_livres), não derivada
  // aqui. Antes de 04/09/2026 ela era extraída de sala_nome por regex depois de
  // a RPC responder — e o filtro por unidade acontecia sobre as 500 primeiras
  // linhas, então uma unidade sem vaga nesse recorte virava "não temos vaga"
  // falso.
  checar(
    UNIDADES.includes(vaga?.unidade),
    'horário traz a unidade física resolvida pelo banco',
    { unidade: vaga?.unidade, sala: vaga?.sala },
  )
  checar(
    typeof vaga?.sala === 'string' && vaga.sala.startsWith(`Unid. ${vaga.unidade} - `),
    'a unidade devolvida concorda com o prefixo de sala_nome',
    { unidade: vaga?.unidade, sala: vaga?.sala },
  )

  console.log('\n2b. filtro por unidade — só vem da unidade pedida')

  // Este é o bloco que o módulo não tinha: antes desta data nenhum dos três
  // testes do agente passava `unidade`, então normalizarUnidade, o limite 500
  // condicional e o ramo de recusa "há vaga em outras unidades" não tinham
  // nenhuma asserção — e o filtro de unidade era o mecanismo mais delicado
  // daqui.
  for (const u of UNIDADES) {
    const porUnidade: any = await ferramentas.executar('consultar_horarios_disponiveis', {
      unidade: u,
      limite:  20,
    })

    if (porUnidade.ok) {
      const forasteiras = porUnidade.horarios.filter((h: any) => h.unidade !== u)
      checar(forasteiras.length === 0,
        `unidade '${u}': nenhum horário de outra unidade vazou`,
        forasteiras.slice(0, 3))
      checar(
        porUnidade.horarios.every((h: any) => String(h.sala).startsWith(`Unid. ${u} - `)),
        `unidade '${u}': toda sala tem o prefixo da unidade pedida`,
        porUnidade.horarios.slice(0, 3).map((h: any) => h.sala),
      )
    } else {
      // Sem vaga na unidade é resultado legítimo (a grade local pode não ter).
      // O que importa é o motivo ser 'sem_vaga' e não um erro.
      checar(porUnidade.motivo === 'sem_vaga',
        `unidade '${u}': sem vaga é recusa 'sem_vaga', não erro`,
        porUnidade)
    }
  }

  // Nenhuma sala que não seja endereço da clínica pode ser oferecida, nem
  // quando não há filtro de unidade. Antes da view isso acontecia: só 'Sala
  // Teste' era oculta, e por igualdade exata em lowercase — 'AT Externo Escola'
  // e 'Consulta 4/6 - Nutrição' passavam, e a IA oferecia atendimento na escola
  // do paciente como se fosse na clínica.
  const semFiltro: any = await ferramentas.executar('consultar_horarios_disponiveis', { limite: 50 })
  if (semFiltro.ok) {
    const naoFisicas = semFiltro.horarios.filter((h: any) => !String(h.sala).startsWith('Unid. '))
    checar(naoFisicas.length === 0,
      'sem filtro de unidade, nenhuma sala não-física é oferecida',
      naoFisicas.slice(0, 5).map((h: any) => h.sala))
    checar(semFiltro.horarios.every((h: any) => UNIDADES.includes(h.unidade)),
      'todo horário oferecido tem uma das três unidades',
      semFiltro.horarios.filter((h: any) => !UNIDADES.includes(h.unidade)).slice(0, 3))
  }

  // Unidade fora do enum: recusa amigável, não exceção do banco. O p_unidade da
  // RPC LANÇA 22023 em valor desconhecido (de propósito, para não filtrar em
  // silêncio), e normalizarUnidade + a guarda em consultarHorarios são o que
  // transformam isso numa pergunta ao responsável em vez de erro de servidor.
  const unidadeInvalida: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    unidade: 'Realango',
    limite:  5,
  })
  checar(unidadeInvalida.ok === false,
    "unidade inexistente é recusada, não consultada", unidadeInvalida)
  checar(
    typeof unidadeInvalida.mensagem === 'string' &&
      UNIDADES.every(u => unidadeInvalida.mensagem.includes(u)),
    'a recusa lista as três unidades para o modelo perguntar',
    unidadeInvalida.mensagem,
  )

  console.log('\n2c. especialidades trazem em quais unidades há vaga')

  // A agregação passou a ser do banco (contar_vagas_por_terapia_e_unidade). Era
  // feita sobre as 500 primeiras linhas, e uma terapia com vaga em Padre Miguel
  // só a partir da linha 501 aparecia como unidades: ['Realengo'] — o agente
  // então dizia "temos fono, mas só em Realengo", falso.
  const primeira = esp.especialidades?.[0]
  checar(Array.isArray(primeira?.unidades),
    'especialidade traz o array de unidades', primeira)
  checar(
    (primeira?.unidades ?? []).every((u: any) => UNIDADES.includes(u)),
    'as unidades da especialidade são as três conhecidas',
    primeira?.unidades,
  )
  checar((primeira?.unidades ?? []).length > 0,
    'uma especialidade com vaga tem ao menos uma unidade', primeira)

  // A contagem de vagas NÃO vem mais: vinha de um group by terapia_id que não
  // corresponde às especialidades do catálogo. Número aproximado que o modelo
  // repetiria ao responsável como exato é pior que número nenhum.
  checar(primeira?.vagas === undefined,
    'a contagem por id (que não identifica a terapia) não vem', primeira)

  console.log('\n2d. lista parcial se anuncia como parcial')

  // O defeito que isto trava (04/09/2026, capturado no rastro de tool calls):
  // perguntada por psicologia em Realengo no dia 14, a IA consultou o dia certo
  // mas sem terapiaId, com limite 20. O dia tinha 78 vagas e a única de
  // psicologia estava na POSIÇÃO 76 — é às 17:00, e a ordenação é por hora. Ela
  // viu 20, não achou, e respondeu que não havia vaga. A vaga existia.
  //
  // A causa não é o parâmetro esquecido: é a lista de 20 ser indistinguível de
  // uma agenda que tem exatamente 20. Nenhuma instrução de prompt conserta uma
  // premissa falsa, então a ferramenta passou a dizer quando truncou.
  const parcial: any = await ferramentas.executar('consultar_horarios_disponiveis', { limite: 1 })
  if (parcial.ok) {
    checar(parcial.horarios.length === 1, 'limite 1 devolve 1 horário', parcial.horarios?.length)
    checar(parcial.listaCompleta === false,
      'com mais vagas que o limite, listaCompleta é false', parcial.listaCompleta)
    checar(typeof parcial.aviso === 'string' && parcial.aviso.includes('PARCIAL'),
      'o aviso diz ao modelo que a lista é parcial', parcial.aviso)
    checar(parcial.aviso.includes('terapia'),
      'sem especialidade, o aviso manda refinar por ela — foi o caso real',
      parcial.aviso)
  }

  // Sem truncamento, nenhum aviso: um "aviso" sempre presente vira ruído que o
  // modelo aprende a ignorar, e aí ele não serve quando importa.
  const completa: any = await ferramentas.executar('consultar_horarios_disponiveis', { limite: 50 })
  if (completa.ok && completa.horarios.length < 50) {
    checar(completa.listaCompleta === true,
      'lista que coube inteira é marcada como completa', completa.listaCompleta)
    checar(completa.aviso === undefined,
      'lista completa não carrega aviso (aviso sempre presente vira ruído)', completa.aviso)
  }

  // Com a especialidade já passada, o aviso não deve mandar passá-la de novo — o
  // modelo já passou, e instrução redundante o faz repetir a mesma chamada (o
  // que o orquestrador detecta como laço e escala).
  const comTerapia: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: nomeTerapia,
    limite:  1,
  })
  if (comTerapia.ok && comTerapia.listaCompleta === false) {
    checar(!comTerapia.aviso.includes('passando `terapia`'),
      'com a especialidade já passada, o aviso não manda passá-la de novo',
      comTerapia.aviso)
  }

  console.log('\n2e. nome de especialidade desconhecido é recusa, não "não temos vaga"')

  // O defeito que trocou o parâmetro (04/09/2026, no rastro): perguntada por
  // psicologia a partir do dia 14, a IA passou `terapiaId: 1`. Psicologia é
  // 2259 — ela tinha usado o id certo um minuto antes. Não perdeu o parâmetro:
  // INVENTOU o valor, e três reforços de prompt não a impediram de reincidir.
  //
  // O parâmetro passou a ser o NOME do laudo, que o modelo sabe. Esta guarda
  // cobre o que resta: um nome que não existe entre as especialidades com vaga.
  // Sem ela o filtro não acha nada, devolve zero vagas, e a ferramenta responde
  // `sem_vaga` — indistinguível de "essa terapia não tem horário nesse
  // período". O modelo então nega um atendimento que a clínica oferece.
  const nomeInventado: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: 'quiropraxia',
    unidade: 'Realengo',
  })
  checar(nomeInventado.ok === false,
    'nome desconhecido é recusado, não vira lista vazia', nomeInventado)
  checar(nomeInventado.motivo === MOTIVO.ERRO_INTERNO,
    'a recusa é erro_interno, NÃO sem_vaga (a agenda não é o problema)',
    nomeInventado.motivo)
  checar(String(nomeInventado.mensagem).includes('não foi reconhecido'),
    'a mensagem impede o modelo de dizer que não há horário', nomeInventado.mensagem)
  checar(String(nomeInventado.mensagem).includes(nomeTerapia),
    'a recusa lista os nomes válidos — sem eles o modelo tenta outro palpite, e ' +
    'palpite diferente não é detectado como laço pelo orquestrador',
    nomeInventado.mensagem)

  // O número que o modelo mandava antes agora é um nome inválido, e precisa cair
  // na mesma recusa em vez de casar por acaso com alguma especialidade.
  const idComoNome: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: '1',
  })
  checar(idComoNome.ok === false && idComoNome.motivo === MOTIVO.ERRO_INTERNO,
    "o chute antigo ('1') é recusado, não resolvido por acaso", idComoNome)

  // O nome legítimo continua passando, inclusive em caixa alta: a resolução não
  // pode ser tão estrita que recuse o que a própria ferramenta acabou de
  // oferecer.
  const nomeValido: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: nomeTerapia.toUpperCase(),
    limite:  3,
  })
  checar(nomeValido.ok === true || nomeValido.motivo === MOTIVO.SEM_VAGA,
    'nome válido (em caixa alta) não é barrado pela resolução',
    nomeValido)

  console.log('\n3. agendar_sessao na vaga oferecida')
  const ag: any = await ferramentas.executar('agendar_sessao', {
    profissionalId: vaga.profissionalId,
    data: vaga.data,
    hora: vaga.hora,
    tipo: 'triagem',
    observacao: 'teste automatizado das ferramentas',
  })
  checar(ag.ok === true, 'reserva aceita', ag)
  if (ag.ok) criados.push(ag.agendamentoId)
  checar(ag.confirmacao?.profissional === vaga.profissional, 'confirmação repete o profissional da vaga', ag.confirmacao)
  checar(ag.confirmacao?.duracaoMin > 0, 'duração deduzida da grade', ag.confirmacao)

  console.log('\n4. a vaga sai da oferta')
  const hor2: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: nomeTerapia, limite: 50,
  })
  const aindaOferecida = hor2.horarios?.some(
    (h: any) => h.profissionalId === vaga.profissionalId && h.data === vaga.data && h.hora === vaga.hora,
  )
  checar(aindaOferecida === false, 'vaga reservada não é mais oferecida')

  console.log('\n5. reserva dupla é recusada com motivo específico')
  const dupla: any = await ferramentas.executar('agendar_sessao', {
    profissionalId: vaga.profissionalId, data: vaga.data, hora: vaga.hora,
  })
  checar(dupla.ok === false, 'segunda reserva recusada', dupla)
  checar(dupla.motivo === MOTIVO.VAGA_TOMADA, `motivo é ${MOTIVO.VAGA_TOMADA}`, dupla)

  console.log('\n6. horário que não existe na grade é recusado')

  // 03:17 de madrugada nunca é vaga de grade — é exatamente o que o input de
  // horário livre do componente antigo permitia gravar.
  //
  // A data precisa ser FUTURA, não a da vaga oferecida. Se a vaga é de hoje,
  // 03:17 dela já passou e `vaga_no_passado` vence `vaga_inexistente` na ordem
  // de checagem do service (a ordem está certa: "no passado" é a recusa mais
  // informativa das três). Com a data da vaga, este check passava de manhã cedo
  // e falhava depois das 03:17 — sensível à hora em que se roda, que é a pior
  // espécie de teste intermitente.
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const inexistente: any = await ferramentas.executar('agendar_sessao', {
    profissionalId: vaga.profissionalId, data: amanha, hora: '03:17',
  })
  checar(inexistente.ok === false, 'recusa horário fora da grade', inexistente)
  checar(inexistente.motivo === MOTIVO.VAGA_INEXISTENTE, `motivo é ${MOTIVO.VAGA_INEXISTENTE}`, inexistente)

  console.log('\n7. data no passado é recusada')
  const passado: any = await ferramentas.executar('agendar_sessao', {
    profissionalId: vaga.profissionalId, data: '2026-01-05', hora: vaga.hora,
  })
  checar(passado.ok === false, 'recusa data passada', passado)
  checar(
    passado.motivo === MOTIVO.VAGA_NO_PASSADO || passado.motivo === MOTIVO.VAGA_INEXISTENTE,
    'motivo é passado ou inexistente (a grade antiga também não oferece a vaga)',
    passado,
  )

  console.log('\n8. ferramenta desconhecida não explode')
  const nada: any = await ferramentas.executar('ferramenta_que_nao_existe', {})
  checar(nada.ok === false && nada.motivo === MOTIVO.ERRO_INTERNO, 'devolve recusa em vez de lançar', nada)

  console.log('\n9. argumentos faltando não explodem')
  const semArgs: any = await ferramentas.executar('agendar_sessao', {})
  checar(semArgs.ok === false, 'recusa sem argumentos', semArgs)

  console.log('\n10. cancelar devolve a vaga')
  const canc: any = await ferramentas.executar('cancelar_sessao', {
    agendamentoId: criados[0], motivo: 'teste',
  })
  checar(canc.ok === true, 'cancelamento aceito', canc)
  const hor3: any = await ferramentas.executar('consultar_horarios_disponiveis', {
    terapia: nomeTerapia, limite: 50,
  })
  const voltou = hor3.horarios?.some(
    (h: any) => h.profissionalId === vaga.profissionalId && h.data === vaga.data && h.hora === vaga.hora,
  )
  checar(voltou === true, 'vaga volta a ser oferecida após cancelamento')

  console.log('\n11. cancelar id inexistente é recusa, não exceção')
  const fantasma: any = await ferramentas.executar('cancelar_sessao', {
    agendamentoId: '00000000-0000-0000-0000-000000000000',
  })
  checar(fantasma.ok === false && fantasma.motivo === MOTIVO.NAO_ENCONTRADO, 'motivo nao_encontrado', fantasma)
} finally {
  // Limpa o que o teste criou, inclusive os cancelados.
  for (const id of criados) {
    await supabase.schema('central').from('appointments').delete().eq('id', id)
  }
  await supabase.schema('central').from('appointments')
    .delete().eq('organization_id', ORG)
    .eq('description', 'teste automatizado das ferramentas')
}

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} ASSERÇÃO(ÕES) FALHARAM`)
process.exit(falhas === 0 ? 0 : 1)
