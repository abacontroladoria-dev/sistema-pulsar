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
} from "lucide-react"
import { CarrosselAvisos } from "@/components/tv/CarrosselAvisos"
import {
  criarAviso,
  definirAtivo,
  listarAvisos,
  removerAviso,
  salvarOrdem,
  validarArquivoAviso,
  type AvisoTVRegistro,
} from "@/services/tvAvisos.service"

// Gestão do carrossel da TV do saguão.
//
// Tudo aqui é IMEDIATO — sem "Salvar tudo". O upload já subiu o objeto para o
// Storage no instante em que foi escolhido, e um estado pendente criaria órfão a
// cada desistência (mesmo raciocínio do FotoPacienteUpload). Ordem e ativo
// gravam na hora pelo mesmo motivo: quem publica cartaz quer ver na TV agora.
//
// ⚠️ RLS bloqueando WRITE não gera erro visível: a gravação "funciona" e não
// grava. Por isso todo caminho aqui relê do banco depois de escrever, em vez de
// confiar no estado local — se a policy recusou, a lista volta ao que era e o
// usuário vê que não pegou.

export function GestaoAvisosTV() {
  const [avisos, setAvisos] = useState<AvisoTVRegistro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const recarregar = useCallback(async () => {
    const { avisos: lista, error } = await listarAvisos()
    if (error) toast.error("Não foi possível carregar os avisos.")
    setAvisos(lista)
    setCarregando(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via API, sem valor derivável no primeiro render
    recarregar()
  }, [recarregar])

  async function selecionar(file: File) {
    const problema = validarArquivoAviso(file)
    if (problema) {
      toast.error(problema)
      return
    }

    setEnviando(true)
    // O nome do arquivo vira o título, só para o marketing se localizar na
    // lista — no bucket o objeto é um uuid, e o título nunca vai para a TV.
    const titulo = file.name.replace(/\.[^.]+$/, "")
    const { error } = await criarAviso(file, titulo)
    setEnviando(false)

    if (error) {
      toast.error("Não foi possível enviar a imagem.")
      return
    }

    toast.success("Aviso publicado.")
    await recarregar()
  }

  async function alternar(aviso: AvisoTVRegistro) {
    setOcupado(true)
    const { error } = await definirAtivo(aviso.id, !aviso.ativo)
    if (error) toast.error("Não foi possível alterar o aviso.")
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
    if (error) toast.error("Não foi possível salvar a ordem.")
    await recarregar()
    setOcupado(false)
  }

  async function excluir(aviso: AvisoTVRegistro) {
    if (!confirm(`Remover "${aviso.titulo ?? "este aviso"}" da TV?`)) return

    setOcupado(true)
    const { error } = await removerAviso(aviso.id, aviso.caminho)
    if (error) toast.error("Não foi possível remover o aviso.")
    else toast.success("Aviso removido.")
    await recarregar()
    setOcupado(false)
  }

  const ativos = avisos.filter((a) => a.ativo)

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,420px)] gap-6 items-start">
      {/* ─── lista ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Imagens do carrossel
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {ativos.length === 0
                ? "Nenhuma imagem ativa — a TV mostra a tela padrão de espera."
                : `${ativos.length} ${ativos.length === 1 ? "imagem ativa" : "imagens ativas"}, exibidas nesta ordem a cada 12 segundos.`}
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
            Adicionar imagem
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Zerar o input permite reenviar o MESMO arquivo depois de um
              // erro — sem isto o `change` não dispara na segunda tentativa.
              e.target.value = ""
              if (file) selecionar(file)
            }}
          />
        </div>

        {avisos.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Monitor className="w-8 h-8 mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Nenhum aviso publicado
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Enquanto não houver imagem ativa, a TV do saguão continua exibindo
              a tela padrão &ldquo;Atendimento em andamento&rdquo;.
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
                  <p className="text-xs text-slate-500 mt-0.5">
                    {aviso.ativo ? `Posição ${i + 1} na TV` : "Fora do ar"}
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
        <h2 className="text-sm font-semibold text-slate-900">Prévia da TV</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">
          Como aparece no saguão enquanto ninguém está sendo chamado.
        </p>

        {/* 16/9 e fundo escuro para dar a mesma leitura de uma TV na parede. */}
        <div className="aspect-video w-full rounded-lg bg-slate-100 border border-slate-200 overflow-hidden">
          {ativos.length > 0 ? (
            <CarrosselAvisos avisos={ativos} />
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
