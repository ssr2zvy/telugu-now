import { cpSync, mkdirSync } from 'node:fs';
const destination='dist/server/grammar-worker';
mkdirSync(destination,{recursive:true});
cpSync('../data-transform/scripts/build-grammar',destination,{recursive:true,filter:p=>!p.includes('__pycache__')});
