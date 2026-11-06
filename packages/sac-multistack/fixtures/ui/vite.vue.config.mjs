import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./vue/',import.meta.url)),plugins:[vue()],build:{outDir:'../dist/vue',emptyOutDir:true}});
