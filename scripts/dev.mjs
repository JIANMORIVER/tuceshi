import {spawn} from 'node:child_process';
const build=spawn(process.execPath,['scripts/build-domain.mjs'],{stdio:'inherit'});await new Promise((resolve,reject)=>build.on('exit',code=>code===0?resolve():reject(Error('Domain build failed'))));
const processes=[spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:{...process.env,PORT:'5192'}}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let ending=false;function stop(code=0){if(ending)return;ending=true;for(const child of processes)child.kill();process.exitCode=code;}
for(const child of processes)child.on('exit',code=>stop(code||0));process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
