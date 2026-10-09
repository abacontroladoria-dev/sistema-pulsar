"use client"

import {
  LayoutDashboard,
  PlusCircle,
  Activity,
  FileText,
  ShieldCheck,
  ClipboardList,
  ClipboardPlus,
  ClipboardPenLine,
  ListChecks,
  Link2,
  CalendarDays,
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
  CalendarClock,
  Gauge,
  FileSearch,
  type LucideIcon,
} from "lucide-react"
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
import { ThemeSwitcher } from "@/components/sidebar/ThemeSwitcher"
import { useTheme } from "@/contexts/ThemeContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { ImpersonationSelector } from "@/components/admin/ImpersonationSelector"
import { podeAcessarRota, uniaoDosModelos } from "@/lib/permissions/resolver"
import { carregarGruposDoUsuario, carregarPermissoesEfetivas, rotuloDosGrupos } from "@/lib/permissions/carregar"
import { MENU_GRUPOS as GRUPO, MENU_ITENS, MENU_POR_CODIGO } from "@/lib/permissions/menu"

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
  "/cco": BarChart3,
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
  const { isImpersonating, impersonatedTarget, canImpersonate } = useImpersonation()
  const [loadingLogout, setLoadingLogout] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)
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
  // Guarda os CÓDIGOS, não as rotas já convertidas: `podeAcessarRota` (a mesma do
  // proxy.ts) faz a conversão por dentro, e é o que mantém menu e navegação com
  // uma implementação só.
  const [codigos, setCodigos] = useState<Set<string>>(new Set())
  // Os grupos de permissão mostrados no rodapé, embaixo do nome — no lugar do
  // nível técnico (`role`), que é só do banco. `null`: rótulo vazio.
  const [gruposRotulo, setGruposRotulo] = useState<string | null>(null)

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

  function canAccess(path: string) {
    if (!role) return false
    // `podeAcessarRota` é a MESMA função do proxy.ts, o gate real da navegação —
    // inclusive o "admin acessa tudo". Enquanto eram duas implementações, o admin
    // abria /autorizacoes-avulsas pelo link e não via o item no menu.
    const [barePath, query] = path.split("?")
    return podeAcessarRota(role, codigos, barePath, query ? `?${query}` : "")
  }

  useEffect(() => {
    let isMounted = true

    async function loadRole() {
      let targetId: string | undefined
      let targetGrupoId: string | undefined
      let targetRole: string | null

      if (isImpersonating && impersonatedTarget) {
        targetId = impersonatedTarget.id
        targetGrupoId = impersonatedTarget.grupoId
        targetRole = impersonatedTarget.role
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (isMounted) setLoadingRole(false)
          return
        }
        targetId = user.id
        const { data } = await supabase
          .from("usuarios")
          .select("role")
          .eq("id", user.id)
          .single()
        targetRole = data?.role || null
      }

      if (!isMounted) return

      setRole(targetRole)

      if (!targetRole) {
        setCodigos(new Set())
        setLoadingRole(false)
        return
      }

      // Telas efetivas pelo banco (grupos ao vivo + ajustes individuais) — o
      // mesmo carregador do proxy.ts e das rotas de API. "Visualizar como grupo"
      // mostra o modelo daquele grupo sozinho, sem pessoa por trás.
      let resolvidos = new Set<string>()
      let rotulo: string | null = null
      try {
        if (targetGrupoId) {
          const { data } = await supabase
            .from("grupos_permissoes")
            .select("nome, modelo_permissoes")
            .eq("id", targetGrupoId)
            .maybeSingle()
          resolvidos = uniaoDosModelos([(data?.modelo_permissoes as Record<string, boolean>) ?? {}])
          rotulo = (data?.nome as string | undefined) ?? null
        } else {
          const alvo = isImpersonating ? targetId : undefined
          const [c, g] = await Promise.all([
            carregarPermissoesEfetivas(supabase, alvo),
            carregarGruposDoUsuario(supabase, alvo),
          ])
          resolvidos = c
          rotulo = rotuloDosGrupos(g)
        }
      } catch (error) {
        console.error("Erro ao carregar permissões do usuário:", error)
      }

      if (isMounted) {
        setCodigos(resolvidos)
        setGruposRotulo(rotulo)
        setLoadingRole(false)
      }
    }

    loadRole()

    return () => {
      isMounted = false
    }
  }, [isImpersonating, impersonatedTarget, supabase])

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

        {/* MENU */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">

          {/* Dashboard */}
          <Item codigo="dashboard" />

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

          {/* Pacientes */}
          {(canAccess("/solicitar") || canAccess("/autorizacoes-avulsas") || canAccess("/central-pacientes") ||
            canAccess("/acompanhamento/laudos") || canAccess("/acompanhamento/contratos") || canAccess("/outros-convenios")) && (
            <SidebarGroup
              title={GRUPO.pacientes.nome}
              icon={GRUPO.pacientes.icon}
              defaultOpen={["/solicitar", "/autorizacoes-avulsas", "/central-pacientes", "/acompanhamento/laudos", "/acompanhamento/contratos", "/outros-convenios"].some(p => pathname === p)}
            >
              {canAccess("/solicitar") && (
                <Item codigo="atendimentos" />
              )}
              {canAccess("/central-pacientes") && (
                <Item codigo="gestao" />
              )}
              {canAccess("/autorizacoes-avulsas") && (
                <Item codigo="autorizacoes_avulsas" />
              )}
              {/* Fila de laudos vencidos + registro do aviso ao responsável.
                  Neste grupo, e não em Autorização (ao lado da Reconciliação) nem
                  em Cadastros: quem trabalha aqui é a recepção, e o grupo
                  Pacientes é onde as outras telas dela já estão. Decisão do
                  usuário em 28/08/2026. */}
              {canAccess("/acompanhamento/laudos") && (
                <Item codigo="acompanhamento_laudos" />
              )}
              {/* Contratos do paciente: assinatura e vigência, no mesmo molde
                  da Status Laudos e Senhas. Só leitura — criar e assinar é na
                  aba Contratos da ficha do paciente. */}
              {canAccess("/acompanhamento/contratos") && (
                <Item codigo="status_contratos" />
              )}
              {/* A tela existia sem item no menu (só abria pela URL). Entrou em
                  29/09/2026, quando o catálogo de permissões passou a espelhar
                  o Sidebar — decisão do usuário. */}
              {canAccess("/outros-convenios") && (
                <Item codigo="outros_convenios" />
              )}
            </SidebarGroup>
          )}

          {/* Terapêutico */}
          {(canAccess("/central-terapeutas") || canAccess("/analise-tratativas") || canAccess("/terapeutico/auditoria-evolucoes") || canAccess("/terapeutico/prazos-pdi") || canAccess("/terapeutico/pdi-painel-analista")) && (
            <SidebarGroup
              title={GRUPO.terapeutico.nome}
              icon={GRUPO.terapeutico.icon}
              defaultOpen={["/central-terapeutas", "/analise-tratativas", "/terapeutico/auditoria-evolucoes", "/terapeutico/prazos-pdi", "/terapeutico/pdi-painel-analista"].some(p => pathname === p)}
            >
              {canAccess("/central-terapeutas") && (
                <Item codigo="escala_terapeutica" />
              )}
              {canAccess("/analise-tratativas") && (
                <Item codigo="analise_tratativas" />
              )}
              {canAccess("/terapeutico/auditoria-evolucoes") && (
                <Item codigo="terapeutico_auditoria_evolucoes" />
              )}
              {canAccess("/terapeutico/prazos-pdi") && (
                <Item codigo="terapeutico_pdi" />
              )}
              {canAccess("/terapeutico/pdi-painel-analista") && (
                <Item codigo="terapeutico_pdi_painel" />
              )}
            </SidebarGroup>
          )}

          {/* Autorização */}
          {(canAccess("/auditoria-assim?tab=auditoria") || canAccess("/auditoria-assim?tab=reconciliacao") ||
            canAccess("/cco") || canAccess("/conferencia-guias")) && (
            <SidebarGroup
              title={GRUPO.autorizacao.nome}
              icon={GRUPO.autorizacao.icon}
              defaultOpen={["/cco", "/auditoria-assim", "/conferencia-guias"].some(p => pathname === p)}
            >
              {canAccess("/cco") && (
                <Item codigo="cco" />
              )}
              {/* Duas abas da mesma rota, cada uma com código próprio desde
                  29/09/2026 (auditoria_assim / reconciliacao_assim). Quem pode
                  VINCULAR na Reconciliação continua decidido pelas RPCs
                  (admin/autorizacao/recepcao), não aqui — diretoria consulta sem
                  escrever. */}
              {canAccess("/auditoria-assim?tab=auditoria") && (
                <Item codigo="auditoria_assim" />
              )}
              {canAccess("/auditoria-assim?tab=reconciliacao") && (
                <Item codigo="reconciliacao_assim" />
              )}
              {canAccess("/conferencia-guias") && (
                <Item codigo="conferencia_guias" />
              )}
            </SidebarGroup>
          )}

          {/* Insumos — controle de compras (porte do AXIUM). Grupo próprio, e não
              dentro de Faturamento: aquele grupo é faturamento de convênio
              (ASSIM), este é compra de insumo. Vai crescer com Estoque. */}
          {canAccess("/insumos") && (
            <SidebarGroup title={GRUPO.suprimentos.nome} icon={GRUPO.suprimentos.icon} defaultOpen={pathname === "/insumos"}>
              <Item codigo="insumos" />
            </SidebarGroup>
          )}

          {/* Cronograma */}
          {(canAccess("/cronograma/grade") ||
            canAccess("/cronograma/saida-profissional") || canAccess("/cronograma/ocupacao-paciente") ||
            canAccess("/cronograma/ocupacao?tab=oportunidades-recusadas") || canAccess("/cronograma/ocupacao?tab=gaps") ||
            canAccess("/cronograma/ocupacao?tab=inconsistencias") ||
            canAccess("/cronograma/reposicao")) && (
            <SidebarGroup
              title={GRUPO.cronograma.nome}
              icon={GRUPO.cronograma.icon}
              defaultOpen={[
                "/cronograma/grade",
                "/cronograma/saida-profissional",
                "/cronograma/ocupacao-paciente",
                "/cronograma/reposicao",
              ].includes(pathname) || pathname === "/cronograma/ocupacao"}
            >
              {canAccess("/cronograma/grade") && <Item codigo="cronograma_grade" />}
              {canAccess("/cronograma/saida-profissional") && <Item codigo="cronograma_saida_profissional" />}
              {canAccess("/cronograma/ocupacao-paciente") && <Item codigo="cronograma_ocupacao_paciente" />}
              {canAccess("/cronograma/reposicao") && <Item codigo="reposicao_faltas" />}
              {canAccess("/cronograma/ocupacao?tab=oportunidades-recusadas") && <Item codigo="ocupacao_clinica" />}
              {canAccess("/cronograma/ocupacao?tab=gaps") && <Item codigo="ocupacao_clinica_gaps" />}
              {canAccess("/cronograma/ocupacao?tab=inconsistencias") && <Item codigo="ocupacao_clinica_inconsistencias" />}
            </SidebarGroup>
          )}

          {/* Indicadores — uma permissão por aba, não uma pra rota inteira */}
          {(canAccess("/cronograma/indicadores?tab=profissionais") ||
            canAccess("/cronograma/indicadores?tab=unidades") ||
            canAccess("/cronograma/indicadores?tab=pacientes") ||
            canAccess("/cronograma/indicadores?tab=previsao-receitas") ||
            canAccess("/cronograma/indicadores?tab=alimentar-bd") ||
            canAccess("/cronograma/indicadores?tab=comparativo-sessoes")) && (
            <SidebarGroup title={GRUPO.indicadores.nome} icon={GRUPO.indicadores.icon} defaultOpen={pathname === "/cronograma/indicadores"}>
              {canAccess("/cronograma/indicadores?tab=profissionais") && (
                <Item codigo="ocupacao_profissionais" />
              )}
              {canAccess("/cronograma/indicadores?tab=unidades") && (
                <Item codigo="indicadores_ocupacao_unidades" />
              )}
              {canAccess("/cronograma/indicadores?tab=pacientes") && (
                <Item codigo="indicadores_pacientes" />
              )}
              {canAccess("/cronograma/indicadores?tab=previsao-receitas") && (
                <Item codigo="indicadores_previsao_receitas" />
              )}
              {canAccess("/cronograma/indicadores?tab=alimentar-bd") && (
                <Item codigo="indicadores_alimentar_bd" />
              )}
              {canAccess("/cronograma/indicadores?tab=comparativo-sessoes") && (
                <Item codigo="indicadores_comparativo_sessoes" />
              )}
            </SidebarGroup>
          )}

          {/* Cadastros */}
          {(canAccess("/cadastros/cadastro-valores") || canAccess("/cadastros/feriados") ||
            canAccess("/cadastros/contratos") || canAccess("/cadastros/taxas-e-parametros") ||
            canAccess("/cadastros/pacientes") || canAccess("/cadastros/convenios") ||
            canAccess("/cadastros/terapias") || canAccess("/cadastros/profissionais")) && (
            <SidebarGroup
              title={GRUPO.cadastros.nome}
              icon={GRUPO.cadastros.icon}
              defaultOpen={pathname.startsWith("/cadastros")}
            >
              {canAccess("/cadastros/pacientes") && <Item codigo="cadastros_pacientes" />}
              {canAccess("/cadastros/profissionais") && <Item codigo="cadastros_profissionais" />}
              {canAccess("/cadastros/terapias") && <Item codigo="cadastros_terapias" />}
              {canAccess("/cadastros/convenios") && <Item codigo="cadastros_convenios" />}
              {canAccess("/cadastros/cadastro-valores") && <Item codigo="cronograma_valores_convenio" />}
              {canAccess("/cadastros/feriados") && <Item codigo="cadastros_feriados" />}
              {canAccess("/cadastros/taxas-e-parametros") && <Item codigo="cadastros_taxas" />}
              {canAccess("/cadastros/contratos") && <Item codigo="cadastros_contratos" />}
            </SidebarGroup>
          )}

          {/* Relacionamento Prestador */}
          {(canAccess("/relacionamento-prestador/analise") || canAccess("/relacionamento-prestador/rp") ||
            canAccess("/relacionamento-prestador/individual") || canAccess("/relacionamento-prestador/pep") ||
            canAccess("/relacionamento-prestador/pep-historico") ||
            canAccess("/relacionamento-prestador/ocupacao-salas") ||
            canAccess("/relacionamento-prestador/solicitacoes") ||
            canAccess("/relacionamento-prestador/ocupar-profissionais-disponiveis")) && (
            <SidebarGroup
              title={GRUPO.relacionamentoPrestador.nome}
              icon={GRUPO.relacionamentoPrestador.icon}
              defaultOpen={pathname.startsWith("/relacionamento-prestador")}
            >
              {canAccess("/relacionamento-prestador/ocupacao-salas") && (
                <Item codigo="cronograma_ocupacao_salas" />
              )}
              {canAccess("/relacionamento-prestador/solicitacoes") && (
                <Item codigo="cronograma_solicitacoes" />
              )}
              {canAccess("/relacionamento-prestador/ocupar-profissionais-disponiveis") && (
                <Item codigo="cronograma_disponibilidade_interna" />
              )}
              {canAccess("/relacionamento-prestador/analise") && (
                <Item codigo="relacionamento_prestador_analise" />
              )}
              {canAccess("/relacionamento-prestador/rp") && (
                <Item codigo="relacionamento_prestador_rp" />
              )}
              {canAccess("/relacionamento-prestador/individual") && (
                <Item codigo="relacionamento_prestador_individual" />
              )}
              {canAccess("/relacionamento-prestador/pep") && (
                <Item codigo="relacionamento_prestador_pep" />
              )}
              {canAccess("/relacionamento-prestador/pep-historico") && (
                <Item codigo="relacionamento_prestador_pep_historico" />
              )}
            </SidebarGroup>
          )}

          {/* Marketing */}
          {/* Grupo PRÓPRIO, e não um item dentro de Administração (onde nasceu):
              quem opera isto é o marketing, que não administra o sistema — o
              único vizinho ali seriam Usuários e Permissões, telas que este setor
              nunca vai abrir. E o rótulo do item diz o LUGAR ("TV da Recepção"),
              não o meio: a única dúvida de quem prepara um cartaz é onde ele vai
              aparecer. */}
          {canAccess("/tv-avisos") && (
            <SidebarGroup
              title={GRUPO.marketing.nome}
              icon={GRUPO.marketing.icon}
              defaultOpen={pathname === "/tv-avisos"}
            >
              <Item codigo="tv_avisos" />
            </SidebarGroup>
          )}

          {/* Administração */}
          {/* "Usuários" é condicional, e não incondicional como já foi: sem isso
              apareceria para quem não tem /admin. O grupo aparece com qualquer
              um dos três — cada item tem código próprio, e quem só tem a API
              não pode ficar sem caminho até ela. */}
          {(canAccess("/admin") || canAccess("/admin/permissoes") || canAccess("/admin/api") || canAccess("/admin/robo-sharepoint")) && (
            <SidebarGroup
              title={GRUPO.administracao.nome}
              icon={GRUPO.administracao.icon}
              defaultOpen={["/admin", "/admin/permissoes", "/admin/api", "/admin/robo-sharepoint"].some(p => pathname === p)}
            >
              {canAccess("/admin") && (
                <Item codigo="usuarios" />
              )}
              {canAccess("/admin/permissoes") && (
                <Item codigo="permissoes" />
              )}
              {canAccess("/admin/api") && (
                <Item codigo="api_integracao" />
              )}
              {canAccess("/admin/robo-sharepoint") && (
                <Item codigo="robo_sharepoint" />
              )}
            </SidebarGroup>
          )}

          {/* Pulsar Connect — o proxy só libera /connect para admin ou para quem
              recebeu a permissão `connect`. Antes o item aparecia para todos e
              levava a /sem-permissao. */}
          {canAccess("/connect") && (
            <>
              <hr className="my-2 border-sidebar-border" />
              <Item codigo="connect" />
            </>
          )}

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
                  <p className={`text-xs leading-tight truncate ${isImpersonating ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-sidebar-foreground/50'}`}>
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
    </>
  )
}
