-- ============================================================================
-- CRITÉRIOS DA AUDITORIA DE EVOLUÇÕES — APLICAR NO SQL EDITOR
--
-- Consolida 3 migrations, NA ORDEM (a FK exige a tabela; o seed exige as duas):
--   1) 20260922180000_create_auditoria_criterios_versoes.sql
--   2) 20260922180100_seed_auditoria_criterios_v1.sql
--   3) 20260922180200_auditoria_evolucoes_versao_e_rls.sql
--
-- Rode no SQL Editor do Supabase, NÃO por `db push` (que empurra todo o
-- pendente do repo). Pode rodar o bloco inteiro de uma vez.
--
-- O QUE MUDA DE COMPORTAMENTO:
--   - NADA para a IA: a v1 do seed reproduz o prompt atual byte-a-byte
--     (provado por lib/auditoria/__tests__/paridadePrompt.test.ts).
--   - A RLS de auditoria_evolucoes APERTA: hoje é USING(true) para qualquer
--     usuário logado. Passa a exigir a permissão da tela ou papel
--     admin/diretoria/terapeutico. Quem usa a tela hoje não perde acesso.
--
-- ATENÇÃO: aplique junto com o deploy do código. Aplicar o SQL sem o código é
-- seguro (as colunas novas ficam nulas); subir o código sem o SQL faz a
-- gravação da auditoria falhar, porque a rota grava criterios_versao_id.
-- ============================================================================


-- ===== 1/3 ==========================================================

-- Critérios da auditoria de evoluções: histórico de versões.
--
-- POR QUE EXISTE: os critérios (4 perguntas, termos proibidos, regras de
-- sigilo, limiares de risco) viviam hardcoded em frontend/lib/auditoria/prompts.ts.
-- Quem conhece essa régua é o setor terapêutico, e qualquer ajuste exigia deploy.
--
-- POR QUE APPEND-ONLY: sem histórico, ninguém consegue explicar por que a
-- evolução de setembro passou e a de outubro, idêntica, foi reprovada — nem
-- provar, num questionamento de glosa, sob qual regra auditou. Cada linha de
-- auditoria_evolucoes aponta para a versão que a julgou (migration ..._versao_e_rls),
-- e essa versão não pode mudar depois. Daí o trigger abaixo: a imutabilidade é
-- garantida no BANCO, não na confiança da aplicação.
--
-- O conteúdo NÃO inclui o schema JSON da resposta da IA. Esse bloco é contrato
-- do parser e fica constante no código (SCHEMA_RESPOSTA_AUDITORIA), fora do
-- alcance de quem edita — senão uma edição inocente quebraria a leitura da
-- resposta em silêncio.

create table if not exists public.auditoria_criterios_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int not null,
  conteudo jsonb not null,
  publicado_por uuid references public.usuarios(id),
  publicado_por_nome text not null,
  publicado_em timestamptz not null default now(),
  nota_publicacao text,
  constraint uq_auditoria_criterios_versao unique (versao)
);

comment on table public.auditoria_criterios_versoes is
  'Versões dos critérios da auditoria de evoluções por IA. Append-only: nunca sofre UPDATE nem DELETE (trigger trg_auditoria_criterios_imutavel).';
comment on column public.auditoria_criterios_versoes.conteudo is
  'Critérios em JSONB: abertura, conferencia_estrutural, pilares (4 chaves congeladas), regras_especificas, termos_proibidos, status_risco (3 chaves congeladas). Validado por parseCriterios() no app.';

-- Índice para "a versão vigente é a de maior número".
create index if not exists idx_auditoria_criterios_versao_desc
  on public.auditoria_criterios_versoes (versao desc);

-- Guarda de imutabilidade. Não existia função equivalente no repo.
create or replace function public.auditoria_criterios_impedir_alteracao()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'auditoria_criterios_versoes é append-only: % não é permitido. Publique uma nova versão.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_auditoria_criterios_imutavel on public.auditoria_criterios_versoes;
create trigger trg_auditoria_criterios_imutavel
  before update or delete on public.auditoria_criterios_versoes
  for each row execute function public.auditoria_criterios_impedir_alteracao();

-- RLS: mesma condição da tela de auditoria (ver migration ..._versao_e_rls).
-- Sem update/delete: além do trigger, não há sequer policy que os permita.
alter table public.auditoria_criterios_versoes enable row level security;
alter table public.auditoria_criterios_versoes force row level security;

drop policy if exists auditoria_criterios_versoes_select on public.auditoria_criterios_versoes;
create policy auditoria_criterios_versoes_select
  on public.auditoria_criterios_versoes for select to authenticated
  using (
    public.usuario_tem_permissao('terapeutico_auditoria_evolucoes')
    or public.remuneracao_has_role(array['admin', 'diretoria', 'terapeutico'])
  );

drop policy if exists auditoria_criterios_versoes_insert on public.auditoria_criterios_versoes;
create policy auditoria_criterios_versoes_insert
  on public.auditoria_criterios_versoes for insert to authenticated
  with check (
    public.usuario_tem_permissao('terapeutico_auditoria_evolucoes')
    or public.remuneracao_has_role(array['admin', 'diretoria', 'terapeutico'])
  );

grant select, insert on public.auditoria_criterios_versoes to authenticated;

-- ===== 2/3 ==========================================================

-- Versão 1 dos critérios: exatamente a régua que já estava em produção.
--
-- PARIDADE É O PONTO DESTA MIGRATION. Este JSONB é cópia literal de
-- CRITERIOS_FALLBACK (frontend/lib/auditoria/criterios.ts), e o teste
-- lib/auditoria/__tests__/paridadePrompt.test.ts prova que montarSystemPrompt()
-- sobre ele reproduz o prompt antigo byte-a-byte. Consequência: no dia do
-- deploy a IA recebe exatamente o mesmo texto de antes, e nenhuma auditoria
-- muda de resultado. Sem isso, a migração de comportamento se misturaria com a
-- introdução da feature e ninguém saberia distinguir as duas.
--
-- Idempotente: reaplicar não cria v2 nem sobrescreve (o trigger append-only
-- recusaria o update de qualquer forma).

insert into public.auditoria_criterios_versoes (versao, conteudo, publicado_por_nome, nota_publicacao)
values (
  1,
  $criterios${
  "abertura": "Você atua como auditor de convênio especializado em revisão de evolução terapêutica de atendimentos realizados para a Clínica Universo ABA. Sua função é revisar rigorosamente as evoluções clínicas antes do envio ao convênio, identificando tudo o que pode gerar GLOSA, apontando as falhas e devolvendo o texto já corrigido e pronto para constar no prontuário.",
  "conferencia_estrutural": [
    "Correspondência de especialidade, profissional e data do atendimento.",
    "Inconsistências de registro documental."
  ],
  "pilares": [
    {
      "chave": "chegou",
      "rotulo": "Estado na chegada",
      "descricao": "Como o paciente chegou à sessão (estado emocional e comportamental na chegada)."
    },
    {
      "chave": "objetivo",
      "rotulo": "Objetivo planejado",
      "descricao": "Qual o objetivo do atendimento (o que estava planejado trabalhar)."
    },
    {
      "chave": "recursos",
      "rotulo": "Recursos / Materiais",
      "descricao": "Quais recursos, estratégias ou materiais foram utilizados (específicos, não genéricos)."
    },
    {
      "chave": "reacao_saida",
      "rotulo": "Reação e saída",
      "descricao": "Como o paciente reagiu e como a sessão foi encerrada (nível de engajamento, suporte/ajuda necessária, condição de saída)."
    }
  ],
  "regras_especificas": [
    {
      "titulo": "Paciente desregulado/desengajado",
      "texto": "Manter as 4 etapas descrevendo o que foi planejado, que a atividade não ocorreu e o suporte dado."
    },
    {
      "titulo": "Psicoterapia",
      "texto": "Respeitar o sigilo profissional (Código de Ética do CFP). Nunca expor intimidades ou falas confidenciais de terceiros. Se houver detalhes sensíveis, substituir por descrição técnica generalizada."
    },
    {
      "titulo": "Instrumentos de Avaliação (VB-MAPP, ABLLS-R, PEAK, etc.)",
      "texto": "Nunca aceitar apenas o nome isolado. Deve conter domínio, objetivo, recursos e resposta do paciente."
    },
    {
      "titulo": "Atrasos/Saída antecipada",
      "texto": "Focar sempre na intervenção realizada, nunca no tempo de permanência (\"não deu tempo de fazer nada\")."
    }
  ],
  "termos_proibidos": [
    {
      "categoria": "Termos vagos",
      "termos": [
        "sessão normal",
        "atendimento de rotina",
        "tudo correu bem",
        "atividades de costume",
        "nada a registrar"
      ]
    },
    {
      "categoria": "Negação pura sem contexto",
      "termos": [
        "paciente não fez nada",
        "sem produtividade",
        "sem evolução"
      ]
    },
    {
      "categoria": "Termos absolutos/prognósticos",
      "termos": [
        "cura",
        "curado",
        "resolvido definitivamente",
        "100% de melhora"
      ]
    },
    {
      "categoria": "Julgamento subjetivo",
      "termos": [
        "mal educado",
        "família não coopera",
        "mãe negligente"
      ]
    },
    {
      "categoria": "Termos aversivos/fora de protocolo",
      "termos": [
        "castigo",
        "punição",
        "conteve à força",
        "bloqueio físico"
      ]
    },
    {
      "categoria": "Foco no tempo",
      "termos": [
        "sessão perdida",
        "sessão incompleta"
      ]
    },
    {
      "categoria": "Abreviações ou siglas não padronizadas sem explicação",
      "termos": []
    }
  ],
  "status_risco": [
    {
      "chave": "sem_risco",
      "descricao": "Texto completo, cumpre os 4 pilares, sem termos proibidos."
    },
    {
      "chave": "risco_especifico",
      "descricao": "Pequena falha pontual fácil de ajustar (ex: faltou apenas o estado de saída)."
    },
    {
      "chave": "risco_relevante",
      "descricao": "Falta de estrutura essencial, termos proibidos, violação de sigilo, relato vago ou risco claro de glosa de convênio."
    }
  ]
}$criterios$::jsonb,
  'Seed inicial',
  'Critérios que já vigoravam no código, migrados sem alteração.'
)
on conflict (versao) do nothing;

-- ===== 3/3 ==========================================================

-- Duas coisas na mesma migration, ambas sobre auditoria_evolucoes:
--   (1) rastrear sob QUAIS critérios cada auditoria foi feita;
--   (2) fechar a RLS, hoje aberta a qualquer usuário autenticado.
--
-- (1) POR QUE A VERSÃO: a partir dos critérios editáveis, a régua muda ao longo
-- do tempo. Sem registrar a versão, ninguém explica por que duas evoluções
-- iguais tiveram veredito diferente, nem prova sob qual regra se auditou num
-- questionamento de glosa. A FK aponta para linha imutável (a tabela é
-- append-only), então tem a mesma força de um snapshot sem duplicar o texto
-- dos critérios em cada uma das milhares de linhas. ON DELETE RESTRICT impede
-- que a versão usada desapareça. `criterios_versao_numero` é desnormalizado de
-- propósito: exibir "critérios v3" na tela sem join.
--
-- `erro_auditoria` existe porque status_risco é NOT NULL + CHECK: não há valor
-- "deu erro". Quando a IA falha numa evolução JÁ auditada antes, guardamos o
-- motivo aqui e preservamos o veredito anterior, que a tela marca como
-- desatualizado. Evolução nunca auditada que falha não vira linha nenhuma — a
-- rota devolve a falha e a tela avisa.
--
-- (2) POR QUE APERTAR A RLS: as policies atuais são USING (true) para todo
-- `authenticated`. Esta tabela guarda texto_original — a evolução clínica
-- escrita pelo terapeuta, dado de saúde. Hoje qualquer usuário logado no
-- Pulsar, inclusive quem só usa cronograma, lê e altera tudo. O padrão adotado
-- é o mesmo de 20260826140700 (laudos/altas) e 20260818210000 (ocupação).
--
-- O RAMO POR PAPEL NÃO É DECORAÇÃO: usuario_tem_permissao() lê
-- usuarios_permissoes e IGNORA os roleDefaults do frontend. Como
-- 'terapeutico_auditoria_evolucoes' só existe em roleDefaults (não há linhas
-- concedidas individualmente), sem remuneracao_has_role TODOS perderiam a tela.
--
-- ADITIVA PARA QUEM JÁ USA: quem enxerga a tela hoje passa por um dos dois
-- ramos. Perde acesso apenas quem nunca deveria ter tido.

alter table public.auditoria_evolucoes
  add column if not exists criterios_versao_id uuid
    references public.auditoria_criterios_versoes(id) on delete restrict,
  add column if not exists criterios_versao_numero int,
  add column if not exists erro_auditoria text;

comment on column public.auditoria_evolucoes.criterios_versao_id is
  'Versão dos critérios sob a qual esta evolução foi auditada. Null = auditada antes da feature de critérios versionados.';
comment on column public.auditoria_evolucoes.erro_auditoria is
  'Motivo da última falha de auditoria. Quando preenchido, os campos de veredito são da tentativa ANTERIOR (bem-sucedida).';

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''terapeutico_auditoria_evolucoes'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'',''terapeutico'']))';
begin
  -- Remove o que existir hoje (as duas USING(true)), sem depender dos nomes.
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'auditoria_evolucoes'
  loop
    execute format('drop policy %I on public.auditoria_evolucoes', pol.policyname);
  end loop;

  execute format(
    'create policy auditoria_evolucoes_select on public.auditoria_evolucoes for select to authenticated using (%s)',
    cond);
  execute format(
    'create policy auditoria_evolucoes_insert on public.auditoria_evolucoes for insert to authenticated with check (%s)',
    cond);
  execute format(
    'create policy auditoria_evolucoes_update on public.auditoria_evolucoes for update to authenticated using (%s) with check (%s)',
    cond, cond);
  execute format(
    'create policy auditoria_evolucoes_delete on public.auditoria_evolucoes for delete to authenticated using (%s)',
    cond);
end $$;

alter table public.auditoria_evolucoes enable row level security;
-- force: nem o dono da tabela escapa. service_role tem bypassrls, então o
-- sync e jobs internos seguem funcionando.
alter table public.auditoria_evolucoes force row level security;

-- ============================================================================
-- CONFERÊNCIA — rode depois e verifique as 4 linhas de resultado.
-- ============================================================================

-- 1) A v1 existe e tem as 4 perguntas e os 3 status?
select
  versao,
  publicado_por_nome,
  jsonb_array_length(conteudo -> 'pilares')      as pilares_esperado_4,
  jsonb_array_length(conteudo -> 'status_risco') as status_esperado_3,
  jsonb_array_length(conteudo -> 'termos_proibidos') as grupos_de_termos
from public.auditoria_criterios_versoes
order by versao desc;

-- 2) As colunas novas entraram em auditoria_evolucoes?
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'auditoria_evolucoes'
  and column_name in ('criterios_versao_id', 'criterios_versao_numero', 'erro_auditoria')
order by column_name;

-- 3) As policies abertas sumiram? Esperado: 4 linhas em auditoria_evolucoes
--    (select/insert/update/delete) e 2 em auditoria_criterios_versoes,
--    NENHUMA com qual = 'true'.
select tablename, policyname, cmd, qual is not distinct from 'true' as ainda_aberta
from pg_policies
where schemaname = 'public'
  and tablename in ('auditoria_evolucoes', 'auditoria_criterios_versoes')
order by tablename, cmd, policyname;

-- 4) O append-only está de pé? Este UPDATE DEVE FALHAR com
--    "auditoria_criterios_versoes é append-only". Se ele passar, o trigger
--    não foi criado — investigue antes de liberar a tela.
do $teste$
declare
  passou boolean := false;
begin
  begin
    update public.auditoria_criterios_versoes set nota_publicacao = 'teste' where versao = 1;
    passou := true;   -- chegou aqui = o trigger não barrou
  exception
    when restrict_violation then
      raise notice 'OK: append-only ativo (o UPDATE foi recusado, como esperado).';
  end;

  if passou then
    raise exception 'FALHOU: o UPDATE passou. O trigger append-only NAO esta ativo.';
  end if;
end $teste$;
