import "server-only";
import { google } from "googleapis";
import { createOAuthClient } from "@/lib/google/oauth";
import { decryptToken } from "@/lib/google/crypto";
import type { OutgoingEmail } from "@/lib/email";

export type ConnectedStudioMail={id:string;google_account_email:string|null;google_refresh_token:string|null;google_token_status:string|null};

/** Reuses the OAuth Gmail delivery path already used by booking emails. */
export async function sendConnectedStudioEmail(
 studio:ConnectedStudioMail|null, message:OutgoingEmail
):Promise<{ok:true}|{ok:false;error:string}>{
 if(!studio||studio.google_token_status!=="connected"||!studio.google_refresh_token||!studio.google_account_email){
  return {ok:false,error:"No connected studio Gmail account"};
 }
 try{
  const auth=createOAuthClient();
  auth.setCredentials({refresh_token:decryptToken(studio.google_refresh_token)});
  const gmail=google.gmail({version:"v1",auth});
  const recipients=(Array.isArray(message.to)?message.to:[message.to]).map(x=>x.replace(/[\r\n]/g,"").trim()).filter(Boolean);
  const from=studio.google_account_email.replace(/[\r\n]/g,"").trim();
  const subject="=?UTF-8?B?"+Buffer.from(message.subject).toString("base64")+"?=";
  const raw=[
   "From: "+from,
   "To: "+recipients.join(", "),
   "Subject: "+subject,
   "MIME-Version: 1.0",
   'Content-Type: text/html; charset="UTF-8"',
   "Content-Transfer-Encoding: 8bit",
   "",
   message.html,
  ].join("\r\n");
  await gmail.users.messages.send({userId:"me",requestBody:{raw:Buffer.from(raw)
   .toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}});
  return {ok:true};
 }catch(error){
  return {ok:false,error:error instanceof Error ? "Google Gmail: "+error.message : "Gmail send failed"};
 }
}
