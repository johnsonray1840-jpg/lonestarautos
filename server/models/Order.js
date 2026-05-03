const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String, required: true },
  vehicleDetails: {
    make: String,
    model: String,
    year: Number,
    vin: String
  },
  shippingDetails: {
    pickupAddress: String,
    deliveryAddress: String,
    preferredDate: Date
  },
  amount: Number,
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  stripeSessionId: String,
  shipmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shipment'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Order', orderSchema);