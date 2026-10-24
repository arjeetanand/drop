import assert from 'node:assert/strict';
import test from 'node:test';
import { getClaimJourneySteps } from '../lib/claimJourney.ts';

const statuses = (accountState) => getClaimJourneySteps(accountState)?.map(({ status }) => status);

test('hides progress while account state is being checked', () => {
  assert.equal(getClaimJourneySteps('checking'), null);
});

test('shows sign in as the current step after a signed-out account is confirmed', () => {
  const expected = ['current', 'up-next', 'up-next'];
  assert.deepEqual(statuses('signed-out'), expected);
});

test('marks sign in complete and handle setup current for an account without a profile', () => {
  assert.deepEqual(statuses('needs-profile'), ['completed', 'current', 'up-next']);
});

test('marks sign in and handle setup complete before explicit claim', () => {
  assert.deepEqual(statuses('ready'), ['completed', 'completed', 'current']);
});

test('hides claim progress when account state cannot be established', () => {
  assert.equal(getClaimJourneySteps('unavailable'), null);
  assert.equal(getClaimJourneySteps('error'), null);
});

test('returns the expected ordered, user-facing claim steps', () => {
  assert.deepEqual(getClaimJourneySteps('ready'), [
    { id: 'sign-in', label: 'Sign in', status: 'completed' },
    { id: 'choose-handle', label: 'Choose handle', status: 'completed' },
    { id: 'claim', label: 'Claim', status: 'current' },
  ]);
});
