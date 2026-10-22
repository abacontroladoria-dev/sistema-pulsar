"use client"

import {
  LayoutDashboard,
  PlusCircle,
  Activity,
  ShieldCheck,
  ClipboardList,
  ClipboardPlus,
  ClipboardPenLine,
  ListChecks,
  Link2,
  UserRound,
  Building2,
  Star,
  KeyRound,
  Plug,
  Monitor,
  BarChart3,
  CalendarPlus,
  Database,
  LogOut,
  TrendingUp,
  UserCheck,
  UserPlus,
  Clock,
  XCircle,
  AlertTriangle,
  CalendarOff,
  BookOpen,
  Settings,
  ClipboardCheck,
  Wallet,
  DoorOpen,
  ArrowRightLeft,
  Tag,
  Calendar,
  FileSignature,
  Percent,
  History,
  UserSearch,
  Zap,
  FileClock,
  FileOutput,
  CalendarClock,
  Gauge,
  FileSearch,
  ScanText,
  MessagesSquare,
  ChevronRight,
  type LucideIcon,
} from "lucide-react"
import { useChatEquipe, useContadoresChatEquipe } from "@/contexts/ChatEquipeContext"
import BolinhaNaoLidas from "@/components/chat-equipe/BolinhaNaoLidas"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getFunctionHeaders, getFunctionUrl } from "@/lib/supabase/functions"
import toast from "react-hot-toast"
import ModalPerfil from "@/components/perfil/ModalPerfil"
import ModalAlterarSenha from "@/components/perfil/ModalAlterarSenha"
import ModalErros from "@/components/perfil/ModalErros"
import { SidebarGroup } from "@/components/sidebar/SidebarGroup"
import { ModalGrupoMenu } from "@/components/sidebar/ModalGrupoMenu"
import { ThemeSwitcher } from "@/components/sidebar/ThemeSwitcher"
import { useTheme } from "@/contexts/ThemeContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { usePermissoesUsuario } from "@/contexts/PermissoesUsuarioContext"
import { ImpersonationSelector } from "@/components/admin/ImpersonationSelector"
import { SeletorArea } from "@/components/sidebar/SeletorArea"
import { BuscaMestre } from "@/components/busca/BuscaMestre"
import { useAreaDoMenu } from "@/hooks/useAreaDoMenu"
import { MENU_GRUPOS_EM_MODAL, MENU_ICONE_GRUPO, MENU_ITENS, MENU_ORDEM_GRUPOS, MENU_POR_CODIGO } from "@/lib/permissions/menu"

type Favorito = { label: string; path: string }

// Ícone dos favoritos. Os itens do menu entram por último (vencem): o favorito
// mostra o mesmo ícone do item. O que sobra aqui são rotas antigas que ainda
// podem estar gravadas no localStorage de alguém.
const pathIconLegado: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/solicitar": PlusCircle,
  "/autorizacoes-avulsas": ClipboardPlus,
  "/central-pacientes": Activity,
  "/central-terapeutas": UserRound,
  "/cadastros/pacientes": UserRound,
  "/acompanhamento/laudos": FileClock,
  "/terapeutico/prazos-pdi": CalendarClock,
  "/terapeutico/pdi-painel-analista": Gauge,
  "/auditoria-assim": ClipboardList,
  "/auditoria-assim?tab=auditoria": ClipboardList,
  "/auditoria-assim?tab=reconciliacao": Link2,
  "/conferencia-guias": ClipboardPenLine,
  "/exportar-evolucoes": FileOutput,
  "/admin": ShieldCheck,
  "/admin/permissoes": KeyRound,
  "/admin/api": Plug,
  "/connect": Zap,
  "/tv-avisos": Monitor,
  "/relacionamento-prestador/solicitacoes?tab=simulacao": UserPlus,
  "/relacionamento-prestador/solicitacoes?tab=novo-cron": CalendarPlus,
  "/relacionamento-prestador/solicitacoes?tab=banco": Database,
  "/relacionamento-prestador/ocupacao-salas": DoorOpen,
  "/cadastros/cadastro-valores": Tag,
  "/cadastros/convenios": Building2,
  "/cadastros/feriados": Calendar,
  "/cadastros/contratos": FileSignature,
  "/cadastros/taxas-e-parametros": Percent,
  "/cronograma/saida-profissional": LogOut,
  "/cronograma/ocupacao-paciente": TrendingUp,
  "/relacionamento-prestador/ocupar-profissionais-disponiveis": UserSearch,
  "/cronograma/ocupacao?tab=fila": Clock,
  "/cronograma/ocupacao?tab=recusados": XCircle,
  "/cronograma/ocupacao?tab=inviavel": AlertTriangle,
  "/cronograma/ocupacao?tab=gaps": CalendarOff,
  "/cronograma/ocupacao?tab=inconsistencias": AlertTriangle,
  "/cronograma/ocupacao?tab=guia": BookOpen,
  "/cronograma/ocupacao?tab=config": Settings,
  "/analise-tratativas": ClipboardCheck,
  "/terapeutico/auditoria-evolucoes": FileSearch,
  "/relacionamento-prestador/analise": TrendingUp,
  "/relacionamento-prestador/rp": Wallet,
  "/relacionamento-prestador/individual": UserRound,
  "/relacionamento-prestador/pep": ListChecks,
  "/relacionamento-prestador/pep-historico": History,
  "/relacionamento-prestador/auditoria-documentos": ScanText,
  "/cronograma/indicadores?tab=profissionais": BarChart3,
  "/cronograma/indicadores?tab=unidades": Building2,
  "/cronograma/indicadores?tab=pacientes": UserCheck,
  "/cronograma/indicadores?tab=previsao-receitas": Wallet,
  "/cronograma/indicadores?tab=alimentar-bd": Database,
  "/cronograma/indicadores?tab=comparativo-sessoes": ArrowRightLeft,
}

const pathIconMap: Record<string, LucideIcon> = {
  ...pathIconLegado,
  ...Object.fromEntries(MENU_ITENS.map((item) => [item.path, item.icon])),
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()
  const { theme } = useTheme()
  const { isImpersonating, canImpersonate } = useImpersonation()
  // Quem é e o que pode abrir (inclusive no "Visualizar como"): a mesma resposta
  // que o seletor de área e a busca mestre usam.
  const { role, gruposRotulo, canAccess } = usePermissoesUsuario()
  const { area, areas, escolher: escolherArea } = useAreaDoMenu()
  const [loadingLogout, setLoadingLogout] = useState(false)
  const [nome, setNome] = useState("Usuário")
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [machineId, setMachineId] = useState<string | null>(null)
  const [automacaoAtiva, setAutomacaoAtiva] = useState(true)
  const [countProcessando, setCountProcessando] = useState(0)
  const [countErros, setCountErros] = useState(0)
  const [loadingPausar, setLoadingPausar] = useState(false)
  const [loadingRetomar, setLoadingRetomar] = useState(false)
  const [loadingReiniciar, setLoadingReiniciar] = useState(false)
  const [loadingLiberar, setLoadingLiberar] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const [modalSenha, setModalSenha] = useState(false)
  const [modalErros, setModalErros] = useState(false)
  const [favoritos, setFavoritos] = useState<Favorito[]>([])
  // Grupo aberto no modal central (Cadastros, dentro de Configurações).
  const [grupoEmModal, setGrupoEmModal] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar_favoritos")
      if (stored) setFavoritos(JSON.parse(stored))
    } catch {}
  }, [])

  function toggleFavorito(label: string, path: string) {
    setFavoritos(prev => {
      const next = prev.some(f => f.path === path)
        ? prev.filter(f => f.path !== path)
        : [...prev, { label, path }]
      localStorage.setItem("sidebar_favoritos", JSON.stringify(next))
      return next
    })
  }

  function isActive(path: string) {
    const [rawPart, queryPart] = path.split("?")
    const pathPart = rawPart.replace(/\/$/, "") || "/"
    const current = pathname.replace(/\/$/, "") || "/"
    if (path === "/connect") return current === "/connect" || current.startsWith("/connect/")
    if (current !== pathPart) return false
    if (!queryPart) return true
    const expected = new URLSearchParams(queryPart)
    for (const [k, v] of expected) {
      if (searchParams.get(k) !== v) return false
    }
    return true
  }

  async function handleLogout() {
    setLoadingLogout(true)
    await supabase.auth.signOut()
    router.replace("/login")
  }

  useEffect(() => {
    async function checkUser() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError || !data.user) return
      const uid = data.user.id
      setUserId(uid)
      setEmail(data.user.email ?? "")
      const { data: maquina, error } = await supabase
        .from("maquinas")
        .select("id, nome, ativa, user_id")
        .eq("user_id", uid)
        .maybeSingle()
      if (error) console.error("Erro ao carregar dados da máquina:", error.message)
      if (maquina) {
        setMachineId(maquina.id)
        setAutomacaoAtiva(maquina.ativa ?? true)
      }
      const { data: perfil } = await supabase
        .from("usuarios")
        .select("nome")
        .eq("id", uid)
        .single()
      if (perfil?.nome) {
        setNome(perfil.nome.split(" ")[0])
      } else {
        setNome(data.user.email?.split("@")[0] || "Usuário")
      }
    }
    checkUser()
  }, [])

  // Os dois badges da fila.
  //
  // Só com a aba visível, e a cada 60 s. A Sidebar existe em toda tela, então
  // este par de contagens é multiplicado por aba aberta — em 24/08 os logs do
  // PostgREST mostram 7 chamadas de cada uma no MESMO segundo, de abas
  // esquecidas abertas, enquanto o banco já estava sem conexão livre. Não foi a
  // causa daquele incidente, mas é tráfego que não serve a ninguém: ninguém lê
  // um badge de aba que não está na frente.
  //
  // Ao voltar o foco a contagem é refeita na hora, senão o badge mostraria por
  // até um minuto um número de antes de a aba ser escondida.
  useEffect(() => {
    let vivo = true

    async function fetchCounts() {
      if (document.visibilityState !== "visible") return
      const [{ count: cp }, { count: ce }] = await Promise.all([
        supabase.from("fila_autorizacoes").select("*", { count: "exact", head: true }).eq("status", "processando"),
        supabase.from("fila_autorizacoes").select("*", { count: "exact", head: true }).eq("status", "erro"),
      ])
      if (!vivo) return
      setCountProcessando(cp ?? 0)
      setCountErros(ce ?? 0)
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 60000)
    document.addEventListener("visibilitychange", fetchCounts)
    return () => {
      vivo = false
      clearInterval(interval)
      document.removeEventListener("visibilitychange", fetchCounts)
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handlePausar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingPausar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-pause"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAutomacaoAtiva(false)
      toast.success("Automação pausada")
    } catch (err: any) { toast.error(err.message) }
    setLoadingPausar(false)
  }

  async function handleRetomar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingRetomar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-resume"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAutomacaoAtiva(true)
      toast.success("Automação retomada")
    } catch (err: any) { toast.error(err.message) }
    setLoadingRetomar(false)
  }

  async function handleReiniciar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingReiniciar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-restart"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success("Worker reiniciado")
    } catch (err: any) { toast.error("Falha ao reiniciar: " + err.message) }
    setLoadingReiniciar(false)
  }

  async function handleLiberarTravados() {
    setLoadingLiberar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-release-stuck"), {
        method: "POST",
        headers: await getFunctionHeaders(),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const plural = json.liberados !== 1 ? "s" : ""
      // `retidas` são as travadas que a função deliberadamente NÃO devolveu para a
      // fila: de outro dia, ou já com guia emitida. Sem dizer isso, um resultado
      // "0 liberados" com 30 travadas na tela parece defeito do botão.
      toast.success(
        `${json.liberados} processo${plural} liberado${plural}` +
        (json.retidas ? ` · ${json.retidas} retido${json.retidas !== 1 ? "s" : ""} (outro dia ou já autorizado)` : "")
      )
    } catch (err: any) { toast.error(err.message) }
    setLoadingLiberar(false)
  }

  function MenuItem({
    label,
    icon: Icon,
    path,
  }: {
    label: string
    icon: any
    path: string
  }) {
    const active = isActive(path)
    const isFav = favoritos.some(f => f.path === path)

    return (
      <Link
        href={path}
        className={`group flex w-full items-center gap-2.5 py-2 pr-2 rounded-lg text-sm transition-all duration-150
        ${
          active
            ? "border-l-2 border-sidebar-primary pl-2.5 font-semibold bg-sidebar-accent text-sidebar-accent-foreground"
            : "border-l-2 border-transparent pl-2.5 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon
          size={16}
          className="shrink-0"
          style={{ color: active ? "var(--color-sidebar-primary)" : "var(--color-sidebar-foreground)" }}
        />
        <span className="flex-1 text-left">{label}</span>
        {path !== "/" && (
          <span
            onClick={e => { e.preventDefault(); e.stopPropagation(); toggleFavorito(label, path) }}
            className={`p-1 rounded transition-all duration-150 hover:bg-sidebar-accent
              ${isFav
                ? "opacity-100 text-yellow-500"
                : "opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:text-yellow-500"
              }`}
          >
            <Star size={12} fill={isFav ? "currentColor" : "none"} />
          </span>
        )}
      </Link>
    )
  }

  // Rótulo, ícone e href vêm de lib/permissions/menu.ts — a mesma lista que
  // /admin/permissoes usa. É o que mantém o nome da tela igual nas duas.
  function Item({ codigo }: { codigo: string }) {
    const item = MENU_POR_CODIGO[codigo]
    return <MenuItem label={item.label} icon={item.icon} path={item.path} />
  }

  const isDark = theme === 'dark'

  // O grupo abre sozinho quando a tela aberta é dele — ou uma subpágina dela,
  // como /cadastros/pacientes/123 —, sem olhar a aba.
  const naRota = (path: string) => {
    const base = path.split("?")[0]
    return pathname === base || pathname.startsWith(base + "/")
  }
  const itensDoGrupo = (nome: string) =>
    MENU_ITENS.filter(i => i.area === area && i.grupo === nome && canAccess(i.path))
  // Grupos de MENU_GRUPOS_EM_MODAL não aparecem como grupo: viram um botão dentro
  // do grupo que os contém, e esse grupo aparece mesmo sem item próprio liberado
  // (quem só tem Cadastros vê "Configurações" com o botão de Cadastros).
  const gruposDaArea = MENU_ORDEM_GRUPOS
    .filter(nome => !(nome in MENU_GRUPOS_EM_MODAL))
    .map(nome => ({
      nome,
      itens: itensDoGrupo(nome),
      emModal: Object.keys(MENU_GRUPOS_EM_MODAL)
        .filter(sub => MENU_GRUPOS_EM_MODAL[sub] === nome)
        .map(sub => ({ nome: sub, itens: itensDoGrupo(sub) }))
        .filter(sub => sub.itens.length > 0),
    }))
    .filter(g => g.itens.length > 0 || g.emModal.length > 0)
    .map(g => ({ ...g, aberto: [...g.itens, ...g.emModal.flatMap(sub => sub.itens)].some(i => naRota(i.path)) }))
  const modal = gruposDaArea.flatMap(g => g.emModal).find(sub => sub.nome === grupoEmModal)

  // Chat da equipe: conversas (todo usuário logado — sem código de permissão
  // desde 16/10/2026) e menções em notas internas do Connect (só para quem tem
  // o Connect: a rota delas responde 401 a quem não tem papel na Central).
  // Espera o papel carregar para não consultar nada antes de saber quem é.
  const fontesChat = { conversas: !!role, mencoes: canAccess("/connect") }
  const temChatEquipe = fontesChat.conversas
  const chat = useChatEquipe()
  const naoLidas = useContadoresChatEquipe(fontesChat).total
  // Em /chat-equipe o chat já ocupa a tela: o item fica marcado e não abre o painel.
  const naPaginaChat = pathname.startsWith("/chat-equipe")
  const chatAtivo = chat.aberto || naPaginaChat

  return (
    <>
      <aside
        className="fixed top-0 left-0 w-64 h-screen flex flex-col z-50 bg-sidebar border-r border-sidebar-border transition-colors duration-300"
      >

        {/* LOGO — lockup do Pulsar.

            Duas imagens trocadas por CSS (`dark:`) em vez de um `src`
            condicional: o tema só é conhecido depois da hidratação, e trocar a
            URL ali faz o navegador buscar o outro arquivo e piscar. Com as duas
            no HTML o swap é imediato e sem requisição extra.

            E não é mais `filter: brightness(0) invert(1)`, que era o jeito de
            clarear o logo antigo: aplicado neste lockup ele achataria tudo em
            branco sólido e apagaria o ponto rosa, que é o único acento de cor
            da marca. A variante clara já existe no repo (a mesma que a /tv usa)
            e preserva o rosa. */}
        <div className="h-20 flex items-center justify-center px-6 border-b border-sidebar-border">
          <img
            src="/pulsar-lockup-1920-transparent.png"
            alt="Pulsar"
            className="max-h-full w-full object-contain dark:hidden"
          />
          {/* `max-h-[60%]` não é chute: os dois arquivos têm exatamente o mesmo
              conteúdo (1133x462), mas o de 1920x768 carrega 39,8% de margem
              transparente embutida e este aqui é recorte justo (0%). Sem
              compensar, a marca aparecia 66% maior no tema escuro e encostava
              nas bordas da barra. 60% ≈ os 60,2% que a arte ocupa no arquivo
              acolchoado, então a marca fica do mesmo tamanho nos dois temas. */}
          <img
            src="/pulsar-lockup-tv-light.png"
            alt=""
            aria-hidden="true"
            className="hidden max-h-[60%] w-full object-contain dark:block"
          />
        </div>

        {/* IMPERSONATION SELECTOR (apenas para admin) */}
        {canImpersonate && (
          <div className="px-3 py-3 border-b border-sidebar-border">
            <ImpersonationSelector />
          </div>
        )}

        {/* ÁREA + BUSCA MESTRE — o seletor troca o que o menu abaixo lista
            (Operacional · Financeiro · Relatórios · Pulsar Connect); a busca
            abre também com Ctrl+K, de qualquer tela. */}
        <div className="px-3 py-3 border-b border-sidebar-border space-y-2">
          <SeletorArea area={area} areas={areas} onEscolher={escolherArea} />
          <BuscaMestre />
        </div>

        {/* MENU */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">

          {/* Dashboard */}
          <Item codigo="dashboard" />

          {/* Chat da equipe — não é tela: abre o painel lateral do layout raiz,
              que continua aberto ao passar para o Connect (lá o item do sidebar
              abre o mesmo painel). Por isso não tem estrela de favorito. */}
          {temChatEquipe && (
            <button
              type="button"
              onClick={naPaginaChat ? undefined : chat.alternar}
              aria-expanded={chatAtivo}
              aria-label={naoLidas > 0 ? `Chat da equipe, ${naoLidas > 99 ? "99+" : naoLidas} não lidas` : undefined}
              // O destaque de "página atual" (fundo + borda) só em /chat-equipe.
              // Painel aberto não é página: com ele, Dashboard e Chat apareciam
              // os dois marcados. Aberto = só ícone e texto na cor primária.
              className={`relative flex w-full items-center gap-2.5 py-2 pr-2 rounded-lg text-sm transition-all duration-150 border-l-2 pl-2.5
              ${
                naPaginaChat
                  ? "border-sidebar-primary font-semibold bg-sidebar-accent text-sidebar-accent-foreground"
                  : chat.aberto
                    ? "border-transparent font-semibold text-sidebar-primary hover:bg-sidebar-accent/50"
                    : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              }`}
            >
              <MessagesSquare
                size={16}
                className="shrink-0"
                style={{ color: chatAtivo ? "var(--color-sidebar-primary)" : "var(--color-sidebar-foreground)" }}
              />
              <span className="flex-1 text-left">Chat da equipe</span>
              <BolinhaNaoLidas n={naoLidas} />
            </button>
          )}

          {/* Favoritos */}
          <div className="pt-2">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider select-none text-sidebar-foreground/50">
              ⭐ Favoritos
            </p>
            {favoritos
              .filter(f => canAccess(f.path))
              .map(f => (
                <MenuItem key={f.path} label={f.label} icon={pathIconMap[f.path] ?? Star} path={f.path} />
              ))}
          </div>

          <hr className="my-2 border-sidebar-border" />

          {/* Telas da área escolhida no seletor, na ordem de grupos e de itens de
              lib/permissions/menu.ts (antes cada grupo era escrito à mão aqui).
              Cada item só aparece para quem pode abrir a rota; o grupo, só com
              pelo menos um item. O Pulsar Connect saiu do rodapé: é uma área do
              seletor. */}
          {gruposDaArea.map(g => (
            <SidebarGroup key={`${area}:${g.nome}`} title={g.nome} icon={MENU_ICONE_GRUPO[g.nome]} defaultOpen={g.aberto}>
              {g.emModal.map(sub => {
                const Icone = MENU_ICONE_GRUPO[sub.nome]
                const ativo = sub.itens.some(i => naRota(i.path))
                return (
                  <button
                    key={sub.nome}
                    type="button"
                    onClick={() => setGrupoEmModal(sub.nome)}
                    aria-haspopup="dialog"
                    className={`flex w-full items-center gap-2.5 py-2 pr-2 rounded-lg text-sm transition-all duration-150 border-l-2 pl-2.5
                    ${
                      ativo
                        ? "border-sidebar-primary font-semibold bg-sidebar-accent text-sidebar-accent-foreground"
                        : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icone
                      size={16}
                      className="shrink-0"
                      style={{ color: ativo ? "var(--color-sidebar-primary)" : "var(--color-sidebar-foreground)" }}
                    />
                    <span className="flex-1 text-left">{sub.nome}</span>
                    <ChevronRight size={14} className="shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
                  </button>
                )
              })}
              {g.itens.map(i => <Item key={i.codigo} codigo={i.codigo} />)}
            </SidebarGroup>
          ))}

        </nav>

        {/* THEME SWITCHER */}
        <div className="px-4 pb-3">
          <ThemeSwitcher />
        </div>

        {/* FOOTER — PERFIL */}
        <div className="p-4 border-t border-sidebar-border" ref={menuRef}>
          <div className="relative">

            <button
              onClick={() => setOpen(!open)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-sidebar-accent/60 transition-colors duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-full bg-sidebar-primary text-white flex items-center justify-center font-semibold text-sm shrink-0">
                {nome?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">{nome}</p>
                {gruposRotulo && (
                  <p className={`text-xs leading-tight truncate ${isImpersonating ? 'text-[var(--status-atencao)] font-semibold' : 'text-sidebar-foreground/50'}`}>
                    {isImpersonating ? '👁️ ' : ''}
                    {gruposRotulo}
                  </p>
                )}
              </div>
              <span className={`text-sidebar-foreground/40 text-xs transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>

            {open && (
              <div className={`absolute bottom-full left-0 mb-2 w-72 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-3 text-sm z-999
                ${isDark
                  ? "bg-linear-to-br from-[#1f3f5b] to-[#2f6f95] text-white"
                  : "bg-white border border-sidebar-border text-slate-800"
                }`}
              >

                <div className="px-3 pb-3">
                  <div className="text-sm font-semibold">{nome}</div>
                  <div className={`text-xs ${isDark ? "text-white/60" : "text-slate-500"}`}>{email || "—"}</div>
                </div>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 text-xs mb-1 ${isDark ? "text-white/50" : "text-slate-400"}`}>Conta</div>

                <button
                  onClick={() => { setOpen(false); setModalPerfil(true) }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition ${isDark ? "hover:bg-white/10 active:bg-white/20" : "hover:bg-slate-50 active:bg-slate-100"}`}
                >
                  Meu perfil
                </button>

                <button
                  onClick={() => { setOpen(false); setModalSenha(true) }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition ${isDark ? "hover:bg-white/10 active:bg-white/20" : "hover:bg-slate-50 active:bg-slate-100"}`}
                >
                  Alterar senha
                </button>

                <Link
                  href="/conta/seguranca"
                  onClick={() => setOpen(false)}
                  className={`block w-full text-left px-3 py-2 rounded-lg transition ${isDark ? "hover:bg-white/10 active:bg-white/20" : "hover:bg-slate-50 active:bg-slate-100"}`}
                >
                  Segurança da conta
                </Link>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 py-2 text-xs flex justify-between mb-1 ${isDark ? "text-white/50" : "text-slate-400"}`}>
                  <span>Automação</span>
                  <span className={`flex items-center gap-2 font-medium ${automacaoAtiva ? "text-green-500" : "text-orange-500"}`}>
                    <span className={`w-2 h-2 rounded-full ${automacaoAtiva ? "bg-green-400" : "bg-orange-400"}`} />
                    {automacaoAtiva ? "Ativa" : "Pausada"}
                  </span>
                </div>

                {automacaoAtiva ? (
                  <button
                    onClick={handlePausar}
                    disabled={loadingPausar}
                    className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                  >
                    {loadingPausar ? "Pausando..." : "Pausar automação"}
                  </button>
                ) : (
                  <button
                    onClick={handleRetomar}
                    disabled={loadingRetomar}
                    className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                  >
                    {loadingRetomar ? "Retomando..." : "Retomar automação"}
                  </button>
                )}

                <button
                  onClick={handleReiniciar}
                  disabled={loadingReiniciar}
                  className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                >
                  {loadingReiniciar ? "Reiniciando..." : "Reiniciar worker"}
                </button>

                <button
                  onClick={handleLiberarTravados}
                  disabled={loadingLiberar}
                  className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                >
                  {loadingLiberar ? "Liberando..." : "Liberar processos travados"}
                </button>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 py-2 text-xs flex justify-between ${isDark ? "text-white/70" : "text-slate-500"}`}>
                  <span>{countProcessando} em processamento</span>
                  {countErros > 0 ? (
                    <button
                      onClick={() => { setOpen(false); setModalErros(true) }}
                      className="text-red-500 font-medium hover:text-red-600 transition"
                    >
                      {countErros} erro{countErros !== 1 ? "s" : ""}
                    </button>
                  ) : (
                    <span className={isDark ? "text-white/40" : "text-slate-400"}>0 erros</span>
                  )}
                </div>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <button
                  onClick={handleLogout}
                  disabled={loadingLogout}
                  className="w-full text-left px-3 py-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingLogout ? "Saindo..." : "Sair"}
                </button>

              </div>
            )}

          </div>
        </div>

      </aside>

      {userId && (
        <>
          <ModalPerfil open={modalPerfil} onClose={() => setModalPerfil(false)} userId={userId} />
          <ModalAlterarSenha open={modalSenha} onClose={() => setModalSenha(false)} email={email} />
        </>
      )}
      <ModalErros open={modalErros} onClose={() => setModalErros(false)} />
      {modal && (
        <ModalGrupoMenu
          titulo={modal.nome}
          icon={MENU_ICONE_GRUPO[modal.nome]}
          itens={modal.itens}
          aberto
          onFechar={() => setGrupoEmModal(null)}
          isActive={naRota}
          isFavorito={path => favoritos.some(f => f.path === path)}
          onAlternarFavorito={toggleFavorito}
        />
      )}
    </>
  )
}
