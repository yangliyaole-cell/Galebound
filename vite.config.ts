import { defineConfig } from 'vite';

// Served from the root of a domain or subdomain. Change `base` for a subpath.
export default defineConfig({
  base: '/',
  build: { target: 'es2022' },
});
