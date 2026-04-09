const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Shipment = require('../models/Shipment');
const Order = require('../models/Order');

// Admin authentication middleware
const adminAuth = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    if (verified.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    req.admin = verified;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign(
      { email, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// CRUD operations for shipments
router.post('/shipments', adminAuth, async (req, res) => {
  try {
    const shipment = new Shipment(req.body);
    await shipment.save();
    res.status(201).json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/shipments', adminAuth, async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/shipments/:id', adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/shipments/:id', adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/shipments/:id', adminAuth, async (req, res) => {
  try {
    await Shipment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Shipment deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get shipment history
router.get('/shipments/history/all', adminAuth, async (req, res) => {
  try {
    const shipments = await Shipment.find({
      status: { $in: ['delivered', 'delayed'] }
    }).sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update shipment location (for real-time tracking)
router.put('/shipments/:id/location', adminAuth, async (req, res) => {
  try {
    const { coordinates, address, city, state, status, statusDescription } = req.body;
    
    const shipment = await Shipment.findById(req.params.id);
    
    // Update current location
    shipment.currentLocation = {
      coordinates,
      address,
      city,
      state,
      lastUpdated: new Date()
    };
    
    // Add to status history if status changed
    if (status && status !== shipment.status) {
      shipment.statusHistory.push({
        status,
        timestamp: new Date(),
        location: `${address}, ${city}, ${state}`,
        description: statusDescription || `Shipment status updated to ${status}`
      });
      shipment.status = status;
    }
    
    await shipment.save();
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get orders
router.get('/orders', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;