import { useLocalSearchParams } from 'expo-router';

import { Sessao } from '@/screens/agenda/sessao';

export default function SessaoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Sessao id={id} />;
}
