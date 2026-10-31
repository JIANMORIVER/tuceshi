import {readdir,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
async function visit(dir){for(const file of await readdir(dir,{withFileTypes:true})){const path=join(dir,file.name);if(file.isDirectory())await visit(path);else if(file.name.endsWith('.ts')){const output=path.replace(/^src[\\/]/,'dist/domain/').replace(/\.ts$/,'.js');await mkdir(dirname(output),{recursive:true});await writeFile(output,stripTypeScriptTypes(await readFile(path,'utf8'),{mode:'transform'})+'\n');}}}
await visit('src');console.log('Built extracted domain modules.');
