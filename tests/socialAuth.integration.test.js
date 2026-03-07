const request = require("supertest");

jest.mock("../config/db", () => ({
  query: jest.fn(),
}));

jest.mock("../utils/email", () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
}));

jest.mock("../utils/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
});

const buildApp = () => {
  jest.resetModules();

  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.GITHUB_CLIENT_ID = "test-gh-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-gh-client-secret";
  process.env.SOCIAL_AUTH_TIMEOUT_MS = "5";

  const express = require("express");
  const usersRoutes = require("../routes/users");
  const { query } = require("../config/db");

  const app = express();
  app.use(express.json());
  app.use("/users", usersRoutes);
  return { app, query };
};

describe("Social Auth Integration - GitHub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("returns success with token/user payload", async () => {
    const { app, query } = buildApp();

    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gh_access_token" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 12345,
          login: "octocat",
          name: "Octo Cat",
          email: "octo@example.com",
          avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
        }),
      );

    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            email: "octo@example.com",
            full_name: "Octo Cat",
            avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
            github_id: "12345",
            auth_provider: "github",
            is_verified: true,
            is_active: true,
            role: "user",
          },
        ],
      });

    const res = await request(app).post("/users/github").send({ code: "valid_code" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("token");
    expect(res.body.data).toHaveProperty("refreshToken");
    expect(res.body.data.user.email).toBe("octo@example.com");
    expect(res.body.data.user.auth_provider).toBe("github");
    expect(res.body.data.user.github_id).toBeUndefined();
    expect(res.body.data.isNewUser).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when GitHub profile has no resolvable email", async () => {
    const { app, query } = buildApp();

    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gh_access_token" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 333,
          login: "no-email-user",
          name: "No Email",
          email: null,
          avatar_url: "https://example.com/avatar.png",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, []));

    const res = await request(app).post("/users/github").send({ code: "valid_code_no_email" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Could not get email from GitHub/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 504 when GitHub token exchange times out", async () => {
    const { app, query } = buildApp();

    global.fetch.mockImplementationOnce((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const res = await request(app).post("/users/github").send({ code: "timeout_code" });

    expect(res.status).toBe(504);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/timed out/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 401 when GitHub code is invalid (no access token)", async () => {
    const { app, query } = buildApp();

    global.fetch.mockResolvedValueOnce(
      jsonResponse(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }),
    );

    const res = await request(app).post("/users/github").send({ code: "invalid_code" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/did not return an access token|incorrect|expired/i);
    expect(query).not.toHaveBeenCalled();
  });
});
