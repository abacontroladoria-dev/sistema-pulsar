# Paleta do Connect — de `slate-*` fixo para tokens

O Connect nasceu fixo em escuro (`bg-slate-950`, `border-slate-800`), enquanto o
resto do Pulsar é escrito em claro e escurecido pelo shim `.dark` do
`globals.css`. O shim traduz **claro → escuro** (`.dark .bg-white` vira superfície
escura) e não existe na direção inversa — nem pode existir, porque `bg-slate-800`
é usado de propósito como cor escura no tema claro em outras telas.

Por isso o Connect não "ganha" tema claro ligando um seletor: cada tela precisa
falar a língua dos tokens, que já têm as duas variantes definidas.

## O de-para

| Era | Virou | Papel |
|---|---|---|
| `bg-slate-950` | `bg-background` | fundo da página |
| `bg-slate-900` | `bg-card` | superfície de cartão/painel |
| `bg-slate-800` | `bg-muted` | superfície elevada, chip, hover |
| `bg-slate-700` | `bg-accent` | elevação acima do muted |
| `border-slate-800` `border-slate-700` `border-slate-900` | `border-border` | toda borda estrutural |
| `text-slate-100` `text-slate-200` | `text-foreground` | texto principal |
| `text-slate-300` `text-slate-400` | `text-muted-foreground` | texto secundário |
| `text-slate-500` `text-slate-600` | `text-muted-foreground/70` | texto terciário, placeholder |
| `ring-slate-800` | `ring-border` | anel de foco estrutural |

## Regras que o de-para não resolve sozinho

**Opacidade não atravessa.** `bg-slate-900/50` sobre fundo escuro dá um cinza
médio; `bg-card/50` no tema claro dá branco lavado, que some. Onde a opacidade
carregava significado (linha zebrada, camada sobreposta), use o token sólido de
um degrau acima/abaixo em vez de copiar a fração.

**Cor semântica fica.** `text-emerald-400`, `bg-red-500/10` e afins **não** entram
neste de-para: dizem estado (sucesso, erro, alerta), não superfície. O shim já
cobre as famílias `-50`/`-100`; as fortes funcionam nos dois temas.

**Gradiente e estilo inline não têm token.** `from-slate-700 to-slate-900` e
qualquer `style={{ background: ... }}` precisam de decisão caso a caso — são os
pontos onde o tema claro quebra em silêncio, porque nenhuma varredura os alcança.

**`text-white` sobre cor forte fica.** Num botão `bg-blue-600` o branco é correto
nos dois temas; trocar por `text-foreground` inverteria para preto no claro.
