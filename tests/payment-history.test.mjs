import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { calculateBookingPaymentDetails as calculate } from '../src/lib/bookingPaymentHistory.ts';
const at = n => new Date(Date.UTC(2026, 9, 20, 0, 0, n)).toISOString();
const now = Date.parse(at(100));
const booking = (id, extra = {}) => ({id, customerId:'c', creditsSpent:1, pool:'regular', bookedAt:at(1), startsAt:at(200), status:'booked', ...extra});
const row = (id, delta, reason, extra = {}) => ({id, customer_id:'c', delta, reason, expires_at:null, created_at:at(Number(id)), booking_id:null, pool:'regular', package_id:null, ...extra});
const spend = (n, id, extra={}) => row(String(n), -1, 'booking', {booking_id:id, ...extra});
const run = (bookings, ledger, checkouts=new Set(), overrides=new Map()) => calculate(bookings, ledger, checkouts, overrides, now);
const two = () => [booking('a',{startsAt:at(200)}), booking('b',{startsAt:at(300)})];

test('two credits / two bookings: both paid, only last scheduled class has renewal reminder',()=>{
 const r=run(two(),[row('1',2,'purchase'),spend(2,'a'),spend(3,'b')]);
 assert.deepEqual([...r], [['a',{status:'package',renewalDue:false}],['b',{status:'package',renewalDue:true}]]);
});
test('class chronology wins over reverse booking order',()=>{
 const r=run(two(),[row('1',2,'purchase'),spend(2,'b'),spend(3,'a')]);
 assert.equal(r.get('a').renewalDue,false); assert.equal(r.get('b').renewalDue,true);
});
test('spare purchased credit suppresses renewal reminder',()=>{
 const r=run(two(),[row('1',3,'purchase'),spend(2,'a'),spend(3,'b')]);
 assert.equal([...r.values()].some(d=>d.renewalDue),false);
});
test('later package renewal clears reminder without changing earlier coverage',()=>{
 const r=run(two(),[row('1',2,'purchase'),spend(2,'a'),spend(3,'b'),row('4',10,'purchase')]);
 assert.equal(r.get('b').renewalDue,false); assert.equal(r.get('a').status,'package');
});
test('starter/manual credits reserve classes but are not payment evidence',()=>{
 for(const reason of ['adjustment','starter']) assert.equal(run([booking('a')],[row('1',1,reason),spend(2,'a')]).get('a').status,'payment_due');
});
test('ambiguous legacy records require review instead of silently creating historical debt',()=>{
 const bs=two().map(b=>({...b,bookedAt:'2026-09-01T00:00:00Z'}));
 const result=[...run(bs,[row('1',1,'purchase')]).values()];
 assert.ok(result.every(d=>d.paymentReview===true&&!d.renewalDue));
});
test('purchase after an unpaid class does not retrospectively settle it',()=>{
 const r=run([booking('a')],[row('1',1,'adjustment'),spend(2,'a'),row('3',10,'purchase')]);
 assert.equal(r.get('a').status,'payment_due');
});
test('explicit receipt settles class, even after original credits are spent',()=>{
 assert.equal(run([booking('a')],[],new Set(['a'])).get('a').status,'package');
});
test('staff corrections take precedence in both directions without mutating evidence',()=>{
 const ledger=[row('1',1,'purchase'),spend(2,'a')]; const before=JSON.stringify(ledger);
 assert.equal(run([booking('a')],ledger,new Set(['a']),new Map([['a','payment_due']])).get('a').status,'payment_due');
 assert.equal(run([booking('b')],[],new Set(),new Map([['b','package']])).get('b').status,'package');
 assert.equal(JSON.stringify(ledger),before);
});
test('two spots need two paid credits',()=>{
 assert.equal(run([booking('a',{creditsSpent:2})],[row('1',1,'purchase'),spend(2,'a',{delta:-2})]).get('a').status,'payment_due');
 assert.equal(run([booking('a',{creditsSpent:2})],[row('1',2,'purchase'),spend(2,'a',{delta:-2})]).get('a').status,'package');
});
test('split spends for same booking must all be paid',()=>{
 const r=run([booking('a',{creditsSpent:2})],[row('1',1,'purchase'),row('2',1,'adjustment'),spend(3,'a'),spend(4,'a')]);
 assert.equal(r.get('a').status,'payment_due');
});
test('zero stored credits still need one credit of payment evidence',()=>{
 assert.equal(run([booking('a',{creditsSpent:0})],[]).get('a').status,'payment_due');
});
test('private and regular credits and reminders stay isolated',()=>{
 const bs=[...two(),booking('p',{pool:'private'})];
 const r=run(bs,[row('1',2,'purchase'),spend(2,'a'),spend(3,'b'),row('4',2,'purchase',{pool:'private'}),spend(5,'p',{pool:'private'})]);
 assert.equal(r.get('b').renewalDue,true); assert.equal(r.get('p').renewalDue,false);
 assert.equal(run([booking('a')],[row('1',10,'purchase',{pool:'private'}),spend(2,'a')]).get('a').status,'payment_due');
});
test('customers never share payment evidence or remaining credits',()=>{
 const bs=[booking('a'),booking('b',{customerId:'other'})];
 const r=run(bs,[row('1',1,'purchase'),spend(2,'a'),spend(3,'b',{customer_id:'other'})]);
 assert.equal(r.get('a').status,'package');assert.equal(r.get('b').status,'payment_due');
});
test('expired credit cannot fund a booking at or after expiry',()=>{
 const expiry=at(2);
 assert.equal(run([booking('a')],[row('1',1,'purchase',{expires_at:expiry}),spend(2,'a')]).get('a').status,'payment_due');
});
test('expiry after consumption does not invalidate already paid class',()=>{
 assert.equal(run([booking('a')],[row('1',1,'purchase',{expires_at:at(3)}),spend(2,'a')]).get('a').status,'package');
});
test('expired spare credit does not suppress renewal',()=>{
 const r=run([booking('a')],[row('1',2,'purchase',{expires_at:at(3)}),spend(2,'a')]);
 assert.equal(r.get('a').renewalDue,true);
});
test('cancel/refund restores purchased provenance and clears remaining reminder',()=>{
 const bs=[booking('a'),booking('b',{status:'cancelled',startsAt:at(300)})];
 const ledger=[row('1',2,'purchase'),spend(2,'a'),spend(3,'b'),row('4',1,'refund',{booking_id:'b'})];
 assert.equal(run(bs,ledger).get('a').renewalDue,false);
 assert.equal(run(bs,ledger).get('b').renewalDue,false);
});
test('mixed paid/manual cancellation refunds each source with correct provenance',()=>{
 const ledger=[row('1',1,'purchase',{package_id:'pkg',expires_at:at(500)}),row('2',1,'adjustment'),
 spend(3,'cancelled',{delta:-2}),row('4',1,'refund',{booking_id:'cancelled',package_id:'pkg',expires_at:at(500)}),
 row('5',1,'refund',{booking_id:'cancelled'}),spend(6,'paid'),spend(7,'unpaid')];
 const r=run([booking('paid'),booking('unpaid')],ledger);
 assert.equal(r.get('paid').status,'package'); assert.equal(r.get('unpaid').status,'payment_due');
});
test('repeated refunds cannot mint extra paid credits',()=>{
 const ledger=[row('1',1,'purchase'),spend(2,'cancelled'),row('3',1,'refund',{booking_id:'cancelled'}),
 row('4',1,'refund',{booking_id:'cancelled'}),spend(5,'a'),spend(6,'b')];
 const r=run(two(),ledger); assert.equal(r.get('a').status,'package'); assert.equal(r.get('b').status,'payment_due');
});
test('refunds retain expiry instead of creating unexpiring purchased credits',()=>{
 const ledger=[row('1',1,'purchase',{expires_at:at(4)}),spend(2,'cancelled'),row('3',1,'refund',{booking_id:'cancelled',expires_at:at(4)}),spend(5,'a')];
 assert.equal(run([booking('a')],ledger).get('a').status,'payment_due');
});
test('no-show, waitlist, cancelled class and cancelled booking do not receive renewal reminder',()=>{
 for(const extra of [{status:'no_show'},{status:'waitlisted'},{status:'cancelled'},{sessionStatus:'cancelled'}]) {
  assert.equal(run([booking('a',extra)],[row('1',1,'purchase'),spend(2,'a')]).get('a').renewalDue,false);
 }
});
test('single-class paid credit is payment evidence for the next class',()=>{
 assert.equal(run([booking('a')],[row('1',1,'single_class_credit'),spend(2,'a')]).get('a').status,'package');
});
test('timestamp ties use stable ledger id order; input order is irrelevant',()=>{
 const ledger=[row('1',1,'purchase'),spend(2,'a',{created_at:at(1)})];
 assert.deepEqual(run([booking('a')],ledger),run([booking('a')],ledger.toReversed()));
});
test('1000 generated histories: paid coverage is conserved and only final class renews',()=>{
 for(let n=1;n<=1000;n++) {
  const size=n%40+1; const credits=n%45; const bs=[]; const ledger=[row('1',credits,'purchase')];
  for(let i=0;i<size;i++){ const id='b'+i; bs.push(booking(id,{startsAt:at(200+i)})); ledger.push(spend(i+2,id)); }
  const r=run(bs,ledger);
  assert.equal([...r.values()].filter(d=>d.status==='package').length,Math.min(credits,size));
  assert.equal([...r.values()].filter(d=>d.renewalDue).length,credits>0&&credits<=size?1:0);
  assert.deepEqual(run(bs.toReversed(),ledger.toReversed()),new Map([...r].toReversed()));
 }
});
test('large history: 10,000 bookings, 100 customers, no cross-customer renewal leakage',()=>{
 const bs=[];const ledger=[];
 for(let c=0;c<100;c++) {
  ledger.push(row(String(c*200+1),100,'purchase',{customer_id:'c'+c}));
  for(let i=0;i<100;i++){const id=c+'-'+i;bs.push(booking(id,{customerId:'c'+c,startsAt:at(200+i)}));ledger.push(spend(c*200+i+2,id,{customer_id:'c'+c}));}
 }
 const start=performance.now();const r=run(bs,ledger);
 assert.equal([...r.values()].filter(d=>d.status==='package').length,10000);
 assert.equal([...r.values()].filter(d=>d.renewalDue).length,100);
 console.log(`10,000 booking replay: ${Math.round(performance.now()-start)}ms`);
});
test('cancel/rebook reusing booking id cannot retain old paid classification',()=>{
 const ledger=[row('1',1,'purchase'),spend(2,'a'),row('3',1,'refund',{booking_id:'a'}),
 spend(4,'different'),row('5',1,'adjustment'),spend(6,'a')];
 assert.equal(run([booking('a'),booking('different')],ledger).get('a').status,'payment_due');
});
test('cancel/rebook reusing booking id can become fully paid after unpaid first reservation',()=>{
 const ledger=[row('1',1,'adjustment'),spend(2,'a'),row('3',1,'refund',{booking_id:'a'}),
 spend(4,'different'),row('5',1,'purchase'),spend(6,'a')];
 assert.equal(run([booking('a'),booking('different')],ledger).get('a').status,'package');
});
