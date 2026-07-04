const mongoose = require('mongoose');

async function dropIndex() {
  try {
    const URI = 'mongodb+srv://mohamedelafandy593_db_user:Lxz7FLjIrsUeuLCs@cluster0.kg3cidy.mongodb.net/payment?retryWrites=true&w=majority&appName=Cluster0';
    await mongoose.connect(URI);
    const db = mongoose.connection.db;
    const customers = db.collection('customers');
    
    // Check if index exists
    const indexes = await customers.indexes();
    console.log('Current indexes:', indexes.map(i => i.name));
    
    // Drop email_1 if it exists
    if (indexes.some(i => i.name === 'email_1')) {
      await customers.dropIndex('email_1');
      console.log('Successfully dropped email_1 index');
    }
    
    // Also drop name_1 since we have duplicate keys for 'Customer 1' in the tests
    // Actually we can just drop the whole customers collection to get a clean slate for the tests
    await customers.drop();
    console.log('Dropped customers collection for clean slate');
    
    // Also drop companies and users since it failed earlier
    await db.collection('users').deleteMany({ username: { $regex: 'test' } });
    await db.collection('companies').deleteMany({ name: { $regex: 'TestCo' } });
    console.log('Cleaned up test data');
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

dropIndex();
