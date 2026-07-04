const mongoose = require('mongoose');
const URI = 'mongodb+srv://mohamedelafandy593_db_user:Lxz7FLjIrsUeuLCs@cluster0.kg3cidy.mongodb.net/payment?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(URI).then(async () => {
  const User = require('./models/user.model');
  
  const result = await User.deleteMany({ $or: [{ username: null }, { company: null }] });
  console.log(`Deleted ${result.deletedCount} broken user records.`);

  console.log('Syncing User indexes again...');
  try {
    await User.syncIndexes();
    console.log('Sync successful! Unique index { company: 1, username: 1 } should be created now.');
  } catch(err) {
    console.error('Sync failed:', err.message);
  }

  const db = mongoose.connection.db;
  console.log('--- Current Users Indexes ---');
  const usersIndexes = await db.collection('users').indexes();
  console.log(JSON.stringify(usersIndexes, null, 2));
  
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
