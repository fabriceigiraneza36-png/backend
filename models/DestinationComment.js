/**
 * Destination Comment Model
 */
module.exports = (sequelize, DataTypes) => {
  const DestinationComment = sequelize.define("DestinationComment", {
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
    authorName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "author_name",
    },
    authorEmail: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "author_email",
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "parent_id",
      references: {
        model: "destination_comments",
        key: "id",
      },
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
    tableName: "destination_comments",
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ["destination_id"] },
      { fields: ["user_id"] },
      { fields: ["parent_id"] },
      { fields: ["created_at"] },
    ],
  });

  DestinationComment.associate = (models) => {
    DestinationComment.belongsTo(models.Destination, { foreignKey: "destinationId", as: "destination" });
    DestinationComment.belongsTo(models.User, { foreignKey: "userId", as: "user", required: false });
    DestinationComment.belongsTo(models.DestinationComment, { 
      foreignKey: "parentId", 
      as: "parent",
      required: false 
    });
    DestinationComment.hasMany(models.DestinationComment, { 
      foreignKey: "parentId", 
      as: "replies",
      onDelete: "CASCADE"
    });
  };

  return DestinationComment;
};
