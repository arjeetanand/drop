import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceRelayDemo, isRelayDemoContentVisible, relayDemoStages } from '../lib/relayDemo.ts';

test('Relay preview follows each fictional handoff and requires collection before reveal', () => {
  let stage = relayDemoStages[0];

  for (const expectedStage of relayDemoStages.slice(1, -1)) {
    assert.equal(isRelayDemoContentVisible(stage), false);
    stage = advanceRelayDemo(stage);
    assert.equal(stage, expectedStage);
  }

  assert.equal(stage, 'pickup');
  assert.equal(isRelayDemoContentVisible(stage), false);
  stage = advanceRelayDemo(stage);
  assert.equal(stage, 'collected');
  assert.equal(isRelayDemoContentVisible(stage), true);
});

test('replaying the collected Relay preview starts from the sealed intro again', () => {
  assert.equal(advanceRelayDemo('collected'), 'ready');
  assert.equal(isRelayDemoContentVisible('ready'), false);
});
