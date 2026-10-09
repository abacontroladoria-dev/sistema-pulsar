'use client'

// Autorizações avulsas — a solicitação que não nasce de uma sessão da agenda.
//
// O /solicitar é inteiramente dirigido pela agenda: sem sessão, não existe card
// para clicar. Estas autorizações eram tiradas à mão no site da ASSIM, fora do
// Pulsar inteiro — sem registro de quem pediu e sem motivo. Aqui a recepção
// escolhe o paciente no cadastro, escolhe a terapia, e o MESMO robô do /solicitar
// executa: `robo_buscar_tarefa` não pergunta de onde a linha veio.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, ClipboardPlus, Send, WifiOff } from 'lucide-react'

import PageHeader from '@/components/PageHeader'
import { CampoDetalhe, DetalheGrid, EmptyState, ListCard } from '@/components/cronograma/ui/DataTable'
import { SearchCombobox } from '@/components/cronograma/ui/SearchCombobox'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { usePacientesAssim, type PacienteAssim } from '@/hooks/usePacientesAssim'
import { useTerapiasTuss } from '@/hooks/useTerapiasTuss'
import { getMachineId } from '@/lib/machine'
import { getSupabaseClient } from '@/lib/supabase/client'
import { fatiarCarteirinha, formatarCarteirinha } from '@/lib/central/carteirinha'
import {
  INTERVALO_ASSIM_MIN,
  horaDoTimestamp,
  minutosRestantes,
  podeSolicitar,
} from '@/lib/central/intervaloAssim'
import {
  criarAutorizacaoAvulsa,
  hojeLocal,
  listarAutorizacoesAvulsas,
  ultimaAutorizacaoDoPaciente,
  type AutorizacaoAvulsa,
} from '@/services/autorizacoes-avulsas.service'

/** De quanto em quanto tempo perguntamos ao worker local se ele está vivo. */
const POLL_WORKER_MS = 5000

/**
 * As UFs que aparecem na lista. São as duas que a operação usa.
 *
 * Se o histórico do paciente trouxer outra (o Órbita grava a UF embutida no CRM,
 * "52949442/RJ", e nada garante que seja uma destas duas), ela ENTRA na lista em
 * vez de ser descartada — um `<select>` com `value` fora das opções renderiza
 * vazio e perderia a UF correta sem avisar ninguém.
 */
const UFS_PADRAO = ['RJ', 'SP']

// ---------------------------------------------------------------------------
// Rótulos de status
// ---------------------------------------------------------------------------
// Vocabulário próprio, e não `getStatusConfig` de utils/statusAutorizacao.ts: aquele
// mapa fala de faltas, substituição e classificação de terapia — coisas que uma
// avulsa não tem, por definição. Aqui só existem os cinco desfechos que o robô
// produz (robo_concluir_tarefa aceita concluido, concluido_sem_guia, erro e glosa)
// mais os dois de fila.
const STATUS: Record<string, { texto: string; cor: string }> = {
  pendente: { texto: 'Na fila', cor: '#B45309' },
  processando: { texto: 'Na ASSIM agora', cor: '#1D4ED8' },
  executando: { texto: 'Na ASSIM agora', cor: '#1D4ED8' },
  concluido: { texto: 'Autorizada', cor: '#047857' },
  concluido_sem_guia: { texto: 'Autorizada, sem guia', cor: '#047857' },
  glosa: { texto: 'Glosada', cor: '#B91C1C' },
  erro: { texto: 'Erro', cor: '#B91C1C' },
  cancelado: { texto: 'Cancelada', cor: '#6B7280' },
}

function statusDe(linha: AutorizacaoAvulsa) {
  return STATUS[linha.status] ?? { texto: linha.status, cor: '#6B7280' }
}

export default function AutorizacoesAvulsasPage() {
  const { pacientes, loading: carregandoPacientes } = usePacientesAssim()
  const { terapias, loading: carregandoTerapias } = useTerapiasTuss()

  // ── Worker local ─────────────────────────────────────────────────────────
  // O `machine_id` vem do worker em 127.0.0.1:3010, e é ele que amarra a linha à
  // estação. Sem worker não há como pedir: `robo_buscar_tarefa` filtra por
  // machine_id, e o fallback 'WEB' do lib/machine.ts é INATINGÍVEL — nenhuma
  // máquina tem esse id, então a linha ficaria pendente para sempre, calada.
  const [machineId, setMachineId] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    const bater = async () => {
      const id = await getMachineId()
      if (!cancelado) setMachineId(id && id !== 'WEB' ? id : null)
    }

    bater()
    const intervalo = setInterval(bater, POLL_WORKER_MS)

    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
  }, [])

  // ── Formulário ───────────────────────────────────────────────────────────
  const [rotuloPaciente, setRotuloPaciente] = useState('')
  const [rotuloTerapia, setRotuloTerapia] = useState('')
  const [crm, setCrm] = useState('')
  // 'RJ' é o default do próprio robô quando a UF chega nula (rpa.js), então é o
  // valor que a tela já mostra — não um palpite novo introduzido aqui.
  const [crmUf, setCrmUf] = useState('RJ')
  const [nomeMedico, setNomeMedico] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  // A janela de 30 min da ASSIM AVISA, mas não impede — diferente da /solicitar,
  // que bloqueia. Decisão do usuário em 02/09/2026: a avulsa é o caso excepcional
  // por definição (não nasce de sessão nenhuma), e quem a pede costuma ter um
  // motivo que a regra geral não prevê. Guarda os minutos restantes enquanto a
  // confirmação está na tela; `null` = nada a confirmar.
  const [confirmarJanela, setConfirmarJanela] = useState<
    { restam: number; hora: string } | null
  >(null)

  // A confirmação fala de UM paciente e UMA terapia. Se qualquer um dos dois muda
  // enquanto ela está aberta, o "Enviar mesmo assim" passaria a valer para outra
  // coisa que não a checada — e o aviso na tela estaria mentindo sobre quem é.
  useEffect(() => {
    setConfirmarJanela(null)
  }, [rotuloPaciente, rotuloTerapia])

  /**
   * Rótulo -> paciente. O SearchCombobox trabalha com strings, e nome de paciente
   * REPETE: dois "Maria Silva" dariam duas opções idênticas e a escolha seria uma
   * moeda ao ar. Quando o nome é ambíguo, o rótulo ganha o id do TiTa — que é a
   * chave estável — em vez de deixar o operador adivinhar.
   *
   * A elegibilidade (ASSIM, não fictício, sessão na janela) já foi resolvida pela
   * RPC `listar_pacientes_assim()`. Filtrar de novo aqui seria adivinhar convênio
   * a partir de um cache, que é exatamente o que a RPC existe para evitar.
   */
  const porRotulo = useMemo(() => {
    const vezes = new Map<string, number>()
    pacientes.forEach((p) => vezes.set(p.paciente_nome, (vezes.get(p.paciente_nome) ?? 0) + 1))

    const mapa = new Map<string, PacienteAssim>()
    pacientes.forEach((p) => {
      const rotulo =
        (vezes.get(p.paciente_nome) ?? 0) > 1
          ? `${p.paciente_nome} (#${p.paciente_id})`
          : p.paciente_nome
      mapa.set(rotulo, p)
    })

    return mapa
  }, [pacientes])

  const opcoesPaciente = useMemo(
    () => Array.from(porRotulo.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [porRotulo]
  )

  const paciente = porRotulo.get(rotuloPaciente) ?? null

  const porTerapia = useMemo(() => {
    const mapa = new Map<string, string>()
    terapias.forEach((t) => mapa.set(t.terapia, t.codigo_tuss))
    return mapa
  }, [terapias])

  const opcoesTerapia = useMemo(
    () => Array.from(porTerapia.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [porTerapia]
  )

  const tuss = porTerapia.get(rotuloTerapia) ?? null

  const opcoesUf = useMemo(
    () => (UFS_PADRAO.includes(crmUf) ? UFS_PADRAO : [...UFS_PADRAO, crmUf]),
    [crmUf]
  )

  const carteirinhaBruta = paciente?.numero_carteirinha ?? null
  const carteirinha = fatiarCarteirinha(carteirinhaBruta)

  /**
   * Pré-preenchimento de CRM, UF e médico ao trocar de paciente.
   *
   * Sincronizado: os três vêm na própria linha da RPC, então não há busca nem
   * corrida a proteger — o `ref` continua aqui só para o efeito não reescrever o
   * que o operador acabou de digitar a cada render.
   */
  const pacienteIdRef = useRef<number | null>(null)

  useEffect(() => {
    const id = paciente?.paciente_id ?? null
    if (id === pacienteIdRef.current) return

    pacienteIdRef.current = id
    setCrm(paciente?.crm ?? '')
    setCrmUf(paciente?.crm_uf ?? 'RJ')
    setNomeMedico(paciente?.nome_medico ?? '')
  }, [paciente])

  // ── Listagem ─────────────────────────────────────────────────────────────
  const [de, setDe] = useState(hojeLocal)
  const [ate, setAte] = useState(hojeLocal)
  const [avulsas, setAvulsas] = useState<AutorizacaoAvulsa[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)

  const recarregar = useCallback(async () => {
    setCarregandoLista(true)
    const { data, error } = await listarAutorizacoesAvulsas(de, ate)
    if (error) toast.error('Não foi possível carregar as avulsas do período.')
    setAvulsas(data)
    setCarregandoLista(false)
  }, [de, ate])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  /**
   * Realtime: o robô conclui pelo `robo_concluir_tarefa` e a linha muda de status
   * sem nada acontecer nesta aba.
   *
   * As dependências são REAIS (`de`, `ate`, `recarregar`), e isso é deliberado: o
   * efeito equivalente do /solicitar usa a data no nome do canal e no filtro mas
   * declara `[]`, e por isso não se recria ao trocar de data — a subscription fica
   * apontada para o dia em que a página montou. Repetir o atalho aqui seria repetir
   * o bug.
   */
  useEffect(() => {
    const supabase = getSupabaseClient()
    const canal = supabase
      .channel(`avulsas-${de}-${ate}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fila_autorizacoes' },
        (payload: { new: Partial<AutorizacaoAvulsa> & { id?: string; avulsa?: boolean } }) => {
          const novo = payload.new
          if (!novo?.id || novo.avulsa !== true) return

          // Só mexe no que já está em tela. Uma avulsa criada em OUTRA estação
          // dentro do período não chega por aqui (o evento é UPDATE), e isso é
          // aceitável: o operador vê as dele, e o botão de recarregar traz o resto.
          setAvulsas((atual) =>
            atual.some((l) => l.id === novo.id)
              ? atual.map((l) => (l.id === novo.id ? { ...l, ...novo } as AutorizacaoAvulsa : l))
              : atual
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [de, ate])

  // ── Envio ────────────────────────────────────────────────────────────────
  const impedimento = (() => {
    if (!machineId) return 'O robô desta estação não está respondendo.'
    if (!paciente) return 'Escolha o paciente.'
    if (!carteirinha) return 'Este paciente não tem carteirinha ASSIM completa na agenda.'
    if (!tuss) return 'Escolha a terapia.'
    if (!crm.trim()) return 'O CRM do solicitante é obrigatório na ASSIM.'
    if (!nomeMedico.trim()) return 'O nome do médico solicitante é obrigatório na ASSIM.'
    if (!motivo.trim()) return 'Escreva o motivo da avulsa.'
    return null
  })()

  async function enviar() {
    if (impedimento || !paciente || !carteirinha || !tuss || !machineId) return

    // A ASSIM cronometra 30 min por BENEFICIÁRIO, no relógio, sobre a
    // identificação — não sobre o horário da sessão. A avulsa concorre pela mesma
    // janela que as solicitações normais do dia.
    //
    // Aqui isso AVISA em vez de bloquear (a /solicitar bloqueia). O limite é da
    // ASSIM, não nosso: removê-lo do código não o remove do portal, então o que a
    // confirmação faz é mostrar o custo — o robô pode gastar a viagem à toa, ou a
    // guia pode sair duplicada, como no incidente de 21/08/2026 — e deixar a
    // decisão com quem está pedindo.
    setEnviando(true)
    try {
      const ultima = await ultimaAutorizacaoDoPaciente(paciente.paciente_id)
      if (!podeSolicitar(ultima)) {
        setConfirmarJanela({
          restam: minutosRestantes(ultima),
          hora: horaDoTimestamp(ultima),
        })
        return
      }
    } finally {
      setEnviando(false)
    }

    await enviarDeFato()
  }

  /** O envio em si, já decidida a questão da janela de 30 min. */
  async function enviarDeFato() {
    if (impedimento || !paciente || !carteirinha || !tuss || !machineId) return

    setConfirmarJanela(null)
    setEnviando(true)
    try {
      const r = await criarAutorizacaoAvulsa({
        paciente_id: paciente.paciente_id,
        paciente_nome: paciente.paciente_nome,
        empresa: carteirinha.empresa,
        matricula: carteirinha.matricula,
        dep: carteirinha.dep,
        terapia_nome: rotuloTerapia,
        tuss,
        crm: crm.trim(),
        crm_uf: crmUf,
        nome_medico: nomeMedico.trim(),
        motivo_avulsa: motivo.trim(),
        machine_id: machineId,
      })

      if (!r.ok) {
        toast.error(r.erro)
        return
      }

      toast.success(`Avulsa enviada. O robô vai abrir a ASSIM para ${paciente.paciente_nome}.`)
      setRotuloTerapia('')
      setMotivo('')
      await recarregar()
    } finally {
      setEnviando(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const rotulo = { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)' as const, textTransform: 'uppercase' as const, letterSpacing: '.04em', color: 'var(--muted-foreground)', display: 'block', marginBottom: '4px' }
  const campo = { width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 'var(--text-sm)', fontFamily: 'inherit', background: 'var(--card)', color: 'var(--foreground)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title="Autorizações Avulsas"
        subtitle="Autorização que não corresponde a nenhuma sessão da agenda. O robô desta estação abre a ASSIM e preenche o formulário."
      />

      {!machineId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-lg)', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 'var(--text-sm)' }}>
          <WifiOff size={16} style={{ flexShrink: 0 }} />
          <span>
            O robô desta estação não está respondendo. Sem ele a solicitação ficaria
            na fila para sempre, então o envio está bloqueado.
          </span>
        </div>
      )}

      {/* ── Janela de 30 min: avisa, não impede ──
          Âmbar, e não vermelho: vermelho é o `machine_id` ausente acima, que
          BLOQUEIA de verdade. Aqui a ação segue disponível, e usar a mesma cor
          faria os dois estados parecerem a mesma coisa. */}
      {confirmarJanela && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-lg)', background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 'var(--text-sm)' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span>
              A ASSIM exige {INTERVALO_ASSIM_MIN} min entre autorizações do mesmo
              beneficiário. A última de <strong>{paciente?.paciente_nome}</strong> foi
              às {confirmarJanela.hora} — faltam <strong>{confirmarJanela.restam} min</strong>.
              Enviar agora pode gastar a viagem do robô à toa, ou gerar guia duplicada.
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={enviarDeFato}
                disabled={enviando}
                style={{ border: '1px solid #B45309', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', fontFamily: 'inherit', background: '#B45309', color: '#fff', cursor: enviando ? 'default' : 'pointer' }}
              >
                Enviar mesmo assim
              </button>
              <button
                onClick={() => setConfirmarJanela(null)}
                disabled={enviando}
                style={{ border: '1px solid #FDE68A', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: 'var(--text-sm)', fontFamily: 'inherit', background: 'transparent', color: '#92400E', cursor: enviando ? 'default' : 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Formulário ──
          Cartão à mão em vez de ListCard: aquele imprime "N registros" no
          cabeçalho, que é verdade sobre uma lista e nonsense sobre um formulário. */}
      <div style={{ background: 'var(--card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border)', boxShadow: '0 1px 4px rgba(0,0,0,.05)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <ClipboardPlus size={16} style={{ color: 'var(--foreground)', flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-bold)', color: 'var(--foreground)' }}>
            Nova avulsa
          </span>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <div>
              <label style={rotulo}>Paciente</label>
              <SearchCombobox
                value={rotuloPaciente}
                onChange={setRotuloPaciente}
                opcoes={opcoesPaciente}
                ariaLabel="Paciente"
                placeholder={
                  carregandoPacientes
                    ? 'Carregando pacientes da ASSIM...'
                    : 'Digite o nome...'
                }
              />
              {/* Sem esta linha, um paciente ausente da lista é um mistério: a
                  operação não tem como saber que o critério é "tem sessão ASSIM",
                  e concluiria que o cadastro está errado. */}
              <div style={{ marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
                {carregandoPacientes
                  ? ' '
                  : `Somente pacientes com sessão ASSIM nos últimos 6 meses (${pacientes.length}).`}
              </div>
            </div>

            {/* Terapia e TUSS lado a lado, e o TUSS mais estreito: ele é
                consequência da terapia, não um segundo campo a preencher. Ver
                `listar_terapias_tuss()` — o par vem do banco, do mapa único. */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={rotulo} htmlFor="avulsa-terapia">Terapia</label>
                <select
                  id="avulsa-terapia"
                  value={rotuloTerapia}
                  onChange={(e) => setRotuloTerapia(e.target.value)}
                  disabled={carregandoTerapias}
                  style={{ ...campo, cursor: carregandoTerapias ? 'wait' : 'pointer' }}
                >
                  <option value="">
                    {carregandoTerapias ? 'Carregando terapias...' : 'Selecione a terapia'}
                  </option>
                  {opcoesTerapia.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div style={{ width: '120px', flexShrink: 0 }}>
                <label style={rotulo} htmlFor="avulsa-tuss">TUSS</label>
                <input
                  id="avulsa-tuss"
                  value={tuss ?? ''}
                  readOnly
                  aria-readonly="true"
                  tabIndex={-1}
                  placeholder="—"
                  style={{
                    ...campo,
                    fontFamily: 'monospace',
                    background: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                    cursor: 'default',
                  }}
                />
              </div>
            </div>
          </div>

          {/* A carteirinha é conferência, não campo: ela vem do cadastro e o
              operador precisa VER o que o robô vai digitar no portal. */}
          {paciente && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center', padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
              {carteirinha ? (
                <span style={{ color: 'var(--muted-foreground)' }}>
                  Carteirinha{' '}
                  <strong style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)', color: 'var(--foreground)' }}>
                    {formatarCarteirinha(carteirinhaBruta)}
                  </strong>
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991B1B' }}>
                  <AlertTriangle size={13} />
                  Sem carteirinha ASSIM completa na agenda — o robô não tem o que
                  digitar no portal. Corrija a carteirinha no TiTa antes de pedir.
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {/* CRM e UF andam juntos: é o par que a ASSIM valida. Quando o médico é
                de outro estado e a UF vai errada, a guia é REJEITADA — foi o motivo
                de a coluna crm_uf existir (20260728040000). */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={rotulo} htmlFor="avulsa-crm">CRM do solicitante</label>
                <input id="avulsa-crm" value={crm} onChange={(e) => setCrm(e.target.value)} style={campo} placeholder="Ex.: 52949442" />
              </div>
              <div style={{ width: '86px', flexShrink: 0 }}>
                <label style={rotulo} htmlFor="avulsa-crm-uf">UF</label>
                <select
                  id="avulsa-crm-uf"
                  value={crmUf}
                  onChange={(e) => setCrmUf(e.target.value)}
                  style={{ ...campo, cursor: 'pointer' }}
                >
                  {opcoesUf.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={rotulo} htmlFor="avulsa-medico">Médico solicitante</label>
              <input id="avulsa-medico" value={nomeMedico} onChange={(e) => setNomeMedico(e.target.value)} style={campo} placeholder="Nome do médico" />
            </div>
          </div>

          <div>
            <label style={rotulo} htmlFor="avulsa-motivo">Motivo da avulsa</label>
            <textarea
              id="avulsa-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              style={{ ...campo, resize: 'vertical' }}
              placeholder="Por que esta autorização não corresponde a uma sessão da agenda?"
            />
            <div style={{ marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
              Sem sessão para explicar a linha, este é o único registro de intenção
              que sobra — quem olhar a Reconciliação depois vai ler isto.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
            {impedimento && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{impedimento}</span>
            )}
            <button
              onClick={enviar}
              disabled={Boolean(impedimento) || enviando}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none',
                fontFamily: 'inherit', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)',
                background: impedimento || enviando ? 'var(--muted)' : '#047857',
                color: impedimento || enviando ? 'var(--muted-foreground)' : '#FFFFFF',
                cursor: impedimento || enviando ? 'not-allowed' : 'pointer',
              }}
            >
              <Send size={14} />
              {enviando ? 'Enviando...' : 'Solicitar avulsa'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Listagem ── */}
      <ListCard
        icon={ClipboardPlus}
        title="Avulsas do período"
        count={avulsas.length}
        actions={
          <DateRangePicker
            inicio={de}
            fim={ate}
            onChange={({ inicio, fim }) => {
              setDe(inicio)
              setAte(fim)
            }}
            align="end"
          />
        }
      >
        {carregandoLista ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>
            Carregando...
          </div>
        ) : avulsas.length === 0 ? (
          <EmptyState icon={ClipboardPlus} text="Nenhuma avulsa neste período." />
        ) : (
          avulsas.map((linha) => {
            const st = statusDe(linha)
            return (
              <div key={linha.id} style={{ borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 18px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', flexShrink: 0 }}>
                    {String(linha.horario).slice(0, 5)}
                  </span>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--foreground)', minWidth: 0, flex: 1 }}>
                    {linha.paciente_nome}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
                    {linha.terapia_nome}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: st.cor, whiteSpace: 'nowrap' }}>
                    {st.texto}
                  </span>
                  {linha.numero_autorizacao && (
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
                      guia {linha.numero_autorizacao}
                    </span>
                  )}
                </div>
                <DetalheGrid>
                  <CampoDetalhe rotulo="Motivo" valor={linha.motivo_avulsa || '—'} />
                  <CampoDetalhe rotulo="Pedido por" valor={linha.criado_por || '—'} />
                  <CampoDetalhe rotulo="TUSS" valor={linha.tuss || '—'} />
                  <CampoDetalhe
                    rotulo="Autorizada às"
                    valor={linha.horario_autorizacao ? horaDoTimestamp(linha.horario_autorizacao) : '—'}
                  />
                  {linha.status_assim && <CampoDetalhe rotulo="ASSIM" valor={linha.status_assim} />}
                  {linha.error_message && <CampoDetalhe rotulo="Erro" valor={linha.error_message} />}
                </DetalheGrid>
              </div>
            )
          })
        )}
      </ListCard>
    </div>
  )
}
