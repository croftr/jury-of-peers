# Jury of Peers

Twelve jurors read a case, deliberate independently, and return their findings. Works for
criminal matters, civil disputes, or settling a debate — any question with two sides.

Each juror is a **different model from a different lab**, reached through OpenRouter — so the
jury's disagreement is real, not one model arguing with itself.

```bash
npm run dev
```

## Setup

Copy `.env.example` to `.env.local` and add a key from
[openrouter.ai/keys](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=sk-or-v1-...
```

**Without a key the app still runs** — a deterministic stub engine stands in for the twelve
models, so the whole UI is exercisable offline. A badge under the title says which jury you
have.

A typical case (~800 words of evidence) costs around **half a cent per verdict** across all
twelve jurors. The exact figure for each run is shown under the verdict, and each juror's own
token count and cost is in their dossier.

## The jury

| Seat | Juror | Model | Lab |
| ---: | --- | --- | --- |
| I | The Foreperson | `anthropic/claude-haiku-4.5` | Anthropic |
| II | The Sceptic | `openai/gpt-5-mini` | OpenAI |
| III | The Empath | `google/gemini-3.1-flash-lite` | Google |
| IV | The Statistician | `deepseek/deepseek-v4-flash` | DeepSeek |
| V | The Pragmatist | `qwen/qwen3.5-flash-02-23` | Alibaba |
| VI | The Literalist | `mistralai/mistral-small-3.2-24b-instruct` | Mistral |
| VII | The Investigator | `meta-llama/llama-4-scout` | Meta |
| VIII | The Dissenter | `z-ai/glm-4.7-flash` | Z.ai |
| IX | The Elder | `microsoft/phi-4` | Microsoft |
| X | The Technician | `cohere/command-r7b-12-2024` | Cohere |
| XI | The Moralist | `nvidia/nemotron-3.5-lightning` | NVIDIA |
| XII | The Quiet One | `upstage/solar-pro4` | Upstage |

## Reading and questioning the verdict

Click any juror — in the box, or their pip in the verdict panel — for their dossier: the
finding, confidence, the rationale they gave, their sticking point, and what the call cost.

The dossier also puts a question back to that juror. **Explain** asks them to expand on
their finding; typing your own question asks that instead (*"What would have changed your
mind?"*). Their original verdict is replayed to the model as its own previous turn, so it
continues its actual reasoning rather than reconstructing a position from scratch. Each ask
is a fresh call you pay for — a few hundredths of a cent — and never happens as part of a
verdict run.

## Choosing a jury

`/jury` lists all twelve. Excuse anyone you don't want on the case (at least one must
stay), and give any juror a **standing instruction** — free text added to that juror's
system prompt, shaping how they weigh evidence without letting them abandon the two
findings or invent facts. Each juror also has their own page at `/jury/<slug>`
(e.g. `/jury/the-sceptic`), reachable from the jury list, from the bench there, and from
the **Full profile** link in the dossier that opens when you click an avatar mid-trial.

The bench and its instructions live in `localStorage` — no account, no database. The
server stores nothing; the client sends each juror's instruction along with the case.
Changing the bench changes the jury box, the tally, and the per-case cost estimate shown
on the jury page.

Edit the roster in `src/lib/models.ts`. Every model there was checked against
`https://openrouter.ai/api/v1/models` for a working slug, a sub-cent price, and structured-output
support — verify a replacement the same way before swapping one in.

## Shape of the thing

| Path | What it is |
| --- | --- |
| `src/lib/types.ts` | `CaseFile`, `Juror`, `JurorVerdict`, `Tally` |
| `src/lib/jurors.ts` | The twelve seats — archetype, disposition, procedural avatar spec |
| `src/lib/models.ts` | Which model sits in which seat, with prices and context windows |
| `src/lib/juryConfig.ts` | Who is empanelled and their standing instructions (localStorage) |
| `src/app/jury/page.tsx` | The empanelment screen |
| `src/app/jury/[slug]/page.tsx` | One juror's own page |
| `src/lib/openrouter.ts` | **The juror call** — prompt, JSON schema, lenient parsing |
| `src/lib/deliberate.ts` | The offline stub engine (`stubVerdict`) and the aggregation (`tally`) |
| `src/app/api/verdict/route.ts` | One juror, one request — the client fans out twelve in parallel |
| `src/app/api/explain/route.ts` | Follow-up questions to a juror who already decided |
| `src/components/JurorAvatar.tsx` | Procedural SVG portraits assembled from parts |
| `src/components/JuryBox.tsx` | The two arcs of seats with the well of the court between them |
| `src/components/DeliberationWell.tsx` | Live tension HUD: clock, running split, murmurs |
| `src/components/VerdictPanel.tsx` | The reveal — headline finding, split, dissent, sticking point |

## How a juror decides

`requestVerdict(juror, caseFile)` in `src/lib/openrouter.ts` is the whole contract. The
juror's `archetype` and `disposition` become its system prompt, the case becomes the user
turn, and the reply is constrained to a JSON schema — finding, confidence, rationale,
sticking point — with the two findings as a string enum, so a model cannot invent a third
verdict.

Notes on the deliberate choices in there:

- **No `temperature`.** Several roster models reject it, and the variety already comes from
  twelve different models with twelve different personas.
- **Reasoning is configured per model.** Eight of the twelve are reasoning-capable, and
  left alone some of them spend the whole token budget thinking and return empty or
  truncated JSON. A juror's reasoning belongs in its `rationale`, not in a hidden channel
  we pay for and discard — so `reasoning` on each entry in `models.ts` is `"off"`, except
  GPT-5 mini, which rejects the off switch with a 400 (*"Reasoning is mandatory for this
  endpoint"*) and gets `"low"` instead. Non-reasoning models get nothing sent. Each value
  was established by calling the model; verify before changing one.
- **Lenient parsing.** Every roster model honours `response_format`, but `parseVerdict`
  still strips code fences, walks braces to find the JSON object, tolerates confidence on a
  0–100 scale, and matches the finding by longest substring (so "Not guilty" cannot be read
  as "Guilty").
- **Failure is surfaced, never faked.** A juror whose model errors or times out (90s) shows
  as an empty seat and is excluded from the count; the remaining jurors still return a
  verdict. `juror.bias` is now only used by the offline stub.

Twelve seats means twelve concurrent calls per case — the API route is where rate limiting,
retries, and per-juror model selection belong.

## Aggregation rules

`tally()` returns the majority finding, whether it was unanimous, the split, and the mean
confidence of the jurors in the majority. A dead-even 6–6 room is reported as deadlocked;
anything else returns a majority, labelled decisive at 10+ and divided below that.
