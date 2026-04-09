const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Generate order number
function generateOrderNumber() {
  const prefix = 'ORD';
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${timestamp}${random}`;
}

// Create order and initiate payment
router.post('/create', async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      vehicleDetails,
      shippingDetails,
      amount
    } = req.body;

    // Create order
    const order = new Order({
      orderNumber: generateOrderNumber(),
      customerName,
      customerEmail,
      customerPhone,
      vehicleDetails,
      shippingDetails,
      amount
    });

    await order.save();

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Vehicle Shipping - ${vehicleDetails.make} ${vehicleDetails.model}`,
            description: `Pickup: ${shippingDetails.pickupAddress}\nDelivery: ${shippingDetails.deliveryAddress}`
          },
          unit_amount: amount * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
      customer_email: customerEmail,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber
      }
    });

    // Update order with Stripe session ID
    order.stripeSessionId = session.id;
    await order.save();

    res.json({ sessionId: session.id, orderNumber: order.orderNumber });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Webhook for Stripe payment confirmation
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const order = await Order.findOne({ stripeSessionId: session.id });
    
    if (order) {
      order.paymentStatus = 'completed';
      await order.save();
      
      // Auto-create shipment after successful payment
      const trackingNumber = `LSA${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const shipment = new Shipment({
        trackingNumber,
        customerInfo: {
          name: order.customerName,
          email: order.customerEmail,
          phone: order.customerPhone
        },
        vehicleInfo: order.vehicleDetails,
        pickupLocation: {
          address: order.shippingDetails.pickupAddress,
          city: 'Pending',
          state: 'Pending',
          zipCode: 'Pending'
        },
        deliveryLocation: {
          address: order.shippingDetails.deliveryAddress,
          city: 'Pending',
          state: 'Pending',
          zipCode: 'Pending'
        },
        shippingCost: order.amount,
        paymentStatus: 'paid',
        stripePaymentId: session.payment_intent
      });
      
      await shipment.save();
      order.shipmentId = shipment._id;
      await order.save();
    }
  }

  res.json({received: true});
});

module.exports = router;