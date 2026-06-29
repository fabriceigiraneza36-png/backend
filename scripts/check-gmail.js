// scripts/check-gmail.js
"use strict";

require("dotenv").config();

const https = require("https");
const net   = require("net");
const tls   = require("tls");

const user = process.env.SMTP_USER || "";
const pass = process.env.SMTP_PASS || "";

console.log("\n══════════════════════════════════════════");
console.log("  Gmail SMTP Deep Diagnostic");
console.log("══════════════════════════════════════════\n");

// ── 1. Check TCP connectivity to smtp.gmail.com:587 ──────────────────────────
console.log("Test 1: TCP connection to smtp.gmail.com:587 …");

const sock = new net.Socket();
sock.setTimeout(8000);

sock.connect(587, "smtp.gmail.com", () => {
  console.log("✅ TCP connection established\n");
  sock.destroy();
  runSmtpHandshake();
});

sock.on("timeout", () => {
  console.error("❌ TCP connection TIMED OUT — port 587 may be blocked on your network\n");
  sock.destroy();
  process.exit(1);
});

sock.on("error", (err) => {
  console.error(`❌ TCP connection FAILED: ${err.message}\n`);
  process.exit(1);
});

// ── 2. Manual SMTP handshake to get exact server response ────────────────────
function runSmtpHandshake() {
  console.log("Test 2: Manual SMTP EHLO + AUTH LOGIN handshake …\n");

  const client = new net.Socket();
  const lines  = [];
  let   state  = "connect";
  let   upgraded = false;

  const send = (cmd) => {
    console.log(`  → ${cmd.replace(/\n/, "").trim()}`);
    client.write(cmd + "\r\n");
  };

  client.setTimeout(10000);
  client.connect(587, "smtp.gmail.com");

  client.on("data", (data) => {
    const text = data.toString();
    const clean = text.trim();
    console.log(`  ← ${clean.split("\n").join("\n     ")}`);

    if (state === "connect" && clean.startsWith("220")) {
      state = "ehlo";
      send("EHLO localhost");
      return;
    }

    if (state === "ehlo" && clean.includes("250")) {
      if (clean.includes("STARTTLS") && !upgraded) {
        state = "starttls";
        send("STARTTLS");
        return;
      }
      state = "auth";
      send("AUTH LOGIN");
      return;
    }

    if (state === "starttls" && clean.startsWith("220")) {
      // Upgrade to TLS
      upgraded = true;
      const tlsSock = tls.connect({
        socket: client,
        host:   "smtp.gmail.com",
        rejectUnauthorized: false,
      });
      tlsSock.on("secure", () => {
        console.log("  ✅ TLS upgrade successful");
        state = "ehlo2";
        tlsSock.write("EHLO localhost\r\n");
      });
      tlsSock.on("data", (d) => {
        const t2 = d.toString().trim();
        console.log(`  ← ${t2.split("\n").join("\n     ")}`);

        if (state === "ehlo2" && t2.includes("250")) {
          state = "auth";
          tlsSock.write("AUTH LOGIN\r\n");
          return;
        }
        if (state === "auth" && t2.startsWith("334")) {
          state = "user";
          tlsSock.write(Buffer.from(user).toString("base64") + "\r\n");
          return;
        }
        if (state === "user" && t2.startsWith("334")) {
          state = "pass";
          tlsSock.write(Buffer.from(pass).toString("base64") + "\r\n");
          return;
        }
        if (state === "pass") {
          console.log("");
          if (t2.startsWith("235")) {
            console.log("✅ AUTH SUCCESS — credentials accepted by Gmail!\n");
            console.log("Your SMTP credentials are valid.");
            console.log("The issue must be in the Node.js transporter config.\n");
          } else if (t2.includes("535")) {
            console.log("❌ AUTH FAILED (535) — Gmail rejected username/password\n");
            analyseAuthFailure(t2);
          } else {
            console.log(`⚠️  Unexpected response: ${t2}\n`);
          }
          tlsSock.destroy();
          client.destroy();
          process.exit(0);
        }
      });
      tlsSock.on("error", (e) => {
        console.error(`❌ TLS error: ${e.message}`);
        process.exit(1);
      });
      return;
    }

    if (!upgraded) {
      if (state === "auth" && clean.startsWith("334")) {
        state = "user";
        send(Buffer.from(user).toString("base64"));
        return;
      }
      if (state === "user" && clean.startsWith("334")) {
        state = "pass";
        send(Buffer.from(pass).toString("base64"));
        return;
      }
      if (state === "pass") {
        console.log("");
        if (clean.startsWith("235")) {
          console.log("✅ AUTH SUCCESS!\n");
        } else if (clean.includes("535")) {
          console.log("❌ AUTH FAILED (535)\n");
          analyseAuthFailure(clean);
        }
        client.destroy();
        process.exit(0);
      }
    }
  });

  client.on("timeout", () => {
    console.error("\n❌ Handshake timed out");
    client.destroy();
    process.exit(1);
  });

  client.on("error", (err) => {
    console.error(`\n❌ Socket error: ${err.message}`);
    process.exit(1);
  });
}

function analyseAuthFailure(response) {
  console.log("Diagnosis:");

  if (response.includes("BadCredentials")) {
    console.log("  → Google URL: https://support.google.com/mail/?p=BadCredentials");
    console.log("  → This means the App Password is INVALID or REVOKED.");
    console.log("");
    console.log("  Checklist:");
    console.log("  [ ] Is 2FA enabled? → https://myaccount.google.com/security");
    console.log("  [ ] Was the App Password recently regenerated?");
    console.log("  [ ] Is the account a Google Workspace account (managed)?");
    console.log("      If yes → admin must enable App Passwords in admin.google.com");
    console.log("  [ ] Did you copy the password WITHOUT spaces?");
    console.log("      Google shows: 'abcd efgh ijkl mnop'");
    console.log("      Store as:     'abcdefghijklmnop'");
    console.log("");
    console.log(`  Account being tested: ${user}`);
    console.log(`  Password length: ${pass.length} chars`);
    console.log(`  Password ends: …${pass.slice(-4)}`);
  }
}