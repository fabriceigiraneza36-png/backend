"use strict";

const express = require("express");
const { query } = require("../config/db");
const upload = require("../middleware/upload");
const logger = require("../utils/logger");

let protect;
try { const m=require("../middleware/authMiddleware"); protect=m.protect||m.authenticate||m.verifyToken||m.auth; } catch {}
if (!protect) try { const m=require("../middleware/auth"); protect=m.protect||m.authenticate||m.verifyToken||m.auth; } catch {}
if (!protect) {
  const jwt=require("jsonwebtoken");
  protect=(req,res,next)=>{const raw=(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();if(!raw)return res.status(401).json({success:false,message:"Unauthorized"});try{req.user=jwt.verify(raw,process.env.JWT_SECRET);next()}catch{return res.status(401).json({success:false,message:"Invalid token"})}};
}
const adminOnly=(req,res,next)=>{const role=req.admin?.role||req.user?.role||req.user?.type;if(!["admin","manager"].includes(role))return res.status(403).json({success:false,message:"Admin access required"});next()};

let sendEmail=null;
try { const e=require("../utils/email"); sendEmail=typeof e.sendEmail==="function"?e.sendEmail:null; } catch {}
let createNotificationInternal=null;
try { ({createNotificationInternal}=require("../controllers/notificationsController")); } catch {}

const ensureSchema=async()=>{
  const cols=[
    ["identity_portrait_url","TEXT"],["identity_portrait_public_id","TEXT"],
    ["identity_portrait_status","VARCHAR(30) DEFAULT 'not_requested'"],
    ["identity_portrait_requested_at","TIMESTAMPTZ"],["identity_portrait_uploaded_at","TIMESTAMPTZ"],
    ["identity_portrait_verified_at","TIMESTAMPTZ"],["identity_portrait_requested_by","INTEGER"]
  ];
  for(const [n,t] of cols) await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "+n+" "+t).catch(()=>{});
};
const getBooking=async(id)=>{
  const {rows}=await query("SELECT b.*, COALESCE(d.name,b.destination_name,'Your trip') AS destination_name, COALESCE(d.image_url,d.cover_image_url,c.image_url,c.cover_image_url) AS destination_image_url, COALESCE(c.name,b.country_name,b.country,'') AS country_name FROM bookings b LEFT JOIN destinations d ON d.id=b.destination_id LEFT JOIN countries c ON c.id=COALESCE(b.country_id,d.country_id) WHERE b.id=$1 LIMIT 1",[id]);
  return rows[0]||null;
};
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const notifyUser=async(b,title,message,url,label)=>createNotificationInternal?createNotificationInternal({userId:b.user_id||null,userEmail:b.email||null,senderType:"admin",type:"identity_portrait",category:"booking",title,message,actionUrl:url,actionLabel:label,priority:"high",metadata:{bookingId:b.id,bookingNumber:b.booking_number}}).catch(e=>logger.warn("[Identity] user notification:",e.message)):null;
const notifyAdmins=async(b,title,message,url,label)=>createNotificationInternal?createNotificationInternal({targetScope:"role",targetRole:"admin",senderType:"user",type:"identity_portrait_received",category:"booking",title,message,actionUrl:url,actionLabel:label,priority:"high",metadata:{bookingId:b.id,bookingNumber:b.booking_number,userId:b.user_id}}).catch(e=>logger.warn("[Identity] admin notification:",e.message)):null;
const email=async(to,subject,html)=>{if(!sendEmail||!to)return;try{await sendEmail({to,subject,html})}catch(e){logger.warn("[Identity] email:",e.message)}};
const userCanAccess=(req,b)=>Number(req.user?.id)===Number(b.user_id)||String(req.user?.email||"").toLowerCase()===String(b.email||"").toLowerCase();

const router=express.Router();

router.post("/:id/request",protect,adminOnly,async(req,res)=>{
 try{
  await ensureSchema(); const id=Number(req.params.id); const b=await getBooking(id);
  if(!b)return res.status(404).json({success:false,message:"Booking not found"});
  await query("UPDATE bookings SET identity_portrait_status='requested',identity_portrait_requested_at=NOW(),identity_portrait_requested_by=$2,updated_at=NOW() WHERE id=$1",[id,req.admin?.id||req.user?.id||null]);
  const full=await getBooking(id), url="/booking-verification/"+id;
  await notifyUser(full,"Altuvera needs a quick identity portrait","Before we confirm your "+(full.destination_name||"trip")+", please upload a clear short face portrait from your device.",url,"Upload portrait");
  await email(full.email,"Identity confirmation needed — "+(full.booking_number||"Your Altuvera booking"),"<div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#0f172a'><div style='padding:28px;border-radius:18px;background:#064e3b;color:#fff'><h2 style='margin:0 0 8px'>One quick step before confirmation</h2><p style='margin:0;opacity:.9'>We need a short face portrait to confirm the traveller details for your planned journey to "+esc(full.destination_name)+".</p></div><p style='line-height:1.6'>Please use the secure button below to upload it.</p><a href='"+(process.env.FRONTEND_URL||"https://www.altuverasafaris.com")+url+"' style='display:inline-block;padding:13px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:10px;font-weight:700'>Upload portrait securely</a></div>");
  return res.json({success:true,data:full,message:"Portrait request sent to the traveller."});
 }catch(e){logger.error("[Identity] request:",e.message);return res.status(500).json({success:false,message:"Failed to request portrait"})}
});

router.post("/:id/upload",protect,upload.single("portrait"),async(req,res)=>{
 try{
  await ensureSchema(); const id=Number(req.params.id); const b=await getBooking(id);
  if(!b)return res.status(404).json({success:false,message:"Booking not found"});
  if(!userCanAccess(req,b))return res.status(403).json({success:false,message:"You do not have access to this booking"});
  if(!["requested","uploaded"].includes(b.identity_portrait_status||"not_requested"))return res.status(409).json({success:false,message:"A portrait has not been requested for this booking."});
  if(!req.file?.secure_url)return res.status(400).json({success:false,message:"Please choose a portrait image."});
  if(!/^image\//.test(req.file.mimetype||""))return res.status(400).json({success:false,message:"Portrait must be an image."});
  await query("UPDATE bookings SET identity_portrait_url=$1,identity_portrait_public_id=$2,identity_portrait_status='uploaded',identity_portrait_uploaded_at=NOW(),updated_at=NOW() WHERE id=$3",[req.file.secure_url,req.file.cloudinary?.public_id||null,id]);
  const full=await getBooking(id);
  await notifyAdmins(full,"Traveller portrait received",(full.full_name||"A traveller")+" uploaded the requested portrait for "+(full.booking_number||"a booking"),"/bookings/"+id,"Review traveller");
  try { req.app?.get?.("io")?.to?.("admins")?.emit?.("notification:new", { type:"identity_portrait_received", category:"booking", title:"Traveller portrait received", message:(full.full_name||"A traveller")+" uploaded the requested portrait for "+(full.booking_number||"a booking"), action_url:"/bookings/"+id, action_label:"Review traveller", priority:"high", metadata:{bookingId:id,bookingNumber:full.booking_number} }); } catch {}
  const adminEmail=process.env.ADMIN_EMAIL||process.env.SUPPORT_EMAIL||"info@altuverasafaris.com";
  await email(adminEmail,"Portrait received — "+(full.booking_number||"Booking"),"<div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px'><h2 style='color:#047857'>Traveller portrait received</h2><p><strong>"+esc(full.full_name)+"</strong> has uploaded the requested portrait for <strong>"+esc(full.booking_number)+"</strong>.</p><img src='"+esc(full.identity_portrait_url)+"' alt='Traveller portrait' style='width:140px;height:140px;object-fit:cover;border-radius:18px;display:block;margin:18px 0'/><a href='"+(process.env.ADMIN_FRONTEND_URL||"https://admin.altuverasafaris.com")+"/bookings/"+id+"' style='display:inline-block;padding:12px 18px;background:#059669;color:#fff;text-decoration:none;border-radius:9px;font-weight:700'>Open booking in admin</a></div>");
  return res.json({success:true,data:full,message:"Portrait uploaded. Altuvera has been notified."});
 }catch(e){logger.error("[Identity] upload:",e.message);return res.status(500).json({success:false,message:"Failed to upload portrait"})}
});

router.post("/:id/confirm",protect,adminOnly,async(req,res)=>{
 try{
  await ensureSchema(); const id=Number(req.params.id); const b=await getBooking(id);
  if(!b)return res.status(404).json({success:false,message:"Booking not found"});
  if(!b.email_verified)return res.status(409).json({success:false,message:"Traveller must first confirm the booking from their real email inbox."});
  if(b.identity_portrait_status!=="uploaded"||!b.identity_portrait_url)return res.status(409).json({success:false,message:"Traveller portrait must be uploaded before confirmation."});
  const code=b.confirmation_code||("ALT-"+Math.random().toString(36).slice(2,10).toUpperCase());
  await query("UPDATE bookings SET identity_portrait_status='verified',identity_portrait_verified_at=NOW(),status='confirmed',confirmed_at=COALESCE(confirmed_at,NOW()),confirmation_code=$2,updated_at=NOW() WHERE id=$1",[id,code]);
  const full=await getBooking(id);
  try{const emails=require("../utils/bookingEmails");if(typeof emails.sendBookingConfirmation==="function")await emails.sendBookingConfirmation(full)}catch{}
  await notifyUser(full,"Your booking is confirmed 🎉","Your identity details have been confirmed and your journey to "+(full.destination_name||"your destination")+" is now confirmed.","/my-bookings","View confirmed booking");
  try { req.app?.get?.("io")?.to?.("user-"+full.user_id)?.emit?.("notification:new", { type:"booking_confirmed", category:"booking", title:"Your booking is confirmed 🎉", message:"Your journey to "+(full.destination_name||"your destination")+" is now confirmed.", action_url:"/my-bookings", action_label:"View confirmed booking", priority:"high" }); } catch {}
  return res.json({success:true,data:full,message:"Traveller verified and booking confirmed."});
 }catch(e){logger.error("[Identity] confirm:",e.message);return res.status(500).json({success:false,message:"Failed to confirm booking"})}
});

router.get("/:id",protect,async(req,res)=>{
 try{await ensureSchema();const b=await getBooking(Number(req.params.id));if(!b)return res.status(404).json({success:false,message:"Booking not found"});if(!userCanAccess(req,b)&&!["admin","manager"].includes(req.user?.role))return res.status(403).json({success:false,message:"Forbidden"});return res.json({success:true,data:b})}
 catch(e){return res.status(500).json({success:false,message:"Failed to load verification state"})}
});
module.exports=router;