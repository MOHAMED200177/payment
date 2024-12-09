const express = require('express');
const returnController = require('../controllers/returnController');
const router = express.Router();

router.post('/add', returnController.addReturn);

module.exports = router;
