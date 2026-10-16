'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, ImageOff, Loader2 } from 'lucide-react'

import { ehImagem, tamanhoLegivel, urlAnexo, type AnexoChat } from '@/lib/chat/cliente'

// ============================================================================
// Os anexos dentro do balão: imagem vira miniatura (clique abre inteira em
// outra aba), o resto vira uma linha com nome, tamanho e baixar. O bucket é
// privado — cada endereço é uma URL assinada, pedida quando o balão aparece.
// ============================================================================

export default function AnexosMensagem({ anexos, minha }: { anexos: AnexoChat[]; minha: boolean }) {
  const imagens = anexos.filter(ehImagem)
  const arquivos = anexos.filter(a => !ehImagem(a))
  return (
    <div className="space-y-1.5">
      {imagens.length > 0 && (
        <div className={`grid gap-1 ${imagens.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {imagens.map(a => <Miniatura key={a.path} anexo={a} />)}
        </div>
      )}
      {arquivos.map(a => <LinhaArquivo key={a.path} anexo={a} minha={minha} />)}
    </div>
  )
}

function useUrl(path: string, baixar?: string): string | null | undefined {
  // undefined = pedindo; null = falhou.
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let vivo = true
    urlAnexo(path, baixar).then(u => { if (vivo) setUrl(u) })
    return () => { vivo = false }
  }, [path, baixar])
  return url
}

function Miniatura({ anexo }: { anexo: AnexoChat }) {
  const url = useUrl(anexo.path)
  const [quebrou, setQuebrou] = useState(false)
  if (url === undefined) {
    return (
      <div className="flex aspect-4/3 items-center justify-center rounded-lg bg-foreground/5">
        <Loader2 className="h-4 w-4 animate-spin opacity-60" />
      </div>
    )
  }
  if (url === null || quebrou) {
    return (
      <div className="flex aspect-4/3 flex-col items-center justify-center gap-1 rounded-lg bg-foreground/5 px-2 text-center text-xs opacity-80">
        <ImageOff className="h-4 w-4" aria-hidden />
        <span className="line-clamp-2 break-all">{anexo.nome}</span>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={`Abrir ${anexo.nome}`} className="block overflow-hidden rounded-lg">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária: next/image não serve */}
      <img
        src={url}
        alt={anexo.nome}
        loading="lazy"
        onError={() => setQuebrou(true)}
        className="max-h-60 w-full bg-foreground/5 object-cover transition-opacity hover:opacity-90"
      />
    </a>
  )
}

function LinhaArquivo({ anexo, minha }: { anexo: AnexoChat; minha: boolean }) {
  const url = useUrl(anexo.path, anexo.nome)
  const conteudo = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${minha ? 'bg-white/20' : 'bg-cyan-600/10 text-cyan-700 dark:text-cyan-300'}`}>
        <FileText className="h-4.5 w-4.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{anexo.nome}</span>
        <span className={`block text-[11px] ${minha ? 'text-white/75' : 'text-muted-foreground'}`}>
          {tamanhoLegivel(anexo.tamanho)}
        </span>
      </span>
      {url === undefined
        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
        : <Download className="h-4 w-4 shrink-0 opacity-70" aria-hidden />}
    </>
  )
  const classe = `flex items-center gap-2.5 rounded-lg p-1.5 pr-2.5 ${minha ? 'bg-white/10 hover:bg-white/15' : 'bg-background/60 hover:bg-background'} transition-colors`
  return url ? (
    <a href={url} className={classe} title={`Baixar ${anexo.nome}`}>{conteudo}</a>
  ) : (
    <div className={classe} aria-busy={url === undefined}>{conteudo}</div>
  )
}
