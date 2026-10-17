"use client";
import {useState} from "react";
export function PhotoPicker({name="image"}:{name?:string}){
 const [message,setMessage]=useState("Phone photos are automatically optimized before upload.");
 async function optimize(e:React.ChangeEvent<HTMLInputElement>){
  const input=e.currentTarget,file=input.files?.[0];
  if(!file)return;
  if(file.size<3*1024*1024){setMessage("Ready to upload · "+(file.size/1048576).toFixed(1)+" MB");return;}
  setMessage("Optimizing photo…");
  try{
   const bitmap=await createImageBitmap(file);
   const factor=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);
   const ctx=canvas.getContext("2d");if(!ctx)throw Error("Image optimization unavailable");
   ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.76));
   if(!blob||blob.size>3.7*1048576)throw Error("Please choose a smaller photo.");
   const transfer=new DataTransfer();transfer.items.add(new File([blob],file.name.replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg"}));input.files=transfer.files;
   setMessage("Optimized · "+(blob.size/1048576).toFixed(1)+" MB · Ready to upload");
  }catch(err){input.value="";setMessage(err instanceof Error?err.message:"Please select a smaller image.")}
 }
 return <div><input type="file" name={name} accept="image/jpeg,image/png,image/webp" required className="input w-full" onChange={optimize}/><p aria-live="polite" className="mt-1 text-xs text-stone-500">{message}</p></div>;
}
