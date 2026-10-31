import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',port:5191,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5192',changeOrigin:false}}},build:{outDir:'dist',emptyOutDir:true}});
