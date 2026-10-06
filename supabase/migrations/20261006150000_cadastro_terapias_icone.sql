-- Ícone de cada terapia (Cadastro de Terapias → avatar do profissional).
--
-- Pedido do usuário (06/10/2026): no card do profissional, no lugar das
-- iniciais, um ícone ligado à terapia principal — como os bichinhos de
-- Pacientes, mas sem animais. Decisões: o ícone fica guardado AQUI (escolhido
-- numa grade no Cadastro de Terapias, igual à cor), todos da mesma terapia usam
-- o mesmo ícone, Equoterapia ganha um cavalo desenhado, Psicologia ABA usa o
-- alvo (sem o quebra-cabeça, rejeitado por parte da comunidade autista).
--
-- `icone` é uma CHAVE (ex.: 'dumbbell', 'cavalo'), não um SVG: o desenho vive no
-- frontend (frontend/lib/cadastros/iconesTerapia.tsx). Chave desconhecida ou
-- null → estrelinhas. A carga inicial só preenche quem está vazio, então
-- reaplicar nunca desfaz uma escolha feita na tela.
--
-- Idempotente.

alter table public.cadastro_terapias add column if not exists icone text;

alter table public.cadastro_terapias drop constraint if exists cadastro_terapias_icone_check;
alter table public.cadastro_terapias
  add constraint cadastro_terapias_icone_check check (icone is null or icone ~ '^[a-z0-9-]{1,40}$');

comment on column public.cadastro_terapias.icone is
  'Chave do ícone da terapia (ver frontend/lib/cadastros/iconesTerapia.tsx). null = estrelinhas.';

-- Carga inicial pela tabela proposta e aprovada em 06/10/2026.
update public.cadastro_terapias c
   set icone = v.icone
  from (values
    ('aplicador aba (ae)',                   'brush'),
    ('aplicador aba (av)',                   'clipboard-check'),
    ('aplicador aba (ef)',                   'dumbbell'),
    ('aplicador aba (hs)',                   'users'),
    ('aplicador aba (ps)',                   'message-circle-heart'),
    ('aplicador aba (sf)',                   'backpack'),
    ('aplicador aba casa',                   'house'),
    ('aplicador aba escola',                 'school'),
    ('aplicador suporte',                    'hand-helping'),
    ('aplicador suporte (mt)',               'music'),
    ('aplicador suporte (ta)',               'utensils-crossed'),
    ('aplicador suporte (to)',               'shirt'),
    ('apoio operacional',                    'wrench'),
    ('arteterapia',                          'palette'),
    ('arteterapia (psicologia aba)',         'paintbrush'),
    ('assistente de desenvolvimento',        'sprout'),
    ('avaliacao neuropsicologica',           'brain'),
    ('avaliacao neuropsicopedagogica',       'book-open-check'),
    ('circuito funcional',                   'route'),
    ('coordenador de caso',                  'compass'),
    ('cozinha funcional',                    'chef-hat'),
    ('equoterapia',                          'cavalo'),
    ('especialista tecnico de area',         'award'),
    ('esporte adaptado',                     'trophy'),
    ('estagio',                              'graduation-cap'),
    ('facilitador tecnico',                  'lightbulb'),
    ('fisioterapia',                         'accessibility'),
    ('fisioterapia aquatica',                'waves'),
    ('fonoaudiologia',                       'speech'),
    ('habilidades sociais (psicologia aba)', 'handshake'),
    ('musicalizacao',                        'piano'),
    ('musicoterapia',                        'music'),
    ('nutricao',                             'salad'),
    ('oferecer consulta nutricao',           'carrot'),
    ('oficina de aprendizagem',              'blocks'),
    ('operacoes clinicas',                   'cog'),
    ('psicoeducacao',                        'presentation'),
    ('psicologia',                           'message-circle'),
    ('psicologia aba',                       'target'),
    ('psicomotricidade',                     'person-standing'),
    ('psicopedagogia',                       'book-open'),
    ('psiquiatra/neurologista',              'stethoscope'),
    ('supervisao aba',                       'binoculars'),
    ('tecnico terapeutico particular',       'heart-handshake'),
    ('terapia alimentar',                    'utensils-crossed'),
    ('terapia ocupacional',                  'shirt'),
    ('triagem',                              'scan-search'),
    ('trilha socioemocional',                'smile'),
    ('visita guiada',                        'map-pinned')
  ) as v(nome_normalizado, icone)
 where c.nome_normalizado = v.nome_normalizado
   and c.icone is null;

-- A tela grava o ícone: entra nos GRANTs de coluna de 20261006120000.
grant insert (icone), update (icone) on public.cadastro_terapias to authenticated;
