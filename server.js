const dotenv = require('dotenv');
dotenv.config({ path: './.env/.env' });

const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 3000;

const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASS);

mongoose.connect(DB, { useNewUrlParser: true })
    .then(() => console.log('DB connection successful'));

app.listen(PORT, () => {
    console.log(`Server is running on ${PORT}`);
});
