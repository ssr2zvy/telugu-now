import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const parsingSource = '../data-transform/scripts/parse-core';
const requiredJson = [
  'graph.json',
  'context_reviews.json',
  'parser/data/lexicon.json',
  'parser/data/modifier_definitions.json',
  'parser/data/contrast_families.json',
  'parser/core_parser/vendor/grammar.json',
];
function validateParsingAssets(root) {
  for (const relative of requiredJson) {
    const file = join(root, relative);
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(
        `Missing or invalid parser asset: ${file}. Check .dockerignore and rebuild the image.`,
        { cause: error },
      );
    }
  }
}

// Fail the build before deploying a worker with incomplete dictionaries.
validateParsingAssets(parsingSource);
const destination='dist/server/grammar-worker';
mkdirSync(destination,{recursive:true});
cpSync('../data-transform/scripts/build-grammar',destination,{recursive:true,filter:p=>!p.includes('__pycache__')});

const parsingDestination='dist/server/parse-core';
rmSync(parsingDestination,{recursive:true,force:true});
mkdirSync(parsingDestination,{recursive:true});
cpSync(parsingSource,parsingDestination,{recursive:true,filter:p=>!p.includes('__pycache__')});
validateParsingAssets(parsingDestination);
