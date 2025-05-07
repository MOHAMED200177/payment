const Counter = require('../models/counter');

const getNextSequence = async (name, session = null) => {
    const result = await Counter.findOneAndUpdate(
        { name },
        { $inc: { value: 1 } },
        { new: true, upsert: true, session }
    );

    return result.value;
};

module.exports = getNextSequence;
