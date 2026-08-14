import { defineConfig } from 'oxfmt'

export default defineConfig({
  printWidth: 100,
  overrides: [
    {
      files: ['*.ts'],
      options: {
        semi: false,
        tabWidth: 2,
        endOfLine: 'lf',
        singleQuote: true,
        trailingComma: 'es5'
      },
    },
  ],
});