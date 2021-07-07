module.exports = {
  purge: {
    content: [
      './src/**/*.html',
      './build/**/*.html',
    ],
    options: {
      keyframes: true,
    },
    preserveHtmlElements: false,
  },
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {},
  },
  variants: {
    extend: {},
  },
  plugins: [],
}
