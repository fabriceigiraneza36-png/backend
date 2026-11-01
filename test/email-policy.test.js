"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isSafeProviderFailover } = require("../utils/emailPolicy");

test("HTTP providers fail over only on explicit transient rejection", () => {
  for (const provider of ["resend", "sendgrid", "posta"]) {
    assert.equal(isSafeProviderFailover(provider, 429), true, provider + " 429");
    for (const status of [0, 400, 401, 403, 404, 408, 422, 500, 502, 503]) {
      assert.equal(isSafeProviderFailover(provider, status), false, provider + " " + status);
    }
  }
});

test("SMTP failover is restricted to transient 4xx response codes", () => {
  for (const status of [421, 450, 451, 452, 454]) {
    assert.equal(isSafeProviderFailover("smtp", status), true, "SMTP " + status);
  }
  for (const status of [0, 400, 4500, 500, 535, 550, 554]) {
    assert.equal(isSafeProviderFailover("smtp", status), false, "SMTP " + status);
  }
});

test("unknown providers and unknown outcomes never fail over", () => {
  for (const status of [408, 429, 450, 451]) {
    assert.equal(isSafeProviderFailover("unknown", status), false);
  }
  assert.equal(isSafeProviderFailover("resend", undefined), false);
  assert.equal(isSafeProviderFailover("sendgrid", null), false);
});
