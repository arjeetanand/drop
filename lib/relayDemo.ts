export const relayDemoStages = [
  'ready',
  'first-handoff',
  'second-handoff',
  'pickup',
  'collected',
] as const;

export type RelayDemoStage = (typeof relayDemoStages)[number];

export function advanceRelayDemo(stage: RelayDemoStage): RelayDemoStage {
  const currentIndex = relayDemoStages.indexOf(stage);
  return relayDemoStages[currentIndex === relayDemoStages.length - 1 ? 0 : currentIndex + 1];
}

export function isRelayDemoContentVisible(stage: RelayDemoStage): boolean {
  return stage === 'collected';
}
