import {
  Accessibility, Award, Backpack, Binoculars, Blocks, BookOpen, BookOpenCheck, Brain, Brush, Carrot, ChefHat,
  ClipboardCheck, Cog, Compass, Dumbbell, GraduationCap, HandHelping, Handshake, HeartHandshake, House, Lightbulb,
  MapPinned, MessageCircle, MessageCircleHeart, Music, Paintbrush, Palette, PersonStanding, Piano, Presentation,
  Route, Salad, ScanSearch, School, Shirt, Smile, Sparkles, Speech, Sprout, Stethoscope, Target, Trophy, Users,
  UtensilsCrossed, Waves, Wrench, type LucideProps,
} from "lucide-react"
import type { ComponentType } from "react"

// Ícones das terapias (avatar do profissional no lugar das iniciais).
//
// A CHAVE fica no banco (cadastro_terapias.icone — 20261006150000) e é
// escolhida na grade do Cadastro de Terapias; o desenho fica aqui. Todos de
// lucide-react, menos o cavalo da Equoterapia (lucide não tem cavalo — desenhado
// no mesmo traço: 24×24, stroke 2, pontas arredondadas). Nada de animais além
// dele (pedido do usuário) e nada de peça de quebra-cabeça para ABA.

type IconeComp = ComponentType<LucideProps>

/** Cabeça de cavalo de perfil, no traço do lucide. */
function Cavalo({ size = 24, strokeWidth = 2, className, ...resto }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...resto}
    >
      {/* cabeça de perfil: pescoço, mandíbula, focinho, testa, orelha, nuca e crina */}
      <path d="M12 22v-4.5c-1.6-.4-3.1-.7-4.6-1l-2.5-.6a1.6 1.6 0 0 1-1.2-2l.4-1.4L9 6l2-4 1.8 2.6c3.5.6 6.4 3.4 7 7L20 22" />
      <path d="M14.4 5.6c1.6.8 2.8 2.2 3.4 3.9" />
      <circle cx="10.6" cy="9" r=".8" fill="currentColor" stroke="none" />
      <path d="M5.6 13.6h.01" />
    </svg>
  )
}

export type OpcaoIcone = { chave: string; rotulo: string; Icone: IconeComp }

/** Na ordem em que aparecem na grade de escolha. */
export const ICONES_TERAPIA: OpcaoIcone[] = [
  { chave: "target", rotulo: "Alvo", Icone: Target },
  { chave: "brush", rotulo: "Pincel largo", Icone: Brush },
  { chave: "paintbrush", rotulo: "Pincel", Icone: Paintbrush },
  { chave: "palette", rotulo: "Paleta", Icone: Palette },
  { chave: "clipboard-check", rotulo: "Prancheta com visto", Icone: ClipboardCheck },
  { chave: "dumbbell", rotulo: "Haltere", Icone: Dumbbell },
  { chave: "users", rotulo: "Grupo", Icone: Users },
  { chave: "message-circle-heart", rotulo: "Conversa com coração", Icone: MessageCircleHeart },
  { chave: "message-circle", rotulo: "Conversa", Icone: MessageCircle },
  { chave: "backpack", rotulo: "Mochila", Icone: Backpack },
  { chave: "house", rotulo: "Casa", Icone: House },
  { chave: "school", rotulo: "Escola", Icone: School },
  { chave: "hand-helping", rotulo: "Mão ajudando", Icone: HandHelping },
  { chave: "music", rotulo: "Nota musical", Icone: Music },
  { chave: "piano", rotulo: "Piano", Icone: Piano },
  { chave: "utensils-crossed", rotulo: "Talheres", Icone: UtensilsCrossed },
  { chave: "salad", rotulo: "Salada", Icone: Salad },
  { chave: "carrot", rotulo: "Cenoura", Icone: Carrot },
  { chave: "chef-hat", rotulo: "Chapéu de chef", Icone: ChefHat },
  { chave: "shirt", rotulo: "Camiseta", Icone: Shirt },
  { chave: "wrench", rotulo: "Chave inglesa", Icone: Wrench },
  { chave: "cog", rotulo: "Engrenagem", Icone: Cog },
  { chave: "sprout", rotulo: "Broto", Icone: Sprout },
  { chave: "brain", rotulo: "Cérebro", Icone: Brain },
  { chave: "book-open", rotulo: "Livro aberto", Icone: BookOpen },
  { chave: "book-open-check", rotulo: "Livro com visto", Icone: BookOpenCheck },
  { chave: "route", rotulo: "Trajeto", Icone: Route },
  { chave: "compass", rotulo: "Bússola", Icone: Compass },
  { chave: "cavalo", rotulo: "Cavalo", Icone: Cavalo },
  { chave: "award", rotulo: "Medalha", Icone: Award },
  { chave: "trophy", rotulo: "Troféu", Icone: Trophy },
  { chave: "graduation-cap", rotulo: "Formatura", Icone: GraduationCap },
  { chave: "lightbulb", rotulo: "Lâmpada", Icone: Lightbulb },
  { chave: "accessibility", rotulo: "Movimento", Icone: Accessibility },
  { chave: "person-standing", rotulo: "Pessoa", Icone: PersonStanding },
  { chave: "waves", rotulo: "Ondas", Icone: Waves },
  { chave: "speech", rotulo: "Fala", Icone: Speech },
  { chave: "handshake", rotulo: "Aperto de mãos", Icone: Handshake },
  { chave: "heart-handshake", rotulo: "Mãos e coração", Icone: HeartHandshake },
  { chave: "blocks", rotulo: "Blocos", Icone: Blocks },
  { chave: "presentation", rotulo: "Apresentação", Icone: Presentation },
  { chave: "stethoscope", rotulo: "Estetoscópio", Icone: Stethoscope },
  { chave: "binoculars", rotulo: "Binóculo", Icone: Binoculars },
  { chave: "scan-search", rotulo: "Lupa", Icone: ScanSearch },
  { chave: "smile", rotulo: "Sorriso", Icone: Smile },
  { chave: "map-pinned", rotulo: "Mapa", Icone: MapPinned },
  { chave: "sparkles", rotulo: "Estrelinhas", Icone: Sparkles },
]

const POR_CHAVE = new Map(ICONES_TERAPIA.map(o => [o.chave, o]))
const PADRAO = POR_CHAVE.get("sparkles")!

/** Opção do ícone pela chave; sem chave ou chave desconhecida → estrelinhas. */
export function opcaoIcone(chave: string | null | undefined): OpcaoIcone {
  return (chave && POR_CHAVE.get(chave)) || PADRAO
}

/**
 * Desenha o ícone da terapia. Recebe a CHAVE (string) e resolve por acesso a
 * membro de objeto — `react-hooks/static-components` reclama de componente
 * obtido por chamada de função e usado como `<X />`.
 */
export function IconeTerapia({ chave, ...props }: LucideProps & { chave: string | null | undefined }) {
  const opcao = opcaoIcone(chave)
  return <opcao.Icone aria-hidden="true" {...props} />
}
