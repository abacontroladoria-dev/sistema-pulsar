// ficha-escolar //
'use client'

import { useEffect, useRef, useState } from 'react'
import { GraduationCap, Check, Search, Loader2, ChevronDown } from 'lucide-react'
import { PARENTESCOS } from '@/types/responsavel'
import { DatePicker } from '@/components/ui/date-picker'

function hojeLocalIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Formulário que o RESPONSÁVEL preenche pelo link do WhatsApp — sem conta, num
// celular, provavelmente uma única vez na vida. Isso define tudo aqui:
//
//   - Um passo por vez. Achar o filho, confirmar quem é, preencher a escola. Uma
//     tela única com 12 campos faz o pai fechar antes de terminar.
//   - Nada de jargão do sistema. "Turma" e "Turno", não "vínculo" ou "registro".
//   - Só dois campos são obrigatórios (escola e quem preencheu). O resto o
//     responsável pode não saber de cabeça, e um asterisco a mais custa envios.
//
// A busca e o envio falam com /api/ficha-escolar/* — nunca com o Supabase direto,
// porque esta página roda sem sessão e a validação precisa ficar do lado do
// servidor. Ver os comentários naqueles dois handlers.

const BG = 'linear-gradient(160deg, #2163d5 0%, #0c3292 100%)'

// Espera antes de buscar, para não disparar uma requisição por tecla.
const DEBOUNCE_MS = 300

// Espelha MINIMO_CARACTERES do handler de busca. A tela precisa saber para
// explicar ao responsável por que nada aparece ainda.
const MINIMO_BUSCA = 3

const TURNOS = ['Manhã', 'Tarde', 'Integral'] as const

type PacienteEncontrado = { id: number; nome: string }

type Passo = 'buscar' | 'preencher' | 'enviado'

// Os três campos que o servidor recusa por conta própria. O resto é opcional ou
// já é barrado pelo `required` do navegador antes do POST sair.
type CampoErro = 'nascimento' | 'escola' | 'porNome'

/**
 * De qual campo o servidor está reclamando.
 *
 * Casa por trecho, não por igualdade: as mensagens de tamanho carregam o limite
 * interpolado (`passou de 120 caracteres`), então comparar a string inteira
 * erraria justamente nelas. Os trechos abaixo são os que ../enviar/route.ts
 * escreve — mudar o texto lá pede mudar aqui.
 *
 * Sem correspondência devolve `null`, e aí o alerta aparece sozinho, como antes.
 * É o comportamento certo para "Serviço indisponível" e afins, que não são de
 * campo nenhum.
 */
function campoDoErro(mensagem: string): CampoErro | null {
  if (mensagem.includes('data de nascimento')) return 'nascimento'
  if (mensagem.includes('nome da escola')) return 'escola'
  if (mensagem.includes('quem está preenchendo') || mensagem.includes('quem preencheu')) {
    return 'porNome'
  }

  return null
}

export default function FichaEscolarPage() {
  const [passo, setPasso] = useState<Passo>('buscar')

  // ===== Passo 1: achar o paciente =====
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<PacienteEncontrado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [selecionado, setSelecionado] = useState<PacienteEncontrado | null>(null)
  const [dataNascimento, setDataNascimento] = useState('')

  // ===== Passo 2: os dados =====
  const [escolaNome, setEscolaNome] = useState('')
  const [escolaEndereco, setEscolaEndereco] = useState('')
  const [escolaTelefone, setEscolaTelefone] = useState('')
  const [escolaEmail, setEscolaEmail] = useState('')
  const [coordenadorNome, setCoordenadorNome] = useState('')
  const [turma, setTurma] = useState('')
  const [turno, setTurno] = useState('')
  const [porNome, setPorNome] = useState('')
  const [porParentesco, setPorParentesco] = useState('')
  const [porTelefone, setPorTelefone] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  // Qual campo o servidor recusou. Move o foco e marca o controle — sem isto o
  // recado aparecia no rodapé de um formulário rolado, a centenas de pixels do
  // campo errado, e quem digitou a data errada via só o botão "não fazer nada".
  const [campoComErro, setCampoComErro] = useState<CampoErro | null>(null)

  const refEscolaNome = useRef<HTMLInputElement>(null)
  const refPorNome = useRef<HTMLInputElement>(null)
  const refConfirmacao = useRef<HTMLHeadingElement>(null)

  // Guarda a busca mais recente: respostas fora de ordem (a de "ana" chegando
  // depois da de "ana clara") sobrescreveriam a lista certa pela antiga.
  const buscaAtual = useRef(0)

  // Esta tela é clara, sempre, para todo mundo — ver ROTAS_SEMPRE_CLARAS.
  //
  // Quem garante isso na CARGA DIRETA (o caso normal: o link do WhatsApp) é o
  // script pré-hidratação do app/layout.tsx, que decide antes da primeira
  // pintura. Este efeito cobre só o outro caminho — chegar aqui por navegação
  // client-side, quando aquele script não roda de novo.
  //
  // Uma versão anterior deixava a correção SÓ aqui, e não bastava: o efeito roda
  // depois da hidratação, então o cartão ficava quase preto por ~1,3s antes de
  // clarear. Ter a regra nos dois lugares é o que fecha os dois caminhos.
  //
  // Não mexe no localStorage: só tira a classe enquanto esta página está
  // montada, e devolve na saída para não sequestrar o tema do resto do app.
  useEffect(() => {
    const raiz = document.documentElement
    const estavaEscuro = raiz.classList.contains('dark')

    if (estavaEscuro) raiz.classList.remove('dark')

    return () => {
      if (estavaEscuro) raiz.classList.add('dark')
    }
  }, [])

  // Ao trocar o formulário pela confirmação, a árvore inteira sai de cena e o
  // foco cai no <body>: quem navega por teclado ou leitor de tela fica sem
  // saber que deu certo. Levar o foco ao título faz a tela nova se anunciar.
  useEffect(() => {
    if (passo === 'enviado') refConfirmacao.current?.focus()
  }, [passo])

  useEffect(() => {
    const alvo = termo.trim()

    if (alvo.length < MINIMO_BUSCA) {
      setResultados([])
      setBuscando(false)
      return
    }

    setBuscando(true)
    const id = ++buscaAtual.current

    const timer = setTimeout(async () => {
      try {
        // Barra final: o projeto roda com trailingSlash, e sem ela o fetch toma
        // 308 antes de chegar ao handler.
        const resposta = await fetch(
          `/api/ficha-escolar/buscar-paciente/?nome=${encodeURIComponent(alvo)}`,
          { cache: 'no-store' }
        )
        const dados = await resposta.json().catch(() => null)

        if (id !== buscaAtual.current) return

        setResultados(resposta.ok && Array.isArray(dados?.pacientes) ? dados.pacientes : [])
      } catch {
        if (id === buscaAtual.current) setResultados([])
      } finally {
        if (id === buscaAtual.current) setBuscando(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [termo])

  function escolher(paciente: PacienteEncontrado) {
    setSelecionado(paciente)
    setErro('')
  }

  function voltarParaBusca() {
    setSelecionado(null)
    setDataNascimento('')
    setErro('')
  }

  /**
   * Leva foco e rolagem ao campo recusado.
   *
   * O `setTimeout(0)` espera o React pintar o `aria-invalid` e o alerta antes de
   * rolar — sem ele a rolagem calcula a posição do layout velho e para alguns
   * pixels fora. `block: 'center'` em vez do topo porque o campo tem rótulo e
   * dica acima, e encostar no topo da viewport esconde os dois.
   */
  function focarCampo(campo: CampoErro) {
    const alvo =
      campo === 'nascimento'
        ? // O DatePicker não repassa ref: o gatilho é achado pelo id.
          document.getElementById('data-nascimento')
        : campo === 'escola'
          ? refEscolaNome.current
          : refPorNome.current

    setTimeout(() => {
      alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      alvo?.focus({ preventScroll: true })
    }, 0)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()

    if (!selecionado) return

    // Reentrada: `enviando` desabilita o botão, mas dois toques rápidos no mesmo
    // quadro entram os dois antes do estado repintar, e o insert em
    // pacientes_dados_escolares não tem unicidade — seriam duas linhas para a
    // mesma família. O limite de 5 por 10 min não pega isso.
    if (enviando) return

    setErro('')
    setCampoComErro(null)
    setEnviando(true)

    try {
      const resposta = await fetch('/api/ficha-escolar/enviar/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paciente_id: selecionado.id,
          data_nascimento: dataNascimento,
          escola_nome: escolaNome,
          escola_endereco: escolaEndereco,
          escola_telefone: escolaTelefone,
          escola_email: escolaEmail,
          coordenador_nome: coordenadorNome,
          turma,
          turno,
          preenchido_por_nome: porNome,
          preenchido_por_parentesco: porParentesco,
          preenchido_por_telefone: porTelefone,
        }),
      })

      const dados = await resposta.json().catch(() => null)

      if (!resposta.ok) {
        const mensagem = dados?.error ?? 'Não foi possível enviar. Tente novamente.'
        const campo = campoDoErro(mensagem)

        setErro(mensagem)
        setCampoComErro(campo)
        setEnviando(false)

        if (campo) focarCampo(campo)

        return
      }

      setPasso('enviado')
    } catch {
      setErro('Sem conexão. Verifique a internet e tente novamente.')
      setEnviando(false)
    }
  }

  // ===== Confirmação =====
  if (passo === 'enviado') {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-5 py-12"
        style={{ background: BG, colorScheme: 'light' }}
      >
        <div
          className="w-full max-w-sm bg-white text-center px-8 py-12"
          style={{ borderRadius: '26px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)' }}
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: '#dcfce7' }}
          >
            <Check size={40} strokeWidth={2.5} style={{ color: '#15803d' }} />
          </div>
          {/* `tabIndex={-1}` torna o título focável por script sem entrar na
              ordem de tabulação. `outline-none` porque o foco aqui é para
              anunciar a tela, não para marcar onde o teclado está. */}
          <h1
            ref={refConfirmacao}
            tabIndex={-1}
            className="font-bold tracking-tight mb-3 focus:outline-none"
            style={{ fontSize: '26px', color: '#192755' }}
          >
            Recebemos, obrigado!
          </h1>
          <p className="text-[15px] leading-relaxed" style={{ color: '#64748b' }}>
            As informações da escola de {selecionado?.nome.split(' ')[0]} já estão com a
            equipe terapêutica. Pode fechar esta página.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-5 py-10" style={{ background: BG, colorScheme: 'light' }}>
      <div className="w-full max-w-md mx-auto">

        {/* ── Cabeçalho ── */}
        <div className="flex flex-col items-center gap-4 pb-8">
          {/* Logo da clínica, não o glifo do Pulsar: quem abre este link é o
              responsável, que reconhece a Universo ABA e nunca ouviu falar do
              nome do sistema interno. */}
          {/* A logo tem bastante espaço em branco embutido no PNG, então um
              padding generoso aqui a encolheria duas vezes. `p-1.5` só evita que
              ela encoste no canto arredondado. */}
          <div
            className="w-28 h-28 bg-white flex items-center justify-center p-1.5"
            style={{ borderRadius: '24px', boxShadow: '0 12px 32px rgba(0,0,0,0.22)' }}
          >
            <img
              src="/logo-universo-aba.png"
              alt="Universo ABA"
              width={112}
              height={112}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="text-center">
            <h1 className="text-[21px] font-bold text-white tracking-tight leading-tight">
              Clínica Universo ABA
            </h1>
            <p className="text-[15px] font-medium mt-1" style={{ color: 'rgba(255,255,255,0.88)' }}>
              Informações Escolares
            </p>
          </div>
        </div>

        <div
          className="bg-white overflow-hidden"
          style={{ borderRadius: '26px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)' }}
        >
          {/* ── Introdução ── */}
          <div className="px-7 pt-8 pb-2 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ background: '#dde8f9' }}
            >
              <GraduationCap size={30} strokeWidth={1.75} style={{ color: '#1a4fc4' }} />
            </div>
            <p
              className="text-[15px] leading-relaxed"
              style={{ color: '#64748b', textWrap: 'balance' } as React.CSSProperties}
            >
              Estas informações ajudam a equipe terapêutica a acompanhar o dia a dia
              escolar. Leva menos de dois minutos.
            </p>
          </div>

          {/* ── Passo 1: buscar o paciente ── */}
          {!selecionado && (
            <div className="px-7 pt-6 pb-8 space-y-4">
              <div>
                <label
                  htmlFor="busca-paciente"
                  className="block text-[13px] font-semibold mb-2"
                  style={{ color: '#475569' }}
                >
                  Nome do paciente
                </label>
                <div className="relative">
                  <Search
                    size={18}
                    strokeWidth={2}
                    className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: '#64748b' }}
                    aria-hidden="true"
                  />
                  <input
                    id="busca-paciente"
                    type="text"
                    value={termo}
                    onChange={(e) => setTermo(e.target.value)}
                    placeholder="Digite o nome da criança"
                    autoComplete="off"
                    className="w-full rounded-2xl pl-11 pr-11 py-4 text-[16px] border-[1.5px] border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:border-[#1a4fc4] placeholder:text-slate-600"
                    style={{ background: '#eef3fc', color: '#1e293b' }}
                  />
                  {buscando && (
                    <Loader2
                      size={18}
                      className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin motion-reduce:animate-none"
                      style={{ color: '#1a4fc4' }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <p className="text-[13px] mt-2" style={{ color: '#64748b' }}>
                  Digite pelo menos {MINIMO_BUSCA} letras do nome.
                </p>
              </div>

              {/* A região viva carrega só o RESUMO, não a lista. Envolvendo o
                  <ul>, cada tecla a partir da 3ª reanunciava todos os nomes por
                  inteiro — verboso, repetitivo, e sem nunca dizer quantos são.
                  A lista fica fora e é navegada normalmente. */}
              <p className="sr-only" role="status" aria-live="polite">
                {buscando
                  ? 'Buscando pacientes.'
                  : termo.trim().length < MINIMO_BUSCA
                    ? ''
                    : resultados.length === 0
                      ? 'Nenhum paciente encontrado.'
                      : `${resultados.length} ${
                          resultados.length === 1
                            ? 'paciente encontrado'
                            : 'pacientes encontrados'
                        }. Escolha um na lista.`}
              </p>

              <div className="min-h-[76px]">
                {resultados.length > 0 && (
                  <ul className="space-y-2">
                    {resultados.map((paciente) => (
                      <li key={paciente.id}>
                        <button
                          type="button"
                          onClick={() => escolher(paciente)}
                          className="w-full text-left px-4 py-3.5 rounded-2xl text-[15px] font-medium transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4]"
                          style={{ background: '#f8fafc', color: '#1e293b' }}
                        >
                          {paciente.nome}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!buscando && termo.trim().length >= MINIMO_BUSCA && resultados.length === 0 && (
                  <p className="text-[14px] px-1" style={{ color: '#64748b' }}>
                    Nenhum paciente encontrado com esse nome. Confira a grafia ou fale
                    com a recepção.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Passo 2: confirmar e preencher ── */}
          {selecionado && (
            <form onSubmit={enviar} className="px-7 pt-6 pb-8 space-y-6">

              {/* Paciente escolhido */}
              <div
                className="rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
                style={{ background: '#eef3fc' }}
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium" style={{ color: '#475569' }}>
                    Paciente
                  </p>
                  <p className="text-[15px] font-semibold truncate" style={{ color: '#192755' }}>
                    {selecionado.nome}
                  </p>
                </div>
                {/* O `-mr-2` puxa o padding para fora da caixa visível: a área
                    de toque chega aos 44px do sistema (DESIGN.md §1) sem que o
                    link pareça maior nem empurre o nome do paciente. É a única
                    saída desta tela para quem escolheu a criança errada, então
                    errar o toque custa recarregar e digitar tudo de novo. */}
                <button
                  type="button"
                  onClick={voltarParaBusca}
                  className="text-[13px] font-semibold shrink-0 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] rounded-lg min-h-[44px] px-3 -mr-2 inline-flex items-center"
                  style={{ color: '#1a4fc4' }}
                >
                  Trocar
                </button>
              </div>

              {/* Confirmação por data de nascimento. É o que amarra o envio a esta
                  criança — o link é o mesmo para todas as famílias. */}
              <Campo
                id="data-nascimento"
                rotulo="Data de nascimento do paciente"
                obrigatorio
                dica="Para confirmar que é a criança certa."
                erro={campoComErro === 'nascimento' ? erro : undefined}
              >
                <DatePicker
                  id="data-nascimento"
                  value={dataNascimento}
                  onChange={setDataNascimento}
                  max={hojeLocalIso()}
                  aria-invalid={campoComErro === 'nascimento'}
                  aria-describedby={
                    campoComErro === 'nascimento' ? 'erro-envio' : 'data-nascimento-dica'
                  }
                  classeGatilho={`flex items-center justify-between text-left bg-[#eef3fc] text-[#1e293b] ${ENTRADA}`}
                />
              </Campo>

              <Secao titulo="Escola">
                <Campo
                  id="escola-nome"
                  rotulo="Nome da escola"
                  obrigatorio
                  erro={campoComErro === 'escola' ? erro : undefined}
                >
                  <input
                    id="escola-nome"
                    ref={refEscolaNome}
                    type="text"
                    required
                    maxLength={120}
                    value={escolaNome}
                    onChange={(e) => setEscolaNome(e.target.value)}
                    aria-invalid={campoComErro === 'escola'}
                    aria-describedby={campoComErro === 'escola' ? 'erro-envio' : undefined}
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="escola-endereco" rotulo="Endereço da escola">
                  <textarea
                    id="escola-endereco"
                    rows={2}
                    maxLength={300}
                    value={escolaEndereco}
                    onChange={(e) => setEscolaEndereco(e.target.value)}
                    placeholder="Rua, número, bairro"
                    className={`${ENTRADA} resize-none`}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="escola-telefone" rotulo="Telefone(s) da escola">
                  <input
                    id="escola-telefone"
                    type="tel"
                    inputMode="tel"
                    maxLength={120}
                    value={escolaTelefone}
                    onChange={(e) => setEscolaTelefone(e.target.value)}
                    placeholder="(21) 3333-3333"
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="escola-email" rotulo="E-mail da escola">
                  <input
                    id="escola-email"
                    type="email"
                    maxLength={120}
                    value={escolaEmail}
                    onChange={(e) => setEscolaEmail(e.target.value)}
                    placeholder="secretaria@escola.com.br"
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>
              </Secao>

              {/* "Pedagógico", não "Turma": o campo Turma vive dentro desta
                  seção, e repetir a palavra nos dois níveis confunde quem lê. */}
              <Secao titulo="Pedagógico">
                <Campo id="coordenador" rotulo="Coordenador(a)">
                  <input
                    id="coordenador"
                    type="text"
                    maxLength={120}
                    value={coordenadorNome}
                    onChange={(e) => setCoordenadorNome(e.target.value)}
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="turma" rotulo="Turma">
                  <input
                    id="turma"
                    type="text"
                    maxLength={120}
                    value={turma}
                    onChange={(e) => setTurma(e.target.value)}
                    placeholder="Ex.: 2º ano B"
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="turno" rotulo="Turno">
                  <Selecao id="turno" valor={turno} aoMudar={setTurno} opcoes={TURNOS} />
                </Campo>
              </Secao>

              <Secao titulo="Quem está preenchendo">
                <Campo
                  id="por-nome"
                  rotulo="Seu nome"
                  obrigatorio
                  erro={campoComErro === 'porNome' ? erro : undefined}
                >
                  {/* `autocomplete` nos campos que são dados DO RESPONSÁVEL: é
                      ele preenchendo sobre si mesmo, no teclado do celular, e o
                      preenchimento automático poupa exatamente a digitação que
                      custa envios. Os campos da escola não levam token porque
                      não são dados pessoais de quem preenche — `organization`
                      faria o navegador sugerir o empregador do responsável. */}
                  <input
                    id="por-nome"
                    ref={refPorNome}
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={120}
                    value={porNome}
                    onChange={(e) => setPorNome(e.target.value)}
                    aria-invalid={campoComErro === 'porNome'}
                    aria-describedby={campoComErro === 'porNome' ? 'erro-envio' : undefined}
                    className={ENTRADA}
                    style={ESTILO_ENTRADA}
                  />
                </Campo>

                <Campo id="por-parentesco" rotulo="Parentesco com o paciente">
                  <Selecao
                    id="por-parentesco"
                    valor={porParentesco}
                    aoMudar={setPorParentesco}
                    opcoes={PARENTESCOS}
                  />
                </Campo>

                <Campo id="por-telefone" rotulo="Seu telefone (WhatsApp)">
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

              {/* "Enviando..." no rótulo do botão é uma mudança de texto DENTRO
                  de um controle, que os leitores de tela não anunciam de forma
                  confiável — e o envio é justamente a espera em que se quer
                  saber se algo está acontecendo. Esta região existe só para
                  dizer isso em voz alta. */}
              <p className="sr-only" role="status" aria-live="polite">
                {enviando ? 'Enviando informações. Aguarde.' : ''}
              </p>

              {erro && (
                <div
                  id="erro-envio"
                  role="alert"
                  className="text-sm px-4 py-3 rounded-2xl"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
                >
                  {erro}
                </div>
              )}

              <button
                type="submit"
                disabled={enviando}
                className="w-full font-bold text-white transition-all duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:ring-offset-2 disabled:opacity-70 bg-[#1a3275] hover:bg-[#152a68] active:bg-[#111f52] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
                style={{ height: '56px', borderRadius: '16px', fontSize: '16px' }}
              >
                {enviando ? 'Enviando...' : 'Enviar informações'}
              </button>
            </form>
          )}
        </div>

        <p
          className="text-[13px] leading-snug text-center mt-6 px-4"
          style={{ color: 'rgba(255,255,255,0.85)' }}
        >
          As informações são usadas apenas pela equipe terapêutica da clínica.
        </p>
      </div>
    </main>
  )
}

// ===== Peças da tela =====
// Locais de propósito: components/ui/form.tsx é um stub vazio e o resto do
// projeto monta markup Tailwind à mão. Extrair para components/ só quando
// existir uma segunda tela pública precisando do mesmo.

// A borda vive nas classes, NÃO no objeto de estilo. Estilo inline vence
// qualquer regra de folha de estilo, então um `border` ali fazia
// `focus:border-*` nunca aplicar — enquanto `focus:outline-none` aplicava. O
// resultado era focar um campo e ficar sem indicador nenhum: o anel nativo saía
// e nada entrava no lugar.
//
// O anel steel é o tratamento de foco do sistema (DESIGN.md §5), e é o mesmo que
// os botões desta tela já usavam — agora os treze controles combinam.
const ENTRADA =
  'w-full rounded-2xl px-4 py-3.5 text-[16px] border-[1.5px] border-transparent ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4fc4] focus-visible:border-[#1a4fc4] ' +
  'aria-[invalid=true]:border-[#b91c1c] placeholder:text-slate-600'

const ESTILO_ENTRADA: React.CSSProperties = {
  background: '#eef3fc',
  color: '#1e293b',
}

/**
 * `<select>` com a seta do sistema trocada pela do resto da tela.
 *
 * Sem o `appearance-none` os dois dropdowns ficavam com o controle nativo do
 * SO ao lado de dez campos de aparência própria — mesma altura e mesmo fundo,
 * mas visivelmente de outra família. A seta é decorativa (`aria-hidden`): quem
 * usa leitor de tela já recebe "caixa de combinação" do próprio elemento.
 *
 * `pr-11` abre espaço para a seta não encostar no texto da opção mais longa.
 */
function Selecao({
  id,
  valor,
  aoMudar,
  opcoes,
}: {
  id: string
  valor: string
  aoMudar: (valor: string) => void
  opcoes: readonly string[]
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className={`${ENTRADA} appearance-none pr-11`}
        style={ESTILO_ENTRADA}
      >
        <option value="">Selecione</option>
        {opcoes.map((opcao) => (
          <option key={opcao} value={opcao}>{opcao}</option>
        ))}
      </select>
      <ChevronDown
        size={18}
        strokeWidth={2}
        className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: '#475569' }}
        aria-hidden="true"
      />
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      {/* O <legend> é o único lugar da tela que ainda usa a caixa alta espaçada,
          e aqui ela é estrutural: separa as três seções do formulário dos treze
          rótulos de campo. Nos rótulos a mesma fórmula era ruído — caixa alta a
          11px tira a forma da palavra, que é a pista de leitura mais útil
          justamente para quem preenche isto uma vez na vida. */}
      <legend
        className="text-[12px] font-bold uppercase tracking-wider pb-1"
        style={{ color: '#1a4fc4' }}
      >
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
  dica,
  erro,
  children,
}: {
  id: string
  rotulo: string
  obrigatorio?: boolean
  dica?: string
  /** Recado do servidor sobre ESTE campo, repetido junto dele. */
  erro?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-semibold mb-2"
        style={{ color: '#475569' }}
      >
        {rotulo}
        {/* O asterisco é decorativo: quem usa leitor de tela recebe a
            obrigatoriedade pelo `required` do próprio controle. Lido em voz alta
            ele viraria "nome da escola asterisco". */}
        {obrigatorio && <span style={{ color: '#b91c1c' }} aria-hidden="true"> *</span>}
      </label>
      {children}
      {/* O recado do servidor aparece DUAS vezes de propósito: aqui, colado no
          campo para onde o foco acabou de ir, e no alerta ao pé do formulário.
          Sem esta cópia, quem erra a data é levado ao topo enquanto a
          explicação fica centenas de pixels abaixo, fora da tela. O `aria-hidden`
          evita a leitura em dobro — o alerta com role="alert" já anuncia, e é
          para ele que o aria-describedby do campo aponta. */}
      {erro ? (
        <p className="text-[13px] mt-1.5 font-medium" style={{ color: '#b91c1c' }} aria-hidden="true">
          {erro}
        </p>
      ) : (
        dica && (
          <p id={`${id}-dica`} className="text-[13px] mt-1.5" style={{ color: '#64748b' }}>
            {dica}
          </p>
        )
      )}
    </div>
  )
}
