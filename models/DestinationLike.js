/**
 * Destination Like Model
 */
module.exports = (sequelize, DataTypes) => {
  const DestinationLike = sequelize.define("DestinationLike", {
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
    tableName: "destination_likes",
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ["destination_id", "user_id"] },
      { unique: true, fields: ["destination_id", "session_id"] },
      { fields: ["destination_id"] },
      { fields: ["user_id"] },
    ],
  });

  DestinationLike.associate = (models) => {
    DestinationLike.belongsTo(models.Destination, { foreignKey: "destinationId", as: "destination" });
    DestinationLike.belongsTo(models.User, { foreignKey: "userId", as: "user", required: false });
  };

  return DestinationLike;
};
