## Ticket
<!-- e.g. P2-08 Builder agent. Link the row in docs/BACKLOG.md -->

## What changed

## Acceptance tests moved
<!-- AT-n from docs/ACCEPTANCE.md, and whether each now passes on mock / real engine -->

## Rules check (AGENTS.md)
- [ ] No composition data stored outside the `.ecproj`
- [ ] All engine calls go through the adapter; lock check covers any new layer-targeting command
- [ ] No paid call or final render without a spend token; new paid paths added to the spend-gate test
- [ ] Official APIs or file import only
- [ ] Works in Manual mode with no provider
- [ ] Copied files logged in docs/PORT_LEDGER.md

## Tests
<!-- Exact counts per suite. -->

## Not checked
