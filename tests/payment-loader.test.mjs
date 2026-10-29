import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { calculateBookingPaymentDetails } from '../src/lib/bookingPaymentHistory.ts';

export function loadPaymentModule(source, tables, errors = {}) {
 const queries = [];
 const service = { from(table) {
  const filters=[];const orders=[];const inFilters=[];let range=null;let update=null;let lowerBound=null;
  const query = {
   select(){return query;},
   eq(field,value){filters.push(r=>r[field]===value);return query;},
   update(values){update=values;return query;},
   gte(field,value){lowerBound=[field,value];filters.push(r=>r[field]>=value);return query;},
   in(field,values){inFilters.push([field,values]);filters.push(r=>values.includes(r[field]));return query;},
   order(field,{ascending}){orders.push([field,ascending]);return query;},
   range(from,to){range=[from,to];return query;},
   then(resolve,reject){
    queries.push({table,range,update,lowerBound,inFilters});
    let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));
    rows=[...rows].sort((a,b)=>{for(const [field,asc] of orders){if(a[field]===b[field])continue;return (a[field]<b[field]?-1:1)*(asc?1:-1);}return 0;});
    const [from,to]=range??[0,999];
    return Promise.resolve({data:rows.slice(from,to+1),error:errors[table]??null}).then(resolve,reject);
   },
  }; return query;
 }};
 const module={exports:{}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){
  if(name==='server-only')return {};
  if(name==='@/lib/supabase/server')return {createServiceClient:()=>service};
  if(name==='./bookingPaymentHistory')return {calculateBookingPaymentDetails};
  throw new Error('Unexpected import '+name);
 },console,Date,Map,Set});
 return {api:module.exports,queries};
}
const source=fs.readFileSync(new URL('../src/lib/bookingPaymentStatus.server.ts',import.meta.url),'utf8');
const at=n=>new Date(Date.UTC(2026,9,1,0,0,n)).toISOString();
const input=id=>({id,customerId:'c',creditsSpent:1,pool:'regular',status:'booked'});
function fixture(count=2) {
 const bookings=[];const ledger=[{id:'00000',customer_id:'c',delta:count,reason:'purchase',pool:'regular',expires_at:null,created_at:at(0),booking_id:null}];
 for(let i=0;i<count;i++){
  const id=String(i).padStart(5,'0');
  bookings.push({id,session_id:'s'+id,customer_id:'c',credits_spent:1,spots_count:1,booked_at:at(i+1),status:'booked',session:{starts_at:at(2000+i),status:'scheduled',class_type:{pool:'regular'}}});
  ledger.push({id:String(i+1).padStart(5,'0'),customer_id:'c',delta:-1,reason:'booking',pool:'regular',expires_at:null,created_at:at(i+1),booking_id:id});
 }
 return {bookings,credit_ledger:ledger,class_checkouts:[],booking_payment_overrides:[]};
}
test('single-class requests still use full history: only the actual final class renews',async()=>{
 const {api}=loadPaymentModule(source,fixture());
 assert.equal((await api.getBookingPaymentDetails([input('00000')])).get('00000').renewalDue,false);
 const last=(await api.getBookingPaymentDetails([input('00001')])).get('00001');
 assert.equal(last.renewalDue,true);assert.equal(last.status,'package');
});
test('history and ledger pagination cross 1000 rows without losing payment evidence',async()=>{
 const {api,queries}=loadPaymentModule(source,fixture(1250));
 const result=await api.getBookingPaymentDetails([input('01249')]);
 assert.equal(result.get('01249').status,'package');assert.equal(result.get('01249').renewalDue,true);
 for(const table of ['bookings','credit_ledger']) assert.ok(queries.some(q=>q.table===table&&q.range?.[0]===1000));
});
test('legacy missing override table is tolerated while ledger errors fail closed',async()=>{
 const {api}=loadPaymentModule(source,fixture(),{booking_payment_overrides:{code:'42P01'}});
 assert.equal((await api.getBookingPaymentStatuses([input('00000')])).get('00000'),'package');
 const broken=loadPaymentModule(source,fixture(),{credit_ledger:{code:'connection_error'}});
 await assert.rejects(broken.api.getBookingPaymentDetails([input('00000')]));
});
test('financial API never interprets renewal as an unpaid class',async()=>{
 const {api}=loadPaymentModule(source,fixture());
 assert.equal((await api.getBookingPaymentStatuses([input('00001')])).get('00001'),'package');
});
test('customer queries are batched and all 201 histories are evaluated',async()=>{
 const tables={bookings:[],credit_ledger:[],class_checkouts:[],booking_payment_overrides:[]};const inputs=[];
 for(let i=0;i<201;i++){
  const f=fixture(1);f.bookings[0].id='b'+i;f.bookings[0].customer_id='c'+i;
  for(const l of f.credit_ledger){l.id=i+'-'+l.id;l.customer_id='c'+i;if(l.booking_id)l.booking_id='b'+i;}
  tables.bookings.push(...f.bookings);tables.credit_ledger.push(...f.credit_ledger);
  inputs.push({...input('b'+i),customerId:'c'+i});
 }
 const {api,queries}=loadPaymentModule(source,tables);const result=await api.getBookingPaymentDetails(inputs);
 assert.equal(result.size,201);assert.ok([...result.values()].every(d=>d.status==='package'&&d.renewalDue));
 assert.equal(queries.filter(q=>q.table==='credit_ledger').length,3);
});

test('calendar refresh paginates full history and batches future-session updates',async()=>{
 const {api,queries}=loadPaymentModule(source,fixture(1250));
 await api.queueCustomerBookingCalendarSync('c');
 assert.ok(queries.some(q=>q.table==='bookings'&&q.range?.[0]===1000));
 const updates=queries.filter(q=>q.table==='sessions');
 assert.equal(updates.length,13);
 assert.equal(updates.reduce((n,q)=>n+q.inFilters[0][1].length,0),1250);
 assert.ok(updates.every(q=>q.inFilters[0][1].length<=100&&q.lowerBound[0]==='starts_at'));
});
