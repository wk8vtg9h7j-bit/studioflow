import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);

test('staff desk distinguishes renewal, real debt and historical review; collects only actual unpaid visit',async()=>{
 const base={customerId:'test',status:'attended',spots:1,creditsSpent:1,eligibleStarter:false,firstVisit:false,pool:'regular'};
 const data={day:'2026-10-20',booked:4,attended:4,due:1,packages:[],sessions:[{
  id:'session',slug:'test',studio:'Test studio',name:'Test class',at:'2026-10-20T10:00:00Z',instructor:'Test teacher',capacity:4,filler:0,
  bookings:[
   {...base,id:'earlier',name:'Covered class',payment:'package',renewalDue:false,paymentReview:false},
   {...base,id:'final',name:'Final covered class',payment:'package',renewalDue:true,paymentReview:false},
   {...base,id:'unpaid',name:'Unpaid class',payment:'payment_due',renewalDue:false,paymentReview:false},
   {...base,id:'review',name:'Historical class',payment:'package',renewalDue:false,paymentReview:true},
  ],
 }]};
 const module={exports:{}};
 const source=fs.readFileSync(new URL('../src/components/TodayDesk.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,Date,Map,Set,require(name){
  if(name==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
  if(name==='@/lib/checkout/desk.server')return {loadTodayDesk:async()=>data};
  if(name==='@/components/CheckoutControl')return {
   CheckInActions:()=>null,
   CheckoutControl:({bookingId})=>React.createElement('button',{'data-checkout':bookingId},'Collect'),
  };
  return require(name);
 }});
 const markup=renderToStaticMarkup(await module.exports.TodayDesk({role:'admin',profileId:'test'}));
 assert.ok(markup.includes('PAYMENT DUE · RENEWAL'));
 assert.ok(markup.includes('This class is covered. Renew the package for future classes.'));
 assert.ok(markup.includes('PAYMENT HISTORY REVIEW'));
 assert.ok(markup.includes('PAID / PACKAGE'));
 assert.equal((markup.match(/data-checkout=/g)||[]).length,1);
 assert.ok(markup.includes('data-checkout="unpaid"'));
 for(const id of ['earlier','final','review'])assert.ok(!markup.includes(`data-checkout="${id}"`));
});
