/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM MEMBER MODEL - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const slugify = require("../utils/slugify");

const TeamMember = sequelize.define(
  "TeamMember",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    // ── Core Identity ──────────────────────────────────────────────────
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
      validate: {
        notEmpty: { msg: "Name is required" },
        len: { args: [2, 150], msg: "Name must be between 2 and 150 characters" },
      },
    },

    slug: {
      type: DataTypes.STRING(200),
      unique: true,
    },

    role: {
      type: DataTypes.STRING(150),
      allowNull: false,
      validate: {
        notEmpty: { msg: "Role is required" },
      },
    },

    department: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // ── Image Fields ───────────────────────────────────────────────────
    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrlOrEmpty(value) {
          if (value && value.length > 0) {
            if (!/^https?:\/\/.+/i.test(value)) {
              throw new Error("image_url must be a valid URL");
            }
          }
        },
      },
    },

    image_public_id: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },

    // ── Contact Information ────────────────────────────────────────────
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: { msg: "Must be a valid email address" },
      },
    },

    phone: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },

    // ── Social Media Links ─────────────────────────────────────────────
    linkedin_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    twitter_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    instagram_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    website_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    // ── Professional Details ───────────────────────────────────────────
    expertise: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },

    languages: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },

    certifications: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },

    years_experience: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: { args: [0], msg: "Years of experience cannot be negative" },
      },
    },

    // ── Location ───────────────────────────────────────────────────────
    location: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },

    country: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    // ── Display & Status ───────────────────────────────────────────────
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    is_featured: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    show_on_homepage: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // ── SEO ────────────────────────────────────────────────────────────
    meta_title: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },

    meta_description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    // ── Additional ─────────────────────────────────────────────────────
    joined_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
  },
  {
    tableName: "team_members",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,

    // Auto-generate slug before create and update
    hooks: {
      beforeValidate: async (member) => {
        if (member.name) {
          let baseSlug = slugify(member.name, {
            lower: true,
            strict: true,
            trim: true,
          });

          // Ensure unique slug
          if (member.isNewRecord || member.changed("name")) {
            let slug = baseSlug;
            let counter = 1;
            let existing = await TeamMember.findOne({
              where: {
                slug,
                ...(member.id ? { id: { [require("sequelize").Op.ne]: member.id } } : {}),
              },
            });

            while (existing) {
              slug = `${baseSlug}-${counter}`;
              counter++;
              existing = await TeamMember.findOne({
                where: {
                  slug,
                  ...(member.id ? { id: { [require("sequelize").Op.ne]: member.id } } : {}),
                },
              });
            }

            member.slug = slug;
          }
        }
      },
    },

    // Virtual field: image (alias for image_url for frontend compatibility)
    getterMethods: {
      image() {
        return this.getDataValue("image_url");
      },
    },
  }
);

module.exports = TeamMember;
