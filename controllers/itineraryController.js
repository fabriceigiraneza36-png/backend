"use strict";

const { query } = require("../config/db");
const logger = require("../utils/logger");

let createNotificationInternal = async () => null;
try {
  ({ createNotificationInternal } = require("./notificationsController"));
} catch {}

let sendItineraryEmail = null;
let sendBookingConfirmation = null;
try {
  ({ sendItineraryEmail, sendBookingConfirmation } = require("../utils/bookingEmails"));
} catch {}

let getIO = () => null;
try {
  const socketBus = require("../utils/socketBus");
  getIO = () => socketBus.getIO?.() || null;
} catch {}

const ensureSchema = async () => {
  const columns = [
    ["itinerary_status", "VARCHAR(40) DEFAULT 'not_started'"],
    ["itinerary", "JSONB DEFAULT '{}'::JSONB"],
    ["itinerary_version", "INTEGER DEFAULT 0"],
    ["itinerary_published_at", "TIMESTAMPTZ"],
    ["itinerary_approved_at", "TIMESTAMPTZ"],
    ["itinerary_change_request", "TEXT"],
    ["itinerary_author_id", "INTEGER"],
  ];
  for (const [name, type] of columns) {
    await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS " + name + " " + type).catch(() => {});
  }
};

const bookingDetail = async (id) => {
  const { rows } = await query(
    `SELECT b.*,
            COALESCE(d.name,b.destination_name,'') AS destination_name,
            COALESCE(c.name,b.country_name,b.country,'') AS country_name
       FROM bookings b
       LEFT JOIN destinations d ON d.id=b.destination_id
       LEFT JOIN countries c ON c.id=COALESCE(b.country_id,d.country_id)
      WHERE b.id=$1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
};

const safeId = (v) => {
  const n = parseInt(v,10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const normalizeItinerary = (raw = {}) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(src.days) ? src.days : [];
  return {
    title: String(src.title || "Personalized Altuvera Itinerary").trim(),
    introduction: String(src.introduction || "").trim(),
    mode: src.mode === "assisted" ? "assisted" : "manual",
    days: days.map((day, index) => ({
      day: index + 1,
      date: day?.date || null,
      title: String(day?.title || day?.location || `Day ${index + 1}`).trim(),
      location: String(day?.location || "").trim(),
      activities: Array.isArray(day?.activities)
        ? day.activities.map(a => typeof a === "string" ? a.trim() : String(a?.title || a?.name || "").trim()).filter(Boolean)
        : [],
      transport: String(day?.transport || "").trim(),
      accommodation: String(day?.accommodation || "").trim(),
      meals: String(day?.meals || "").trim(),
      notes: String(day?.notes || "").trim(),
    })),
    inclusions: Array.isArray(src.inclusions) ? src.inclusions.map(String).map(s=>s.trim()).filter(Boolean) : [],
    essentials: Array.isArray(src.essentials) ? src.essentials.map(String).map(s=>s.trim()).filter(Boolean) : [],
    contactNote: String(src.contactNote || "").trim(),
  };
};

exports.get = async (req,res,next) => {
  try {
    await ensureSchema();
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({success:false,error:"Invalid booking id"});
    const booking = await bookingDetail(id);
    if (!booking) return res.status(404).json({success:false,error:"Booking not found"});
    return res.json({success:true,data:{booking,itinerary:booking.itinerary || {},itinerary_status:booking.itinerary_status || "not_started"}});
  } catch(e) { logger.error("[Itinerary] get:",e.message); next(e); }
};

exports.saveDraft = async (req,res,next) => {
  try {
    await ensureSchema();
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({success:false,error:"Invalid booking id"});
    const booking = await bookingDetail(id);
    if (!booking) return res.status(404).json({success:false,error:"Booking not found"});
    const itinerary = normalizeItinerary(req.body?.itinerary || req.body || {});
    const authorId = req.admin?.id || req.user?.id || null;
    const { rows } = await query(
      `UPDATE bookings
          SET itinerary=$1::jsonb,
              itinerary_status='draft',
              itinerary_author_id=$2,
              updated_at=NOW()
        WHERE id=$3
        RETURNING *`,
      [JSON.stringify(itinerary), authorId, id],
    );
    return res.json({success:true,data:rows[0],message:"Itinerary draft saved"});
  } catch(e) { logger.error("[Itinerary] saveDraft:",e.message); next(e); }
};

exports.publish = async (req,res,next) => {
  try {
    await ensureSchema();
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({success:false,error:"Invalid booking id"});
    const booking = await bookingDetail(id);
    if (!booking) return res.status(404).json({success:false,error:"Booking not found"});
    if (!booking.email_verified) {
      return res.status(409).json({success:false,error:"Traveller has not confirmed this booking request from their email yet."});
    }

    const itinerary = normalizeItinerary(req.body?.itinerary || req.body || {});
    if (!itinerary.days.length) {
      return res.status(400).json({success:false,error:"Add at least one itinerary day before sending."});
    }

    const version = Number(booking.itinerary_version || 0) + 1;
    const { rows } = await query(
      `UPDATE bookings
          SET itinerary=$1::jsonb,
              itinerary_status='sent',
              itinerary_version=$2,
              itinerary_published_at=NOW(),
              itinerary_approved_at=NULL,
              itinerary_change_request=NULL,
              itinerary_author_id=$3,
              updated_at=NOW()
        WHERE id=$4
        RETURNING *`,
      [JSON.stringify(itinerary), version, req.admin?.id || req.user?.id || null, id],
    );
    const full = (await bookingDetail(id)) || rows[0];

    await Promise.allSettled([
      sendItineraryEmail ? sendItineraryEmail(full,itinerary) : Promise.resolve(),
      createNotificationInternal({
        userId: full.user_id || null,
        userEmail: full.email || null,
        type: "itinerary_ready",
        category: "itinerary",
        title: "Your itinerary is ready ✨",
        message: `Your personalized itinerary for ${full.destination_name || "your trip"} is ready to review.`,
        actionUrl: "/my-bookings",
        actionLabel: "View itinerary",
        priority: "high",
        senderType: "admin",
        senderId: req.admin?.id || req.user?.id || null,
        metadata: { bookingId: full.id, bookingNumber: full.booking_number, itineraryVersion: version },
      }),
    ]);

    try {
      const io = getIO();
      io?.to?.(`user:${full.user_id}`)?.emit?.("itinerary:published", { bookingId: full.id, bookingNumber: full.booking_number, itinerary });
    } catch {}

    return res.json({success:true,data:full,message:"Itinerary sent to the traveller dashboard and email."});
  } catch(e) { logger.error("[Itinerary] publish:",e.message); next(e); }
};

exports.approve = async (req,res,next) => {
  try {
    await ensureSchema();
    const id=safeId(req.params.id);
    const booking=await bookingDetail(id);
    if(!booking) return res.status(404).json({success:false,error:"Booking not found"});
    if(!["sent","change_requested"].includes(booking.itinerary_status)) return res.status(409).json({success:false,error:"There is no itinerary awaiting approval."});
    const {rows}=await query(
      `UPDATE bookings
          SET itinerary_status='approved',
              itinerary_approved_at=NOW(),
              status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END,
              confirmed_at=CASE WHEN status='pending' THEN NOW() ELSE confirmed_at END,
              updated_at=NOW()
        WHERE id=$1 RETURNING *`,[id]);
    const full=(await bookingDetail(id))||rows[0];
    await Promise.allSettled([
      sendBookingConfirmation ? sendBookingConfirmation(full) : Promise.resolve(),
      createNotificationInternal({
        userId: full.user_id || null,
        userEmail: full.email || null,
        type: "booking_confirmed",
        category: "booking",
        title: "Your trip is confirmed 🎉",
        message: `Your itinerary for ${full.destination_name || "your trip"} has been approved and your booking is now confirmed.`,
        actionUrl: "/my-bookings",
        actionLabel: "View confirmed trip",
        priority: "high",
        senderType: "admin",
        metadata: { bookingId: full.id, bookingNumber: full.booking_number },
      }),
    ]);
    try {
      const io=getIO(); io?.to?.(`user:${full.user_id}`)?.emit?.("itinerary:approved",{bookingId:full.id});
    } catch {}
    return res.json({success:true,data:full,message:"Itinerary approved and booking confirmed."});
  } catch(e){logger.error("[Itinerary] approve:",e.message);next(e);}
};

exports.requestChange = async (req,res,next) => {
  try {
    await ensureSchema();
    const id=safeId(req.params.id);
    const booking=await bookingDetail(id);
    if(!booking) return res.status(404).json({success:false,error:"Booking not found"});
    const reason=String(req.body?.reason || "").trim();
    if(!reason) return res.status(400).json({success:false,error:"Please describe the change you need."});
    const {rows}=await query(
      `UPDATE bookings SET itinerary_status='change_requested', itinerary_change_request=$1, updated_at=NOW()
        WHERE id=$2 RETURNING *`,[reason,id]);
    const full=(await bookingDetail(id))||rows[0];
    await createNotificationInternal({
      targetScope:"role",targetRole:"admin",type:"itinerary_change_requested",category:"itinerary",
      title:"Itinerary change requested",message:`${full.full_name || "Traveller"} requested a change for ${full.booking_number}.`,
      actionUrl:`/itineraries/${full.id}`,actionLabel:"Review change",priority:"high",
      metadata:{bookingId:full.id,bookingNumber:full.booking_number,reason},
    }).catch(()=>null);
    return res.json({success:true,data:full,message:"Change request sent to Altuvera."});
  } catch(e){logger.error("[Itinerary] requestChange:",e.message);next(e);}
};
