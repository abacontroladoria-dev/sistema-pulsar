"use client"

import { useRef, useState, type ReactNode } from "react"
import toast from "react-hot-toast"
import { Camera, ImagePlus, Loader2, PenLine, RefreshCw, Trash2 } from "lucide-react"
import { btnSecundario } from "@/components/cronograma/grade/estilo"
import { Secao } from "@/components/cadastros/pacientes/ui/campos"
import type { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { useUrlAssinada } from "@/hooks/useUrlAssinada"
import {
  enviarArquivoProfissional, removerArquivoProfissional, validarArquivoProfissional, type TipoArquivoProfissional,
} from "@/services/profissionaisArquivos.service"
import type { Profissional, ProfissionalArquivos } from "@/types/profissional"

// Foto de perfil e foto da assinatura/carimbo do profissional.
//
// Como a foto do paciente (FotoPacienteUpload), o envio é IMEDIATO e fica fora
// do "Editar": a imagem já subiu para o Storage, e deixá-la pendente de um
// "Salvar" criaria objeto órfão se a edição fosse cancelada.

type Gravar = (patch: Partial<ProfissionalArquivos>) => Promise<boolean>
type Confirmar = ReturnType<typeof useConfirmacao>["confirmar"]

const CAMPO: Record<TipoArquivoProfissional, keyof ProfissionalArquivos> = { foto: "foto_path", assinatura: "assinatura_path" }
const NOME: Record<TipoArquivoProfissional, string> = { foto: "Foto", assinatura: "Assinatura" }

function useImagemProfissional(prof: Profissional, tipo: TipoArquivoProfissional, gravar: Gravar, confirmar: Confirmar) {
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const atual = prof[CAMPO[tipo]]

  const enviar = async (file: File) => {
    const problema = validarArquivoProfissional(file)
    if (problema) { toast.error(problema); return }
    setEnviando(true)
    try {
      const path = await enviarArquivoProfissional(prof.id, tipo, file)
      if (!(await gravar({ [CAMPO[tipo]]: path }))) {
        // Não vinculou: a nova não fica de órfã no bucket.
        void removerArquivoProfissional(path)
        return
      }
      // A antiga só sai depois que a nova já está gravada.
      if (atual) void removerArquivoProfissional(atual)
      toast.success(`${NOME[tipo]} ${atual ? "trocada" : "adicionada"}`)
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
    } finally {
      setEnviando(false)
    }
  }

  const remover = async () => {
    if (!atual) return
    const ok = await confirmar({
      titulo: tipo === "foto" ? "Remover a foto de perfil?" : "Remover a foto da assinatura?",
      texto: tipo === "foto"
        ? "O avatar volta a mostrar o ícone da terapia."
        : "A imagem da assinatura/carimbo sai do cadastro. Dá para adicionar outra quando quiser.",
      confirmar: "Remover",
      t: "vermelho",
      Icone: Trash2,
    })
    if (!ok) return
    setEnviando(true)
    try {
      if (await gravar({ [CAMPO[tipo]]: null })) {
        void removerArquivoProfissional(atual)
        toast.success(`${NOME[tipo]} removida`)
      }
    } finally {
      setEnviando(false)
    }
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      tabIndex={-1}
      onChange={e => {
        const file = e.target.files?.[0]
        // Zera o input para reenviar o MESMO arquivo disparar onChange de novo.
        e.target.value = ""
        if (file) void enviar(file)
      }}
    />
  )
  return { atual, enviando, escolher: () => inputRef.current?.click(), remover, input }
}

/** Botão de câmera sobre o avatar do hero da ficha. */
export function TrocarFotoAvatar({
  prof, gravar, confirmar, children,
}: { prof: Profissional; gravar: Gravar; confirmar: Confirmar; children: ReactNode }) {
  const f = useImagemProfissional(prof, "foto", gravar, confirmar)
  return (
    <div className="relative shrink-0">
      {children}
      {f.enviando && (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45" role="status" aria-label="Enviando foto">
          <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
        </span>
      )}
      <button
        type="button"
        onClick={f.escolher}
        disabled={f.enviando}
        className="absolute -bottom-1 -right-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={f.atual ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
        aria-label={f.atual ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
      >
        <Camera className="h-4 w-4" aria-hidden />
      </button>
      {f.input}
    </div>
  )
}

/** Seção da aba Cadastro: foto de perfil + foto da assinatura/carimbo. */
export function SecaoImagens({ prof, gravar, confirmar }: { prof: Profissional; gravar: Gravar; confirmar: Confirmar }) {
  const foto = useImagemProfissional(prof, "foto", gravar, confirmar)
  const assinatura = useImagemProfissional(prof, "assinatura", gravar, confirmar)
  const urlFoto = useUrlAssinada(foto.atual)
  const urlAssinatura = useUrlAssinada(assinatura.atual)

  return (
    <Secao titulo="Foto e assinatura" descricao="JPEG, PNG ou WebP até 5 MB. Gravadas na hora, sem precisar de Editar.">
      <Bloco
        rotulo="Foto de perfil"
        previa={
          <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground">
            {urlFoto ? <img src={urlFoto} alt={`Foto de ${prof.nome}`} className="h-full w-full object-cover" /> : <Camera className="h-8 w-8" aria-hidden />}
          </span>
        }
        estado={foto}
        rotuloAdicionar="Adicionar foto"
      />
      <Bloco
        rotulo="Assinatura / carimbo"
        previa={
          // Fundo branco nos dois temas: a assinatura é tinta escura sobre papel.
          <span className="flex h-24 w-full max-w-[22rem] items-center justify-center overflow-hidden rounded-md border border-border bg-white">
            {urlAssinatura
              ? <img src={urlAssinatura} alt={`Assinatura/carimbo de ${prof.nome}`} className="h-full w-full object-contain p-2" />
              : <PenLine className="h-8 w-8 text-muted-foreground" aria-hidden />}
          </span>
        }
        estado={assinatura}
        rotuloAdicionar="Adicionar foto da assinatura"
      />
    </Secao>
  )
}

function Bloco({
  rotulo, previa, estado, rotuloAdicionar,
}: {
  rotulo: string
  previa: ReactNode
  estado: ReturnType<typeof useImagemProfissional>
  rotuloAdicionar: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <p className="text-sm font-semibold text-foreground">{rotulo}</p>
      <div className="relative">
        {previa}
        {estado.enviando && (
          <span className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Enviando">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={estado.escolher} disabled={estado.enviando} className={btnSecundario}>
          {estado.atual ? <RefreshCw className="h-4 w-4" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
          {estado.atual ? "Trocar" : rotuloAdicionar}
        </button>
        {estado.atual && (
          <button type="button" onClick={estado.remover} disabled={estado.enviando} className={btnSecundario}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remover
          </button>
        )}
      </div>
      {estado.input}
    </div>
  )
}
