# NEXUS AI design system

## Status

Phase 3 establishes the visual and interaction language used by NEXUS AI. The system is implemented with CSS Modules, global CSS custom properties, typed React components, and narrowly scoped Client Components for interactive behavior. Tailwind CSS is not installed.

The living reference is available at `/design-system`. It contains real component states rather than static pictures and is intentionally public so visual and accessibility review does not depend on an account.

## Design direction

NEXUS is a high-precision signal interface: dark, quiet, and operational without looking like a generic analytics dashboard. Its recurring motifs are short cobalt signal lines, monospaced evidence labels, restrained burgundy risk surfaces, strong condensed display type, and clear state boundaries.

The system avoids ornamental glass panels, neon gradients, excessive glow, decorative chat bubbles, and invented AI imagery. Motion communicates entry or state change and is never essential.

### Core palette

| Token | Value | Use |
| --- | --- | --- |
| Void | `#08090D` | Application background |
| Carbon | `#11131A` | Primary surface |
| Signal | `#2457FF` | Primary action and active state |
| Burgundy | `#650D2D` | Risk/destructive context, used sparingly |
| Paper | `#F5F5F7` | Primary text |
| Graphite | `#9297A5` | Muted supporting text |
| Border | `#252936` | Surface and control boundaries |

Semantic success, warning, danger, and information colors have matching muted surfaces. Text and icon labels accompany color-based states.

## Global tokens

`src/styles/globals.css` owns the stable system vocabulary:

- palette and semantic colors;
- sans, display, and monospaced type roles;
- responsive type scale and line heights;
- four-pixel-derived spacing scale;
- radius scale from compact controls to large panels;
- restrained elevation and focus ring;
- control heights and minimum touch targets;
- content width, gutter, header, and sidebar dimensions;
- layer ordering for navigation, menus, overlays, and notifications;
- motion durations/easing and reduced-motion overrides.

Feature CSS Modules consume tokens and must not introduce a new hard-coded brand color without updating this contract.

## Component inventory

| Area | Components | Location |
| --- | --- | --- |
| Actions | `Button`, `ButtonLink` with four variants, three sizes, loading and disabled states | `src/components/ui/button.tsx` |
| Forms | `Input`, `TextArea`, `Select`, and labelled field compositions with hint/error wiring | `src/components/ui/form-field.tsx` |
| Surfaces | `Card`, `CardHeader`, `CardBody`, `CardFooter` | `src/components/ui/card.tsx` |
| Overlays | Focus-contained `Modal`; keyboard-operated `DropdownMenu`; focus/hover `Tooltip` | `src/components/ui/` |
| Feedback | Toast provider, skeletons, empty states, and recoverable error states | `src/components/feedback/` |
| Navigation | Top navigation, responsive product sidebar/shell, and pagination | `src/components/navigation/` |
| Data | Keyboard-accessible tabs and horizontally scrollable semantic table frame | `src/components/ui/` |
| Status | Multi-tone status pill with text plus a visual indicator | `src/components/ui/status-pill.tsx` |
| Icons | Accessible Lucide wrapper with decorative-by-default behavior | `src/components/ui/icon.tsx` |

Interactive files declare their own Client Component boundaries. Static surfaces remain server-compatible and do not force parent routes into the client bundle.

## Accessibility contract

The target is WCAG 2.2 AA for product-owned surfaces.

- All fields have programmatic labels; hint/error text is connected through `aria-describedby`.
- Errors are announced and invalid fields expose `aria-invalid`.
- Buttons retain a clear accessible name while loading and expose `aria-busy`.
- The modal has dialog semantics, traps Tab focus, closes with Escape, locks background scroll, and restores prior focus.
- The dropdown uses menu semantics and supports Arrow keys, Home, End, Enter, and Escape.
- Tabs implement the automatic activation keyboard pattern.
- Tooltips appear for keyboard focus and pointer hover and close with Escape.
- Toasts use polite status announcements, except error messages use assertive alerts.
- Skeletons are hidden from the accessibility tree while their container exposes the loading state.
- The sidebar becomes an explicitly labelled off-canvas navigation panel on narrow screens.
- Focus indicators are high-contrast and never removed without a replacement.
- Motion is reduced to effectively zero when `prefers-reduced-motion` is active.

Automated Axe checks are a gate, not a substitute for manual keyboard, zoom, contrast, and screen-reader review.

## Responsive behavior

Layouts use content-driven breakpoints rather than device names:

- multi-column surface groups collapse before their content becomes cramped;
- table frames scroll independently while keeping the page width stable;
- top navigation becomes horizontally scrollable;
- the product sidebar becomes an off-canvas panel;
- modal actions grow to fill available mobile width;
- forms collapse from two columns to one;
- all tested controls retain at least the system touch-target height.

The browser suite asserts no document-level horizontal overflow at 390 CSS pixels.

## Usage rules

1. Reuse a system component before adding feature-local control styling.
2. Use primary actions once per decision area; use secondary or ghost actions for alternatives.
3. Reserve danger styling for actions with destructive or security-relevant consequences.
4. Give empty states one honest next action; never imply unavailable functionality works.
5. Keep error text actionable and include a safe reference identifier when support may need correlation.
6. Use a skeleton only when the final geometry is known; otherwise use a concise progress status.
7. Keep icon-only controls explicitly labelled. Decorative icons remain hidden from assistive technology.
8. Avoid page-local z-index values and colors; use layer and palette tokens.

## Verification

`npm run test:design-system` runs the focused browser suite. It checks:

- Axe WCAG A/AA rules;
- keyboard behavior for menu, tooltip, modal, tabs, and toast interactions;
- modal focus restoration;
- mobile sidebar operation;
- small-viewport page overflow.

Vitest covers server rendering, field associations, validation state, loading buttons, cards, and empty-state semantics. The normal `npm run check` gate still runs formatting, ESLint, strict TypeScript, all unit tests, and the production build.

## Scope boundary

Phase 3 provides components and a reference surface. It does not invent product data, complete the Phase 4 marketing/dashboard experience, add a light theme, or implement future conversation, document, knowledge, or workflow behavior.
