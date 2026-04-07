const dotenv = require('dotenv');
dotenv.config({ path: './.env/.env' });

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: Set JWT_SECRET in environment');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me-in-production';
  console.warn('WARNING: Using default JWT_SECRET (development only)');
}

const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 8000;

const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASS);

mongoose.connect(DB, { useNewUrlParser: true })
    .then(() => console.log('DB connection successful'));

app.listen(PORT, () => {
    console.log(`Server is running on ${PORT}`);
});
