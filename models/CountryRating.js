/**
 * Country Rating Model
 */
module.exports = (sequelize, DataTypes) => {
  const CountryRating = sequelize.define("CountryRating", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    countryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "country_id",
      references: {
        model: "countries",
        key: "id",
      },
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "user_id",
      references: {
        model: "users",
        key: "id",
      },
    },
    sessionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "session_id",
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5,
      },
    },
    review: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isApproved: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: "is_approved",
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updated_at",
    },
  }, {
    tableName: "country_ratings",
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ["country_id", "user_id"] },
      { unique: true, fields: ["country_id", "session_id"] },
      { fields: ["country_id"] },
      { fields: ["user_id"] },
      { fields: ["rating"] },
    ],
  });

  CountryRating.associate = (models) => {
    CountryRating.belongsTo(models.Country, { foreignKey: "countryId", as: "country" });
    CountryRating.belongsTo(models.User, { foreignKey: "userId", as: "user", required: false });
  };

  return CountryRating;
};
