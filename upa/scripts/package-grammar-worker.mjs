import { cpSync, mkdirSync } from 'node:fs';
const destination='dist/server/grammar-worker';
mkdirSync(destination,{recursive:true});
cpSync('../data-transform/scripts/build-grammar',destination,{recursive:true,filter:p=>!p.includes('__pycache__')});

const parsingDestination='dist/server/parse-core';
mkdirSync(parsingDestination,{recursive:true});
cpSync('../data-transform/scripts/parse-core',parsingDestination,{recursive:true,filter:p=>!p.includes('__pycache__')});
