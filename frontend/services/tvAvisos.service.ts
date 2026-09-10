import { getSupabaseClient } from "@/lib/supabase/client"

// Avisos do carrossel da TV da recepção — ver
// supabase/migrations/20260831150000_tv_avisos.sql.
//
// Bucket PÚBLICO em leitura, ao contrário de `pacientes-fotos`: o conteúdo é
// cartaz de parede e a TV roda sem conta. Consequência prática: `getPublicUrl`
// funciona e não expira, então não há cache de URL assinada para manter aqui.
// A escrita continua exigindo a permissão `tv_avisos`.

export const BUCKET_AVISOS = "tv-avisos"

export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024
export const MIMES_ACEITOS = ["image/jpeg", "image/png", "image/webp"]

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export type AvisoTVRegistro = {
  id: string
  caminho: string
  titulo: string | null
  ordem: number
  ativo: boolean
  /**
   * Instante da PRIMEIRA ida ao ar; `null` significa que nunca esteve.
   *
   * É o que separa rascunho de aposentado — no resto do schema os dois são
   * `ativo = false` e indistinguíveis. Antes isto era um Set em memória na tela
   * de gestão, o que fazia a distinção evaporar no F5 justamente quando ela
   * mais importa (semanas depois, quando ninguém lembra do que já foi parede).
   * Ver 20260910190000_tv_avisos_publicado_em.sql.
   *
   * Linhas inativas anteriores ao backfill ficaram `null` de propósito: não há
   * como saber retroativamente se foram publicadas. Elas se corrigem sozinhas
   * na próxima publicação.
   */
  publicadoEm: string | null
  /** derivada do caminho na leitura; o banco guarda o path, nunca a URL */
  url: string
}

/**
 * Erro em duas camadas: o que a pessoa faz, e o que a tecnologia precisa saber.
 *
 * Quem usa esta tela é do marketing ou da recepção. "Aplique as migrations
 * 20260831150000 e 20260831150100" é acionável para quem mantém o banco e
 * assustador para quem só queria publicar um cartaz — parece que ela quebrou
 * alguma coisa. Mas apagar o detalhe técnico só transfere o problema: a pessoa
 * chamada para resolver chegaria sem a informação que resolve.
 *
 * Então os dois viajam juntos. A tela mostra `mensagem` em destaque e `detalhe`
 * em letra miúda embaixo, para ser lido em voz alta no chamado.
 *
 * PGRST205 é o caso mais provável (migration não aplicada); a mensagem crua
 * ("Could not find the table in the schema cache") manda procurar bug no
 * frontend. 42501 é a RLS recusando — aqui significa permissão faltando, não
 * erro de código.
 */
export type ErroAviso = { mensagem: string; detalhe: string | null }

/**
 * A forma de duas camadas só é usada por `listarAvisos`, cujo erro vira um
 * painel PERMANENTE na tela e portanto tem espaço para as duas linhas. As
 * escritas seguem devolvendo texto puro: elas aparecem em toast, que some em
 * segundos e não é lugar de código de erro.
 */
function descreverErroDetalhado(error: {
  code?: string
  message: string
}): ErroAviso {
  if (error.code === "PGRST205") {
    return {
      mensagem:
        "Os avisos da TV ainda não foram liberados neste ambiente. Peça à tecnologia para concluir a instalação.",
      detalhe:
        "Tabela tv_avisos ausente (PGRST205). Aplicar as migrations 20260831150000 e 20260831150100.",
    }
  }
  if (error.code === "42501") {
    return {
      mensagem:
        "Você não tem permissão para gerenciar os avisos da TV. Peça acesso à tecnologia.",
      detalhe: "RLS recusou a operação (42501). Falta a permissão tv_avisos.",
    }
  }
  return { mensagem: error.message, detalhe: error.code ?? null }
}

/** Versão de uma linha, para toast. Mesma tradução, sem o detalhe técnico. */
function descreverErro(error: { code?: string; message: string }): string {
  return descreverErroDetalhado(error).mensagem
}

/** Mesma validação que o bucket faz, mas antes de gastar o upload. */
export function validarArquivoAviso(file: File): string | null {
  if (!MIMES_ACEITOS.includes(file.type)) {
    return "Formato não aceito. Use JPEG, PNG ou WebP."
  }
  if (file.size > TAMANHO_MAXIMO_BYTES) {
    return "A imagem passa de 10 MB. Escolha um arquivo menor."
  }
  return null
}

function urlPublica(caminho: string): string {
  const supabase = getSupabaseClient()
  return supabase.storage.from(BUCKET_AVISOS).getPublicUrl(caminho).data.publicUrl
}

/**
 * Lista todos os avisos, ativos e inativos — a tela de gestão precisa dos dois.
 *
 * A ordenação repete a de /api/tv/avisos (ordem, depois criado_em) de propósito:
 * a lista da gestão é a mesma sequência que vai ao ar, e divergir aqui faria a
 * prévia mostrar uma ordem que a TV não usa.
 */
export async function listarAvisos(): Promise<{
  avisos: AvisoTVRegistro[]
  error: ErroAviso | null
}> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from("tv_avisos")
    .select("id, caminho, titulo, ordem, ativo, publicado_em")
    .order("ordem", { ascending: true })
    .order("criado_em", { ascending: true })

  if (error) {
    // Campo a campo, e não o objeto: `PostgrestError` não é um Error de
    // verdade e o console do Next o imprime como `{}` — o log dizia
    // "Erro ao listar avisos da TV: {}" e escondia justamente a causa
    // (PGRST205, tabela ausente porque a migration não foi aplicada).
    console.error(
      `Erro ao listar avisos da TV [${error.code}]: ${error.message}`,
      error.hint ?? ""
    )
    return { avisos: [], error: descreverErroDetalhado(error) }
  }

  const avisos = (data ?? []).map((a) => ({
    id: a.id as string,
    caminho: a.caminho as string,
    titulo: (a.titulo as string | null) ?? null,
    ordem: a.ordem as number,
    ativo: a.ativo as boolean,
    publicadoEm: (a.publicado_em as string | null) ?? null,
    url: urlPublica(a.caminho as string),
  }))

  return { avisos, error: null }
}

/**
 * Envia a imagem e cria a linha, já no fim da fila — como RASCUNHO.
 *
 * `ativo: false` explícito, contra o default `true` da tabela: publicar é um ato
 * separado de enviar. Antes, escolher o arquivo já colocava o cartaz na parede da
 * recepção em até 5 min (o poll da TV), sem ninguém confirmar — e um arquivo
 * errado no seletor virava um erro visível para todas as famílias na sala de
 * espera. Quem publica agora confere na prévia e clica em "Publicar na TV".
 *
 * O nome do arquivo é um uuid, não o nome escolhido pelo marketing: nome de
 * arquivo aparece em log de CDN e na URL, e um "campanha-demissao-fulano.png"
 * viraria informação pública. O `titulo` cobre a necessidade de se localizar na
 * lista, e ele nunca sai do banco.
 */
export async function criarAviso(
  file: File,
  titulo: string
): Promise<{ error: string | null }> {
  const problema = validarArquivoAviso(file)
  if (problema) return { error: problema }

  const supabase = getSupabaseClient()
  const extensao = EXTENSAO_POR_MIME[file.type] ?? "jpg"
  const caminho = `${crypto.randomUUID()}.${extensao}`

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_AVISOS)
    .upload(caminho, file, { upsert: false, contentType: file.type })

  if (erroUpload) {
    console.error(`Erro ao enviar aviso da TV: ${erroUpload.message}`)
    return { error: erroUpload.message }
  }

  // Fim da fila. Ler o maior `ordem` e somar 1 tem corrida teórica (dois uploads
  // simultâneos empatam), mas o desempate por `criado_em` na leitura resolve —
  // é exatamente por isso que a ordenação é por (ordem, criado_em) nos dois
  // lados. Empate não embaralha nada.
  const { data: ultimo } = await supabase
    .from("tv_avisos")
    .select("ordem")
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle()

  const proximaOrdem = ((ultimo?.ordem as number | undefined) ?? -1) + 1

  const { error: erroInsert } = await supabase
    .from("tv_avisos")
    .insert({
      caminho,
      titulo: titulo.trim() || null,
      ordem: proximaOrdem,
      ativo: false,
    })

  if (erroInsert) {
    console.error(
      `Erro ao registrar aviso da TV [${erroInsert.code}]: ${erroInsert.message}`
    )

    // O objeto já subiu; sem a linha ele é órfão invisível. Limpar aqui evita
    // acumular lixo no bucket a cada falha de RLS.
    await supabase.storage.from(BUCKET_AVISOS).remove([caminho])

    return { error: descreverErro(erroInsert) }
  }

  return { error: null }
}

/**
 * Põe no ar todos os rascunhos de uma vez — o "Publicar na TV".
 *
 * Recebe os ids em vez de fazer `update ... where ativo = false`: o que vai ao ar
 * tem de ser exatamente o que a pessoa viu marcado na tela. Um rascunho que outra
 * pessoa subiu enquanto esta conferia a lista não pode pegar carona num clique
 * que não o incluía.
 */
export async function publicarAvisos(
  ids: string[]
): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null }

  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from("tv_avisos")
    .update({ ativo: true })
    .in("id", ids)

  if (error) {
    console.error(
      `Erro ao publicar avisos da TV [${error.code}]: ${error.message}`
    )
    return { error: descreverErro(error) }
  }
  return { error: null }
}

/**
 * Liga ou desliga um aviso.
 *
 * `limparEstreia` existe só para o desfazer de uma publicação: o trigger carimba
 * `publicado_em` na subida ao ar, e desfazer precisa devolver o estado anterior
 * ao clique — inclusive o "nunca esteve no ar" de quem estreou naquele momento.
 * Sem isso, desfazer deixaria o cartaz fora do ar mas já aposentado, e ele
 * sumiria da fila de publicação sem nunca ter chegado à TV.
 *
 * Só quem estreou no clique desfeito passa a opção. Um cartaz que já era
 * aposentado e voltou ao ar mantém a data de estreia: ela continua verdadeira.
 */
export async function definirAtivo(
  id: string,
  ativo: boolean,
  opcoes: { limparEstreia?: boolean } = {}
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from("tv_avisos")
    .update(
      opcoes.limparEstreia ? { ativo, publicado_em: null } : { ativo }
    )
    .eq("id", id)

  if (error) {
    console.error(
      `Erro ao ligar/desligar aviso da TV [${error.code}]: ${error.message}`
    )
    return { error: descreverErro(error) }
  }
  return { error: null }
}

/**
 * Grava a sequência inteira, na ordem em que a lista chega.
 *
 * Reescrever tudo em vez de trocar dois vizinhos: as setas da UI produzem uma
 * lista nova, e persistir só o par movido deixaria os `ordem` do resto
 * desalinhados com o que está na tela.
 */
export async function salvarOrdem(
  idsNaOrdem: string[]
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const resultados = await Promise.all(
    idsNaOrdem.map((id, i) =>
      supabase.from("tv_avisos").update({ ordem: i }).eq("id", id)
    )
  )

  const falhou = resultados.find((r) => r.error)
  if (falhou?.error) {
    console.error(
      `Erro ao salvar a ordem dos avisos da TV [${falhou.error.code}]: ${falhou.error.message}`
    )
    return { error: descreverErro(falhou.error) }
  }

  return { error: null }
}

/**
 * Apaga a linha. O objeto NÃO é apagado aqui — ver abaixo.
 *
 * Antes esta função removia o objeto do bucket logo depois da linha. Isso
 * fechava a porta para o desfazer: a linha se recria de graça, mas os bytes,
 * uma vez apagados, só voltam se a pessoa ainda tiver o arquivo no computador —
 * e quem clica em "Remover" por engano normalmente não tem.
 *
 * A ordem antiga também estava certa pelo motivo dela (linha primeiro, porque
 * uma linha apontando para objeto apagado deixa um quadrado quebrado na TV).
 * Isso continua valendo; o que mudou é que o objeto simplesmente não é apagado
 * junto. Um órfão no bucket é invisível e inofensivo — um cartaz que a pessoa
 * não consegue recuperar, não.
 *
 * A limpeza definitiva é `descartarArquivoAviso`, chamada quando a janela de
 * desfazer expira. Se a aba morrer no meio dessa janela, sobra um órfão: é o
 * preço, e é barato.
 */
export async function removerAviso(id: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase.from("tv_avisos").delete().eq("id", id)

  if (error) {
    console.error(
      `Erro ao remover aviso da TV [${error.code}]: ${error.message}`
    )
    return { error: descreverErro(error) }
  }

  return { error: null }
}

/**
 * Recria a linha de um aviso removido, apontando para o objeto que ficou no
 * bucket. É o desfazer.
 *
 * `ativo` e `ordem` voltam como estavam: desfazer tem de devolver o estado
 * exato, não uma aproximação. Um cartaz que estava no ar e volta como rascunho
 * obrigaria a pessoa a publicar de novo — e ela não pediu para tirar do ar,
 * pediu para desfazer.
 *
 * O `id` NÃO é reaproveitado (o banco gera um novo). Nada aqui referencia aviso
 * por id fora desta tela, então recriar com id novo é indistinguível para a TV,
 * que só lê caminho e ordem.
 *
 * `publicadoEm` viaja junto pela mesma razão de `ativo` e `ordem`: sem ele, um
 * cartaz aposentado voltaria do desfazer se declarando "Nunca publicada" e
 * reapareceria na fila de publicação que ele já tinha deixado. O trigger não
 * repõe o valor sozinho — ele só carimba na transição para o ar, e restaurar um
 * aposentado é um insert com `ativo = false`.
 */
export async function restaurarAviso(aviso: {
  caminho: string
  titulo: string | null
  ordem: number
  ativo: boolean
  publicadoEm: string | null
}): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase.from("tv_avisos").insert({
    caminho: aviso.caminho,
    titulo: aviso.titulo,
    ordem: aviso.ordem,
    ativo: aviso.ativo,
    publicado_em: aviso.publicadoEm,
  })

  if (error) {
    console.error(
      `Erro ao restaurar aviso da TV [${error.code}]: ${error.message}`
    )
    return { error: descreverErro(error) }
  }

  return { error: null }
}

/**
 * Apaga o objeto do bucket. Chamada só quando a janela de desfazer fecha sem
 * ninguém desfazer — a partir daí o arquivo não serve mais a ninguém.
 *
 * Silenciosa de propósito: neste ponto a remoção já aconteceu aos olhos de quem
 * usa a tela, e um erro de storage não tem nenhuma ação associada. Falhar aqui
 * deixa um órfão invisível no bucket, que é exatamente o que já acontecia antes
 * quando este `remove` falhava.
 */
export async function descartarArquivoAviso(caminho: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.storage.from(BUCKET_AVISOS).remove([caminho])
  if (error) {
    console.error(`Erro ao descartar arquivo do aviso da TV: ${error.message}`)
  }
}
