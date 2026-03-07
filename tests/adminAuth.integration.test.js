const request = require("supertest");
const jwt = require("jsonwebtoken");

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

const bcrypt = require("bcryptjs");

const buildApp = () => {
  jest.resetModules();
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  const express = require("express");
  const adminAuthRoutes = require("../routes/adminAuth");
  const { query } = require("../config/db");

  const app = express();
  app.use(express.json());
  app.use("/admin/auth", adminAuthRoutes);
  return { app, query };
};

describe("Admin Auth Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs in admin and returns access + refresh tokens", async () => {
    const { app, query } = buildApp();
    const passwordHash = await bcrypt.hash("secret-password", 12);

    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            email: "admin@example.com",
            username: "superadmin",
            role: "admin",
            full_name: "Site Admin",
            password_hash: passwordHash,
            is_active: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/admin/auth/login").send({
      email: "admin@example.com",
      password: "secret-password",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("token");
    expect(res.body.data).toHaveProperty("refreshToken");
    expect(res.body.data.user.email).toBe("admin@example.com");
    expect(res.body.data.user.username).toBe("superadmin");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("refreshes admin token using admin refresh token", async () => {
    const { app, query } = buildApp();

    const refreshToken = jwt.sign(
      { id: 11, type: "admin", tokenType: "refresh" },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "30d" },
    );

    query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          email: "admin@example.com",
          role: "admin",
          username: "superadmin",
          is_active: true,
        },
      ],
    });

    const res = await request(app)
      .post("/admin/auth/refresh-token")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("token");
    expect(res.body.data).toHaveProperty("refreshToken");
  });

  it("allows admin access to /me with a valid admin token", async () => {
    const { app, query } = buildApp();

    const adminToken = jwt.sign(
      { id: 11, type: "admin", role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          email: "admin@example.com",
          username: "superadmin",
          role: "admin",
          full_name: "Site Admin",
          is_active: true,
          password_hash: "hashed_pw",
        },
      ],
    });

    const res = await request(app)
      .get("/admin/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe("admin@example.com");
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it("blocks non-admin token from /me", async () => {
    const { app, query } = buildApp();

    const userToken = jwt.sign(
      { id: 22, type: "user", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    query.mockResolvedValueOnce({
      rows: [
        {
          id: 22,
          email: "user@example.com",
          role: "user",
          is_active: true,
        },
      ],
    });

    const res = await request(app)
      .get("/admin/auth/me")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Admin privileges required/i);
  });
});
