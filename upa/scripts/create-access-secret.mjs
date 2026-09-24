// Run locally; only the verifier and signing key go to Fly secrets via stdin.
import {randomBytes, scryptSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const result=spawnSync('python3',['-c',`import getpass,json,sys
if not sys.stdin.isatty():
 raise SystemExit('Run this command in an interactive terminal.')
first=getpass.getpass('Telugu passphrase: ')
second=getpass.getpass('Repeat passphrase: ')
print(json.dumps([first,second]))`],{stdio:['inherit','pipe','inherit'],encoding:'utf8'});
if(result.status!==0)process.exit(1);
const [first,second]=JSON.parse(result.stdout).map(value=>value.normalize('NFC').trim());
if(first!==second || first.split(/\s+/u).length<4 || Buffer.byteLength(first)>1024){console.error('Use at least four words, matching both times (maximum 1024 UTF-8 bytes).');process.exit(1);}
const salt=randomBytes(16);
const hash=scryptSync(first,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});
process.stdout.write(`ACCESS_PASSPHRASE_HASH=scrypt-v1$${salt.toString('hex')}$${hash.toString('hex')}\nACCESS_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`);
