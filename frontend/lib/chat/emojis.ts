// ============================================================================
// Emojis do Chat da equipe, com palavras de busca em português.
//
// Lista própria, e não um pacote: os seletores prontos baixam o catálogo de um
// CDN (o CSP do Pulsar barra) ou trazem ~1 MB de dados com busca em inglês —
// ninguém aqui procura "thumbs up". São os que se usam numa clínica conversando
// em equipe, não o Unicode inteiro.
// ============================================================================

export interface CategoriaEmoji {
  id:     string
  rotulo: string
  emojis: [emoji: string, busca: string][]
}

export const CATEGORIAS_EMOJI: CategoriaEmoji[] = [
  {
    id: 'rostos',
    rotulo: 'Rostos',
    emojis: [
      ['😀', 'sorriso feliz'], ['😃', 'sorriso feliz alegre'], ['😄', 'sorriso feliz rindo'],
      ['😁', 'sorriso dentes'], ['😆', 'rindo muito'], ['😅', 'suor alivio ufa nervoso'],
      ['🤣', 'rolando de rir gargalhada'], ['😂', 'chorando de rir kkk'], ['🙂', 'sorriso leve'],
      ['🙃', 'de cabeca para baixo ironia'], ['😉', 'piscadinha'], ['😊', 'sorriso timido corado'],
      ['😇', 'anjo inocente'], ['🥰', 'apaixonado coracoes'], ['😍', 'olhos de coracao amei'],
      ['🤩', 'estrelas deslumbrado'], ['😘', 'beijo'], ['😋', 'gostoso delicia'],
      ['😛', 'lingua'], ['😜', 'lingua piscando brincadeira'], ['🤪', 'maluco doido'],
      ['🤗', 'abraco'], ['🤭', 'ops mao na boca'], ['🤫', 'silencio segredo'],
      ['🤔', 'pensando duvida hmm'], ['🫡', 'continencia sim senhor entendido'], ['🤐', 'boca fechada ziper'],
      ['🤨', 'desconfiado sobrancelha'], ['😐', 'neutro sem expressao'], ['😑', 'sem expressao'],
      ['😶', 'sem boca mudo'], ['🫥', 'invisivel'], ['😏', 'sorriso de lado'],
      ['😒', 'entediado desgosto'], ['🙄', 'revirando os olhos'], ['😬', 'careta constrangido'],
      ['😮‍💨', 'suspiro exausto alivio'], ['🤥', 'mentira'], ['😌', 'aliviado tranquilo'],
      ['😔', 'pensativo triste'], ['😪', 'sono'], ['😴', 'dormindo zzz'],
      ['😷', 'mascara doente'], ['🤒', 'febre termometro doente'], ['🤕', 'machucado curativo'],
      ['🤢', 'enjoo nausea'], ['🤧', 'espirro gripe resfriado'], ['🥵', 'calor quente'],
      ['🥶', 'frio gelado'], ['🥴', 'tonto zonzo'], ['😵', 'atordoado'],
      ['🤯', 'cabeca explodindo chocado'], ['🥳', 'festa comemoracao aniversario'], ['😎', 'oculos escuros legal'],
      ['🤓', 'nerd estudioso'], ['🧐', 'monoculo analisando'], ['😕', 'confuso'],
      ['😟', 'preocupado'], ['🙁', 'triste'], ['😮', 'surpreso uau'],
      ['😯', 'espantado'], ['😲', 'chocado'], ['😳', 'envergonhado corado'],
      ['🥺', 'pidao por favor'], ['🥹', 'emocionado segurando choro'], ['😢', 'chorando lagrima'],
      ['😭', 'chorando muito'], ['😱', 'grito medo'], ['😖', 'confuso frustrado'],
      ['😣', 'perseverante'], ['😞', 'desapontado'], ['😓', 'suor frio'],
      ['😩', 'cansado exausto'], ['😫', 'muito cansado'], ['🥱', 'bocejo sono'],
      ['😤', 'bufando bravo'], ['😡', 'raiva bravo'], ['😠', 'irritado'],
      ['🤬', 'xingando palavrao'], ['😈', 'diabinho'], ['💀', 'caveira morri'],
      ['💩', 'coco'], ['🤡', 'palhaco'], ['👻', 'fantasma'],
      ['🤖', 'robo'], ['😺', 'gato sorrindo'], ['🙈', 'macaco nao vejo vergonha'],
      ['🙉', 'macaco nao ouco'], ['🙊', 'macaco nao falo'],
    ],
  },
  {
    id: 'gestos',
    rotulo: 'Gestos e pessoas',
    emojis: [
      ['👍', 'joinha positivo ok curti like'], ['👎', 'negativo nao gostei'], ['👌', 'ok perfeito'],
      ['🤌', 'italiano'], ['✌️', 'paz vitoria'], ['🤞', 'dedos cruzados sorte'],
      ['🤟', 'te amo'], ['🤘', 'rock'], ['🤙', 'me liga hang loose'],
      ['👈', 'esquerda apontando'], ['👉', 'direita apontando'], ['👆', 'acima apontando'],
      ['👇', 'abaixo apontando'], ['☝️', 'indicador atencao'], ['✋', 'mao levantada pare'],
      ['🤚', 'mao'], ['🖐️', 'mao aberta'], ['🖖', 'vulcano'],
      ['👋', 'tchau oi aceno ola'], ['👏', 'palmas parabens aplausos'], ['🙌', 'maos para cima celebrar'],
      ['🫶', 'coracao com as maos carinho'], ['👐', 'maos abertas'], ['🤲', 'maos juntas'],
      ['🤝', 'aperto de mao acordo combinado'], ['🙏', 'por favor obrigado gratidao reza'], ['✍️', 'escrevendo'],
      ['💪', 'forca musculo'], ['🧠', 'cerebro inteligente'], ['👀', 'olhos vendo olhando'],
      ['👁️', 'olho'], ['👂', 'orelha ouvir'], ['👃', 'nariz'],
      ['👄', 'boca'], ['🦷', 'dente'], ['👶', 'bebe'],
      ['🧒', 'crianca'], ['👦', 'menino'], ['👧', 'menina'],
      ['🧑', 'pessoa'], ['👨', 'homem'], ['👩', 'mulher'],
      ['🧓', 'idoso'], ['👨‍⚕️', 'medico profissional de saude'], ['👩‍⚕️', 'medica profissional de saude'],
      ['🧑‍🏫', 'professor terapeuta'], ['👩‍💻', 'mulher no computador'], ['👨‍💻', 'homem no computador'],
      ['🙋', 'pessoa levantando a mao eu'], ['🙋‍♀️', 'mulher levantando a mao'], ['🙋‍♂️', 'homem levantando a mao'],
      ['🤷', 'nao sei sei la'], ['🤷‍♀️', 'mulher nao sei'], ['🤷‍♂️', 'homem nao sei'],
      ['🤦', 'facepalm ai ai'], ['🤦‍♀️', 'mulher facepalm'], ['🤦‍♂️', 'homem facepalm'],
      ['🙆', 'tudo bem ok'], ['🙅', 'nao proibido'], ['💁', 'informacao'],
      ['🏃', 'correndo pressa'], ['🚶', 'andando'], ['🧘', 'meditando calma'],
      ['👪', 'familia'], ['🧑‍🤝‍🧑', 'pessoas de maos dadas'], ['💃', 'dancando'],
    ],
  },
  {
    id: 'simbolos',
    rotulo: 'Corações e símbolos',
    emojis: [
      ['❤️', 'coracao vermelho amor'], ['🧡', 'coracao laranja'], ['💛', 'coracao amarelo'],
      ['💚', 'coracao verde'], ['💙', 'coracao azul'], ['💜', 'coracao roxo'],
      ['🖤', 'coracao preto'], ['🤍', 'coracao branco'], ['🤎', 'coracao marrom'],
      ['💔', 'coracao partido'], ['❤️‍🩹', 'coracao curando'], ['💕', 'dois coracoes'],
      ['💖', 'coracao brilhante'], ['💗', 'coracao crescendo'], ['💝', 'coracao presente'],
      ['✅', 'feito check concluido ok certo'], ['☑️', 'marcado caixa'], ['✔️', 'certo check'],
      ['❌', 'errado x nao cancelado'], ['❎', 'x quadrado'], ['⭕', 'circulo'],
      ['⚠️', 'atencao alerta cuidado aviso'], ['🚫', 'proibido nao pode'], ['⛔', 'entrada proibida pare'],
      ['❗', 'exclamacao importante'], ['❓', 'interrogacao pergunta duvida'], ['‼️', 'dupla exclamacao'],
      ['⁉️', 'exclamacao interrogacao'], ['💯', 'cem perfeito'], ['🔥', 'fogo top urgente'],
      ['✨', 'brilho novo'], ['⭐', 'estrela'], ['🌟', 'estrela brilhante'],
      ['⚡', 'raio rapido'], ['💥', 'explosao'], ['💤', 'sono zzz'],
      ['💬', 'balao fala mensagem'], ['💭', 'pensamento'], ['🗨️', 'balao de fala'],
      ['🔴', 'circulo vermelho'], ['🟠', 'circulo laranja'], ['🟡', 'circulo amarelo'],
      ['🟢', 'circulo verde'], ['🔵', 'circulo azul'], ['🟣', 'circulo roxo'],
      ['⚪', 'circulo branco'], ['⚫', 'circulo preto'], ['🔺', 'triangulo vermelho'],
      ['➕', 'mais soma'], ['➖', 'menos'], ['➡️', 'seta direita'],
      ['⬅️', 'seta esquerda'], ['⬆️', 'seta para cima'], ['⬇️', 'seta para baixo'],
      ['🔄', 'atualizar repetir'], ['🔁', 'repetir'], ['🆗', 'ok'],
      ['🆕', 'novo'], ['🆘', 'socorro sos ajuda'], ['🔔', 'sino notificacao'],
      ['🔕', 'sem som silencio'], ['📣', 'megafone aviso'], ['📢', 'alto falante anuncio'],
      ['♻️', 'reciclar'], ['♿', 'cadeirante acessibilidade'], ['🏳️‍🌈', 'bandeira arco iris'],
      ['🇧🇷', 'brasil bandeira'],
    ],
  },
  {
    id: 'trabalho',
    rotulo: 'Trabalho e objetos',
    emojis: [
      ['📅', 'calendario data agenda'], ['🗓️', 'calendario espiral agenda'], ['📆', 'calendario dia'],
      ['⏰', 'despertador horario'], ['⏱️', 'cronometro'], ['⏳', 'ampulheta aguardando'],
      ['⌛', 'ampulheta tempo esgotado'], ['🕐', 'relogio uma hora'], ['📞', 'telefone ligacao'],
      ['☎️', 'telefone fixo'], ['📱', 'celular'], ['💻', 'notebook computador'],
      ['🖥️', 'computador monitor'], ['🖨️', 'impressora imprimir'], ['⌨️', 'teclado'],
      ['🖱️', 'mouse'], ['📧', 'email'], ['📨', 'email chegando'],
      ['📩', 'envelope seta'], ['✉️', 'envelope carta'], ['📎', 'clipe anexo'],
      ['🖇️', 'clipes'], ['📌', 'alfinete fixado'], ['📍', 'local alfinete'],
      ['✂️', 'tesoura'], ['🖊️', 'caneta'], ['✏️', 'lapis editar'],
      ['📝', 'anotacao memo nota'], ['📋', 'prancheta lista'], ['📄', 'documento pagina'],
      ['📃', 'pagina enrolada'], ['📑', 'abas marcadores'], ['📊', 'grafico barras relatorio'],
      ['📈', 'grafico subindo crescimento'], ['📉', 'grafico caindo queda'], ['🗂️', 'divisorias pastas'],
      ['📁', 'pasta'], ['📂', 'pasta aberta'], ['🗃️', 'arquivo caixa'],
      ['🗄️', 'arquivo gaveta'], ['🗑️', 'lixeira lixo'], ['🔒', 'cadeado fechado seguro'],
      ['🔓', 'cadeado aberto'], ['🔑', 'chave senha'], ['🔍', 'lupa buscar procurar'],
      ['💡', 'ideia lampada'], ['🔧', 'chave inglesa conserto'], ['🛠️', 'ferramentas'],
      ['⚙️', 'engrenagem configuracao'], ['🔗', 'link corrente'], ['🧾', 'recibo nota fiscal'],
      ['💰', 'dinheiro saco'], ['💵', 'dinheiro nota'], ['💳', 'cartao credito'],
      ['🏥', 'hospital clinica'], ['🩺', 'estetoscopio medico consulta'], ['💊', 'remedio comprimido'],
      ['💉', 'seringa vacina injecao'], ['🩹', 'curativo band aid'], ['🌡️', 'termometro temperatura'],
      ['🧩', 'quebra cabeca peca autismo'], ['🧸', 'ursinho brinquedo'], ['🎨', 'pintura arte'],
      ['📚', 'livros estudo'], ['📖', 'livro aberto'], ['🎓', 'formatura capelo'],
      ['🚗', 'carro'], ['🚌', 'onibus'], ['🏠', 'casa'],
      ['🏢', 'predio escritorio'], ['🚪', 'porta'], ['🪑', 'cadeira'],
      ['🎁', 'presente'], ['🎈', 'balao festa'], ['🎉', 'confete parabens festa'],
      ['🎊', 'confete bola'], ['🏆', 'trofeu vitoria'], ['🥇', 'medalha ouro primeiro'],
      ['🎯', 'alvo meta objetivo'], ['🚀', 'foguete lancamento'], ['📸', 'camera foto'],
    ],
  },
  {
    id: 'natureza',
    rotulo: 'Natureza',
    emojis: [
      ['☀️', 'sol dia'], ['🌤️', 'sol com nuvem'], ['⛅', 'nublado'],
      ['🌧️', 'chuva'], ['⛈️', 'tempestade'], ['🌈', 'arco iris'],
      ['❄️', 'floco de neve frio'], ['🌙', 'lua noite'], ['🌊', 'onda mar'],
      ['🌱', 'broto planta crescer'], ['🌿', 'erva folha'], ['🍀', 'trevo sorte'],
      ['🌸', 'flor cerejeira'], ['🌻', 'girassol'], ['🌹', 'rosa'],
      ['🌷', 'tulipa'], ['💐', 'buque flores'], ['🌳', 'arvore'],
      ['🐶', 'cachorro'], ['🐱', 'gato'], ['🐭', 'rato'],
      ['🐰', 'coelho'], ['🦊', 'raposa'], ['🐻', 'urso'],
      ['🐼', 'panda'], ['🐨', 'coala'], ['🦁', 'leao'],
      ['🐮', 'vaca'], ['🐷', 'porco'], ['🐸', 'sapo'],
      ['🐵', 'macaco'], ['🐔', 'galinha'], ['🐧', 'pinguim'],
      ['🦋', 'borboleta'], ['🐝', 'abelha'], ['🐢', 'tartaruga devagar'],
      ['🐬', 'golfinho'], ['🐳', 'baleia'], ['🦄', 'unicornio'],
    ],
  },
  {
    id: 'comida',
    rotulo: 'Comida',
    emojis: [
      ['☕', 'cafe'], ['🍵', 'cha'], ['🧃', 'suco caixinha'],
      ['🥤', 'refrigerante copo'], ['🍺', 'cerveja'], ['🥂', 'brinde'],
      ['🍕', 'pizza'], ['🍔', 'hamburguer'], ['🍟', 'batata frita'],
      ['🌭', 'cachorro quente'], ['🥪', 'sanduiche'], ['🌮', 'taco'],
      ['🍝', 'macarrao'], ['🍚', 'arroz'], ['🍲', 'sopa panela'],
      ['🥗', 'salada'], ['🍳', 'ovo frigideira'], ['🥞', 'panqueca'],
      ['🍞', 'pao'], ['🧀', 'queijo'], ['🍗', 'frango'],
      ['🍎', 'maca'], ['🍌', 'banana'], ['🍉', 'melancia'],
      ['🍇', 'uva'], ['🍓', 'morango'], ['🍍', 'abacaxi'],
      ['🥑', 'abacate'], ['🍰', 'bolo fatia'], ['🎂', 'bolo aniversario'],
      ['🧁', 'cupcake'], ['🍫', 'chocolate'], ['🍬', 'bala doce'],
      ['🍭', 'pirulito'], ['🍩', 'rosquinha donut'], ['🍪', 'biscoito cookie'],
      ['🍿', 'pipoca'], ['🍦', 'sorvete'],
    ],
  },
]

/** As reações de um toque, na barra que aparece sobre a mensagem. */
export const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const TODOS = CATEGORIAS_EMOJI.flatMap(c => c.emojis)

export function buscarEmojis(termo: string): string[] {
  const t = normalizar(termo.trim())
  if (!t) return []
  const partes = t.split(/\s+/)
  return TODOS.filter(([, busca]) => partes.every(p => busca.split(' ').some(palavra => palavra.startsWith(p))))
    .map(([e]) => e)
}

// ── Recentes (por navegador; some se o armazenamento estiver bloqueado) ─────
const CHAVE_RECENTES = 'pulsar:chat:emojis-recentes'
const MAX_RECENTES = 24

export function lerRecentes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? '[]')
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(0, MAX_RECENTES) : []
  } catch {
    return []
  }
}

export function guardarRecente(emoji: string): void {
  try {
    const lista = [emoji, ...lerRecentes().filter(e => e !== emoji)].slice(0, MAX_RECENTES)
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista))
  } catch { /* sem armazenamento: só não lembra */ }
}
