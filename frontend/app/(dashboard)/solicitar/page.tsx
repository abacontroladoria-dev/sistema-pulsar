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
  CODIGOS_JUSTIFICATIVA_PACIENTE,
  ROTULO_IGNORADA,
  type MotivoFalta,
  type CodigoJustificativaFalta,
  type FaltaLoteResultado,
} from '@/services/autorizacoes.service'

import toast from 'react-hot-toast'

import { Lock, CheckCircle, Loader2, Megaphone, XCircle, CalendarX, Undo2, ChevronRight, AlertCircle, RotateCw, Ban, Clock, Check } from 'lucide-react'

import ModalAutorizacoesDoDia from '@/components/central/ModalAutorizacoesDoDia'

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
  minutosRestantes,
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
/**
 * Uma linha da lista do dia, como a RPC `listar_central_autorizacoes` devolve.
 *
 * A página inteira trata essas linhas como `any` e mudar isso não cabe aqui; o
 * alias existe para que o novo estado e o modal digam O QUE carregam, em vez de
 * espalhar mais um `any` anônimo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessaoDaLista = any

/**
 * A chave de uma sessão no índice `sessoesHoje` (o "N/Total" do card).
 *
 * Existe para que a montagem do índice e as duas leituras (card e modal) não
 * sejam três cópias da mesma expressão: divergindo, a busca devolve `undefined`
 * em silêncio e o contador some sem erro nenhum — a falha mais difícil de achar.
 */
function chaveSessaoDoDia(
  pacienteId: unknown,
  horario: unknown,
  terapia: unknown
) {
  return `${pacienteId}_${horario ?? ''}_${terapia ?? ''}`
}

/**
 * A forma dos botões de ação do card.
 *
 * Existe porque as cinco ações (Autorizar, Presença, Cancelar, Chamar, Falta)
 * repetiam a mesma cadeia de classes com pequenas divergências — uma delas
 * `items-start`, que desalinhava o ícone e era a origem do `-top-[1px]` colado em
 * cada `<svg>`. Uma forma só, e a cor fica sendo a única coisa que cada ação
 * escolhe.
 */
const ACAO_BASE =
  'w-full flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg font-semibold leading-none tracking-tight transition-all duration-150 disabled:cursor-not-allowed'

/** O disco atrás do ícone — dá presença ao botão sem custar altura de linha. */
const ACAO_ICONE = 'shrink-0 flex items-center justify-center w-5 h-5 rounded-md'

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
        lookup[chaveSessaoDoDia(id, s.horario, s.terapia)] = {
          index: i + 1,
          total: sessoes.length,
        }
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

  // Código da lista 101-113 escolhido no modal de falta do paciente. Começa em
  // 102 ("Ausência de justificativa") porque é o caso real dominante — de 6.189
  // justificativas históricas, ~4.200 eram "n vem"/"faltou", que é exatamente
  // isso. Quem tiver um motivo melhor troca no seletor.
  const [codigoFalta, setCodigoFalta] = useState<CodigoJustificativaFalta>(102)

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
  const loteTipo = 'unidade_fechada' as const
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

  // Sessão cujo modal "Autorizações de hoje" está aberto. Guarda o objeto inteiro
  // (e não a chave) porque o modal precisa de sala/terapeuta/convênio, e re-achar
  // o item em listaDia depois de um realtime daria uma linha diferente.
  // `SessaoDaLista` porque as linhas da RPC chegam sem tipo em toda esta página;
  // o alias ao menos nomeia o que é, sem fingir um contrato que não existe.
  const [modalAutorizacoes, setModalAutorizacoes] = useState<SessaoDaLista | null>(null)

  // Cards cujo INSERT da solicitação está em voo — a janela curta entre o clique
  // e a linha existir no banco. Depois disso quem manda no rótulo é o
  // `status_final` ('pendente'/'processando'), que o realtime mantém em dia.
  const [enviando, setEnviando] = useState<Set<string>>(new Set())

  // Cards cuja última tentativa falhou NO NAVEGADOR (insert recusado, rede caída).
  // É estado de tela, não do banco: o erro do robô já chega como status_final
  // 'erro' e tem o seu próprio caminho. Some no clique de "Tentar novamente".
  const [erroAutorizar, setErroAutorizar] = useState<Set<string>>(new Set())

  // Faltas já registradas no dia, por sessão (ver carregarFaltasDoDia).
  const [faltasDoDia, setFaltasDoDia] = useState<
    Record<string, { tipo: string | null; justificativa: string | null }>
  >({})

  // As mesmas faltas indexadas só por paciente+horário, para o aviso da sessão
  // anterior — que cruza terapias diferentes e por isso não pode casar por tuss.
  const [faltasPorHorario, setFaltasPorHorario] = useState<
    Record<string, { tipo: string | null; justificativa: string | null }>
  >({})

  function marcarNaChave(
    set: (f: (prev: Set<string>) => Set<string>) => void,
    chave: string,
    incluir: boolean
  ) {
    set(prev => {
      const proximo = new Set(prev)
      if (incluir) proximo.add(chave)
      else proximo.delete(chave)
      return proximo
    })
  }

  // Relógio de 30s do contador "faltam N min" da janela dos 31 minutos.
  //
  // Separado do `tique` de 1s abaixo de propósito: aquele só roda enquanto há
  // chamada recente (liga e desliga sozinho), e o contador dos 31 min precisa
  // andar o tempo todo — senão o card ficaria dizendo "faltam 12 min" durante
  // meia hora, até um re-render por outro motivo, e a atendente decidiria sobre
  // um número velho.
  //
  // 30s porque a unidade exibida é o MINUTO: ticar mais rápido não mudaria o
  // rótulo e custaria re-render numa página com dezenas de cards.
  const [minutoAtual, setMinutoAtual] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setMinutoAtual(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

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

  carregarFaltasDoDia(dataFiltro)

  setLoadingLista(false)
}

/**
 * As faltas já registradas no dia, por sessão.
 *
 * Vem direto de `fila_autorizacoes` porque a RPC não devolve nem `tipo_falta`
 * nem `justificativa_falta` — e, mais que isso, nem sempre devolve a falta: o
 * `status_final` tem precedência, e 'autorizado_externo' (guia encontrada na
 * ASSIM) ganha de 'falta'. Foi o caso do Benicio em 17/09: falta registrada às
 * 13:00 com "n chegou", e o card mostrando só a guia.
 *
 * Nenhuma migration para isso: a leitura é de tela, a precedência da RPC segue
 * como está (ela governa o que a sessão É; o selo abaixo conta o que ACONTECEU).
 */
async function carregarFaltasDoDia(dataFiltro: string) {
  const { data, error } = await supabase
    .from('fila_autorizacoes')
    .select('paciente_id, horario, tuss, tipo_falta, justificativa_falta')
    .eq('data_atendimento', dataFiltro)
    .eq('status', 'falta')

  if (error) {
    // Falha aqui não derruba a lista: o card perde o selo de falta e continua
    // inteiro no resto. Avisar com toast seria ruído sobre um detalhe.
    console.warn('[faltas] não foi possível carregar', error)
    return
  }

  const mapa: Record<string, { tipo: string | null; justificativa: string | null }> = {}

  // Segundo índice, só por paciente+horário: serve ao aviso da sessão ANTERIOR,
  // que não pode casar por tuss — a sessão de antes costuma ser de outra terapia
  // (o Benicio faltou na Fonoaudiologia e a seguinte é Terapia Ocupacional).
  const porHorario: Record<string, { tipo: string | null; justificativa: string | null }> = {}

  for (const f of data || []) {
    const hhmmFalta = String(f.horario).slice(0, 5)

    // Mesma identidade de sessão que o realtime usa (paciente + horário + tuss),
    // com o horário fatiado em HH:MM porque o banco devolve HH:MM:SS.
    const chave = [
      String(f.paciente_id),
      hhmmFalta,
      String(f.tuss ?? ''),
    ].join('_')

    const valor = {
      tipo: f.tipo_falta ?? null,
      justificativa: f.justificativa_falta ?? null,
    }

    mapa[chave] = valor
    porHorario[`${f.paciente_id}_${hhmmFalta}`] = valor
  }

  setFaltasDoDia(mapa)
  setFaltasPorHorario(porHorario)
}

/** A chave de `faltasDoDia` para uma linha da lista. */
function chaveFalta(p: SessaoDaLista) {
  return [
    String(p.paciente_id),
    String(p.horario).slice(0, 5),
    String(p.codigos_tuss?.[0] ?? ''),
  ].join('_')
}
// =========================
// SOLICITAR LISTA
// =========================

/**
 * "Tentar novamente" e "Autorizar" são o MESMO caminho.
 *
 * O retry não é um fluxo próprio: limpa a marca de erro e repete a solicitação,
 * inclusive os guardas (os 30 min da ASSIM continuam valendo numa segunda
 * tentativa — foi o incidente de 21/08/2026). Sem F5, como pede o requisito.
 */
async function handleSolicitarLista(
  p: any
) {

  const chaveEnvio = buildCardKey(p)

  // O erro anterior morre no clique, não na resposta: se a nova tentativa falhar,
  // o catch o remarca. Manter o rótulo vermelho durante o "Autorizando…" faria o
  // card dizer duas coisas contraditórias ao mesmo tempo.
  marcarNaChave(setErroAutorizar, chaveEnvio, false)
  marcarNaChave(setEnviando, chaveEnvio, true)

  try {
    await solicitarLista(p, chaveEnvio)
  } finally {
    marcarNaChave(setEnviando, chaveEnvio, false)
  }
}

async function solicitarLista(
  p: SessaoDaLista,
  chaveEnvio: string
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

      // O card FICA na lista e passa a oferecer "Tentar novamente": a sessão
      // continua pendente de ação, e exigir F5 para repetir era o que fazia a
      // recepção recarregar a tela no meio do movimento.
      marcarNaChave(setErroAutorizar, chaveEnvio, true)

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

    marcarNaChave(setErroAutorizar, chaveEnvio, true)
  }
}

  // =========================
  // ❌ FALTA
  // =========================

// `codigo` é o motivo na lista 101-113 que vai para o sistema parceiro. Opcional
// porque a falta do terapeuta não pergunta nada: o banco deriva 106 pelo tipo
// (ver o trigger em 20260914160000_codigo_justificativa_falta.sql).
async function handleFalta(
  p: any,
  tipo: 'paciente' | 'terapeuta',
  justificativa?: string,
  codigo?: CodigoJustificativaFalta,
) {

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
          codigo_justificativa: codigo ?? null,
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
        justificativa_falta: justificativa || null,
        codigo_justificativa: codigo ?? null
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
  
async function handleFaltaDia(
  paciente: any,
  justificativa?: string,
  codigo?: CodigoJustificativaFalta,
) {

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
          codigo_justificativa: codigo ?? null,
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
          justificativa_falta: justificativa || null,
          codigo_justificativa: codigo ?? null
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

// Cancela a TENTATIVA de autorização em curso — não o agendamento. A sessão
// continua na lista, volta ao estado normal e pode ser solicitada de novo.
//
// Alcança 'pendente' além de 'processando': entre o clique e o robô assumir a
// tarefa a linha fica em 'pendente', e é justamente aí que a recepção percebe
// que errou de paciente. Cancelar só 'processando' deixava essa janela — a mais
// provável de todas — sem saída, e a linha seguia para o portal.
//
// Um AbortController não serviria aqui: abortar o HTTP do insert não desfaz a
// linha que já chegou ao banco, e é a linha que o robô lê.
async function handleCancelarProcessamento(p: any) {
  try {
    const { data: existente } = await supabase
      .from('fila_autorizacoes')
      .select('id, status')
      .eq('paciente_id', p.paciente_id)
      .eq('data_atendimento', p.data_atendimento)
      .eq('horario', p.horario)
      .eq('tuss', p.codigos_tuss?.[0])
      .in('status', ['pendente', 'processando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!existente) {
      toast.error('Nenhuma solicitação em andamento encontrada')
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
      // A trava de corrida continua aqui, só que sobre os dois estados vivos: se
      // o robô concluiu entre a leitura acima e este update, o filtro não casa e
      // o cancelamento não sobrescreve um desfecho real.
      .in('status', ['pendente', 'processando'])

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

          const sessaoInfo = sessoesHoje[
            chaveSessaoDoDia(p.paciente_id, p.horario, p.terapias?.[0])
          ]

			  const ativo =
				![
				  'processando',
				  'pendente'
				].includes(p.status_final)

			  // Há uma solicitação viva para esta sessão: entre o clique e o
			  // desfecho do robô. Durante ela o Falta sai do ar — marcar falta
			  // por cima de uma guia a caminho é escrita concorrente sobre a
			  // mesma sessão que o robô está autorizando.
			  //
			  // Chamar NÃO entra aqui: é ação independente, sobre outra pessoa
			  // (o responsável na sala de espera), e as duas correm em paralelo
			  // no balcão. Ver o comentário no próprio botão.
			  const autorizandoAgora =
				enviando.has(buildCardKey(p)) ||
				p.status_final === 'pendente' ||
				p.status_final === 'processando'

			  // O horário que o RÓTULO mostra é a autorização mais recente do
			  // paciente no dia — inclusive a da PRÓPRIA sessão deste card.
			  //
			  // `ultima_autorizacao_anterior` não serve aqui: a subquery da RPC
			  // tem `fa2.horario <> b.horario`, ou seja, exclui de propósito o
			  // próprio horário. Isso é certo para o CÁLCULO (uma sessão não pode
			  // bloquear a si mesma no reprocesso) e errado para a EXIBIÇÃO — em
			  // 17/09 eram 62 de 154 sessões autorizadas mostrando um horário mais
			  // antigo que o real, o Theo entre elas: autorizado às 08:48, card
			  // dizendo 08:03. Ler 45 min a mais de folga do que existe é o
			  // caminho para a guia duplicada de 21/08.
			  //
			  // `horario_autorizacao` é a da própria sessão; o max() das duas
			  // devolve a mais recente de fato.

			  // A falta registrada para ESTA sessão, quando houver.
			  const faltaDaSessao = faltasDoDia[chaveFalta(p)] ?? null

			  // A falta da sessão IMEDIATAMENTE anterior do mesmo paciente hoje.
			  //
			  // "Imediatamente", e não "qualquer anterior", é a diferença entre
			  // avisar e alarmar: no Benicio de 17/09 a de 13:00 faltou e a de
			  // 13:40 compareceu, então o card das 14:20 não tem o que avisar —
			  // sinalizar ali seria dizer que o paciente não veio quando ele está
			  // na clínica há 40 minutos.
			  //
			  // A busca é por HORÁRIO e ignora terapia/tuss: a sessão anterior
			  // costuma ser de outra terapia (Fonoaudiologia → Terapia Ocupacional
			  // no caso dele), e casar por tuss não acharia nada.
			  const faltaDaAnterior = (() => {
				if (faltaDaSessao) return null // esta sessão já diz o seu próprio

				const meu = String(p.horario).slice(0, 5)

				const anterior = listaDiaCompleta
				  .filter(
				    (s: SessaoDaLista) =>
				      String(s.paciente_id) === String(p.paciente_id) &&
				      String(s.horario).slice(0, 5) < meu
				  )
				  .map((s: SessaoDaLista) => String(s.horario).slice(0, 5))
				  .sort()
				  .pop()

				if (!anterior) return null

				const falta = faltasPorHorario[`${p.paciente_id}_${anterior}`]
				return falta ? { ...falta, horario: anterior } : null
			  })()

			  const ultimaAutorizacaoExibida =
				[p.horario_autorizacao, p.ultima_autorizacao_anterior]
				  .filter(Boolean)
				  .sort()
				  .pop() ?? null

			  // Quanto falta para a ASSIM liberar outra identificação deste
			  // beneficiário.
			  //
			  // O selo conta sobre `ultima_autorizacao_anterior` — o MESMO valor
			  // que o clique usa em `podeSolicitar` —, e NÃO sobre o que o rótulo
			  // exibe. Os dois divergem de propósito: o rótulo mostra a mais
			  // recente de todas (é o que se quer LER), enquanto o bloqueio ignora
			  // a própria sessão, senão uma tentativa interrompida bloquearia a si
			  // mesma no reprocesso.
			  //
			  // Contar sobre o valor exibido faria a tela prometer o que o botão
			  // nega: no Arthur de 17/09, a sessão das 13:40 (autorizada 13:39)
			  // ficaria "faltam 25 min" enquanto o clique a deixaria passar,
			  // porque para ELA a anterior é 12:57.
			  //
			  // Ler `minutoAtual` aqui é o que faz o contador andar: sem tocar no
			  // state na render, o React não teria por que recalcular e o número
			  // ficaria parado. (`void` porque o valor em si não é usado — quem
			  // conta é o `Date.now()` dentro de `minutosRestantes`.)
			  void minutoAtual
			  const faltamMin = minutosRestantes(
				p.ultima_autorizacao_anterior,
				LIBERACAO_SOLICITAR_MIN
			  )
			  const janelaAberta = faltamMin === 0
			  const temUltima = !!p.ultima_autorizacao_anterior

			  // Montado uma vez e usado em dois lugares: na coluna de apoio (a
			  // partir de `lg`) e no fluxo do miolo abaixo disso, quando a coluna
			  // é escondida. Duplicar o JSX faria as duas cópias divergirem.
			  // O bloco existe se houver QUALQUER coisa a dizer: a última
			  // autorização (só em cards de autorização) ou o aviso da sessão
			  // anterior, que vale também para os de Presença — o Caio de 17/09
			  // faltou às 08:40 e tem quatro sessões de presença depois, todas
			  // precisando do aviso.
			  const botaoUltimaAutorizacao =
				p.tipo_fluxo === 'autorizacao' || faltaDaAnterior ? (
				  <div className="flex flex-col items-start gap-1">
				    {p.tipo_fluxo === 'autorizacao' && (
				    <button
				      type="button"
				      onClick={() => setModalAutorizacoes(p)}
				      aria-label="Ver autorizações de hoje"
				      className="group -ml-1.5 flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-[11px] text-slate-500 hover:bg-[#3A8FB7]/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3A8FB7]/40 transition-colors"
				    >
				      <Clock size={12} className="shrink-0 text-slate-400 group-hover:text-[#3A8FB7] transition-colors" />
				      <span className="group-hover:text-slate-600 transition-colors">Últ. autorização</span>
				      <span className="text-[12.5px] font-semibold tabular-nums text-slate-700 group-hover:text-[#3A8FB7] transition-colors">
				        {horaDoTimestamp(ultimaAutorizacaoExibida) || '—'}
				      </span>
				      <ChevronRight
				        size={12}
				        className="shrink-0 text-slate-300 group-hover:text-[#3A8FB7] group-hover:translate-x-0.5 transition-all"
				      />
				    </button>
				    )}

				    {/* O SEMÁFORO DA JANELA DOS 31 MIN — linha própria, sob o
				        horário. Até aqui a regra só aparecia DEPOIS do clique, como
				        um toast de recusa: a atendente descobria que faltavam 12
				        minutos tentando e falhando. O estado passa a ser legível
				        antes, onde a decisão é tomada.

				        Fica FORA do botão de propósito: é informação de leitura, não
				        parte do alvo de clique — dentro dele, o alvo crescia e o
				        selo virava algo que parece clicável e não é.

				        Só duas cores, e a neutra é o repouso: âmbar enquanto falta
				        (com o número, que é o que se quer saber) e um "Liberado"
				        discreto em verde quando abre. Sem última autorização não há
				        espera, e nada é desenhado — card sem selo já diz "pode
				        solicitar". */}
				    {p.tipo_fluxo === 'autorizacao' && temUltima && (
				      janelaAberta ? (
				        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-[2px] rounded">
				          <Check size={10} className="shrink-0" />
				          Liberado
				        </span>
				      ) : (
				        <span
				          title={`A ASSIM exige ${INTERVALO_ASSIM_MIN} min entre autorizações do mesmo beneficiário`}
				          className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-[2px] rounded"
				        >
				          <Clock size={10} className="shrink-0" />
				          {/* "Liberação em", e não "Faltam": o rótulo nomeia o que
				              vai acontecer, em vez de deixar a atendente deduzir o
				              que está faltando. E é a MESMA palavra do estado
				              seguinte ("Liberado"), então o selo conta uma história
				              só ao virar — o contador some e a palavra fica. */}
				          <span className="tabular-nums">Liberação em {faltamMin} min</span>
				        </span>
				      )
				    )}

				    {/* FALTOU NA SESSÃO ANTERIOR — sob o semáforo, fechando a
				        coluna de apoio.
				        Fica aqui, e não junto dos chips do miolo, porque esta coluna
				        é o histórico do paciente: CPF e nascimento dizem quem ele é,
				        a última autorização e este aviso dizem o que já aconteceu
				        com ele hoje. O miolo descreve a SESSÃO; aqui se lê a PESSOA.

				        A FORMA é o que o separa do semáforo logo acima, não a cor:
				        empilhados, duas pílulas âmbar viravam a mesma coisa lida
				        duas vezes. O semáforo é pílula preenchida porque é estado
				        TRANSITÓRIO — muda sozinho e some quando a janela abre; este
				        é fato REGISTRADO sobre o paciente, então vira texto com uma
				        barra à esquerda, que é como se marca uma anotação e não um
				        status. O rosa separa das duas cores do semáforo (âmbar
				        esperando, verde liberado) sem gritar como o vermelho da
				        falta desta sessão. */}
				    {faltaDaAnterior && (
				      <span
				        title={
				          faltaDaAnterior.justificativa
				            ? `Sessão das ${faltaDaAnterior.horario}: ${faltaDaAnterior.justificativa}`
				            : `O paciente não compareceu à sessão das ${faltaDaAnterior.horario}`
				        }
				        className="flex items-center gap-1.5 border-l-2 border-rose-300 pl-1.5 text-[10px] font-medium text-rose-700"
				      >
				        <AlertCircle size={10} className="shrink-0 text-rose-400" />
				        <span className="tabular-nums">
				          Faltou às {faltaDaAnterior.horario}
				        </span>
				      </span>
				    )}
				  </div>
				) : null

			  const cpfFormatado =
				formatarCpf(p.cpf)

			  const dataNascimentoFormatada =
				formatarDataNascimento(
				  p.data_nascimento
				)

				  return (
			<div
			  key={buildCardKey(p)}
			  /* `min-h`, e NUNCA `h` fixa.
			     O piso é o que dá o alinhamento: a faixa do horário é coluna irmã
			     do miolo, e com altura livre ela se reconciliava com um centro que
			     mudava de tamanho conforme o CPF e a "Última autorização"
			     existissem — daí o nome pousar em alturas diferentes. Um piso
			     comum resolve isso e dá ritmo regular à lista.

			     Mas altura FIXA aqui corta: a coluna de ações tem 4 botões no
			     estado "Autorizando…" (Autorizando + Cancelar + Chamar + Falta) e
			     no de erro (Erro + Tentar novamente + Chamar + Falta), contra 3 no
			     estado normal — 136px contra 108. Com `h-[124px]` o Falta sumia
			     atrás do `overflow-hidden`, sem aviso. Com `min-h` o card cresce
			     nesses dois estados e nada é escondido. */
			  className="relative flex min-h-[124px] rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_12px_32px_rgba(15,23,42,0.08)] hover:border-slate-300/70 transition-all duration-200 overflow-hidden"
			>
			  {/* ⏰ HORÁRIO
			      A faixa voltou ao lugar, e com ela a separação entre três coisas
			      de natureza diferente: QUANDO (a hora), QUAL sessão (4/6) e QUEM
			      (o nome). Inline, numa linha só, elas viravam uma sequência que
			      ninguém lê — "10:00 4/6 Benicio" não tem onde começar.

			      O desalinhamento que motivou a saída não vinha da faixa existir:
			      vinha de ela ser irmã de uma coluna de altura VARIÁVEL. Com a
			      altura do card fixa (h-[104px] abaixo, e a linha da "Última
			      autorização" reservada), a faixa se centra contra uma altura que
			      é sempre a mesma — e o problema não tem como voltar.

			      A profundidade vem de camadas de gradiente, não de formas: duas
			      radiais (brilho no alto à esquerda, sombra no pé à direita) sobre
			      uma linear de base. As radiais vêm ANTES da linear porque em CSS
			      a primeira camada é a de cima. */}
			<div className="relative isolate overflow-hidden shrink-0 w-[124px] flex flex-col items-center justify-center gap-1 border-r border-slate-200/60 bg-[radial-gradient(120%_80%_at_20%_0%,rgba(255,255,255,0.85)_0%,rgba(255,255,255,0)_55%),radial-gradient(100%_70%_at_100%_100%,rgba(47,118,149,0.16)_0%,rgba(47,118,149,0)_60%),linear-gradient(to_bottom,rgba(58,143,183,0.14)_0%,rgba(58,143,183,0.05)_100%)]">
			  {/* Fio de luz na aresta superior — a borda que o vidro fosco tem
			      contra a luz. Um pixel, e é ele que separa o bloco do card. */}
			  <span
			    aria-hidden="true"
			    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent"
			  />

			  <span className="text-[26px] leading-none font-bold text-[#2F7695] tracking-tight tabular-nums">
				{p.horario?.slice(0, 5)}
			  </span>

			  {sessaoInfo && (
			    <span className="text-[10px] font-semibold text-white bg-[#3A8FB7] px-2 py-[2px] rounded-full shadow-sm tabular-nums">
			      {sessaoInfo.index}/{sessaoInfo.total}
			    </span>
			  )}
			</div>

{/* CONTEÚDO */}
<div className="flex flex-1 min-w-0 px-5 py-3.5 items-center gap-5">

  {/* `flex-1` aqui (e não largura natural) é o que ancora a coluna de apoio: o
      miolo absorve toda a sobra de largura, então o filete e o CPF caem sempre
      na mesma posição, card após card. Sem isso a coluna flutuava conforme o
      comprimento do nome e dos chips. */}
  <div className="flex flex-1 flex-col gap-1.5 min-w-0">

    {/* NOME */}
    <span className="text-[15px] font-semibold text-slate-800 leading-tight truncate">
      {formatarNome(p.paciente_nome)}
    </span>

    {/* Abaixo de `lg` a coluna de apoio não cabe e é escondida; CPF e
        nascimento voltam para cá, senão sumiriam da tela junto com ela. */}
    {(cpfFormatado || dataNascimentoFormatada) && (
      <span className="lg:hidden text-[11px] text-slate-500 leading-tight">
        {[
          cpfFormatado ? `CPF: ${cpfFormatado}` : null,
          dataNascimentoFormatada ? `Nasc.: ${dataNascimentoFormatada}` : null,
        ]
          .filter(Boolean)
          .join('   |   ')}
      </span>
    )}

    {/* BADGES (INFORMAÇÃO)
        Sem teto de largura: o que empurrava a coluna de apoio era o selo de
        ESTADO ("Processando · Larissa") misturado aqui, e ele agora tem linha
        própria. Limitar a fileira em 420px, depois disso, só criaria um vão à
        direita dos chips — encolher o conteúdo enquanto sobra espaço.

        `flex-wrap` continua: nome de sala longo ("Unid. Realengo - Sala 18
        (Coordenação de caso)") desce para a segunda linha em vez de espremer os
        vizinhos.

        (a última autorização também volta para cá abaixo de `lg`, logo após) */}
    <div className="flex items-center gap-2 gap-y-1.5 flex-wrap min-w-0">

		  {/* TERAPIA — a única tag colorida da fileira: é o dado que muda o
		      trabalho da recepção. Convênio e sala ficam neutros ao lado. */}
		  <span className="shrink-0 text-[10.5px] font-medium px-2 py-[3px] rounded-md bg-blue-50 text-blue-700 border border-blue-100/80">
		  	{p.terapias?.join(' + ') || 'Sem terapia'}
		  </span>

		{/* CONVENIO */}
		<span className="shrink-0 text-[10.5px] font-medium px-2 py-[3px] rounded-md bg-slate-50 text-slate-600 border border-slate-200/80">
		  {p.convenio_nome || 'Sem convênio'}
		</span>

		{/* SALA — está no mockup e o dado já vinha na lista sem ser exibido.
		    Na recepção é o que se diz em voz alta ao encaminhar o paciente. */}
		{p.sala_nome && (
		  <span className="shrink-0 text-[10.5px] font-medium px-2 py-[3px] rounded-md bg-slate-50 text-slate-600 border border-slate-200/80">
		    {p.sala_nome}
		  </span>
		)}
		

    </div>

    {/* ESTADO DA AUTORIZAÇÃO — linha própria, abaixo dos chips.
        Misturado à fileira de cima, o selo alongava a linha e empurrava a coluna
        de apoio; mas o motivo de separar não é só largura. Terapia, convênio e
        sala descrevem a SESSÃO e são sempre os mesmos; "Processando · Larissa"
        é o ESTADO de agora, muda sozinho e pertence a outra ordem de leitura.

        O selo "Erro" saiu: o botão ao lado já diz "Erro ao autorizar", e dizer
        duas vezes a mesma coisa em vermelho, a um palmo de distância, só rouba
        atenção de quem precisa achar a saída. */}
    {(p.status_final === 'processando' ||
      p.status_final === 'pendente' ||
      p.status_final === 'cancelado' ||
      faltaDaSessao) && (
      <div className="flex items-center gap-2 flex-wrap min-w-0">


        {/* FALTA REGISTRADA.
            Não é redundante com o `status_final`: a RPC dá precedência a
            'autorizado_externo' sobre 'falta', então uma sessão com guia na ASSIM
            E falta registrada aparecia só como autorizada. Foi o Benicio em
            17/09 — falta às 13:00 com "n chegou", invisível no card.

            Quem lê aqui precisa saber DE QUEM foi a falta: paciente e terapeuta
            têm desfechos diferentes na cobrança. A justificativa vai no `title`,
            porque é texto livre digitado pela recepção ("n chegou") e não cabe
            num selo sem estourar a linha. */}
        {faltaDaSessao && (
          <span
            title={
              faltaDaSessao.justificativa
                ? `Falta: ${faltaDaSessao.justificativa}`
                : undefined
            }
            className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 px-2 py-[3px] rounded-md min-w-0"
          >
            <XCircle size={11} className="shrink-0" />
            <span className="shrink-0">
              {faltaDaSessao.tipo === 'terapeuta'
                ? 'Falta do terapeuta'
                : 'Falta do paciente'}
            </span>
            {faltaDaSessao.justificativa && (
              <span className="font-normal text-rose-600 truncate">
                · {faltaDaSessao.justificativa}
              </span>
            )}
          </span>
        )}

        {p.status_final === 'processando' && (
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-blue-800 bg-blue-100/80 px-2 py-[3px] rounded-md min-w-0">
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
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-amber-800 bg-amber-100/80 px-2 py-[3px] rounded-md min-w-0">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
            <span className="shrink-0">Na fila</span>
            {/* Mesmo motivo do selo acima: logo depois do clique o card fica aqui,
                e é justamente quando a recepção precisa saber de quem é. */}
            {p.criado_por && (
              <span className="font-normal text-amber-700 truncate">· {p.criado_por}</span>
            )}
          </span>
        )}

        {p.status_final === 'cancelado' && (
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-600 bg-slate-100 px-2 py-[3px] rounded-md min-w-0">
            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full shrink-0"></span>
            <span className="truncate">
              {p.cancelado_por_nome
                ? `Cancelada por: ${p.cancelado_por_nome}`
                : 'Cancelada'}
            </span>
          </span>
        )}
      </div>
    )}

    {/* Abaixo de `lg`, onde a coluna de apoio está escondida. */}
    {botaoUltimaAutorizacao && (
      <div className="lg:hidden">{botaoUltimaAutorizacao}</div>
    )}

  </div>

{/* COLUNA DE APOIO
    CPF, nascimento e última autorização saem da pilha e formam uma coluna
    própria, separada por um filete. São dados de CONFERÊNCIA — olhados quando se
    precisa deles, não a cada varredura da lista —, e empilhados junto do nome
    pesavam o mesmo que ele. Lado a lado, a divisão fica explícita: à esquerda
    quem é o paciente, à direita o que se confere sobre ele.

    Some também a linha reservada: com as duas colunas independentes, o card não
    encolhe mais quando falta a última autorização. */}
  <div className="hidden lg:flex shrink-0 flex-col justify-center gap-1 self-stretch border-l border-slate-100 pl-6 w-[210px]">
    {/* Rótulo de largura fixa para os dois valores começarem na MESMA coluna:
        "CPF:" e "Nasc.:" têm larguras diferentes, e sem o trilho os números
        saíam escalonados — numa pilha de cards, é isso que faz a coluna parecer
        torta. O rótulo fica um tom mais claro que o valor: quem se lê é o
        número, o rótulo só diz qual é. */}
    {cpfFormatado && (
      <span className="flex items-baseline gap-1.5 text-[11px] leading-tight">
        <span className="shrink-0 w-[40px] text-slate-400">CPF:</span>
        <span className="text-slate-600 tabular-nums">{cpfFormatado}</span>
      </span>
    )}

    {dataNascimentoFormatada && (
      <span className="flex items-baseline gap-1.5 text-[11px] leading-tight">
        <span className="shrink-0 w-[40px] text-slate-400">Nasc.:</span>
        <span className="text-slate-600 tabular-nums">{dataNascimentoFormatada}</span>
      </span>
    )}

    {/* É a informação mais consultada do card: por ela a recepção decide se já
        passaram os 30 min que a ASSIM exige entre autorizações do mesmo
        beneficiário. Por isso é a única coisa clicável desta coluna. */}
    {botaoUltimaAutorizacao}

  </div>

<div className="flex flex-col gap-1 shrink-0 w-[158px]">

{p.tipo_fluxo === 'autorizacao' ? (() => {

  // Os três estados do botão, numa fonte de verdade só.
  //
  // "Autorizando…" atravessa o insert E a espera do robô ('pendente' →
  // 'processando'), porque é isso que a recepcionista chama de autorizar: o
  // trabalho só termina quando a ASSIM responde. O desfecho não é desenhado
  // aqui — o realtime tira o card da tela em 'concluido' —, e é por isso que
  // não existe estado "Autorizado" permanente: a lista é de pendências.
  const emVooLocal = enviando.has(buildCardKey(p))
  const noBanco = p.status_final === 'pendente' || p.status_final === 'processando'
  const autorizando = emVooLocal || noBanco

  const comErro = erroAutorizar.has(buildCardKey(p)) || p.status_final === 'erro'

  if (autorizando) {
    return (
      <button
        disabled
        aria-busy="true"
        className={`${ACAO_BASE} bg-[#3A8FB7]/10 text-[#2F7695] cursor-default`}
      >
        <span className={`${ACAO_ICONE} bg-[#3A8FB7]/15`}>
          <Loader2 size={13} className="animate-spin" />
        </span>
        Autorizando…
      </button>
    )
  }

  if (comErro) {
    return (
      <>
        <span className={`${ACAO_BASE} bg-red-50 text-red-600 border border-red-100`}>
          <span className={`${ACAO_ICONE} bg-red-100`}>
            <AlertCircle size={13} />
          </span>
          Erro ao autorizar
        </span>

        {/* "Tentar novamente" cinza sem explicação é um beco: a atendente vê o
            erro, vê a saída oferecida e ela não responde. O motivo é sempre o
            mesmo — o robô não está acessível —, então o botão diz isso no
            próprio rótulo, como o "Autorizar" já faz. Repetir "Tentar
            novamente" enquanto o robô está fora seria prometer o que não há. */}
        <button
          disabled={!workerOnline}
          onClick={() => handleSolicitarLista(p)}
          title={workerOnline ? undefined : mensagemDoRobo(robo)}
          className={`${ACAO_BASE} ${
            workerOnline
              ? 'bg-blue-50 text-[#2F7695] hover:bg-blue-100'
              : 'bg-slate-100 text-slate-400'
          }`}
        >
          <span className={`${ACAO_ICONE} ${workerOnline ? 'bg-blue-100' : 'bg-slate-200'}`}>
            <RotateCw size={13} />
          </span>
          {workerOnline
            ? 'Tentar novamente'
            : robo.estado === 'verificando'
              ? 'Verificando…'
              : robo.estado === 'bloqueado'
                ? 'Sem acesso local'
                : 'Robô Offline'}
        </button>
      </>
    )
  }

  return (
  <button
    disabled={
      !workerOnline ||
      !ativo
    }
    onClick={() => handleSolicitarLista(p)}
    title={workerOnline ? undefined : mensagemDoRobo(robo)}
    className={`${ACAO_BASE} ${
      !workerOnline
        ? 'bg-slate-200 text-slate-500'
        : ativo
          ? 'bg-[#3A8FB7] text-white shadow-[0_4px_12px_rgba(58,143,183,0.35)] hover:brightness-110 hover:shadow-[0_6px_16px_rgba(58,143,183,0.42)]'
          : 'bg-slate-100 text-slate-400'
    }`}
  >
    <span
      className={`${ACAO_ICONE} ${
        workerOnline && ativo ? 'bg-white/20' : 'bg-slate-200/70'
      }`}
    >
      <Lock size={13} />
    </span>

    {
      // "Sistema Offline" era mentira quando o robô estava vivo e o browser é
      // que bloqueava. O rótulo cabe na coluna, então diz o essencial; o detalhe
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
  )
})() : (

  <button
    disabled={!ativo}
    onClick={() => handleManualLista(p)}
    className={`${ACAO_BASE} ${
		  ativo
			? 'bg-emerald-600 text-white shadow-[0_4px_12px_rgba(5,150,105,0.32)] hover:bg-emerald-700'
			: 'bg-slate-100 text-slate-400'
	  }`}
  >
    <span className={`${ACAO_ICONE} ${ativo ? 'bg-white/20' : 'bg-slate-200/70'}`}>
      <CheckCircle size={13} />
    </span>
    Presença
  </button>

)}

{/* Cancelar acompanha o "Autorizando…": aparece assim que há solicitação viva
    ('pendente' ou 'processando'), e não só depois que o robô assume. Cancela a
    TENTATIVA, nunca o agendamento — a sessão volta à lista como estava. */}
{(p.status_final === 'pendente' || p.status_final === 'processando') && (
  <button
    onClick={() => handleCancelarProcessamento(p)}
    className={`${ACAO_BASE} bg-orange-50 text-orange-700 hover:bg-orange-100`}
  >
    <span className={`${ACAO_ICONE} bg-orange-100`}>
      <Ban size={13} />
    </span>
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

  // Chamar segue liberado DURANTE a autorização, de propósito.
  //
  // As duas ações correm em paralelo na vida real: o robô leva de segundos a
  // minutos no portal da ASSIM, e a recepção não espera esse tempo para chamar o
  // responsável — o paciente já está no balcão. Travar o botão aqui não evitava
  // engano nenhum, só obrigava a esperar. (Falta continua bloqueada: aquela sim
  // é escrita concorrente sobre a mesma sessão que o robô está autorizando.)
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
      className={`${ACAO_BASE} bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 disabled:hover:bg-emerald-50`}
    >
      <span className={`${ACAO_ICONE} bg-emerald-100`}>
        {emVoo ? (
          <Loader2 size={13} className="animate-spin" />
        ) : chamadoAgora ? (
          <CheckCircle size={13} />
        ) : (
          <Megaphone size={13} />
        )}
      </span>
      {emVoo ? 'Chamando…' : chamadoAgora ? 'Chamado' : 'Chamar'}
    </button>
  )
})()}

<button
  onClick={() => {
    setPacienteFalta(p)
    setModalFalta(true)
  }}
  disabled={autorizandoAgora}
  title={autorizandoAgora ? 'Aguarde a autorização terminar' : undefined}
  className={`${ACAO_BASE} bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60 disabled:hover:bg-red-50`}
>
  <span className={`${ACAO_ICONE} bg-red-100`}>
    <XCircle size={13} />
  </span>
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


{/* MODAL "AUTORIZAÇÕES DE HOJE" */}
{modalAutorizacoes && (
  <ModalAutorizacoesDoDia
    sessao={modalAutorizacoes}
    sessaoInfo={
      sessoesHoje[
        chaveSessaoDoDia(
          modalAutorizacoes.paciente_id,
          modalAutorizacoes.horario,
          modalAutorizacoes.terapias?.[0]
        )
      ]
    }
    cpfFormatado={formatarCpf(modalAutorizacoes.cpf)}
    dataNascimentoFormatada={formatarDataNascimento(modalAutorizacoes.data_nascimento)}
    onClose={() => setModalAutorizacoes(null)}
  />
)}

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
        onClick={() => { setConfirmarFaltaDia(false); setJustificativaFalta(''); setCodigoFalta(102) }}
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

      {/* MOTIVO — a lista 101-113, o mesmo vocabulário do sistema parceiro que
          recebe estas faltas. Antes só havia o texto livre abaixo, que na
          prática não dizia o motivo ("n vem", "faltou"). */}
      <select
        value={codigoFalta}
        onChange={e => setCodigoFalta(Number(e.target.value) as CodigoJustificativaFalta)}
        className="w-full mt-4 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700"
      >
        {CODIGOS_JUSTIFICATIVA_PACIENTE.map(c => (
          <option key={c.codigo} value={c.codigo}>{c.rotulo}</option>
        ))}
      </select>

      {/* JUSTIFICATIVA */}
      <textarea
        value={justificativaFalta}
        onChange={e => setJustificativaFalta(e.target.value)}
        placeholder="Justificativa obrigatória"
        rows={3}
        className="w-full mt-3 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 placeholder:text-slate-400"
      />

      {/* ESPAÇO */}
      <div className="mt-4 flex flex-col gap-3">

        {/* SÓ ESTE */}
        <button
          disabled={!justificativaFalta.trim()}
          onClick={async () => {
            if (!pacienteFaltaDia) return
            await handleFalta(pacienteFaltaDia, 'paciente', justificativaFalta, codigoFalta)
            setJustificativaFalta('')
            setCodigoFalta(102)
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
            const codigo = codigoFalta
			setConfirmarFaltaDia(false)
			setPacienteFaltaDia(null)
            setJustificativaFalta('')
            setCodigoFalta(102)
			await handleFaltaDia(pacienteFaltaDia, justificativa, codigo)
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
            sempre tipo_falta='unidade_fechada'. Oferecer "do paciente" aqui seria
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
/**
 * O CPF para LEITURA na tela, em dígitos corridos: 21618102788.
 *
 * SEM máscara, por decisão de quem usa a tela. A pontuação já esteve aqui
 * (216.181.027-88) e foi retirada: o CPF é conferido contra o documento no
 * balcão e contra outros sistemas, onde ele aparece cru, e os separadores
 * obrigavam a ignorar pontuação que o outro lado não tem.
 *
 * Continua sendo função, e não o valor direto, por dois motivos que não são
 * cosméticos: `null` vira string vazia (senão a tela escreveria "null"), e um
 * valor que chegue pontuado da origem é limpo aqui.
 *
 * Nada disto toca o que se GRAVA: o que vai para o banco e para o robô é
 * `p.cpf` cru, direto de `criarAutorizacao`, e sempre foi sem pontuação.
 */
function formatarCpf(
  cpf?: string | number | null
) {

  if (cpf == null) return ''

  return String(cpf).replace(/\D/g, '')
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