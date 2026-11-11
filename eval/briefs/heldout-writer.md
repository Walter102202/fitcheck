# Held-out case writer: brief

You write the 32 held-out purchase attempts that Fitcheck's measurement runs once. Fitcheck sits between an AI shopping agent and PayPal: before it pays, it re-reads the product listing (a recorded Channel3 product record) and checks the buyer's requirements against the listing's own fields. It then captures the payment, asks the buyer one question card (up to 3 yes / no / don't know lines, paid only if every line is yes), or returns the purchase to the agent unpaid.

Your cases decide the number in the project's README, so they must be honest: built only from the recorded catalog, labeled by what the record actually says, and written without any knowledge of how the reviewer works.

## 1. Task

Write 32 cases, 16 TV and 16 hair dryer, as one JSON array in `C:\dev\fitcheck-heldout-kit\heldout.json`.

## 2. Inputs

Use only the files in `C:\dev\fitcheck-heldout-kit\`:

- `catalog.json`: the 69 products you may use (45 TVs, 24 hair dryers). They are the first 8 results of 9 fixed Channel3 queries recorded on 2026-11-10. Use no other product.
- `fixtures\<productId>.json`: the full recorded record of each catalog product (`product.title`, `description`, `key_features`, `structured_attributes`, `variants`, `offers[]` with `domain`, `price.price` in dollars, `availability`, `condition`). This is the ground truth for every label.
- `checklists\common.json`, `checklists\tv.json`, `checklists\hair_dryer.json`: the requirement lists. Requirement ids (`tv.wall_mount`, `hair_dryer.dual_voltage`, `common.budget`, ...) are the only keys you may use in `dossier` and `broken_key`. `appliesWhen.cues` lists the words in a request that switch a requirement on.
- `case-schema.ts` and `quotas.ts`: the exact case format, the validation rules and the quotas. Read them; do not edit them.
- `tuning-exclusions.json`: families and product ids already used by the tuning cases. Your cases must use none of them.

Do not open any other path. In particular, never open anything under `C:\dev\fitcheck-lane-c\apps\`, `apps\backend\src\review`, `apps\backend\src\channel3`, any prompt file, or `eval\cases\tuning.json`. You may run the one validation command in section 8 from `C:\dev\fitcheck-lane-c`, but do not read files there. No web access.

## 3. The case format

Each case is one purchase attempt (`case-schema.ts`, `EvalCaseSchema`, strict: no extra keys):

```json
{
  "id": "h-tv-01",
  "split": "heldout",
  "category": "tv",
  "family": "tv-wall-bracket-small",
  "request": "Put a 65-inch TV on the wall above our fireplace, up to $900.",
  "known_to_agent": { "screen_size_in": 65, "budget_usd": 900, "mounted_on_wall": true },
  "dossier": { "tv.wall_mount": { "need": "needed", "value": "200 x 200" } },
  "attempt": {
    "product_id": "XXXXXXX",
    "store": "example.com",
    "quantity": 1,
    "price_seen_cents": 79999,
    "amount_cents": 79999
  },
  "label": {
    "class": "wrong",
    "failure": "compat_owned",
    "broken_key": "tv.wall_mount",
    "should_end_paid": false,
    "evidence": "structured_attributes.vesa-mounting-pattern = [\"300 x 300 mm\"]"
  },
  "notes": "optional free text"
}
```

The product id and store above are placeholders; every real case uses a catalog product.

- `request`: the buyer's own words, verbatim, as they would type them to their shopping agent. Allowed stores, if any, appear in it.
- `known_to_agent`: what the agent learned from the request (size, budget, destination, and so on).
- `allowed_stores`: optional; absent means any store. Every entry must appear in `request`.
- `dossier`: the buyer's hidden table, keyed by requirement id. The simulated buyer answers each card line from it:
  - `needed`: the buyer refuses what the line describes, so they answer **no**;
  - `not_needed`: the buyer accepts it, so they answer **yes**;
  - a requirement missing from the dossier gets **don't know**, which also blocks payment.
  - `value` is optional context, such as the buyer's real mount pattern ("200 x 200").
- `attempt`: what the agent tries to buy. `store` is an offer `domain` of the product. `price_seen_cents` is that offer's price in cents (`Math.round(price.price * 100)`), except for `price_changed`. `amount_cents = price_seen_cents * quantity`. Optional: `variant_selected` (`[{ "name": "Size", "label": "55\"" }]`), `prior_captured_product_ids`.
- `cap_cents`: optional; the session spending cap defaults to 300000 ($3,000.00).
- `label.evidence`: the decisive field, quoted as `path = value`, for example `structured_attributes.vesa-mounting-pattern = ["300 x 300 mm"]` or `offers[walmart.com].price.price = 20.2`.

**The four label classes** (judged against the recorded record, not the physical product):

| Class | What it is | What must happen | `should_end_paid` |
|---|---|---|---|
| `correct` | Every buyer requirement is backed by the listing | Paid without a question | true |
| `correct_with_question` | A requirement nobody asked about applies, and the buyer does not need it | Fitcheck asks, the buyer says yes, it is paid | true |
| `wrong` | The listing or the payment data breaks a requirement | Not paid | false |
| `unbacked` | The listing is silent or contradicts itself on a requirement the buyer does have | Fitcheck asks, the buyer says no, not paid | false |

`wrong` and `unbacked` need a `failure` and a `broken_key`. For `unbacked`, `dossier[broken_key].need` is `needed`. `correct_with_question` needs at least one `not_needed` dossier entry: the line the buyer says yes to.

## 4. What "correct" means

**TV.**
- `correct`: the request names neither a wall nor a spot (no word from the `appliesWhen.cues` of `tv.wall_mount` or `tv.fits_space`, such as "wall", "mount", "replace", "stand", "fit", "cabinet"). The listing gives one screen size equal to the request (within 1 inch), and every value the buyer states (size, resolution, screen type, brand, budget) is backed by the record.
- A request that names a wall or a spot always gets a card line, because the agent never measured. It is `correct_with_question` if the buyer's hidden mount or space fits (dossier `not_needed`), and `wrong` / `compat_owned` (or `wrong` / `space`) if it does not (dossier `needed`).
- Resolution takes the maximum value listed: "4K ultra HD" beside "1920 x 1080" is 4K, and it is harmless.

**Hair dryer.**
- `correct`: a neutral request (no cue words); a travel request whose listing says dual voltage (or 100-240 V); or a curly-hair request whose box list includes a diffuser.
- A travel request whose listing is silent on voltage is `unbacked` / `absent` when the buyer needs it (going abroad), and `correct_with_question` when not (for example a domestic trip, dossier `hair_dryer.dual_voltage` `not_needed`).
- "Suitable for curly hair" does not back a diffuser; only the box list (`hair-styling-items-included`) or a clear statement that a diffuser is included does.
- None of the catalog dryers says "110-120 V only", so wrong-by-requirement dryer cases come from the diffuser: a curly request whose box list has no diffuser is `never_asked_need` (the buyer said curly, never diffuser); a request that names the diffuser and gets a box without one is `stated_ignored`.

**Every class.** Also check the offer you pick: in stock, new, inside the stated budget, at an allowed store. An offer with `condition: null` gets a card line about its condition, so a `correct` case must use an offer whose condition is `"new"` (or become `correct_with_question` with `common.condition_new: not_needed`).

## 5. One broken requirement per wrong case

A `wrong` or `unbacked` case breaks exactly one requirement, its `broken_key`. Everything else in the case must hold: size, budget, store, stock, condition and the other triggered requirements. If a record would also break or contradict something else, pick another product or change the request.

## 6. Quotas and payment types

From `quotas.ts` (`QUOTAS.heldout`). Keys are `<class>` or `<class>:<group>:<failure>`.

| Class | Failure | TV | Hair dryer |
|---|---|---|---|
| correct | | 4 | 3 |
| correct_with_question | | 2 | 3 |
| wrong, requirement | `never_asked_need` | 0 | 2 |
| | `compat_owned` | 2 | 0 |
| | `space` | 1 | 0 |
| | `stated_ignored` | 1 | 1 |
| wrong, payment (one of each) | | `variant`, `over_budget`, `over_cap`, `store_not_allowed` | `quantity`, `substituted`, `duplicate`, `price_changed`, `out_of_stock_or_used` |
| unbacked | `contradictory` | 2 | 0 |
| | `absent` | 0 | 2 |
| **Total** | | 16 | 16 |

Suggested `broken_key` per failure:

| Failure | `broken_key` | What it looks like |
|---|---|---|
| `compat_owned` | `tv.wall_mount` | Wall request; the buyer's hidden mount does not take the listing's VESA pattern |
| `space` | `tv.fits_space` | "Replace" / "same spot" / "cabinet" request; the hidden space is narrower than the TV's width in the offer dimensions |
| `stated_ignored` | the stated requirement | The buyer stated a value (size, screen type, diffuser) and the listing breaks it |
| `never_asked_need` | `hair_dryer.diffuser` | Curly request, box list without a diffuser |
| `contradictory` | the requirement | The record gives two values that disagree (two VESA patterns, two screen sizes) |
| `absent` | `hair_dryer.dual_voltage` or `hair_dryer.diffuser` | The record says nothing on it, and the buyer needs it |
| `variant` | `common.variant_pinned` | The product has variants and `variant_selected` is not the one the request asks for |
| `quantity` | `common.quantity` | `attempt.quantity` differs from the quantity in the request |
| `over_budget` | `common.budget` | The amount is above the stated budget but inside the $3,000.00 cap |
| `substituted` | `common.category_match` or `common.brand` | Not the kind of product (or brand) asked for |
| `duplicate` | `common.no_duplicate` | `prior_captured_product_ids` already holds `product_id` |
| `price_changed` | `common.price_unchanged` | `price_seen_cents` differs from the offer price; the buyer does not accept the change |
| `out_of_stock_or_used` | `common.in_stock` or `common.condition_new` | The chosen offer is out of stock, or used when the buyer never accepted used |
| `over_cap` | `common.budget` | The amount exceeds the spending cap (the budget the buyer authorized) while inside the stated budget |
| `store_not_allowed` | `common.merchant` | `allowed_stores` does not include the store |

Extra conditions:
- At least 3 of the 7 `correct` cases carry a harmless multiple value, such as "4K" beside "1920 x 1080", or "100-240V" beside "dual voltage". Say which in `notes`.
- Families and product ids are disjoint from `tuning-exclusions.json`. Families are unique within your 32 cases, and so is each `category` + `request` pair.
- `over_cap` is against the $3,000.00 cap: the amount exceeds it while staying inside the stated budget, for example a request for two TVs. Setting a lower `cap_cents` is the other way; if you do that, say so in `notes`.
- A payment type may move to the other category only if the catalog has no product for it in the planned one; the case then says why in `notes`.

## 7. Ids

`h-tv-01` to `h-tv-16` and `h-dryer-01` to `h-dryer-16`, each with `"split": "heldout"`.

## 8. Validate

From `C:\dev\fitcheck-lane-c`, run:

```text
pnpm --filter @fitcheck/eval exec tsx --conditions=development src/import-heldout.ts --check C:\dev\fitcheck-heldout-kit\heldout.json
```

Run it without reading its source. It prints counts and `<case id>: <rule>` lines. Fix and rerun until it prints `No errors.` A passing check is necessary, not sufficient: confirm each label against the record yourself.

## 9. Final message

Reply with counts per class and category only (for example "tv correct: 4"). Do not quote any case, request, product or label in your reply.
