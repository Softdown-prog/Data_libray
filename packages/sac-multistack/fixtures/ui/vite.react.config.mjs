import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./react/',import.meta.url)),plugins:[react()],build:{outDir:'../dist/react',emptyOutDir:true}});
