/**
 * Tema do app: a identidade do Pulsar (DESIGN.md na raiz do repositório e a
 * tela de login do Pulsar web). Toda cor, fonte, espaçamento e canto vem daqui.
 *
 * - Azul-petróleo é a ÚNICA cor de marca na interface: ação principal, ícones,
 *   horário e terapia. Não pinta fundo de seção.
 * - Cor de status (Grade) só aparece no selo do status — ver utils/status-sessao.
 * - O azul-marinho e o rosa do logotipo ficam no logotipo, ícone e abertura.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** Texto principal (slate-800). */
    text: '#1e293b',
    /** Texto de apoio (slate-600). */
    textSecondary: '#475569',
    /** Texto terciário: metadados, rodapés (slate-500, 4,8:1 no branco). */
    textMuted: '#64748b',
    /** Fundo da tela: o "clinical ground" do Pulsar. */
    background: '#f3f8fa',
    /** Cartões, campos e cabeçalho. */
    surface: '#ffffff',
    /** O que fica por cima de um trilho (aba escolhida). */
    surfaceRaised: '#ffffff',
    /** Superfície neutra rebaixada (trilho das abas, botão secundário). */
    backgroundElement: '#eef2f6',
    /** Item escolhido / avatar: azul-petróleo bem claro. */
    backgroundSelected: '#e6f2f7',
    border: '#e2e8f0',
    divider: '#f1f5f9',
    /** Azul-petróleo do Pulsar: botão principal e texto de marca (7,4:1 no branco). */
    accent: '#1e5a7d',
    /** Azul-petróleo claro: ícones e anel de foco (não usar em texto miúdo). */
    accentIcon: '#3a8fb7',
    onAccent: '#ffffff',
    danger: '#be123c',
    dangerSurface: '#fff1f2',
  },
  dark: {
    text: '#e2e8f0',
    textSecondary: '#a5b4c3',
    textMuted: '#8494a7',
    background: '#0b1317',
    surface: '#131d22',
    surfaceRaised: '#24353d',
    backgroundElement: '#1a262c',
    backgroundSelected: '#173341',
    border: '#24333b',
    divider: '#1a262c',
    accent: '#6cb8d8',
    accentIcon: '#6cb8d8',
    onAccent: '#071a24',
    danger: '#fb7185',
    dangerSurface: '#2a1218',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Marca (logotipo, ícone, abertura). Não usar na interface. */
export const Marca = {
  marinho: '#222847',
  rosa: '#E6357E',
} as const;

/** Geist, a mesma família do Pulsar web; um arquivo por peso (carregados no _layout). */
export const Fonte = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
} as const;

export const Fonts = Platform.select({
  ios: { mono: 'ui-monospace' },
  default: { mono: 'monospace' },
  web: { mono: 'var(--font-mono)' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  /** 12: respiro interno de linha e de selo. */
  twoHalf: 12,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Cantos do Pulsar: campo e botão 14, cartão 18, selo em cápsula. */
export const Radius = {
  sm: 8,
  md: 14,
  lg: 18,
  full: 999,
} as const;

/** A única sombra do Pulsar: tira o cartão do fundo, não indica toque. */
export const Shadow = {
  card: '0 1px 2px rgba(15, 23, 42, 0.05)',
} as const;

/** Alvo de toque mínimo (o Pulsar usa 44; botões de formulário ficam em 48). */
export const Toque = {
  minimo: 44,
  botao: 48,
} as const;

export const MaxContentWidth = 800;
