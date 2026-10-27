"use strict";

const { query } = require("../config/db");
const logger = require("../utils/logger");

let createNotificationInternal = async () => null;
try {
  ({ createNotificationInternal } = require("./notificationsController"));
} catch {}

let sendItineraryEmail = null;
let sendAdminItineraryNotification = null;
let sendBookingConfirmation = null;
try {
  ({ sendItineraryEmail, sendAdminItineraryNotification, sendBookingConfirmation } = require("../utils/bookingEmails"));
} catch {}

let getIO = () => null;
try {
  const socketBus = require("../utils/socketBus");
  getIO = () => socketBus.getIO?.() || null;
} catch {}

let schemaReady = null;
const ensureSchema = async () => {
  // Run the additive migration once per process instead of on every itinerary
  // read/save/publish request. Share the same in-flight promise across requests.
  if (!schemaReady) {
    schemaReady = (async () => {
      const columns = [
        ["itinerary_status", "VARCHAR(40) DEFAULT 'not_started'"],
        ["itinerary", "JSONB DEFAULT '{}'::JSONB"],
        ["itinerary_version", "INTEGER DEFAULT 0"],
        ["itinerary_published_at", "TIMESTAMPTZ"],
        ["itinerary_approved_at", "TIMESTAMPTZ"],
        ["itinerary_change_request", "TEXT"],
        ["itinerary_author_id", "INTEGER"],
        ["itinerary_email_status", "VARCHAR(20) DEFAULT 'not_sent'"],
        ["itinerary_email_error", "TEXT"],
        ["itinerary_email_attempted_at", "TIMESTAMPTZ"],
        ["itinerary_email_sent_at", "TIMESTAMPTZ"],
      ];
      for (const [name, type] of columns) {
        await query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS " + name + " " + type);
      }
    })().catch((err) => {
      // Permit a retry on the next request if the database was temporarily down.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
};

const bookingDetail = async (id) => {
  const { rows } = await query(
    `SELECT b.*,
            COALESCE(d.name,b.destination_name,'') AS destination_name,
            COALESCE(c.name,b.country_name,b.country,'') AS country_name,
            COALESCE(p.title,'') AS package_name,
            COALESCE(d.image_url,d.cover_image_url,c.image_url,c.cover_image_url) AS destination_image_url,
            COALESCE(c.image_url,c.cover_image_url,d.image_url,d.cover_image_url) AS country_image_url,
            to_jsonb(d) AS destination_details,
            to_jsonb(c) AS country_details,
            to_jsonb(p) AS package_details
       FROM bookings b
       LEFT JOIN destinations d ON d.id=b.destination_id
       LEFT JOIN countries c ON c.id=COALESCE(b.country_id,d.country_id)
       LEFT JOIN packages p ON p.id=b.package_id
      WHERE b.id=$1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
};

const safeId = (v) => {
  const n = parseInt(v,10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const canUserAccess = (req, booking) => {
  if (req.userType === "admin" || req.admin) return true;
  const uid = req.user?.id ? Number(req.user.id) : null;
  const email = req.user?.email ? String(req.user.email).toLowerCase() : null;
  return Boolean((uid && Number(booking.user_id) === uid) || (email && String(booking.email || "").toLowerCase() === email));
};

const normalizeItinerary = (raw = {}) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(src.days) ? src.days : [];
  return {
    title: String(src.title || "Personalized Altuvera Itinerary").trim(),
    introduction: String(src.introduction || "").trim(),
    mode: src.mode === "assisted" ? "assisted" : "manual",
    // The PDF renderer uses a washed-out destination image or a clean white page.
    // Never accept arbitrary URLs here: the background is resolved from the linked booking.
    backgroundMode: src.backgroundMode === "destination" ? "destination" : "white",
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
    planningChecklist: Array.isArray(src.planningChecklist)
      ? src.planningChecklist.map((item, index) => ({
          key: String(item?.key || `item_${index + 1}`).trim(),
          label: String(item?.label || "").trim(),
          done: Boolean(item?.done),
          note: String(item?.note || "").trim(),
        })).filter(item => item.label)
      : [],
    operations: (() => {
      const operations = src.operations && typeof src.operations === "object" ? src.operations : {};
      const allowedStages = new Set(["planning", "awaiting_suppliers", "ready", "in_progress", "completed", "on_hold"]);
      const allowedSupplierStatuses = new Set(["pending", "requested", "confirmed", "paid", "issue", "not_required"]);
      return {
        coordinator: String(operations.coordinator || "").trim().slice(0, 160),
        tripStatus: allowedStages.has(operations.tripStatus) ? operations.tripStatus : "planning",
        suppliers: Array.isArray(operations.suppliers) ? operations.suppliers.slice(0, 30).map((supplier) => ({
          category: String(supplier?.category || "Supplier").trim().slice(0, 120),
          name: String(supplier?.name || "").trim().slice(0, 200),
          contact: String(supplier?.contact || "").trim().slice(0, 240),
          reference: String(supplier?.reference || "").trim().slice(0, 160),
          status: allowedSupplierStatuses.has(supplier?.status) ? supplier.status : "pending",
          notes: String(supplier?.notes || "").trim().slice(0, 1000),
        })) : [],
        readiness: Array.isArray(operations.readiness) ? operations.readiness.slice(0, 50).map((item, index) => ({
          key: String(item?.key || `item_${index + 1}`).trim().slice(0, 80),
          label: String(item?.label || "").trim().slice(0, 240),
          done: Boolean(item?.done),
          note: String(item?.note || "").trim().slice(0, 1000),
        })).filter((item) => item.label) : [],
        risks: String(operations.risks || "").trim().slice(0, 4000),
        nextAction: String(operations.nextAction || "").trim().slice(0, 1000),
        nextActionDue: /^\\d{4}-\\d{2}-\\d{2}$/.test(String(operations.nextActionDue || "")) ? String(operations.nextActionDue) : "",
      };
    })(),
    contactNote: String(src.contactNote || "").trim(),
  };
};

exports.list = async (req,res,next) => {
  try {
    await ensureSchema();
    const { rows } = await query(
      `SELECT b.*,
              COALESCE(d.name,b.destination_name,'') AS destination_name,
              COALESCE(c.name,b.country_name,b.country,'') AS country_name,
              COALESCE(p.title,'') AS package_name,
              COALESCE(d.image_url,d.cover_image_url,c.image_url,c.cover_image_url) AS destination_image_url,
              to_jsonb(d) AS destination_details,
              to_jsonb(c) AS country_details,
              to_jsonb(p) AS package_details
         FROM bookings b
         LEFT JOIN destinations d ON d.id=b.destination_id
         LEFT JOIN countries c ON c.id=COALESCE(b.country_id,d.country_id)
         LEFT JOIN packages p ON p.id=b.package_id
        WHERE COALESCE(b.itinerary_status,'not_started') IN ('draft','sent','change_requested','approved')
          AND b.itinerary IS NOT NULL
          AND b.itinerary <> '{}'::jsonb
        ORDER BY COALESCE(b.updated_at,b.created_at) DESC NULLS LAST
        LIMIT 300`,
    );
    return res.json({ success:true, data:rows });
  } catch(e) {
    logger.error("[Itinerary] list:",e.message);
    next(e);
  }
};

exports.get = async (req,res,next) => {
  try {
    await ensureSchema();
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({success:false,error:"Invalid booking id"});
    const booking = await bookingDetail(id);
    if (!booking) return res.status(404).json({success:false,error:"Booking not found"});
    if (!canUserAccess(req, booking)) return res.status(403).json({success:false,error:"You do not have access to this itinerary."});
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
    if (!booking.email_verified) {
      return res.status(409).json({success:false,error:"Traveller must confirm this booking from their real email inbox before operational planning can begin."});
    }
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
    if (!["confirmed","under_review","itinerary_preparing","revision_requested","itinerary_sent","awaiting_confirmation"].includes(booking.status)) {
      return res.status(409).json({success:false,error:"This booking is not ready for itinerary preparation."});
    }
    // Identity portraits are optional and must not block itinerary preparation.

    const itinerary = normalizeItinerary(req.body?.itinerary || req.body || {});
    if (!itinerary.days.length) {
      return res.status(400).json({success:false,error:"Add at least one itinerary day before sending."});
    }
    const deliveryMode = req.body?.deliveryMode === "email_image" ? "email_image" : "dashboard_pdf";
    const itineraryImageUrl = String(req.body?.itineraryImageUrl || "").trim();
    if (deliveryMode === "email_image" && !/^https:\/\//i.test(itineraryImageUrl)) {
      return res.status(400).json({success:false,error:"A valid HTTPS itinerary image URL is required for image-only delivery."});
    }

    const version = Number(booking.itinerary_version || 0) + 1;
    const { rows } = await query(
      `UPDATE bookings
          SET itinerary=$1::jsonb,
              itinerary_status='sent',
              status='awaiting_confirmation',
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

    // The in-app notification is created first. Email delivery then runs with
    // an explicit persisted outcome; a dashboard notification is never treated
    // as proof that an email was sent.
    await query(
      `UPDATE bookings
          SET itinerary_email_status='sending',
              itinerary_email_error=NULL,
              itinerary_email_attempted_at=NOW()
        WHERE id=$1`,
      [id],
    );

    const io = getIO();
    let notificationResult = null;
    try {
      notificationResult = await createNotificationInternal({
        userId: full.user_id || null,
        userEmail: full.email || null,
        type: "itinerary_ready",
        category: "itinerary",
        title: "Your itinerary is ready",
        message: `Your personalized itinerary for ${full.destination_name || "your trip"} is ready to review.`,
        actionUrl: "/my-bookings",
        actionLabel: "View itinerary",
        priority: "high",
        senderType: "admin",
        senderId: req.admin?.id || req.user?.id || null,
        metadata: { bookingId: full.id, bookingNumber: full.booking_number, itineraryVersion: version, deliveryMode, itineraryImageUrl: deliveryMode === "email_image" ? itineraryImageUrl : null },
        io,
      });
    } catch (notificationError) {
      logger.error("[Itinerary] Traveller in-app notification failed:", notificationError.message);
    }

    let emailResult;
    try {
      emailResult = sendItineraryEmail
        ? await sendItineraryEmail(full, itinerary, deliveryMode === "email_image"
          ? { format: "image", imageUrl: itineraryImageUrl }
          : { format: "dashboard_pdf" })
        : { success: false, error: "Email provider is unavailable." };
    } catch (emailError) {
      emailResult = { success: false, error: emailError.message || "Email provider failed." };
    }

    const emailSent = emailResult?.success !== false && !emailResult?.error;
    const emailError = emailSent ? null : String(emailResult?.error || "Email provider did not confirm successful delivery.").slice(0, 1000);
    await query(
      `UPDATE bookings
          SET itinerary_email_status=$1::varchar(20),
              itinerary_email_error=$2::text,
              itinerary_email_sent_at=CASE WHEN $4::boolean THEN NOW() ELSE NULL END
        WHERE id=$3`,
      [emailSent ? "sent" : "failed", emailError, id, emailSent],
    );

    try {
      if (sendAdminItineraryNotification) {
        const adminEmailResult = await sendAdminItineraryNotification(full, itinerary);
        if (adminEmailResult?.success === false) logger.error("[Itinerary] Admin itinerary notification failed:", adminEmailResult.error || "provider returned success=false");
      }
    } catch (adminEmailError) {
      logger.error("[Itinerary] Admin itinerary notification failed:", adminEmailError.message);
    }

    // Publish a rich itinerary card to the traveler's dedicated booking-support
    // conversation, never into their unrelated personal chat.
    try {
      if (full.user_id) {
        // Create the dedicated booking-support channel on demand as well. A
        // traveller may receive an itinerary before ever opening Messages.
        await query(
          `INSERT INTO conversations
             (user_id, guest_name, guest_email, channel, subject, status, priority,
              source, conversation_type, metadata, unread_admin, unread_user, created_at, updated_at)
           SELECT u.id, u.full_name, u.email, 'booking_support', 'Bookings & travel help',
                  'open', 'normal', 'system', 'resource_support', '{}'::jsonb, 0, 0, NOW(), NOW()
             FROM users u
            WHERE u.id=$1
              AND NOT EXISTS (
                SELECT 1 FROM conversations c
                 WHERE c.user_id=u.id AND c.conversation_type='resource_support'
                   AND c.deleted_at IS NULL
              )`,
          [full.user_id],
        );
        const { rows: conversationRows } = await query(
          `SELECT id FROM conversations
            WHERE user_id=$1 AND conversation_type='resource_support'
              AND deleted_at IS NULL
            ORDER BY created_at ASC LIMIT 1`,
          [full.user_id],
        );
        const conversation = conversationRows[0];
        if (conversation) {
          const { insertMessage } = require("../utils/messaging");
          const message = await insertMessage({
            conversationId: conversation.id,
            senderType: "admin",
            senderId: req.admin?.id || req.user?.id || null,
            senderName: req.admin?.full_name || req.user?.full_name || "Altuvera Admin",
            senderEmail: req.admin?.email || req.user?.email || null,
            body: `Your itinerary for ${full.destination_name || "your trip"} (booking ${full.booking_number || full.id}) is ready to review and download.`,
            msgType: "itinerary",
            metadata: {
              kind: "itinerary",
              bookingId: full.id,
              bookingNumber: full.booking_number || null,
              booking: {
                id: full.id,
                booking_number: full.booking_number || null,
                destination_name: full.destination_name || null,
                country_name: full.country_name || null,
                travel_date: full.travel_date || null,
                return_date: full.return_date || null,
                number_of_travelers: full.number_of_travelers || null,
              },
              itinerary,
              emailStatus: emailSent ? "sent" : "failed",
            },
          });
          io?.to?.(`conversation-${conversation.id}`)?.emit?.("msg:message", message);
          io?.to?.(`conv:${conversation.id}`)?.emit?.("msg:message", message);
          io?.to?.(`user-${full.user_id}`)?.emit?.("msg:new-from-admin", { conversationId: conversation.id, message });
        }
      }
    } catch (messageError) {
      logger.error("[Itinerary] Could not add itinerary to booking-support conversation:", messageError.message);
    }

    try {
      const io = getIO();
      io?.to?.(`user:${full.user_id}`)?.emit?.("itinerary:published", { bookingId: full.id, bookingNumber: full.booking_number, itinerary });
    } catch {}

    const updatedBooking = (await bookingDetail(id)) || full;
    return res.json({
      success: true,
      data: updatedBooking,
      delivery: {
        dashboard: "published",
        notification: notificationResult?.success === false ? "failed" : "created",
        email: emailSent ? "sent" : "failed",
        emailError,
      },
      message: emailSent
        ? "Itinerary published and the email provider accepted the message successfully."
        : `Itinerary published to the dashboard, but email delivery failed: ${emailError}`,
    });
  } catch(e) { logger.error("[Itinerary] publish:",e.message); next(e); }
};

exports.approve = async (req,res,next) => {
  try {
    await ensureSchema();
    const id=safeId(req.params.id);
    const booking=await bookingDetail(id);
    if(!booking) return res.status(404).json({success:false,error:"Booking not found"});
    if(!canUserAccess(req, booking)) return res.status(403).json({success:false,error:"You do not have access to this itinerary."});
    if(!["sent","change_requested"].includes(booking.itinerary_status)) return res.status(409).json({success:false,error:"There is no itinerary awaiting approval."});
    const {rows}=await query(
      `UPDATE bookings
          SET itinerary_status='approved',
              status='confirmed',
              itinerary_approved_at=NOW(),
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
    if(!canUserAccess(req, booking)) return res.status(403).json({success:false,error:"You do not have access to this itinerary."});
    const reason=String(req.body?.reason || "").trim();
    if(!reason) return res.status(400).json({success:false,error:"Please describe the change you need."});
    const {rows}=await query(
      `UPDATE bookings SET itinerary_status='change_requested', status='revision_requested', itinerary_change_request=$1, updated_at=NOW()
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
