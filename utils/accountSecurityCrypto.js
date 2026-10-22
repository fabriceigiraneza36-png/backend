"use strict";
const crypto=require("crypto");
const key=()=>crypto.createHash("sha256").update(String(process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY||process.env.JWT_SECRET||"")).digest();
exports.encryptSecret=(plain)=>{
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);
  const encrypted=Buffer.concat([cipher.update(String(plain),"utf8"),cipher.final()]);
  return "enc:v1:"+iv.toString("base64url")+":"+cipher.getAuthTag().toString("base64url")+":"+encrypted.toString("base64url");
};
exports.decryptSecret=(value)=>{
  const text=String(value||"");
  if(!text.startsWith("enc:v1:")) return text; // transparently support legacy rows during migration
  const parts=text.split(":");
  if(parts.length!==5) throw new Error("Invalid encrypted account-security secret");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(parts[2],"base64url"));
  decipher.setAuthTag(Buffer.from(parts[3],"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[4],"base64url")),decipher.final()]).toString("utf8");
};
