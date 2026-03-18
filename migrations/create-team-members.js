/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MIGRATION: Create team_members table - Altuvera Travel
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run:   npx sequelize-cli db:migrate
 * Undo:  npx sequelize-cli db:migrate:undo
 */

"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("team_members", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // Core Identity
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING(200),
        unique: true,
      },
      role: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      department: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      // Image
      image_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      image_public_id: {
        type: Sequelize.STRING(300),
        allowNull: true,
      },

      // Contact
      email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },

      // Social Media
      linkedin_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      twitter_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      instagram_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      website_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },

      // Professional
      expertise: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      languages: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      certifications: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      years_experience: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },

      // Location
      location: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },

      // Display & Status
      display_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_featured: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      show_on_homepage: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // SEO
      meta_title: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      meta_description: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },

      // Additional
      joined_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },

      // Timestamps
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Indexes for performance
    await queryInterface.addIndex("team_members", ["slug"], { unique: true });
    await queryInterface.addIndex("team_members", ["is_active"]);
    await queryInterface.addIndex("team_members", ["is_featured"]);
    await queryInterface.addIndex("team_members", ["department"]);
    await queryInterface.addIndex("team_members", ["display_order"]);
    await queryInterface.addIndex("team_members", ["show_on_homepage"]);
    await queryInterface.addIndex("team_members", ["is_active", "is_featured"]);
    await queryInterface.addIndex("team_members", ["is_active", "department"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("team_members");
  },
};