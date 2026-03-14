/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEAM MEMBER MODEL - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TeamMember = sequelize.define('TeamMember', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  
  // Basic Information
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Name is required' },
      len: { args: [2, 100], msg: 'Name must be between 2 and 100 characters' },
    },
  },
  role: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Role is required' },
    },
  },
  department: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  
  // Contact Information
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
    unique: true,
    validate: {
      isEmail: { msg: 'Please provide a valid email address' },
    },
  },
  phone: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  
  // Media
  image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'image_url',
  },
  image_public_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'image_public_id',
  },
  
  // Social Links
  linkedin_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'linkedin_url',
    validate: {
      isUrl: { msg: 'Please provide a valid LinkedIn URL' },
    },
  },
  twitter_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'twitter_url',
    validate: {
      isUrl: { msg: 'Please provide a valid Twitter URL' },
    },
  },
  instagram_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'instagram_url',
  },
  website_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'website_url',
  },
  
  // Professional Details
  expertise: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: true,
    defaultValue: [],
  },
  languages: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: true,
    defaultValue: [],
  },
  certifications: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: true,
    defaultValue: [],
  },
  years_experience: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    field: 'years_experience',
  },
  
  // Location
  location: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  country: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  
  // Display Settings
  display_order: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    field: 'display_order',
  },
  is_featured: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    field: 'is_featured',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
    field: 'is_active',
  },
  show_on_homepage: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    field: 'show_on_homepage',
  },
  
  // SEO & Meta
  slug: {
    type: DataTypes.STRING(120),
    allowNull: true,
    unique: true,
  },
  meta_title: {
    type: DataTypes.STRING(160),
    allowNull: true,
    field: 'meta_title',
  },
  meta_description: {
    type: DataTypes.STRING(320),
    allowNull: true,
    field: 'meta_description',
  },
  
  // Additional
  joined_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'joined_date',
  },
}, {
  tableName: 'team_members',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true,
  
  // Hooks
  hooks: {
    beforeCreate: (member) => {
      if (!member.slug && member.name) {
        member.slug = member.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }
    },
    beforeUpdate: (member) => {
      if (member.changed('name') && !member.changed('slug')) {
        member.slug = member.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }
    },
  },
});

module.exports = TeamMember;