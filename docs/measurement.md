# Measuring Fitcheck

The question: of purchases a shopping agent should not have paid for, how many does Fitcheck stop,
and how many good purchases does it block by mistake? The answer is measured on cases the reviewer
never saw, against the same payment flow with the review switched off ("Spending cap only").

## The cases

- `eval/cases/tuning.json`: 16 cases used while building the reviewer.
- `eval/cases/heldout.json`: 32 cases written by a separate agent without access to the reviewer
  (brief: `eval/briefs/heldout-writer.md`), checked by a person, and committed with their SHA-256
  (`heldout.sha256`) before the reviewer first ran on them. Of the 32, 16 are wrong purchases,
  4 are purchases the product data cannot back, and 12 are correct.
- Each case has a request, a product and store picked from the recorded Channel3 catalog, the
  buyer's hidden answers, and whether it should end paid.

## The simulated buyer

The buyer is a table, not a model. It answers only the lines Fitcheck asks, from the case's
hidden answers, and says "don't know" to anything not in the table, so the purchase is not paid.
Every case runs 3 times; a wrong purchase counts as paid if it was paid in any of the 3 runs.
"Paid" means a capture exists in the payment ledger.

## Commands

```bash
pnpm measure --split tuning --runs 1      # the tuning set; mock model = recorded intents
pnpm --filter @fitcheck/eval freeze       # writes eval/cases/heldout.sha256 (once, before the run)
pnpm measure                              # the held-out run, live (LLM_PROVIDER=anthropic)
pnpm measure --replay                     # reproduces the published numbers with no key
pnpm --filter @fitcheck/eval readme-table # prints the README "Does it work?" block
pnpm --filter @fitcheck/eval sweep        # how often the data alone forces a question
```

- The live held-out run happens once. The harness refuses a second run, including after a crash
  that left recordings, unless `--rerun "<reason>"` is given. A rerun is published next to the
  first run in the notes.
- Every model answer, and every provider error, is recorded under `eval/recordings/`, so
  `--replay` reproduces the run exactly without a key.
- Results go to `eval/results/heldout.json` and `latest.json`, which the site's Results page
  reads. Misses, case by case, go to `eval/results/misses.md`. That file also lists the wrong
  purchases that were not paid but were stopped for a requirement other than the one that made
  them wrong.

## What it does not show

The buyer is simulated and always reads the question; real people often approve without reading.
The mix of right and wrong purchases was chosen by us, so the numbers are not rates you would see
in production. Labels are judged against the Channel3 record, not the physical product.
