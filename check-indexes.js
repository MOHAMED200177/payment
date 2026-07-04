const mongoose = require('mongoose');
const URI = 'mongodb+srv://mohamedelafandy593_db_user:Lxz7FLjIrsUeuLCs@cluster0.kg3cidy.mongodb.net/payment?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(URI).then(async () => {
  const db = mongoose.connection.db;
  const usersIndexes = await db.collection('users').indexes();
  const companiesIndexes = await db.collection('companies').indexes();
  console.log('--- Users Indexes ---');
  console.log(JSON.stringify(usersIndexes, null, 2));
  console.log('--- Companies Indexes ---');
  console.log(JSON.stringify(companiesIndexes, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
