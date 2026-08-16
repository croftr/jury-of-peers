# Jury of Peers

Twelve jurors read a case, deliberate independently, and return their findings — then, if you
send them back out, hear each other and are asked again. Works for criminal matters, civil
disputes, or settling a debate — any question with two sides.

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
twelve jurors. Longer cases cost proportionally more — a hundred-thousand-token file is
nearer twenty cents a round — so the case form estimates the run before you commit to it.
The exact figure is shown under the verdict once the tokens are real, and each juror's own
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

## How long a case can be

The twelve context windows differ by two orders of magnitude — Phi-4 holds 16k tokens where
Gemini holds a million — so "how long can the evidence be" has twelve different answers. The
case form works them out for the case actually in front of it and says, before the jury goes
out, which jurors cannot read a file this long and roughly what the round will cost.

A juror whose model cannot hold the case is **refused rather than sent**: an over-long prompt
is a 400 from the provider, so sending it costs money to be told nothing and reads as an
upstream error rather than the plain fact that the model is too small. Their seat shows empty
with the reason in their dossier, and the verdict rests on the jurors who could read it. The
rehearsal engine honours the same limits, so an offline run is a faithful rehearsal.

The second round is checked separately: it carries the whole room on top of the case, so a
juror who could read the file alone may not be able to read it with everyone else's argument
attached.

Estimates come from `src/lib/estimate.ts`, which counts tokens roughly — about four
characters to the token, with a safety margin — rather than pretending to twelve different
tokenisers. It errs high, because guessing low is the expensive direction.

A case can also be too large to *file*, which is a separate limit: `MAX_EVIDENCE_BYTES`,
derived from the archive's per-record ceiling with room for two rounds of verdicts, and
measured in bytes rather than characters. That one is only a warning — the jury still hears
the case, it just is not remembered.

## Spending, and stopping

Two brakes, neither of them a security control — the password on the door is that:

- **Calling them back.** While the jury is out, every seat still thinking is a call still
  running and still being billed. **Call them back** under the deliberation aborts them: the
  client hangs up, and the request's signal is threaded into the OpenRouter call, so the
  upstream request stops rather than running to completion for an answer nobody will see.
  Closing the tab does the same.
- **A rate limit.** `src/lib/rateLimit.ts` caps model calls at 90 per five minutes per
  caller, and uploads at 40. A full twelve-juror round is twelve calls and a case heard twice
  is twenty-four, so this leaves room for real use and stops a runaway loop dead. In memory,
  so it resets with the server — the right trade for a personal tool.

Retries wait a jittered half-second to a second and a half before the single retry, because
an immediate retry of a 429 is just a second 429.

## Sending them back out

The first round is silent: twelve jurors decide alone, and nobody hears anybody. **Send them
back out** under the verdict runs a second round in which each juror is shown what every
other juror found, at what confidence, on what sticking point, and in their own words — then
asked once more.

This is the part worth watching. The verdict panel reports who moved and which way, and the
split before and after (*"Three jurors moved — 8–4 became 11–1"*). A juror who moved carries a
mark in the strip of pips, and their dossier keeps both findings side by side with the
rationale they gave the first time.

The prompt works hard against mere agreement, because the naive version of this produces
nothing else — told only that eleven jurors disagree, models fold. So the charge says in
terms that **a count is not evidence**: change your finding only if a juror named a fact you
overlooked, a reading you had not considered, or an error in your own reasoning; otherwise
hold, and name the thing you are holding against. A juror may also keep their finding and
move their confidence, which is why the panel reports a room that held but grew more or less
sure of itself.

A few things follow from how it is wired:

- **The room hears arguments, not models.** Only the finding, confidence, sticking point and
  rationale travel between jurors. Which model held a view — and what it cost — never does.
- **Each juror's own first answer is replayed as their previous turn**, so a model that
  changes its mind is revising a position it actually held rather than scoring a fresh case
  that arrives with opinions attached.
- **Nobody argues with themselves.** A juror's own seat is excluded from the room put to them.
- **A second round can never lose a vote.** A juror whose model fails on the second asking
  keeps their first finding and stays in the count, flagged in their dossier.
- **One extra call per juror**, at roughly what the first round cost — a little more, since
  the room travels in the prompt. The button says so before you press it, and the panel then
  reports the total for both rounds.
- Cases heard twice are **one record in the archive**, not two: the second round supersedes
  the first under the same id, keeping the first-round findings alongside the final ones.

Jurors who never returned a finding do not go back out, and a bench of one is never offered
the button — there is no room to reconsider in front of.

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
| `src/lib/estimate.ts` | Token counts, who can read a case, what a round will cost |
| `src/lib/rateLimit.ts` | The brake on how fast the app can be made to spend |
| `src/lib/openrouter.ts` | **The juror call** — prompt, JSON schema, lenient parsing; and `requestReconsideration`, the second round |
| `src/lib/deliberate.ts` | The offline stub engine (`stubVerdict`, `stubReconsideration`) and the aggregation (`tally`) |
| `src/app/api/verdict/route.ts` | One juror, one request — the client fans out twelve in parallel |
| `src/app/api/reconsider/route.ts` | The same, for the second round — one juror, having heard the room |
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

After a second round the same function is run twice — once over the first-round findings and
once over the final ones — and everything the panel says about movement is the difference
between them. Nothing about who moved is stored, so it cannot drift from the findings on
screen.
