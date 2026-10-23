"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import { Building2, CornerDownLeft, Loader2, Palette, Search, Stethoscope, UserRound, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { usePermissoesUsuario } from "@/contexts/PermissoesUsuarioContext"
import { buscarFerramentas } from "@/lib/busca/buscarFerramentas"
import { destacar } from "@/lib/busca/destacar"
import { normTxt } from "@/lib/cronograma/constants"
import {
  buscarRegistros,
  MIN_LETRAS_REGISTROS,
  type CategoriaRegistro,
  type ResultadoRegistro,
} from "@/services/buscaMestre.service"

// Cada categoria do servidor: a seção da lista, a tela do cadastro (a seção só
// aparece para quem abre essa tela — o banco já faz o mesmo corte, e conferir
// aqui faz o "Visualizar como" esconder também) e para onde o resultado leva.
const CATEGORIAS: {
  categoria: CategoriaRegistro
  titulo: string
  /** Para a dica: "Digite o nome de uma tela, um paciente…". */
  umDeles: string
  tela: string
  icon: LucideIcon
  href: (r: ResultadoRegistro) => string
}[] = [
  { categoria: "paciente", titulo: "Pacientes", umDeles: "um paciente", tela: "/cadastros/pacientes", icon: UserRound, href: (r) => `/cadastros/pacientes/${r.id}` },
  { categoria: "profissional", titulo: "Profissionais", umDeles: "um profissional", tela: "/cadastros/profissionais", icon: Stethoscope, href: (r) => `/cadastros/profissionais/${r.id}` },
  { categoria: "convenio", titulo: "Convênios", umDeles: "um convênio", tela: "/cadastros/convenios", icon: Building2, href: (r) => `/cadastros/convenios?convenio=${r.id}` },
  { categoria: "terapia", titulo: "Terapias", umDeles: "uma terapia", tela: "/cadastros/terapias", icon: Palette, href: (r) => `/cadastros/terapias?busca=${encodeURIComponent(r.titulo)}` },
]

/** ["a", "b", "c"] → "a, b ou c" (com `e` no lugar de `ou`). */
function listar(partes: string[], conector: "ou" | "e"): string {
  if (partes.length <= 1) return partes.join("")
  return `${partes.slice(0, -1).join(", ")} ${conector} ${partes[partes.length - 1]}`
}

const ESPERA_MS = 250
/** O servidor devolve no máximo isto por categoria (busca_mestre). */
const LIMITE_POR_CATEGORIA = 6

/**
 * Busca mestre: botão no Sidebar ("Buscar… Ctrl K") que abre uma janela no
 * centro da tela. Telas do menu aparecem na hora (filtradas no navegador pela
 * mesma regra do menu); pacientes, profissionais, convênios e terapias vêm do
 * servidor, que só devolve as categorias que a pessoa pode ver.
 */
export function BuscaMestre({ compacto = false, semTitle = false }: { compacto?: boolean; semTitle?: boolean }) {
  const router = useRouter()
  const { canAccess } = usePermissoesUsuario()
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState("")
  const [registros, setRegistros] = useState<ResultadoRegistro[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Número da consulta mais recente: resposta de uma consulta anterior ("lau")
  // que chegue depois da atual ("laura") é descartada.
  const ultima = useRef(0)

  const categorias = useMemo(() => CATEGORIAS.filter((c) => canAccess(c.tela)), [canAccess])
  const buscaCadastros = categorias.length > 0

  // Ctrl+K (⌘K no Mac) abre de qualquer tela.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setAberto(true)
      }
    }
    document.addEventListener("keydown", aoTeclar)
    return () => document.removeEventListener("keydown", aoTeclar)
  }, [])

  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current)
  }, [])

  function aoDigitar(valor: string) {
    setTermo(valor)
    if (espera.current) clearTimeout(espera.current)
    const id = ++ultima.current
    if (!buscaCadastros || normTxt(valor).length < MIN_LETRAS_REGISTROS) {
      setRegistros([])
      setBuscando(false)
      setErro(null)
      return
    }
    setBuscando(true)
    espera.current = setTimeout(async () => {
      try {
        const r = await buscarRegistros(valor.trim())
        if (id !== ultima.current) return
        setRegistros(r)
        setErro(null)
      } catch {
        if (id !== ultima.current) return
        setRegistros([])
        setErro("Não foi possível buscar nos cadastros agora. As telas continuam aparecendo.")
      } finally {
        if (id === ultima.current) setBuscando(false)
      }
    }, ESPERA_MS)
  }

  function aoAbrirOuFechar(v: boolean) {
    setAberto(v)
    if (!v) aoDigitar("")
  }

  function ir(href: string) {
    aoAbrirOuFechar(false)
    router.push(href)
  }

  const ferramentas = useMemo(() => buscarFerramentas(termo, canAccess), [termo, canAccess])
  const t = normTxt(termo)
  const curto = buscaCadastros && t.length > 0 && t.length < MIN_LETRAS_REGISTROS
  const secoes = categorias
    .map((c) => ({ ...c, itens: registros.filter((r) => r.categoria === c.categoria) }))
    .filter((s) => s.itens.length > 0)
  const nadaAchado = t.length > 0 && !buscando && !curto && ferramentas.length === 0 && secoes.length === 0

  const dica = `Digite o nome de ${listar(["uma tela", ...categorias.map((c) => c.umDeles)], "ou")}.`

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={compacto ? "Buscar (Ctrl K)" : undefined}
        title={compacto && !semTitle ? "Buscar (Ctrl K)" : undefined}
        className={`flex h-10 items-center gap-2 rounded-lg border border-sidebar-border bg-card text-sm text-muted-foreground transition-colors hover:border-sidebar-ring hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
          compacto ? "w-10 justify-center" : "w-full pl-3 pr-2"
        }`}
      >
        <Search size={16} className="shrink-0" aria-hidden="true" />
        {!compacto && (
          <>
            <span className="flex-1 text-left">Buscar…</span>
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">
              Ctrl K
            </kbd>
          </>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={aoAbrirOuFechar}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="top-[12vh] max-h-[76vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[600px] flex flex-col"
        >
          <DialogTitle className="sr-only">Buscar no Pulsar</DialogTitle>
          <Command shouldFilter={false} loop className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
              <Search size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <Command.Input
                value={termo}
                onValueChange={aoDigitar}
                placeholder={buscaCadastros ? "Buscar paciente, profissional, convênio, terapia ou tela…" : "Buscar tela…"}
                aria-label="Buscar no Pulsar"
                className="h-10 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Tecla>Esc</Tecla>
            </div>

            <Command.List className="min-h-0 flex-1 overflow-y-auto py-1.5">
              {t.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{dica}</p>}

              {ferramentas.length > 0 && (
                <Grupo titulo="Ferramentas">
                  {ferramentas.map(({ item, caminho }) => (
                    <Resultado
                      key={item.codigo}
                      valor={`tela:${item.codigo}`}
                      icon={item.icon}
                      titulo={item.label}
                      termo={termo}
                      subtitulo={caminho || null}
                      aoEscolher={() => ir(item.path)}
                    />
                  ))}
                </Grupo>
              )}

              {secoes.map((s) => (
                <Grupo
                  key={s.categoria}
                  titulo={s.titulo}
                  rodape={
                    s.itens.length >= LIMITE_POR_CATEGORIA
                      ? `Mostrando os ${LIMITE_POR_CATEGORIA} primeiros. Digite mais do nome para refinar.`
                      : undefined
                  }
                >
                  {s.itens.map((r) => (
                    <Resultado
                      key={`${r.categoria}:${r.id}`}
                      valor={`${r.categoria}:${r.id}`}
                      icon={s.icon}
                      titulo={r.titulo}
                      termo={termo}
                      subtitulo={r.subtitulo}
                      inativo={r.inativo}
                      aoEscolher={() => ir(s.href(r))}
                    />
                  ))}
                </Grupo>
              ))}

              {buscando && (
                <div className="flex items-center gap-2.5 px-4 py-3 text-sm text-muted-foreground" role="status">
                  <Loader2 size={16} className="shrink-0 motion-safe:animate-spin text-sidebar-primary" aria-hidden="true" />
                  Buscando {listar(categorias.map((c) => c.titulo.toLowerCase()), "e")}…
                </div>
              )}
              {curto && (
                <p className="px-4 py-2.5 text-sm text-muted-foreground">
                  Digite pelo menos {MIN_LETRAS_REGISTROS} letras para buscar nos cadastros.
                </p>
              )}
              {erro && <p className="px-4 py-2.5 text-sm text-[var(--status-atencao)]">{erro}</p>}
              {nadaAchado && (
                <p className="px-4 py-4 text-sm text-muted-foreground">Nada encontrado para “{termo.trim()}”.</p>
              )}
            </Command.List>

            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Tecla>↑</Tecla><Tecla>↓</Tecla> navegar</span>
              <span className="flex items-center gap-1.5"><Tecla>Enter</Tecla> abrir</span>
              <span className="flex items-center gap-1.5"><Tecla>Esc</Tecla> fechar</span>
              <span className="ml-auto">Só aparece o que está liberado para você</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-card px-1 font-sans text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

function Grupo({ titulo, rodape, children }: { titulo: string; rodape?: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={titulo}
      className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
      {/* Recuo = borda 2px + px-4 + ícone 32px + gap 12px: alinha com o título. */}
      {rodape && <p className="pb-1 pl-[3.875rem] pr-4 pt-0.5 text-xs text-muted-foreground">{rodape}</p>}
    </Command.Group>
  )
}

function Resultado({
  valor,
  icon: Icon,
  titulo,
  termo,
  subtitulo,
  inativo = false,
  aoEscolher,
}: {
  valor: string
  icon: LucideIcon
  titulo: string
  /** O que foi digitado: o trecho que casou fica marcado no título. */
  termo: string
  subtitulo: string | null
  inativo?: boolean
  aoEscolher: () => void
}) {
  return (
    <Command.Item
      value={valor}
      onSelect={aoEscolher}
      className="group flex min-h-14 cursor-pointer items-center gap-3 border-l-2 border-transparent px-4 py-2 outline-none data-[selected=true]:border-sidebar-primary data-[selected=true]:bg-sidebar-accent/60"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-data-[selected=true]:bg-card group-data-[selected=true]:text-sidebar-primary">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Nome de pessoa quebra linha, nunca "…". O trecho que casou com o
            termo fica marcado: mostra por que o resultado apareceu. */}
        <span className="break-words text-sm text-foreground">
          {destacar(titulo, termo).map((p, i) =>
            p.casou ? (
              <mark key={i} className="rounded-[3px] bg-sidebar-accent px-px font-semibold text-sidebar-accent-foreground">
                {p.texto}
              </mark>
            ) : (
              <span key={i} className="font-medium">{p.texto}</span>
            )
          )}
        </span>
        {subtitulo && <span className="text-xs tabular-nums text-muted-foreground">{subtitulo}</span>}
      </span>
      {inativo && (
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Inativo
        </span>
      )}
      <CornerDownLeft
        size={14}
        className="hidden shrink-0 text-sidebar-primary group-data-[selected=true]:block"
        aria-hidden="true"
      />
    </Command.Item>
  )
}
