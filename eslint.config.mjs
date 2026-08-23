import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextVitals,
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**'],
    rules: {
      // Existing client-side hydration patterns intentionally load localStorage data in effects.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
];
