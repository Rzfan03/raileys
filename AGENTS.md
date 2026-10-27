# AGENTS.md

This repo is **raileys** — a human-readable wrapper over Baileys for building WhatsApp bots.

## For AI agents building bots WITH raileys

Read the skill first: [.agents/skills/raileys/SKILL.md](.agents/skills/raileys/SKILL.md) —
API cheat sheet, return-value rules, and the 10 pitfalls that cause most "bot doesn't work" reports.
The npm package is `@rzfan03/raileys` (plain `raileys` on npm is an unrelated package).

## For AI agents developing raileys itself

- Layout: `src/` is the library (`client.ts` = facade/loop, `message.ts` = the `m` object,
  `content.ts` = inbound parsing, `reply.ts` = return-value dispatch + buffer sniffing,
  `html.ts` = HTML→WhatsApp formatting, `jid.ts`, `storage.ts`, `events.ts`, `types.ts`).
- Source of truth for any Baileys API question: the installed `node_modules/baileys/lib/**/*.d.ts` — never guess.
- Verify changes: `npm test` (builds `dist/` + runs `tests/run.mjs`), and `npx tsc --noEmit`.
- Conventions: TypeScript strict, NodeNext ESM (relative imports end in `.js`),
  zero runtime dependencies beyond Baileys, errors throw with a `raileys:` prefix.
- Public API lives in `src/index.ts` + re-exports in `src/types.ts`; keep the
  human-readable surface (`raileys()`, `bot.cmd/on/use`, `m.*`) small and chainable.
