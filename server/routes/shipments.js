const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');

// Generate unique tracking number
function generateTrackingNumber() {
  const prefix = 'LSA';
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${timestamp}${random}`;
}

// Public route: Track shipment by tracking number
router.get('/track/:trackingNumber', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ trackingNumber: req.params.trackingNumber });
    
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Don't expose sensitive info
    const publicInfo = {
      trackingNumber: shipment.trackingNumber,
      customerName: shipment.customerInfo.name,
      vehicleInfo: shipment.vehicleInfo,
      pickupLocation: shipment.pickupLocation,
      deliveryLocation: shipment.deliveryLocation,
      currentLocation: shipment.currentLocation,
      status: shipment.status,
      statusHistory: shipment.statusHistory,
      carrierInfo: shipment.carrierInfo,
      estimatedDelivery: shipment.estimatedDelivery
    };

    res.json(publicInfo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public route: Get all active shipments for admin (protected)
// This will be moved to admin routes with authentication

module.exports = router;