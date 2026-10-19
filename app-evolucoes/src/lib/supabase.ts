import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from '@/lib/secure-storage';

// Mesmo projeto Supabase do Pulsar. A chave publishable é pública por definição:
// quem protege o dado é o RLS/RPC no banco. Nunca colocar service role aqui.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const chavePublishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !chavePublishable) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY precisam estar no .env.local (veja .env.example).',
  );
}

export const supabase = createClient(url, chavePublishable, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No celular não há URL de onde ler a sessão; login é por senha ou código.
    detectSessionInUrl: false,
  },
});

// Renova o token só com o app em primeiro plano, como recomenda o Supabase para RN.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (estado) => {
    if (estado === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
