/**
 * Models Index
 * Centralizes model exports and initialization
 */

const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

let modelsInitialized = false;
let cachedModels = null;

function initializeModels() {
  if (modelsInitialized && cachedModels) {
    return cachedModels;
  }

  const User = require("./User");

  // ── Initialize factory-function models ───────────────────────────────────

  const CountryLike = require("./CountryLike")(sequelize, DataTypes);
  const CountryComment = require("./CountryComment")(sequelize, DataTypes);
  const CountryRating = require("./CountryRating")(sequelize, DataTypes);

  const DestinationLike = require("./DestinationLike")(sequelize, DataTypes);
  const DestinationComment = require("./DestinationComment")(sequelize, DataTypes);
  const DestinationRating = require("./DestinationRating")(sequelize, DataTypes);

  const TeamMember = require("./TeamMember");

  // ── Create a simple Country model for reference ──────────────────────────

  /**
   * Country Model
   * Represents countries in the application
   * Uses the countries table created from migrations
   */
  const Country = sequelize.define(
    "Country",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      slug: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      tableName: "countries",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  // ── Create a simple Destination model for reference ──────────────────────

  /**
   * Destination Model
   * Represents tourism destinations
   */
  const Destination = sequelize.define(
    "Destination",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      slug: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      tableName: "destinations",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  // ── Establish associations ─────────────────────────────────────────────

  // Define associate method for each model
  const models = { CountryLike, CountryComment, CountryRating, DestinationLike, DestinationComment, DestinationRating, User, Country, Destination, TeamMember };

  // Call associate methods if they exist
  Object.values(models).forEach((model) => {
    if (model.associate) {
      try {
        model.associate(models);
      } catch (e) {
        // Silently ignore association errors during initialization
      }
    }
  });

  cachedModels = {
    sequelize,
    User,
    Country,
    Destination,
    TeamMember,
    CountryLike,
    CountryComment,
    CountryRating,
    DestinationLike,
    DestinationComment,
    DestinationRating,
  };

  modelsInitialized = true;
  return cachedModels;
}

// Initialize immediately
initializeModels();

// ── Export all models ──────────────────────────────────────────────────────

module.exports = {
  ...cachedModels,
  initializeModels,
};
