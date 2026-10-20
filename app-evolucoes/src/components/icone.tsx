import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Os ícones do app, com o nome de cada plataforma: SF Symbol no iOS e Material
 * Symbol no Android e na web (o expo-symbols carrega a fonte sozinho). Ícone novo entra
 * aqui, nunca solto numa tela.
 */
const ICONES = {
  agenda: { ios: 'calendar', android: 'calendar_today' },
  anterior: { ios: 'chevron.left', android: 'chevron_left' },
  proximo: { ios: 'chevron.right', android: 'chevron_right' },
  abrir: { ios: 'chevron.right', android: 'chevron_right' },
  relogio: { ios: 'clock', android: 'schedule' },
  local: { ios: 'mappin.and.ellipse', android: 'location_on' },
  pessoa: { ios: 'person', android: 'person' },
  cobertura: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  evolucao: { ios: 'square.and.pencil', android: 'edit_note' },
  falta: { ios: 'calendar.badge.minus', android: 'event_busy' },
  buscar: { ios: 'magnifyingglass', android: 'search' },
  sair: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  celular: { ios: 'iphone', android: 'smartphone' },
  cadeado: { ios: 'lock', android: 'lock' },
  aviso: { ios: 'exclamationmark.circle', android: 'error' },
  ok: { ios: 'checkmark.circle', android: 'check_circle' },
  temaClaro: { ios: 'sun.max', android: 'light_mode' },
  temaEscuro: { ios: 'moon', android: 'dark_mode' },
} as const satisfies Record<string, { ios: SymbolViewProps['name'] & string; android: string }>;

export type NomeIcone = keyof typeof ICONES;

type IconeProps = {
  nome: NomeIcone;
  tamanho?: 16 | 20 | 24 | 32;
  /** Cor do tema; o padrão é o azul-petróleo de ícone. */
  cor?: ThemeColor;
  /** Cor fora do tema (ex.: a cor de um status). */
  corLivre?: ColorValue;
};

/** Decorativo: quem dá o nome acessível é o texto ou o botão ao lado. */
export function Icone({ nome, tamanho = 20, cor = 'accentIcon', corLivre }: IconeProps) {
  const theme = useTheme();
  const { ios, android } = ICONES[nome];
  return (
    <SymbolView
      name={{ ios, android, web: android } as SymbolViewProps['name']}
      size={tamanho}
      tintColor={corLivre ?? theme[cor]}
      resizeMode="scaleAspectFit"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: tamanho, height: tamanho }}
    />
  );
}
