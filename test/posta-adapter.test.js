"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../utils/posta");

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("Posta accepts only HTTPS endpoints outside localhost", () => {
  assert.doesNotThrow(() => createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => response(200, { success: true, data: { id: "m-1", status: "queued" } }),
  }));
  assert.doesNotThrow(() => createClient({
    baseUrl: "http://localhost:9000",
    apiKey: "test-only-key",
    fetchImpl: async () => response(200, { success: true, data: { id: "m-1", status: "queued" } }),
  }));
  assert.throws(() => createClient({
    baseUrl: "http://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => response(200, {}),
  }), /must use HTTPS/);
});

test("Posta sends through the documented API and returns its queue ID", async () => {
  let captured;
  const client = createClient({
    baseUrl: "https://posta.example.test/",
    apiKey: "test-only-key",
    fetchImpl: async (url, options) => {
      captured = { url, options, payload: JSON.parse(options.body) };
      return response(200, { success: true, data: { id: "posta-message-123", status: "queued" } });
    },
  });

  const result = await client.send({
    to: "recipient@example.net",
    subject: "Test only",
    html: "<p>Test</p>",
    text: "Test",
    from: "Altuvera Safaris <info@altuverasafaris.com>",
    replyTo: "support@example.net",
  });

  assert.equal(captured.url, "https://posta.example.test/api/v1/emails/send");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer test-only-key");
  assert.equal(captured.payload.to[0], "recipient@example.net");
  assert.equal(captured.payload.headers["Reply-To"], "support@example.net");
  assert.equal(result.messageId, "posta-message-123");
  assert.equal(result.provider, "posta");
  assert.equal(result.providerStatus, "queued");
});

test("Posta adapter refuses CC/BCC rather than silently dropping recipient semantics", async () => {
  let networkCalls = 0;
  const client = createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => {
      networkCalls += 1;
      return response(200, {});
    },
  });

  await assert.rejects(
    client.send({ to: "recipient@example.net", subject: "Test", text: "Hello", bcc: "hidden@example.net" }),
    /does not support CC\/BCC/,
  );
  assert.equal(networkCalls, 0);
});

test("Posta 429 is a definitive transient rejection; 5xx and network errors remain uncertain", async () => {
  const rateLimited = createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => response(429, { success: false, message: "Rate limited" }),
  });
  await assert.rejects(
    rateLimited.send({ to: "recipient@example.net", subject: "Test", text: "Hello" }),
    (error) => {
      assert.equal(error.provider, "posta");
      assert.equal(error.statusCode, 429);
      assert.equal(error.definitiveRejected, true);
      assert.equal(error.retryable, true);
      assert.equal(error.providerFailoverEligible, true);
      assert.equal(error.deliveryUnknown, false);
      return true;
    },
  );

  const unavailable = createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => response(503, { success: false, message: "Unavailable" }),
  });
  await assert.rejects(
    unavailable.send({ to: "recipient@example.net", subject: "Test", text: "Hello" }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.deliveryUnknown, true);
      assert.equal(error.idempotentRetrySafe, false);
      assert.equal(error.providerFailoverEligible, false);
      return true;
    },
  );

  const requestTimeout = createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => response(408, { success: false, message: "Request timeout" }),
  });
  await assert.rejects(
    requestTimeout.send({ to: "recipient@example.net", subject: "Test", text: "Hello" }),
    (error) => {
      assert.equal(error.statusCode, 408);
      assert.equal(error.deliveryUnknown, true);
      assert.equal(error.idempotentRetrySafe, false);
      assert.equal(error.providerFailoverEligible, false);
      return true;
    },
  );

  const networkFailure = createClient({
    baseUrl: "https://posta.example.test",
    apiKey: "test-only-key",
    fetchImpl: async () => { throw new Error("socket timeout"); },
  });
  await assert.rejects(
    networkFailure.send({ to: "recipient@example.net", subject: "Test", text: "Hello" }),
    (error) => {
      assert.equal(error.deliveryUnknown, true);
      assert.equal(error.idempotentRetrySafe, false);
      assert.equal(error.providerFailoverEligible, false);
      return true;
    },
  );
});
