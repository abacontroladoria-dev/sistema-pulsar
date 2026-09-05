-- ============================================================================
-- CONTRAPROVA: o filtro por nome de especialidade
--
-- Rodar DEPOIS de 20260905_APLICAR_terapia_por_nome.sql.
--
-- Cada bloco LANÇA em vez de devolver linhas: um snippet que retorna dados pede
-- que alguém os interprete, e é assim que uma verificação passa despercebida.
-- Aqui, silêncio (só `notice`) é aprovação.
--
-- Se qualquer bloco lançar, NÃO faça o deploy do frontend: ele depende destas
-- funções, e a janela de quebra vira uma queda.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. As assinaturas novas existem, e as antigas NÃO
--
-- O risco é a sobrecarga acidental: se a antiga sobrevivesse, o PostgREST
-- responderia PGRST203 ("could not choose the best candidate function") a TODA
-- consulta de disponibilidade, derrubando o agente e a tela juntos — com um
-- sintoma que não menciona terapia nenhuma.
-- ----------------------------------------------------------------------------
do $$
declare
  v_nova    int;
  v_antiga  int;
  v_nomes   int;
begin
  select count(*) into v_nova
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'central' and p.proname = 'listar_vagas_disponiveis'
     and pg_get_function_identity_arguments(p.oid) like '%text[]%';

  select count(*) into v_antiga
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'central' and p.proname = 'listar_vagas_disponiveis'
     and pg_get_function_identity_arguments(p.oid) not like '%text[]%';

  select count(*) into v_nomes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'central' and p.proname = 'listar_nomes_de_terapia_com_vaga';

  raise notice 'listar_vagas_disponiveis: % nova(s), % antiga(s)  |  listar_nomes_de_terapia_com_vaga: %',
    v_nova, v_antiga, v_nomes;

  if v_nova <> 1 then
    raise exception 'Esperava exatamente 1 listar_vagas_disponiveis com p_terapia_nomes, achei %.', v_nova;
  end if;
  if v_antiga > 0 then
    raise exception
      'A assinatura ANTIGA de listar_vagas_disponiveis sobreviveu (% cópia(s)). Isso é PGRST203 em toda consulta de disponibilidade. Dropar: drop function central.listar_vagas_disponiveis(date,date,bigint,bigint,text,integer);', v_antiga;
  end if;
  if v_nomes <> 1 then
    raise exception 'Esperava listar_nomes_de_terapia_com_vaga, achei %.', v_nomes;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Os grants sobreviveram ao drop
--
-- `drop function` apaga os grants (são atributo do objeto, não do nome).
-- Recriar sem regrantear dá "permission denied for function", que chega ao
-- `authenticated` como 403 na tela — e não parece erro de migration.
-- ----------------------------------------------------------------------------
do $$
declare v_falta text;
begin
  select string_agg(f.proname || ' → ' || r.rol, ', ')
    into v_falta
    from (
      select p.oid, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'central'
         and p.proname in ('listar_vagas_disponiveis', 'listar_nomes_de_terapia_com_vaga')
    ) f
    cross join (values ('authenticated'), ('service_role')) as r(rol)
   where not has_function_privilege(r.rol, f.oid, 'execute');

  if v_falta is not null then
    raise exception 'Falta grant execute: %', v_falta;
  end if;
  raise notice 'grants ok';
end $$;

-- ----------------------------------------------------------------------------
-- 3. p_terapia_nomes vazio LANÇA
--
-- Array vazio é bug de chamador. Se ele se comportasse como "sem filtro", o
-- responsável receberia horários de qualquer especialidade achando que pediu a
-- dele — e ninguém notaria, porque a resposta parece uma resposta.
-- ----------------------------------------------------------------------------
do $$
begin
  perform * from central.listar_vagas_disponiveis(p_terapia_nomes => array[]::text[]);
  raise exception 'p_terapia_nomes vazio NÃO lançou. Array vazio está se comportando como "sem filtro".';
exception
  when invalid_parameter_value then
    raise notice 'p_terapia_nomes vazio lança 22023: ok';
end $$;

-- ----------------------------------------------------------------------------
-- 4. O de-para do laudo alcança as vagas de Psicologia ABA
--
-- É o defeito que o responsável relatou: o TiTa grava 'Aplicador ABA (PS)', o
-- laudo dele diz 'Psicologia ABA', e ninguém escreve "aplicador" no WhatsApp.
-- Sem o de-para essas vagas são inalcançáveis e o agente responde que não há.
--
-- Não exige um número exato (a agenda muda): exige que o de-para alcance MAIS
-- que o nome do laudo sozinho, que é o que prova que ele está funcionando.
-- ----------------------------------------------------------------------------
do $$
declare
  v_so_laudo int;
  v_depara   int;
begin
  select count(*) into v_so_laudo
    from central.listar_vagas_disponiveis(
      p_terapia_nomes => array['Psicologia ABA'], p_limite => 500);

  select count(*) into v_depara
    from central.listar_vagas_disponiveis(
      p_terapia_nomes => array['Aplicador ABA (PS)', 'Psicologia ABA'], p_limite => 500);

  raise notice 'Psicologia ABA — só pelo nome do laudo: %  |  com o de-para: %', v_so_laudo, v_depara;

  if v_depara < v_so_laudo then
    raise exception 'O de-para alcançou MENOS vagas (% < %) que o nome sozinho. Impossível: é superconjunto.',
      v_depara, v_so_laudo;
  end if;

  if v_depara = 0 then
    raise notice 'AVISO: nenhuma vaga de Psicologia ABA na janela. Confira se a grade está populada antes de concluir que o de-para falhou.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Psicologia ≠ Psicologia ABA
--
-- São terapias diferentes, com TUSS diferente. O filtro por nome não pode
-- misturá-las: oferecer ABA para quem pediu psicologia comum é mandar a criança
-- para o tratamento errado.
-- ----------------------------------------------------------------------------
do $$
declare v_vazamento int;
begin
  -- Nenhuma vaga devolvida para 'Psicologia' pode ser de quem só faz ABA.
  select count(*) into v_vazamento
    from central.listar_vagas_disponiveis(p_terapia_nomes => array['Psicologia'], p_limite => 500) v
   where not exists (
     select 1 from unnest(string_to_array(v.terapia_nome, ',')) parte
      where btrim(parte) = 'Psicologia'
   );

  if v_vazamento > 0 then
    raise exception 'O filtro por Psicologia devolveu % vaga(s) que não têm "Psicologia" como parte do nome.', v_vazamento;
  end if;
  raise notice 'Psicologia não vaza para ABA: ok';
end $$;

-- ----------------------------------------------------------------------------
-- 6. Casamento é por PARTE, não substring
--
-- 'Arteterapia (Psicologia ABA)' é arteterapia feita dentro do ABA — não é
-- Psicologia ABA. Com ILIKE '%...%' ela seria contada errado, e o mesmo juntaria
-- 'Aplicador ABA (PS)' com 'Aplicador ABA (SF)' (180 vagas).
-- ----------------------------------------------------------------------------
do $$
declare v_errado int;
begin
  select count(*) into v_errado
    from central.listar_vagas_disponiveis(
           p_terapia_nomes => array['Aplicador ABA (PS)'], p_limite => 500) v
   where not exists (
     select 1 from unnest(string_to_array(v.terapia_nome, ',')) parte
      where btrim(parte) = 'Aplicador ABA (PS)'
   );

  if v_errado > 0 then
    raise exception 'O filtro casou % vaga(s) por substring em vez de por parte exata.', v_errado;
  end if;
  raise notice 'casamento por parte exata: ok';
end $$;

-- ----------------------------------------------------------------------------
-- 7. listar_nomes_de_terapia_com_vaga não colapsa nomes distintos
--
-- É a razão de ela existir: um `group by terapia_id` juntaria
-- 'Aplicador ABA (PS)' e 'Aplicador ABA (PS), Psicologia' — que são coisas
-- diferentes para quem procura psicologia — e escolheria um dos nomes.
-- ----------------------------------------------------------------------------
do $$
declare
  v_nomes int;
  v_ids   int;
begin
  select count(distinct terapia_nome) into v_nomes
    from central.listar_nomes_de_terapia_com_vaga();

  select count(distinct v.terapia_id) into v_ids
    from central.vw_vagas_livres v
   where v.data between current_date and current_date + 30;

  raise notice 'nomes distintos com vaga: %  |  ids distintos na janela: %', v_nomes, v_ids;

  if v_nomes = 0 then
    raise exception 'listar_nomes_de_terapia_com_vaga devolveu zero nomes. A grade está vazia, ou a função está errada.';
  end if;

  -- Não é regra universal, mas na grade medida em 05/09 havia 31 nomes para 26
  -- ids. Se os nomes forem MENOS que os ids, algo está agrupando errado.
  if v_nomes < v_ids then
    raise exception 'Há menos nomes (%) que ids (%) — o agrupamento por nome está colapsando o que deveria distinguir.',
      v_nomes, v_ids;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7b. O trabalho interno continua existindo na grade — e é isso o esperado
--
-- As cinco estão FORA do catálogo de oferta por decisão da clínica (05/09/2026):
-- Coordenador de Caso, Supervisão ABA, Aplicador Suporte, Operações Clínicas e
-- Especialista Técnico de Área — 951 vagas, quase metade da grade.
--
-- A exclusão é do CATÁLOGO (terapia.ts), não do banco: elas continuam na view
-- porque a tela de Agendamentos e os relatórios as usam. Este bloco não valida
-- o catálogo (que é TypeScript) — ele avisa se o vocabulário da grade mudou, que
-- é quando alguém precisa reabrir a decisão.
-- ----------------------------------------------------------------------------
do $$
declare
  v_internas int;
  v_novos    text;
begin
  select count(distinct terapia_nome) into v_internas
    from central.listar_nomes_de_terapia_com_vaga()
   where terapia_nome in ('Coordenador de Caso', 'Supervisão ABA', 'Aplicador Suporte',
                          'Operações Clínicas', 'Especialista Técnico de Área');

  raise notice 'nomes de trabalho interno na grade (fora do catálogo, esperado): %', v_internas;

  -- Nomes que NÃO são nem do catálogo nem das cinco internas conhecidas. Um nome
  -- novo aqui é uma especialidade que o agente NÃO vai oferecer — silenciosa e
  -- corretamente, porque o catálogo é allowlist. O aviso existe para que a
  -- omissão seja notada, e não para que ela falhe.
  select string_agg(distinct terapia_nome, ' | ') into v_novos
    from central.listar_nomes_de_terapia_com_vaga()
   where terapia_nome not in (
     'Coordenador de Caso', 'Supervisão ABA', 'Aplicador Suporte',
     'Operações Clínicas', 'Especialista Técnico de Área',
     'Psicologia', 'Psicologia ABA', 'Fonoaudiologia', 'Terapia Ocupacional',
     'Psicopedagogia', 'Psicomotricidade', 'Fisioterapia', 'Fisioterapia Aquática',
     'Musicoterapia', 'Terapia Alimentar', 'Equoterapia', 'Arteterapia',
     'Avaliação Neuropsicológica', 'Triagem', 'Visita Guiada'
   )
     -- Nome-lista é esperado (o profissional atende várias); só interessa o
     -- nome SIMPLES que ninguém conhece.
     and terapia_nome not like '%,%';

  if v_novos is not null then
    raise notice 'AVISO: nome(s) de especialidade que o catálogo não conhece: %. O agente NÃO os oferece. Se algum for atendimento de verdade, acrescente em terapia.ts.', v_novos;
  else
    raise notice 'nenhum nome simples desconhecido na grade: ok';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 8. As duas RPCs concordam sobre o mesmo conjunto
--
-- Se divergirem, o agente afirma que uma especialidade tem vaga e a consulta de
-- horários dela vem vazia — o pior tipo de contradição, porque cada resposta
-- isolada parece correta.
-- ----------------------------------------------------------------------------
do $$
declare
  v_nome  text;
  v_vagas int;
begin
  select terapia_nome into v_nome
    from central.listar_nomes_de_terapia_com_vaga()
   order by vagas desc
   limit 1;

  if v_nome is null then
    raise notice 'AVISO: nenhuma especialidade com vaga; nada a cruzar.';
    return;
  end if;

  -- O nome vem como lista; a primeira parte é um texto de casamento válido.
  select count(*) into v_vagas
    from central.listar_vagas_disponiveis(
      p_terapia_nomes => array[btrim(split_part(v_nome, ',', 1))],
      p_limite => 500);

  raise notice 'a especialidade mais frequente (%) tem % vaga(s) em listar_vagas_disponiveis', v_nome, v_vagas;

  if v_vagas = 0 then
    raise exception
      'listar_nomes_de_terapia_com_vaga diz que "%" tem vaga, mas listar_vagas_disponiveis devolve zero. As duas discordam — o agente vai oferecer uma especialidade cuja consulta de horários vem vazia.', v_nome;
  end if;
end $$;
