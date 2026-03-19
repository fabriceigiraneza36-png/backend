/**
 * Destination Rating Model
 */
module.exports = (sequelize, DataTypes) => {
  const DestinationRating = sequelize.define("DestinationRating", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    destinationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "destination_id",
      references: {
        model: "destinations",
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
    tableName: "destination_ratings",
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ["destination_id", "user_id"] },
      { unique: true, fields: ["destination_id", "session_id"] },
      { fields: ["destination_id"] },
      { fields: ["user_id"] },
      { fields: ["rating"] },
    ],
  });

  DestinationRating.associate = (models) => {
    DestinationRating.belongsTo(models.Destination, { foreignKey: "destinationId", as: "destination" });
    DestinationRating.belongsTo(models.User, { foreignKey: "userId", as: "user", required: false });
  };

  return DestinationRating;
};
