//solicitar//

'use client'

import { useEffect, useState, useMemo, useRef } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import { descreverErro, ehMigrationPendente } from '@/lib/supabase/erro'

import { criarAutorizacao, resolverNomeUsuario } from '@/services/autorizacoes.service'

import {
  previewFaltaEmLote,
  aplicarFaltaEmLote,
  reverterFaltaEmLote,
  MOTIVOS_FALTA,
  ROTULO_IGNORADA,
  type MotivoFalta,
  type FaltaLoteResultado,
} from '@/services/autorizacoes.service'

import toast from 'react-hot-toast'

import { Lock, CheckCircle, Loader2, Megaphone, XCircle, CalendarX, Undo2 } from 'lucide-react'

import { sondarRobo } from '@/lib/machine'

import {
  lerHeartbeatDaMinhaMaquina,
  mensagemDoRobo,
  montarDiagnostico,
  type DiagnosticoRobo,
} from '@/lib/diagnostico-robo'

import {
  INTERVALO_ASSIM_MIN,
  LIBERACAO_SOLICITAR_MIN,
  horaDoTimestamp,
  minutosDesde,
  podeSolicitar,
} from '@/lib/central/intervaloAssim'


// Janela em que um segundo "Chamar" para a MESMA sessão é recusado.
//
// O número sai dos dados: em 30 dias de `chamada_paciente`, toda rechamada
// deliberada (o responsável não apareceu, a recepção insistiu) esteve acima de
// 2 min, enquanto as rajadas de cards irmãos ficaram abaixo de 1s. 90s separa
// os dois casos com folga dos dois lados — e errar para o lado curto é o certo:
// a recepção espera alguns segundos e chama de novo, contra um pai que nunca
// descobre que foi chamado.
const JANELA_RECHAMADA_MS = 5_000

// O banner "Desfazer lote" precisa sobreviver a um F5: a atendente lança o
// feriado, percebe que errou a data e recarrega a página por reflexo. Duas horas
// cobrem o arrependimento real; depois disso o caminho é o snippet de suporte
// com o lote_id, que continua gravado no banco.
const CHAVE_ULTIMO_LOTE = 'pulsar:ultimoLoteFalta'
const TTL_ULTIMO_LOTE_MS = 2 * 60 * 60 * 1000

// =========================
// TERAPIAS OCULTAS
// (não exibidas na Central de Atendimentos)
// =========================
const TERAPIAS_OCULTAS = [
  'equoterapia',
  'fisioterapia aquática',
  'fisioterapia aquatica',
]

function terapiaOculta(p: any) {
  return (p.terapias || []).some((t: string) =>
    TERAPIAS_OCULTAS.includes((t || '').toLowerCase().trim())
  )
}


const CAMPOS_CENTRAL_AUTORIZACOES = `
    paciente_id,
    paciente_nome,
    cpf,
    data_nascimento,

    horario,
    data_atendimento,

    codigos_tuss,

    convenio_nome,
    convenio_id,

    sala_nome,

    empresa,
    matricula,
    dep,

    crm,
    nome_medico,

    status_final,
    mostrar_na_tela,
    tipo_fluxo,

    terapias,
    profissionais,
    agendamentos,

    horario_autorizacao,
    cancelado_por_nome,
    ultima_autorizacao_anterior
`

const CAMPOS_CENTRAL_AUTORIZACOES_LEGADO = `
    paciente_id,
    paciente_nome,

    horario,
    data_atendimento,

    codigos_tuss,

    convenio_nome,
    convenio_id,

    sala_nome,

    empresa,
    matricula,
    dep,

    crm,
    nome_medico,

    status_final,
    mostrar_na_tela,
    tipo_fluxo,

    terapias,
    profissionais,
    agendamentos,

    horario_autorizacao,
    ultima_autorizacao_anterior
`


export default function SolicitarPage() {
  const hoje = (() => {
	  const d = new Date()

	  const ano = d.getFullYear()
	  const mes = String(
		d.getMonth() + 1
	  ).padStart(2, '0')

	  const dia = String(
		d.getDate()
	  ).padStart(2, '0')

	  return `${ano}-${mes}-${dia}`
	})()

  const [dataSelecionada, setDataSelecionada] = useState(hoje)

  const [listaDia, setListaDia] = useState<any[]>([])

  // Snapshot completo e ESTÁVEL do dia (setado só no carregarLista, nunca mutado
  // pelos handlers de falta/manual). Usado para a contagem "N de Total" do badge,
  // que antes encolhia conforme o operador processava sessões.
  const [listaDiaCompleta, setListaDiaCompleta] = useState<any[]>([])

  const [loadingLista, setLoadingLista] = useState(true)

  const supabase = getSupabaseClient()

  const horarios = gerarHorarios()

const unidades = [

  ...new Set(

    (listaDia || [])
      .flatMap(p => p.sala_nome || [])
      .map((s: string) =>
        s
          ?.replace('Unid. ', '')
          ?.split(' - ')[0]
      )
      .filter(Boolean)

  )

].sort()

  const sessoesHoje = useMemo(() => {
    const grupos: Record<number, { horario: string; terapia: string }[]> = {}

    // Conta sobre o dia COMPLETO e estável, excluindo terapias ocultas/blacklist.
    // Assim "N de Total" reflete todas as sessões do dia do paciente e NÃO encolhe
    // ao concluir/marcar falta (que só removem de listaDia, usado na exibição).
    listaDiaCompleta
      .filter(p => !terapiaOculta(p))
      .forEach(p => {
        const id = p.paciente_id
        if (!grupos[id]) grupos[id] = []
        grupos[id].push({ horario: p.horario ?? '', terapia: p.terapias?.[0] ?? '' })
      })

    const lookup: Record<string, { index: number; total: number }> = {}
    Object.entries(grupos).forEach(([id, sessoes]) => {
      sessoes.sort((a, b) => a.horario.localeCompare(b.horario))
      sessoes.forEach((s, i) => {
        lookup[`${id}_${s.horario}_${s.terapia}`] = { index: i + 1, total: sessoes.length }
      })
    })

    return lookup
  }, [listaDiaCompleta])

  const convenios = [

	  ...new Set(

		(listaDia || [])
		  .map(p => p.convenio_nome)
		  .filter(Boolean)

	  )

	].sort()

  // Opções de recorte do modal de "Registrar dia sem atendimento".
  //
  // Carregadas da data ESCOLHIDA NO MODAL, não da data aberta na tela — as duas
  // são independentes de propósito (ver abrirModalLote). Uma versão anterior
  // derivava estas listas de `listaDiaCompleta`, o que oferecia à atendente as
  // unidades e horários de um dia diferente daquele que ela estava fechando; o
  // sintoma era um aviso âmbar pedindo que ela "prefira deixar em todos", que é
  // um curativo sobre opções erradas em vez de opções certas.
  const [opcoesLote, setOpcoesLote] = useState<{
    unidades: string[]
    horarios: string[]
    convenios: string[]
  }>({ unidades: [], horarios: [], convenios: [] })
  const [carregandoOpcoesLote, setCarregandoOpcoesLote] = useState(false)

  const [filtroHorario, setFiltroHorario] = useState('')
  
  const [filtroUnidade, setFiltroUnidade] = useState('')
  
  const [filtroConvenio, setFiltroConvenio] = useState('')
  
  const [modalFalta, setModalFalta] = useState(false)
  
  const [pacienteFalta, setPacienteFalta] = useState<any>(null)
  
  const [confirmarFaltaDia, setConfirmarFaltaDia] = useState(false)
  
  const [pacienteFaltaDia, setPacienteFaltaDia] = useState<any>(null)

  const [justificativaFalta, setJustificativaFalta] = useState('')

  // ── Falta em lote ─────────────────────────────────────────────────────────
  // Feriado e afins: o dia inteiro cai de uma vez. Duas etapas — formulário e
  // confirmação com os números — porque errar a data aqui atinge centenas de
  // sessões de uma vez.
  const [modalLote, setModalLote] = useState(false)
  const [loteEtapa, setLoteEtapa] = useState<'form' | 'confirmacao'>('form')
  const [loteData, setLoteData] = useState('')
  const [loteMotivo, setLoteMotivo] = useState<MotivoFalta>('feriado')
  const [loteJustificativa, setLoteJustificativa] = useState('')
  // Fixo: o lote existe para os casos em que a clínica não abriu. Ver o bloco
  // explicativo no modal, onde o seletor de tipo deliberadamente não existe.
  const loteTipo = 'unidade' as const
  const [loteUnidade, setLoteUnidade] = useState('')
  const [loteHorario, setLoteHorario] = useState('')
  const [loteConvenio, setLoteConvenio] = useState('')
  const [loteContagem, setLoteContagem] = useState<FaltaLoteResultado | null>(null)
  const [loteCarregando, setLoteCarregando] = useState(false)
  const [ultimoLote, setUltimoLote] = useState<
    { id: string; aplicadas: number; quando: number } | null
  >(null)

  const [filtro, setFiltro] = useState('')
  
  const [MACHINE_ID, setMachineId] = useState<string | null>(null)

  // Diagnóstico do robô, não um booleano. `robo.pronto` decide o botão; o resto
  // existe para o aviso poder dizer O QUE fazer — ver DiagnosticoRobo.
  const [robo, setRobo] = useState<DiagnosticoRobo>({ pronto: false, estado: 'verificando' })

  const workerOnline = robo.pronto

  // Confirmação em dois toques para os avisos de ordem/adiantamento: o primeiro
  // clique arma o card e explica, o segundo (em até 10s) solicita mesmo assim.
  // Bloquear de vez travaria a recepção nos casos legítimos; não avisar foi o que
  // deixou a colisão de 21/08 passar calada.
  const [avisoArmado, setAvisoArmado] =
    useState<{ chave: string; ate: number } | null>(null)

  // Nome de quem está na estação, resolvido uma vez. Serve só para o selo do card
  // aparecer com autor no mesmo instante do clique — quem grava de fato é
  // criarAutorizacao(), que chama resolverNomeUsuario() por conta própria.
  const [nomeUsuario, setNomeUsuario] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    resolverNomeUsuario(supabase)
      .then((nome) => { if (!cancelado) setNomeUsuario(nome) })
      .catch(() => { /* sem nome o selo só não mostra autor */ })
    return () => { cancelado = true }
  }, [])

  useEffect(() => {
    try {
      const cru = localStorage.getItem(CHAVE_ULTIMO_LOTE)
      if (!cru) return
      const salvo = JSON.parse(cru)
      if (Date.now() - salvo.quando > TTL_ULTIMO_LOTE_MS) {
        localStorage.removeItem(CHAVE_ULTIMO_LOTE)
        return
      }
      setUltimoLote(salvo)
    } catch {
      /* storage indisponível ou lixo salvo: o banner só não aparece */
    }
  }, [])

  useEffect(() => {
    try {
      if (ultimoLote) {
        localStorage.setItem(CHAVE_ULTIMO_LOTE, JSON.stringify(ultimoLote))
      } else {
        localStorage.removeItem(CHAVE_ULTIMO_LOTE)
      }
    } catch {
      /* idem */
    }
  }, [ultimoLote])

  // Chamar o responsável é um ato sobre a PESSOA numa sessão, então a chave é
  // (paciente, data, horário) e não `buildCardKey` — que inclui a terapia e
  // deixaria a trava passar por cima do mesmo pai duas vezes.
  //
  // Por que a trava existe: em 31/08 o Davi Lucas acumulou 15 chamadas num dia,
  // 6 delas em 900 ms. A investigação descartou bug — o clique gera UM insert
  // (verificado na aba Network), a RPC devolve um card por sessão (339 para 339)
  // e a página não tem realtime remontando nada. Eram cliques reais, repetidos.
  //
  // O que fazia a recepção clicar tanto: a TV ficou MUDA até 31/08 (não havia
  // servidor de áudio no mini PC). Quem apertava não tinha retorno nenhum — a
  // tela está em outra sala —, então clicava de novo. Nos dias anteriores, com o
  // mesmo silêncio, os intervalos eram de 11–18s; sem nada acontecendo, foram
  // encurtando.
  //
  // O som resolvido remove a causa, e esta trava fecha a porta: o botão passa a
  // "Chamado" e informa, na própria tela onde se clicou, que a chamada saiu.
  const chaveChamada = (p: any) =>
    [String(p.paciente_id), String(p.data_atendimento), String(p.horario)].join('_')

  // Instante da última chamada por sessão. Não é só "em voo": segue valendo
  // depois que o insert responde, porque o clique seguinte na fileira vem
  // centenas de milissegundos depois — o `finally` já teria liberado.
  const chamadasRecentes = useRef<Map<string, number>>(new Map())

  // Cards cujo "Chamar" está em voo — só para o feedback visual do botão.
  const [chamando, setChamando] = useState<Set<string>>(new Set())

  // Relógio de 1s que existe só para o botão sair de "Chamado" sozinho quando a
  // janela expira. Sem ele o rótulo dependeria de um re-render por outro motivo
  // — e o botão poderia ficar travado por minutos numa tela parada.
  //
  // Um `setState` a cada segundo numa página deste tamanho não é de graça, então
  // o relógio só existe ENQUANTO há chamada dentro da janela: `chamandoAlgo`
  // liga o efeito, e o próprio efeito se desliga quando o Map esvazia.
  const [tique, setTique] = useState(() => Date.now())
  const [chamandoAlgo, setChamandoAlgo] = useState(false)

  useEffect(() => {
    if (!chamandoAlgo) return

    const id = setInterval(() => {
      const agora = Date.now()

      // Some com o que já expirou: mantém o Map pequeno numa jornada inteira e
      // é o que permite ao efeito saber que não há mais nada a vigiar.
      for (const [k, t] of chamadasRecentes.current) {
        if (agora - t >= JANELA_RECHAMADA_MS) chamadasRecentes.current.delete(k)
      }

      setTique(agora)

      // Nada mais dentro da janela: desliga o relógio em vez de ficar
      // re-renderizando a página de segundo em segundo pelo resto do plantão.
      if (chamadasRecentes.current.size === 0) setChamandoAlgo(false)
    }, 1000)

    return () => clearInterval(id)
  }, [chamandoAlgo])

  const chamarResponsavel = async (paciente: any) => {
    const chave = chaveChamada(paciente)
    const agora = Date.now()
    const ultima = chamadasRecentes.current.get(chave)

    // Rechamar é legítimo — o responsável pode não ter aparecido —, então a
    // janela é curta de propósito: ela separa a insistência de quem não viu
    // retorno da rechamada consciente, minutos depois. Nos 30 dias analisados,
    // toda repetição acima de 2 min foi deliberada; as rajadas ficaram abaixo
    // de 1s. 90s cai no meio com folga dos dois lados, e errar para o lado curto
    // é o certo: pior que uma trava frouxa é um pai que nunca é chamado.
    if (ultima !== undefined && agora - ultima < JANELA_RECHAMADA_MS) {
      toast(`${paciente.paciente_nome} já foi chamado agora`, { icon: '📣' })
      return
    }

    // Marca ANTES do await: dois cliques no mesmo tick precisam ver a marca já
    // gravada, e `useRef` é síncrono (ao contrário de setState).
    chamadasRecentes.current.set(chave, agora)
    setChamandoAlgo(true)

    const chaveCard = buildCardKey(paciente)
    setChamando((atual) => new Set(atual).add(chaveCard))

    try {
      // A tupla da sessão é o que permite a TV tirar o nome da tela sozinha
      // quando a autorização encerra. Não dá para gravar o id da fila aqui: no
      // instante do "Chamar" ela normalmente ainda não existe — o responsável
      // está sendo chamado justamente para que a autorização seja feita.
      //
      // paciente_id vai como texto porque é assim que fila_autorizacoes o
      // guarda; casar sem cast é o que mantém `unique_fila_agendamento` em uso.
      const { error } = await supabase
        .from('chamada_paciente')
        .insert([
          {
            nome: paciente.paciente_nome,
            sala:  'Recepção 1',
            paciente_id: paciente.paciente_id != null
              ? String(paciente.paciente_id)
              : null,
            data_atendimento: paciente.data_atendimento ?? null,
            horario: paciente.horario ?? null,
          }
        ])
  
      if (error) {
        // `console.error(error)` sozinho imprimia `{}` — PostgrestError não
        // sobrevive à serialização do console. E o toast dizia só "Erro ao
        // chamar paciente", que não distingue permissão de coluna inexistente.
        console.error('chamarResponsavel:', descreverErro(error))

        toast.error(
          ehMigrationPendente(error)
            ? 'Erro ao chamar: falta migration nesta base (chamada_paciente)'
            : `Erro ao chamar paciente: ${descreverErro(error)}`
        )
        return
      }

      // O sucesso precisa dizer algo. Sem isto o botão não confirma nada, e a
      // única prova de que funcionou era o nome surgir na TV — que fica noutra
      // sala. Quando a TV parou de mostrar, o sintoma na recepção foi "aperto e
      // nada acontece", indistinguível de insert falhando.
      toast.success(`${paciente.paciente_nome} chamado na TV`)
    } catch (err) {
      console.error(err)
      toast.error('Erro ao chamar paciente')
    } finally {
      // `finally` e não o fim do `try`: o ramo de erro acima sai por `return`, e
      // sem isto o botão daquele card ficaria travado até recarregar a página.
      setChamando((atual) => {
        const proximo = new Set(atual)
        proximo.delete(chaveCard)
        return proximo
      })
    }
  }

// =========================
// AJUSTE DE NOME
// =========================
function formatarNome(nome?: string) {

  if (!nome) return ''

  return nome
    .toLowerCase()
    .split(' ')
    .map(p =>
      p.charAt(0).toUpperCase() +
      p.slice(1)
    )
    .join(' ')
}


// =========================
// CARREGAR ID MAQUINA
// =========================

useEffect(() => {

  let cancelado = false

  async function carregarMachine() {

    const sonda = await sondarRobo()

    if (cancelado) return

    if (sonda.ok) {
      setMachineId(sonda.machineId)
      setRobo({ pronto: true, estado: 'ok' })
      return
    }

    // A porta local falhou. Isso AINDA NÃO diz que o robô parou: um bloqueio do
    // browser (CSP) rejeita o fetch exatamente como um robô morto rejeitaria, e
    // o motivo real só aparece no console. Quem separa os dois é o heartbeat.
    setMachineId(null)

    const heartbeat = await lerHeartbeatDaMinhaMaquina()

    if (cancelado) return

    setRobo(montarDiagnostico(sonda.motivo, heartbeat))
  }

  carregarMachine()

  // Re-checa periodicamente para detectar o robô assim que ele sobe (ou cai),
  // sem exigir refresh manual da página.
  const interval = setInterval(carregarMachine, 5000)

  return () => {
    cancelado = true
    clearInterval(interval)
  }

}, [])

// =========================
// PODE SOLICITAR
// =========================

// A regra dos 30 minutos mora em lib/central/intervaloAssim.ts desde que a página
// de autorizações avulsas passou a precisar dela: a avulsa é uma identificação do
// MESMO beneficiário no mesmo portal, então concorre pela mesma janela. Aqui ficam
// só as regras que são desta tela.
//
// `ultima_autorizacao_anterior` (RPC listar_central_autorizacoes) é a última
// autorização do paciente NO DIA, em qualquer horário. Antes ela só enxergava
// sessões mais cedo (fa2.horario < b.horario) e ficava cega justamente quando a
// recepção autorizava fora de ordem.

// Tolerância para pedir antes de a sessão começar. A ASSIM confirma a PRESENÇA do
// beneficiário: pedir muito antes é autorizar quem ainda não chegou — e queima a
// janela de 30 min da sessão seguinte.
const TOLERANCIA_ADIANTAMENTO_MIN = 15

function hhmm(horario: any) {
  return String(horario || '').slice(0, 5)
}

function inicioDaSessao(p: any): Date | null {

  if (!p?.data_atendimento || !p?.horario) return null

  const [ano, mes, dia] =
    String(p.data_atendimento).slice(0, 10).split('-').map(Number)

  const [hora, minuto] =
    String(p.horario).split(':').map(Number)

  if (!ano || !mes || !dia) return null

  return new Date(ano, mes - 1, dia, hora || 0, minuto || 0, 0, 0)
}

// Minutos que faltam para a sessão começar, só quando passam da tolerância.
function minutosDeAdiantamento(p: any) {

  const inicio = inicioDaSessao(p)

  if (!inicio) return 0

  const faltam = (inicio.getTime() - Date.now()) / 60000

  return faltam > TOLERANCIA_ADIANTAMENTO_MIN ? Math.round(faltam) : 0
}

// Sessão mais cedo do mesmo paciente, no mesmo dia, que ninguém pediu ainda.
// 'pendente'/'processando' já foram pedidas; 'falta'/'cancelado' não serão.
function sessaoAnteriorSemPedido(p: any, lista: any[]) {

  return lista.find(i =>
    String(i.paciente_id) === String(p.paciente_id) &&
    i.data_atendimento === p.data_atendimento &&
    i.tipo_fluxo === 'autorizacao' &&
    String(i.horario) < String(p.horario) &&
    (i.status_final === 'sem_acao' || i.status_final === 'erro')
  ) || null
}

// Avisos que NÃO são a regra da ASSIM: valem uma confirmação, não um bloqueio.
// Fora de ordem vem antes de adiantamento porque é o motivo mais específico.
function motivoDeAviso(p: any, lista: any[]) {

  const anterior = sessaoAnteriorSemPedido(p, lista)

  if (anterior) {
    return `A sessão das ${hhmm(anterior.horario)} deste paciente ainda não foi ` +
      `solicitada. Autorizar fora de ordem queima a janela de 30 min dela.`
  }

  const faltam = minutosDeAdiantamento(p)

  if (faltam) {
    return `Essa sessão só começa às ${hhmm(p.horario)} — faltam ${faltam} min. ` +
      `A ASSIM confirma a presença do beneficiário na hora do pedido.`
  }

  return null
}

  // =========================
  // 📥 CARREGAR LISTA
  // =========================

async function carregarLista() {

  setLoadingLista(true)

  const dataFiltro = dataSelecionada

  let { data, error } = await supabase
    .rpc('listar_central_autorizacoes', { p_data: dataFiltro })

  if (
    error &&
    erroColunaPacienteComplementar(error)
  ) {

    const retry = await supabase
      .from('vw_central_autorizacoes')
      .select(CAMPOS_CENTRAL_AUTORIZACOES_LEGADO)
      .eq('data_atendimento', dataFiltro)
      .eq('mostrar_na_tela', true)

    data = retry.data as typeof data
    error = retry.error
  }

  if (error) {
    console.error(error)
    toast.error('Erro ao carregar lista')
    setLoadingLista(false)
    return
  }

  setListaDia(data || [])
  setListaDiaCompleta(data || [])

  setLoadingLista(false)
}
// =========================
// SOLICITAR LISTA
// =========================

async function handleSolicitarLista(
  p: any
) {

  if (!MACHINE_ID) {

    toast.error(
      'Máquina não identificada'
    )

    return
  }

  try {

    // evita clique duplo
    if (
      p.status_final === 'processando'
    ) {
      return
    }

    // A linha que já existe para esta sessão é lida ANTES dos guardas: é ela que
    // diz se a tentativa anterior quebrou no meio, e o aviso precisa dizer isso
    // com todas as letras. "Solicitação cancelada" não é "paciente autorizado" —
    // uma não emitiu guia nenhuma, a outra emitiu.
    const { data: existente } =
      await supabase
        .from('fila_autorizacoes')
        .select('*')
		.eq('paciente_id', p.paciente_id)
		.eq('data_atendimento', p.data_atendimento)
		.eq('horario', p.horario)
		.eq(
		  'tuss',
		  p.codigos_tuss?.[0]
		)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle()

    // error_message é escrito pelo robô (robo_concluir_tarefa) com o texto que o
    // RPA levantou, p.ex. "A janela da ASSIM foi fechada durante a identificação
    // do beneficiário."
    const motivoErroAnterior =
      p.status_final === 'erro'
        ? String(existente?.error_message || '').trim().replace(/\s+/g, ' ')
        : ''

    // -- Regra dos 30 min da ASSIM -----------------------------------------
    // Bloqueio duro só para PEDIDO NOVO. Linha em 'erro' é retomada de uma
    // tentativa interrompida — a atendente abre, fecha a janela e volta dois
    // minutos depois — e isso NÃO PODE TRAVAR. Ali o intervalo vira aviso.
    //
    // Vale notar que a trava não olha o status da própria linha: a subquery de
    // ultima_autorizacao_anterior exclui o próprio horário, então uma tentativa
    // interrompida nunca bloqueia a si mesma. Quem bloquearia é OUTRA sessão do
    // paciente autorizada há pouco — e mesmo essa, no reprocesso, só avisa.
    const emErro = p.status_final === 'erro'

    let avisoIntervalo: string | null = null

    // Libera em LIBERACAO_SOLICITAR_MIN (31), um minuto acima do que a ASSIM
    // exige: o relógio que conta aqui é o do navegador, não o do portal. O TEXTO
    // abaixo continua citando os 30 — 31 é margem nossa, e anunciá-la ensinaria a
    // regra errada a quem lê.
    if (!podeSolicitar(p.ultima_autorizacao_anterior, LIBERACAO_SOLICITAR_MIN)) {

      const decorridos = minutosDesde(p.ultima_autorizacao_anterior) ?? 0
      // Conta contra o limiar que de fato libera, senão diria "faltam 0 min" com
      // o botão ainda recusando.
      const faltam = Math.max(1, Math.ceil(LIBERACAO_SOLICITAR_MIN - decorridos))

      // "OUTRA sessão": ultima_autorizacao_anterior exclui o próprio horário por
      // construção, e dizer só "paciente autorizado" faz a atendente achar que
      // ESTA sessão já saiu.
      const recado =
        `OUTRA sessão deste paciente foi autorizada às ` +
        `${horaDoTimestamp(p.ultima_autorizacao_anterior)} — faltam ${faltam} min ` +
        `para os ${INTERVALO_ASSIM_MIN} min que a ASSIM exige entre autorizações ` +
        `do mesmo beneficiário.`

      if (!emErro) {

        toast.error(recado)

        return
      }

      avisoIntervalo = recado
    }

    // -- Avisos: confirmação em dois toques --------------------------------
    const chaveCard = buildCardKey(p)

    const armado =
      !!avisoArmado &&
      avisoArmado.chave === chaveCard &&
      Date.now() < avisoArmado.ate

    if (!armado) {

      // O intervalo tem precedência: é o que a ASSIM vai reclamar primeiro.
      const aviso = avisoIntervalo ?? motivoDeAviso(p, listaDia)

      if (aviso) {

        setAvisoArmado({
          chave: chaveCard,
          ate: Date.now() + 10000
        })

        // Abre pelo que aconteceu com a tentativa anterior, e só depois pelo
        // motivo do aviso. Sem isto o texto começa falando de autorização e a
        // atendente lê "autorizado" onde houve cancelamento.
        const preambulo = emErro
          ? `A solicitação anterior das ${hhmm(p.horario)} foi CANCELADA` +
            (motivoErroAnterior ? `: ${motivoErroAnterior}` : '.') +
            `\nNenhuma guia foi emitida para esta sessão.\n\n`
          : ''

        toast(
          `${preambulo}${aviso}\n\nClique de novo para solicitar mesmo assim.`,
          {
            icon: '⚠️',
            duration: 10000,
            // O \n só vira quebra com pre-line; sem isto o aviso e a saída
            // colam numa linha só e o "clique de novo" some no meio do texto.
            style: { whiteSpace: 'pre-line', maxWidth: '420px' }
          }
        )

        return
      }
    }

    setAvisoArmado(null)

		
    // reaproveita
    if (existente) {

      if (
          existente.status === 'erro' ||
          existente.status === 'cancelado'
      ) {

		await supabase
		  .from('fila_autorizacoes')
				.update({
				  status: 'pendente',
				  error_message: null,
				  machine_id: MACHINE_ID || 'WEB',
				  updated_at: new Date().toISOString()
				})
		  .eq('id', existente.id)

        toast.success(
          'Reprocessando 🔄'
        )
		setListaDia(prev =>
		  prev.map(item =>
			buildCardKey(item) === buildCardKey(p)
			  ? {
				  ...item,
				  status_final: 'pendente',
				  // Reprocessar não passa por criarAutorizacao, então o criado_por
				  // da linha continua o de quem solicitou originalmente. Mantém o
				  // que veio do banco e só preenche se estava vazio.
				  criado_por: item.criado_por ?? nomeUsuario
				}
			  : item
		  )
		)
		
        return
      }

      if (
        existente.status === 'processando'
      ) {

        toast.error(
          'Já está em execução'
        )

        return
      }

      if (
        existente.status === 'concluido' ||
        existente.status === 'concluido_sem_guia'
      ) {

        toast.error(
          'Já autorizado'
        )

        return
      }

      toast(
        'Já existe registro'
      )

      return
    }

    // validação — apenas campos obrigatórios
    const faltando: string[] = []
    if (!p.matricula) faltando.push('Matrícula')
    // TUSS é obrigatório para ASSIM, mas pode faltar
    // CRM e Médico podem faltar (serão preenchidos manualmente no ASSIM)

    if (faltando.length > 0) {
      toast.error(`Dados incompletos: ${faltando.join(', ')}`)
      console.warn('[VALIDAÇÃO] Campos faltando:', { matricula: p.matricula, tuss: p.codigos_tuss, crm: p.crm, medico: p.nome_medico })
      return
    }

    // insert
    const inserted =
      await criarAutorizacao({

        agenda_id: p.agendamentos?.[0],

        paciente_nome:
          p.paciente_nome,
		
		cpf:
		  p.cpf,

		data_nascimento:
		  p.data_nascimento,

        matricula:
          p.matricula,

        paciente_id:
          p.paciente_id,

        data:
          p.data_atendimento,

        horario:
          p.horario,
		
		terapia_exibicao_id:
		  p.terapia_exibicao_id,

        tuss1:
          p.codigos_tuss?.[0] || null,

        status:
          'pendente',

        empresa:
          p.empresa,

        dep:
          p.dep,

        crm:
          p.crm,

        nome_medico:
          p.nome_medico,

        terapia_nome:
          p.terapias?.join(' + '),

        machine_id:
          MACHINE_ID
      })

    if (!inserted) {

      toast.error(
        'Erro ao solicitar'
      )

      return
    }

    toast.success(
      'Autorização enviada 🚀'
    )

	setListaDia(prev =>
	  prev.map(item =>
		buildCardKey(item) === buildCardKey(p)
		  ? {
			  ...item,
			  status_final: 'pendente',
			  // Mesmo nome que criarAutorizacao acabou de gravar, para o selo já
			  // sair com autor sem esperar o realtime ou um F5.
			  criado_por: nomeUsuario
			}
		  : item
	  )
	)

  } catch (err) {

    console.error(err)

    toast.error(
      'Erro inesperado'
    )
  }
}

  // =========================
  // ❌ FALTA
  // =========================

async function handleFalta(p: any, tipo: 'paciente' | 'terapeuta', justificativa?: string) {

  try {
    const { data: existente } = await supabase
      .from('fila_autorizacoes')
      .select('id, status')
		.eq('paciente_id', p.paciente_id)
		.eq('data_atendimento', p.data_atendimento)
		.eq('horario', p.horario)
		.eq(
  'tuss',
  p.codigos_tuss?.[0]
)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle()

    // 🔁 SE JÁ EXISTE → ATUALIZA
    if (existente) {
      // Registra a atendente responsável também no fluxo de falta: este UPDATE
      // não passa por criarAutorizacao, então o criado_por ficava NULL.
      const criadoPor = await resolverNomeUsuario(supabase)
      const { error } = await supabase
        .from('fila_autorizacoes')
        .update({
          status: 'falta',
          tipo_falta: tipo,
          terapia_falta: p.terapias?.join(' + ') || null,
          justificativa_falta: justificativa || null,
          criado_por: criadoPor
        })
        .eq('id', existente.id)

      if (error) {
        console.error(error)
        toast.error('Erro ao atualizar falta')
        return
      }


      toast.success('Falta registrada (atualizado)')
		setListaDia(prev =>
		  prev.filter(
			item =>
			  buildCardKey(item) !== buildCardKey(p)
		  )
		)
      return
    }

    // 🚀 SE NÃO EXISTE → CRIA PADRONIZADO
    const inserted = await criarAutorizacao({
      agenda_id: p.agendamentos?.[0],
      paciente_nome: p.paciente_nome,
	  cpf: p.cpf,
	  data_nascimento: p.data_nascimento,
      matricula: p.matricula || null,
      data: p.data_atendimento, // ⚠️ corrigido (antes usava "hoje")
      horario: p.horario,
	  paciente_id: p.paciente_id,
	  terapia_nome: p.terapias?.join(' + '),
	  terapia_exibicao_id: p.terapia_exibicao_id,
      tuss1: p.codigos_tuss?.[0] || null,
      status: 'falta',
      empresa: p.empresa || null,
      dep: p.dep || null,
      crm: p.crm || null,
      nome_medico: p.nome_medico || null,
      machine_id: MACHINE_ID || 'WEB'
    })

    if (!inserted) {
      toast.error('Erro ao registrar falta')
      return
    }

    // 🔥 COMPLEMENTA CAMPOS DE FALTA
    await supabase
      .from('fila_autorizacoes')
      .update({
        tipo_falta: tipo,
        terapia_falta: p.terapias?.join(' + ') || null,
        justificativa_falta: justificativa || null
      })
      .eq('id', inserted.id)

    toast.success('Falta registrada com sucesso')
	
	setListaDia(prev =>
	  prev.filter(
		item =>
		  buildCardKey(item) !== buildCardKey(p)
	  )
	)

  } catch (err) {
    console.error(err)
    toast.error('Erro inesperado')
  }
}
  // ===========================
  // ❌ FALTA DIA DE ATENDIMENTO
  // ===========================
  
async function handleFaltaDia(paciente: any, justificativa?: string) {

  const dataAtendimento = paciente.data_atendimento

const atendimentos = Object.values(

  listaDia
    .filter(
      (p) =>
        p.paciente_id === paciente.paciente_id &&
        p.data_atendimento === dataAtendimento
    )

    .reduce((acc: any, p: any) => {

      const key = buildCardKey(p)

      if (!acc[key]) {
        acc[key] = p
      }

      return acc

    }, {})

)

  for (const p of atendimentos as any[]) {

    const { data: existente } = await supabase
      .from('fila_autorizacoes')
      .select('id')
		.eq('paciente_id', p.paciente_id)
		.eq('data_atendimento', p.data_atendimento)
		.eq('horario', p.horario)
		.eq(
		  'tuss',
		  p.codigos_tuss?.[0]
		)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle()

    if (existente) {
      // 🔄 ATUALIZA
      const criadoPor = await resolverNomeUsuario(supabase)
      await supabase
        .from('fila_autorizacoes')
        .update({
          status: 'falta',
          tipo_falta: 'paciente',
          terapia_falta: p.terapias?.join(' + ') || null,
          justificativa_falta: justificativa || null,
          criado_por: criadoPor
        })
        .eq('id', existente.id)

    } else {
      // 🚀 CRIA PADRONIZADO
      const inserted = await criarAutorizacao({
        agenda_id: p.agendamentos?.[0],
        paciente_nome: p.paciente_nome,
		cpf: p.cpf,
		data_nascimento: p.data_nascimento,
        matricula: p.matricula || null,
        data: dataAtendimento,
		paciente_id: p.paciente_id,
        horario: p.horario,
		terapia_nome: p.terapias?.join(' + '),
		terapia_exibicao_id: p.terapia_exibicao_id,
        tuss1: p.codigos_tuss?.[0] || null,
        status: 'falta',
        empresa: p.empresa || null,
        dep: p.dep || null,
        crm: p.crm || null,
        nome_medico: p.nome_medico || null,
        machine_id: MACHINE_ID || 'WEB'
      })

      if (!inserted) {
        console.log('Erro ao criar falta:', p.paciente_nome)
        continue
      }

	
      // 🔥 GARANTE CAMPOS ESPECÍFICOS DE FALTA
      await supabase
        .from('fila_autorizacoes')
        .update({
          tipo_falta: 'paciente',
          terapia_falta: p.terapias?.join(' + ') || null,
          justificativa_falta: justificativa || null
        })
        .eq('id', inserted.id)
    }
  }

  toast.success('Faltas aplicadas para o dia todo')

  // 🔥 remove da tela
	setListaDia(prev =>
	  prev.filter(
		item =>
		  item.paciente_id !== paciente.paciente_id ||
		  item.data_atendimento !== paciente.data_atendimento
	  )
	)

} 
  

  // ===========================
  // ❌ FALTA EM LOTE
  // ===========================
  //
  // Feriado, ponto facultativo, falta de energia: o dia inteiro cai. Ao
  // contrário de handleFaltaDia (que é um paciente por vez, em laço), aqui uma
  // única RPC resolve o recorte inteiro numa transação — ver
  // supabase/migrations/20260908100100_registrar_falta_em_lote.sql.

  function abrirModalLote() {
    // A data começa VAZIA, e não herdada da tela.
    //
    // Registrar um dia sem atendimento é quase sempre uma ação sobre outro dia
    // — o feriado que vem, a segunda em que faltou luz — enquanto a tela
    // costuma estar em hoje.
    // Herdar a data da página fazia o campo chegar pré-preenchido com um valor
    // plausível e quase sempre errado, do tipo que ninguém relê antes de
    // confirmar. Vazio, a data é uma escolha; preenchida, era uma suposição.
    //
    // Os filtros de recorte também não são herdados: eles restringem o que já
    // está na tela (a data de hoje), e aplicá-los a outro dia produziria um
    // recorte que a atendente não pediu.
    setLoteData('')
    setLoteMotivo('feriado')
    setLoteJustificativa(justificativaPadrao('feriado'))
    setLoteUnidade('')
    setLoteHorario('')
    setLoteConvenio('')
    setLoteContagem(null)
    setLoteEtapa('form')
    setModalLote(true)
  }

  function fecharModalLote() {
    setModalLote(false)
    setLoteEtapa('form')
    setLoteContagem(null)
  }

  function justificativaPadrao(motivo: MotivoFalta) {
    const mapa: Record<MotivoFalta, string> = {
      feriado:           'Feriado — unidade fechada',
      ponto_facultativo: 'Ponto facultativo — unidade fechada',
      falta_energia:     'Falta de energia na unidade',
      evento_climatico:  'Evento climático — atendimentos suspensos',
      outro:             '',
    }
    return mapa[motivo]
  }

  // As funções do serviço já traduzem os códigos do Postgres em mensagens que a
  // atendente entende; aqui só é preciso extrair o texto com segurança.
  function mensagemDoErro(err: unknown, padrao: string) {
    return err instanceof Error && err.message ? err.message : padrao
  }

  function paramsDoLote() {
    return {
      data: loteData,
      motivo: loteMotivo,
      justificativa: loteJustificativa.trim(),
      tipoFalta: loteTipo,
      unidade: loteUnidade || null,
      horario: loteHorario || null,
      convenioNome: loteConvenio || null,
    }
  }

  // Salvar → conta o que seria feito e mostra a confirmação. Não escreve nada.
  async function handleLotePreview() {
    if (!loteJustificativa.trim()) {
      toast.error('Justificativa é obrigatória')
      return
    }

    setLoteCarregando(true)
    try {
      const r = await previewFaltaEmLote(paramsDoLote())

      if (r.aplicadas === 0) {
        // Falha silenciosa clássica: confirmar um lote que não faria nada e sair
        // achando que o dia foi registrado. Melhor dizer aqui.
        toast.error(
          r.ignoradas > 0
            ? `Nada a registrar — as ${r.ignoradas} sessões deste dia já estão resolvidas.`
            : 'Nenhuma sessão neste dia com os filtros escolhidos.'
        )
        setLoteCarregando(false)
        return
      }

      setLoteContagem(r)
      setLoteEtapa('confirmacao')
    } catch (err: unknown) {
      toast.error(mensagemDoErro(err, 'Erro ao calcular o lote'))
    } finally {
      setLoteCarregando(false)
    }
  }

  async function handleLoteAplicar() {
    if (!loteContagem) return

    setLoteCarregando(true)
    try {
      // Mesmo lote_id do preview: se a resposta se perder na rede e a atendente
      // clicar de novo, o banco recusa em vez de lançar tudo duas vezes.
      const r = await aplicarFaltaEmLote({
        ...paramsDoLote(),
        loteId: loteContagem.lote_id,
      })

      // "Unidade fechada" é o mesmo rótulo que o card, a Central e a Auditoria
      // mostram daqui em diante (ver severity.ts e statusAutorizacao.ts). O
      // toast é a última coisa na tela antes de a atendente olhar a lista: dizer
      // aqui a palavra que ela vai ler lá poupa a tradução.
      toast.success(
        r.ignoradas > 0
          ? `${r.aplicadas} sessões marcadas como unidade fechada · ${r.ignoradas} mantidas como estavam`
          : `${r.aplicadas} sessões marcadas como unidade fechada`
      )

      setUltimoLote({ id: r.lote_id, aplicadas: r.aplicadas, quando: Date.now() })
      fecharModalLote()

      // Recarrega pela RPC em vez de reconciliar o estado local: em massa é mais
      // barato e não corre o risco de a tela discordar do banco.
      await carregarLista()
    } catch (err: unknown) {
      toast.error(mensagemDoErro(err, 'Erro ao lançar as faltas'))
    } finally {
      setLoteCarregando(false)
    }
  }

  async function handleDesfazerLote() {
    if (!ultimoLote) return

    setLoteCarregando(true)
    try {
      const r = await reverterFaltaEmLote(ultimoLote.id)
      toast.success(
        r.revertidas === 1
          ? '1 sessão voltou para a lista'
          : `${r.revertidas} sessões voltaram para a lista`
      )
      setUltimoLote(null)
      await carregarLista()
    } catch (err: unknown) {
      toast.error(mensagemDoErro(err, 'Erro ao desfazer o lote'))
    } finally {
      setLoteCarregando(false)
    }
  }

  // =========================
  // CONCLUSAO MANUAL
  // =========================

async function handleManualLista(p: any) {

  try {
    // Atendente responsável — gravada também no UPDATE (não passa por criarAutorizacao).
    const criadoPor = await resolverNomeUsuario(supabase)
    // 🔍 VERIFICA SE JÁ EXISTE NA FILA
    const { data: existente } = await supabase
      .from('fila_autorizacoes')
      .select('id, status')
		.eq('paciente_id', p.paciente_id)
		.eq('data_atendimento', p.data_atendimento)
		.eq('horario', p.horario)
		.eq(
		  'tuss',
		  p.codigos_tuss?.[0]
		)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle()

    // 🔁 SE JÁ EXISTE → ATUALIZA
    if (existente) {
      const { error } = await supabase
        .from('fila_autorizacoes')
		.update({
		  status: 'concluido',
		  completion_type: 'presenca',
		  numero_autorizacao: 'N/A',
		  horario_autorizacao: new Date().toISOString(),
		  completed_at: new Date().toISOString(),
		  criado_por: criadoPor,
		})
        .eq('id', existente.id)

      if (error) {
        console.log('ERRO COMPLETO:', JSON.stringify(error, null, 2))
        toast.error('Erro ao atualizar presença')
        return
      }


      toast.success('Presença atualizada 📝')

    } else {
      // 🚀 SE NÃO EXISTE → INSERT PADRONIZADO
      const inserted = await criarAutorizacao({
        agenda_id: p.agendamentos?.[0],
        paciente_nome: p.paciente_nome,
		cpf: p.cpf,
		data_nascimento: p.data_nascimento,
        matricula: p.matricula,
        data: p.data_atendimento,
		paciente_id: p.paciente_id,
        horario: p.horario,
        tuss1: p.codigos_tuss?.[0] || null,
        status: 'concluido',
		horario_autorizacao: new Date().toISOString(),
        empresa: p.empresa,
		terapia_nome: p.terapias?.join(' + '),
		terapia_exibicao_id: p.terapia_exibicao_id,
        dep: p.dep,
        crm: p.crm,
        nome_medico: p.nome_medico,
        machine_id: MACHINE_ID || 'WEB'
      })

      if (!inserted) {
        toast.error('Erro ao registrar presença')
        return
      }

      // 🔥 GARANTE QUE FIQUE COMO PRESENÇA (extra segurança)
      await supabase
        .from('fila_autorizacoes')
		.update({
		  completion_type: 'presenca',
		  numero_autorizacao: 'N/A',
		  horario_autorizacao: new Date().toISOString(),
		  completed_at: new Date().toISOString(),
		})
        .eq('id', inserted.id)

      toast.success('Presença registrada 📝')
    }

    // 🔥 REMOVE DA LISTA (igual falta)
    setListaDia(prev =>
	  prev.filter(
		item =>
		  buildCardKey(item) !== buildCardKey(p)
	  )
	)

  } catch (err) {
    console.error(err)
    toast.error('Erro inesperado')
  }
}  


// =========================
// ⛔ CANCELAR PROCESSAMENTO
// =========================

async function handleCancelarProcessamento(p: any) {
  try {
    const { data: existente } = await supabase
      .from('fila_autorizacoes')
      .select('id, status')
      .eq('paciente_id', p.paciente_id)
      .eq('data_atendimento', p.data_atendimento)
      .eq('horario', p.horario)
      .eq('tuss', p.codigos_tuss?.[0])
      .eq('status', 'processando')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!existente) {
      toast.error('Nenhum item em processamento encontrado')
      return
    }

    // Identifica quem está cancelando (para rastreio de autoria)
    const { data: { user } } = await supabase.auth.getUser()
    let nomeUsuario = user?.email ?? 'Desconhecido'
    if (user) {
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('nome')
        .eq('id', user.id)
        .maybeSingle()
      if (perfil?.nome) nomeUsuario = perfil.nome
    }

    const { error } = await supabase
      .from('fila_autorizacoes')
      .update({
        status: 'cancelado',
        cancelado_por_nome: nomeUsuario,
        cancelado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existente.id)
      .eq('status', 'processando')

    if (error) {
      toast.error('Erro ao cancelar solicitação')
      return
    }

    toast.success('Solicitação cancelada')

    setListaDia(prev =>
      prev.map(item =>
        buildCardKey(item) === buildCardKey(p)
          ? { ...item, status_final: 'cancelado', cancelado_por_nome: nomeUsuario }
          : item
      )
    )
  } catch (err) {
    console.error(err)
    toast.error('Erro inesperado')
  }
}

// =========================
// BUILD CARD KEY
// =========================

function buildCardKey(p: any) {
  return [
    String(p.paciente_id),
    String(p.data_atendimento),
    String(p.horario),
    String(p.terapias?.[0] || '')
  ].join('_')
}

  
  // =========================
  // ⏰ HORÁRIOS
  // =========================

  function gerarHorarios() {
    const horarios: string[] = []
    let h = 8
    let m = 0
    while (h < 12) {
      horarios.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      m += 40
      if (m >= 60) { h++; m -= 60 }
      if (h === 11 && m > 40) break
    }
    h = 13
    m = 0
    while (h < 18) {
      horarios.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      m += 40
      if (m >= 60) { h++; m -= 60 }
      if (h === 17 && m > 0) break
    }
    return horarios
  }

// =========================
// OPÇÕES DE RECORTE DO LOTE
// =========================
//
// Carrega unidades / horários / convênios da data escolhida DENTRO do modal.
// Só roda com o modal aberto e uma data preenchida: fora disso não há o que
// oferecer, e buscar a agenda de um dia que ninguém vai fechar é trabalho à toa.
useEffect(() => {
  if (!modalLote || !loteData) {
    setOpcoesLote({ unidades: [], horarios: [], convenios: [] })
    return
  }

  let cancelado = false
  setCarregandoOpcoesLote(true)

  ;(async () => {
    const { data, error } = await supabase
      .rpc('listar_central_autorizacoes', { p_data: loteData })

    if (cancelado) return

    if (error) {
      console.error('Erro ao carregar opções do lote:', error)
      // Sem opções a tela ainda funciona: os três selects ficam em "todos",
      // que é o recorte mais comum de um feriado.
      setOpcoesLote({ unidades: [], horarios: [], convenios: [] })
      setCarregandoOpcoesLote(false)
      return
    }

    const linhas = (data || []) as {
      sala_nome?: string[] | null
      horario?: string | null
      convenio_nome?: string | null
    }[]

    setOpcoesLote({
      unidades: [...new Set(
        linhas
          .flatMap(p => p.sala_nome || [])
          .map((s: string) => s?.replace('Unid. ', '')?.split(' - ')[0])
          .filter((s): s is string => Boolean(s))
      )].sort(),
      horarios: [...new Set(
        linhas
          .map(p => p.horario?.slice(0, 5))
          .filter((h): h is string => Boolean(h))
      )].sort(),
      convenios: [...new Set(
        linhas
          .map(p => p.convenio_nome)
          .filter((c): c is string => Boolean(c))
      )].sort(),
    })
    setCarregandoOpcoesLote(false)
  })()

  return () => { cancelado = true }
  // `supabase` vem de getSupabaseClient(), que devolve sempre a mesma instância;
  // incluí-lo nas dependências não mudaria nada e só faria o efeito parecer
  // reagir a algo que não muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [modalLote, loteData])

// =========================
// DATA DA AUTORIZACAO
// =========================

useEffect(() => {

  carregarLista()

}, [dataSelecionada])

// =========================
// REALTIME STATUS CARD
// =========================

// =========================
// REALTIME STATUS CARD
// =========================

useEffect(() => {

  const channel = supabase
    .channel(`realtime-status-card-${dataSelecionada}`)

    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'fila_autorizacoes',
        filter: `data_atendimento=eq.${dataSelecionada}`
      },

      (payload: any) => {

        console.log('REALTIME:', payload)

        const novo = payload.new as any

        if (!novo) return
		
		if (
		  String(novo.data_atendimento).slice(0, 10)
		  !==
		  String(dataSelecionada).slice(0, 10)
		) {
		  return
		}

        setListaDia(prev => {

          return prev
            .map(item => {

              const mesmoItem =

                String(item.paciente_id)

                ===

                String(novo.paciente_id)

                &&

                String(item.data_atendimento)

                ===

                String(novo.data_atendimento)

                &&

                String(item.horario)
                  .slice(0, 5)

                ===

                String(novo.horario)
                  .slice(0, 5)

                &&

                String(item.codigos_tuss?.[0])

                ===

                String(novo.tuss)

              if (!mesmoItem) {
                return item
              }

              // REMOVE DA TELA
              // 'glosa' entra aqui porque também é desfecho: a ASSIM respondeu,
              // recusando. A guia, o horário e o motivo já foram gravados pelo
              // robô a partir do recibo — não sobra ação para a recepção nesta
              // tela. Refazer, depois de corrigir o cadastro, é pela /autorizacoes.
              if (
                novo.status === 'concluido' ||
                novo.status === 'concluido_sem_guia' ||
                novo.status === 'glosa'
              ) {
                return null
              }

              // ATUALIZA STATUS
              return {
                ...item,
                status_final: novo.status,
                cancelado_por_nome: novo.cancelado_por_nome ?? item.cancelado_por_nome,
                // Sem isto, a passagem de 'pendente' para 'processando' feita pelo
                // robô apagaria o nome de quem solicitou: o payload do realtime
                // substitui o item inteiro e o card voltaria a dizer só "Processando".
                criado_por: novo.criado_por ?? item.criado_por
              }
            })

            .filter(Boolean)
        })
      }
    )

    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }

}, [])


  // =========================
  // 🎨 UI
  // =========================

  return (
    <div className="p-6 min-h-[calc(100vh-80px)] bg-background">
      {/* HEADER */}
      <div className="mb-6 px-5 py-3 bg-card border border-border rounded-2xl shadow-sm">
        {/* Título e ação de escopo do dia na mesma linha.
            O botão fica no header, e não junto dos filtros, porque não é um
            filtro: filtros mudam o que se vê, este muda o que existe. E fica
            longe dos botões do card (Autorizar / Presença / Falta), que são o
            trabalho de minuto a minuto — a distância física é o que evita
            confundir "marcar a falta deste paciente" com "fechar o dia inteiro".

            Neutro em repouso de propósito. A versão anterior era um retângulo
            âmbar numa faixa só dele entre os filtros e a lista: criava uma
            terceira zona na tela e usava a mesma cor do alerta do robô logo
            acima, fazendo uma ação de meia dúzia de vezes por ano competir com
            um aviso de fato urgente. A gravidade desta ação pertence à
            confirmação, não ao repouso. */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-600">
              Central de Atendimentos
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Gestão diária de presenças, faltas e autorizações
            </p>
          </div>

          <button
            type="button"
            onClick={abrirModalLote}
            title="Feriado, ponto facultativo ou falta de energia: registra que não houve atendimento"
            className="
              shrink-0 mt-0.5
              inline-flex items-center gap-2
              whitespace-nowrap
              rounded-lg
              border border-slate-200
              bg-white
              px-3 py-1.5
              text-[13px] font-medium text-slate-500
              shadow-sm
              transition-colors
              hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700
              focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40
            "
          >
            <CalendarX size={15} className="text-slate-400" />
            Registrar dia sem atendimento
          </button>
        </div>
        {/* O aviso muda de cor conforme a AÇÃO que ele pede. Âmbar quando a
            recepção resolve sozinha (reiniciar o robô); azul quando o robô está
            comprovadamente bem e o problema é técnico — insistir no PC ali só
            perde tempo. Cinza enquanto a primeira sonda não voltou, para a tela
            não piscar um alarme que se desmente em 2 segundos. */}
        {robo.estado !== 'ok' && (
          <div className={`
            mt-4 rounded-xl border px-4 py-3 text-sm flex items-start gap-2
            ${robo.estado === 'verificando'
              ? 'border-slate-200 bg-slate-50 text-slate-600'
              : robo.estado === 'bloqueado'
                ? 'border-sky-200 bg-sky-50 text-sky-900'
                : 'border-amber-200 bg-amber-50 text-amber-800'}
          `}>
            <span className="text-base leading-5">
              {robo.estado === 'verificando' ? '⏳' : robo.estado === 'bloqueado' ? 'ℹ' : '⚠'}
            </span>

            <span>{mensagemDoRobo(robo)}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-5">
        {/* ========================= */}
        {/* CARD PRINCIPAL */}
        {/* ========================= */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
	
{/* HEADER COM FILTRO */}
<div className="grid grid-cols-12 gap-3 mb-5">

  {/* 🔎 BUSCA */}
  <input
    type="text"
    placeholder="Buscar paciente..."
    value={filtro}
    onChange={(e) => setFiltro(e.target.value)}
    className="
      col-span-3
      border border-slate-200
      rounded-lg
      px-3 py-1.5
      text-sm
      bg-white
      text-slate-600
      shadow-sm
      focus:outline-none
      focus:ring-2
      focus:ring-[#3A8FB7]/40
    "
  />

  {/* 📅 DATA */}
  <input
    type="date"
    value={dataSelecionada}
    onChange={(e) =>
      setDataSelecionada(e.target.value)
    }
    className="
      col-span-2
      border border-slate-200
      rounded-lg
      px-3 py-1.5
      text-sm
      bg-white
      text-slate-600
      shadow-sm
      focus:outline-none
      focus:ring-2
      focus:ring-[#3A8FB7]/40
    "
  />

  {/* ⏰ HORÁRIO */}
  <div className="relative col-span-2">
    <select
      value={filtroHorario}
      onChange={(e) =>
        setFiltroHorario(e.target.value)
      }
      className="
        w-full
        appearance-none
        bg-white
        border border-slate-200
        rounded-lg
        px-3 py-1.5 pr-8
        text-sm
        text-slate-600
        shadow-sm
        focus:outline-none
        focus:ring-2
        focus:ring-[#3A8FB7]/40
      "
    >
      <option value="">Horário</option>

      {horarios.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>

    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
      ▼
    </div>
  </div>

  {/* 🏥 CONVÊNIO */}
  <div className="relative col-span-3">
    <select
      value={filtroConvenio}
      onChange={(e) =>
        setFiltroConvenio(e.target.value)
      }
      className="
        w-full
        appearance-none
        bg-white
        border border-slate-200
        rounded-lg
        px-3 py-1.5 pr-8
        text-sm
        text-slate-600
        shadow-sm
        focus:outline-none
        focus:ring-2
        focus:ring-[#3A8FB7]/40
      "
    >
      <option value="">Convênio</option>

      {convenios.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>

    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
      ▼
    </div>
  </div>

  {/* 🏢 UNIDADE */}
  <div className="relative col-span-2">
    <select
      value={filtroUnidade}
      onChange={(e) =>
        setFiltroUnidade(e.target.value)
      }
      className="
        w-full
        appearance-none
        bg-white
        border border-slate-200
        rounded-lg
        px-3 py-1.5 pr-8
        text-sm
        text-slate-600
        shadow-sm
        focus:outline-none
        focus:ring-2
        focus:ring-[#3A8FB7]/40
      "
    >
      <option value="">Unidade</option>

      {unidades.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>

    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
      ▼
    </div>
  </div>

</div>

          {/* DESFAZER O ÚLTIMO LOTE
              Sobrevive a F5 (localStorage, 2h). É a rede de segurança da ação:
              lançar o feriado na data errada atinge centenas de sessões, e o
              arrependimento costuma vir em segundos. */}
          {ultimoLote && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">
                <strong className="font-semibold text-slate-800">
                  {ultimoLote.aplicadas} {ultimoLote.aplicadas === 1 ? 'sessão' : 'sessões'}
                </strong>{' '}
                {ultimoLote.aplicadas === 1 ? 'marcada' : 'marcadas'} como unidade
                fechada às{' '}
                {new Date(ultimoLote.quando).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDesfazerLote}
                  disabled={loteCarregando}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                >
                  <Undo2 size={13} />
                  Desfazer
                </button>
                <button
                  onClick={() => setUltimoLote(null)}
                  className="text-slate-400 transition hover:text-slate-600"
                  title="Dispensar aviso"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* A ASSIM carimba a guia com a data em que ela foi emitida, não com a data
              do atendimento. Autorizando adiantado, as duas divergem e o vínculo
              automático guia↔sessão deixa de funcionar pelos caminhos que casam por
              data — a recuperação passa a depender de reconciliar_guias_por_janela. */}
          {dataSelecionada > hoje && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong className="font-semibold">Autorização antecipada.</strong>{' '}
              A ASSIM registrará a guia com a data de hoje, não com a data do
              atendimento — o número da guia pode demorar a aparecer na Central de
              Pacientes.
            </div>
          )}

          {loadingLista ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : (() => {
				const listaFiltrada = (
				  listaDia || []
				)
				.filter(
				  (p) => p.mostrar_na_tela
				)
				.filter(
				  (p) => !terapiaOculta(p)
				)
				.filter((p) => {
				
				const unidadesPaciente =
				  (p.sala_nome || []).map((s: string) =>
					s
					  ?.replace('Unid. ', '')
					  ?.split(' - ')[0]
				  )

				const matchUnidade =
				  !filtroUnidade ||
				  unidadesPaciente.includes(filtroUnidade)
  
			  const matchNome =
				!filtro ||
				(p.paciente_nome || '').toLowerCase().includes(filtro.toLowerCase())

			  const matchHorario =
				!filtroHorario ||
				p.horario?.slice(0, 5) === filtroHorario

			  const matchConvenio =
			    !filtroConvenio ||
			    p.convenio_nome === filtroConvenio
  
			  return (
					  matchNome &&
					  matchHorario &&
					  matchUnidade &&
					  matchConvenio
					)
			})
			
				
            if (listaFiltrada.length === 0) {
              return (
                <p className="text-sm text-slate-400">
                  Nenhum resultado encontrado 🔍
                </p>
              )
            }
			const listaOrdenada = [...listaFiltrada].sort((a: any, b: any) => {

			  // horário
				if (a.horario !== b.horario) {
				  return a.horario.localeCompare(b.horario)
				}

			  // nome
			  return (a.paciente_nome || '')
				.localeCompare(b.paciente_nome || '')

			})
			return (
			  <div className="space-y-3">
				{(listaOrdenada as any[]).map((p) => {

          const sessaoKey = `${p.paciente_id}_${p.horario ?? ''}_${p.terapias?.[0] ?? ''}`
          const sessaoInfo = sessoesHoje[sessaoKey]

			  const ativo =
				![
				  'processando',
				  'pendente'
				].includes(p.status_final)

			  const cpfFormatado =
				formatarCpf(p.cpf)

			  const dataNascimentoFormatada =
				formatarDataNascimento(
				  p.data_nascimento
				)

				  return (
			<div
			  key={buildCardKey(p)}
			  className="flex rounded-2xl border border-white/60 bg-white/90 border-slate-200/60 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:shadow-[0_10px_40px_rgba(0,0,0,0.10)] hover:-translate-y-[1px] transition-all duration-200 overflow-hidden"
			>
			  {/* ⏰ HORÁRIO */}
			<div className="bg-gradient-to-b from-[#3A8FB7]/15 to-[#3A8FB7]/5 px-6 flex flex-col items-center justify-center gap-1 min-w-[130px] border-r border-slate-200/60">
			  <span className="text-2xl font-bold text-[#3A8FB7] tracking-tight">
				{p.horario?.slice(0, 5)}
			  </span>
			  {sessaoInfo && sessaoInfo.total > 1 && (
			    <span className="text-[11px] font-bold text-white bg-[#3A8FB7] px-2.5 py-0.5 rounded-full shadow-sm">
			      {sessaoInfo.index}/{sessaoInfo.total}
			    </span>
			  )}
			</div>

{/* CONTEÚDO */}
<div className="flex flex-1 justify-between p-2 items-start gap-4">

  <div className="flex flex-col gap-2 min-w-0">

    {/* NOME */}
    <span className="text-lg font-semibold text-slate-800 leading-tight truncate">
      {formatarNome(p.paciente_nome)}
    </span>

		{(cpfFormatado || dataNascimentoFormatada) && (
		  <span className="text-xs text-slate-500 leading-tight">
			{[
			  cpfFormatado
				? `CPF: ${cpfFormatado}`
				: null,

			  dataNascimentoFormatada
				? `Nascimento: ${dataNascimentoFormatada}`
				: null
			]
			  .filter(Boolean)
			  .join(' | ')}
		  </span>
		)}
		
    {/* BADGES (INFORMAÇÃO) */}
    <div className="flex items-center gap-2 flex-wrap">

		  {/* TERAPIA */}
		  <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
		  	{p.terapias?.join(' + ') || 'Sem terapia'}
		  </span>

		{/* CONVENIO */}
		<span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100/70 text-slate-600 border border-slate-200">
		  {p.convenio_nome || 'Sem convênio'}
		</span>
		

      {/* STATUS */}
      {(p.status_final === 'processando') &&
	  (
        <span className="flex items-center gap-1 text-xs font-semibold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-md max-w-[260px]">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse shrink-0"></span>
          <span className="shrink-0">Processando</span>
          {/* Quem pediu. Numa recepção com várias estações, "Processando" sozinho
              vira pergunta em voz alta. truncate porque criado_por cai no e-mail
              quando o usuário não tem nome preenchido em `usuarios`. */}
          {p.criado_por && (
            <span className="font-normal text-blue-700 truncate">· {p.criado_por}</span>
          )}
        </span>
      )}

		{p.status_final === 'pendente' && (
		  <span className="flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md max-w-[260px]">
			<span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
			<span className="shrink-0">Na fila</span>
			{/* Mesmo motivo do selo acima: logo depois do clique o card fica aqui,
			    e é justamente quando a recepção precisa saber de quem é. */}
			{p.criado_por && (
			  <span className="font-normal text-amber-700 truncate">· {p.criado_por}</span>
			)}
		  </span>
		)}

      {p.status_final === 'erro' && (
        <span className="flex items-center gap-1 text-xs font-semibold text-red-800 bg-red-100 px-2 py-0.5 rounded-md">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
          Erro
        </span>
      )}

      {p.status_final === 'cancelado' && (
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
          {p.cancelado_por_nome
            ? `Cancelada por: ${p.cancelado_por_nome}`
            : 'Cancelada'}
        </span>
      )}
    </div>

{/* ÚLTIMA AUTORIZAÇÃO */}
{p.tipo_fluxo === 'autorizacao' && (
  <span className="text-xs text-slate-400">
    Última autorização:{' '}
    {p.ultima_autorizacao_anterior
      ? new Date(
          p.ultima_autorizacao_anterior
        ).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-'}
  </span>
)}


  </div>

<div className="flex flex-col gap-1 ml-4 w-[135px]">

{p.tipo_fluxo === 'autorizacao' ? (

  <button
    disabled={
      !workerOnline ||
      !ativo ||
      p.status_final === 'processando'
    }
    onClick={() => handleSolicitarLista(p)}
    title={workerOnline ? undefined : mensagemDoRobo(robo)}
    className={`w-full flex items-start justify-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg font-medium leading-none tracking-tight ${
      !workerOnline
        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
        : ativo
          ? 'bg-[#3A8FB7] text-white shadow-md hover:brightness-110'
          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
    }`}
  >
    <Lock size={14} className="relative -top-[1px]" />

    {
      // "Sistema Offline" era mentira quando o robô estava vivo e o browser é
      // que bloqueava. O rótulo cabe em 135px, então diz o essencial; o detalhe
      // (e o que fazer) fica no aviso do topo e no title.
      workerOnline
        ? 'Autorizar'
        : robo.estado === 'verificando'
          ? 'Verificando…'
          : robo.estado === 'bloqueado'
            ? 'Sem acesso local'
            : 'Robô Offline'
    }
  </button>

) : (

  <button
    disabled={!ativo}
    onClick={() => handleManualLista(p)}
    className={`w-full flex items-start justify-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg font-medium leading-none tracking-tight ${
		  ativo
			? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-700'
			: 'bg-slate-200 text-slate-400 cursor-not-allowed'
	  }`}
  >
  <CheckCircle
    size={14}
    className="relative -top-[1px]"
  />

  Presença
</button>

)}

{p.status_final === 'processando' && (
  <button
    onClick={() => handleCancelarProcessamento(p)}
    className="w-full flex items-start justify-center gap-1.5 text-[12px] px-2 py-1.5 rounded-lg font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 tracking-tight leading-none"
  >
    <XCircle size={14} className="relative -top-[1px]" />
    Cancelar
  </button>
)}

{(() => {
  const emVoo = chamando.has(buildCardKey(p))

  // O rótulo "Chamado" é o ponto principal desta correção, não a trava: até
  // 31/08 apertar "Chamar" não devolvia nada visível — a TV fica em outra sala
  // e estava sem som —, e era essa ausência de retorno que fazia a recepção
  // clicar de novo. Dizer na própria tela que a chamada saiu remove o motivo.
  //
  // Ler um ref na render não agenda re-render: o `tique` de 1s abaixo é quem
  // faz o botão voltar sozinho ao normal quando a janela expira.
  const ultima = chamadasRecentes.current.get(chaveChamada(p))
  const chamadoAgora =
    ultima !== undefined && tique - ultima < JANELA_RECHAMADA_MS

  const inerte = emVoo || chamadoAgora

  return (
    <button
      onClick={() => chamarResponsavel(p)}
      disabled={inerte}
      aria-busy={emVoo}
      title={
        chamadoAgora
          ? 'Responsável chamado há instantes — aguarde antes de chamar de novo'
          : undefined
      }
      className="w-full flex items-start justify-center gap-1.5 text-[12px] px-2 py-1.5 rounded-lg font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-emerald-100 tracking-tight leading-none"
    >
      {emVoo ? (
        <Loader2 size={14} className="relative -top-[1px] animate-spin" />
      ) : chamadoAgora ? (
        <CheckCircle size={14} className="relative -top-[1px]" />
      ) : (
        <Megaphone size={14} className="relative -top-[1px]" />
      )}
      {emVoo ? 'Chamando…' : chamadoAgora ? 'Chamado' : 'Chamar'}
    </button>
  )
})()}

<button
  onClick={() => {
    setPacienteFalta(p)
    setModalFalta(true)
  }}
  className="w-full flex items-start justify-center gap-1.5 text-[12px] px-2 py-1.5 rounded-lg font-medium bg-red-100 text-red-600 hover:bg-red-200 tracking-tight leading-none"
>
  <XCircle size={14} className="relative -top-[1px]" />
  Falta
</button>

</div>
</div>
</div>
				  )
				})}
			  </div>
			)
          })()}
        </div>

      </div>


{/* MODAL FALTA */}
{modalFalta && (
  <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">

    <div className="relative bg-white rounded-2xl shadow-xl p-6 w-[360px] border border-slate-200">

      {/* FECHAR (X) */}
      <button
        onClick={() => setModalFalta(false)}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-lg"
      >
        ✕
      </button>

      {/* TÍTULO */}
      <h2 className="text-lg font-semibold text-slate-800 text-center">
        Como deseja registrar a falta?
      </h2>

      {/* PACIENTE */}
      <p className="text-sm text-slate-600 text-center mt-2">
        {pacienteFalta?.paciente_nome}
      </p>

      {/* ESPAÇAMENTO */}
		<div className="mt-6 flex flex-col gap-3">

		  {/* PACIENTE */}
		  <button
			onClick={() => {
			  if (!pacienteFalta) return
			  setPacienteFaltaDia(pacienteFalta)
			  setConfirmarFaltaDia(true)
			  setModalFalta(false)
			}}
			className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-700 bg-white transition font-medium hover:bg-blue-50 hover:border-blue-300"
		  >
			Falta do Paciente
		  </button>

		  {/* TERAPEUTA */}
		  <button
			onClick={async () => {
			  if (!pacienteFalta) return
			  await handleFalta(pacienteFalta, 'terapeuta')
			  setModalFalta(false)
			}}
			className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-700 bg-white transition font-medium hover:bg-orange-50 hover:border-orange-300"
		  >
			Falta do Terapeuta
		  </button>

		</div>

    </div>
  </div>
)}


{/* MODAL FALTA CONFIRMACAO */}
{confirmarFaltaDia && (
  <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">

    <div className="relative bg-white rounded-2xl shadow-xl p-6 w-[360px] border border-slate-200">

      {/* BOTÃO FECHAR (X) */}
      <button
        onClick={() => { setConfirmarFaltaDia(false); setJustificativaFalta('') }}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-lg"
      >
        ✕
      </button>

      {/* TÍTULO */}
      <h2 className="text-lg font-semibold text-slate-800 text-center">
        Como deseja registrar a falta?
      </h2>

      {/* PACIENTE */}
      <p className="text-sm text-slate-600 text-center mt-2">
        {pacienteFaltaDia?.paciente_nome}
      </p>

      {/* JUSTIFICATIVA */}
      <textarea
        value={justificativaFalta}
        onChange={e => setJustificativaFalta(e.target.value)}
        placeholder="Justificativa obrigatória"
        rows={3}
        className="w-full mt-4 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 placeholder:text-slate-400"
      />

      {/* ESPAÇO */}
      <div className="mt-4 flex flex-col gap-3">

        {/* SÓ ESTE */}
        <button
          disabled={!justificativaFalta.trim()}
          onClick={async () => {
            if (!pacienteFaltaDia) return
            await handleFalta(pacienteFaltaDia, 'paciente', justificativaFalta)
            setJustificativaFalta('')
            setConfirmarFaltaDia(false)
          }}
          className="w-full py-2.5 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Só este atendimento
        </button>

        {/* DIA TODO */}
        <button
          disabled={!justificativaFalta.trim()}
          onClick={async () => {
            if (!pacienteFaltaDia) return
            const justificativa = justificativaFalta
			setConfirmarFaltaDia(false)
			setPacienteFaltaDia(null)
            setJustificativaFalta('')
			await handleFaltaDia(pacienteFaltaDia, justificativa)
          }}
          className="w-full py-2.5 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Todos os atendimentos do dia
        </button>

      </div>

      {/* AVISO */}
      <p className="text-xs text-slate-400 text-center mt-5 leading-relaxed">
        Essa ação não pode ser desfeita facilmente.
      </p>

    </div>
  </div>
)}

{/* ═══════════════════════════════════════════════════════════════════════
    MODAL FALTA EM LOTE

    Duas etapas: formulário e confirmação com os números. A confirmação não é
    cerimônia — a contagem de ignoradas só existe no banco (a tela recebe
    apenas cards com mostrar_na_tela = true), então esta é a única chance de a
    atendente ver a escala antes de commitar.
   ═══════════════════════════════════════════════════════════════════════ */}
{modalLote && (
  <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">

    {loteEtapa === 'form' ? (
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-[520px] max-h-[90vh] overflow-y-auto border border-slate-200">

        <button
          onClick={fecharModalLote}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-lg"
        >
          ✕
        </button>

        <h2 className="text-lg font-semibold text-slate-800">
          Registrar dia sem atendimento
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Registra que a clínica não abriu. As sessões já autorizadas ou
          concluídas ficam como estão.
        </p>

        {/* DATA — o campo que, errado, atinge o dia inteiro.
            Independente da data aberta na tela e sem valor inicial: escolher a
            data é o primeiro ato consciente de fechar um dia. */}
        <div className="mt-5">
          <label
            htmlFor="lote-data"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Qual dia a clínica não abriu?
          </label>
          <input
            id="lote-data"
            type="date"
            value={loteData}
            onChange={(e) => {
              // Trocar a data invalida o recorte: a unidade ou o horário
              // escolhidos podem nem existir no dia novo, e um filtro herdado
              // em silêncio faria o lote pegar menos sessões do que a atendente
              // espera — sem nada na tela explicando por quê.
              setLoteData(e.target.value)
              setLoteUnidade('')
              setLoteHorario('')
              setLoteConvenio('')
              setLoteContagem(null)
            }}
            className="w-full border-2 border-[#3A8FB7]/40 rounded-lg px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40"
          />
        </div>

        {/* MOTIVO */}
        <div className="mt-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Motivo
          </label>
          <select
            value={loteMotivo}
            onChange={(e) => {
              const novo = e.target.value as MotivoFalta
              // Só sobrescreve a justificativa se ela ainda for a sugestão
              // automática — texto que a atendente escreveu não se perde.
              if (loteJustificativa === justificativaPadrao(loteMotivo)) {
                setLoteJustificativa(justificativaPadrao(novo))
              }
              setLoteMotivo(novo)
            }}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40"
          >
            {MOTIVOS_FALTA.map((m) => (
              <option key={m.valor} value={m.valor}>{m.rotulo}</option>
            ))}
          </select>
        </div>

        {/* JUSTIFICATIVA */}
        <div className="mt-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Justificativa
          </label>
          <textarea
            value={loteJustificativa}
            onChange={(e) => setLoteJustificativa(e.target.value)}
            placeholder="Descreva a situação"
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 resize-none shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40"
          />
        </div>

        {/* Sem seletor de "tipo de falta" de propósito.
            Todo motivo desta lista é a clínica fechada, então o lançamento é
            sempre tipo_falta='unidade'. Oferecer "do paciente" aqui seria
            convidar a registrar ausência de quem não faltou — que é exatamente
            o que suja a assiduidade e a fila de reposição. */}
        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
          <p className="text-xs text-slate-600 leading-relaxed">
            Estas sessões serão registradas como{' '}
            <strong className="font-semibold text-slate-800">unidade fechada</strong>{' '}
            — não contam como falta do paciente nem entram na reposição.
          </p>
        </div>

        {/* RECORTE
            As opções vêm da data escolhida acima (ver o efeito que popula
            opcoesLote), então o que aparece aqui existe mesmo no dia que será
            fechado. Sem data, não há o que recortar: os três ficam inertes. */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-baseline justify-between mb-2.5">
            <p className="text-xs font-semibold text-slate-700">
              O dia todo, ou apenas parte dele
            </p>
            {carregandoOpcoesLote && (
              <span className="text-xs text-slate-400">carregando…</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select
              value={loteUnidade}
              onChange={(e) => setLoteUnidade(e.target.value)}
              disabled={!loteData}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Todas as unidades</option>
              {opcoesLote.unidades.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>

            <select
              value={loteHorario}
              onChange={(e) => setLoteHorario(e.target.value)}
              disabled={!loteData}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Todos os horários</option>
              {opcoesLote.horarios.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>

            <select
              value={loteConvenio}
              onChange={(e) => setLoteConvenio(e.target.value)}
              disabled={!loteData}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3A8FB7]/40 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Todos os convênios</option>
              {opcoesLote.convenios.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Um dia sem nenhuma sessão quase sempre significa data errada — é o
              momento de dizer isso, e não depois de clicar em Salvar. */}
          {loteData && !carregandoOpcoesLote && opcoesLote.horarios.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Nenhuma sessão agendada em {formatarDataBr(loteData)}. Confira a data.
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={fecharModalLote}
            className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 bg-white font-medium transition hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleLotePreview}
            disabled={loteCarregando || !loteJustificativa.trim() || !loteData}
            className="flex-1 py-2.5 rounded-lg bg-[#3A8FB7] text-white font-semibold transition hover:bg-[#32809f] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {loteCarregando && <Loader2 size={15} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </div>

    ) : (
      /* ── CONFIRMAÇÃO ── */
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-[420px] border border-slate-200">

        {/* O número é o conteúdo, não o texto ao redor dele: é a única coisa que
            a atendente precisa conferir antes de confirmar, e é o que denuncia
            a data errada (12 sessões num dia que deveria ter 300). */}
        <p className="text-center text-sm text-slate-500">
          Serão marcadas como unidade fechada
        </p>
        <p className="text-center text-4xl font-semibold text-slate-800 tabular-nums mt-1">
          {loteContagem?.aplicadas}
        </p>
        <p className="text-center text-sm text-slate-500">
          {loteContagem?.aplicadas === 1 ? 'sessão' : 'sessões'}
        </p>

        {!!loteContagem?.ignoradas && (
          <p className="text-sm text-slate-500 text-center mt-3">
            {loteContagem.ignoradas}{' '}
            {loteContagem.ignoradas === 1 ? 'sessão fica' : 'sessões ficam'} como
            {loteContagem.ignoradas === 1 ? ' está' : ' estão'} —{' '}
            {Object.keys(loteContagem.ignoradas_por_motivo || {})
              .map((k) => ROTULO_IGNORADA[k] || k)
              .join(', ')}
            .
          </p>
        )}

        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm text-slate-600 text-center">
          {MOTIVOS_FALTA.find((m) => m.valor === loteMotivo)?.rotulo}
          {' · '}
          {formatarDataBr(loteData)}
          {' · '}
          {loteUnidade || 'todas as unidades'}
          {loteHorario && ` · ${loteHorario}`}
          {loteConvenio && ` · ${loteConvenio}`}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => setLoteEtapa('form')}
            disabled={loteCarregando}
            className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 bg-white font-medium transition hover:bg-slate-50 disabled:opacity-40"
          >
            Voltar
          </button>
          {/* Escuro, não vermelho. Vermelho é a cor de erro e de perda, e
              registrar um dia sem atendimento não é nenhum dos dois — é o
              registro correto de um fato. O peso vem do contraste (é o único
              elemento sólido do modal), não do alarme. */}
          <button
            onClick={handleLoteAplicar}
            disabled={loteCarregando}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white font-semibold transition hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {loteCarregando && <Loader2 size={15} className="animate-spin" />}
            Confirmar
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center mt-4 leading-relaxed">
          Você poderá desfazer este lote logo depois.
        </p>
      </div>
    )}
  </div>
)}
	</div>
  )
}
function formatarCpf(
  cpf?: string | number | null
) {

  if (cpf == null) return ''

  return String(cpf)
    .replace(/\D/g, '')
}

// ISO (YYYY-MM-DD) para o formato brasileiro, sem passar por Date: construir um
// Date a partir de 'YYYY-MM-DD' o interpreta como UTC e, em fuso negativo, a
// data exibida volta um dia.
function formatarDataBr(
  data?: string | null
) {

  if (!data) return ''

  const texto = String(data).trim()

  const iso =
    texto.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`
  }

  return texto
}

function formatarDataNascimento(
  data?: string | null
) {
  return formatarDataBr(data)
}

function erroColunaPacienteComplementar(
  error: any
) {

  const mensagem = [
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    mensagem.includes('cpf') ||
    mensagem.includes('data_nascimento')
  )
}