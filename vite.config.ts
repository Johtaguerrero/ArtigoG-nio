import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente locais (.env)
  const env = loadEnv(mode, (process as any).cwd(), '');

  // CRÍTICO PARA NETLIFY: 
  // Durante o build no servidor, a chave está em process.env.API_KEY, não necessariamente no objeto 'env' do loadEnv.
  // Priorizamos a variável do sistema (process.env) e usamos o .env local como fallback.
  const apiKey = process.env.API_KEY || env.API_KEY;

  return {
    plugins: [react()],
    // Define a substituição global da string 'process.env.API_KEY' pelo valor real da chave
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});