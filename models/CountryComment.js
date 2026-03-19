/**
 * Country Comment Model
 */
module.exports = (sequelize, DataTypes) => {
  const CountryComment = sequelize.define("CountryComment", {
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
        model: "country_comments",
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
    tableName: "country_comments",
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ["country_id"] },
      { fields: ["user_id"] },
      { fields: ["parent_id"] },
      { fields: ["created_at"] },
    ],
  });

  CountryComment.associate = (models) => {
    CountryComment.belongsTo(models.Country, { foreignKey: "countryId", as: "country" });
    CountryComment.belongsTo(models.User, { foreignKey: "userId", as: "user", required: false });
    CountryComment.belongsTo(models.CountryComment, { 
      foreignKey: "parentId", 
      as: "parent",
      required: false 
    });
    CountryComment.hasMany(models.CountryComment, { 
      foreignKey: "parentId", 
      as: "replies",
      onDelete: "CASCADE"
    });
  };

  return CountryComment;
};
