module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  extends: ['eslint:recommended'],
  ignorePatterns: ['client/dist/', 'node_modules/'],
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [{
    files: ['**/*.ts', '**/*.tsx'],
    parser: require.resolve('@typescript-eslint/parser', { paths: [__dirname + '/client'] }),
    plugins: ['@typescript-eslint', 'react-hooks'],
    rules: {
      // TypeScript checks these with type-aware scope; core ESLint misreads type declarations.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
    },
  }],
};
