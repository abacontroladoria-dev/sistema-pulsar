# Robô SharePoint → PEP: roteiro de operação

Roteiro de 01/10/2026 para colocar no ar o robô planejado em `docs/ESTUDO_ROBO_ASSIM_E_PEP_SHAREPOINT.md`. Cada passo diz **quem** faz. Nada aqui roda contra o SharePoint real antes do termo de confidencialidade.

## O que existe

| Parte | Onde |
|---|---|
| Robô (container Node 20) | `robo-pep-sharepoint/` |
| Banco: tabelas, reconhecimento, RPCs | `supabase/migrations/20261001120000_robo_pep_sharepoint.sql` |
| Cadastro da máquina do robô | `supabase/snippets/20261001_cadastrar_maquina_robo_pep.sql` |
| Limpeza dos dados de teste | `supabase/snippets/20261001_limpar_dados_teste_robo_pep.sql` |
| Painel ao vivo | `/admin/robo-sharepoint` (Administração → Robô SharePoint) |
| Sugestões na PEP | `/relacionamento-prestador/pep` → cartão "Evidências do SharePoint" |
| Configuração local (fora do repositório) | `C:\Users\Maquina001\.pulsar-sharepoint\robo.env` |

**Como o robô decide:**

1. **Prestador:** pelo CNPJ da planilha, que tem de estar em Contratos.
2. **Paciente:** a pasta dele tem de estar na aba "Pacientes" do mesmo prestador; dali sai o CPF, que é procurado no cadastro, e o nome precisa ser compatível.
3. **Arquivo:** só vira sugestão quando há sessão de Coordenador de Caso daquele prestador com aquele paciente no mês. O que falhar vai para "Não reconhecidos", com o motivo.

O robô **nunca grava entrega**: quem confirma é o RP.

## Ordem dos passos

### 1. Termo de confidencialidade (você)
Sem ele, nada roda contra o SharePoint. Depois, avise o Bernardo com a frase combinada.

### 2. Aplicar o banco (você)
1. SQL Editor do Supabase → rodar `supabase/migrations/20261001120000_robo_pep_sharepoint.sql`. É idempotente e foi testado num Postgres 17 local com 37 cenários.
2. Rodar `supabase/snippets/20261001_cadastrar_maquina_robo_pep.sql`:
   - **Etapa 1** mostra o token uma vez. Copie.
   - **Etapa 2**: cole o token nas duas ocorrências de `SEU_TOKEN_AQUI`, troque `false` por `true` e rode.
3. Cole o mesmo token em `MACHINE_TOKEN=` no arquivo `C:\Users\Maquina001\.pulsar-sharepoint\robo.env`. Não mande por chat.

A tela nova nasce visível só para admin. Liberar para o grupo Diretoria só **depois** da validação: /admin/permissoes → Por grupo → Diretoria → "Robô SharePoint".

### 3. Inventário só de leitura (eu, na sua máquina, certificado Dev)
```
cd robo-pep-sharepoint
node --env-file=C:/Users/Maquina001/.pulsar-sharepoint/robo.env scripts/inventario.js
```
Gera `docs/INVENTARIO_SHAREPOINT_PEP.md`: contagens e percentuais, sem nome, CPF ou caminho. O cruzamento com o Pulsar roda em **simulação**: o banco reconhece tudo e desfaz, sobrando só o registro da execução.

### 4. Dados de teste (você + Bernardo)
1. **TiTa (você), na véspera da demonstração:**
   - profissional **"Profissional Teste Robô PEP"** e paciente **"Paciente Teste Robô PEP"**;
   - o paciente com um CPF fictício válido, por exemplo 529.982.247-25;
   - unidade 280;
   - 1 sessão de terapia **"Coordenador de Caso"** no mês corrente.

   A Grade só chega ao Pulsar às 02:00 do dia seguinte.
2. **Pulsar (você):** Cadastros → Contratos → prestador com o nome **idêntico** ao do TiTa e um CNPJ fictício válido, por exemplo 11.222.333/0001-81.
3. **SharePoint (Bernardo):**
   - pasta "Prestador de Serviço - Teste Robô PEP (TESTE ROBO PEP LTDA)", com a mesma estrutura das reais;
   - planilha de planejamento com o CNPJ acima e, na aba "Pacientes", o paciente de teste e o CPF.

   O id da pasta vai em `SHAREPOINT_SOMENTE_PASTA=` no `robo.env`; eu leio pelo robô.
4. Os nomes com "Teste" continuam **escondidos de todo o Pulsar**. Só a tela PEP, com o interruptor "Modo teste" (visível só para admin), mostra esse analista. Em modo teste nada é apurado em `pep_apuracao_mensal`: não entra na Visão geral nem na remuneração.

### 5. Coolify (você; passo a passo com segurança)
1. **Sem projeto novo.** No projeto **Sistema PULSAR** → **+ Add Resource** → Application → repositório do GitHub, branch `main`, **Base Directory** `/robo-pep-sharepoint`, Build Pack **Dockerfile**. Nome: `robo-pep-sharepoint`.
2. **Não publicar:**
   - campo *Domains* vazio;
   - sem *Ports Mappings*;
   - o container fica só na rede interna do Docker;
   - o mesmo servidor do app Pulsar, na rede padrão do Coolify, para o "Executar agora" alcançar o robô.
3. **Variáveis de ambiente.** Todas com **Is Secret / Locked** marcado:

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | a mesma do frontend |
   | `SUPABASE_ANON_KEY` | a anon legada (JWT, começa com `eyJ`) |
   | `MACHINE_TOKEN` | o **mesmo** token do passo 2. É um token por máquina: rodar o snippet de novo gera outro e invalida o anterior. Depois que o Coolify estiver no ar, não rode o `demo.js` local ao mesmo tempo que uma execução do container. |
   | `AZURE_TENANT_ID` | `04ef3593-6ac7-48d4-af1c-440fdc262020` |
   | `AZURE_CLIENT_ID` | `08a7cfa2-0474-46e7-a68d-48b7dd772912` |
   | `SHAREPOINT_SITE_ID` | `clinicauniversoaba.sharepoint.com,fb2d9027-c9df-43a9-8427-df63bb580d90,4e13619e-3de7-496d-af36-9da17d5a4e97` |
   | `SHAREPOINT_CERT_KEY_B64` | chave de **produção** em base64 (comando abaixo) |
   | `SHAREPOINT_CERT_B64` | certificado de **produção** em base64 (comando abaixo) |
   | `ROBO_TRIGGER_SECRET` | segredo aleatório (comando abaixo) |
   | `HORARIOS` | `03:00` (uma vez por dia, depois da sincronização da Grade das 02:00; é o padrão, pode omitir) |
   | `SHAREPOINT_SOMENTE_PASTA` | id da pasta de teste **durante a homologação**; apagar para ir a produção |

   **Nunca** `SUPABASE_SERVICE_ROLE_KEY` neste recurso.

   Para copiar cada valor **direto para a área de transferência**, sem aparecer na tela, rode no PowerShell um por vez e cole no Coolify:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Maquina001\.pulsar-sharepoint\pulsar-producao.key.pem")) | Set-Clipboard
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Maquina001\.pulsar-sharepoint\pulsar-producao.crt.pem")) | Set-Clipboard
   -join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) | Set-Clipboard
   ```
4. **Limites:** Memory Limit `192m` e CPU `0.5`. O servidor tem 3,8 GB compartilhados. O healthcheck já vem no Dockerfile (`/health`).
5. **Deploy** e conferir o log. Deve aparecer só `ouvindo na porta 8080` e `próxima execução: …`, e **nenhum nome de paciente**.
6. **App Pulsar (frontend) no Coolify:**
   - acrescentar `ROBO_PEP_URL=http://<nome-interno-do-container-do-robo>:8080`; o nome interno aparece no Coolify, na aba do recurso do robô;
   - acrescentar `ROBO_TRIGGER_SECRET`, o **mesmo** valor do item 3;
   - as duas **sem** `NEXT_PUBLIC_`;
   - opcional: `ROBO_INTERVALO_MANUAL_MIN` (padrão 5), o intervalo mínimo entre dois "Executar agora";
   - fazer o redeploy.
7. **Depois da 1ª execução bem-sucedida no Coolify:** apagar `pulsar-producao.key.pem` desta máquina. Eu faço, se você pedir. A chave passa a existir só no Coolify.
8. Recomendado: 2FA na conta do Coolify e acesso restrito a admins.

### 6. Demonstração ao vivo (juntos)
Três janelas lado a lado:
1. **SharePoint**, na pasta de teste: arraste um PDF para `3. Pacientes/Paciente Teste Robô PEP/1. Treinamento de Aplicadores ABA`.
2. **`/admin/robo-sharepoint`**: clique em **Executar agora**. A linha do tempo preenche etapa por etapa, com os segundos de cada uma; o cartão "Custo para o Pulsar" mostra o tempo total, o tempo no banco e as chamadas.
3. **`/relacionamento-prestador/pep`**: ligue o **Modo teste** e escolha "Profissional Teste Robô PEP". O cartão "Evidências do SharePoint" aparece sozinho, sem recarregar. Em **Revisar → Confirmar entrega**, a TAP fica 1/2 com o link do arquivo.

Antes do Coolify, dá para ver o mesmo passo a passo no terminal:
```
node --env-file=C:/Users/Maquina001/.pulsar-sharepoint/robo.env demo.js --sem-banco   # sem migration
node --env-file=C:/Users/Maquina001/.pulsar-sharepoint/robo.env demo.js               # grava; aparece no painel
```

### 7. Limpeza (você + Bernardo)
1. O Bernardo apaga a pasta de teste.
2. Você roda `supabase/snippets/20261001_limpar_dados_teste_robo_pep.sql`: primeiro a prévia, depois a trava `false` → `true`.
3. Desligar o par de teste no TiTa.
4. A trilha de auditoria da PEP é só de inserção: as linhas de teste ficam nela, marcadas com o motivo "Evidência do SharePoint confirmada (robô)".

## Por que não pesa no Pulsar (inclusive o "Executar agora")

Agenda: **uma vez por dia, às 03:00**. Perto do dia de pagamento, o reforço é o botão **Executar agora**.

**Onde o tempo vai.** Quase toda a duração de uma execução é espera pela Microsoft: listar e baixar as planilhas. Isso roda no container do robô e não toca no Pulsar. O Pulsar só é tocado em duas situações:

| Momento | O que acontece no banco | Medido (Postgres local, mais lento que o Supabase) |
|---|---|---|
| Linha do tempo | ~12 atualizações de uma linha em `sp_pep_execucoes` | milissegundos |
| Lote comum (1.000 arquivos) | gravar sugestões e reconhecer | **136 ms** |
| Pior caso: primeira carga completa, 5.000 arquivos novos + 2.000 pendentes | 5 partes; o reconhecimento roda só na última | partes de **20–30 ms** e a última de **366 ms** |

**Proteções do "Executar agora":**
- **Não trava a tela de ninguém.** O botão só dispara o pedido e responde na hora. O robô trabalha no container dele, com no máximo 0,5 CPU e 192 MB, sem disputar o servidor do Pulsar.
- **Uma execução por vez.** Um segundo pedido durante uma execução recebe "já está executando".
- **Intervalo mínimo** de 5 min entre execuções (variável `ROBO_INTERVALO_MANUAL_MIN` do app Pulsar). Cliques repetidos, ou várias pessoas ao mesmo tempo, não empilham execuções.
- **Pausa de 300 ms** entre as partes do lote: o banco atende os usuários no intervalo.
- **Corte do Supabase:** chamadas pelo papel `anon` têm tempo-limite curto por padrão (poucos segundos). Nenhuma chamada do robô consegue segurar o banco por minutos; se estourar, a execução falha e fica registrada, sem repetir.
- **Só tabelas próprias.** O robô grava apenas nas `sp_pep_*`. Quem está usando a PEP ou a remuneração não espera por trava dele.
- **Leitura curta da Grade.** Só as sessões de Coordenador de Caso dos meses das sugestões pendentes, indexadas por prestador e mês.

**Como você avalia o desempenho:**
- Em `/admin/robo-sharepoint` → **Custo de todas as execuções** (ou **Histórico completo**), filtre por **Executar agora**. Para cada execução aparecem:
  - tempo total;
  - tempo dentro do banco;
  - **maior chamada ao banco**, que é o pior momento para os usuários;
  - arquivos novos;
  - a linha do tempo com o tempo de cada etapa.
- Na homologação, clique em **Executar agora** com alguém usando a PEP ao mesmo tempo, e compare, no painel do Supabase (Reports → Database), o antes e o depois.
- **Meta:** execução até 15 s, banco até 1 s e nenhuma chamada acima de 1 s.

## Segurança em uma tabela

| Risco | Tratamento |
|---|---|
| Chave do certificado vazar | Dev e Produção são certificados separados. O app só tem **leitura** de **um** site. O Bernardo revoga no Entra num clique. |
| Token do robô vazar | Guardado só como hash; `update maquinas set token_revogado_em = now()` o derruba na hora (fim do snippet). |
| Robô alcançável pela internet | Sem domínio nem porta publicada. O "Executar agora" passa pelo servidor do Pulsar, que confere a permissão, e usa um segredo no cabeçalho. |
| Dado de paciente em log ou disco | O log só tem contagens. A planilha é lida em memória. O inventário é agregado. `.gitignore` e `.dockerignore` barram `*.pem`, `*.env` e `*.xlsx`. |
| Robô gravar entrega errada | Ele só sugere. Confirmar exige o papel `rp`/`admin` e respeita o mês liberado, na tela e também no banco. |

## Pendente com o RP (seção F do estudo)
- Nome e organização dos arquivos dentro de cada subpasta.
- De onde sai a competência. Hoje: do nome, se estiver no padrão `…-MMAAAA`; senão, da data de envio. A pessoa confirma.
- Quem pode alterar a planilha de planejamento.
- Se o envio feito por outra pessoa conta como entrega do prestador.
