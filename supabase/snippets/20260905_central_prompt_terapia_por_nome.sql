-- ============================================================================
-- O prompt para de mandar o modelo procurar um `terapiaId`
--
-- NÃO é migration: `central.agent_settings.system_prompt` é DADO.
--
-- APLICAR JUNTO COM O DEPLOY do frontend, não antes.
--   Antes: o prompt fala de `terapia` e a ferramenta ainda pede `terapiaId`.
--   Depois: a ferramenta pede `terapia` e o prompt manda buscar um id que já
--           não vem no retorno de consultar_especialidades_disponiveis.
-- Os dois sentidos degradam para "não encontrei horários", que é exatamente o
-- sintoma que este trabalho existe para eliminar. A janela é curta e fora do
-- horário de atendimento — mas ela existe.
--
-- Sucede, e SUBSTITUI na prática:
--   20260904_central_prompt_terapia_id_vem_do_sistema.sql
-- Aquele snippet mandava pegar o id no sistema e nunca chutar. A regra estava
-- certa e não funcionou: três reforços aplicados (regra_aplicada: true) e o
-- modelo continuou chutando `1` para psicologia (2259) toda vez.
--
-- POR QUE INSTRUÇÃO NÃO RESOLVIA
--
-- Não era desobediência. O `terapiaId` só existe no retorno de outra ferramenta,
-- e o modelo precisava carregá-lo pela conversa inteira. Quando essa memória
-- escorregava, ele não tinha como responder "não sei o id": o schema exigia um
-- inteiro, e `null` significa "todas as terapias", que é outra coisa. Ele
-- preenchia um campo obrigatório sem ter fonte para ele.
--
-- A ferramenta passou a receber `terapia` — o NOME, que o modelo sabe porque
-- leu na conversa. Some a classe inteira do erro, em vez de corrigi-la depois.
--
-- ROLLBACK: backup em central.agent_settings_backup_20260905_a.
-- ============================================================================

begin;

create table if not exists central.agent_settings_backup_20260905_a as
  select id, organization_id, inbox_id, system_prompt, now() as salvo_em
    from central.agent_settings;

comment on table central.agent_settings_backup_20260905_a is
  'Backup do system_prompt antes de 20260905_central_prompt_terapia_por_nome.sql (a ferramenta passou a receber nome de terapia em vez de terapiaId).';

-- ----------------------------------------------------------------------------
-- Âncora: o bloco inteiro que 20260904_central_prompt_terapia_id_vem_do_sistema
-- inseriu. Ele fica FALSO com o deploy — manda pegar um id que não vem mais.
--
-- O texto é reproduzido aqui EXATAMENTE como aquele snippet o escreveu. Se
-- divergir por um caractere, o replace() não casa e não muda nada em silêncio —
-- daí a contraprova no fim, que LANÇA.
-- ----------------------------------------------------------------------------
update central.agent_settings
   set system_prompt = replace(
         system_prompt,
         '**O `terapiaId` vem SEMPRE do sistema, nunca da sua memória.** Pegue-o em '
         || '`consultar_especialidades_disponiveis`, ou reaproveite exatamente o id que já funcionou nesta conversa. '
         || 'Nunca invente um número, nunca chute um valor pequeno como 1 ou 2, e nunca altere um id que deu certo antes. '
         || 'Na dúvida, chame `consultar_especialidades_disponiveis` de novo — é barato, e um id errado faz o sistema '
         || 'responder "sem vaga" para uma terapia que TEM vaga.',

         '**A especialidade é informada pelo NOME, não por um número.** Em `consultar_horarios_disponiveis`, '
         || 'passe em `terapia` o nome como você o diria ao responsável: "psicologia", "fonoaudiologia", '
         || '"terapia ocupacional". Acento e maiúscula não importam, e o nome parcial serve ("fono" encontra '
         || 'Fonoaudiologia). '
         || 'Se o nome corresponder a mais de uma especialidade, a ferramenta devolve as opções — pergunte ao '
         || 'responsável qual delas ele quer, não escolha por ele. '
         || 'E se a ferramenta disser que não reconheceu o nome, isso NÃO é o mesmo que não haver vaga: ela '
         || 'devolve os nomes válidos, use um deles.'
       )
 where system_prompt like '%O `terapiaId` vem SEMPRE do sistema%';

-- ----------------------------------------------------------------------------
-- CONTRAPROVA — replace() que não casa reporta sucesso e não muda nada
--
-- O erro que este bloco pega já aconteceu neste projeto: em 04/09 a âncora foi
-- escrita de memória com a grafia errada, o update rodou "com sucesso" e o
-- prompt ficou intocado.
-- ----------------------------------------------------------------------------
do $$
declare
  v_total   int;
  v_antigo  int;
  v_novo    int;
begin
  select count(*) into v_total  from central.agent_settings where system_prompt is not null;

  -- A instrução velha não pode sobrar em lugar nenhum: ela manda o modelo
  -- procurar um id que a ferramenta não devolve mais.
  select count(*) into v_antigo from central.agent_settings
   where system_prompt like '%O `terapiaId` vem SEMPRE do sistema%';

  select count(*) into v_novo   from central.agent_settings
   where system_prompt like '%A especialidade é informada pelo NOME%';

  raise notice 'agent_settings com prompt: %  |  ainda com a regra do id: %  |  com a regra do nome: %',
    v_total, v_antigo, v_novo;

  if v_antigo > 0 then
    raise exception
      'Ainda há % agent_settings mandando pegar o `terapiaId` no sistema. O replace() não casou — confira a grafia com: select substring(system_prompt from position(''terapiaId`  vem'' in system_prompt) - 20 for 400) from central.agent_settings;', v_antigo;
  end if;

  -- Só é falha se havia o bloco antigo para trocar. Uma instalação que nunca
  -- recebeu o snippet de 04/09 simplesmente não tem nada a substituir aqui, e
  -- isso é legítimo — a regra hardcoded de contexto.ts continua valendo.
  if v_total > 0 and v_novo = 0 then
    raise notice 'AVISO: nenhum prompt recebeu a regra do nome. Se este banco nunca aplicou o snippet de 04/09, é esperado. Se aplicou, o replace() falhou.';
  end if;
end $$;

commit;

-- ============================================================================
-- VERIFICAÇÃO, depois do deploy
--
-- Uma conversa real: "quero psicologia em Realengo, tem alguma coisa dia 14?"
--
-- No rastro, o argumento agora é NOME:
--
--   select created_at,
--          payload->'argumentos'->>'terapia'    as terapia,
--          payload->'argumentos'->>'terapiaId'  as terapia_id_legado,
--          payload->'argumentos'->>'unidade'    as unidade,
--          payload->'argumentos'->>'dataInicio' as data_inicio,
--          payload->>'ok'                       as ok,
--          payload->>'motivo'                   as motivo
--   from central.conversation_events
--   where event_type = 'ai.tool_call'
--     and payload->>'nome' = 'consultar_horarios_disponiveis'
--     and created_at > now() - interval '15 minutes'
--   order by created_at desc;
--
-- O que se espera ver:
--   terapia = 'psicologia'  (ou 'Psicologia'), terapia_id_legado NULO.
--
-- terapia_id_legado preenchido significa que o deploy não subiu, ou que uma
-- instância antiga ainda responde.
--
-- motivo = 'erro_interno' com um nome estranho em `terapia` é a guarda pegando
-- um nome desconhecido — o dano foi impedido, e a mensagem já leva os nomes
-- válidos para o modelo se corrigir na chamada seguinte.
-- ============================================================================
