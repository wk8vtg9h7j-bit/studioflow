import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeskDay} from '../src/lib/deskDate.ts';
test('desk accepts requested calendar date, including leap day',()=>{
 for(const day of ['2026-10-29','2026-01-01','2026-12-31','2028-02-29'])assert.equal(isDeskDay(day),true);
});
test('desk rejects impossible dates and invalid input',()=>{
 for(const day of [undefined,'','2026-02-29','2026-02-31','2026-13-01','2026-00-01','2026-10-00','2026-10-32','2026-1-01','2026-10-29T00:00:00Z','\\d{4}-\\d{2}-\\d{2}'])assert.equal(isDeskDay(day),false);
});
