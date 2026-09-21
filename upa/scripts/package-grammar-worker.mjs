import { cpSync, mkdirSync } from 'node:fs';
const destination='dist/server/grammar-worker';
mkdirSync(destination,{recursive:true});
cpSync('../local-machine/data-transform/scripts/build-grammar',destination,{recursive:true,filter:p=>!p.includes('__pycache__')});
