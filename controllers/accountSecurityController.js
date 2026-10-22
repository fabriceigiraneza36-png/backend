"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");
const { sendEmail } = require("../utils/email");
const jwt = require("jsonwebtoken");
const { encryptSecret, decryptSecret } = require("../utils/accountSecurityCrypto");

const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32Encode = (buf) => {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += b32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += b32[(value << (5 - bits)) & 31];
  return out;
};
const base32Decode = (str) => {
  let bits = 0, value = 0; const out = [];
  for (const char of String(str).toUpperCase().replace(/=+$/,"")) {
    const n = b32.indexOf(char); if (n < 0) throw new Error("Invalid authenticator secret");
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
const hotp = (secret, counter) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};
const verifyTotp = (secret, code) => {
  const now = Math.floor(Date.now() / 30000);
  const supplied = Buffer.from(String(code || ""));
  return /^\d{6}$/.test(String(code || "")) && [-1,0,1].some((delta) => {
    const expected = Buffer.from(hotp(secret, now + delta));
    return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
  });
};
const hash = (s) => crypto.createHmac("sha256", String(process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY || process.env.JWT_SECRET || "")).update(String(s)).digest("hex");
// Ten 5-digit numeric codes as requested. Five digits are low entropy, so each
// code is single-use, stored only as a hash, and protected by strict rate limits.
const createRecoveryCodes = () => {
  const used = new Set();
  while (used.size < 10) used.add(String(crypto.randomInt(0, 100000)).padStart(5, "0"));
  return [...used];
};
const fail = (res, status, message) => res.status(status).json({success:false,message});

exports.status = async (req,res) => {
  try {
    const r = await query("SELECT totp_enabled, passkey_count, recovery_codes_remaining FROM user_security WHERE user_id=$1",[req.user.id]);
    const s = r.rows[0] || {};
    return res.json({success:true,data:{authenticatorEnabled:!!s.totp_enabled,passkeys:Number(s.passkey_count||0),recoveryCodesRemaining:Number(s.recovery_codes_remaining||0),emailOtpEnabled:true}});
  } catch(e) { return fail(res,500,"Security settings are temporarily unavailable."); }
};

exports.beginTotp = async (req,res) => {
  try {
    const secret = base32Encode(crypto.randomBytes(20));
    await query(`INSERT INTO user_security(user_id,totp_pending_secret,totp_pending_expires)
      VALUES($1,$2,NOW()+INTERVAL '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET totp_pending_secret=EXCLUDED.totp_pending_secret,totp_pending_expires=EXCLUDED.totp_pending_expires`,[req.user.id,encryptSecret(secret)]);
    const u = await query("SELECT email FROM users WHERE id=$1",[req.user.id]);
    const label = encodeURIComponent(u.rows[0]?.email || "Altuvera account");
    return res.json({success:true,data:{secret,otpauthUrl:`otpauth://totp/Altuvera:${label}?secret=${secret}&issuer=Altuvera&algorithm=SHA1&digits=6&period=30`,expiresInSeconds:600}});
  } catch(e) { return fail(res,500,"Could not start authenticator setup."); }
};

exports.confirmTotp = async (req,res) => {
  try {
    const code = String(req.body.code || "");
    if (!/^\d{6}$/.test(code)) return fail(res,400,"Enter the 6-digit authenticator code.");
    const r = await query("SELECT totp_pending_secret,totp_pending_expires FROM user_security WHERE user_id=$1",[req.user.id]);
    const row = r.rows[0];
    if (!row?.totp_pending_secret || !row.totp_pending_expires || new Date(row.totp_pending_expires) < new Date()) return fail(res,400,"Authenticator setup expired. Start again.");
    if (!verifyTotp(decryptSecret(row.totp_pending_secret),code)) return fail(res,401,"That authenticator code is not valid.");
    await query(`UPDATE user_security SET totp_secret=totp_pending_secret,totp_enabled=true,totp_pending_secret=NULL,totp_pending_expires=NULL,updated_at=NOW() WHERE user_id=$1`,[req.user.id]);
    return res.json({success:true,message:"Authenticator app enabled."});
  } catch(e) { return fail(res,500,"Could not verify authenticator code."); }
};

exports.disableTotp = async (req,res) => {
  try {
    const code = String(req.body.code || "");
    const r = await query("SELECT totp_secret,totp_enabled FROM user_security WHERE user_id=$1",[req.user.id]);
    const row = r.rows[0];
    if (!row?.totp_enabled || !verifyTotp(decryptSecret(row.totp_secret),code)) return fail(res,401,"A valid authenticator code is required.");
    await query("UPDATE user_security SET totp_secret=NULL,totp_enabled=false,updated_at=NOW() WHERE user_id=$1",[req.user.id]);
    return res.json({success:true,message:"Authenticator app disabled."});
  } catch(e) { return fail(res,500,"Could not disable authenticator."); }
};

exports.rotateRecoveryCodes = async (req,res) => {
  try {
    const code = String(req.body.code || "");
    const r = await query("SELECT totp_secret,totp_enabled FROM user_security WHERE user_id=$1",[req.user.id]);
    if (r.rows[0]?.totp_enabled && !verifyTotp(decryptSecret(r.rows[0].totp_secret),code)) return fail(res,401,"Verify with your authenticator before rotating recovery codes.");
    const codes = createRecoveryCodes();
    await query(`INSERT INTO user_security(user_id,recovery_code_hashes,recovery_codes_remaining)
      VALUES($1,$2::jsonb,$3) ON CONFLICT(user_id) DO UPDATE SET recovery_code_hashes=EXCLUDED.recovery_code_hashes,recovery_codes_remaining=EXCLUDED.recovery_codes_remaining,updated_at=NOW()`,[req.user.id,JSON.stringify(codes.map(hash)),codes.length]);
    return res.json({success:true,message:"Store these recovery codes somewhere safe. They are shown only once.",data:{codes}});
  } catch(e) { return fail(res,500,"Could not generate recovery codes."); }
};

exports.verifyFactor = async (req,res) => {
  try {
    const { method, code } = req.body || {};
    if (!code || !["totp","recovery_code"].includes(method)) return fail(res,400,"Choose a supported factor and provide its code.");
    const r = await query("SELECT totp_secret,totp_enabled,recovery_code_hashes FROM user_security WHERE user_id=$1",[req.user.id]);
    const s = r.rows[0];
    if (method === "totp" && s?.totp_enabled && verifyTotp(decryptSecret(s.totp_secret),code)) return res.json({success:true,verified:true});
    if (method === "recovery_code" && /^\d{5}$/.test(String(code)) && Array.isArray(s?.recovery_code_hashes)) {
      const candidate = hash(String(code));
      const idx = s.recovery_code_hashes.indexOf(candidate);
      if (idx >= 0) {
        // Consume the code atomically in PostgreSQL so simultaneous requests
        // cannot redeem the same one-time recovery code twice.
        const consumed = await query(`UPDATE user_security
          SET recovery_code_hashes = recovery_code_hashes - (
            SELECT ordinality - 1
              FROM jsonb_array_elements_text(recovery_code_hashes) WITH ORDINALITY
             WHERE value = $1 LIMIT 1
          ),
          recovery_codes_remaining = GREATEST(0, recovery_codes_remaining - 1),
          updated_at = NOW()
          WHERE user_id = $2 AND recovery_code_hashes @> jsonb_build_array($1)
          RETURNING recovery_codes_remaining`,[candidate,req.user.id]);
        if (consumed.rowCount !== 1) return fail(res,401,"Verification failed.");
        return res.json({success:true,verified:true,remaining:Number(consumed.rows[0].recovery_codes_remaining)});
      }
    }
    return fail(res,401,"Verification failed.");
  } catch(e) { return fail(res,500,"Could not verify this factor."); }
};

// Recovery requests never disclose whether an email is registered. A recovery request
// opens a manual support review; it does not grant access or bypass enrolled factors.
exports.requestRecovery = async (req,res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const contactEmail = String(req.body.recoveryContactEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res,400,"Enter a valid email address.");
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail(res,400,"Enter a valid alternate contact email.");
    const r = await query("SELECT id,email,full_name FROM users WHERE email=$1 AND is_active=true",[email]);
    if (r.rows[0]) {
      const ticket = crypto.randomBytes(24).toString("hex");
      await query(`CREATE TABLE IF NOT EXISTS account_recovery_requests(
        id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL,expires_at TIMESTAMPTZ NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await query("INSERT INTO account_recovery_requests(user_id,token_hash,expires_at,recovery_contact_email) VALUES($1,$2,NOW()+INTERVAL '24 hours',$3)",[r.rows[0].id,hash(ticket),contactEmail||null]);
      const support = process.env.ACCOUNT_RECOVERY_EMAIL || process.env.SUPPORT_EMAIL;
      if (support) await sendEmail({to:support,subject:"Altuvera account recovery review",text:`Recovery review requested for user ${r.rows[0].id} (${email}). Reference: ${ticket}. Verify identity manually before making changes.`}).catch(()=>{});
    }
    return res.json({success:true,message:"If the account is eligible, the Altuvera team will review the recovery request. This does not sign you in."});
  } catch(e) { return fail(res,500,"Recovery request could not be submitted."); }
};

exports._test = {base32Encode,base32Decode,hotp,verifyTotp,hash,createRecoveryCodes};


// Admin-only manual recovery queue. A review decision is audited and never
// silently signs a user in or disables an enrolled factor.
const ensureRecoveryReviewSchema = async () => {
  await query(`CREATE TABLE IF NOT EXISTS account_recovery_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_note TEXT
  )`);
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS review_note TEXT");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS recovery_contact_email VARCHAR(320)");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS verified_contact_email VARCHAR(320)");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS completion_token_hash CHAR(64)");
  await query("ALTER TABLE account_recovery_requests ADD COLUMN IF NOT EXISTS completion_expires_at TIMESTAMPTZ");
  await query(`CREATE TABLE IF NOT EXISTS account_security_audit (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
};

exports.listRecoveryRequests = async (req,res) => {
  try {
    await ensureRecoveryReviewSchema();
    const r = await query(`SELECT r.id,r.user_id,u.email,u.full_name,r.status,r.created_at,
        r.expires_at,r.reviewed_at,r.reviewed_by,r.review_note,r.recovery_contact_email,r.verified_contact_email,r.completion_expires_at
      FROM account_recovery_requests r JOIN users u ON u.id=r.user_id
      WHERE r.expires_at > NOW() OR r.status='pending'
      ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC
      LIMIT 100`);
    return res.json({success:true,data:r.rows});
  } catch(e) { return fail(res,500,"Recovery review queue is temporarily unavailable."); }
};

exports.reviewRecoveryRequest = async (req,res) => {
  try {
    const requestId=String(req.params.id||"");
    const decision=String(req.body.status||"");
    const note=String(req.body.note||"").trim().slice(0,1000);
    if(!/^\d+$/.test(requestId)||!["approved","rejected"].includes(decision)) return fail(res,400,"Choose an approved or rejected decision for a valid request.");
    if(!note) return fail(res,400,"A review note is required for the audit trail.");
    await ensureRecoveryReviewSchema();
    const current=await query("SELECT id,user_id,recovery_contact_email FROM account_recovery_requests WHERE id=$1 AND status='pending' AND expires_at>NOW()",[requestId]);
    if(!current.rows[0]) return fail(res,409,"Request is unavailable, expired, or already reviewed.");
    const item=current.rows[0];
    let contactEmail=null, token=null, expiresAt=null;
    if(decision==="approved") {
      contactEmail=String(req.body.verifiedContactEmail||item.recovery_contact_email||"").trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail(res,400,"A verified alternate email is required to approve recovery.");
      token=crypto.randomBytes(32).toString("hex");
      const saved=await query("UPDATE account_recovery_requests SET status='approved',reviewed_at=NOW(),reviewed_by=$1,review_note=$2,verified_contact_email=$3,completion_token_hash=$4,completion_expires_at=NOW()+INTERVAL '30 minutes' WHERE id=$5 AND status='pending' RETURNING id,user_id,status",[req.user.id,note,contactEmail,hash(token),requestId]);
      if(!saved.rows[0]) return fail(res,409,"Request was already reviewed.");
      const base=process.env.FRONTEND_URL||"https://www.altuverasafaris.com";
      const link=new URL("/account/recovery/complete",base);
      link.searchParams.set("request",requestId); link.searchParams.set("token",token);
      try {
        await sendEmail({to:contactEmail,subject:"Altuvera account recovery link",text:"Your Altuvera account recovery request was approved after manual review. This one-time link expires in 30 minutes and will replace the account email with this verified address, remove existing passkeys/authenticator factors, and revoke active sessions:\n\n"+link.toString()+"\n\nIf you did not request recovery, contact Altuvera support immediately."});
      } catch(e) {
        await query("UPDATE account_recovery_requests SET status='pending',reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,verified_contact_email=NULL,completion_token_hash=NULL,completion_expires_at=NULL WHERE id=$1 AND completion_token_hash=$2",[requestId,hash(token)]).catch(()=>{});
        return fail(res,503,"Recovery email could not be sent. The request remains pending.");
      }
    } else {
      const saved=await query("UPDATE account_recovery_requests SET status='rejected',reviewed_at=NOW(),reviewed_by=$1,review_note=$2 WHERE id=$3 AND status='pending' RETURNING id,user_id,status",[req.user.id,note,requestId]);
      if(!saved.rows[0]) return fail(res,409,"Request was already reviewed.");
    }
    await query("INSERT INTO account_security_audit(actor_user_id,subject_user_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)",[req.user.id,item.user_id,"account_recovery_review",JSON.stringify({requestId:item.id,decision,note,verifiedContactEmail:contactEmail})]);
    return res.json({success:true,message:decision==="approved"?"Recovery link sent to the manually verified alternate email.":"Recovery request rejected.",data:{id:Number(requestId),status:decision}});
  } catch(e) { return fail(res,500,"Could not record the recovery review."); }
};

exports.completeRecovery = async (req,res) => {
  try {
    const requestId=String(req.body.requestId||"");
    const token=String(req.body.token||"");
    const email=String(req.body.email||"").trim().toLowerCase();
    if(!/^\d+$/.test(requestId)||! /^[a-f0-9]{64}$/i.test(token)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail(res,400,"The recovery link or email is invalid.");
    await ensureRecoveryReviewSchema();
    await query("CREATE TABLE IF NOT EXISTS user_passkeys (id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,credential_id TEXT NOT NULL UNIQUE,public_key BYTEA NOT NULL,counter BIGINT NOT NULL DEFAULT 0,transports JSONB NOT NULL DEFAULT '[]'::jsonb,device_name VARCHAR(120) NOT NULL DEFAULT 'Passkey',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_used_at TIMESTAMPTZ)");
    await query("CREATE TABLE IF NOT EXISTS webauthn_challenges (id BIGSERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,purpose VARCHAR(24) NOT NULL CHECK(purpose IN ('registration','login')),challenge TEXT NOT NULL,login_challenge_hash CHAR(64),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const completed=await query("WITH claimed AS (UPDATE account_recovery_requests SET status='completed',completion_token_hash=NULL,completion_expires_at=NULL WHERE id=$1 AND status='approved' AND completion_token_hash=$2 AND completion_expires_at>NOW() AND verified_contact_email=$3 RETURNING user_id,verified_contact_email), changed_user AS (UPDATE users SET email=(SELECT verified_contact_email FROM claimed),is_verified=true,verification_code=NULL,code_expiry=NULL,code_attempts=0,token_version=COALESCE(token_version,0)+1 WHERE id=(SELECT user_id FROM claimed) RETURNING id,email), reset_security AS (UPDATE user_security SET totp_secret=NULL,totp_enabled=false,totp_pending_secret=NULL,totp_pending_expires=NULL,recovery_code_hashes='[]'::jsonb,recovery_codes_remaining=0,passkey_count=0,updated_at=NOW() WHERE user_id=(SELECT id FROM changed_user) RETURNING user_id), removed_passkeys AS (DELETE FROM user_passkeys WHERE user_id=(SELECT id FROM changed_user) RETURNING id), deleted_factor AS (DELETE FROM login_factor_challenges WHERE user_id=(SELECT id FROM changed_user) RETURNING id), deleted_webauthn AS (DELETE FROM webauthn_challenges WHERE user_id=(SELECT id FROM changed_user) RETURNING id), audit AS (INSERT INTO account_security_audit(actor_user_id,subject_user_id,event_type,details) SELECT NULL,id,'account_recovery_completed',jsonb_build_object('newEmail',email) FROM changed_user RETURNING id) SELECT id,email FROM changed_user",[requestId,hash(token),email]);
    if(!completed.rows[0]) return fail(res,401,"This recovery link is invalid, expired, or already used.");
    return res.json({success:true,message:"Account recovery completed. Your email has been updated, old security factors and sessions have been revoked. Sign in using the new email address and verify the code sent to it."});
  } catch(e) { return fail(res,500,"Account recovery could not be completed. Contact Altuvera support."); }
};

exports.revokeSessions = async (req,res) => {
  try {
    const r=await query("UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=$1 RETURNING id",[req.user.id]);
    if(!r.rows[0]) return fail(res,404,"Account not found.");
    await query("DELETE FROM login_factor_challenges WHERE user_id=$1",[req.user.id]).catch(()=>{});
    await query("INSERT INTO account_security_audit(actor_user_id,subject_user_id,event_type,details) VALUES($1,$1,'sessions_revoked','{}'::jsonb)",[req.user.id]).catch(()=>{});
    return res.json({success:true,message:"All active sessions have been revoked. Sign in again on this device and any other devices."});
  } catch(e) { return fail(res,500,"Could not revoke active sessions."); }
};
