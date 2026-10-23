export type ClaimJourneyAccountState =
  | 'checking'
  | 'signed-out'
  | 'needs-profile'
  | 'ready'
  | 'unavailable'
  | 'error';

export type ClaimJourneyStepStatus = 'completed' | 'current' | 'up-next';

export interface ClaimJourneyStep {
  id: 'sign-in' | 'choose-handle' | 'claim';
  label: 'Sign in' | 'Choose handle' | 'Claim';
  status: ClaimJourneyStepStatus;
}

const steps: ReadonlyArray<Pick<ClaimJourneyStep, 'id' | 'label'>> = [
  { id: 'sign-in', label: 'Sign in' },
  { id: 'choose-handle', label: 'Choose handle' },
  { id: 'claim', label: 'Claim' },
];

const currentStepByAccountState: Record<Exclude<ClaimJourneyAccountState, 'unavailable' | 'error'>, number> = {
  checking: 0,
  'signed-out': 0,
  'needs-profile': 1,
  ready: 2,
};

export function getClaimJourneySteps(accountState: ClaimJourneyAccountState): ClaimJourneyStep[] | null {
  if (accountState === 'checking' || accountState === 'unavailable' || accountState === 'error') return null;

  const currentStep = currentStepByAccountState[accountState];
  return steps.map((step, index) => ({
    ...step,
    status: index < currentStep ? 'completed' : index === currentStep ? 'current' : 'up-next',
  }));
}
