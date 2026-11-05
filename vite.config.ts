import { defineConfig } from 'vite';

// GitHub Pages のサブパスでも動くよう相対パスで出力する。
// 教材（index.html）と先生用ページ（teacher.html）の 2 ページを作る。
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        teacher: 'teacher.html',
      },
    },
  },
});
