-- Bug (2026-09-15): Juliana (role 'terapeutico') abre
-- /relacionamento-prestador/ocupacao-salas, clica em "Exclusividade de salas com
-- terapias", tenta gravar e recebe no rodapé do modal:
--   "Não foi possível criar exclusividades de terapia: o registro não existe
--    mais (pode ter sido alterado por outra pessoa) ou você não tem permissão."
--
-- A segunda metade da frase é a verdadeira. O modal ABRE e lista tudo porque o
-- SELECT já cobre 'terapeutico' desde 20260811120000; só o write ficou em
-- remuneracao_has_role(['admin','diretoria']). O INSERT casa 0 linhas em RLS
-- (que não levanta erro), o .select().single() não acha nada, e o frontend
-- traduz o PGRST116 nessa mensagem de duas causas.
--
-- Esta é a MESMA classe de bug de 20260827120100 — leitura liberada sem a
-- escrita acompanhar — e aquela migration deixou esta tabela de fora de
-- propósito, citando o pedido de 2026-08-11 de manter exclusividade restrita a
-- admin/diretoria. O pedido de hoje revisa essa decisão: quem pode editar a
-- ocupação de salas passa a poder editar a exclusividade também.
--
-- Correção: escrita segue a mesma fonte de verdade que decide se a página
-- aparece no menu — usuarios_permissoes.permissao_codigo =
-- 'cronograma_ocupacao_salas' — em vez de lista de papéis mantida à mão.
-- Enquanto a RLS inferir permissão a partir do papel, este bug volta a cada
-- usuário novo cujo papel não está na lista (é a 4ª ocorrência nesta tela).
--
-- O SELECT vai junto, e não por simetria estética: hoje ele é por papel, então
-- quem tem a permissão da tela mas um papel fora da lista (ex.: 'rp', que
-- 20260818130000 liberou para cronograma_salas) abre o modal e vê uma lista
-- VAZIA — sem erro. Deixar o SELECT por papel trocaria um bug barulhento por um
-- silencioso.
--
-- usuario_tem_permissao() já existe (20260818210000), com bypass incondicional
-- para admin/diretoria e revoke de anon: ninguém que hoje escreve perde acesso.
--
-- ESCOPO: cronograma_nucleos e cronograma_status_labels ("Gerenciar categorias")
-- seguem restritas a admin/diretoria (20260818140000). Não são tocadas aqui.

drop policy if exists "cronograma_salas_terapias_exclusivas_select"
  on public.cronograma_salas_terapias_exclusivas;
create policy "cronograma_salas_terapias_exclusivas_select"
  on public.cronograma_salas_terapias_exclusivas
  for select to authenticated
  using (public.usuario_tem_permissao('cronograma_ocupacao_salas'));

drop policy if exists "cronograma_salas_terapias_exclusivas_write"
  on public.cronograma_salas_terapias_exclusivas;
create policy "cronograma_salas_terapias_exclusivas_write"
  on public.cronograma_salas_terapias_exclusivas
  for all to authenticated
  using (public.usuario_tem_permissao('cronograma_ocupacao_salas'))
  with check (public.usuario_tem_permissao('cronograma_ocupacao_salas'));
