import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf, describeOutcome } from '../lib/chain.ts';

// outcomeOf is the single point that decides whether a write landed, so the
// mapping from a raw transaction to "applied" is asserted directly rather than
// only through the UI. The numeric cases exercise the lifecycle fallback used
// when a transaction arrives without a decoded `lifecycle` field.
const RETURN = 'FINISHED_WITH_RETURN';
const ERROR = 'FINISHED_WITH_ERROR';

test('an accepted round with a returning leader is the only applied case', () => {
  assert.equal(
    outcomeOf({
      statusName: 'FINALIZED',
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      txExecutionResultName: RETURN,
    }).applied,
    true,
  );
  for (const tx of [
    {
      statusName: 'FINALIZED',
      lifecycle: { state: 'finalized', outcome: 'undetermined' },
      txExecutionResultName: RETURN,
    },
    {
      statusName: 'FINALIZED',
      lifecycle: { state: 'finalized', outcome: 'accepted' },
      txExecutionResultName: ERROR,
    },
    {
      statusName: 'FINALIZED',
      lifecycle: { state: 'finalized', outcome: 'validators-timeout' },
      txExecutionResultName: RETURN,
    },
    {
      statusName: 'CANCELED',
      lifecycle: { state: 'canceled' },
      txExecutionResultName: '',
    },
  ])
    assert.equal(outcomeOf(tx).applied, false, JSON.stringify(tx.lifecycle));
});

test('an accepted but not yet finalized round is applied and not settled', () => {
  // status 5 ACCEPTED, result 1 MAJORITY_AGREE: readable now, still appealable.
  const outcome = outcomeOf({
    status: 5,
    result: 1,
    txExecutionResultName: RETURN,
  });
  assert.equal(outcome.applied, true);
  assert.equal(outcome.settled, false);
});

test('the numeric fallback distinguishes agree from disagree', () => {
  // status 7 FINALIZED with result 1 MAJORITY_AGREE vs 2 MAJORITY_DISAGREE.
  assert.equal(
    outcomeOf({ status: 7, result: 1, txExecutionResultName: RETURN }).applied,
    true,
  );
  const rejected = outcomeOf({
    status: 7,
    result: 2,
    txExecutionResultName: RETURN,
  });
  assert.equal(rejected.applied, false);
  assert.equal(rejected.outcome, 'undetermined');
  assert.equal(rejected.settled, true);
});

test('a rejected round is never described as accepted', () => {
  // A leader can revert inside a round validators then reject, so the reverted
  // wording must not be reached before the rejected wording.
  const both = describeOutcome({
    statusName: 'FINALIZED',
    outcome: 'undetermined',
    executionResultName: ERROR,
    applied: false,
    settled: true,
  });
  assert.match(both, /did not reach a majority/);
  assert.doesNotMatch(both, /accepted the round/);
  assert.match(
    describeOutcome({
      statusName: 'FINALIZED',
      outcome: 'accepted',
      executionResultName: ERROR,
      applied: false,
      settled: true,
    }),
    /accepted the round but the contract reverted/,
  );
});

test('every unapplied description states that nothing was written', () => {
  for (const outcome of ['undetermined', 'leader-timeout', 'validators-timeout', ''])
    assert.match(
      describeOutcome({
        statusName: 'FINALIZED',
        outcome,
        executionResultName: RETURN,
        applied: false,
        settled: true,
      }),
      /Nothing was written\./,
      outcome || '(empty)',
    );
  assert.match(
    describeOutcome({
      statusName: 'FINALIZED',
      outcome: 'accepted',
      executionResultName: RETURN,
      applied: true,
      settled: true,
    }),
    /applied the write/,
  );
});
