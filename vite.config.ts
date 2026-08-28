import { defineConfig } from 'vite';

// `base: './'` keeps every asset URL relative so `dist/` can be dropped into any subpath of the
// sermeatbal site (or opened from a file server) without rewriting the build.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
