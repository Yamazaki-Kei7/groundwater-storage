import process from 'node:process';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';

const configuredBase = process.env.BASE_PATH ?? '';
if (configuredBase && (!configuredBase.startsWith('/') || configuredBase.endsWith('/'))) {
  throw new Error('BASE_PATH must start with / and must not end with /');
}
const basePath = configuredBase as '' | `/${string}`;

export default defineConfig({
  ssr: { noExternal: ['maplibre-gl'] },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html' }),
      paths: { base: basePath }
    })
  ]
});
