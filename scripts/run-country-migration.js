/**
 * Run Professional Country Schema Migration
 * ==========================================
 * This script executes the professional country schema migration
 * to upgrade the countries table to production-ready schema.
 * 
 * Usage: node scripts/run-country-migration.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');


