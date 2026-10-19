# Contexto do projeto: app mobile (Android + iOS)

## Decisões tomadas
- Publicação: conta de ORGANIZAÇÃO (CNPJ) no Google Play e na Apple
- Tecnologia: Expo (React Native) + TypeScript, com EAS Build e EAS Submit
  (decidido em 19/10/2026: não há Mac; mesma stack do Pulsar web, reaproveita
  tipos, supabase-js e `frontend/lib/grade/evolucaoStatus.ts`)
- Testes iOS: iPhone físico com development build (sem simulador sem Mac)
- Monetização: app gratuito, sem compras no app
- Backend: Supabase (região São Paulo, sa-east-1), o MESMO projeto do Pulsar

## Perfis de acesso (um app só, dois perfis)
- Cada pessoa tem UM papel só: terapeuta OU responsável. Sem tela de escolha
  de perfil; o login já leva à área certa (route groups no Expo Router).
- **Terapeuta:** cria evolução, marca falta do paciente e demais funções da
  dinâmica do terapeuta. Vê só a própria agenda + sessões que estiver cobrindo
  (cobertura = Substituição).
- **Responsável:** vê só agendamentos e dados básicos dos pacientes vinculados.
  NUNCA vê texto clínico da evolução.
- Responsáveis com acesso: os 4 tipos de `pacientes_responsaveis`
  (`filiacao_1`, `filiacao_2`, `financeiro`, `pedagogico`).

## Login
- Terapeuta: login de usuário do Pulsar (`public.usuarios`).
- Responsável: código por SMS/WhatsApp (Supabase Phone Auth), sem senha.
  - Provedor oficial (ex.: Twilio). Não usar número WhatsApp não oficial para
    login: banimento do número = ninguém entra.
  - O celular é casado com `responsaveis.celular`; normalizar o formato e
    medir quantos estão vazios/inválidos antes do lançamento.
  - Número de teste com código fixo no Supabase = conta de demonstração das lojas.
- Responsável NÃO entra em `public.usuarios` (tabela da equipe, herda menus e
  papéis). Vínculo login → responsável em tabela própria.

## Base existente no banco (da feat/grade-evolucoes-terapeuticas, já em main)
- `grade_evolucoes` + RPCs `grade_registrar_evolucao`, `grade_registrar_falta`,
  `grade_detalhe_evolucao`, `grade_resumo_evolucoes_periodo`,
  `grade_limpar_evolucao` (migration `20261016180000`). "Realizado por" vem de
  `auth.uid()`. Plano: `docs/PLANO_EVOLUCOES_TERAPEUTICAS.md`.
- `usuarios.profissional_id` já existe (liga login → profissional).
- `responsaveis` + `pacientes_responsaveis` já existem (migration
  `20260826100200`); `responsaveis.id_usuario` é auditoria de quem editou,
  NÃO é o login do responsável.

## O que falta no backend
- Papel `terapeuta` (encosta em várias listas: constraint, roleDefaults, etc.)
- Abrir as RPCs de evolução/falta (hoje só `is_admin()`) para o terapeuta,
  restritas à própria agenda + cobertura
- Tabela de acesso do responsável (auth user ↔ `responsaveis.id`)
- RPCs de leitura do responsável (agendamentos + dados básicos), sem SELECT
  direto nas tabelas; filtro por `pacientes_responsaveis`

## Requisitos obrigatórios das lojas (incluir no escopo)
- Exclusão de conta dentro do app (via Supabase Edge Function com service role)
- Se houver login social (Google etc.), incluir também "Entrar com Apple"
- Deep links configurados para callbacks de OAuth e magic link
- Textos justificando cada permissão (câmera, localização, notificações)
- Política de privacidade (LGPD) e página de suporte publicadas em URL
- Conta de demonstração para os revisores das lojas
- App com funcionalidade real (a Apple rejeita apps "vazios" ou que são só um site)

## Supabase
- Row Level Security (RLS) ativado em TODAS as tabelas
- Nunca expor a service role key no app
- Plano Pro (~US$ 25/mês) em produção (o plano free pausa projetos inativos)
- Mapear os dados armazenados para as declarações de privacidade das lojas

## Requisitos técnicos de build
- Android: Android App Bundle (.aab), Play App Signing, target API 36 (Android 16)
- iOS: build com Xcode 26+ / iOS 26 SDK (exigido desde 28/04/2026)

## Pendências administrativas (fazer em paralelo)
- [ ] Solicitar D-U-N-S do CNPJ (gratuito, 1-2 semanas)
- [ ] Domínio e e-mail com domínio da empresa
- [ ] Site simples: suporte + política de privacidade
- [ ] Conta Google Play Console (US$ 25, taxa única)
- [ ] Apple Developer Program (US$ 99/ano)

## Material para as lojas (preparar perto do lançamento)
- Nome, descrições curta e longa, ícone (1024x1024 no iOS), screenshots,
  feature graphic (Google), classificação etária, categoria,
  formulário de segurança de dados (Google), rótulos de privacidade (Apple)