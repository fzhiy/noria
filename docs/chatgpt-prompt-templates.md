# ChatGPT Pro Thinking — Prompt Templates

> For use with ChatGPT Pro ($100) GPT-5.4 Thinking / Deep Research mode.
> Output goes to `outputs/research/` ONLY. **NEVER** to `raw/` (kb-compile scans raw/ recursively).

## Research Topic Context

When using these templates, prepend this context block:

```
I'm building a research knowledge base on:
"Continual adaptation of web agents under UI drifts and workflow drifts"

Scope: LLM-powered web/GUI agents that continuously adapt to changing web interfaces
(UI drift: layout, DOM, visual changes) and evolving task procedures (workflow drift:
process changes, new steps). Includes continual learning, self-evolving agents, agent
robustness, drift detection, and evaluation benchmarks.

Key benchmarks: WebArena, BrowserGym, OSWorld, WorkArena, Mind2Web, VisualWebArena
Key methods: LoRA/PEFT adaptation, workflow memory, agent self-reflection, process reward models
```

---

## Template 1: Frontier Scout

**When to use**: Gap scan shows a frontier gap (newest source >1 year old) or demand gap (queried but thin coverage).

```
Using deep research mode, find the 5-10 most significant papers published after [DATE]
on the topic: [GAP TOPIC]

For each paper, provide:
1. Title, authors, venue, year
2. arXiv ID or DOI (I need these to import via API)
3. Key contribution in 2-3 sentences
4. How it relates to: [EXISTING CONCEPT from wiki]
5. Whether it confirms, extends, or contradicts existing work

Focus on:
- Peer-reviewed or accepted conference papers (prefer top venues: ICLR, NeurIPS, ICML, ACL, EMNLP, AAAI, WWW, CHI, UIST)
- Papers with concrete experiments, not just position papers
- Cross-domain connections (HCI, software evolution, continual learning, web automation)

Output format: structured list with arXiv IDs clearly marked for batch import.
```

## Template 2: Claim Verifier

**When to use**: Nightmare review flags a disputed claim, or accuracy feedback disputes a wiki statement.

```
I need to verify the following claim from my research knowledge base:

CLAIM: "[EXACT CLAIM TEXT]"
SOURCE PAGE: [wiki page name]
CITED AS: [source: citekey, sec.X]

Please:
1. Find the original paper (search by title/authors/DOI)
2. Locate the specific section cited (sec.X)
3. Check if the claim accurately represents what the paper says
4. Search for papers that CONTRADICT this claim
5. Rate confidence: CONFIRMED / PARTIALLY ACCURATE / INACCURATE / UNABLE TO VERIFY

Provide exact quotes from papers with section references where possible.
Do NOT fabricate citations — say "unable to verify" if you cannot find the paper.
```

## Template 3: Related Work Builder

**When to use**: Structural gap (concepts share sources but no synthesis bridges them) or a concept page has few source citations.

```
For the research area: [CONCEPT NAME]
Current coverage in my KB: [LIST 3-5 existing sources briefly]

Find all significant papers from 2024-2026 that my KB does NOT yet cover, focusing on:
[SPECIFIC SUB-AREA or ANGLE]

For each paper:
1. Title, authors, venue, year, arXiv ID/DOI
2. Key method or finding
3. Which of my existing sources it most closely relates to
4. Novelty: what does this add that my current sources don't cover?

Prioritize:
- Papers that BRIDGE two concepts I already have but haven't connected
- Papers from adjacent fields (HCI, software engineering, distributed systems)
- Highly cited recent work (>20 citations for 2024, >5 for 2025-2026)

Do not include papers I already have: [LIST citekeys of existing sources]
```

---

## Usage Checklist

After getting ChatGPT Pro output:

1. Extract all arXiv IDs and DOIs into a list
2. Save the full analysis to `outputs/research/<date>-<task>.md`
3. If thinking chain is valuable, save to `outputs/research/<date>-thinking-<topic>.md`
4. Run `/kb-sync arxiv "ID1" "ID2" ...` for discovered papers
5. Run `/kb-compile` to process newly synced papers
6. The ChatGPT output itself is reference material only — wiki claims must cite the actual papers

---

## Thinking Effort Routing

When using `/kb-deep-research`, effort is auto-selected but can be overridden:

| Task Pattern | Effort | Web Level | Codex CLI flag |
|---|---|---|---|
| Paper summary, simple lookup | `medium` | Standard | `-c 'model_reasoning_effort="medium"'` |
| Gap analysis, claim verification | `high` | Extended | `-c 'model_reasoning_effort="high"'` |
| Cross-domain synthesis, hypothesis | `xhigh` | Heavy | `-c 'model_reasoning_effort="xhigh"'` |

Tasks requiring **Pro model** or **Deep Research** are routed to ChatGPT Web (manual or Playwright).

## Automation Integration

These templates are used by `tools/chatgpt-research-agent.ts`:
- `think` mode: auto-selects template + effort, runs via Codex CLI
- `manual` mode: generates prompt for ChatGPT Web paste
- `parse` mode: processes pasted results
- `auto-loop` mode: cycles gap-scan → think → sync

### `--auto-sync` flag (advisory output only)

Passing `--auto-sync` to `think` or `parse` mode **prints** the suggested sync commands to stdout — it does **not** execute them automatically. This is intentional: syncing and compiling modify the KB and require user confirmation.

The actual execution is orchestrated by the user or the `/kb-deep-research` skill, which runs the printed commands after reviewing the extracted IDs. Always verify IDs against the local KB (a dedup-check command is printed alongside each sync command) before running `/kb-sync`.
