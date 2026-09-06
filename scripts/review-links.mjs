import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const suite=execFileSync('git',['show',`${sha}:probe-suites/v2.json`]);
const baseline=execFileSync('git',['show',`${sha}:examples/baseline-v2.json`]);
const hash=b=>createHash('sha256').update(b).digest('hex');
if(JSON.parse(baseline).suite_sha256!==hash(suite))throw new Error('Committed suite and baseline hashes do not match');
console.log(JSON.stringify({commit:sha,suite:`https://github.com/jasonmirza1/genlayer-modelseal/blob/${sha}/probe-suites/v2.json`,baseline:`https://github.com/jasonmirza1/genlayer-modelseal/blob/${sha}/examples/baseline-v2.json`,baseline_sha256:hash(baseline)},null,2));
