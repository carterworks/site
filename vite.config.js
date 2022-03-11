import WindiCSS from 'vite-plugin-windicss';

export default {
  plugins: [
    WindiCSS({
      config: {
        extract: {
          include: ['./index.html']
        }
      }
    }),
  ]
}
