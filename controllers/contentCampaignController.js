"use strict";

const { query } = require("../config/db");
const logger = require("../utils/logger");
const emailService = require("../utils/emailService");
const campaignTemplates = require("../utils/emailCampaignTemplates");
const { createNotificationInternal } = require("./notificationsController");

const FRONTEND_URL = String(process.env.FRONTEND_URL || "https://www.altuverasafaris.com").replace(/\/+$/,"");
const isEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const escape = (value) => String(value == null ? "" : value)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");

let schemaPromise = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query("CREATE TABLE IF NOT EXISTS email_broadcast_audience_lists (id BIGSERIAL PRIMARY KEY,name VARCHAR(120) NOT NULL,user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,created_by INTEGER,updated_by INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await query("CREATE TABLE IF NOT EXISTS email_broadcast_settings (id SMALLINT PRIMARY KEY CHECK (id=1),default_audience VARCHAR(24) NOT NULL DEFAULT 'all',default_audience_list_id BIGINT,updated_by INTEGER,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await query("INSERT INTO email_broadcast_settings (id,default_audience) VALUES (1,'all') ON CONFLICT (id) DO NOTHING");
      await query("ALTER TABLE countries ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}'::text[]").catch(() => {});
      await query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_gallery JSONB DEFAULT '[]'::jsonb").catch(() => {});
      await query("CREATE TABLE IF NOT EXISTS destination_images (id SERIAL PRIMARY KEY,destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,image_url TEXT NOT NULL,thumbnail_url TEXT,caption TEXT,alt_text TEXT,is_primary BOOLEAN DEFAULT false,is_active BOOLEAN DEFAULT true,sort_order INTEGER DEFAULT 0,uploaded_by INTEGER,created_at TIMESTAMPTZ DEFAULT NOW())").catch(() => {});
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function listUrls() {
  const found = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(add);
    if (typeof value === "object") return add(value.url || value.image_url || value.imageUrl || value.secure_url);
    const url = String(value).trim();
    if (/^https:\/\//i.test(url) && !found.some((item) => item.url === url)) found.push({ url, alt: "Altuvera Safaris travel image" });
  };
  for (const value of arguments) add(value);
  return found;
}

function contentUrl(type,row) {
  const key = encodeURIComponent(row.slug || row.id);
  if (type === "destination") return FRONTEND_URL + "/destinations/" + key;
  if (type === "country") return FRONTEND_URL + "/country/" + key;
  if (type === "package") return FRONTEND_URL + "/packages/" + key;
  if (type === "post") return FRONTEND_URL + "/blog/" + key;
  return FRONTEND_URL + "/gallery";
}

async function getContentItem(type,id) {
  await ensureSchema();
  const tables = { destination:"destinations",country:"countries",package:"packages",post:"posts",gallery:"gallery" };
  const table = tables[String(type || "").toLowerCase()];
  if (!table) throw Object.assign(new Error("Unsupported content type."),{status:400});
  const { rows } = await query("SELECT * FROM " + table + " WHERE id=$1 LIMIT 1",[id]);
  const row = rows[0];
  if (!row) return null;
  let images = [];
  if (type === "destination") {
    const related = await query("SELECT image_url,thumbnail_url,caption,alt_text FROM destination_images WHERE destination_id=$1 AND COALESCE(is_active,true)=true ORDER BY is_primary DESC,sort_order ASC,id ASC",[id]).catch(() => ({rows:[]}));
    images = listUrls(row.hero_image,row.cover_image_url,row.image_url,row.thumbnail_url,row.image_urls,
      (related.rows || []).map((image) => ({url:image.image_url || image.thumbnail_url,caption:image.caption || image.alt_text || ""})));
  } else if (type === "country") {
    images = listUrls(row.hero_image,row.hero_image_url,row.cover_image_url,row.cover_image,row.image_url,row.images,row.hero_images,row.gallery);
  } else if (type === "package") {
    images = listUrls(row.cover_image_url,row.thumbnail_url,row.image_url,row.image_gallery);
  } else if (type === "post") {
    images = listUrls(row.image_url,row.image_gallery);
  } else {
    images = listUrls(row.image_url,row.thumbnail_url);
  }
  return {
    id:row.id,type,title:String(row.name || row.title || "Altuvera update"),
    slug:row.slug || null,
    description:String(row.short_description || row.excerpt || row.description || "").slice(0,1400),
    status:(type === "post" || type === "package") ? (row.is_published ? "published" : "draft")
      : (row.is_active === false ? "inactive" : (row.status || "available")),
    contentUrl:contentUrl(type,row),images
  };
}

exports.getContentLibrary = async (req,res,next) => {
  try {
    await ensureSchema();
    const type = String(req.query.type || "destination").toLowerCase();
    const search = String(req.query.search || "").trim().slice(0,100);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit,10) || 30,1),60);
    const like = "%" + search.replace(/[%_]/g,"\\$&") + "%";
    let result;
    if (type === "destination") {
      result = await query("SELECT id FROM destinations WHERE ($1='' OR name ILIKE $2 OR COALESCE(slug,'') ILIKE $2 OR COALESCE(short_description,'') ILIKE $2) ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT $3",[search,like,limit]);
    } else if (type === "country") {
      result = await query("SELECT id FROM countries WHERE ($1='' OR name ILIKE $2 OR COALESCE(slug,'') ILIKE $2) ORDER BY name ASC LIMIT $3",[search,like,limit]);
    } else if (type === "package") {
      result = await query("SELECT id FROM packages WHERE ($1='' OR title ILIKE $2 OR COALESCE(slug,'') ILIKE $2 OR COALESCE(short_description,'') ILIKE $2) ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT $3",[search,like,limit]);
    } else if (type === "post") {
      result = await query("SELECT id FROM posts WHERE ($1='' OR title ILIKE $2 OR COALESCE(excerpt,'') ILIKE $2 OR COALESCE(slug,'') ILIKE $2) ORDER BY COALESCE(published_at,created_at) DESC NULLS LAST,id DESC LIMIT $3",[search,like,limit]);
    } else if (type === "gallery") {
      result = await query("SELECT id FROM gallery WHERE COALESCE(is_active,true)=true AND ($1='' OR title ILIKE $2 OR COALESCE(description,'') ILIKE $2 OR COALESCE(location,'') ILIKE $2) ORDER BY is_featured DESC,sort_order ASC,created_at DESC LIMIT $3",[search,like,limit]);
    } else {
      return res.status(400).json({success:false,error:"Choose destinations, countries, packages, posts, or gallery assets."});
    }
    const data = await Promise.all(result.rows.map((row) => getContentItem(type,row.id)));
    return res.json({success:true,data:data.filter(Boolean)});
  } catch(error) {
    logger.error("[ContentCampaign] library:",error.message);
    next(error);
  }
};

exports.uploadContentImages = async (req,res,next) => {
  try {
    await ensureSchema();
    const type = String(req.params.type || "").toLowerCase();
    const id = String(req.params.id || "").trim();
    const tables = {destination:"destinations",country:"countries",package:"packages",post:"posts"};
    if (!tables[type]) return res.status(400).json({success:false,error:"Select a destination, country, package, or post before attaching images."});
    if (!id) return res.status(400).json({success:false,error:"A content item is required."});
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length || files.length > 8 || files.some((file) => !String(file.mimetype || "").startsWith("image/"))) {
      return res.status(400).json({success:false,error:"Choose between 1 and 8 image files."});
    }
    const urls = files.map((file) => String(file.secure_url || file.path || "").trim()).filter((url) => /^https:\/\//i.test(url));
    if (urls.length !== files.length) return res.status(502).json({success:false,error:"One or more image uploads did not complete securely."});
    const exists = await query("SELECT id FROM " + tables[type] + " WHERE id=$1 LIMIT 1",[id]);
    if (!exists.rows[0]) return res.status(404).json({success:false,error:"Selected content item was not found."});

    if (type === "destination") {
      const max = await query("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM destination_images WHERE destination_id=$1",[id]);
      for (let i=0;i<urls.length;i+=1) {
        await query("INSERT INTO destination_images (destination_id,image_url,thumbnail_url,caption,alt_text,sort_order,uploaded_by) VALUES ($1,$2,$2,$3,$3,$4,$5)",
          [id,urls[i],String(files[i].originalname || "Campaign image"),Number(max.rows[0]?.next_order || 0)+i,req.user?.id || null]);
      }
      await query("UPDATE destinations SET image_urls=ARRAY(SELECT DISTINCT unnest(COALESCE(image_urls,'{}'::text[]) || $2::text[])),image_url=COALESCE(NULLIF(image_url,''),$3),updated_at=NOW() WHERE id=$1",[id,urls,urls[0]]);
    } else if (type === "country") {
      await query("UPDATE countries SET images=ARRAY(SELECT DISTINCT unnest(COALESCE(images,'{}'::text[]) || $2::text[])),image_url=COALESCE(NULLIF(image_url,''),$3) WHERE id=$1",[id,urls,urls[0]]);
    } else if (type === "package") {
      await query("UPDATE packages SET image_gallery=COALESCE(image_gallery,'[]'::jsonb) || $2::jsonb,cover_image_url=COALESCE(NULLIF(cover_image_url,''),$3),updated_at=NOW() WHERE id=$1",[id,JSON.stringify(urls),urls[0]]);
    } else {
      await query("UPDATE posts SET image_gallery=COALESCE(image_gallery,'[]'::jsonb) || $2::jsonb,image_url=COALESCE(NULLIF(image_url,''),$3),updated_at=NOW() WHERE id=$1",[id,JSON.stringify(urls),urls[0]]);
    }
    const item = await getContentItem(type,id);
    return res.status(201).json({success:true,message:urls.length+" image(s) attached to "+type+" media.",data:{urls,item}});
  } catch(error) {
    logger.error("[ContentCampaign] attach images:",error.message);
    next(error);
  }
};

exports.uploadGalleryAssets = async (req,res,next) => {
  try {
    await ensureSchema();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length || files.length > 8 || files.some((file) => !String(file.mimetype || "").startsWith("image/"))) {
      return res.status(400).json({success:false,error:"Choose between 1 and 8 image files."});
    }
    const urls = files.map((file) => String(file.secure_url || file.path || "").trim()).filter((url) => /^https:\/\//i.test(url));
    if (urls.length !== files.length) return res.status(502).json({success:false,error:"One or more image uploads did not complete securely."});
    for (let i=0;i<urls.length;i+=1) {
      await query("INSERT INTO gallery (title,image_url,thumbnail_url,category,location,sort_order,is_active) VALUES ($1,$2,$2,'campaign','',$3,true)",
        [String(files[i].originalname || "Campaign image").replace(/\.[^.]+$/,"").slice(0,180),urls[i],i]);
    }
    return res.status(201).json({success:true,data:{urls},message:urls.length+" image(s) added to the Altuvera gallery."});
  } catch(error) {
    logger.error("[ContentCampaign] gallery upload:",error.message);
    next(error);
  }
};

const getAudienceUserIds = async (mode,listId,selectedIds) => {
  if (mode === "all") {
    const {rows} = await query("SELECT id FROM users WHERE COALESCE(is_active,true)=true ORDER BY id");
    return rows.map((row) => Number(row.id));
  }
  let ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (mode === "saved_list") {
    const {rows} = await query("SELECT user_ids FROM email_broadcast_audience_lists WHERE id=$1 LIMIT 1",[listId]);
    if (!rows[0]) throw Object.assign(new Error("Saved audience list was not found."),{status:404});
    try { ids = Array.isArray(rows[0].user_ids) ? rows[0].user_ids : JSON.parse(rows[0].user_ids || "[]"); } catch { ids=[]; }
  }
  const safeIds = [...new Set(ids.map(Number).filter((value) => Number.isSafeInteger(value) && value>0))].slice(0,5000);
  if (!safeIds.length) return [];
  const {rows} = await query("SELECT id FROM users WHERE id=ANY($1::integer[]) AND COALESCE(is_active,true)=true ORDER BY id",[safeIds]);
  return rows.map((row) => Number(row.id));
};

async function getUserRows(ids) {
  if (!ids.length) return [];
  const {rows} = await query(
    "SELECT u.id,u.full_name AS name,u.email,u.avatar_url,(COALESCE(u.subscribed,false) OR EXISTS (SELECT 1 FROM subscribers s WHERE LOWER(s.email)=LOWER(u.email) AND s.is_active=true) OR EXISTS (SELECT 1 FROM bookings b WHERE LOWER(b.email)=LOWER(u.email) AND COALESCE(b.newsletter_opt_in,false)=true)) AS email_opt_in FROM users u WHERE u.id=ANY($1::integer[]) AND COALESCE(u.is_active,true)=true",
    [ids],
  );
  return rows;
}

async function getAllOptedInEmails() {
  const {rows} = await query(
    "SELECT LOWER(email) AS email,name,avatar_url,user_id FROM (SELECT u.email,u.full_name AS name,u.avatar_url,u.id AS user_id FROM users u WHERE COALESCE(u.is_active,true)=true AND COALESCE(u.subscribed,false)=true AND u.email IS NOT NULL AND u.email<>'' UNION ALL SELECT s.email,COALESCE(s.name,u.full_name) AS name,u.avatar_url,u.id AS user_id FROM subscribers s LEFT JOIN users u ON LOWER(u.email)=LOWER(s.email) WHERE s.is_active=true AND s.email IS NOT NULL AND s.email<>'' UNION ALL SELECT b.email,b.full_name AS name,u.avatar_url,u.id AS user_id FROM bookings b LEFT JOIN users u ON LOWER(u.email)=LOWER(b.email) WHERE b.email IS NOT NULL AND b.email<>'' AND COALESCE(b.newsletter_opt_in,false)=true) t"
  );
  const map = new Map();
  for (const row of rows) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!isEmail(email)) continue;
    const previous = map.get(email) || {};
    map.set(email,{
      email,
      name:previous.name || row.name || null,
      avatar_url:previous.avatar_url || row.avatar_url || null,
      user_id:previous.user_id || row.user_id || null,
    });
  }
  return [...map.values()];
}

async function resolveTarget(payload = {}) {
  await ensureSchema();
  let mode = String(payload.recipientMode || "default").toLowerCase();
  let listId = payload.savedAudienceId || null;
  if (mode === "default") {
    const {rows} = await query("SELECT default_audience,default_audience_list_id FROM email_broadcast_settings WHERE id=1");
    mode = rows[0]?.default_audience === "saved_list" ? "saved_list" : "all";
    listId = listId || rows[0]?.default_audience_list_id || null;
  }
  if (!["all","saved_list","selected"].includes(mode)) mode = "all";
  const userIds = await getAudienceUserIds(mode,listId,payload.userIds);
  const users = await getUserRows(userIds);
  const emails = mode === "all" ? await getAllOptedInEmails() : users.filter((user) => user.email_opt_in && isEmail(String(user.email || "")))
    .map((user) => ({email:String(user.email).trim().toLowerCase(),name:user.name || null,avatar_url:user.avatar_url || null,user_id:user.id}));
  return {mode,userIds,users,emailRecipients:emails};
}

exports.getRecipients = async (req,res,next) => {
  try {
    await ensureSchema();
    const search = String(req.query.search || "").trim().slice(0,100);
    const like = "%" + search.replace(/[%_]/g,"\\$&") + "%";
    const {rows} = await query(
      "SELECT u.id,u.full_name AS name,u.email,u.avatar_url,u.nationality,(COALESCE(u.subscribed,false) OR EXISTS (SELECT 1 FROM subscribers s WHERE LOWER(s.email)=LOWER(u.email) AND s.is_active=true) OR EXISTS (SELECT 1 FROM bookings b WHERE LOWER(b.email)=LOWER(u.email) AND COALESCE(b.newsletter_opt_in,false)=true)) AS email_opt_in FROM users u WHERE COALESCE(u.is_active,true)=true AND u.email IS NOT NULL AND u.email<>'' AND ($1='' OR u.full_name ILIKE $2 OR u.email ILIKE $2 OR COALESCE(u.nationality,'') ILIKE $2) ORDER BY u.full_name NULLS LAST,u.email LIMIT 100",
      [search,like],
    );
    return res.json({success:true,data:rows});
  } catch(error) { logger.error("[ContentCampaign] recipients:",error.message); next(error); }
};

exports.getAudienceSettings = async (_req,res,next) => {
  try {
    await ensureSchema();
    const [settings,lists] = await Promise.all([
      query("SELECT default_audience,default_audience_list_id FROM email_broadcast_settings WHERE id=1"),
      query("SELECT id,name,JSONB_ARRAY_LENGTH(user_ids) AS recipient_count,created_at,updated_at FROM email_broadcast_audience_lists ORDER BY updated_at DESC,id DESC"),
    ]);
    return res.json({success:true,data:{
      defaultAudience:settings.rows[0]?.default_audience || "all",
      defaultAudienceListId:settings.rows[0]?.default_audience_list_id || null,
      lists:lists.rows,
    }});
  } catch(error) { logger.error("[ContentCampaign] audience settings:",error.message); next(error); }
};

exports.saveAudienceList = async (req,res,next) => {
  try {
    await ensureSchema();
    const name = String(req.body?.name || "").trim().slice(0,120);
    const ids = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id>0))].slice(0,5000) : [];
    if (!name || !ids.length) return res.status(422).json({success:false,error:"Give the audience a name and select at least one user."});
    const valid = await query("SELECT id FROM users WHERE id=ANY($1::integer[]) AND COALESCE(is_active,true)=true",[ids]);
    const validIds = valid.rows.map((row) => Number(row.id));
    if (!validIds.length) return res.status(422).json({success:false,error:"No active users were found in this list."});
    const {rows} = await query("INSERT INTO email_broadcast_audience_lists (name,user_ids,created_by,updated_by) VALUES ($1,$2::jsonb,$3,$3) RETURNING id,name,JSONB_ARRAY_LENGTH(user_ids) AS recipient_count",
      [name,JSON.stringify(validIds),req.user?.id || null]);
    return res.status(201).json({success:true,data:rows[0],message:"Saved audience list created."});
  } catch(error) { logger.error("[ContentCampaign] save audience:",error.message); next(error); }
};

exports.deleteAudienceList = async (req,res,next) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    await query("DELETE FROM email_broadcast_audience_lists WHERE id=$1",[id]);
    await query("UPDATE email_broadcast_settings SET default_audience='all',default_audience_list_id=NULL,updated_at=NOW() WHERE id=1 AND default_audience_list_id=$1",[id]);
    return res.json({success:true});
  } catch(error) { logger.error("[ContentCampaign] delete audience:",error.message); next(error); }
};

exports.updateAudienceSettings = async (req,res,next) => {
  try {
    await ensureSchema();
    const audience = String(req.body?.defaultAudience || "all");
    const listId = req.body?.defaultAudienceListId ? Number(req.body.defaultAudienceListId) : null;
    if (!["all","saved_list"].includes(audience)) return res.status(422).json({success:false,error:"Choose all opted-in contacts or a saved audience list."});
    if (audience === "saved_list") {
      const exists = await query("SELECT id FROM email_broadcast_audience_lists WHERE id=$1",[listId]);
      if (!exists.rows[0]) return res.status(422).json({success:false,error:"Choose a valid saved audience list."});
    }
    await query("UPDATE email_broadcast_settings SET default_audience=$1,default_audience_list_id=$2,updated_by=$3,updated_at=NOW() WHERE id=1",
      [audience,audience==="saved_list" ? listId : null,req.user?.id || null]);
    return res.json({success:true,data:{defaultAudience:audience,defaultAudienceListId:audience==="saved_list" ? listId : null}});
  } catch(error) { logger.error("[ContentCampaign] update audience:",error.message); next(error); }
};

exports.preview = async (req,res,next) => {
  try {
    const target = await resolveTarget(req.body || {});
    const channels = req.body?.channels || {email:true,inApp:true};
    return res.json({
      success:true,
      emailCount:channels.email === false ? 0 : target.emailRecipients.length,
      inAppCount:channels.inApp === false ? 0 : target.userIds.length,
      selectedUsersCount:target.userIds.length,
      emailEligibleCount:target.emailRecipients.length,
      recipientMode:target.mode,
    });
  } catch(error) { logger.error("[ContentCampaign] preview:",error.message); if(error.status) return res.status(error.status).json({success:false,error:error.message}); next(error); }
};

exports.send = async (req,res,next) => {
  try {
    await ensureSchema();
    await campaignTemplates.ensureSchema();
    const payload = req.body || {};
    const templateKey = String(payload.templateKey || payload.template?.key || "").trim();
    const allTemplates = templateKey ? await campaignTemplates.listTemplates() : [];
    const savedTemplate = allTemplates.find((entry) => entry.key === templateKey) || {};
    const template = {...savedTemplate,...(payload.template || {})};
    const subject = String(template.subject || payload.subject || "").trim();
    const body = String(template.body || payload.body || "").trim();
    const context = String(template.context || payload.context || "general").trim();
    const channels = {email:payload.channels?.email !== false,inApp:payload.channels?.inApp !== false};
    if (!subject || subject.length>200) return res.status(422).json({success:false,error:"Provide an email subject of 1–200 characters."});
    if (!body) return res.status(422).json({success:false,error:"Write a message before sending."});
    if (!channels.email && !channels.inApp) return res.status(422).json({success:false,error:"Choose email, in-app, or both."});
    if (channels.email && typeof emailService.sendEmail !== "function") return res.status(503).json({success:false,error:"Email delivery is not configured."});

    const target = await resolveTarget(payload);
    const emailRecipients = channels.email ? target.emailRecipients : [];
    const userIds = channels.inApp ? target.userIds : [];
    if (!emailRecipients.length && !userIds.length) return res.status(422).json({success:false,error:"No recipients match the selected audience and delivery channels."});

    const refs = Array.isArray(payload.contentItems) ? payload.contentItems.slice(0,12) : [];
    const contentItems = [];
    for (const ref of refs) {
      const type = String(ref?.type || "").toLowerCase();
      if (type && ref?.id) {
        const item = await getContentItem(type,ref.id);
        if (item) contentItems.push(item);
      }
    }
    const contextData = payload.contextData && typeof payload.contextData === "object" ? {...payload.contextData} : {};
    if (contentItems.length) {
      const first = contentItems[0];
      contextData.contentItems = contentItems;
      contextData.destinationName = contentItems.find((item)=>item.type==="destination")?.title || contextData.destinationName;
      contextData.countryName = contentItems.find((item)=>item.type==="country")?.title || contextData.countryName;
      contextData.packageName = contentItems.find((item)=>item.type==="package")?.title || contextData.packageName;
      contextData.postTitle = contentItems.find((item)=>item.type==="post")?.title || contextData.postTitle;
      contextData.contentUrl = contextData.contentUrl || first.contentUrl;
      contextData.shortDescription = contextData.shortDescription || first.description;
    }
    const rawGallery = Array.isArray(payload.mediaGallery) ? payload.mediaGallery : [];
    const mediaGallery = rawGallery.map((entry) => {
      const url = String(typeof entry === "string" ? entry : entry?.url || "").trim();
      if (!/^https:\/\//i.test(url)) return null;
      const fromItem = contentItems.flatMap((item)=>item.images || []).find((image)=>image.url===url);
      return {
        url,
        alt:String(typeof entry==="object" ? entry.alt || entry.title || fromItem?.alt || "Altuvera Safaris" : fromItem?.alt || "Altuvera Safaris"),
        title:String(typeof entry==="object" ? entry.title || entry.caption || "" : ""),
        caption:String(typeof entry==="object" ? entry.caption || entry.title || "" : ""),
        contentUrl:contentItems.find((item)=>item.images?.some((image)=>image.url===url))?.contentUrl || contextData.contentUrl,
      };
    }).filter(Boolean).slice(0,10);
    contextData.mediaGallery = mediaGallery;
    if (!contextData.heroImageUrl && mediaGallery[0]) contextData.heroImageUrl = mediaGallery[0].url;
    const notificationTitle = String(campaignTemplates.personalise(payload.notificationTitle || template.headline || subject,{name:"traveller"},contextData)).trim().slice(0,120);
    const notificationMessage = String(campaignTemplates.personalise(payload.notificationMessage || body,{name:"traveller"},contextData)).trim().slice(0,1800);
    const actionUrl = String(contextData.contentUrl || template.cta_url || FRONTEND_URL + "/destinations");
    const notificationImage = mediaGallery[0]?.url || contextData.heroImageUrl || null;
    const optedInUserIds = new Set(emailRecipients.map((recipient) => Number(recipient.user_id)).filter((id) => Number.isSafeInteger(id) && id > 0));
    const skippedForEmailConsent = channels.email
      ? target.users.filter((user) => !optedInUserIds.has(Number(user.id))).length
      : 0;

    let sent=0, failed=0;
    const errors=[];
    for (const recipient of emailRecipients) {
      const recipientSubject = campaignTemplates.personalise(subject,recipient,contextData).slice(0,200);
      const html = campaignTemplates.renderHtml({
        subject:recipientSubject,
        body,
        template:{
          ...template,
          subject,
          body,
          hero_image_url:template.hero_image_url || contextData.heroImageUrl || "",
          cta_url:template.cta_url || actionUrl,
        },
        recipient,
        context:contextData,
      });
      try {
        const result = await emailService.sendEmail(recipient.email,recipientSubject,html,{
          recipientName:recipient.name || "",
          recipientEmail:recipient.email,
          recipientAvatarUrl:recipient.avatar_url || "",
        });
        if (result?.success === false || result?.delivered === false) {
          failed += 1;
          if (errors.length<8) errors.push({email:recipient.email,error:result.error || "Email delivery failed"});
        } else sent += 1;
      } catch(error) {
        failed += 1;
        if (errors.length<8) errors.push({email:recipient.email,error:error.message});
      }
      if (emailRecipients.length>10) await new Promise((resolve)=>setTimeout(resolve,90));
    }

    let inAppSent=0, inAppFailed=0;
    if (channels.inApp && target.mode==="all") {
      try {
        await createNotificationInternal({
          type:"travel_update",category:"travel_updates",title:notificationTitle,message:notificationMessage,
          actionUrl,actionLabel:String(payload.notificationActionLabel || template.cta_label || "Explore update").slice(0,80),
          imageUrl:notificationImage,priority:String(payload.priority || "normal"),targetScope:"all",
          senderType:"admin",senderName:"Altuvera Safaris",
          metadata:{campaign:true,context,contentItems:contentItems.map(({id,type,title,contentUrl})=>({id,type,title,contentUrl})),imageCount:mediaGallery.length},
          req,skipUserEmail:true,
        });
        inAppSent=target.userIds.length;
      } catch(error) { inAppFailed=target.userIds.length; logger.warn("[ContentCampaign] all-user notification failed:",error.message); }
    } else if (channels.inApp && userIds.length) {
      for (let i=0;i<userIds.length;i+=8) {
        const outcomes=await Promise.allSettled(userIds.slice(i,i+8).map(async(userId)=>{
          const user=target.users.find((entry)=>Number(entry.id)===Number(userId));
          await createNotificationInternal({
            userId,userEmail:user?.email || null,
            type:"travel_update",category:"travel_updates",title:notificationTitle,message:notificationMessage,
            actionUrl,actionLabel:String(payload.notificationActionLabel || template.cta_label || "Explore update").slice(0,80),
            imageUrl:notificationImage,priority:String(payload.priority || "normal"),targetScope:"individual",
            senderType:"admin",senderName:"Altuvera Safaris",
            metadata:{campaign:true,context,contentItems:contentItems.map(({id,type,title,contentUrl})=>({id,type,title,contentUrl})),imageCount:mediaGallery.length},
            req,skipUserEmail:true,
          });
        }));
        outcomes.forEach((outcome)=>outcome.status==="fulfilled" ? inAppSent++ : inAppFailed++);
      }
    }

    await campaignTemplates.logCampaign({
      templateKey,context,subject,audience:target.mode,total:Math.max(emailRecipients.length,userIds.length),sent,failed,
      details:{
        recipientMode:target.mode,emailRecipients:emailRecipients.length,inAppRecipients:userIds.length,
        inAppSent,inAppFailed,emailSkippedForConsent:skippedForEmailConsent,
        contentItems:contentItems.map(({id,type,title,contentUrl})=>({id,type,title,contentUrl})),
        imageCount:mediaGallery.length,channels,errors,
      },
    });
    return res.json({
      success:true,
      message:"Campaign sent. "+sent+" email(s) delivered and "+inAppSent+" in-app notification(s) created.",
      sent,failed,total:emailRecipients.length,inAppSent,inAppFailed,
      selectedUsers:target.userIds.length,emailEligible:emailRecipients.length,
      skippedForEmailConsent,
      recipientMode:target.mode,context,templateKey:templateKey || null,errors:failed ? errors : undefined,
    });
  } catch(error) {
    logger.error("[ContentCampaign] send:",error.message);
    if(error.status) return res.status(error.status).json({success:false,error:error.message});
    next(error);
  }
};

module.exports = exports;
