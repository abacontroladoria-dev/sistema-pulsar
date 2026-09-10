"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Monitor,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { CarrosselAvisos } from "@/components/tv/CarrosselAvisos"
import {
  criarAviso,
  definirAtivo,
  listarAvisos,
  publicarAvisos,
  removerAviso,
  salvarOrdem,
  validarArquivoAviso,
  type AvisoTVRegistro,
} from "@/services/tvAvisos.service"

// Gestão do carrossel da TV da recepção.
//
// ─── Enviar não é publicar ──────────────────────────────────────────────────
//
// O upload sobe o objeto na hora (estado pendente criaria órfão a cada
// desistência, mesmo raciocínio do FotoPacienteUpload), mas a linha nasce como
// RASCUNHO — `ativo = false`. Antes, escolher o arquivo bastava para o cartaz
// entrar na parede da recepção em até 5 min, sem ninguém confirmar: um arquivo
// errado no seletor virava erro visível para todas as famílias na sala de espera.
// Agora quem publica confere na prévia e clica em "Publicar na TV".
//
// Ligar/desligar e reordenar continuam IMEDIATOS, de propósito: são ações sobre
// o que já foi conferido uma vez, e tirar do ar um cartaz errado não pode custar
// dois cliques nem depender de lembrar de um segundo botão.
//
// ⚠️ RLS bloqueando WRITE não gera erro visível: a gravação "funciona" e não
// grava. Por isso todo caminho aqui relê do banco depois de escrever, em vez de
// confiar no estado local — se a policy recusou, a lista volta ao que era e o
// usuário vê que não pegou.

export function GestaoAvisosTV() {
  const [avisos, setAvisos] = useState<AvisoTVRegistro[]>([])
  const [carregando, setCarregando] = useState(true)
  // Falha de leitura fica NA TELA, não só num toast que some em 4s: o caso mais
  // provável aqui é a migration não aplicada, e quem abrir a página depois do
  // toast sumir veria uma lista vazia — indistinguível de "nenhum aviso ainda".
  const [falha, setFalha] = useState<string | null>(null)
  // Quantos arquivos faltam neste envio. Número, e não booleano: com seleção
  // múltipla o "1 de 4" é a única forma de a pessoa saber que ainda há coisa
  // subindo, e não que a tela travou.
  const [restantes, setRestantes] = useState(0)
  const [totalEnvio, setTotalEnvio] = useState(0)
  const [publicando, setPublicando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  // Só para o realce da área de soltar. Contador, não booleano: `dragleave`
  // dispara ao passar por cima de cada filho, e um booleano faria a moldura
  // piscar enquanto o arquivo atravessa a lista.
  const [arrastandoSobre, setArrastandoSobre] = useState(0)
  // Prévia mostrando também os rascunhos ("como ficaria se eu publicasse").
  // "Pedido" porque é a intenção da pessoa; o valor efetivo (`verPendentes`,
  // abaixo) ainda depende de haver rascunho.
  const [verPendentesPedido, setVerPendentesPedido] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const enviando = restantes > 0

  const recarregar = useCallback(async () => {
    const { avisos: lista, error } = await listarAvisos()
    // A mensagem do service já vem traduzida (tabela ausente, permissão
    // faltando). Um "não foi possível carregar" genérico aqui mandaria quem lê
    // procurar o problema no lugar errado.
    setFalha(error)
    if (error) toast.error(error)
    setAvisos(lista)
    setCarregando(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via API, sem valor derivável no primeiro render
    recarregar()
  }, [recarregar])

  /**
   * Envia um lote (do seletor ou do arrastar-e-soltar).
   *
   * Em SÉRIE, não em Promise.all: `criarAviso` lê o maior `ordem` para se pôr no
   * fim da fila, e em paralelo os quatro leriam o mesmo valor e empatariam. O
   * empate não quebra nada (a ordenação desempata por `criado_em`), mas a fila
   * sairia numa ordem que não é a que a pessoa escolheu no seletor.
   *
   * Um arquivo inválido no meio não aborta o resto: quem arrasta a pasta inteira
   * com um PDF dentro quer as imagens publicadas e um aviso sobre o PDF, não
   * quatro envios cancelados.
   */
  async function enviarLote(files: File[]) {
    if (files.length === 0) return

    const validos: File[] = []
    const recusados: string[] = []
    for (const file of files) {
      const problema = validarArquivoAviso(file)
      if (problema) recusados.push(`${file.name}: ${problema}`)
      else validos.push(file)
    }

    // Um a um, com o nome do arquivo: "Formato não aceito" sozinho não diz qual
    // dos quatro arquivos foi recusado.
    for (const aviso of recusados) toast.error(aviso)
    if (validos.length === 0) return

    setTotalEnvio(validos.length)
    setRestantes(validos.length)

    let enviados = 0
    const falhas: string[] = []

    for (const file of validos) {
      // O nome do arquivo vira o título, só para o marketing se localizar na
      // lista — no bucket o objeto é um uuid, e o título nunca vai para a TV.
      const titulo = file.name.replace(/\.[^.]+$/, "")
      const { error } = await criarAviso(file, titulo)
      if (error) falhas.push(`${file.name}: ${error}`)
      else enviados++
      setRestantes((n) => n - 1)
    }

    setTotalEnvio(0)
    for (const falha of falhas) toast.error(falha)

    if (enviados > 0) {
      // A prévia já abre incluindo o que acabou de subir. Pedir para "conferir
      // antes de publicar" e deixar a conferência atrás de um link que a pessoa
      // ainda precisa descobrir é pedir para ela publicar sem olhar.
      setVerPendentesPedido(true)
      // "Confira e publique", não "enviado": o passo que falta é justamente o
      // que a pessoa poderia achar que já aconteceu.
      toast.success(
        enviados === 1
          ? "Imagem enviada. Confira a prévia e publique."
          : `${enviados} imagens enviadas. Confira a prévia e publique.`
      )
    }

    await recarregar()
  }

  function soltar(e: React.DragEvent) {
    e.preventDefault()
    setArrastandoSobre(0)
    if (enviando) return
    // `type.startsWith("image/")` filtra a pasta arrastada e o atalho: o que não
    // é imagem some sem virar quatro toasts de erro. O que É imagem mas tem
    // formato errado (bmp, gif) segue para validarArquivoAviso, que explica.
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    )
    if (files.length === 0) {
      toast.error("Solte arquivos de imagem (JPG, PNG ou WebP).")
      return
    }
    enviarLote(files)
  }

  async function publicar() {
    const ids = rascunhos.map((a) => a.id)
    setPublicando(true)
    const { error } = await publicarAvisos(ids)
    if (error) toast.error(error)
    else {
      toast.success(
        ids.length === 1 ? "Aviso no ar." : `${ids.length} avisos no ar.`
      )
    }
    await recarregar()
    setPublicando(false)
  }

  async function alternar(aviso: AvisoTVRegistro) {
    setOcupado(true)
    const { error } = await definirAtivo(aviso.id, !aviso.ativo)
    if (error) toast.error(error)
    await recarregar()
    setOcupado(false)
  }

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= avisos.length) return

    const nova = [...avisos]
    ;[nova[indice], nova[destino]] = [nova[destino], nova[indice]]

    // Otimista só na tela: a lista reordenada aparece na hora (e a prévia com
    // ela), mas o recarregar abaixo é quem tem a última palavra.
    setAvisos(nova)
    setOcupado(true)

    const { error } = await salvarOrdem(nova.map((a) => a.id))
    if (error) toast.error(error)
    await recarregar()
    setOcupado(false)
  }

  async function excluir(aviso: AvisoTVRegistro) {
    if (!confirm(`Remover "${aviso.titulo ?? "este aviso"}" da TV?`)) return

    setOcupado(true)
    const { error } = await removerAviso(aviso.id, aviso.caminho)
    if (error) toast.error(error)
    else toast.success("Aviso removido.")
    await recarregar()
    setOcupado(false)
  }

  const ativos = avisos.filter((a) => a.ativo)
  // Rascunho é o que foi enviado e ainda não foi ao ar. Ele é indistinguível,
  // no banco, de um aviso que a pessoa tirou do ar de propósito — os dois são
  // `ativo = false`. E está certo assim: os dois estados querem exatamente a
  // mesma ação ("colocar no ar"), e inventar uma terceira coluna só para
  // diferenciá-los criaria um estado a mais para manter sem mudar nada do que a
  // pessoa pode fazer.
  const rascunhos = avisos.filter((a) => !a.ativo)
  // A prévia com pendentes usa a lista INTEIRA na ordem da tela, não `ativos`
  // seguido de `rascunhos`: publicar não reordena nada, e mostrar os novos
  // empilhados no fim ensinaria uma sequência que a TV não vai seguir.
  // `&& rascunhos.length > 0` porque o modo se desliga sozinho quando não sobra
  // rascunho — depois de publicar, ou de remover o último. Sem isso o botão de
  // voltar sumiria junto com os rascunhos e o painel ficaria preso num título
  // ("Prévia com os não publicados") que já não descreve nada.
  const verPendentes = verPendentesPedido && rascunhos.length > 0
  const naPrevia = verPendentes ? avisos : ativos

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,420px)] gap-6 items-start"
      // O alvo do arrastar é a tela toda, não um retângulo pequeno: quem vem do
      // explorador com quatro arquivos mira a página, e uma zona estreita
      // transforma soltar numa tarefa de pontaria. O realce mostra o alvo real.
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setArrastandoSobre((n) => n + 1)
      }}
      onDragOver={(e) => {
        // Sem isto o navegador ABRE a imagem solta, trocando a página da pessoa
        // pelo arquivo — e o envio nunca acontece.
        if (e.dataTransfer.types.includes("Files")) e.preventDefault()
      }}
      onDragLeave={() => setArrastandoSobre((n) => Math.max(0, n - 1))}
      onDrop={soltar}
    >
      {/* ─── lista ─────────────────────────────────────────────────────── */}
      <div
        className={`rounded-xl border bg-white transition-colors ${
          arrastandoSobre > 0
            ? "border-slate-900 ring-2 ring-slate-900/10"
            : "border-slate-200"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Imagens do carrossel
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {ativos.length === 0
                ? "Nenhuma imagem no ar — a TV mostra a tela padrão de espera."
                : `${ativos.length} ${ativos.length === 1 ? "imagem no ar" : "imagens no ar"}, exibidas nesta ordem a cada 12 segundos.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImagePlus className="w-4 h-4" />
            )}
            {enviando && totalEnvio > 1
              ? `Enviando ${totalEnvio - restantes + 1} de ${totalEnvio}…`
              : enviando
                ? "Enviando…"
                : "Adicionar imagens"}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              // Zerar o input permite reenviar o MESMO arquivo depois de um
              // erro — sem isto o `change` não dispara na segunda tentativa.
              e.target.value = ""
              enviarLote(files)
            }}
          />
        </div>

        {/* Barra de publicação. Só existe havendo rascunho: uma barra vazia
            permanente ensinaria a ignorá-la, e é justamente ela que precisa ser
            notada quando aparece. */}
        {rascunhos.length > 0 && (
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-amber-200 bg-amber-50">
            <p className="text-xs text-amber-900 min-w-0">
              <strong className="font-semibold">
                {rascunhos.length === 1
                  ? "1 imagem fora do ar"
                  : `${rascunhos.length} imagens fora do ar`}
              </strong>{" "}
              — não aparecem na TV até você publicar.
            </p>
            <button
              type="button"
              onClick={publicar}
              disabled={publicando || ocupado}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {publicando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Monitor className="w-4 h-4" />
              )}
              Publicar na TV
            </button>
          </div>
        )}

        {/* Especificação da arte. Fica FIXA na tela, não num tooltip ou num
            aviso pós-erro: quem prepara o cartaz precisa do número ANTES de
            abrir o editor, e descobrir a proporção certa depois de exportar
            significa refazer a arte. */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/60">
          <p className="text-xs font-semibold text-slate-700 mb-2.5">
            Como preparar a imagem
          </p>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                Proporção
              </dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                3:2 (horizontal)
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                Dimensões
              </dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                1800 × 1200 px
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                Formato
              </dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5">
                JPG, PNG ou WebP
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                Tamanho máximo
              </dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                10 MB
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            A imagem aparece <strong className="font-medium text-slate-600">inteira</strong>, nunca cortada — se
            a proporção for diferente de 3:2, sobra fundo nas laterais ou acima e
            abaixo. Evite texto pequeno: a TV é lida a cerca de 4 metros de
            distância.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Você pode arrastar imagens do computador para esta página, ou escolher
            várias de uma vez no botão acima. Nada vai à TV antes de você publicar.
          </p>
        </div>

        {falha ? (
          <div className="px-5 py-16 text-center">
            <TriangleAlert className="w-8 h-8 mx-auto text-amber-500" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Não foi possível carregar os avisos
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              {falha}
            </p>
          </div>
        ) : avisos.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Monitor className="w-8 h-8 mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Nenhum aviso publicado
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Arraste imagens para esta página ou use o botão acima. Enquanto não
              houver imagem no ar, a TV da recepção continua exibindo a tela
              padrão &ldquo;Atendimento em andamento&rdquo;.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {avisos.map((aviso, i) => (
              <li
                key={aviso.id}
                className={`flex items-center gap-4 px-5 py-3 ${aviso.ativo ? "" : "bg-slate-50"}`}
              >
                {/* Setas: mais confiáveis que arrastar num notebook com
                    trackpad, e acessíveis por teclado sem nenhum trabalho.
                    Desabilitadas nas pontas em vez de escondidas — botão que
                    some muda o layout da linha a cada movimento. */}
                <div className="shrink-0 flex flex-col">
                  <button
                    type="button"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0 || ocupado}
                    aria-label="Mover para cima"
                    className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, 1)}
                    disabled={i === avisos.length - 1 || ocupado}
                    aria-label="Mover para baixo"
                    className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>

                {/* 96×64 é 3:2, a mesma proporção do painel da TV: a miniatura
                    mostra de relance se a arte vai preencher ou sobrar fundo. */}
                <img
                  src={aviso.url}
                  alt=""
                  className={`shrink-0 w-24 h-16 rounded-md border border-slate-200 object-contain bg-slate-50 ${
                    aviso.ativo ? "" : "opacity-40 grayscale"
                  }`}
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium truncate ${aviso.ativo ? "text-slate-900" : "text-slate-500"}`}
                  >
                    {aviso.titulo || "Sem título"}
                  </p>
                  {/* A posição conta só entre os que estão NO AR: `i` é o índice
                      da lista inteira, e usá-lo diria "Posição 4" para o
                      primeiro cartaz do carrossel se houvesse três fora do ar
                      antes dele. Quem confere a sequência na TV contaria 1, 2,
                      3 — e não bateria. */}
                  <p className="text-xs text-slate-500 mt-0.5">
                    {aviso.ativo
                      ? `Posição ${ativos.findIndex((a) => a.id === aviso.id) + 1} na TV`
                      : "Fora do ar"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => alternar(aviso)}
                  disabled={ocupado}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {aviso.ativo ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      Tirar do ar
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      Colocar no ar
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => excluir(aviso)}
                  disabled={ocupado}
                  aria-label="Remover"
                  className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ─── prévia ────────────────────────────────────────────────────── */}
      {/* Mesmo componente que a TV usa, não uma reprodução: prévia que só
          aproxima o comportamento é prévia que mente, e quem publica o cartaz
          não teria como saber. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {verPendentes ? "Prévia com os não publicados" : "Prévia da TV"}
          </h2>
          {/* Sem este botão, o rascunho não seria conferível em lugar nenhum: a
              prévia mostra o que está NO AR, e o cartaz recém-enviado por
              definição não está. Pedir para "conferir antes de publicar" e não
              dar onde conferir empurraria a pessoa a publicar às cegas — que é
              exatamente o que este fluxo existe para evitar. */}
          {rascunhos.length > 0 && (
            <button
              type="button"
              onClick={() => setVerPendentesPedido((v) => !v)}
              className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900 underline decoration-slate-300 underline-offset-2"
            >
              {verPendentes ? "Ver só o que está no ar" : "Incluir não publicados"}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">
          {verPendentes
            ? "Como ficaria depois de publicar. Ainda não é o que a recepção vê."
            : "Como aparece na recepção enquanto ninguém está sendo chamado."}
        </p>

        {/* 1337/860 é a área ÚTIL do painel esquerdo numa TV 1080p — não 16:9,
            que é a proporção da TV inteira. O painel perde o header (90px), o
            footer (70px), a coluna de "Últimas chamadas" e os espaçamentos, e
            sobra quase 3:2. Usar aspect-video aqui faria a prévia mentir sobre
            onde a arte encosta. */}
        <div
          className={`aspect-[1337/860] w-full rounded-lg bg-slate-100 border overflow-hidden ${
            verPendentes ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"
          }`}
        >
          {naPrevia.length > 0 ? (
            <CarrosselAvisos avisos={naPrevia} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
              <p className="text-base font-bold text-slate-700 leading-tight">
                Atendimento
                <br />
                em andamento
              </p>
              <p className="mt-2 text-[11px] text-slate-500 max-w-[24ch]">
                Tela padrão exibida quando não há nenhum aviso ativo.
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          Quando um paciente é chamado, o carrossel sai da tela e o nome ocupa o
          painel inteiro. Os avisos voltam assim que a chamada termina.
        </p>
      </div>
    </div>
  )
}
