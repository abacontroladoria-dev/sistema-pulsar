// disponibilidade-paciente //
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Loader2, Lock } from 'lucide-react'
import { PARENTESCOS } from '@/types/responsavel'
import { maskCpf, onlyDigits, validarCpf } from '@/lib/remuneracao/formatacao'
import {
  DIAS,
  calcularTotais,
  deColunas,
  disponibilidadeVazia,
  formatarHoras,
  lerRascunho,
  opcoesEscola,
  opcoesFim,
  opcoesInicio,
  paraColunas,
  paraMinutos,
  rascunhoDe,
  sessoesNaJanela,
  type ColunasDisponibilidade,
  type DiaChave,
  type Disponibilidade,
  type OpcaoHorario,
  type Rascunho,
} from '@/lib/disponibilidadePaciente'

// Formulário que o RESPONSÁVEL preenche pelo link do WhatsApp — sem conta, no
// celular. Irmão de /ficha-escolar: mesmo visual, mesmo cuidado.
//
//   - Um passo por vez: CPF da criança → confirmar quem é → horários → quem
//     está preenchendo (no fim, como pedido) → confirmação.
//   - O nome da criança aparece MASCARADO ("Maria S. O."): quem digita um CPF
//     qualquer não sai com o nome de uma criança em tratamento.
//   - Horários só da grade de sessões de 40 min, em listas: tocar é mais rápido
//     e mais certo do que digitar hora no teclado do celular.
//   - Depois do primeiro envio a família tem 5 dias para corrigir; depois trava
//     e só a clínica reabre. A tela diz isso nas duas pontas.
//
// Tudo passa por /api/disponibilidade-paciente/* — nunca pelo Supabase direto.

const BG = 'linear-gradient(160deg, #2163d5 0%, #0c3292 100%)'

type PacienteEncontrado = {
  id: number
  nome: string
  estado: 'aberto' | 'travado'
  prazo: string | null
  ultimoEnvioEm: string | null
  valoresAtuais: ColunasDisponibilidade | null
}

type Passo = 'cpf' | 'escolher' | 'confirmar' | 'travado' | 'preencher' | 'enviado'

function formatarDataHora(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatarData(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function DisponibilidadePacientePage() {
  const [passo, setPasso] = useState<Passo>('cpf')

  // ===== Passo 1: CPF =====
  const [cpf, setCpf] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [encontrados, setEncontrados] = useState<PacienteEncontrado[]>([])
  const [paciente, setPaciente] = useState<PacienteEncontrado | null>(null)

  // ===== Passo 2: horários =====
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(disponibilidadeVazia()))
  const [porNome, setPorNome] = useState('')
  const [porParentesco, setPorParentesco] = useState('')
  const [porTelefone, setPorTelefone] = useState('')
  const [tentouEnviar, setTentouEnviar] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [prazoFinal, setPrazoFinal] = useState<string | null>(null)
  const [resumoEnviado, setResumoEnviado] = useState<Disponibilidade | null>(null)

  const refTitulo = useRef<HTMLHeadingElement>(null)

  // Sempre clara — ver ROTAS_SEMPRE_CLARAS em lib/tema.ts (o script do
  // app/layout.tsx cobre a carga direta; isto cobre a navegação client-side).
  useEffect(() => {
    const raiz = document.documentElement
    const estavaEscuro = raiz.classList.contains('dark')
    if (estavaEscuro) raiz.classList.remove('dark')
    return () => {
      if (estavaEscuro) raiz.classList.add('dark')
    }
  }, [])

  // Cada troca de passo troca a tela inteira: levar o foco (e a rolagem) ao
  // título faz a tela nova se anunciar e não deixa o responsável no meio dela.
  useEffect(() => {
    window.scrollTo({ top: 0 })
    refTitulo.current?.focus({ preventScroll: true })
  }, [passo])

  const { disponibilidade, erros } = useMemo(() => lerRascunho(rascunho), [rascunho])
  const totais = calcularTotais(disponibilidade)
  const cpfDigitos = onlyDigits(cpf)
  const cpfCompleto = cpfDigitos.length === 11
  const cpfInvalido = cpfCompleto && !validarCpf(cpfDigitos)

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    if (buscando) return
    setErro('')
    if (!cpfCompleto || cpfInvalido) {
      setErro('Confira o CPF: são 11 números.')
      return
    }
    setBuscando(true)
    try {
      // Barra final: o projeto roda com trailingSlash (sem ela o fetch toma 308).
      const resposta = await fetch('/api/disponibilidade-paciente/buscar/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpfDigitos }),
        cache: 'no-store',
      })
      const dados = await resposta.json().catch(() => null)
      if (!resposta.ok) {
        setErro(dados?.error ?? 'Não foi possível buscar. Tente novamente.')
        return
      }
      const lista: PacienteEncontrado[] = Array.isArray(dados?.pacientes) ? dados.pacientes : []
      if (lista.length === 0) {
        setErro('Não encontramos nenhum paciente com esse CPF. Confira os números ou fale com a recepção da clínica.')
        return
      }
      setEncontrados(lista)
      if (lista.length === 1) {
        setPaciente(lista[0])
        setPasso('confirmar')
      } else {
        setPasso('escolher')
      }
    } catch {
      setErro('Sem conexão. Verifique a internet e tente novamente.')
    } finally {
      setBuscando(false)
    }
  }

  function confirmarPaciente(p: PacienteEncontrado) {
    setPaciente(p)
    setErro('')
    if (p.estado === 'travado') {
      setPasso('travado')
      return
    }
    setRascunho(rascunhoDe(p.valoresAtuais ? deColunas(p.valoresAtuais) : disponibilidadeVazia()))
    setTentouEnviar(false)
    setPasso('preencher')
  }

  function recomecar() {
    setPaciente(null)
    setEncontrados([])
    setErro('')
    setPasso('cpf')
  }

  function mudarDia(chave: DiaChave, parcial: Partial<Rascunho['dias'][DiaChave]>) {
    setRascunho((r) => {
      const atual = { ...r.dias[chave], ...parcial }
      const ini = paraMinutos(atual.inicio)
      const fim = paraMinutos(atual.fim)
      if (ini !== null && fim !== null && fim <= ini) atual.fim = ''
      return { ...r, dias: { ...r.dias, [chave]: atual } }
    })
  }

  function mudarEscola(parcial: Partial<Pick<Rascunho, 'escolaInicio' | 'escolaFim' | 'frequenta_escola'>>) {
    setRascunho((r) => {
      const prox = { ...r, ...parcial }
      const ini = paraMinutos(prox.escolaInicio)
      const fim = paraMinutos(prox.escolaFim)
      if (ini !== null && fim !== null && fim <= ini) prox.escolaFim = ''
      return prox
    })
  }

  // Erros que a tela barra antes do POST — os mesmos que o servidor recusaria.
  const errosTela = [
    ...(rascunho.frequenta_escola === null ? [{ campo: 'escola' as const, mensagem: 'Responda se a criança frequenta escola.' }] : []),
    ...erros,
    ...(!porNome.trim() ? [{ campo: 'porNome' as const, mensagem: 'Informe o seu nome.' }] : []),
    ...(!porParentesco ? [{ campo: 'porParentesco' as const, mensagem: 'Escolha o seu parentesco com a criança.' }] : []),
  ]
  const erroDe = (campo: string) => (tentouEnviar ? errosTela.find((e) => e.campo === campo)?.mensagem : undefined)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!paciente || enviando) return
    setTentouEnviar(true)
    setErro('')

    if (errosTela.length > 0) {
      setErro(errosTela[0].mensagem)
      const alvo = document.querySelector<HTMLElement>(`[data-campo="${errosTela[0].campo}"]`)
      setTimeout(() => alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0)
      return
    }

    if (totais.diasDisponiveis === 0) {
      const seguir = window.confirm('Nenhum dia foi marcado. A criança não tem nenhum horário livre para a clínica?')
      if (!seguir) return
    }

    setEnviando(true)
    try {
      const resposta = await fetch('/api/disponibilidade-paciente/enviar/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paciente_id: paciente.id,
          cpf: cpfDigitos,
          ...paraColunas(disponibilidade),
          preenchido_por_nome: porNome,
          preenchido_por_parentesco: porParentesco,
          preenchido_por_telefone: porTelefone,
        }),
      })
      const dados = await resposta.json().catch(() => null)

      if (resposta.status === 409 && dados?.travado) {
        setPaciente({ ...paciente, estado: 'travado', prazo: dados.prazo ?? paciente.prazo })
        setPasso('travado')
        return
      }
      if (!resposta.ok) {
        setErro(dados?.error ?? 'Não foi possível enviar. Tente novamente.')
        return
      }

      setPrazoFinal(dados?.prazo ?? null)
      setResumoEnviado(disponibilidade)
      setPasso('enviado')
    } catch {
      setErro('Sem conexão. Verifique a internet e tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  const primeiroNome = paciente?.nome.split(' ')[0] ?? ''

  // ===== Telas finais (cartão único) =====
  if (passo === 'enviado' || passo === 'travado') {
    const enviado = passo === 'enviado'
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12" style={{ background: BG, colorScheme: 'light' }}>
        <div className="w-full max-w-sm bg-white text-center px-7 py-10" style={{ borderRadius: '26px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)' }}>
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: enviado ? '#dcfce7' : '#e2e8f0' }}
          >
            {enviado ? (
              <Check size={40} strokeWidth={2.5} style={{ color: '#15803d' }} />
            ) : (
              <Lock size={34} strokeWidth={2} style={{ color: '#475569' }} />
            )}
          </div>
          <h1 ref={refTitulo} tabIndex={-1} className="font-bold tracking-tight mb-3 focus:outline-none" style={{ fontSize: '26px', color: '#192755' }}>
            {enviado ? 'Recebemos, obrigado!' : 'Prazo encerrado'}
          </h1>
          {enviado ? (
            <>
              <p className="text-[15px] leading-relaxed" style={{ color: '#64748b' }}>
                A disponibilidade de {primeiroNome} já está com a equipe da clínica.
              </p>
              {resumoEnviado && (
                <div className="mt-5 text-left rounded-2xl px-4 py-3" style={{ background: '#f1f5f9' }}>
                  <ul className="space-y-1 text-[14px]" style={{ color: '#1e293b' }}>
                    {DIAS.map((dia) => {
                      const j = resumoEnviado.dias[dia.chave]
                      return (
                        <li key={dia.chave} className="flex justify-between gap-3">
                          <span style={{ color: '#475569' }}>{dia.longo}</span>
                          <span className="font-semibold tabular-nums">{j ? `${j.inicio} às ${j.fim}` : '—'}</span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-2 pt-2 text-[13px] border-t" style={{ color: '#475569', borderColor: '#e2e8f0' }}>
                    {formatarHoras(calcularTotais(resumoEnviado).minutosSemana)} por semana
                  </p>
                </div>
              )}
              {prazoFinal && (
                <p className="mt-5 text-[14px] leading-relaxed" style={{ color: '#475569' }}>
                  Se precisar corrigir, use este mesmo link até <strong>{formatarDataHora(prazoFinal)}</strong>.
                </p>
              )}
            </>
          ) : (
            <p className="text-[15px] leading-relaxed" style={{ color: '#64748b' }}>
              A disponibilidade de {paciente?.nome} foi enviada
              {paciente?.ultimoEnvioEm ? ` em ${formatarData(paciente.ultimoEnvioEm)}` : ''} e o prazo para alterar terminou. Para mudar, fale com a recepção da clínica.
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: BG, colorScheme: 'light' }}>
      <div className="w-full max-w-md mx-auto">
        {/* ── Cabeçalho ── */}
        <div className="flex flex-col items-center gap-4 pb-8">
          <div className="w-28 h-28 bg-white flex items-center justify-center p-1.5" style={{ borderRadius: '24px', boxShadow: '0 12px 32px rgba(0,0,0,0.22)' }}>
            <img src="/logo-universo-aba.png" alt="Universo ABA" width={112} height={112} className="w-full h-full object-contain" />
          </div>
          <div className="text-center">
            <p className="text-[21px] font-bold text-white tracking-tight leading-tight">Clínica Universo ABA</p>
            <p className="text-[15px] font-medium mt-1" style={{ color: 'rgba(255,255,255,0.88)' }}>
              Disponibilidade para atendimento
            </p>
          </div>
        </div>

        <div className="bg-white overflow-hidden" style={{ borderRadius: '26px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)' }}>
          {/* ── Passo 1: CPF ── */}
          {passo === 'cpf' && (
            <form onSubmit={buscar} className="px-7 pt-8 pb-8 space-y-5" noValidate>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: '#dde8f9' }}>
                  <CalendarClock size={30} strokeWidth={1.75} style={{ color: '#1a4fc4' }} />
                </div>
                <h1 ref={refTitulo} tabIndex={-1} className="text-[19px] font-bold focus:outline-none" style={{ color: '#192755' }}>
                  Em quais horários o paciente pode vir?
                </h1>
                <p className="text-[15px] leading-relaxed mt-2" style={{ color: '#64748b', textWrap: 'balance' } as React.CSSProperties}>
                  Assim teremos a informação dos horários que fazem mais sentido para vocês. Leva cerca de 2 minutos.
                </p>
              </div>

              <Campo id="cpf" rotulo="CPF da criança" erro={erro || (cpfInvalido ? 'Este CPF não é válido. Confira os números.' : undefined)}>
                <input
                  id="cpf"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={maskCpf(cpf)}
                  onChange={(e) => {
                    setCpf(onlyDigits(e.target.value).slice(0, 11))
                    setErro('')
                  }}
                  placeholder="000.000.000-00"
                  aria-invalid={!!erro || cpfInvalido}
                  className={ENTRADA}
                  style={ESTILO_ENTRADA}
                />
              </Campo>

              <BotaoPrincipal carregando={buscando} texto={buscando ? 'Buscando...' : 'Continuar'} />
            </form>
          )}

          {/* ── Passo 1b: mais de um paciente com o mesmo CPF ── */}
          {passo === 'escolher' && (
            <div className="px-7 pt-8 pb-8 space-y-4">
              <h1 ref={refTitulo} tabIndex={-1} className="text-[19px] font-bold focus:outline-none" style={{ color: '#192755' }}>
                Qual destas crianças?
              </h1>
              <ul className="space-y-2">
                {encontrados.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => confirmarPaciente(p)}
                      className="w-full text-left px-4 py-4 rounded-2xl text-[16px] font-semibold transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4]"
                      style={{ background: '#f1f5f9', color: '#1e293b' }}
                    >
                      {p.nome}
                    </button>
                  </li>
                ))}
              </ul>
              <BotaoSecundario onClick={recomecar} texto="Digitar outro CPF" />
            </div>
          )}

          {/* ── Passo 2: confirmar quem é ── */}
          {passo === 'confirmar' && paciente && (
            <div className="px-7 pt-8 pb-8 space-y-5 text-center">
              <p className="text-[14px]" style={{ color: '#64748b' }}>Encontramos este paciente:</p>
              <h1 ref={refTitulo} tabIndex={-1} className="text-[26px] font-bold tracking-tight focus:outline-none" style={{ color: '#192755' }}>
                {paciente.nome}
              </h1>
              <p className="text-[15px]" style={{ color: '#475569' }}>É a criança certa?</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => confirmarPaciente(paciente)}
                  className="w-full font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:ring-offset-2 bg-[#1a3275] hover:bg-[#152a68] active:bg-[#111f52]"
                  style={{ height: '56px', borderRadius: '16px', fontSize: '16px' }}
                >
                  Sim, continuar
                </button>
                <BotaoSecundario onClick={recomecar} texto="Não, digitar outro CPF" />
              </div>
            </div>
          )}

          {/* ── Passo 3: horários + quem preenche ── */}
          {passo === 'preencher' && paciente && (
            <form onSubmit={enviar} className="px-6 pt-7 pb-8 space-y-7" noValidate>
              <div
                className="rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
                style={{ background: '#eef3fc' }}
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium" style={{ color: '#475569' }}>Paciente</p>
                  <h1 ref={refTitulo} tabIndex={-1} className="text-[16px] font-semibold truncate focus:outline-none" style={{ color: '#192755' }}>
                    {paciente.nome}
                  </h1>
                </div>
                <button
                  type="button"
                  onClick={recomecar}
                  className="text-[13px] font-semibold shrink-0 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] rounded-lg min-h-[44px] px-3 -mr-2 inline-flex items-center"
                  style={{ color: '#1a4fc4' }}
                >
                  Trocar
                </button>
              </div>

              {paciente.ultimoEnvioEm && (
                <div className="rounded-2xl px-4 py-3 text-[14px] leading-relaxed" style={{ background: '#fefce8', color: '#713f12', border: '1px solid #fde68a' }}>
                  Já recebemos uma disponibilidade em <strong>{formatarData(paciente.ultimoEnvioEm)}</strong>. Os horários abaixo são os que estão
                  registrados — confira e corrija o que mudou.
                  {paciente.prazo && (
                    <> Você pode corrigir até <strong>{formatarDataHora(paciente.prazo)}</strong>.</>
                  )}
                </div>
              )}

              {/* ── Escola ── */}
              <Secao titulo="Escola">
                <div data-campo="escola">
                  <p className="block text-[14px] font-semibold mb-2" style={{ color: '#475569' }}>
                    A criança frequenta escola? <span style={{ color: '#b91c1c' }} aria-hidden="true">*</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="A criança frequenta escola?">
                    {([
                      [true, 'Sim'],
                      [false, 'Não'],
                    ] as const).map(([valor, texto]) => {
                      const ativo = rascunho.frequenta_escola === valor
                      return (
                        <button
                          key={texto}
                          type="button"
                          aria-pressed={ativo}
                          onClick={() => mudarEscola({ frequenta_escola: valor })}
                          className="rounded-2xl text-[16px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4]"
                          style={{
                            height: '52px',
                            background: ativo ? '#1a3275' : '#eef3fc',
                            color: ativo ? '#ffffff' : '#1e293b',
                          }}
                        >
                          {texto}
                        </button>
                      )
                    })}
                  </div>
                  {rascunho.frequenta_escola === true && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <Campo id="escola-inicio" rotulo="Entra às">
                        <SelecaoHora id="escola-inicio" valor={rascunho.escolaInicio} opcoes={opcoesEscola(rascunho.escolaInicio)} aoMudar={(v) => mudarEscola({ escolaInicio: v })} />
                      </Campo>
                      <Campo id="escola-fim" rotulo="Sai às">
                        <SelecaoHora
                          id="escola-fim"
                          valor={rascunho.escolaFim}
                          opcoes={opcoesEscola(rascunho.escolaFim, rascunho.escolaInicio || null)}
                          aoMudar={(v) => mudarEscola({ escolaFim: v })}
                        />
                      </Campo>
                    </div>
                  )}
                  {erroDe('escola') && <ErroCampo texto={erroDe('escola')!} />}
                </div>
              </Secao>

              {/* ── Dias ── */}
              <Secao titulo="Horários livres para a clínica">
                <p className="text-[14px] leading-relaxed -mt-1" style={{ color: '#64748b' }}>
                  Marque os dias em que a criança pode vir e o horário de chegada e saída. Cada sessão dura 40 minutos.
                </p>
                <ul className="space-y-3">
                  {DIAS.map((dia) => {
                    const e = rascunho.dias[dia.chave]
                    const erroDia = erroDe(dia.chave)
                    const sessoes = sessoesNaJanela(e.inicio && e.fim ? { inicio: e.inicio, fim: e.fim } : null)
                    return (
                      <li
                        key={dia.chave}
                        data-campo={dia.chave}
                        className="rounded-2xl px-4 py-3"
                        style={{
                          background: e.ativo ? '#f0fdf4' : '#f8fafc',
                          border: `1.5px solid ${erroDia ? '#b91c1c' : e.ativo ? '#86efac' : '#e2e8f0'}`,
                        }}
                      >
                        <button
                          type="button"
                          aria-pressed={e.ativo}
                          onClick={() => mudarDia(dia.chave, { ativo: !e.ativo })}
                          className="w-full flex items-center gap-3 min-h-[44px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] rounded-xl"
                        >
                          <span
                            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                            style={{ background: e.ativo ? '#15803d' : '#ffffff', border: e.ativo ? 'none' : '1.5px solid #94a3b8' }}
                            aria-hidden="true"
                          >
                            {e.ativo && <Check size={16} strokeWidth={3} color="#ffffff" />}
                          </span>
                          <span className="flex-1 text-[16px] font-semibold" style={{ color: '#1e293b' }}>{dia.longo}</span>
                          <span className="text-[13px]" style={{ color: '#64748b' }}>
                            {e.ativo ? (sessoes > 0 ? `${sessoes} ${sessoes === 1 ? 'sessão' : 'sessões'}` : '') : 'Não pode'}
                          </span>
                        </button>
                        {e.ativo && (
                          <div className="grid grid-cols-2 gap-3 mt-3">
                            <Campo id={`${dia.chave}-inicio`} rotulo="Chega às">
                              <SelecaoHora id={`${dia.chave}-inicio`} valor={e.inicio} opcoes={opcoesInicio(e.inicio)} aoMudar={(v) => mudarDia(dia.chave, { inicio: v })} />
                            </Campo>
                            <Campo id={`${dia.chave}-fim`} rotulo="Sai às">
                              <SelecaoHora
                                id={`${dia.chave}-fim`}
                                valor={e.fim}
                                opcoes={opcoesFim(e.inicio || null, e.fim)}
                                aoMudar={(v) => mudarDia(dia.chave, { fim: v })}
                              />
                            </Campo>
                          </div>
                        )}
                        {erroDia && <ErroCampo texto={erroDia} />}
                      </li>
                    )
                  })}
                </ul>
                <p className="text-[14px] rounded-2xl px-4 py-3" style={{ background: '#eef3fc', color: '#1e293b' }} aria-live="polite">
                  Total: <strong className="tabular-nums">{formatarHoras(totais.minutosSemana)}</strong> por semana ·{' '}
                  <strong className="tabular-nums">{totais.sessoes40}</strong> {totais.sessoes40 === 1 ? 'sessão' : 'sessões'}
                </p>
              </Secao>

              {/* ── Quem está preenchendo (no fim) ── */}
              <Secao titulo="Quem está preenchendo">
                <div data-campo="porNome">
                  <Campo id="por-nome" rotulo="Seu nome" obrigatorio erro={erroDe('porNome')}>
                    <input
                      id="por-nome"
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      value={porNome}
                      onChange={(e) => setPorNome(e.target.value)}
                      aria-invalid={!!erroDe('porNome')}
                      className={ENTRADA}
                      style={ESTILO_ENTRADA}
                    />
                  </Campo>
                </div>
                <div data-campo="porParentesco">
                  <Campo id="por-parentesco" rotulo="Parentesco com a criança" obrigatorio erro={erroDe('porParentesco')}>
                    <Selecao id="por-parentesco" valor={porParentesco} aoMudar={setPorParentesco} opcoes={PARENTESCOS} />
                  </Campo>
                </div>
                <Campo id="por-telefone" rotulo="Seu WhatsApp">
                  <input
                    id="por-telefone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={120}
                    value={porTelefone}
                    onChange={(e) => setPorTelefone(e.target.value)}
                    placeholder="(21) 99999-9999"
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>
              </Secao>

              <p className="sr-only" role="status" aria-live="polite">
                {enviando ? 'Enviando. Aguarde.' : ''}
              </p>

              {erro && (
                <div role="alert" className="text-sm px-4 py-3 rounded-2xl" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                  {erro}
                </div>
              )}

              <BotaoPrincipal carregando={enviando} texto={enviando ? 'Enviando...' : 'Enviar disponibilidade'} />
            </form>
          )}
        </div>

        <p className="text-[13px] leading-snug text-center mt-6 px-4" style={{ color: 'rgba(255,255,255,0.85)' }}>
          As informações são usadas apenas pela equipe da clínica para organizar os horários de terapia.
        </p>
      </div>
    </main>
  )
}

// ===== Peças da tela =====
// Cópias locais das de /ficha-escolar (mesmo motivo de lá: components/ui/form.tsx
// é stub e o resto do projeto monta markup à mão). Se aparecer um terceiro
// formulário público, é hora de extrair.

const ENTRADA =
  'w-full rounded-2xl px-4 py-3.5 text-[16px] border-[1.5px] border-transparent ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:border-[#1a4fc4] ' +
  'aria-[invalid=true]:border-[#b91c1c] placeholder:text-slate-500'

const ESTILO_ENTRADA: React.CSSProperties = { background: '#eef3fc', color: '#1e293b' }

function BotaoPrincipal({ carregando, texto }: { carregando: boolean; texto: string }) {
  return (
    <button
      type="submit"
      disabled={carregando}
      className="w-full inline-flex items-center justify-center gap-2 font-bold text-white transition-all duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:ring-offset-2 disabled:opacity-70 bg-[#1a3275] hover:bg-[#152a68] active:bg-[#111f52] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
      style={{ height: '56px', borderRadius: '16px', fontSize: '16px' }}
    >
      {carregando && <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {texto}
    </button>
  )
}

function BotaoSecundario({ onClick, texto }: { onClick: () => void; texto: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4]"
      style={{ height: '52px', borderRadius: '16px', fontSize: '15px', color: '#1a4fc4', background: '#eef3fc' }}
    >
      {texto}
    </button>
  )
}

function SelecaoHora({ id, valor, opcoes, aoMudar }: { id: string; valor: string; opcoes: OpcaoHorario[]; aoMudar: (v: string) => void }) {
  return (
    <div className="relative">
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} className={`${ENTRADA} appearance-none pr-9 tabular-nums`} style={ESTILO_ENTRADA}>
        <option value="">--:--</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.valor}</option>
        ))}
      </select>
      <ChevronDown size={16} strokeWidth={2} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#475569' }} aria-hidden="true" />
    </div>
  )
}

function Selecao({ id, valor, aoMudar, opcoes }: { id: string; valor: string; aoMudar: (v: string) => void; opcoes: readonly string[] }) {
  return (
    <div className="relative">
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} className={`${ENTRADA} appearance-none pr-11`} style={ESTILO_ENTRADA}>
        <option value="">Selecione</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={18} strokeWidth={2} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#475569' }} aria-hidden="true" />
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-[12px] font-bold uppercase tracking-wider pb-1" style={{ color: '#1a4fc4' }}>
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}

function Campo({
  id,
  rotulo,
  obrigatorio,
  erro,
  children,
}: {
  id: string
  rotulo: string
  obrigatorio?: boolean
  erro?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold mb-2" style={{ color: '#475569' }}>
        {rotulo}
        {obrigatorio && <span style={{ color: '#b91c1c' }} aria-hidden="true"> *</span>}
      </label>
      {children}
      {erro && <ErroCampo texto={erro} />}
    </div>
  )
}

function ErroCampo({ texto }: { texto: string }) {
  return (
    <p className="text-[13px] mt-1.5 font-medium" style={{ color: '#b91c1c' }}>
      {texto}
    </p>
  )
}
