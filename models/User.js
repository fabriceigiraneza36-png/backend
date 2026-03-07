// models/User.js
const { sequelize } = require("../config/db");
const { DataTypes } = require("sequelize");
const crypto = require("crypto");

const normalizeForTimestampWithoutTimezone = (date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
};

const toMs = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const normalizeCode = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(0, 6);

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      lowercase: true,
      validate: {
        isEmail: true,
      },
    },
    fullName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "full_name",
    },
    avatarUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: "avatar_url",
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING(20),
      defaultValue: "user",
    },
    google_id: {
      type: DataTypes.STRING(255),
      unique: true,
      allowNull: true,
    },
    github_id: {
      type: DataTypes.STRING(255),
      unique: true,
      allowNull: true,
    },
    auth_provider: {
      type: DataTypes.STRING(50),
      defaultValue: "email",
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: "is_verified",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: "is_active",
    },
    verificationCode: {
      type: DataTypes.STRING(255),
      field: "verification_code",
    },
    verificationToken: {
      type: DataTypes.STRING(255),
      field: "verification_token",
    },
    resetToken: {
      type: DataTypes.STRING(255),
      field: "reset_token",
    },
    resetTokenExpires: {
      type: DataTypes.DATE,
      field: "reset_token_expires",
    },
    codeExpiry: {
      type: DataTypes.DATE,
      field: "code_expiry",
    },
    codeAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "code_attempts",
    },
    lastCodeSentAt: {
      type: DataTypes.DATE,
      field: "last_code_sent_at",
    },
    lastLogin: {
      type: DataTypes.DATE,
      field: "last_login",
    },
    preferences: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    tableName: "users",
  },
);

// Instance methods
User.prototype.generateVerificationCode = function () {
  const code = crypto.randomInt(100000, 999999).toString();
  const now = new Date();
  const expiry = new Date(now.getTime() + 10 * 60 * 1000);

  this.verificationCode = code;
  this.codeExpiry = normalizeForTimestampWithoutTimezone(expiry);
  this.codeAttempts = 0;
  this.lastCodeSentAt = normalizeForTimestampWithoutTimezone(now);
  return code;
};

User.prototype.verifyCode = function (inputCode) {
  if (this.codeAttempts >= 5) {
    return { valid: false, message: "Too many attempts. Request a new code." };
  }

  const expiryMs = toMs(this.codeExpiry);
  if (!expiryMs || Date.now() > expiryMs) {
    return { valid: false, message: "Code has expired. Request a new one." };
  }

  const savedCode = normalizeCode(this.verificationCode);
  const submittedCode = normalizeCode(inputCode);

  if (!savedCode || savedCode !== submittedCode) {
    this.codeAttempts += 1;
    return { valid: false, message: "Invalid code. Please try again." };
  }
  return { valid: true };
};

User.prototype.canSendCode = function () {
  if (!this.lastCodeSentAt) return true;
  const sentMs = toMs(this.lastCodeSentAt);
  if (!sentMs) return true;
  const elapsed = Date.now() - sentMs;
  return elapsed > 60000;
};

module.exports = User;
