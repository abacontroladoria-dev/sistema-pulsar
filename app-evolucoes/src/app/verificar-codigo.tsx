import { Redirect, useLocalSearchParams } from 'expo-router';

import { VerificarCodigo } from '@/screens/verificar-codigo';

export default function VerificarCodigoRoute() {
  const { telefone } = useLocalSearchParams<{ telefone?: string }>();

  // Aberta sem o celular (deep link, app reaberto): volta para pedir o código.
  if (!telefone) return <Redirect href="/login" />;

  return <VerificarCodigo telefone={telefone} />;
}
