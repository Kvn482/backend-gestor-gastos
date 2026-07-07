const { Pool, types } = require('pg');
require('dotenv').config();

const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/Mazatlan';

types.setTypeParser(1082, value => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: `-c timezone=${APP_TIME_ZONE}`,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
