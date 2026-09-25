---
name: ASSIM Autorizador
description: Internal clinical operations tool for Clínica Universo ABA — therapist scheduling, coverage, and authorization management.
colors:
  clinical-steel: "oklch(0.62 0.092 217)"
  clinical-steel-fg: "oklch(0.48 0.092 217)"
  clinical-steel-surface: "oklch(0.966 0.018 217)"
  clinical-steel-hover: "oklch(0.979 0.011 217)"
  clinical-ground: "oklch(0.975 0.009 217)"
  status-available: "#059669"
  status-unavailable: "#e11d48"
  status-partial: "#b45309"
  status-substituted: "#0369a1"
  status-pending: "#64748b"
  neutral-white: "#ffffff"
  neutral-ink: "#1e293b"
  neutral-secondary: "#475569"
  neutral-muted: "#64748b"
  neutral-border: "#e2e8f0"
  neutral-divider: "#f1f5f9"
typography:
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.25
  caption:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  touch: "44px"
components:
  button-available:
    backgroundColor: "{colors.status-available}"
    textColor: "{colors.neutral-white}"
    rounded: "{rounded.xl}"
    height: "44px"
    padding: "0 16px"
  button-available-hover:
    backgroundColor: "#047857"
    textColor: "{colors.neutral-white}"
    rounded: "{rounded.xl}"
  button-unavailable:
    backgroundColor: "{colors.status-unavailable}"
    textColor: "{colors.neutral-white}"
    rounded: "{rounded.xl}"
    height: "44px"
    padding: "0 16px"
  button-unavailable-hover:
    backgroundColor: "#be123c"
    textColor: "{colors.neutral-white}"
    rounded: "{rounded.xl}"
  button-brand-outline:
    backgroundColor: "{colors.neutral-white}"
    textColor: "{colors.clinical-steel-fg}"
    rounded: "{rounded.xl}"
    height: "44px"
    padding: "0 16px"
  button-brand-outline-hover:
    backgroundColor: "{colors.clinical-steel-hover}"
    textColor: "{colors.clinical-steel-fg}"
    rounded: "{rounded.xl}"
  therapist-card:
    backgroundColor: "{colors.neutral-white}"
    rounded: "{rounded.2xl}"
    padding: "0"
  status-badge-available:
    backgroundColor: "#d1fae5"
    textColor: "{colors.status-available}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  status-badge-unavailable:
    backgroundColor: "#ffe4e6"
    textColor: "{colors.status-unavailable}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  status-badge-partial:
    backgroundColor: "#fef3c7"
    textColor: "{colors.status-partial}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  status-badge-substituted:
    backgroundColor: "#e0f2fe"
    textColor: "{colors.status-substituted}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  status-badge-pending:
    backgroundColor: "{colors.neutral-divider}"
    textColor: "{colors.status-pending}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
---

# Design System: ASSIM Autorizador

## 1. Overview

**Creative North Star: "The Clinical Dispatch"**

The ASSIM Autorizador is an operational tool, not a product experience. Every therapist who opens it is already in the middle of a workday — arriving at the clinic, checking which sessions are covered, marking their own availability before the 08:00 block begins. The interface must report clearly, accept input immediately, and disappear. The job is done when the therapist has marked their status and moved on.

The system's aesthetic is white-surface clinical: flat cards, a single steel-blue brand signal, and a five-color semantic vocabulary for session status. Color means something specific here; it is never decorative. The typography is a single weight-modulated family (Geist) at fixed rem scales — no fluid clamp, no display pairing — because the interface loads in the same DPI context every time and users need consistency, not dynamism.

The design explicitly rejects: multi-step flows that delay the core status action, calendar-view abstractions that hide individual session detail, and mobile-hostile layouts (the tool is used as a PWA on the clinic floor, often on a phone). Status must be visible, legible, and tappable in under two seconds.

**Key Characteristics:**
- White-surface base with brand steel-blue as the single identity signal
- Five fixed semantic colors for availability states (no improvisation)
- 44px minimum touch targets throughout — no exceptions
- Cards organized by therapist, not by time slot
- Two-zone card structure: identity zone above the divider, action zone below
- Flat elevation with shadow-sm cards floating on a brand-tinted ground

## 2. Colors: The Clinical Palette

One identity color. Five semantic states. Everything else is slate.

### Primary

- **Clinical Steel** (`oklch(0.62 0.092 217)`): The brand identity color. Used for focus rings, icon fills, avatar backgrounds tinted with Clinical Steel Surface, active navigation indicators, and brand-label text in the sticky header. Never used as body text on white at sizes below 24px — contrast fails at 3.6:1.
- **Clinical Steel fg** (`oklch(0.48 0.092 217)`): The accessible text variant of Clinical Steel. Used for any text rendering on white or light surfaces: therapy type labels (14px), session time stamps (12px), button labels on brand-outline buttons, subtitle text in the header. Contrast: ≥4.5:1 on white (WCAG AA). This is the only form of brand blue permitted in running text.
- **Clinical Steel Surface** (`oklch(0.966 0.018 217)`): Avatar and icon container backgrounds. A barely-there tint that places the brand icon visually without announcing itself.
- **Clinical Steel Hover** (`oklch(0.979 0.011 217)`): Hover background for brand-outline buttons. Even lighter than Surface — a breath of blue on white.
- **Clinical Ground** (`oklch(0.975 0.009 217)`): The page-level background. Distinguishes the page from card surfaces without introducing visible color.

### Secondary — Status Vocabulary

All five states carry a fixed meaning across every screen. None are interchangeable.

- **Available Emerald** (`#059669`): Confirmed therapist presence. Button fill and badge background for `disponivel` state.
- **Unavailable Rose** (`#e11d48`): Therapist absent. Button fill and badge for `indisponivel`.
- **Partial Amber** (`#b45309`): Some sessions confirmed, some not. Badge only — no action button in partial state.
- **Substitute Sky** (`#0369a1`): Session transferred to another therapist. Badge for `substituido`.
- **Pending Slate** (`#64748b`): No status recorded yet. Badge for `pendente`. Also the default muted text color.

#### Contrast correction (2026-08-19)

The badge recipes originally published in §5 paired a `-600` text with a `-50`/`-100` tint. Measured, several land below the 4.5:1 that 12px badge text requires: available `#059669` on `#d1fae5` is 3.3:1, unavailable `#e11d48` on `#ffe4e6` is 4.0:1. **Badge text uses the `-700` step; the base status hex stays the fill/button value.** Partial Amber (`#b45309` = amber-700) and Substitute Sky (`#0369a1` = sky-700) were already at the correct step and are unchanged.

#### Extension: Authorization vocabulary (`/auditoria-assim`)

The Status Lock Rule requires documenting before extending, so: the authorization audit tracks a **six-stage lifecycle** the therapist-availability vocabulary has no word for. It reuses the locked hues where the meaning matches and adds **two**: violet and stone.

Colors are assigned by the `prioridade` the RPC already returns (1 = most urgent), so the palette encodes the same severity that orders the list.

| Prioridade | Estado | Hue | Meaning |
| --- | --- | --- | --- |
| 1 | Não Solicitada | Rose 700 | Nothing sent yet — the widest gap |
| 2 | Glosa | **Violet 700** | Claim rejected. A financial outcome needing a dispute, not a resend |
| 3 | Retorno Não Confirmado | Amber 700 | Sent, no answer |
| 4 | Sincronizando | Sky 700 | In transit |
| 5 | Cancelada | Slate 600 | Closed with no effect |
| 6 | Liberada | Emerald 700 | Authorized |
| — | Falta / Falta Terapeuta | **Stone 600 / 700** | The session did not happen — outside the authorization ramp entirely |

**Violet** is new because glosa is categorically unlike the other five: every other state is a workflow stage that time advances, while glosa is a terminal financial rejection. Violet is **semantic only** — it is not available for focus rings, sort indicators, or any decoration, so that one hue never means "glosa" in one cell and "you are here" in the next.

**Stone** is new because faltas are not authorization states at all. Keeping them off the ramp stops an absence from reading as a lifecycle stage. The pair distinguishes by weight, icon, and label — never by hue alone. (Before this pass, `NAO_SOLICITADA` and `FALTA_TERAPEUTA` both rendered `red-50 / red-600 / ring-red-300`, separated only by a red-600 vs red-500 dot: two meanings, one appearance.)

**Two orthogonal axes may appear in the same row.** Situação (above) and conferência de filipeta (emerald = conferida, amber = a conferir) are different dimensions, so an emerald "Liberada" pill beside an amber "Conferir" pill is correct, not a collision — both carry text labels. Amber's meaning is consistent across both axes: *waiting on something*.

##### The surface step (2026-08-20)

Each situação now carries a **second, weaker form of the same hue** — a `surface` entry (`-50/70` fill + `-200/80` hairline) alongside the badge recipe, both living in `SITUACAO_CONFIG`. No new hue: the surface step is the existing hue at container strength, for when a situação has to tint a whole region instead of a pill.

Its only consumer is the header of `ModalDetalhamentoAtendimento`, which previously carried a 4px colored spine across the top of the dialog. The spine was color touching no content — the severity still had to be read off the badge, so the hue was spent on decoration. Wearing the hue on the header surface makes the state arrive with the patient's name.

Two constraints ride with it, and a new situação must satisfy both or get neither form:

- **Tint only, never text.** What sits on a surface is slate (title `slate-900`, subtitle `slate-600` — measured 7.1:1 to 7.4:1 across all six tints). A situação hue never becomes reading text outside its own badge.
- **The surface reinforces a label, never replaces one.** The tinted header still contains the `SituacaoBadge`. Remove the badge and the tint alone would be the state — which is the color-as-sole-signal failure the vocabulary exists to prevent.

##### Âmbar sólido não é botão (2026-08-20)

Amber has no accessible solid-fill form. White text needs `-700` or darker to clear 4.5:1 (`amber-500` measures **2.15:1**, `amber-600` 3.0:1), and `amber-700` as a fill reads as rust — fine once, a wall when it repeats down a list. So **amber never fills a button.** The conferência control is a tint-and-ring pill in both states, which is what `TabelaAuditoria` already used: `bg-amber-100 / text-amber-900 / ring-amber-400` a conferir, `bg-emerald-50 / text-emerald-700 / ring-emerald-200` conferida.

The same reasoning governs filter chips. `KpiCards` had already settled the pattern — active = `-50` tint + `-400` border + `-700`/`-800` text, never a saturated fill with white text — and the Conferência de Filipetas tabs now follow it instead of the `bg-amber-500 text-white` they shipped with.

A filter chip *may* wear a status hue, and that is not a Decoration-Free violation: the chip filters that exact status, so the hue is still the state. The rule bans a status hue on something that isn't that status.

##### Steel on `/auditoria-assim` (2026-08-20)

The 2026-08-19 pass removed the competing blues from this surface but left brand steel absent from it, which is half the Decoration-Free Semantics Rule: status hues stop decorating *and* steel takes the roles they vacated. In the detail modal steel now holds exactly three: the section titles (`brand-fg`, the structural wayfinding layer), both save buttons, and the focus rings.

Notably, **"Salvar motivo" moved off `violet-600` onto `brand-fg`**. Filled violet made one hue mean "this block is a glosa" and "primary action" within a single section, and made the modal's two save buttons two different components. Steel is deliberately kept off the 16 field labels — spread that far it stops being a signal and just becomes the modal's text color.

##### The third axis: cota semanal (2026-08-20)

A row on this surface can now carry **three orthogonal dimensions**, and the Status Lock Rule is satisfied by reusing hues rather than adding one:

1. **Situação** — the six-stage authorization lifecycle above. Its own hue per stage.
2. **Conferência de filipeta** — emerald conferida / amber a conferir.
3. **Cota semanal** — emerald *a conta bate*, amber *divergente*. It lives on the Reconciliação tab, which compares the sessions a patient had scheduled in a week against the authorizations ASSIM actually processed for that week, per TUSS. (It shipped as a modal on the Conferência tab on 2026-08-20 and was folded into that tab a day later: the weekly read is *how* you discover a guia needs linking, so it belongs on the screen where the linking happens.)

**No new hue.** Amber keeps the meaning it already carries on both other axes — *waiting on someone to look* — and emerald keeps meaning *settled*. That consistency is the whole reason a third axis can coexist in one row without the reader having to learn a third vocabulary.

Two constraints, same as the other axes:

- **Violet stays out.** Glosa is the *consequence* of a blown quota, not the quota state itself. Letting violet mean "over quota" here would make the hue mean two things one screen apart.
- **The tally chips wear the hue because they filter it.** Each chip in the placar filters both columns to its TUSS, so the hue is still the state — the Decoration-Free Semantics Rule bans a status hue on something that *isn't* that status, not on a control that selects it. Chips follow the `KpiCards` recipe: active = `-50` tint + `-300` border + `-700` text, never a saturated fill (see Âmbar sólido não é botão).

**"Not paired" is not a state, so it gets no hue.** In the authorizations column, amber is reserved for the guia that is genuinely in the reconciliation queue — the one `get_guias_orfas` says needs a link. A guia that merely fails to touch any session of the *displayed* week (already triaged, paired to a neighbouring week, or captured by Pulsar itself) wears a slate pill reading *fora desta semana*. The distinction is the whole point: amber promises there is work to do, and a screen that promises work where there is none stops being read.

##### Conferência de Guias: cor como "onde agir" (2026-09-24)

No new hue. The surface has one action repeated on every row ("Assinar"), and ten filled blue buttons made the blue stop meaning anything. The dosage rule here:

- **Filled blue once.** Only the current row, the one the keyboard is on, gets the filled `blue-600` (the `--sidebar-primary` blue the app actually uses). Every other row carries the same button outlined (`border-slate-200` / `text-blue-700`), and it fills on row hover. The filled button moves down the sheet as she marks rows.
- **Status is tint + hairline** (`-50` / `-200` / `-700`): amber means waiting to be checked, emerald means signed, rose means did not sign. Filled means decided and outlined means an action. The words are always in the badge.
- **The line-number circle wears the row state.** Rose is an open problem, sky is with the reception desk, emerald is checked, slate is still to check, and blue is the current row. Read down the left column, it replaces the old dot strip as the sheet in miniature. It is reinforcement only: the same state is always in text on the row.
- **The patient card is white.** The initials sit on `blue-100`. Brand hue never tints the section.
- The summary filter cards follow the KpiCards recipe with a `-300` border, not `-400`, because `-400` has no pair in the dark shim.

### Neutral

- **Ink** (`#1e293b` / slate-800): Primary text. Therapist names, patient names, any primary label.
- **Secondary** (`#475569` / slate-600): Secondary text. Unit labels, section subheadings, sidebar nav text.
- **Muted** (`#64748b` / slate-500): Tertiary text. Session count, bullet separators, metadata timestamps. Minimum for body text at all sizes (4.76:1 on white).
- **Border** (`#e2e8f0` / slate-200): All card borders, input strokes, header bottom border, sidebar right border.
- **Divider** (`#f1f5f9` / slate-100): Internal card dividers. The line separating the identity zone from the action zone inside Therapist Cards, and the lines between expanded session rows.
- **White** (`#ffffff`): Card surfaces, sticky header, sidebar, all input backgrounds.

### Named Rules

**The One Steel Rule.** Clinical Steel appears as an accent signal, not a background color. It colors initials, focus rings, brand-label text, and navigation indicators. It does not fill buttons (those are semantic: emerald or rose), tint sections, or paint headings. The single appearance of brand blue per card is the therapy type label — that's the maximum.

**The Status Lock Rule.** The five semantic state colors (emerald, rose, amber, sky, slate) are locked to their meanings. Emerald is always available. Rose is always unavailable. Adding a colour for a new state requires updating this document first — see the authorization extension above, which added violet and stone under that rule.

Added under this rule (2026-09-23): the audit-risk badge in `ModalDetalheEvolucao` (`/terapeutico/auditoria-evolucoes`) reuses the existing meanings rather than a new hue — `sem_risco` (no glosa risk) is emerald, `risco_especifico` (a small, fixable gap) is amber, `risco_relevante` (real glosa risk) is rose. No new state color was introduced; a prior version of this badge used Tailwind `red-*`, a hue outside this vocabulary, and has been corrected to `rose-*`.

**The Decoration-Free Semantics Rule.** A hue that carries a status meaning is spent; it may not also decorate. Focus rings, sort indicators, pagination, and primary actions use Clinical Steel — never a status hue. This is what `/auditoria-assim` violated before 2026-08-19: violet meant "glosa" in the badge and "sorted by this column" in the header two rows up, while the brand steel was absent from the surface and two other blues (indigo, violet) competed for the accent role.

## 3. Typography

**Body Font:** Geist (Latin subset), `system-ui, sans-serif` fallback.
**Display, Heading, Label, Mono:** Geist at different weights. One family; no pairing.

**Character:** A single geometric sans at four weights — functional, neutral, and immediately readable under fluorescent clinic lighting. No editorial personality; legibility is the personality.

### Hierarchy

- **Title** (700, 16px, line-height 1.25): Therapist names inside cards. The primary identity label per row.
- **Body** (500–600, 14px, line-height 1.5): Therapy type label (600), form control values, button labels, filter dropdowns. The working layer of the interface.
- **Label** (600, 12px, line-height 1.25): Status badge text, session-level patient names, session time stamps. All uppercase is prohibited at this size.
- **Caption** (500, 11px, line-height 1.25): Audit trail text only — "Updated by [name] · DD/MM at HH:MM". Never used for interactive or instructional text.

### Named Rules

**The Fixed Scale Rule.** No `clamp()`, no fluid type. Font sizes are fixed rem values. The tool runs on known DPI contexts and users need stable spatial memory — a therapist learning where the status badge sits should never find it repositioned by viewport width.

**The Single Family Rule.** Geist at weight contrast carries all hierarchy. Adding a second typeface is prohibited.

## 4. Elevation

The system is flat by default. White card surfaces float on the Clinical Ground background; the color contrast between `oklch(0.975)` and `#ffffff` provides separation without shadow.

### Shadow Vocabulary

- **Card Ambient** (`box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04)`): Applied to Therapist Cards and the Filter Panel. This is the only shadow in use. Its purpose is to lift cards off the ground color, not to convey interactivity.

There are no hover shadows, no modal drop shadows stored as CSS tokens, no inner shadows. Elevation is depth of content, not depth of surface.

### Named Rules

**The Flat-by-Default Rule.** Surfaces rest flat. `shadow-sm` lifts cards off the page background, and that is its only job. State changes (hover, active, saving) are expressed through color shift and opacity, never through added elevation. A button that adds a shadow on hover is wrong.

## 5. Components

### Buttons

Cards carry three button variants, each with a fixed semantic role. No generic "primary" button exists — every button is typed to its outcome.

- **Shape:** Rounded corners (14px). All buttons are `height: 44px` — the minimum touch target. Width is flexible (`flex: 1` on action buttons, fixed on icon-adjacent tertiary buttons).
- **Mark Available (Primary Action):** Emerald fill (`#059669`), white text, no border. Hover: `#047857`. Focus: `box-shadow: 0 0 0 2px #059669, 0 0 0 4px rgba(5,150,105,0.25)`. Disabled: `opacity: 0.5`.
- **Mark Unavailable (Destructive):** Rose fill (`#e11d48`), white text, no border. Hover: `#be123c`. Focus: rose ring.
- **Brand Outline (Tertiary):** Transparent fill, `1px solid {clinical-steel}` border, Clinical Steel fg text. Hover: Clinical Steel Hover background. Used for "Substituição" and "Encerrar disponibilidade" — secondary actions that frame an existing state rather than creating a new one.
- **Disabled:** All buttons use `opacity: 0.5` while `salvandoStatus` is true. No cursor change needed at mobile scale.

### Status Badges

Five fixed states. The badge appears at the top-right of every Therapist Card header. It is the fastest status read — visible before the therapist name registers.

- **Shape:** Pill (`border-radius: 9999px`), `padding: 4px 12px`, `font-size: 12px, font-weight: 600`.
- **Disponível:** `bg: #d1fae5`, `text: #059669`
- **Indisponível:** `bg: #ffe4e6`, `text: #e11d48`
- **Indispon. parcial:** `bg: #fef3c7`, `text: #b45309`
- **Substituído:** `bg: #e0f2fe`, `text: #0369a1`
- **Pendente:** `bg: #f1f5f9`, `text: #64748b`

Color alone is never the only signal — the text label is required and always visible.

### Cards / Containers

The Therapist Card is the signature component. It has two zones separated by a 1px `slate-100` divider:

- **Identity Zone (top):** Avatar circle (44px, Clinical Steel Surface bg, Clinical Steel fg initials) + therapist name (Title) + therapy type (Body, Clinical Steel fg) + meta row (session count, unit, time range in Caption/Label). Status badge floats right, chevron toggle beside it.
- **Action Zone (below divider):** Full-width action buttons (44px height, gap-2). Button set changes based on current status: pending shows Available + Unavailable (+ Substituição if a critical slot exists); available shows Confirm Pending + Close Availability; unavailable/substituted shows Available Now + Substituição.
- **Audit Trail (bottom, conditional):** 11px muted text, right-aligned. "Updated by [name] · DD/MM at HH:MM". Shown only when `ultimaAlteracaoPor` is set and status is not pending.
- **Expanded Sessions (below audit trail, conditional):** Divide-y session rows, each showing patient name (14px ink), session time (12px Clinical Steel fg), and per-session status badge.
- **Card styles:** `background: white`, `border-radius: 18px`, `border: 1px solid #e2e8f0`, `box-shadow: 0 1px 2px rgba(15,23,42,0.04)`.

### Inputs / Fields

Filter panel inputs and date pickers share a unified style:

- **Style:** White background, `1px solid #e2e8f0` border, `border-radius: 14px`, `padding: 12px 16px`, `font-size: 14px`.
- **Focus:** `outline: none`, `box-shadow: 0 0 0 2px {clinical-steel}`, `border-color: transparent`. The Clinical Steel ring is the only focus treatment — no background shift.
- **Select dropdowns:** `appearance: none` with an absolutely-positioned ChevronDown icon (16px, slate-400, pointer-events: none). The icon is decorative (`aria-hidden`).
- **Search input:** Left-padded to accommodate an inset Search icon (`padding-left: 40px`). Icon at 14px, slate-400.

All inputs have a visually-hidden `<label>` associated via `htmlFor/id`. Placeholder text alone is never the only label.

### Navigation

The desktop sidebar (`width: 256px`, fixed, `z-index: 50`) uses white background with a `1px solid #e2e8f0` right border.

- **Nav item default:** `text-slate-600`, transparent left border indicator, `hover: bg-slate-50 text-slate-800`.
- **Nav item active:** `bg-blue-50`, `border-left: 2px solid blue-500`, `text-blue-700 font-medium`. (Note: sidebar still uses Tailwind `blue-*` utilities; migration to brand tokens is pending.)
- **Section grouping:** `SidebarGroup` components with collapsible groups by domain (Pacientes, Terapêutico, Operações, Administração).
- **Mobile:** The sidebar is not present on the therapist-facing `disponibilidade-terapeuta` surface. That surface is a standalone PWA with its own sticky header.

### Therapist Availability Page (Signature Surface)

The `disponibilidade-terapeuta` page is a standalone PWA shell used by a single role (`disponibilidade_terapeuta`). It has no sidebar. The sticky header carries logo, clinic name (Title, Ink), and page title (Body, Clinical Steel fg). Below the header: a Filter Panel card (date, sort, status filter, search) and a scrollable list of Therapist Cards.

Real-time sync via Supabase `postgres_changes` subscription — cards refresh automatically when any `controle_terapeutico` row changes.

## 6. Do's and Don'ts

### Do:

- **Do** use Clinical Steel fg (`oklch(0.48 0.092 217)`) for any brand-colored text on white or Clinical Steel Surface. Never use the base Clinical Steel at text sizes below 24px on light backgrounds.
- **Do** make every interactive element at least 44px tall. The tool runs on phone screens in a busy clinic.
- **Do** show patient name, time, and room detail inside the card so therapists confirm they're reporting on the right session before tapping.
- **Do** use the full five-badge vocabulary for status. Every state has a distinct semantic and visual identity — "Indispon. parcial" is not a variant of "Indisponível".
- **Do** separate card identity (who) from card action (what to do) with the `slate-100` divider. The two-zone structure is the core interaction pattern.
- **Do** announce loading state, error state, and result count via `aria-live="polite"` regions so screen reader users get the same feedback as sighted users.
- **Do** wrap all form controls in `<label>` elements, even when the label is visually hidden with `sr-only`.

### Don't:

- **Don't** bury session detail behind a calendar or timeline view. Therapists confirm availability per session — they need to see each session to know what they're confirming.
- **Don't** introduce multi-step flows for the core available/unavailable action. One or two taps maximum.
- **Don't** use the base Clinical Steel (`oklch(0.62 0.092 217)`) as text color on any surface lighter than `oklch(0.50)`. It fails WCAG AA at 3.6:1.
- **Don't** add new status colors or modify the five semantic state colors without updating the Status Lock Rule in this document first. Clinical decisions depend on status color meaning being stable.
- **Don't** add shadow on hover or active states. The system is flat. State changes are color shifts (darker fill on hover) and opacity changes (0.5 on disabled), not elevation changes.
- **Don't** build mobile-hostile layouts. Every screen this tool runs on is a PWA installation — no hover-only affordances, no fixed-width containers.
- **Don't** use placeholder text as the only form label. Screen readers do not reliably announce placeholder as the field's label.
- **Don't** use side-stripe borders (`border-left` or `border-right` wider than 1px) on cards or list items. The sidebar's active 2px border-left on nav items is a legacy pattern — do not replicate it in new components.
