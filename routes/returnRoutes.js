const express = require('express');
const returnController = require('../controllers/returnController');
const router = express.Router();

router.post('/add', returnController.addReturn);

router.
    route('/')
    .get(returnController.allReturn)

router.
    route('/:id')
    .get(returnController.oneReturn)
    .patch(returnController.updateReturn)
    .delete(returnController.deleteReturn);

module.exports = router;
