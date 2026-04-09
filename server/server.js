/**
 * LONESTAR AUTOS - MAIN SERVER
 * Vehicle Dealership with Inventory Management, Shipment Tracking, and Reservation System
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const turf = require('@turf/turf');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'moving too fast cant keep up';

// ============================================================
// MONGODB CONNECTION
// ============================================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://evelyndantonio62:92939184@cluster0.tndfw.mongodb.net/lonestarautos?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

  // ============================================================
// SAFE SAVE FUNCTION - Handles version conflicts
// ============================================================
async function safeSaveShipment(shipment, retries = 3) {
  for (let i = 0; i < retries; i++) {
      try {
          await shipment.save();
          return true;
      } catch (error) {
          if (error.name === 'VersionError' && i < retries - 1) {
              console.log(`⚠️ Version conflict, retrying... (${i + 1}/${retries})`);
              // Reload the document with latest version
              await shipment.reload();
              continue;
          }
          throw error;
      }
  }
  return false;
}

  // ============================================================
// GLOBAL VARIABLES FOR WEBSOCKET - ADD THIS SECTION
// ============================================================
const activeSessions = new Map();      // Track active WebSocket sessions
const simulationIntervals = new Map(); // Track running simulations

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../client')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images and documents are allowed'));
  }
});

// ============================================================
// EMAIL CONFIGURATION
// ============================================================
const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.MAIL_FROM || "Lonestarautos <support@ripplexvault.link>";

// Check if email is configured
const isEmailConfigured = process.env.RESEND_API_KEY && 
                          process.env.RESEND_API_KEY !== 're_xxxx' &&
                          process.env.RESEND_API_KEY.startsWith('re_');

if (isEmailConfigured) {
    console.log('✅ Resend email system configured');
    console.log(`📧 Sending from: ${MAIL_FROM}`);
} else {
    console.log('⚠️ Resend API key not configured. Using simulation mode.');
    console.log('   Add RESEND_API_KEY to .env file to enable emails');
}

// ============================================================
// DATABASE SCHEMAS / MODELS
// ============================================================

// 1. ADMIN SCHEMA
const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  role: { type: String, enum: ['super_admin', 'admin', 'manager'], default: 'admin' },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now }
});

// 2. INVENTORY SCHEMA (Vehicles for Sale)
const inventorySchema = new mongoose.Schema({
  title: { type: String, required: true },
  price: { type: Number, required: true },
  downPayment: { type: Number, default: 0 },
  year: { type: Number, required: true },
  mileage: { type: String, required: true },
  engine: { type: String, required: true },
  make: { type: String, required: true },
  model: { type: String, required: true },
  color: { type: String, required: true },
  transmission: { type: String, default: 'Automatic' },
  fuelType: { type: String, default: 'Gasoline' },
  drivetrain: { type: String, default: 'AWD' },
  horsepower: { type: String },
  condition: { type: String, enum: ['New', 'Certified Pre-Owned', 'Used'], default: 'Certified Pre-Owned' },
  status: { type: String, enum: ['Available', 'Sold', 'Reserved'], default: 'Available' },
  images: [{ type: String }],
  featured: { type: Boolean, default: false },
  description: { type: String },
  features: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 3. RESERVATION SCHEMA
const reservationSchema = new mongoose.Schema({
  reservationNumber: { type: String, required: true, unique: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
  vehicleInfo: {
    title: String,
    make: String,
    model: String,
    year: Number,
    price: Number
  },
  customerInfo: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true }
  },
  downPayment: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  remainingBalance: { type: Number, required: true },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: String,
  paymentId: String,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled', 'expired'],
    default: 'pending'
  },
  deliveryDate: Date,
  notes: String,
  expiresAt: { type: Date, default: () => new Date(+new Date() + 7 * 24 * 60 * 60 * 1000) },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 4. SHIPMENT SCHEMA - REAL TRACKING VERSION
const shipmentSchema = new mongoose.Schema({
  trackingNumber: { type: String, required: true, unique: true },
  customerInfo: { name: String, email: String, phone: String },
  vehicleInfo: { make: String, model: String, year: Number, color: String },
  pickupLocation: {
      address: String, city: String, state: String, zipCode: String,
      coordinates: { lat: Number, lng: Number }
  },
  deliveryLocation: {
      address: String, city: String, state: String, zipCode: String,
      coordinates: { lat: Number, lng: Number }
  },
  // HIGHWAY ROUTE DATA (actual road path)
  route: {
      points: [{ lat: Number, lng: Number }],
      totalDistance: Number,
      majorCities: [String],
      highways: [String]
  },
  // REAL-TIME TRACKING DATA
  tracking: {
      isActive: { type: Boolean, default: false },
      startTime: Date,
      estimatedArrival: Date,
      totalDuration: Number,
      progress: { type: Number, default: 0 },
      currentPosition: { lat: Number, lng: Number, address: String, lastUpdated: Date },
      distanceRemaining: Number,
      timeRemaining: Number,
      status: { type: String, enum: ['pending', 'in-transit', 'delivered', 'delayed', 'paused', 'on-hold', 'seized'], default: 'pending' },
    // Add these new fields
    previousStatus: String,           // Store status before seizure
    wasActiveBeforeSeizure: { type: Boolean, default: false },
    seizedProgress: Number,           // Store progress when seized
    releasedAt: Date,
    releaseReason: String,
      // Pause tracking fields
      pausedAt: Date,
      pauseReason: String,
      pausedProgress: Number,
      pausedPosition: { lat: Number, lng: Number, address: String },
      // Hold tracking fields
      holdAt: Date,
      holdReason: String,
      holdProgress: Number,
      // Seize tracking fields
      seizedAt: Date,
      seizeReason: String,
      seizedProgress: Number,
      // MANUAL OVERRIDE (admin can set custom location)
      manualOverride: {
          isActive: { type: Boolean, default: false },
          customLat: Number,
          customLng: Number,
          customProgress: Number,
          setBy: String,
          setAt: Date,
          reason: String
      }
  },
  milestones: [{
      name: String,
      description: String,
      threshold: Number, 
      reached: { type: Boolean, default: false },
      reachedAt: Date,
      emailSent: { type: Boolean, default: false }
  }],
  history: [{
      status: String, timestamp: Date, location: String, description: String
  }],
  carrierInfo: { company: String, driverName: String, driverPhone: String },
  // FIXED: Added paused, on-hold, seized to main status enum
  status: { type: String, enum: ['pending', 'in-transit', 'delivered', 'delayed', 'paused', 'on-hold', 'seized'], default: 'pending' },
  estimatedDelivery: Date,
  actualDelivery: Date,
  shippingCost: Number,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});


// 5. DOCUMENT SCHEMA
const documentSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  customerEmail: { type: String, required: true },
  documentType: { type: String, enum: ['insurance', 'registration', 'bill_of_lading', 'inspection', 'other'], required: true },
  fileName: String,
  fileUrl: String,
  fileSize: Number,
  mimeType: String,
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  uploadedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  notes: String
});

// 6. ANALYTICS SCHEMA
const analyticsSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  metrics: {
    totalSales: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    activeShipments: { type: Number, default: 0 },
    completedShipments: { type: Number, default: 0 },
    averageDeliveryTime: { type: Number, default: 0 },
    customerSatisfaction: { type: Number, default: 0 }
  },
  dailyStats: {
    views: { type: Number, default: 0 },
    inquiries: { type: Number, default: 0 },
    sales: { type: Number, default: 0 }
  }
});

// 7. PAYMENT SCHEMA - FIXED ENUM VALUES
const paymentSchema = new mongoose.Schema({
    paymentId: { type: String, required: true, unique: true },
    reservationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    vehicleInfo: {
      title: String,
      make: String,
      model: String,
      year: Number,
      price: Number,
      images: [String]
    },
    customerInfo: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      address: { type: String, required: true }
    },
    deliveryDetails: {
      vehicleType: String,
      distance: Number,
      shippingCost: Number,
      preferredDate: Date,
      preferredTime: String,
      specialInstructions: String
    },
    paymentType: {
      type: String,
      enum: ['down_payment', 'full_payment', 'wire_transfer'],
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ['paypal', 'venmo', 'cashapp', 'wire_transfer', 'card', 'unknown'],
      required: true,
      default: 'unknown'
    },
    amount: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    remainingBalance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'failed'],
      default: 'pending'
    },
    rejectionReason: String,
    approvedAt: Date,
    rejectedAt: Date,
    adminNotes: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  });
  
  // 8. FINANCING REQUEST SCHEMA
  const financingSchema = new mongoose.Schema({
    requestId: { type: String, required: true, unique: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    vehicleInfo: {
      title: String,
      make: String,
      model: String,
      year: Number,
      price: Number
    },
    customerInfo: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      dob: { type: Date, required: true },
      ssn: { type: String, required: true },
      address: { type: String, required: true }
    },
    financialInfo: {
      annualIncome: { type: Number, required: true },
      employer: String,
      yearsEmployed: Number,
      creditScore: String,
      monthlyHousing: Number
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'in_review'],
      default: 'pending'
    },
    rejectionReason: String,
    approvedAt: Date,
    approvedAmount: Number,
    approvedTerms: String,
    adminNotes: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  });
  
// Create models
const Admin = mongoose.model('Admin', adminSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Reservation = mongoose.model('Reservation', reservationSchema);
const Shipment = mongoose.model('Shipment', shipmentSchema);
const Document = mongoose.model('Document', documentSchema);
const Analytics = mongoose.model('Analytics', analyticsSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Financing = mongoose.model('Financing', financingSchema);

// 9. PAYMENT METHOD SCHEMA - Dynamic payment details
const paymentMethodSchema = new mongoose.Schema({
    name: { 
      type: String, 
      required: true, 
      enum: ['venmo', 'cashapp', 'paypal', 'wire_transfer', 'bank_transfer'],
      unique: true 
    },
    displayName: { type: String, required: true }, // "Venmo", "Cash App", "PayPal"
    accountDetails: {
      username: String,
      email: String,
      phone: String,
      accountNumber: String,
      accountName: String,      
      routingNumber: String,
      bankName: String,
      swiftCode: String,
      qrCodeUrl: String,
      instructions: String
    },
    isActive: { type: Boolean, default: true },
    isSuspended: { type: Boolean, default: false },  // ← NEW FIELD
    displayOrder: { type: Number, default: 0 },
    icon: { type: String, default: '' },
    imageUrl: { type: String, default: '' }, 
    color: { type: String, default: '#c41e3a' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  });
  
  const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);


// ============================================================
// ENHANCED EMAIL FUNCTIONS WITH RESEND
// ============================================================

async function sendEmail(to, subject, htmlContent) {
    if (!isEmailConfigured) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 [EMAIL SIMULATION]');
        console.log(`   To: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return true;
    }
    
    try {
        const { data, error } = await resend.emails.send({
            from: MAIL_FROM,
            to: [to],
            subject: subject,
            html: htmlContent,
            reply_to: "support@ripplexvault.link"
        });
        
        if (error) {
            console.error('❌ Resend error:', error);
            return false;
        }
        
        console.log(`✅ Email sent to ${to}: ${data?.id}`);
        return true;
    } catch (error) {
        console.error('❌ Email send failed:', error.message);
        return false;
    }
}

async function sendPaymentNotificationEmail(to, payment, status, reason = null) {
    let subject = '';
    let htmlContent = '';
    
    if (status === 'pending') {
        subject = '🔔 Payment Request Received - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment Request Received</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}.header{background:linear-gradient(135deg,#c41e3a,#1e3a8a);padding:40px 30px;text-align:center;color:white;}.content{padding:40px 30px;}.payment-box{background:#fef3c7;border-left:4px solid #f59e0b;padding:20px;border-radius:12px;margin:24px 0;}.amount{color:#c41e3a;font-size:24px;font-weight:bold;}</style></head><body><div class="container"><div class="header"><h1>Lonestar Autos</h1><p>Premium Vehicle Dealership</p></div><div class="content"><h2>Hello ${payment.customerInfo.name},</h2><p>Your payment request has been submitted and is pending admin approval.</p><div class="payment-box"><p><strong>Payment ID:</strong> ${payment.paymentId}</p><p><strong>Amount:</strong> <span class="amount">$${payment.amount.toLocaleString()}</span></p><p><strong>Payment Type:</strong> ${payment.paymentType === 'down_payment' ? '🔒 10% Down Payment' : '💰 Full Payment'}</p><p><strong>Payment Method:</strong> ${payment.paymentMethod.toUpperCase()}</p><p><strong>Status:</strong> Pending Approval</p></div><p>Our team will review your payment within 24 hours.</p></div></div></body></html>`;
    } else if (status === 'approved') {
        subject = '✅ Payment Approved! - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment Approved</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}.header{background:linear-gradient(135deg,#10b981,#059669);padding:40px 30px;text-align:center;color:white;}.success-box{background:#d1fae5;padding:20px;border-radius:12px;margin:24px 0;}</style></head><body><div class="container"><div class="header"><h1>✅ Payment Approved!</h1></div><div class="content"><h2>Congratulations ${payment.customerInfo.name}!</h2><p>Your payment has been approved and processed successfully.</p><div class="success-box"><p><strong>Payment ID:</strong> ${payment.paymentId}</p><p><strong>Amount:</strong> $${payment.amount.toLocaleString()}</p><p><strong>Vehicle:</strong> ${payment.vehicleInfo.title}</p><p><strong>Payment Method:</strong> ${payment.paymentMethod.toUpperCase()}</p></div><p>${payment.paymentType === 'down_payment' ? 'Your vehicle has been reserved for 7 days.' : 'Your purchase is complete!'}</p></div></div></body></html>`;
    } else if (status === 'rejected') {
        subject = '⚠️ Payment Update Required - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment Update</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}.header{background:linear-gradient(135deg,#dc2626,#b91c1c);padding:40px 30px;text-align:center;color:white;}.error-box{background:#fee2e2;padding:20px;border-radius:12px;margin:24px 0;}</style></head><body><div class="container"><div class="header"><h1>Payment Update</h1></div><div class="content"><h2>Hello ${payment.customerInfo.name},</h2><p>Your payment request was not approved.</p><div class="error-box"><p><strong>Reason:</strong> ${reason || 'Payment verification failed'}</p></div><p>Please contact support.</p></div></div></body></html>`;
    }
    
    return await sendEmail(to, subject, htmlContent);
}

async function sendAdminPaymentNotification(payment) {
    const adminEmail = process.env.ADMIN_EMAIL || 'henryrobert1840@gmail.com';
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>New Payment Request</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;}.container{max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;}.header{background:linear-gradient(135deg,#c41e3a,#1e3a8a);padding:20px;text-align:center;color:white;}.content{padding:20px;}.detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;}</style></head><body><div class="container"><div class="header"><h2>New Payment Request</h2></div><div class="content"><div class="detail-row"><strong>Payment ID:</strong> <span>${payment.paymentId}</span></div><div class="detail-row"><strong>Customer:</strong> <span>${payment.customerInfo.name}</span></div><div class="detail-row"><strong>Email:</strong> <span>${payment.customerInfo.email}</span></div><div class="detail-row"><strong>Amount:</strong> <span>$${payment.amount.toLocaleString()}</span></div><div class="detail-row"><strong>Vehicle:</strong> <span>${payment.vehicleInfo.title}</span></div></div></div></body></html>`;
    return await sendEmail(adminEmail, `New Payment Request: ${payment.paymentId}`, htmlContent);
}

async function sendFinancingNotificationEmail(to, financing, status, data = {}) {
    let subject = '';
    let htmlContent = '';
    
    if (status === 'pending') {
        subject = '📋 Financing Request Received - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Financing Request Received</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;}.header{background:linear-gradient(135deg,#c41e3a,#1e3a8a);padding:40px 30px;text-align:center;color:white;}.info-box{background:#f8fafc;padding:20px;border-radius:12px;margin:24px 0;}</style></head><body><div class="container"><div class="header"><h1>Financing Request Received</h1></div><div class="content"><h2>Hello ${financing.customerInfo.name},</h2><p>Your financing request has been received and is being reviewed.</p><div class="info-box"><p><strong>Request ID:</strong> ${financing.requestId}</p><p><strong>Vehicle:</strong> ${financing.vehicleInfo.title}</p><p><strong>Amount:</strong> $${financing.vehicleInfo.price.toLocaleString()}</p></div><p>A specialist will contact you within 24 hours.</p></div></div></body></html>`;
    } else if (status === 'approved') {
        subject = '✅ Financing Approved! - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Financing Approved</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;}.header{background:linear-gradient(135deg,#10b981,#059669);padding:40px 30px;text-align:center;color:white;}.success-box{background:#d1fae5;padding:20px;border-radius:12px;margin:24px 0;}</style></head><body><div class="container"><div class="header"><h1>✅ Financing Approved!</h1></div><div class="content"><h2>Congratulations ${financing.customerInfo.name}!</h2><p>Your financing request has been approved.</p><div class="success-box"><p><strong>Approved Amount:</strong> $${data.approvedAmount?.toLocaleString() || financing.vehicleInfo.price.toLocaleString()}</p><p><strong>Terms:</strong> ${data.approvedTerms || 'Standard financing terms apply'}</p></div><p>A representative will contact you to complete the purchase.</p></div></div></body></html>`;
    } else if (status === 'rejected') {
        subject = '📋 Financing Update - Lonestar Autos';
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Financing Update</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;}.header{background:linear-gradient(135deg,#dc2626,#b91c1c);padding:40px 30px;text-align:center;color:white;}.error-box{background:#fee2e2;padding:20px;border-radius:12px;margin:24px 0;}</style></head><body><div class="container"><div class="header"><h1>Financing Update</h1></div><div class="content"><h2>Hello ${financing.customerInfo.name},</h2><p>Your financing request could not be approved at this time.</p><div class="error-box"><p><strong>Reason:</strong> ${data.reason || 'Unable to verify information'}</p></div><p>Please contact support.</p></div></div></body></html>`;
    }
    
    return await sendEmail(to, subject, htmlContent);
}

async function sendAdminFinancingNotification(financing) {
    const adminEmail = process.env.ADMIN_EMAIL || 'henryrobert1840@gmail.com';
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>New Financing Request</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;}.container{max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;}.header{background:linear-gradient(135deg,#c41e3a,#1e3a8a);padding:20px;text-align:center;color:white;}.content{padding:20px;}.detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;}</style></head><body><div class="container"><div class="header"><h2>New Financing Request</h2></div><div class="content"><div class="detail-row"><strong>Request ID:</strong> <span>${financing.requestId}</span></div><div class="detail-row"><strong>Customer:</strong> <span>${financing.customerInfo.name}</span></div><div class="detail-row"><strong>Email:</strong> <span>${financing.customerInfo.email}</span></div><div class="detail-row"><strong>Annual Income:</strong> <span>$${financing.financialInfo.annualIncome?.toLocaleString()}</span></div><div class="detail-row"><strong>Vehicle:</strong> <span>${financing.vehicleInfo.title}</span></div></div></div></body></html>`;
    return await sendEmail(adminEmail, `New Financing Request: ${financing.requestId}`, htmlContent);
}

// ============================================================
// PROFESSIONAL EMAIL FUNCTIONS - ENHANCED VERSION
// ============================================================

// Professional Pause Email
async function sendPauseEmail(shipment, reason, currentProgress, currentLocation) {
  const progressPercent = Math.round(currentProgress);
  const eta = shipment.tracking?.estimatedArrival ? new Date(shipment.tracking.estimatedArrival).toLocaleString() : 'To be determined';
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Shipment Update - Lonestar Autos</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; background: #f0f2f5; margin: 0; padding: 40px 20px; }
              .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 32px; text-align: center; }
              .header h1 { color: white; font-size: 24px; margin-bottom: 8px; }
              .header p { color: rgba(255,255,255,0.9); font-size: 14px; }
              .content { padding: 32px; }
              .status-card { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 16px; margin: 20px 0; }
              .progress-section { margin: 20px 0; }
              .progress-bar { background: #e2e8f0; border-radius: 30px; height: 10px; overflow: hidden; margin: 12px 0; }
              .progress-fill { background: linear-gradient(90deg, #f59e0b, #d97706); width: ${progressPercent}%; height: 100%; border-radius: 30px; }
              .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
              .stat-card { background: #f8fafc; padding: 16px; border-radius: 16px; text-align: center; }
              .stat-value { font-size: 20px; font-weight: 800; color: #f59e0b; }
              .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
              .tracking-number { background: #f8fafc; padding: 16px; border-radius: 16px; text-align: center; font-family: monospace; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #f59e0b; margin: 20px 0; }
              .button { display: inline-block; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 14px 32px; text-decoration: none; border-radius: 40px; font-weight: 600; margin-top: 20px; }
              .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>⏸️ Shipment Temporarily Paused</h1>
                  <p>Your delivery has been temporarily delayed</p>
              </div>
              <div class="content">
                  <h2 style="margin-bottom: 16px;">Hello ${shipment.customerInfo.name},</h2>
                  <p>Your vehicle shipment <strong>${shipment.trackingNumber}</strong> has been temporarily paused.</p>
                  
                  <div class="status-card">
                      <p style="font-weight: 600; margin-bottom: 8px;">📋 Pause Details:</p>
                      <p><strong>Reason:</strong> ${reason || 'Administrative hold'}</p>
                      <p><strong>Current Progress:</strong> ${progressPercent}% complete</p>
                      <p><strong>Current Location:</strong> ${currentLocation || 'In transit'}</p>
                      <p><strong>Estimated Delivery:</strong> ${eta}</p>
                  </div>
                  
                  <div class="progress-section">
                      <p style="margin-bottom: 8px;"><strong>Journey Progress</strong></p>
                      <div class="progress-bar"><div class="progress-fill"></div></div>
                      <p style="text-align: right; font-size: 12px; margin-top: 4px;">${progressPercent}% Complete</p>
                  </div>
                  
                  <div class="stats-grid">
                      <div class="stat-card"><div class="stat-value">${progressPercent}%</div><div class="stat-label">Journey Complete</div></div>
                      <div class="stat-card"><div class="stat-value">Paused</div><div class="stat-label">Current Status</div></div>
                  </div>
                  
                  <div class="tracking-number">${shipment.trackingNumber}</div>
                  
                  <p style="margin: 20px 0;">We will notify you immediately when your shipment resumes. If you have any questions, please contact our support team.</p>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">📡 Track Live Location</a>
                  </div>
              </div>
              <div class="footer">
                  <p>Lonestar Autos - Premium Vehicle Delivery</p>
                  <p>Questions? Call <a href="tel:1888LONESTAR" style="color: #f59e0b;">1-888-LONESTAR</a> or reply to this email</p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  await sendEmail(shipment.customerInfo.email, `⏸️ Shipment Update: Temporarily Paused - ${shipment.trackingNumber}`, html);
}

// Professional Resume Email - FIXED
async function sendResumeEmail(shipment, progress, remainingDays, eta) {
  const progressPercent = Math.round(progress);
  const etaFormatted = eta || (shipment.tracking?.estimatedArrival ? new Date(shipment.tracking.estimatedArrival).toLocaleString() : 'Calculating...');
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Shipment Resumed - Lonestar Autos</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; background: #f0f2f5; margin: 0; padding: 40px 20px; }
              .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px; text-align: center; }
              .header h1 { color: white; font-size: 24px; margin-bottom: 8px; }
              .header p { color: rgba(255,255,255,0.9); font-size: 14px; }
              .content { padding: 32px; }
              .status-card { background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; border-radius: 16px; margin: 20px 0; }
              .progress-bar { background: #e2e8f0; border-radius: 30px; height: 10px; overflow: hidden; margin: 12px 0; }
              .progress-fill { background: linear-gradient(90deg, #10b981, #059669); width: ${progressPercent}%; height: 100%; border-radius: 30px; }
              .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
              .stat-card { background: #f8fafc; padding: 16px; border-radius: 16px; text-align: center; }
              .stat-value { font-size: 20px; font-weight: 800; color: #10b981; }
              .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
              .tracking-number { background: #f8fafc; padding: 16px; border-radius: 16px; text-align: center; font-family: monospace; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #10b981; margin: 20px 0; }
              .button { display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 14px 32px; text-decoration: none; border-radius: 40px; font-weight: 600; margin-top: 20px; transition: transform 0.2s; }
              .button:hover { transform: translateY(-2px); }
              .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
              .footer a { color: #10b981; text-decoration: none; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>▶️ Shipment Resumed</h1>
                  <p>Your vehicle is back on the road!</p>
              </div>
              <div class="content">
                  <h2 style="margin-bottom: 16px;">Hello ${shipment.customerInfo.name},</h2>
                  <p>Great news! Your vehicle shipment <strong>${shipment.trackingNumber}</strong> has resumed its journey.</p>
                  
                  <div class="status-card">
                      <p style="font-weight: 600; margin-bottom: 8px;">📦 Current Status:</p>
                      <p><strong>Current Progress:</strong> ${progressPercent}% complete</p>
                      <p><strong>Estimated Time Remaining:</strong> ${remainingDays} day(s)</p>
                      <p><strong>Estimated Delivery:</strong> ${etaFormatted}</p>
                  </div>
                  
                  <div class="progress-section">
                      <p style="margin-bottom: 8px;"><strong>Journey Progress</strong></p>
                      <div class="progress-bar"><div class="progress-fill"></div></div>
                      <p style="text-align: right; font-size: 12px; margin-top: 4px;">${progressPercent}% Complete</p>
                  </div>
                  
                  <div class="stats-grid">
                      <div class="stat-card"><div class="stat-value">${progressPercent}%</div><div class="stat-label">Journey Complete</div></div>
                      <div class="stat-card"><div class="stat-value">${remainingDays}d</div><div class="stat-label">Est. Time Left</div></div>
                  </div>
                  
                  <div class="tracking-number">${shipment.trackingNumber}</div>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">📍 Track Live Location</a>
                  </div>
              </div>
              <div class="footer">
                  <p>Lonestar Autos - Premium Vehicle Delivery</p>
                  <p>Track 24/7 • Real-time GPS Updates</p>
                  <p>Questions? Call <a href="tel:1888LONESTAR">1-888-LONESTAR</a></p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  await sendEmail(shipment.customerInfo.email, `▶️ Shipment Update: Your Vehicle is Moving Again - ${shipment.trackingNumber}`, html);
}

// Professional Hold Email
async function sendHoldEmail(shipment, reason, progress, currentLocation) {
  const progressPercent = Math.round(progress);
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Shipment on Hold - Lonestar Autos</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; background: #f0f2f5; margin: 0; padding: 40px 20px; }
              .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 32px; text-align: center; }
              .header h1 { color: white; font-size: 24px; margin-bottom: 8px; }
              .content { padding: 32px; }
              .status-card { background: #ede9fe; border-left: 4px solid #8b5cf6; padding: 20px; border-radius: 16px; margin: 20px 0; }
              .button { display: inline-block; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; padding: 14px 32px; text-decoration: none; border-radius: 40px; font-weight: 600; margin-top: 20px; }
              .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>⏸️ Shipment on Hold</h1>
                  <p>Action Required</p>
              </div>
              <div class="content">
                  <h2>Hello ${shipment.customerInfo.name},</h2>
                  <p>Your vehicle shipment <strong>${shipment.trackingNumber}</strong> has been placed on hold.</p>
                  
                  <div class="status-card">
                      <p style="font-weight: 600; margin-bottom: 8px;">📋 Hold Details:</p>
                      <p><strong>Reason:</strong> ${reason || 'Pending verification'}</p>
                      <p><strong>Current Progress:</strong> ${progressPercent}% complete</p>
                      <p><strong>Current Location:</strong> ${currentLocation || 'At facility'}</p>
                  </div>
                  
                  <p style="margin: 20px 0;">Please contact our support team to resolve this hold and resume your delivery.</p>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">📡 Check Status</a>
                  </div>
              </div>
              <div class="footer">
                  <p>Lonestar Autos Support: <a href="tel:1888LONESTAR" style="color: #8b5cf6;">1-888-LONESTAR</a></p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  await sendEmail(shipment.customerInfo.email, `⏸️ Action Required: Shipment on Hold - ${shipment.trackingNumber}`, html);
}

// Professional Seize Email
async function sendSeizeEmail(shipment, reason, progress, currentLocation) {
  const progressPercent = Math.round(progress);
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>URGENT: Shipment Update - Lonestar Autos</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; background: #f0f2f5; margin: 0; padding: 40px 20px; }
              .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 32px; text-align: center; }
              .header h1 { color: white; font-size: 24px; margin-bottom: 8px; }
              .content { padding: 32px; }
              .status-card { background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 16px; margin: 20px 0; }
              .button { display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 40px; font-weight: 600; margin-top: 20px; }
              .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>⚠️ URGENT: Shipment Update</h1>
                  <p>Important information regarding your delivery</p>
              </div>
              <div class="content">
                  <h2>Hello ${shipment.customerInfo.name},</h2>
                  <p>There has been an important update regarding your vehicle shipment <strong>${shipment.trackingNumber}</strong>.</p>
                  
                  <div class="status-card">
                      <p style="font-weight: 600; margin-bottom: 8px;">📋 Status Details:</p>
                      <p><strong>Status:</strong> Under Review</p>
                      <p><strong>Reason:</strong> ${reason || 'Authorities inspection'}</p>
                      <p><strong>Current Progress:</strong> ${progressPercent}% complete</p>
                      <p><strong>Current Location:</strong> ${currentLocation || 'Inspection facility'}</p>
                  </div>
                  
                  <p style="margin: 20px 0; background: #fef3c7; padding: 16px; border-radius: 12px;">
                      <strong>📞 Immediate Action Required:</strong><br>
                      Please contact our support team immediately at <strong>1-888-LONESTAR</strong> to resolve this matter.
                  </p>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/contact" class="button">Contact Support Now</a>
                  </div>
              </div>
              <div class="footer">
                  <p>Lonestar Autos - 24/7 Support Available</p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  await sendEmail(shipment.customerInfo.email, `⚠️ URGENT: Action Required for Shipment ${shipment.trackingNumber}`, html);
}

// Professional Release Email - WITH PROGRESS BAR
async function sendReleaseEmail(shipment, reason, newStatus, progress) {
  const progressPercent = Math.round(progress || 0);
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Shipment Released - Lonestar Autos</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; background: #f0f2f5; margin: 0; padding: 40px 20px; }
              .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px; text-align: center; }
              .header h1 { color: white; font-size: 24px; margin-bottom: 8px; }
              .content { padding: 32px; }
              .status-card { background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; border-radius: 16px; margin: 20px 0; }
              .progress-bar { background: #e2e8f0; border-radius: 30px; height: 10px; overflow: hidden; margin: 12px 0; }
              .progress-fill { background: linear-gradient(90deg, #10b981, #059669); width: ${progressPercent}%; height: 100%; border-radius: 30px; }
              .button { display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 14px 32px; text-decoration: none; border-radius: 40px; font-weight: 600; margin-top: 20px; transition: transform 0.2s; }
              .button:hover { transform: translateY(-2px); }
              .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>✅ Shipment Released</h1>
                  <p>Your delivery is back on track!</p>
              </div>
              <div class="content">
                  <h2>Hello ${shipment.customerInfo.name},</h2>
                  <p>Great news! Your vehicle shipment <strong>${shipment.trackingNumber}</strong> has been released.</p>
                  
                  <div class="status-card">
                      <p style="font-weight: 600; margin-bottom: 8px;">📦 Release Details:</p>
                      <p><strong>Reason:</strong> ${reason || 'Legal review completed'}</p>
                      <p><strong>New Status:</strong> ${(newStatus || 'in-transit').toUpperCase()}</p>
                      <p><strong>Current Progress:</strong> ${progressPercent}% complete</p>
                  </div>
                  
                  <div class="progress-section">
                      <p style="margin-bottom: 8px;"><strong>Journey Progress</strong></p>
                      <div class="progress-bar"><div class="progress-fill"></div></div>
                      <p style="text-align: right; font-size: 12px; margin-top: 4px;">${progressPercent}% Complete</p>
                  </div>
                  
                  <p>Your vehicle delivery will now proceed as scheduled. You can track your shipment in real-time using the button below.</p>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">📍 Track Live Location</a>
                  </div>
              </div>
              <div class="footer">
                  <p>Lonestar Autos - Premium Vehicle Delivery</p>
                  <p>Questions? Call <a href="tel:1888LONESTAR" style="color: #10b981;">1-888-LONESTAR</a></p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  await sendEmail(shipment.customerInfo.email, `✅ Shipment Released - ${shipment.trackingNumber}`, html);
}

// ============================================================
// EMAIL NOTIFICATION FOR SHIPMENT UPDATES
// ============================================================

// PROFESSIONAL SHIPMENT UPDATE EMAIL - FEDEX/DHL STYLE
async function sendShipmentUpdateEmail(to, shipment, eventType, data) {
  let subject = '';
  let htmlContent = '';
  
  const progress = Math.round(shipment.tracking?.progress || 0);
  const trackingLink = `http://localhost:3000/track?number=${shipment.trackingNumber}`;
  
  if (eventType === 'in-transit') {
      subject = `🚚 Your Vehicle is on the Way! - Lonestar Autos`;
      htmlContent = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Vehicle in Transit</title>
          <style>
              body{font-family:'Inter',Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;}
              .container{max-width:580px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}
              .header{background:linear-gradient(135deg,#c41e3a,#1e3a8a);padding:32px;text-align:center;color:white;}
              .header h1{margin:0;font-size:24px;}
              .content{padding:32px;}
              .info-box{background:#f8fafc;padding:20px;border-radius:16px;margin:20px 0;}
              .progress-bar{background:#e2e8f0;border-radius:30px;height:10px;margin:12px 0;overflow:hidden;}
              .progress-fill{background:linear-gradient(90deg,#c41e3a,#1e3a8a);width:${progress}%;height:100%;border-radius:30px;}
              .button{display:inline-block;background:linear-gradient(135deg,#c41e3a,#1e3a8a);color:white;padding:14px 28px;text-decoration:none;border-radius:40px;font-weight:600;margin-top:20px;}
              .footer{background:#f8fafc;padding:24px;text-align:center;border-top:1px solid #eef2f6;color:#64748b;font-size:12px;}
          </style>
          </head>
          <body>
              <div class="container">
                  <div class="header"><h1>🚚 Vehicle in Transit!</h1><p>Your delivery is on the way</p></div>
                  <div class="content">
                      <h2>Hello ${shipment.customerInfo.name},</h2>
                      <p>Your vehicle has been picked up and is en route to your location!</p>
                      <div class="info-box">
                          <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                          <p><strong>Estimated Delivery:</strong> ${new Date(data.estimatedArrival).toLocaleString()}</p>
                          <p><strong>Distance:</strong> ${Math.round(data.distance)} miles</p>
                      </div>
                      <div class="progress-bar"><div class="progress-fill"></div></div>
                      <p style="text-align:center;margin:16px 0;">${progress}% of journey complete</p>
                      <div style="text-align:center;"><a href="${trackingLink}" class="button">📍 Track Live</a></div>
                  </div>
                  <div class="footer"><p>Lonestar Autos - Premium Vehicle Delivery | 1-888-LONESTAR</p></div>
              </div>
          </body>
          </html>
      `;
  } else if (eventType === 'delivered') {
      subject = `✅ Vehicle Delivered! - Lonestar Autos`;
      htmlContent = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Vehicle Delivered</title>
          <style>
              body{font-family:'Inter',Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;}
              .container{max-width:580px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}
              .header{background:linear-gradient(135deg,#10b981,#059669);padding:32px;text-align:center;color:white;}
              .header h1{margin:0;font-size:24px;}
              .content{padding:32px;text-align:center;}
              .checkmark{width:80px;height:80px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;}
              .checkmark i{font-size:40px;color:white;}
              .button{display:inline-block;background:linear-gradient(135deg,#c41e3a,#1e3a8a);color:white;padding:14px 28px;text-decoration:none;border-radius:40px;font-weight:600;margin-top:20px;}
              .footer{background:#f8fafc;padding:24px;text-align:center;border-top:1px solid #eef2f6;color:#64748b;font-size:12px;}
          </style>
          </head>
          <body>
              <div class="container">
                  <div class="header"><h1>🎉 Vehicle Delivered!</h1><p>Your journey is complete</p></div>
                  <div class="content">
                      <div class="checkmark"><i class="fas fa-check"></i></div>
                      <h2>Congratulations ${shipment.customerInfo.name}!</h2>
                      <p>Your vehicle has been successfully delivered to:</p>
                      <p><strong>${data.location || shipment.deliveryLocation?.address}</strong></p>
                      <p>We hope you enjoy your new vehicle from Lonestar Autos!</p>
                      <a href="http://localhost:3000" class="button">Rate Your Experience</a>
                  </div>
                  <div class="footer"><p>Lonestar Autos - Thank you for choosing us!</p></div>
              </div>
          </body>
          </html>
      `;
  } else if (eventType === 'delayed') {
      subject = `⚠️ Delivery Update - Lonestar Autos`;
      htmlContent = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Delivery Update</title>
          <style>
              body{font-family:'Inter',Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;}
              .container{max-width:580px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1);}
              .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px;text-align:center;color:white;}
              .header h1{margin:0;font-size:24px;}
              .content{padding:32px;}
              .info-box{background:#fef3c7;padding:20px;border-radius:16px;margin:20px 0;border-left:4px solid #f59e0b;}
              .button{display:inline-block;background:linear-gradient(135deg,#c41e3a,#1e3a8a);color:white;padding:14px 28px;text-decoration:none;border-radius:40px;font-weight:600;margin-top:20px;}
              .footer{background:#f8fafc;padding:24px;text-align:center;border-top:1px solid #eef2f6;color:#64748b;font-size:12px;}
          </style>
          </head>
          <body>
              <div class="container">
                  <div class="header"><h1>⚠️ Delivery Update</h1><p>Important information about your shipment</p></div>
                  <div class="content">
                      <h2>Hello ${shipment.customerInfo.name},</h2>
                      <p>There has been an update regarding your delivery:</p>
                      <div class="info-box">
                          <p><strong>Status:</strong> ${data.reason || 'Temporarily delayed'}</p>
                          <p><strong>Current Location:</strong> ${data.location || 'In transit'}</p>
                          <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                      </div>
                      <p>We apologize for any inconvenience. Your vehicle is still en route and will be delivered as soon as possible.</p>
                      <div style="text-align:center;"><a href="${trackingLink}" class="button">📍 Track Live</a></div>
                  </div>
                  <div class="footer"><p>Lonestar Autos Support: 1-888-LONESTAR</p></div>
              </div>
          </body>
          </html>
      `;
  }
  
  return await sendEmail(to, subject, htmlContent);
}

// ============================================================
// REAL TRACKING FUNCTIONS - ADD THESE AFTER YOUR SCHEMAS
// ============================================================

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Calculate total path distance
function calculatePathDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
      total += calculateDistance(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  }
  return total;
}

// Generate realistic highway route
function generateHighwayRoute(start, end) {
  const points = [];
  const steps = 50;
  
  for (let i = 0; i <= steps; i++) {
      const fraction = i / steps;
      let lat = start.lat + (end.lat - start.lat) * fraction;
      let lng = start.lng + (end.lng - start.lng) * fraction;
      
      // Add realistic highway curvature
      const curve = Math.sin(fraction * Math.PI) * 0.5;
      lat += (Math.random() - 0.5) * curve * 0.5;
      lng += (Math.random() - 0.5) * curve * 0.5;
      
      points.push({ lat, lng });
  }
  
  // Determine major cities along route
  const startState = getStateFromCoordinates(start.lat, start.lng);
  const endState = getStateFromCoordinates(end.lat, end.lng);
  const majorCities = [];
  const highways = [];
  
  if (startState === 'TX' && endState === 'AZ') {
      highways.push('I-10 West');
      majorCities.push('El Paso, TX', 'Tucson, AZ');
  } else if (startState === 'CA' && endState === 'NY') {
      highways.push('I-80 East', 'I-76 East');
      majorCities.push('Salt Lake City, UT', 'Denver, CO', 'Chicago, IL');
  } else if (startState === 'FL' && endState === 'TX') {
      highways.push('I-10 West');
      majorCities.push('Mobile, AL', 'New Orleans, LA');
  } else {
      highways.push('I-40', 'US Route 66');
      majorCities.push('Oklahoma City, OK', 'Albuquerque, NM');
  }
  
  return { points, totalDistance: calculatePathDistance(points), majorCities, highways };
}

function getStateFromCoordinates(lat, lng) {
  if (lat > 25 && lat < 36 && lng > -106 && lng < -93) return 'TX';
  if (lat > 31 && lat < 37 && lng > -114 && lng < -109) return 'AZ';
  if (lat > 32 && lat < 42 && lng > -124 && lng < -114) return 'CA';
  if (lat > 24 && lat < 31 && lng > -87 && lng < -80) return 'FL';
  if (lat > 40 && lat < 45 && lng > -74 && lng < -71) return 'NY';
  return 'US';
}


// ============================================================
// MILESTONE DEFINITIONS - FIXED WITH PROPER THRESHOLDS
// ============================================================
function getMilestones() {
  return [
      { name: "Order Processed", description: "Shipment information received", threshold: 0, emailSent: false },
      { name: "Pickup Scheduled", description: "Carrier assigned and pickup scheduled", threshold: 8, emailSent: false },
      { name: "Vehicle Picked Up", description: "Vehicle in carrier possession", threshold: 18, emailSent: false },
      { name: "Departed Facility", description: "Left origin facility", threshold: 28, emailSent: false },
      { name: "Arrived at Regional Hub", description: "Arrived at major sorting facility", threshold: 42, emailSent: false },
      { name: "In Transit", description: "Vehicle moving to destination", threshold: 55, emailSent: false },
      { name: "Arrived at Destination Hub", description: "Arrived at local distribution center", threshold: 72, emailSent: false },
      { name: "Out for Delivery", description: "Vehicle loaded for final delivery", threshold: 88, emailSent: false },
      { name: "Delivered", description: "Vehicle delivered to destination", threshold: 99, emailSent: false }
  ];
}

// Calculate tracking update
function calculateTrackingUpdate(shipment) {
  const now = Date.now();
  const startTime = new Date(shipment.tracking.startTime).getTime();
  const endTime = new Date(shipment.tracking.estimatedArrival).getTime();
  const totalDuration = endTime - startTime;
  const elapsed = now - startTime;
  let progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

   // FIX: Set minimum progress to 2% for better user experience
   if (progress > 0 && progress < 2) {
    progress = 2;
}
  
  // Check manual override
  if (shipment.tracking.manualOverride?.isActive) {
      progress = shipment.tracking.manualOverride.customProgress;
  }
  
  // Calculate position using route points
  let currentPosition;
  let distanceRemaining;
  
  if (shipment.route?.points && shipment.route.points.length > 0) {
      const pointIndex = Math.min(Math.floor((progress / 100) * (shipment.route.points.length - 1)), shipment.route.points.length - 1);
      currentPosition = shipment.route.points[pointIndex];
      const pointsRemaining = shipment.route.points.slice(pointIndex);
      distanceRemaining = calculatePathDistance(pointsRemaining);
  } else {
      const startLat = shipment.pickupLocation.coordinates.lat;
      const startLng = shipment.pickupLocation.coordinates.lng;
      const endLat = shipment.deliveryLocation.coordinates.lat;
      const endLng = shipment.deliveryLocation.coordinates.lng;
      const fraction = progress / 100;
      currentPosition = {
          lat: startLat + (endLat - startLat) * fraction,
          lng: startLng + (endLng - startLng) * fraction
      };
      const totalDistance = calculateDistance(startLat, startLng, endLat, endLng);
      distanceRemaining = totalDistance * (1 - fraction);
  }
  
  const remainingMs = Math.max(0, endTime - now);
  
  return {
      trackingNumber: shipment.trackingNumber,
      progress: Math.round(progress),
      currentPosition,
      distanceRemaining: Math.round(distanceRemaining || 0),
      remainingTime: {
          days: Math.floor(remainingMs / (1000 * 60 * 60 * 24)),
          hours: Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)),
          totalHours: remainingMs / (1000 * 60 * 60)
      },
      status: shipment.tracking.status,
      estimatedArrival: shipment.tracking.estimatedArrival
  };
}

// ============================================================
// PROFESSIONAL MILESTONE EMAIL - PREMIUM WORKING VERSION
// ============================================================
async function sendMilestoneEmail(shipment, milestone) {
  console.log(`📧 Sending ${milestone.name} email to ${shipment.customerInfo?.email}`);
  console.log(`🔔🔔🔔 sendMilestoneEmail CALLED`);
  console.log(`   Milestone: ${milestone.name}`);
  console.log(`   Customer email: ${shipment.customerInfo?.email}`);
  console.log(`   Tracking number: ${shipment.trackingNumber}`);
  console.log(`   RESEND_API_KEY exists: ${!!process.env.RESEND_API_KEY}`);
  console.log(`   MAIL_FROM: ${MAIL_FROM}`);
  
  
  if (!process.env.RESEND_API_KEY) {
      console.log(`⚠️ No API key - skipping email`);
      return true;
  }
  
  if (!shipment.customerInfo?.email) {
      console.error(`❌ No customer email for ${shipment.trackingNumber}`);
      return false;
  }
  
  const progress = Math.round(shipment.tracking?.progress || 0);
  const remainingHours = shipment.tracking?.timeRemaining ? Math.floor(shipment.tracking.timeRemaining / 3600) : 0;
  const eta = shipment.tracking?.estimatedArrival ? new Date(shipment.tracking.estimatedArrival).toLocaleString() : 'Calculating...';
  
  // Get next milestone
  const milestonesList = [
      { name: "Order Processed", threshold: 0 },
      { name: "Pickup Scheduled", threshold: 8 },
      { name: "Vehicle Picked Up", threshold: 18 },
      { name: "Departed Facility", threshold: 28 },
      { name: "Arrived at Regional Hub", threshold: 42 },
      { name: "In Transit", threshold: 55 },
      { name: "Arrived at Destination Hub", threshold: 72 },
      { name: "Out for Delivery", threshold: 88 },
      { name: "Delivered", threshold: 99 }
  ];
  
  let nextMilestone = null;
  for (let i = 0; i < milestonesList.length; i++) {
      if (progress < milestonesList[i].threshold) {
          nextMilestone = milestonesList[i];
          break;
      }
  }
  
  // Email styling based on milestone
  let emailIcon = "🚚";
  let headerGradient = "linear-gradient(135deg, #c41e3a 0%, #1e3a8a 100%)";
  
  if (milestone.name === "Order Processed") { emailIcon = "📋"; }
  else if (milestone.name === "Pickup Scheduled") { emailIcon = "📅"; }
  else if (milestone.name === "Vehicle Picked Up") { emailIcon = "🚚"; }
  else if (milestone.name === "Departed Facility") { emailIcon = "✈️"; }
  else if (milestone.name === "Arrived at Regional Hub") { emailIcon = "🏢"; }
  else if (milestone.name === "In Transit") { emailIcon = "🚛"; }
  else if (milestone.name === "Arrived at Destination Hub") { emailIcon = "📍"; }
  else if (milestone.name === "Out for Delivery") { emailIcon = "🎯"; }
  else if (milestone.name === "Delivered") { 
      emailIcon = "✅"; 
      headerGradient = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
  }
  
  const subject = `${emailIcon} ${milestone.name} - Your Vehicle Update from Lonestar Autos`;
  
  const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>${milestone.name} - Lonestar Autos</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              *{margin:0;padding:0;box-sizing:border-box}
              body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px;line-height:1.5}
              .container{max-width:580px;margin:0 auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 35px -10px rgba(0,0,0,0.1)}
              .header{background:${headerGradient};padding:32px 24px;text-align:center}
              .header-icon{font-size:48px;margin-bottom:12px;display:inline-block;background:rgba(255,255,255,0.15);width:80px;height:80px;line-height:80px;border-radius:50%}
              .header h1{color:#fff;font-size:26px;font-weight:700;margin-bottom:8px}
              .header p{color:rgba(255,255,255,0.9);font-size:14px}
              .content{padding:32px 28px}
              .milestone-card{background:#f8fafc;border-radius:20px;padding:24px;margin:20px 0;text-align:center;border-left:4px solid #c41e3a}
              .milestone-title{font-size:22px;font-weight:800;color:#1e293b;margin-bottom:8px}
              .milestone-desc{color:#475569;font-size:14px;margin-bottom:20px}
              .progress-container{background:#e2e8f0;border-radius:30px;height:10px;margin:20px 0;overflow:hidden}
              .progress-fill{background:linear-gradient(90deg,#c41e3a,#1e3a8a);height:100%;width:${progress}%;border-radius:30px}
              .stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}
              .stat-card{background:#fff;padding:16px;border-radius:16px;text-align:center;border:1px solid #eef2f6}
              .stat-value{font-size:22px;font-weight:800;color:#c41e3a}
              .stat-label{font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase}
              .vehicle-details{background:#f8fafc;padding:16px;border-radius:16px;margin:20px 0;border:1px solid #eef2f6}
              .vehicle-details p{margin:8px 0;font-size:13px}
              .next-milestone{background:#fef3c7;padding:14px;border-radius:14px;margin:20px 0;text-align:center;border-left:3px solid #f59e0b}
              .next-milestone p{font-size:13px;color:#92400e;margin:4px 0}
              .tracking-number{background:#f8fafc;padding:14px;border-radius:14px;text-align:center;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:2px;color:#c41e3a;margin:20px 0;border:1px dashed #e2e8f0}
              .button{display:inline-block;background:linear-gradient(135deg,#c41e3a,#1e3a8a);color:#fff;padding:14px 32px;text-decoration:none;border-radius:40px;font-weight:600;margin-top:20px}
              .footer{background:#f8fafc;padding:24px;text-align:center;border-top:1px solid #eef2f6;color:#64748b;font-size:12px}
              .footer a{color:#c41e3a;text-decoration:none}
              @media (max-width:480px){.content{padding:24px 20px}.stats-grid{grid-template-columns:1fr}.header h1{font-size:22px}}
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <div class="header-icon">${emailIcon}</div>
                  <h1>${milestone.name}</h1>
                  <p>Your vehicle delivery is progressing</p>
              </div>
              <div class="content">
                  <div class="milestone-card">
                      <div class="milestone-title">${milestone.name}</div>
                      <div class="milestone-desc">${milestone.description}</div>
                      <div class="progress-container"><div class="progress-fill"></div></div>
                      <div class="stats-grid">
                          <div class="stat-card"><div class="stat-value">${progress}%</div><div class="stat-label">Journey Complete</div></div>
                          <div class="stat-card"><div class="stat-value">${remainingHours} hours</div><div class="stat-label">Est. Time Remaining</div></div>
                      </div>
                  </div>
                  
                  <div class="vehicle-details">
                      <p><strong>🚗 Vehicle:</strong> ${shipment.vehicleInfo?.year || ''} ${shipment.vehicleInfo?.make || ''} ${shipment.vehicleInfo?.model || ''}</p>
                      <p><strong>🎨 Color:</strong> ${shipment.vehicleInfo?.color || 'Not specified'}</p>
                      <p><strong>📦 From:</strong> ${shipment.pickupLocation?.city || 'N/A'}, ${shipment.pickupLocation?.state || 'N/A'}</p>
                      <p><strong>🏁 To:</strong> ${shipment.deliveryLocation?.city || 'N/A'}, ${shipment.deliveryLocation?.state || 'N/A'}</p>
                      <p><strong>📅 Est. Delivery:</strong> ${eta}</p>
                  </div>
                  
                  ${nextMilestone ? `
                  <div class="next-milestone">
                      <p><strong>🔜 Next Milestone:</strong> ${nextMilestone.name}</p>
                      <p>Your vehicle will reach this checkpoint at approximately ${Math.round(nextMilestone.threshold)}% completion</p>
                  </div>
                  ` : ''}
                  
                  <div class="tracking-number">${shipment.trackingNumber}</div>
                  
                  <div style="text-align: center;">
                      <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">📍 Track Live Vehicle</a>
                  </div>
                  
                  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eef2f6;">
                  
                  <p style="font-size: 12px; color: #64748b; text-align: center;">
                      <strong>Need help?</strong> Contact our support team at <a href="tel:1888LONESTAR" style="color: #c41e3a;">1-888-LONESTAR</a>
                  </p>
              </div>
              <div class="footer">
                  <p>Lonestar Autos - Premium Vehicle Delivery</p>
                  <p>&copy; 2026 Lonestar Autos. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
  `;
  
  try {
      const result = await resend.emails.send({ 
          from: MAIL_FROM, 
          to: [shipment.customerInfo.email], 
          subject, 
          html 
      });
      console.log(`✅ Milestone email sent: ${milestone.name}`);
      return true;
  } catch (error) {
      console.error(`❌ Milestone email failed: ${error.message}`);
      return false;
  }
}


function calculatePosition(startLat, startLng, endLat, endLng, progress) {
  const fraction = progress / 100;
  return {
      lat: startLat + (endLat - startLat) * fraction,
      lng: startLng + (endLng - startLng) * fraction
  };
}

// Deprecated - use startRealTimeTracking instead
async function startGPSSimulation(shipmentId, trackingNumber, durationHours = 72) {
  console.log(`⚠️ startGPSSimulation is deprecated. Using unified tracking...`);
  return await startRealTimeTracking(shipmentId, durationHours / 24);
}


// ============================================================
// UNIFIED REAL-TIME TRACKING FUNCTION - REPLACE THIS ENTIRE FUNCTION
// ============================================================
async function startRealTimeTracking(shipmentId, estimatedDays, startingProgress = 0) {
  console.log(`🚀 Starting UNIFIED tracking for shipment: ${shipmentId} (${estimatedDays} days) from ${startingProgress}%`);

  const shipment = await Shipment.findById(shipmentId);
  if (!shipment) return { error: 'Shipment not found' };

  const startLat = shipment.pickupLocation.coordinates.lat;
  const startLng = shipment.pickupLocation.coordinates.lng;
  const endLat = shipment.deliveryLocation.coordinates.lat;
  const endLng = shipment.deliveryLocation.coordinates.lng;

  // ============================================================
  // GENERATE SMOOTH ROUTE (200 points for smooth animation)
  // ============================================================
  const routePoints = [];
  const steps = 200;
  
  for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Easing for natural acceleration
      const easeInOut = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      
      let lat = startLat + (endLat - startLat) * easeInOut;
      let lng = startLng + (endLng - startLng) * easeInOut;
      
      // Add realistic curve
      const curve = Math.sin(t * Math.PI) * 0.3;
      lat += (Math.random() - 0.5) * curve * 0.1;
      lng += (Math.cos(t * Math.PI * 1.5) * curve * 0.15);
      
      routePoints.push({ lat, lng });
  }
  
  const totalDistance = calculateDistance(startLat, startLng, endLat, endLng);
  
  // ============================================================
  // MILESTONE THRESHOLDS
  // ============================================================
const milestones = [
  { name: "Order Processed", description: "Shipment information received", threshold: 0, emailSent: false, reached: false, reachedAt: null },
  { name: "Pickup Scheduled", description: "Carrier assigned and pickup scheduled", threshold: 8, emailSent: false, reached: false, reachedAt: null },
  { name: "Vehicle Picked Up", description: "Vehicle in carrier possession", threshold: 18, emailSent: false, reached: false, reachedAt: null },
  { name: "Departed Facility", description: "Left origin facility", threshold: 28, emailSent: false, reached: false, reachedAt: null },
  { name: "Arrived at Regional Hub", description: "Arrived at major sorting facility", threshold: 42, emailSent: false, reached: false, reachedAt: null },
  { name: "In Transit", description: "Vehicle moving to destination", threshold: 55, emailSent: false, reached: false, reachedAt: null },
  { name: "Arrived at Destination Hub", description: "Arrived at local distribution center", threshold: 72, emailSent: false, reached: false, reachedAt: null },
  { name: "Out for Delivery", description: "Vehicle loaded for final delivery", threshold: 88, emailSent: false, reached: false, reachedAt: null },
  { name: "Delivered", description: "Vehicle delivered to destination", threshold: 99, emailSent: false, reached: false, reachedAt: null }
];

// CRITICAL: Log each milestone to verify thresholds
console.log(`📋 INITIALIZING ${milestones.length} MILESTONES:`);
milestones.forEach(m => {
  console.log(`   ${m.name}: threshold=${m.threshold}%, emailSent=${m.emailSent}`);
});


// // Verify thresholds are set correctly
// milestones.forEach(m => {
//     if (m.threshold === undefined) {
//         console.error(`❌ ERROR: Milestone ${m.name} has undefined threshold!`);
//     }
// });

  // Add this debug after initializing milestones
console.log(`📋 Milestones initialized: ${milestones.length} milestones`);
milestones.forEach(m => console.log(`  - ${m.name}: threshold ${m.threshold}%, emailSent: ${m.emailSent}`));
  
  // ============================================================
  // NEW: Mark milestones already passed when resuming from progress
  // ============================================================
  if (startingProgress > 0) {
      for (let i = 0; i < milestones.length; i++) {
          if (startingProgress >= milestones[i].threshold && milestones[i].threshold > 0) {
              milestones[i].emailSent = true;
              milestones[i].reachedAt = new Date();
              console.log(`🏁 Milestone already passed: ${milestones[i].name} at ${milestones[i].threshold}%`);
          }
      }
  }
  
  // ============================================================
  // CALCULATE TIMES WITH STARTING PROGRESS SUPPORT
  // ============================================================
  const estimatedHours = estimatedDays * 24;
  const totalDuration = estimatedHours * 3600;
  
  // Calculate elapsed time needed to reach startingProgress
  const elapsedSecondsToAchieveProgress = (startingProgress / 100) * totalDuration;
  
  // Adjust start time to be in the past if resuming from progress
  const adjustedStartTime = new Date(Date.now() - (elapsedSecondsToAchieveProgress * 1000));
  const estimatedArrival = new Date(Date.now() + ((totalDuration - elapsedSecondsToAchieveProgress) * 1000));
  
  // Use original startTime for fresh starts, adjusted for resumes
  const startTime = startingProgress > 0 ? adjustedStartTime : new Date();
  const finalEstimatedArrival = startingProgress > 0 ? estimatedArrival : new Date(Date.now() + (estimatedHours * 60 * 60 * 1000));
  
  console.log(`📅 Start: ${startTime.toLocaleString()}`);
  console.log(`📅 ETA: ${finalEstimatedArrival.toLocaleString()}`);
  if (startingProgress > 0) {
      console.log(`⏱️ Resuming from ${startingProgress}% (${(elapsedSecondsToAchieveProgress / 3600).toFixed(1)} hours elapsed of ${estimatedHours} total)`);
  }
  
  // ============================================================
  // Initialize tracking data with startingProgress
  // ============================================================
  shipment.route = { points: routePoints, totalDistance };
  shipment.milestones = milestones;
  shipment.tracking = {
      isActive: true,
      startTime: startTime,
      estimatedArrival: finalEstimatedArrival,
      totalDuration: totalDuration,
      progress: startingProgress,  // ← Set to startingProgress (0 for fresh, >0 for resume)
      currentPosition: getPositionAtProgress(routePoints, startingProgress, startLat, startLng, endLat, endLng, shipment.pickupLocation.address),
      distanceRemaining: totalDistance * (1 - startingProgress / 100),
      timeRemaining: totalDuration - elapsedSecondsToAchieveProgress,
      status: 'in-transit',
      manualOverride: { isActive: false }
  };
  shipment.status = 'in-transit';
  shipment.history = shipment.history || [];
  
  // ============================================================
  // Add appropriate history entry based on whether resuming or fresh
  // ============================================================
  if (startingProgress > 0) {
      shipment.history.push({
          status: 'resumed',
          timestamp: new Date(),
          location: shipment.tracking.currentPosition?.address || 'In transit',
          description: `Shipment resumed from ${Math.round(startingProgress)}%`
      });
  } else {
      shipment.history.push({
          status: 'in-transit',
          timestamp: new Date(),
          location: shipment.pickupLocation.address,
          description: 'Vehicle has been picked up and is en route'
      });
  }
  
  await safeSaveShipment(shipment);
  console.log(`✅ Tracking initialized for ${shipment.trackingNumber} at ${startingProgress}%`);


// ============================================================
// DEBUG: Verify milestones were saved
// ============================================================
console.log(`📋 VERIFYING MILESTONES IN DATABASE:`);
const verifyShipment = await Shipment.findById(shipmentId);
console.log(`   Milestones count: ${verifyShipment.milestones?.length || 0}`);
if (verifyShipment.milestones && verifyShipment.milestones.length > 0) {
    verifyShipment.milestones.forEach((m, i) => {
        console.log(`   ${i + 1}. ${m.name} - threshold: ${m.threshold}%, emailSent: ${m.emailSent}`);
    });
} else {
    console.log(`   ❌ NO MILESTONES FOUND IN DATABASE!`);
}

  // ============================================================
  // IMMEDIATE ORDER PROCESSED EMAIL - DIRECT SEND
  // ============================================================
  if (startingProgress === 0) {
    console.log(`📧 Attempting to send Order Processed email...`);
    
    // Wait a moment for the database to save
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reload shipment to ensure milestones are there
    const freshShipment = await Shipment.findById(shipmentId);
    
    if (freshShipment.milestones && freshShipment.milestones.length > 0) {
        const orderProcessed = freshShipment.milestones.find(m => m.name === "Order Processed");
        
        if (orderProcessed && !orderProcessed.emailSent) {
            orderProcessed.emailSent = true;
            orderProcessed.reached = true;
            orderProcessed.reachedAt = new Date();
            await freshShipment.save();
            
            try {
                await sendMilestoneEmail(freshShipment, orderProcessed);
                console.log(`✅ Order Processed email sent successfully`);
            } catch(e) { 
                console.error(`❌ Order Processed email error:`, e.message); 
            }
        } else {
            console.log(`⚠️ Order Processed milestone not found or already sent`);
        }
    } else {
        console.log(`⚠️ No milestones found in shipment after save!`);
        // Manually create and send
        const orderProcessedMilestone = {
            name: "Order Processed",
            description: "Shipment information received",
            threshold: 0,
            emailSent: false
        };
        try {
            await sendMilestoneEmail(freshShipment, orderProcessedMilestone);
            console.log(`✅ Order Processed email sent (manual fallback)`);
        } catch(e) { 
            console.error(`❌ Fallback email error:`, e.message); 
        }
    }
}

  
  // ============================================================
// REAL-TIME UPDATE INTERVAL (every 2 seconds) - OPTIMIZED
// ============================================================
const interval = setInterval(async () => {
  try {
      const currentShipment = await Shipment.findById(shipmentId);
      if (!currentShipment) {
          clearInterval(interval);
          simulationIntervals.delete(shipmentId);
          return;
      }
      
      // Stop if delivered
      if (currentShipment.tracking.status === 'delivered') {
          clearInterval(interval);
          simulationIntervals.delete(shipmentId);
          console.log(`✅ Tracking completed for ${currentShipment.trackingNumber}`);
          return;
      }
      
      let hasChanges = false;
      
      // Calculate progress based on elapsed time
      const elapsedSeconds = (Date.now() - currentShipment.tracking.startTime) / 1000;
      let progress = Math.min(100, Math.max(0, (elapsedSeconds / currentShipment.tracking.totalDuration) * 100));
      if (progress > 0 && progress < 1) progress = 1;
      
      // Ensure progress never goes below startingProgress
      if (progress < startingProgress) {
          progress = startingProgress;
      }
      
      // Update progress if changed significantly
      if (Math.abs(currentShipment.tracking.progress - progress) > 0.01) {
          currentShipment.tracking.progress = progress;
          hasChanges = true;
      }
      
      // Update current position
      const routePts = currentShipment.route.points;
      let currentPosition;
      if (routePts && routePts.length > 0) {
          const pointIndex = Math.min(Math.floor((progress / 100) * (routePts.length - 1)), routePts.length - 1);
          currentPosition = routePts[pointIndex];
      } else {
          const fraction = progress / 100;
          currentPosition = {
              lat: startLat + (endLat - startLat) * fraction,
              lng: startLng + (endLng - startLng) * fraction
          };
      }
      
      const remainingMs = Math.max(0, currentShipment.tracking.estimatedArrival - Date.now());
      const remainingHours = remainingMs / (1000 * 60 * 60);
      const remainingMiles = currentShipment.route.totalDistance * (1 - progress / 100);
      
      // Update position if changed
      if (currentShipment.tracking.currentPosition.lat !== currentPosition.lat || 
          currentShipment.tracking.currentPosition.lng !== currentPosition.lng) {
          currentShipment.tracking.currentPosition = {
              lat: currentPosition.lat,
              lng: currentPosition.lng,
              address: `${currentPosition.lat.toFixed(4)}, ${currentPosition.lng.toFixed(4)}`,
              lastUpdated: new Date()
          };
          hasChanges = true;
      }
      
      // Update time remaining if changed significantly
      if (Math.abs(currentShipment.tracking.timeRemaining - (remainingMs / 1000)) > 1) {
          currentShipment.tracking.timeRemaining = remainingMs / 1000;
          hasChanges = true;
      }
      
      // Update distance remaining if changed significantly
      if (Math.abs(currentShipment.tracking.distanceRemaining - remainingMiles) > 1) {
          currentShipment.tracking.distanceRemaining = remainingMiles;
          hasChanges = true;
      }

      // ============================================================
      // CHECK MILESTONES - USING "CROSSED THRESHOLD" LOGIC
      // ============================================================
      if (currentShipment.milestones && currentShipment.milestones.length > 0) {
          for (let i = 0; i < currentShipment.milestones.length; i++) {
              const milestone = currentShipment.milestones[i];
              const threshold = milestone.threshold;
              
              if (threshold === undefined) continue;
              
              const wasNotSent = !milestone.emailSent;
              const hasReachedOrPassed = progress >= threshold;
              const isAboveStarting = threshold > startingProgress;
              
              if (wasNotSent && hasReachedOrPassed && isAboveStarting) {
                  console.log(`🎯🎯🎯 TRIGGERING MILESTONE: ${milestone.name} at ${progress.toFixed(1)}% (threshold: ${threshold}%)`);
                  
                  milestone.emailSent = true;
                  milestone.reached = true;
                  milestone.reachedAt = new Date();
                  hasChanges = true;
                  
                  // Add to history
                  currentShipment.history.push({
                      status: milestone.name.toLowerCase().replace(/\s/g, '-'),
                      timestamp: new Date(),
                      location: milestone.name,
                      description: milestone.description
                  });
                  
                  // Send email
                  try {
                      await sendMilestoneEmail(currentShipment, milestone);
                      console.log(`✅ Email sent for: ${milestone.name}`);
                  } catch (emailError) {
                      console.error(`❌ Email failed for ${milestone.name}:`, emailError.message);
                  }
                  
                  // Broadcast
                  await broadcastTrackingUpdate(currentShipment.trackingNumber, {
                      type: 'milestone',
                      milestone: milestone.name,
                      progress: progress
                  });
              }
          }
      }
      
      // ============================================================
      // CHECK IF DELIVERED
      // ============================================================
      if (progress >= 99.5 && currentShipment.tracking.status !== 'delivered') {
          currentShipment.tracking.status = 'delivered';
          currentShipment.status = 'delivered';
          currentShipment.actualDelivery = new Date();
          currentShipment.history.push({
              status: 'delivered',
              timestamp: new Date(),
              location: currentShipment.deliveryLocation.address,
              description: 'Vehicle has been successfully delivered'
          });
          hasChanges = true;
          
          const deliveredMilestone = currentShipment.milestones.find(m => m.name === "Delivered");
          if (deliveredMilestone && !deliveredMilestone.emailSent) {
              deliveredMilestone.emailSent = true;
              await sendMilestoneEmail(currentShipment, deliveredMilestone);
          }
          
          clearInterval(interval);
          simulationIntervals.delete(shipmentId);
          console.log(`✅ DELIVERED: ${currentShipment.trackingNumber}`);
      }
      
      // ============================================================
      // ONLY SAVE IF CHANGES WERE MADE
      // ============================================================
      if (hasChanges) {
          await safeSaveShipment(currentShipment);
      }
      
      // ============================================================
      // BROADCAST TO WEBSOCKET CLIENTS
      // ============================================================
      await broadcastTrackingUpdate(currentShipment.trackingNumber, {
          trackingNumber: currentShipment.trackingNumber,
          progress: Math.round(progress),
          currentPosition: { lat: currentPosition.lat, lng: currentPosition.lng },
          remainingTime: remainingHours,
          distanceRemaining: Math.round(remainingMiles),
          status: currentShipment.status,
          estimatedArrival: currentShipment.tracking.estimatedArrival,
          timestamp: new Date().toISOString()
      });
      
  } catch (error) {
      console.error('❌ Interval error:', error.message);
      // Don't clear interval on error - let it recover
  }
  
}, 2000);

   simulationIntervals.set(shipmentId, interval);
  return { success: true, trackingNumber: shipment.trackingNumber };
}

// ============================================================
// HELPER FUNCTION: Get position at a specific progress
// ============================================================
function getPositionAtProgress(routePoints, progress, startLat, startLng, endLat, endLng, defaultAddress) {
    if (routePoints && routePoints.length > 0) {
        const pointIndex = Math.min(Math.floor((progress / 100) * (routePoints.length - 1)), routePoints.length - 1);
        const point = routePoints[pointIndex];
        return {
            lat: point.lat,
            lng: point.lng,
            address: defaultAddress || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
            lastUpdated: new Date()
        };
    } else {
        const fraction = progress / 100;
        return {
            lat: startLat + (endLat - startLat) * fraction,
            lng: startLng + (endLng - startLng) * fraction,
            address: defaultAddress || `${startLat + (endLat - startLat) * fraction}, ${startLng + (endLng - startLng) * fraction}`,
            lastUpdated: new Date()
        };
    }
}


// ============================================================
// BROADCAST UPDATE FUNCTION 
// ============================================================
async function broadcastUpdate(shipmentId, updateData) {
  const shipment = await Shipment.findById(shipmentId);
  if (!shipment) return;
  
  // Get current position
  let currentLat = null;
  let currentLng = null;
  let currentProgress = shipment.tracking?.progress || 0;
  
  if (shipment.simulation?.currentPosition) {
      currentLat = shipment.simulation.currentPosition.lat;
      currentLng = shipment.simulation.currentPosition.lng;
  } else if (shipment.tracking?.currentPosition) {
      currentLat = shipment.tracking.currentPosition.lat;
      currentLng = shipment.tracking.currentPosition.lng;
  }
  
  for (const [socketId, session] of activeSessions) {
      if (session.trackingNumber === shipment.trackingNumber) {
          io.to(socketId).emit('tracking-update', {
              trackingNumber: shipment.trackingNumber,
              progress: currentProgress,
              currentPosition: { lat: currentLat, lng: currentLng },
              remainingTime: updateData.remainingTime,
              distanceRemaining: updateData.distanceRemaining,
              status: shipment.status,
              estimatedArrival: shipment.tracking?.estimatedArrival,
              timestamp: new Date().toISOString()
          });
      }
  }
}


// ============================================================
// ADVANCED GPS SIMULATION ENGINE - PREMIUM VERSION
// ============================================================

class GPSSimulationEngine {
    constructor(shipmentId, trackingNumber) {
        this.shipmentId = shipmentId;
        this.trackingNumber = trackingNumber;
        this.interval = null;
        this.isRunning = false;
        this.currentPoint = 0;
        this.routePoints = [];
        this.totalDistance = 0;
        this.startTime = null;
        this.checkpoints = [];
    }
    
    async initialize() {
        const shipment = await Shipment.findById(this.shipmentId);
        if (!shipment) throw new Error('Shipment not found');
        
        const origin = shipment.pickupLocation.coordinates;
        const destination = shipment.deliveryLocation.coordinates;
        
        // Generate realistic route using great-circle interpolation
        this.routePoints = this.generateRoutePoints(origin, destination, 100);
        this.totalDistance = this.calculateDistance(origin, destination);
        this.startTime = new Date();
        
        // Generate intelligent checkpoints based on route
        this.checkpoints = this.generateIntelligentCheckpoints(origin, destination);
        
        // Save to database
        shipment.realtime.currentPosition = {
            lat: origin.lat,
            lng: origin.lng,
            timestamp: new Date(),
            source: 'simulation'
        };
        shipment.status.current = 'en-route';
        shipment.status.progress = 0;
        shipment.checkpoints = this.checkpoints;
        shipment.route.routeGeometry = {
            type: 'LineString',
            coordinates: this.routePoints.map(p => [p.lng, p.lat])
        };
        await safeSaveShipment(shipment);
        
        return true;
    }
    
    generateRoutePoints(start, end, segments) {
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const fraction = i / segments;
            const lat = start.lat + (end.lat - start.lat) * fraction;
            const lng = start.lng + (end.lng - start.lng) * fraction;
            
            // Add realistic curve variation
            const variation = Math.sin(fraction * Math.PI) * 0.02;
            points.push({
                lat: lat + (Math.random() - 0.5) * variation,
                lng: lng + (Math.random() - 0.5) * variation
            });
        }
        return points;
    }
    
    generateIntelligentCheckpoints(origin, destination) {
        const checkpoints = [
            { name: "Departure Facility", distance: 0.05, type: "origin" },
            { name: "Sorting Center", distance: 0.2, type: "waypoint" },
            { name: "Regional Hub", distance: 0.4, type: "waypoint" },
            { name: "Major Landmark", distance: 0.55, type: "landmark" },
            { name: "Local Terminal", distance: 0.7, type: "waypoint" },
            { name: "Distribution Center", distance: 0.85, type: "waypoint" },
            { name: "Final Destination", distance: 0.98, type: "destination" }
        ];
        
        return checkpoints.map(cp => {
            const fraction = cp.distance;
            const lat = origin.lat + (destination.lat - origin.lat) * fraction;
            const lng = origin.lng + (destination.lng - origin.lng) * fraction;
            return {
                name: cp.name,
                type: cp.type,
                coordinates: { lat, lng },
                distance: cp.distance,
                status: 'pending',
                estimatedArrival: new Date(this.startTime.getTime() + (this.totalDistance / 55 * 3600 * 1000 * fraction))
            };
        });
    }
    
    calculateDistance(point1, point2) {
        const R = 3959;
        const lat1 = point1.lat * Math.PI / 180;
        const lat2 = point2.lat * Math.PI / 180;
        const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
        const deltaLng = (point2.lng - point1.lng) * Math.PI / 180;
        const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        const totalSteps = this.routePoints.length;
        const stepDuration = 3000; // 3 seconds per step
        const totalDuration = totalSteps * stepDuration;
        
        this.interval = setInterval(async () => {
            if (!this.isRunning) return;
            
            if (this.currentPoint >= totalSteps) {
                await this.complete();
                return;
            }
            
            const point = this.routePoints[this.currentPoint];
            const progress = (this.currentPoint / totalSteps) * 100;
            const elapsed = Date.now() - this.startTime.getTime();
            const estimatedTotal = (totalDuration / 1000);
            const remainingSeconds = Math.max(0, estimatedTotal - (elapsed / 1000));
            
            // Update shipment
            const shipment = await Shipment.findById(this.shipmentId);
            if (!shipment) {
                this.stop();
                return;
            }
            
            // Update current position
            shipment.realtime.currentPosition = {
                lat: point.lat,
                lng: point.lng,
                timestamp: new Date(),
                source: 'simulation',
                speed: this.calculateSpeed(point)
            };
            
            // Update path history
            shipment.realtime.pathHistory.push({
                lat: point.lat,
                lng: point.lng,
                timestamp: new Date(),
                speed: this.calculateSpeed(point),
                heading: this.calculateHeading(point)
            });
            
            // Keep only last 1000 points
            if (shipment.realtime.pathHistory.length > 1000) {
                shipment.realtime.pathHistory = shipment.realtime.pathHistory.slice(-1000);
            }
            
            // Update progress
            shipment.status.progress = progress;
            shipment.status.estimatedTimeRemaining = remainingSeconds;
            shipment.status.eta = new Date(Date.now() + remainingSeconds * 1000);
            
            // Check for checkpoints reached
            for (let checkpoint of shipment.checkpoints) {
                if (checkpoint.status === 'pending') {
                    const distanceToCheckpoint = this.calculateDistance(
                        { lat: point.lat, lng: point.lng },
                        checkpoint.coordinates
                    );
                    
                    if (distanceToCheckpoint < 10) { // Within 10 miles
                        checkpoint.status = 'reached';
                        checkpoint.actualArrival = new Date();
                        
                        // Add to status history
                        shipment.status.history.push({
                            status: 'at-checkpoint',
                            timestamp: new Date(),
                            location: checkpoint.name,
                            description: `Vehicle has arrived at ${checkpoint.name}`,
                            notified: false
                        });
                        
                        // Send email notification
                        await this.sendCheckpointNotification(shipment, checkpoint);
                        
                        // Broadcast real-time update
                        await broadcastTrackingUpdate(this.shipmentId, {
                            type: 'checkpoint_reached',
                            checkpoint: checkpoint.name,
                            progress: progress
                        });
                    }
                }
            }
            
            shipment.updatedAt = new Date();
            await safeSaveShipment(shipment);
            
            // Broadcast real-time update to connected clients
            await broadcastTrackingUpdate(this.shipmentId, {
                type: 'position_update',
                position: { lat: point.lat, lng: point.lng },
                progress: progress,
                eta: shipment.status.eta,
                remainingTime: remainingSeconds
            });
            
            this.currentPoint++;
        }, stepDuration);
    }
    
    calculateSpeed(point) {
        // Simulate realistic speed variations
        const baseSpeed = 55; // mph
        const variation = Math.sin(this.currentPoint * 0.1) * 15;
        return Math.max(30, baseSpeed + variation);
    }
    
    calculateHeading(point) {
        if (this.currentPoint === 0) return 0;
        const prev = this.routePoints[this.currentPoint - 1];
        const dx = point.lng - prev.lng;
        const dy = point.lat - prev.lat;
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }
    
    async sendCheckpointNotification(shipment, checkpoint) {
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Vehicle Update - Lonestar Autos</title>
                <style>
                    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 40px 20px; }
                    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 32px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
                    .header { background: linear-gradient(135deg, #c41e3a, #1e3a8a); padding: 40px; text-align: center; position: relative; overflow: hidden; }
                    .header::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 1%, transparent 1%); background-size: 50px 50px; animation: shimmer 20s linear infinite; }
                    @keyframes shimmer { 0% { transform: translate(0,0); } 100% { transform: translate(50px,50px); } }
                    .header h1 { color: white; margin: 0; font-size: 28px; position: relative; z-index: 1; }
                    .header p { color: rgba(255,255,255,0.9); margin: 8px 0 0; position: relative; z-index: 1; }
                    .content { padding: 40px; }
                    .checkpoint-card { background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-radius: 24px; padding: 24px; margin: 24px 0; text-align: center; }
                    .checkpoint-icon { width: 64px; height: 64px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
                    .checkpoint-icon i { font-size: 32px; color: white; }
                    .progress-bar { background: #e2e8f0; border-radius: 30px; height: 8px; margin: 20px 0; overflow: hidden; }
                    .progress-fill { background: linear-gradient(90deg, #c41e3a, #1e3a8a); height: 100%; width: ${Math.round(shipment.status.progress)}%; border-radius: 30px; transition: width 0.5s ease; }
                    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
                    .stat { background: white; padding: 16px; border-radius: 16px; text-align: center; }
                    .stat-value { font-size: 24px; font-weight: 800; color: #c41e3a; }
                    .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
                    .button { background: linear-gradient(135deg, #c41e3a, #1e3a8a); color: white; padding: 14px 28px; text-decoration: none; border-radius: 40px; display: inline-block; font-weight: 600; margin-top: 24px; transition: transform 0.3s; }
                    .button:hover { transform: translateY(-2px); }
                    .footer { background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #eef2f6; color: #64748b; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📍 Checkpoint Reached!</h1>
                        <p>Your vehicle is making excellent progress</p>
                    </div>
                    <div class="content">
                        <div class="checkpoint-card">
                            <div class="checkpoint-icon">
                                <i class="fas fa-flag-checkered"></i>
                            </div>
                            <h2 style="margin-bottom: 8px;">${checkpoint.name}</h2>
                            <p style="color: #64748b;">Your vehicle has successfully reached this checkpoint</p>
                        </div>
                        
                        <div class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                        
                        <div class="stats">
                            <div class="stat">
                                <div class="stat-value">${Math.round(shipment.status.progress)}%</div>
                                <div class="stat-label">Journey Complete</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${Math.round(shipment.status.estimatedTimeRemaining / 3600)}h ${Math.round((shipment.status.estimatedTimeRemaining % 3600) / 60)}m</div>
                                <div class="stat-label">Est. Time Left</div>
                            </div>
                        </div>
                        
                        <div style="text-align: center;">
                            <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" class="button">
                                <i class="fas fa-map-marker-alt"></i> Track Live
                            </a>
                        </div>
                    </div>
                    <div class="footer">
                        <p>Lonestar Autos - Premium Vehicle Delivery</p>
                        <p>Questions? Call 1-888-LONESTAR or reply to this email</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        await sendEmail(shipment.customerInfo.email, `📍 Vehicle Update: Reached ${checkpoint.name}`, emailHtml);
    }
    
    async complete() {
        this.stop();
        
        const shipment = await Shipment.findById(this.shipmentId);
        if (shipment) {
            shipment.status.current = 'delivered';
            shipment.status.progress = 100;
            shipment.status.history.push({
                status: 'delivered',
                timestamp: new Date(),
                location: shipment.deliveryLocation.address,
                description: 'Vehicle has been successfully delivered!',
                notified: false
            });
            await safeSaveShipment(shipment);
            
            // Send delivery notification
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Vehicle Delivered! - Lonestar Autos</title>
                    <style>
                        body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 40px 20px; }
                        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 32px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
                        .header { background: linear-gradient(135deg, #10b981, #059669); padding: 40px; text-align: center; }
                        .header h1 { color: white; margin: 0; font-size: 28px; }
                        .content { padding: 40px; text-align: center; }
                        .checkmark { width: 80px; height: 80px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
                        .checkmark i { font-size: 40px; color: white; }
                        .button { background: linear-gradient(135deg, #c41e3a, #1e3a8a); color: white; padding: 14px 28px; text-decoration: none; border-radius: 40px; display: inline-block; font-weight: 600; margin-top: 24px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>🎉 Vehicle Delivered!</h1>
                        </div>
                        <div class="content">
                            <div class="checkmark">
                                <i class="fas fa-check"></i>
                            </div>
                            <h2>Congratulations ${shipment.customerInfo.name}!</h2>
                            <p>Your vehicle has been successfully delivered to:</p>
                            <p><strong>${shipment.deliveryLocation.address}</strong></p>
                            <p>We hope you enjoy your new vehicle from Lonestar Autos!</p>
                            <a href="http://localhost:3000" class="button">Rate Your Experience</a>
                        </div>
                    </div>
                </body>
                </html>
            `;
            await sendEmail(shipment.customerInfo.email, '🎉 Your Vehicle Has Been Delivered!', emailHtml);
            await broadcastTrackingUpdate(this.shipmentId, { type: 'delivered' });
        }
    }
    
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
    }
}




// ============================================================
// ADMIN AUTHENTICATION
// ============================================================
const adminAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Access denied. No token provided.' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. Invalid token format.' });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    if (verified.role !== 'admin' && verified.role !== 'super_admin') return res.status(403).json({ error: 'Not authorized. Admin access required.' });
    req.admin = verified;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token. Please login again.' });
  }
};

// ============================================================
// ADMIN LOGIN
// ============================================================
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email === 'henryrobert1840@gmail.com' && password === 'Admin2026') {
    const token = jwt.sign({ email, role: 'admin', name: 'Super Administrator' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, admin: { email, name: 'Super Administrator', role: 'admin' } });
  }
  try {
    const admin = await Admin.findOne({ email, isActive: true });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    admin.lastLogin = new Date();
    await admin.save();
    const token = jwt.sign({ email: admin.email, role: admin.role, id: admin._id, name: admin.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, admin: { email: admin.email, name: admin.name, role: admin.role } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// INVENTORY MANAGEMENT ROUTES (Public)
// ============================================================
app.get('/api/inventory', async (req, res) => {
  try {
    const { status, featured, make } = req.query;
    let query = {};
    if (status) query.status = status;
    if (featured) query.featured = featured === 'true';
    if (make) query.make = make;
    const inventory = await Inventory.find(query).sort({ createdAt: -1 });
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/:id', async (req, res) => {
  try {
    const vehicle = await Inventory.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// ============================================================
// INVENTORY MANAGEMENT ROUTES (Admin)
// ============================================================
app.get('/api/admin/inventory', adminAuth, async (req, res) => {
  try {
    const inventory = await Inventory.find().sort({ createdAt: -1 });
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/inventory', adminAuth, upload.array('images', 10), async (req, res) => {
    try {
      let vehicleData = JSON.parse(req.body.data);
      const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
      const downPayment = vehicleData.price * 0.1;
      const inventory = new Inventory({ ...vehicleData, images, downPayment, updatedAt: Date.now() });
      await inventory.save();
      res.status(201).json(inventory);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/inventory/:id', adminAuth, upload.array('images', 10), async (req, res) => {
    try {
      let updateData;
      if (req.files && req.files.length > 0) {
        const newImages = req.files.map(file => `/uploads/${file.filename}`);
        const existingData = JSON.parse(req.body.data);
        updateData = { ...existingData, images: [...(existingData.existingImages || []), ...newImages], updatedAt: Date.now() };
      } else {
        updateData = { ...JSON.parse(req.body.data), updatedAt: Date.now() };
      }
      if (updateData.price) updateData.downPayment = updateData.price * 0.1;
      const inventory = await Inventory.findByIdAndUpdate(req.params.id, updateData, { new: true });
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/inventory/:id', adminAuth, async (req, res) => {
  try {
    await Inventory.findByIdAndDelete(req.params.id);
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/inventory/:id/sold', adminAuth, async (req, res) => {
  try {
    const inventory = await Inventory.findByIdAndUpdate(req.params.id, { status: 'Sold', updatedAt: Date.now() }, { new: true });
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single shipment by ID (admin)
app.get('/api/admin/shipments/:id', adminAuth, async (req, res) => {
    try {
        const shipment = await Shipment.findById(req.params.id);
        if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
        res.json(shipment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// SHIPMENT MANAGEMENT ROUTES
// ============================================================

app.get('/api/admin/shipments', adminAuth, async (req, res) => {
  try {
      const shipments = await Shipment.find().sort({ createdAt: -1 });
      
      // Format shipments for frontend compatibility
      const formattedShipments = shipments.map(s => ({
          _id: s._id,
          trackingNumber: s.trackingNumber,
          customerInfo: s.customerInfo,
          vehicleInfo: s.vehicleInfo,
          status: s.status || 'pending',
          simulation: {
              isActive: s.simulation?.isActive || s.tracking?.isActive || false,
              progress: s.simulation?.progress || s.tracking?.progress || 0,
              status: s.simulation?.simStatus || (s.tracking?.isActive ? 'active' : 'inactive')
          },
          currentLocation: s.currentLocation || s.tracking?.currentPosition,
          shippingCost: s.shippingCost,
          createdAt: s.createdAt,
          carrierInfo: s.carrierInfo,
          tracking: s.tracking
      }));
      
      res.json(formattedShipments);
      
  } catch (error) {
      console.error('Shipments error:', error);
      res.status(500).json({ error: error.message });
  }
});

// CREATE SHIPMENT - UPDATED VERSION
app.post('/api/admin/shipments', adminAuth, async (req, res) => {
  try {
      const { customerInfo, vehicleInfo, pickupLocation, deliveryLocation, shippingCost, estimatedDays, carrierInfo } = req.body;
      
      const trackingNumber = `LSA${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const estimatedArrival = new Date(Date.now() + ((estimatedDays || 3) * 24 * 60 * 60 * 1000));
      
      const shipment = new Shipment({
          trackingNumber,
          customerInfo,
          vehicleInfo,
          pickupLocation: {
              ...pickupLocation,
              coordinates: pickupLocation.coordinates || { lat: 29.7604, lng: -95.3698 }
          },
          deliveryLocation: {
              ...deliveryLocation,
              coordinates: deliveryLocation.coordinates || { lat: 33.4484, lng: -112.0740 }
          },
          shippingCost,
          carrierInfo,
          estimatedDelivery: estimatedArrival,
          history: [{
              status: 'pending',
              timestamp: new Date(),
              location: pickupLocation.address,
              description: 'Shipment information received'
          }]
      });
      
      await safeSaveShipment(shipment);
      
      res.json({ 
          success: true, 
          trackingNumber: shipment.trackingNumber,
          shipmentId: shipment._id,
          message: 'Shipment created successfully'
      });
      
  } catch (error) {
      console.error('Create error:', error);
      res.status(500).json({ error: error.message });
  }
});


// Force sync progress for a shipment
app.post('/api/admin/shipments/:id/sync-progress', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const shipment = await Shipment.findById(id);
      
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      // Recalculate progress based on elapsed time
      let progress = shipment.tracking?.progress || 0;
      
      if (shipment.tracking?.isActive && shipment.tracking?.startTime) {
          const startTime = new Date(shipment.tracking.startTime).getTime();
          const endTime = new Date(shipment.tracking.estimatedArrival).getTime();
          const totalDuration = endTime - startTime;
          const elapsed = Date.now() - startTime;
          progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
          
          // Update database
          shipment.tracking.progress = progress;
          await safeSaveShipment(shipment);
          
          console.log(`🔄 Synced progress for ${shipment.trackingNumber}: ${Math.round(progress)}%`);
      }
      
      res.json({ 
          success: true, 
          progress: Math.round(progress),
          trackingNumber: shipment.trackingNumber 
      });
      
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TEST ENDPOINT - Manually send Order Processed email
// ============================================================
app.post('/api/admin/shipments/:id/send-order-email', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      console.log(`📧 Manual order email request for shipment: ${id}`);
      
      const shipment = await Shipment.findById(id);
      if (!shipment) {
          return res.status(404).json({ error: 'Shipment not found' });
      }
      
      console.log(`📧 Sending to: ${shipment.customerInfo?.email}`);
      console.log(`📧 Tracking: ${shipment.trackingNumber}`);
      
      const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
              <meta charset="UTF-8">
              <title>Order Processed - Lonestar Autos</title>
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
              <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
                  <div style="background: linear-gradient(135deg, #c41e3a, #1e3a8a); padding: 30px; text-align: center; color: white; border-radius: 16px 16px 0 0;">
                      <h1 style="margin: 0;">📋 Order Processed</h1>
                  </div>
                  <div style="padding: 30px;">
                      <h2>Hello ${shipment.customerInfo?.name || 'Customer'},</h2>
                      <p>Your vehicle shipment order has been processed successfully!</p>
                      <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
                          <p><strong>Tracking Number:</strong> ${shipment.trackingNumber}</p>
                          <p><strong>Vehicle:</strong> ${shipment.vehicleInfo?.year || ''} ${shipment.vehicleInfo?.make || ''} ${shipment.vehicleInfo?.model || ''}</p>
                          <p><strong>From:</strong> ${shipment.pickupLocation?.city || 'N/A'}, ${shipment.pickupLocation?.state || 'N/A'}</p>
                          <p><strong>To:</strong> ${shipment.deliveryLocation?.city || 'N/A'}, ${shipment.deliveryLocation?.state || 'N/A'}</p>
                      </div>
                      <div style="text-align: center;">
                          <a href="http://localhost:3000/track?number=${shipment.trackingNumber}" style="background: #c41e3a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 40px;">Track Your Vehicle</a>
                      </div>
                  </div>
                  <div style="background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b;">
                      <p>Lonestar Autos - Premium Vehicle Delivery</p>
                      <p>Questions? Call 1-888-LONESTAR</p>
                  </div>
              </div>
          </body>
          </html>
      `;
      
      const result = await resend.emails.send({
          from: MAIL_FROM,
          to: [shipment.customerInfo.email],
          subject: `📋 Order Processed - Your Vehicle Order Confirmation - ${shipment.trackingNumber}`,
          html: emailHtml
      });
      
      console.log(`✅ Email sent! ID: ${result?.data?.id}`);
      res.json({ 
          success: true, 
          message: 'Order Processed email sent successfully',
          emailId: result?.data?.id,
          to: shipment.customerInfo.email
      });
      
  } catch (error) {
      console.error('❌ Test email error:', error.message);
      res.status(500).json({ error: error.message });
  }
});


// ============================================================
// ADD THESE 4 ENDPOINTS TO server.js
// ============================================================

// 1. PAUSE TRACKING - WITH PROFESSIONAL EMAIL
app.post('/api/admin/shipments/:id/pause', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const shipment = await Shipment.findById(id);
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      if (!shipment.tracking?.isActive) {
          return res.status(400).json({ error: 'Tracking is not active. Start tracking first.' });
      }
      
      if (shipment.tracking.status === 'paused') {
          return res.status(400).json({ error: 'Shipment is already paused' });
      }
      
      // Save current progress
      const currentProgress = shipment.tracking.progress || 0;
      const currentPosition = shipment.tracking.currentPosition;
      
      // Clear simulation interval
      if (simulationIntervals.has(id)) {
          clearInterval(simulationIntervals.get(id));
          simulationIntervals.delete(id);
      }
      
      // Update shipment
      shipment.tracking.status = 'paused';
      shipment.tracking.pausedAt = new Date();
      shipment.tracking.pauseReason = reason || 'Paused by admin';
      shipment.tracking.pausedProgress = currentProgress;
      shipment.tracking.pausedPosition = currentPosition;
      shipment.status = 'paused';
      
      // Add to history
      shipment.history.push({
          status: 'paused',
          timestamp: new Date(),
          location: currentPosition?.address || 'In transit',
          description: `Shipment paused at ${Math.round(currentProgress)}%: ${reason || 'Admin action'}`
      });
      
      await safeSaveShipment(shipment);
      
      // Broadcast pause event
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          type: 'paused',
          progress: currentProgress,
          currentPosition: currentPosition,
          reason: reason,
          timestamp: new Date().toISOString()
      });
      
      // Send PROFESSIONAL pause email
      await sendPauseEmail(shipment, reason || 'Administrative hold', currentProgress, currentPosition?.address || 'In transit');
      
      console.log(`⏸️ Shipment paused at ${currentProgress}%: ${shipment.trackingNumber}`);
      res.json({ 
          success: true, 
          message: `Shipment paused at ${Math.round(currentProgress)}%`,
          progress: currentProgress
      });
      
  } catch (error) {
      console.error('Pause tracking error:', error);
      res.status(500).json({ error: error.message });
  }
});


// 2. RESUME TRACKING - WITH SAVED PROGRESS PRESERVATION
app.post('/api/admin/shipments/:id/resume', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      
      console.log(`▶️ Resume request for shipment: ${id}`);
      
      const shipment = await Shipment.findById(id);
      if (!shipment) {
          return res.status(404).json({ error: 'Shipment not found' });
      }
      
      // ============================================================
      // DETECT STATE AND GET SAVED PROGRESS
      // ============================================================
      const isPaused = shipment.tracking?.status === 'paused' || shipment.status === 'paused';
      const isSeized = shipment.status === 'seized';
      const isOnHold = shipment.status === 'on-hold';
      const isTrackingActive = shipment.tracking?.isActive === true;
      
      console.log(`📊 Shipment state: status=${shipment.status}, tracking.status=${shipment.tracking?.status}`);
      
      // Get saved progress from the appropriate field
      let savedProgress = 0;
      let savedPosition = null;
      
      if (isPaused) {
          savedProgress = shipment.tracking?.pausedProgress || 0;
          savedPosition = shipment.tracking?.pausedPosition;
          console.log(`📊 Paused shipment - Saved progress: ${savedProgress}%`);
      } else if (isSeized) {
          savedProgress = shipment.tracking?.seizedProgress || 0;
          savedPosition = shipment.tracking?.seizedPosition;
          console.log(`📊 Seized shipment - Saved progress: ${savedProgress}%`);
      } else if (isOnHold) {
          savedProgress = shipment.tracking?.holdProgress || 0;
          savedPosition = shipment.tracking?.holdPosition;
          console.log(`📊 On-hold shipment - Saved progress: ${savedProgress}%`);
      } else if (!isTrackingActive && shipment.status === 'pending') {
          savedProgress = 0;
          console.log(`🆕 Fresh shipment - Starting from 0%`);
      } else {
          return res.status(400).json({ 
              error: `Cannot resume. Status: ${shipment.status}, Tracking Active: ${isTrackingActive}` 
          });
      }
      
      // ============================================================
      // CRITICAL: USE ORIGINAL TOTAL DURATION - NOT DEFAULT
      // ============================================================
      const remainingProgress = 100 - savedProgress;
      
      // Get the ORIGINAL total duration from when tracking first started
      let totalDuration = shipment.tracking?.totalDuration;
      
      // If totalDuration is missing, calculate from estimated delivery
      if (!totalDuration && shipment.tracking?.estimatedArrival && shipment.tracking?.startTime) {
          totalDuration = (new Date(shipment.tracking.estimatedArrival) - new Date(shipment.tracking.startTime)) / 1000;
      }
      
      // Fallback only if absolutely necessary
      if (!totalDuration || totalDuration <= 0) {
          console.log(`⚠️ No totalDuration found, using default 3 days`);
          totalDuration = 72 * 3600; // 3 days default
      }
      
      // Calculate remaining time based on ORIGINAL duration
      const remainingSeconds = (remainingProgress / 100) * totalDuration;
      const remainingDays = remainingSeconds / 3600 / 24;  // Preserve decimals (e.g., 0.08 for 2 hours)
      
      console.log(`📊 Original total duration: ${(totalDuration / 3600).toFixed(1)} hours`);
      console.log(`📊 Saved progress: ${savedProgress}%`);
      console.log(`📊 Remaining: ${remainingProgress}% = ${(remainingSeconds / 3600).toFixed(1)} hours (${remainingDays.toFixed(2)} days)`);
      
      // ============================================================
      // CLEAR EXISTING INTERVAL
      // ============================================================
      if (simulationIntervals.has(id)) {
          clearInterval(simulationIntervals.get(id));
          simulationIntervals.delete(id);
          console.log(`🛑 Cleared existing tracking interval`);
      }
      
      // ============================================================
      // CALCULATE ADJUSTED START TIME TO RESUME FROM SAVED PROGRESS
      // ============================================================
      const elapsedSecondsToAchieveProgress = (savedProgress / 100) * totalDuration;
      const adjustedStartTime = new Date(Date.now() - (elapsedSecondsToAchieveProgress * 1000));
      const estimatedArrival = new Date(Date.now() + (remainingSeconds * 1000));
      
      console.log(`⏱️ Adjusted start time: ${adjustedStartTime.toLocaleString()}`);
      console.log(`📅 New ETA: ${estimatedArrival.toLocaleString()}`);
      
      // ============================================================
      // UPDATE SHIPMENT WITH RESUME DATA
      // ============================================================
      shipment.tracking.isActive = true;
      shipment.tracking.status = 'in-transit';
      shipment.tracking.startTime = adjustedStartTime;
      shipment.tracking.estimatedArrival = estimatedArrival;
      shipment.tracking.progress = savedProgress;
      shipment.tracking.timeRemaining = remainingSeconds;
      shipment.tracking.totalDuration = totalDuration;  // PRESERVE original duration
      shipment.tracking.distanceRemaining = shipment.route?.totalDistance * (remainingProgress / 100) || 0;
      
      // Restore saved position if available
      if (savedPosition && savedPosition.lat) {
          shipment.tracking.currentPosition = {
              lat: savedPosition.lat,
              lng: savedPosition.lng,
              address: savedPosition.address || `Resumed from ${Math.round(savedProgress)}%`,
              lastUpdated: new Date()
          };
      }
      
      // Update main status
      shipment.status = 'in-transit';
      
      // ============================================================
      // CLEAR ALL PAUSE/HOLD/SEIZE FIELDS
      // ============================================================
      shipment.tracking.pausedAt = null;
      shipment.tracking.pauseReason = null;
      shipment.tracking.pausedProgress = null;
      shipment.tracking.pausedPosition = null;
      
      shipment.tracking.holdAt = null;
      shipment.tracking.holdReason = null;
      shipment.tracking.holdProgress = null;
      shipment.tracking.holdPosition = null;
      
      shipment.tracking.seizedAt = null;
      shipment.tracking.seizeReason = null;
      shipment.tracking.seizedProgress = null;
      shipment.tracking.seizedPosition = null;
      shipment.tracking.seizedFullState = null;
      shipment.tracking.wasActiveBeforeSeizure = false;
      shipment.tracking.previousStatus = null;
      
      shipment.tracking.releasedAt = new Date();
      
      // ============================================================
      // ADD TO HISTORY
      // ============================================================
      let historyMessage = '';
      if (isPaused) {
          historyMessage = `Shipment resumed from ${Math.round(savedProgress)}% after pause`;
      } else if (isSeized) {
          historyMessage = `Shipment released and resumed from ${Math.round(savedProgress)}%`;
      } else if (isOnHold) {
          historyMessage = `Shipment released from hold and resumed from ${Math.round(savedProgress)}%`;
      } else {
          historyMessage = `Shipment tracking started from ${Math.round(savedProgress)}%`;
      }
      
      shipment.history.push({
          status: 'resumed',
          timestamp: new Date(),
          location: savedPosition?.address || 'In transit',
          description: historyMessage
      });
      
      await safeSaveShipment(shipment);
      
      // ============================================================
      // RESTART TRACKING WITH CORRECT REMAINING DAYS (preserve decimal)
      // ============================================================
      console.log(`🚀 Starting tracking from ${savedProgress}% with ${remainingDays.toFixed(2)} days remaining`);
      
      // Pass the EXACT remaining days (can be decimal like 0.08)
      const result = await startRealTimeTracking(id, remainingDays, savedProgress);
      
      if (result.error) {
          return res.status(400).json({ error: result.error });
      }
      
      // ============================================================
      // BROADCAST RESUME EVENT
      // ============================================================
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          type: 'resumed',
          status: 'in-transit',
          progress: savedProgress,
          remainingDays: remainingDays,
          eta: estimatedArrival.toLocaleString(),
          timestamp: new Date().toISOString()
      });
      
      // ============================================================
      // SEND PROFESSIONAL RESUME EMAIL
      // ============================================================
      await sendResumeEmail(shipment, savedProgress, Math.ceil(remainingDays), estimatedArrival.toLocaleString());
      
      console.log(`✅ Shipment RESUMED from ${savedProgress}%: ${shipment.trackingNumber}`);
      res.json({ 
          success: true, 
          message: `Shipment resumed from ${Math.round(savedProgress)}%`,
          progress: savedProgress,
          remainingDays: remainingDays,
          eta: estimatedArrival.toLocaleString(),
          trackingNumber: shipment.trackingNumber
      });
      
  } catch (error) {
      console.error('Resume tracking error:', error);
      res.status(500).json({ error: error.message });
  }
});



// 3. SEIZE SHIPMENT - WITH PROGRESS SAVING & PROFESSIONAL EMAIL
app.post('/api/admin/shipments/:id/seize', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const { reason } = req.body;
      
      console.log(`⚠️ Seize request for shipment: ${id}`);
      
      const shipment = await Shipment.findById(id);
      if (!shipment) {
          return res.status(404).json({ error: 'Shipment not found' });
      }
      
      // Check if shipment is already seized
      if (shipment.status === 'seized') {
          return res.status(400).json({ error: 'Shipment is already seized' });
      }
      
      // ============================================================
      // SAVE CURRENT STATE BEFORE SEIZURE - CRITICAL FOR RESUME
      // ============================================================
      const wasActive = shipment.tracking?.isActive || false;
      const previousStatus = shipment.status;
      const currentProgress = shipment.tracking?.progress || 0;
      const currentPosition = shipment.tracking?.currentPosition || shipment.pickupLocation?.coordinates;
      const currentTimeRemaining = shipment.tracking?.timeRemaining || 0;
      const currentDistanceRemaining = shipment.tracking?.distanceRemaining || 0;
      
      console.log(`📊 Seizing shipment - Saving state: status=${previousStatus}, progress=${currentProgress}%, wasActive=${wasActive}`);
      
      // Clear simulation interval if exists
      if (simulationIntervals.has(id)) {
          clearInterval(simulationIntervals.get(id));
          simulationIntervals.delete(id);
          console.log(`🛑 Stopped tracking at ${currentProgress}% before seizure`);
      }
      
      // ============================================================
      // UPDATE SHIPMENT WITH SEIZURE DATA & SAVED PROGRESS
      // ============================================================
      shipment.tracking = shipment.tracking || {};
      shipment.tracking.isActive = false;
      shipment.tracking.status = 'seized';
      shipment.tracking.seizedAt = new Date();
      shipment.tracking.seizeReason = reason || 'Shipment seized by authorities';
      
      // Store previous state for resume
      shipment.tracking.previousStatus = previousStatus;
      shipment.tracking.wasActiveBeforeSeizure = wasActive;
      shipment.tracking.seizedProgress = currentProgress;        // ← SAVES EXACT PROGRESS
      shipment.tracking.seizedPosition = currentPosition;        // ← SAVES EXACT POSITION
      shipment.tracking.seizedTimeRemaining = currentTimeRemaining;
      shipment.tracking.seizedDistanceRemaining = currentDistanceRemaining;
      
      // Store full state for exact resume
      if (wasActive && shipment.tracking.startTime) {
          shipment.tracking.seizedFullState = {
              progress: currentProgress,
              position: currentPosition,
              timeRemaining: currentTimeRemaining,
              distanceRemaining: currentDistanceRemaining,
              elapsedSeconds: (Date.now() - new Date(shipment.tracking.startTime).getTime()) / 1000,
              totalDuration: shipment.tracking.totalDuration,
              startTime: shipment.tracking.startTime,
              estimatedArrival: shipment.tracking.estimatedArrival
          };
      }
      
      // Update main status
      shipment.status = 'seized';
      
      // Add to history with progress info
      shipment.history = shipment.history || [];
      shipment.history.push({
          status: 'seized',
          timestamp: new Date(),
          location: currentPosition?.address || 'Unknown location',
          description: `Shipment SEIZED at ${Math.round(currentProgress)}%: ${reason || 'By authorities'}`
      });
      
      await safeSaveShipment(shipment);
      
      // ============================================================
      // BROADCAST SEIZE EVENT TO TRACKING PAGE
      // ============================================================
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          type: 'seized',
          reason: reason,
          progress: currentProgress,
          position: currentPosition,
          timestamp: new Date().toISOString()
      });
      
      // ============================================================
      // SEND PROFESSIONAL SEIZE EMAIL WITH PROGRESS DETAILS
      // ============================================================
      await sendSeizeEmail(shipment, reason || 'Authorities inspection', currentProgress, currentPosition?.address || 'Inspection facility');
      
      console.log(`⚠️ Shipment SEIZED at ${currentProgress}%: ${shipment.trackingNumber}`);
      res.json({ 
          success: true, 
          message: `Shipment seized at ${Math.round(currentProgress)}%`,
          progress: currentProgress,
          trackingNumber: shipment.trackingNumber,
          previousState: { status: previousStatus, progress: currentProgress, wasActive: wasActive }
      });
      
  } catch (error) {
      console.error('Seize shipment error:', error);
      res.status(500).json({ error: error.message });
  }
});


// 4. HOLD SHIPMENT - WITH PROFESSIONAL EMAIL
app.post('/api/admin/shipments/:id/hold', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const shipment = await Shipment.findById(id);
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      if (shipment.status === 'on-hold') {
          return res.status(400).json({ error: 'Shipment is already on hold' });
      }
      
      const currentProgress = shipment.tracking?.progress || 0;
      const currentPosition = shipment.tracking?.currentPosition || shipment.pickupLocation?.coordinates;
      
      if (simulationIntervals.has(id)) {
          clearInterval(simulationIntervals.get(id));
          simulationIntervals.delete(id);
      }
      
      shipment.tracking.isActive = false;
      shipment.tracking.status = 'on-hold';
      shipment.tracking.holdAt = new Date();
      shipment.tracking.holdReason = reason || 'Pending verification';
      shipment.tracking.holdProgress = currentProgress;
      shipment.status = 'on-hold';
      
      shipment.history.push({
          status: 'on-hold',
          timestamp: new Date(),
          location: currentPosition?.address || 'At facility',
          description: `Shipment on hold at ${Math.round(currentProgress)}%: ${reason || 'Pending verification'}`
      });
      
      await safeSaveShipment(shipment);
      
      // Send PROFESSIONAL hold email
      await sendHoldEmail(shipment, reason || 'Pending verification', currentProgress, currentPosition?.address || 'At facility');
      
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          type: 'hold',
          reason: reason,
          progress: currentProgress,
          timestamp: new Date().toISOString()
      });
      
      console.log(`⏸️ Shipment on HOLD at ${currentProgress}%: ${shipment.trackingNumber}`);
      res.json({ 
          success: true, 
          message: `Shipment placed on hold at ${Math.round(currentProgress)}%`,
          progress: currentProgress
      });
      
  } catch (error) {
      console.error('Hold shipment error:', error);
      res.status(500).json({ error: error.message });
  }
});


// 5. RELEASE SEIZED SHIPMENT - RESUME FROM SAVED PROGRESS
app.post('/api/admin/shipments/:id/release', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const { reason, restoreTracking } = req.body;
      
      console.log(`🔓 Release request for shipment: ${id}`);
      
      const shipment = await Shipment.findById(id);
      if (!shipment) {
          return res.status(404).json({ error: 'Shipment not found' });
      }
      
      // Check if shipment is seized
      if (shipment.status !== 'seized') {
          return res.status(400).json({ error: 'Shipment is not seized. Current status: ' + shipment.status });
      }
      
      // ============================================================
      // GET SAVED PROGRESS FROM SEIZURE
      // ============================================================
      const savedProgress = shipment.tracking?.seizedProgress || 0;
      const savedPosition = shipment.tracking?.seizedPosition;
      const savedTimeRemaining = shipment.tracking?.seizedTimeRemaining || 0;
      const wasActiveBeforeSeizure = shipment.tracking?.wasActiveBeforeSeizure || false;
      
      console.log(`📊 Releasing seized shipment - Saved progress: ${savedProgress}%, wasActive: ${wasActiveBeforeSeizure}`);
      
      // Calculate remaining time based on saved progress
      const remainingProgress = 100 - savedProgress;
      const totalDuration = shipment.tracking?.totalDuration || (72 * 3600);
      const remainingSeconds = (remainingProgress / 100) * totalDuration;
      const remainingDays = Math.max(1, Math.ceil(remainingSeconds / 3600 / 24));
      const eta = new Date(Date.now() + (remainingSeconds * 1000)).toLocaleString();
      
      // Determine new status
      let newStatus = 'pending';
      let newTrackingStatus = 'pending';
      
      if (restoreTracking !== false && wasActiveBeforeSeizure) {
          newStatus = 'in-transit';
          newTrackingStatus = 'in-transit';
          console.log(`🚀 Restoring tracking from ${savedProgress}% with ${remainingDays} days remaining`);
      } else {
          newStatus = 'pending';
          newTrackingStatus = 'pending';
          console.log(`📦 Setting to pending state (no tracking restoration)`);
      }
      
      // Clear any existing interval
      if (simulationIntervals.has(id)) {
          clearInterval(simulationIntervals.get(id));
          simulationIntervals.delete(id);
      }
      
      // ============================================================
      // UPDATE SHIPMENT FOR RESUME
      // ============================================================
      
      if (restoreTracking !== false && wasActiveBeforeSeizure) {
          // Calculate adjusted start time to resume from saved progress
          const elapsedSecondsToAchieveProgress = (savedProgress / 100) * totalDuration;
          const adjustedStartTime = new Date(Date.now() - (elapsedSecondsToAchieveProgress * 1000));
          const estimatedArrival = new Date(Date.now() + (remainingSeconds * 1000));
          
          // Restore tracking with saved progress
          shipment.tracking.isActive = true;
          shipment.tracking.status = 'in-transit';
          shipment.tracking.startTime = adjustedStartTime;
          shipment.tracking.estimatedArrival = estimatedArrival;
          shipment.tracking.progress = savedProgress;
          shipment.tracking.timeRemaining = remainingSeconds;
          shipment.tracking.distanceRemaining = savedTimeRemaining;
          
          // Restore position if available
          if (savedPosition && savedPosition.lat) {
              shipment.tracking.currentPosition = {
                  lat: savedPosition.lat,
                  lng: savedPosition.lng,
                  address: savedPosition.address || `Resumed from ${Math.round(savedProgress)}%`,
                  lastUpdated: new Date()
              };
          }
          
          // Start tracking again
          await startRealTimeTracking(id, remainingDays);
      } else {
          // Just update status without tracking
          shipment.tracking.isActive = false;
          shipment.tracking.status = 'pending';
      }
      
      // Clear seizure fields
      shipment.tracking.seizedAt = null;
      shipment.tracking.seizeReason = null;
      shipment.tracking.seizedProgress = null;
      shipment.tracking.seizedPosition = null;
      shipment.tracking.seizedFullState = null;
      shipment.tracking.wasActiveBeforeSeizure = false;
      shipment.tracking.previousStatus = null;
      
      // Update main status
      shipment.status = newStatus;
      
      // Add to history
      shipment.history.push({
          status: 'released',
          timestamp: new Date(),
          location: savedPosition?.address || shipment.pickupLocation?.address,
          description: `Shipment RELEASED from ${Math.round(savedProgress)}%: ${reason || 'Legal review completed'}`
      });
      
      await safeSaveShipment(shipment);
      
      // ============================================================
      // BROADCAST RELEASE EVENT
      // ============================================================
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          type: 'released',
          reason: reason,
          newStatus: newStatus,
          progress: savedProgress,
          timestamp: new Date().toISOString()
      });
      
      // ============================================================
      // SEND PROFESSIONAL RELEASE EMAIL
      // ============================================================
      await sendReleaseEmail(shipment, reason || 'Legal review completed', newStatus, savedProgress);
      
      console.log(`✅ Shipment RELEASED from ${savedProgress}%: ${shipment.trackingNumber}`);
      res.json({ 
          success: true, 
          message: `Shipment released from ${Math.round(savedProgress)}%`,
          newStatus: newStatus,
          progress: savedProgress,
          trackingNumber: shipment.trackingNumber
      });
      
  } catch (error) {
      console.error('Release shipment error:', error);
      res.status(500).json({ error: error.message });
  }
});



// Update shipment (admin)
app.put('/api/admin/shipments/:id', adminAuth, async (req, res) => {
  try {
      const shipment = await Shipment.findById(req.params.id);
      if (!shipment) {
          return res.status(404).json({ error: 'Shipment not found' });
      }
      
      const updateData = req.body;
      updateData.updatedAt = Date.now();
      
      // Handle status mapping
      if (updateData.status) {
          updateData.legacyStatus = updateData.status;
          delete updateData.status;
      }
      
      // Handle simulation data
      if (updateData.simulation) {
          if (shipment.simulation) {
              shipment.simulation = {
                  ...shipment.simulation.toObject(),
                  ...updateData.simulation,
                  simStatus: updateData.simulation.status || shipment.simulation.simStatus
              };
              delete updateData.simulation;
          } else {
              shipment.simulation = {
                  ...updateData.simulation,
                  simStatus: updateData.simulation.status || 'active'
              };
              delete updateData.simulation;
          }
      }
      
      // Update other fields
      Object.assign(shipment, updateData);
      
      await safeSaveShipment(shipment);
      
      console.log(`✅ Shipment updated: ${shipment.trackingNumber}`);
      res.json({ success: true, shipment });
      
  } catch (error) {
      console.error('Error updating shipment:', error);
      res.status(500).json({ error: error.message });
  }
});

// Delete shipment (admin)
app.delete('/api/admin/shipments/:id', adminAuth, async (req, res) => {
  try {
    if (simulationIntervals.has(req.params.id)) { clearInterval(simulationIntervals.get(req.params.id)); simulationIntervals.delete(req.params.id); }
    await Shipment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Shipment deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// START TRACKING ROUTE - ADD AFTER OTHER SHIPMENT ROUTES
// ============================================================
app.post('/api/admin/shipments/:id/start-tracking', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estimatedDays } = req.body;
    
    if (!estimatedDays || estimatedDays <= 0) {
        return res.status(400).json({ error: 'Please provide valid estimated days (minimum 0.1 for testing)' });
    }
    
    // Allow decimals but minimum 0.1 days (2.4 hours)
    const days = parseFloat(estimatedDays);
    if (days < 0.1) {
        return res.status(400).json({ error: 'Minimum estimated days is 0.1 (2.4 hours) for testing' });
    }
      const shipment = await Shipment.findById(id);
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      if (!shipment.pickupLocation?.coordinates?.lat || !shipment.deliveryLocation?.coordinates?.lat) {
          return res.status(400).json({ error: 'Missing coordinates. Please update pickup/delivery locations first.' });
      }
      
      const result = await startRealTimeTracking(id, estimatedDays);
      
      if (result.error) {
          return res.status(400).json({ error: result.error });
      }
      
      res.json({ 
          success: true, 
          message: `Real-time tracking started! Vehicle will arrive in ${estimatedDays} days.`,
          trackingNumber: result.trackingNumber 
      });
      
  } catch (error) {
      console.error('Start tracking error:', error);
      res.status(500).json({ error: error.message });
  }
});




// ============================================================
// MANUAL POSITION OVERRIDE ROUTE - Admin can set custom location
// ============================================================
app.post('/api/admin/shipments/:id/manual-override', adminAuth, async (req, res) => {
  try {
      const { id } = req.params;
      const { lat, lng, progress, reason } = req.body;
      
      const shipment = await Shipment.findById(id);
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      shipment.tracking.manualOverride = {
          isActive: true,
          customLat: lat,
          customLng: lng,
          customProgress: progress,
          setBy: req.admin.email,
          setAt: new Date(),
          reason: reason || 'Manual override by admin'
      };
      
      shipment.tracking.currentPosition = {
          lat: lat,
          lng: lng,
          address: `Manual override - ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lastUpdated: new Date()
      };
      shipment.tracking.progress = progress;
      
      shipment.history.push({
          status: 'manual-override',
          timestamp: new Date(),
          location: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          description: `Position manually set by admin: ${reason || 'No reason provided'}`
      });
      
      await safeSaveShipment(shipment);
      
      await broadcastTrackingUpdate(shipment.trackingNumber, {
          trackingNumber: shipment.trackingNumber,
          progress: progress,
          currentPosition: { lat, lng },
          manualOverride: true
      });
      
      res.json({ success: true, message: 'Position manually overridden' });
      
  } catch (error) {
      console.error('Manual override error:', error);
      res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TRACKING ROUTES (Public)
// ============================================================
app.get('/api/track/:trackingNumber', async (req, res) => {
  try {
      const shipment = await Shipment.findOne({ trackingNumber: req.params.trackingNumber });
      if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
      
      // ============================================================
      // SINGLE SOURCE OF TRUTH: Use database progress or calculate once
      // ============================================================
      let progress = 0;
      let currentPosition = null;
      let remainingTime = null;
      let distanceRemaining = 0;
      
      // Check if tracking is active
      if (shipment.tracking && shipment.tracking.isActive && shipment.tracking.startTime) {
          // Calculate progress based on elapsed time
          const startTime = new Date(shipment.tracking.startTime).getTime();
          const endTime = new Date(shipment.tracking.estimatedArrival).getTime();
          const totalDuration = endTime - startTime;
          const elapsed = Date.now() - startTime;
          let calculatedProgress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
          
          // Set minimum progress to 1% for better UX
          if (calculatedProgress > 0 && calculatedProgress < 1) calculatedProgress = 1;
          
          // ============================================================
          // CRITICAL: Use calculated progress as the source of truth
          // ============================================================
          progress = calculatedProgress;
          
          // Update database every few seconds to keep admin panel in sync
          // Only update if difference is more than 1% to avoid too many writes
          const dbProgress = shipment.tracking?.progress || 0;
          if (Math.abs(progress - dbProgress) >= 1) {
              await Shipment.updateOne(
                  { trackingNumber: req.params.trackingNumber },
                  { $set: { 'tracking.progress': progress } }
              );
              console.log(`🔄 Synced progress for ${shipment.trackingNumber}: ${Math.round(progress)}%`);
          }
          
          // Calculate current position along route
          const startLat = shipment.pickupLocation.coordinates.lat;
          const startLng = shipment.pickupLocation.coordinates.lng;
          const endLat = shipment.deliveryLocation.coordinates.lat;
          const endLng = shipment.deliveryLocation.coordinates.lng;
          const fraction = progress / 100;
          currentPosition = {
              lat: startLat + (endLat - startLat) * fraction,
              lng: startLng + (endLng - startLng) * fraction,
              address: `${startLat + (endLat - startLat) * fraction}, ${startLng + (endLng - startLng) * fraction}`
          };
          
          // Calculate remaining time
          const remainingMs = Math.max(0, endTime - Date.now());
          remainingTime = {
              days: Math.floor(remainingMs / (1000 * 60 * 60 * 24)),
              hours: Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
              minutes: Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)),
              totalHours: remainingMs / (1000 * 60 * 60)
          };
          
          // Calculate distance remaining
          const totalDistance = calculateDistance(startLat, startLng, endLat, endLng);
          distanceRemaining = totalDistance * (1 - fraction);
      } else {
          // Use stored progress if tracking not active
          progress = shipment.tracking?.progress || 0;
      }
      
      // Generate route points for map
      let routePoints = [];
      if (shipment.pickupLocation?.coordinates && shipment.deliveryLocation?.coordinates) {
          const start = shipment.pickupLocation.coordinates;
          const end = shipment.deliveryLocation.coordinates;
          for (let i = 0; i <= 50; i++) {
              const f = i / 50;
              routePoints.push({
                  lat: start.lat + (end.lat - start.lat) * f,
                  lng: start.lng + (end.lng - start.lng) * f
              });
          }
      }
      
      // ============================================================
      // MILESTONE STATUS CALCULATION - Based on actual progress
      // ============================================================
      const milestoneDefinitions = [
          { name: "Order Processed", description: "Shipment information received", threshold: 0 },
          { name: "Pickup Scheduled", description: "Carrier assigned for pickup", threshold: 8 },
          { name: "Vehicle Picked Up", description: "Vehicle in carrier possession", threshold: 18 },
          { name: "Departed Facility", description: "Left origin facility", threshold: 28 },
          { name: "Arrived at Regional Hub", description: "Arrived at major sorting facility", threshold: 42 },
          { name: "In Transit", description: "Vehicle moving to destination", threshold: 55 },
          { name: "Arrived at Destination Hub", description: "Arrived at local distribution center", threshold: 72 },
          { name: "Out for Delivery", description: "Vehicle loaded for final delivery", threshold: 88 },
          { name: "Delivered", description: "Vehicle delivered to destination", threshold: 99 }
      ];
      
      const milestones = milestoneDefinitions.map(def => {
          let status = 'pending';
          let reachedAt = null;
          
          if (progress >= def.threshold) {
              status = 'completed';
              if (def.threshold === 0) {
                  reachedAt = shipment.createdAt;
              } else {
                  // Try to find reached time from history
                  const historyItem = shipment.history?.find(h => 
                      h.status?.toLowerCase().includes(def.name.toLowerCase().replace(/\s/g, '-'))
                  );
                  if (historyItem) reachedAt = historyItem.timestamp;
              }
          } else if (progress >= def.threshold - 5 && progress < def.threshold) {
              status = 'active';
          }
          
          return {
              name: def.name,
              description: def.description,
              status: status,
              reachedAt: reachedAt
          };
      });
      
      // ============================================================
      // RESPONSE WITH CONSISTENT PROGRESS
      // ============================================================
      res.json({
          trackingNumber: shipment.trackingNumber,
          customerName: shipment.customerInfo?.name,
          vehicleInfo: shipment.vehicleInfo,
          pickupLocation: shipment.pickupLocation,
          deliveryLocation: shipment.deliveryLocation,
          currentLocation: currentPosition || shipment.pickupLocation,
          status: shipment.tracking?.status || shipment.status || 'pending',
          history: shipment.history || [],
          carrierInfo: shipment.carrierInfo,
          estimatedDelivery: shipment.tracking?.estimatedArrival || shipment.estimatedDelivery,
          route: { points: routePoints },
          tracking: {
              progress: Math.round(progress),  // ← SINGLE SOURCE OF TRUTH
              remainingTime: remainingTime,
              distanceRemaining: Math.round(distanceRemaining),
              isActive: shipment.tracking?.isActive || false
          },
          milestones: milestones
      });
      
  } catch (error) {
      console.error('Tracking error:', error);
      res.status(500).json({ error: 'Server error' });
  }
});


// Helper function to get progress address
function getProgressAddress(progress, pickup, delivery) {
  if (progress < 0.1) return `${pickup.city}, ${pickup.state}`;
  if (progress < 0.25) return `En Route to ${getNextMajorCity(pickup.state, delivery.state)}`;
  if (progress < 0.5) return `Regional Transit Hub - ${getRegionalHub(pickup.state, delivery.state)}`;
  if (progress < 0.75) return `Distribution Center - ${getDistributionCenter(delivery.state)}`;
  if (progress < 0.95) return `Local Terminal - ${delivery.city}`;
  return `Approaching ${delivery.city}, ${delivery.state}`;
}

// Helper function to generate REAL milestones
function generateRealMilestones(progress, shipment) {
  const milestones = [
      { 
          name: "Order Processed", 
          description: "Shipment information received", 
          status: "completed", 
          timestamp: shipment.createdAt 
      },
      { 
          name: "Pickup Scheduled", 
          description: "Carrier assigned for pickup", 
          status: progress >= 5 ? "completed" : "pending", 
          timestamp: progress >= 5 ? shipment.tracking?.startTime : null 
      },
      { 
          name: "Vehicle Picked Up", 
          description: "Vehicle in carrier possession", 
          status: progress >= 15 ? "completed" : "pending", 
          timestamp: progress >= 15 ? shipment.tracking?.startTime : null 
      },
      { 
          name: "Departed Facility", 
          description: `Left ${shipment.pickupLocation?.city} facility`, 
          status: progress >= 25 ? "completed" : "pending", 
          timestamp: progress >= 25 ? new Date(Date.now() - (1000 * 60 * 60 * 24)) : null 
      },
      { 
          name: "Arrived at Hub", 
          description: `Arrived at regional sorting facility`, 
          status: progress >= 45 ? "completed" : progress >= 35 ? "active" : "pending", 
          timestamp: progress >= 45 ? new Date(Date.now() - (1000 * 60 * 60 * 12)) : null 
      },
      { 
          name: "In Transit", 
          description: "Vehicle moving to destination", 
          status: progress >= 60 ? "completed" : progress >= 50 ? "active" : "pending", 
          timestamp: progress >= 60 ? new Date(Date.now() - (1000 * 60 * 60 * 6)) : null 
      },
      { 
          name: "Arrived at Destination Facility", 
          description: `Arrived at ${shipment.deliveryLocation?.city} facility`, 
          status: progress >= 80 ? "completed" : progress >= 70 ? "active" : "pending", 
          timestamp: progress >= 80 ? new Date(Date.now() - (1000 * 60 * 60 * 2)) : null 
      },
      { 
          name: "Out for Delivery", 
          description: "Vehicle loaded for final delivery", 
          status: progress >= 90 ? "active" : "pending", 
          timestamp: progress >= 90 ? new Date() : null 
      },
      { 
          name: "Delivered", 
          description: `Delivered to ${shipment.deliveryLocation?.address}`, 
          status: progress >= 99 ? "active" : "pending", 
          timestamp: progress >= 99 ? new Date() : null 
      }
  ];
  
  return milestones;
}

function getNextMajorCity(fromState, toState) {
  const hubs = {
      'TX': 'Dallas, TX',
      'CA': 'Los Angeles, CA',
      'NY': 'New York, NY',
      'FL': 'Miami, FL',
      'IL': 'Chicago, IL',
      'AZ': 'Phoenix, AZ',
      'default': 'Regional Hub'
  };
  return hubs[toState] || hubs.default;
}

function getRegionalHub(fromState, toState) {
  const hubs = {
      'TX-AZ': 'El Paso, TX',
      'CA-NY': 'Chicago, IL',
      'FL-TX': 'Atlanta, GA',
      'default': 'Memphis, TN'
  };
  const key = `${fromState}-${toState}`;
  return hubs[key] || hubs.default;
}

function getDistributionCenter(state) {
  const centers = {
      'TX': 'Dallas, TX',
      'CA': 'Sacramento, CA',
      'NY': 'Albany, NY',
      'FL': 'Orlando, FL',
      'AZ': 'Phoenix, AZ',
      'default': 'Distribution Center'
  };
  return centers[state] || centers.default;
}

// ============================================================
// PAYMENT METHOD MANAGEMENT ROUTES
// ============================================================

// GET all payment methods (Admin)
app.get('/api/admin/payment-methods', adminAuth, async (req, res) => {
    try {
      const methods = await PaymentMethod.find().sort({ displayOrder: 1 });
      res.json(methods);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET single payment method (Admin)
  app.get('/api/admin/payment-methods/:id', adminAuth, async (req, res) => {
    try {
      const method = await PaymentMethod.findById(req.params.id);
      if (!method) return res.status(404).json({ error: 'Payment method not found' });
      res.json(method);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  

  // CREATE payment method (Admin)
app.post('/api/admin/payment-methods', adminAuth, async (req, res) => {
    try {
        const { name, displayName, accountDetails, isActive, displayOrder, icon, color } = req.body;
        
        console.log('🔧 Creating payment method:', { name, displayName });
        
        // Check if method already exists
        const existing = await PaymentMethod.findOne({ name });
        if (existing) {
            return res.status(400).json({ error: 'Payment method already exists' });
        }
        
        // Validate required fields
        if (!name || !displayName) {
            return res.status(400).json({ error: 'Name and displayName are required' });
        }
        
        const method = new PaymentMethod({
            name,
            displayName,
            accountDetails: accountDetails || {},
            isActive: isActive !== false,
            displayOrder: displayOrder || 0,
            icon: icon || getDefaultIcon(name),
            color: color || '#c41e3a'
        });
        
        await method.save();
        
        console.log('✅ Payment method created:', method.name);
        res.status(201).json(method);
        
    } catch (error) {
        console.error('❌ Create error:', error);
        res.status(500).json({ error: error.message });
    }
});
  
  
  // UPDATE payment method (Admin)
  app.put('/api/admin/payment-methods/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { displayName, accountDetails, isActive, displayOrder, imageUrl, color } = req.body;
        
        console.log('🔧 Updating payment method:', { id, displayName, imageUrl });
        
        const method = await PaymentMethod.findById(id);
        if (!method) {
            return res.status(404).json({ error: 'Payment method not found' });
        }
        
        // Update fields
        if (displayName !== undefined) method.displayName = displayName;
        if (isActive !== undefined) method.isActive = isActive;
        if (displayOrder !== undefined) method.displayOrder = displayOrder;
        if (color !== undefined) method.color = color;
        if (imageUrl !== undefined) method.imageUrl = imageUrl;  // ← CRITICAL: Save imageUrl
        
        if (accountDetails !== undefined) {
            method.accountDetails = {
                ...method.accountDetails,
                ...accountDetails
            };
        }
        
        method.updatedAt = new Date();
        await method.save();
        
        console.log('✅ Updated method:', { name: method.name, imageUrl: method.imageUrl });
        res.json(method);
        
    } catch (error) {
        console.error('❌ Update error:', error);
        res.status(500).json({ error: error.message });
    }
});
  
  // DELETE payment method (Admin)
  app.delete('/api/admin/payment-methods/:id', adminAuth, async (req, res) => {
    try {
      const method = await PaymentMethod.findByIdAndDelete(req.params.id);
      if (!method) return res.status(404).json({ error: 'Payment method not found' });
      res.json({ message: 'Payment method deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Helper function for default icons
  function getDefaultIcon(name) {
    const icons = {
      venmo: 'fab fa-venmo',
      cashapp: 'fab fa-cashapp',
      paypal: 'fab fa-paypal',
      wire_transfer: 'fas fa-university',
      bank_transfer: 'fas fa-building-columns'
    };
    return icons[name] || 'fas fa-credit-card';
  }

  // TOGGLE SUSPENSION (Admin)
app.post('/api/admin/payment-methods/:id/toggle-suspend', adminAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const method = await PaymentMethod.findById(id);
      if (!method) return res.status(404).json({ error: 'Payment method not found' });
      
      method.isSuspended = !method.isSuspended;
      method.updatedAt = new Date();
      await method.save();
      
      console.log(`🔧 Payment method ${method.name} is now ${method.isSuspended ? 'SUSPENDED' : 'ACTIVE'}`);
      res.json({ success: true, isSuspended: method.isSuspended, message: `${method.displayName} is now ${method.isSuspended ? 'suspended' : 'active'}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // ============================================================
  // PUBLIC API - Get active payment methods for checkout
  // ============================================================
  app.get('/api/payment-methods', async (req, res) => {
    try {
      const methods = await PaymentMethod.find({ isActive: true }).sort({ displayOrder: 1 });
      res.json(methods);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// ============================================================
// RESERVATION ROUTES
// ============================================================
app.post('/api/create-reservation', async (req, res) => {
  try {
    const { vehicleId, vehicleInfo, customerInfo, downPayment, totalPrice, deliveryDate, notes } = req.body;
    const vehicle = await Inventory.findById(vehicleId);
    if (!vehicle || vehicle.status === 'Sold') return res.status(400).json({ error: 'Vehicle is no longer available' });
    const reservationNumber = `RES${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reservation = new Reservation({ reservationNumber, vehicleId, vehicleInfo, customerInfo, downPayment, totalPrice, remainingBalance: totalPrice - downPayment, paymentStatus: 'paid', status: 'confirmed', deliveryDate, notes });
    await reservation.save();
    res.json({ success: true, reservationId: reservation._id, reservationNumber, downPayment, remainingBalance: reservation.remainingBalance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reservation/:id', async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/reservations', adminAuth, async (req, res) => {
  try {
    const reservations = await Reservation.find().sort({ createdAt: -1 });
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/reservations/:id', adminAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const reservation = await Reservation.findByIdAndUpdate(req.params.id, { status, notes, updatedAt: Date.now() }, { new: true });
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// SEED DEFAULT PAYMENT METHODS (Run once)
// ============================================================
async function seedPaymentMethods() {
    const count = await PaymentMethod.countDocuments();
    if (count === 0) {
        console.log('🌱 Seeding default payment methods...');
        
        const defaultMethods = [
            {
                name: 'venmo',
                displayName: 'Venmo',
                accountDetails: { username: '@LonestarAutos', instructions: 'Send payment to @LonestarAutos and include your reservation number.' },
                isActive: true,
                displayOrder: 1,
                icon: 'fab fa-venmo',
                color: '#008CFF'
            },
            {
                name: 'cashapp',
                displayName: 'Cash App',
                accountDetails: { username: '$LonestarAutos', instructions: 'Send payment to $LonestarAutos and include your reservation number.' },
                isActive: true,
                displayOrder: 2,
                icon: 'fab fa-cashapp',
                color: '#00D632'
            },
            {
                name: 'paypal',
                displayName: 'PayPal',
                accountDetails: { email: 'sales@lonestarautos.com', instructions: 'Send payment to sales@lonestarautos.com and include your reservation number.' },
                isActive: true,
                displayOrder: 3,
                icon: 'fab fa-paypal',
                color: '#0070ba'
            }
        ];
        
        for (const method of defaultMethods) {
            await PaymentMethod.create(method);
        }
        console.log('✅ Default payment methods seeded');
    }
}

// Call this after defining PaymentMethod model
seedPaymentMethods();

// ============================================================
// PAYMENT ROUTES
// ============================================================
app.post('/api/create-payment', async (req, res) => {
    try {
      const { paymentType, paymentMethod, amount, totalPrice, vehicleId, vehicleInfo, customerInfo, deliveryDetails } = req.body;
      let normalizedMethod = paymentMethod;
      if (paymentMethod === 'cashapp' || paymentMethod === 'cash app' || paymentMethod === 'cash' || paymentMethod === 'Cash App' || paymentMethod === 'CashApp') normalizedMethod = 'cashapp';
      else if (paymentMethod === 'paypal' || paymentMethod === 'PayPal' || paymentMethod === 'Paypal') normalizedMethod = 'paypal';
      else if (paymentMethod === 'venmo' || paymentMethod === 'Venmo') normalizedMethod = 'venmo';
      else if (paymentMethod === 'wire_transfer' || paymentMethod === 'wire transfer' || paymentMethod === 'Wire Transfer') normalizedMethod = 'wire_transfer';
      else if (paymentMethod === 'card' || paymentMethod === 'credit card' || paymentMethod === 'Credit Card') normalizedMethod = 'card';
      else normalizedMethod = 'unknown';
      console.log(`📝 Payment method: "${paymentMethod}" → "${normalizedMethod}"`);
      const paymentId = `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const remainingBalance = paymentType === 'down_payment' ? totalPrice - amount : 0;
      const vehicle = await Inventory.findById(vehicleId);
      if (!vehicle || (vehicle.status === 'Sold' && paymentType === 'full_payment')) return res.status(400).json({ error: 'Vehicle is no longer available' });
      const payment = new Payment({ paymentId, vehicleId, vehicleInfo, customerInfo, deliveryDetails, paymentType, paymentMethod: normalizedMethod, amount, totalPrice, remainingBalance, status: 'pending' });
      await payment.save();
      if (paymentType === 'down_payment') {
        const reservationNumber = `RES${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const reservation = new Reservation({ reservationNumber, vehicleId, vehicleInfo, customerInfo: { name: customerInfo.name, email: customerInfo.email, phone: customerInfo.phone, address: customerInfo.address }, downPayment: amount, totalPrice, remainingBalance, paymentStatus: 'pending', status: 'pending', deliveryDate: deliveryDetails.preferredDate, notes: `Payment pending admin approval. Payment ID: ${paymentId}` });
        await reservation.save();
        payment.reservationId = reservation._id;
        await payment.save();
      }
      await sendPaymentNotificationEmail(customerInfo.email, payment, 'pending');
      await sendAdminPaymentNotification(payment);
      res.json({ success: true, paymentId: payment.paymentId, status: 'pending', message: 'Payment request submitted for approval.' });
    } catch (error) {
      console.error('Payment creation error:', error);
      res.status(500).json({ error: error.message });
    }
});

app.get('/api/payment/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/payments', adminAuth, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/payments/:paymentId/approve', adminAuth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    payment.status = 'approved';
    payment.approvedAt = new Date();
    payment.adminNotes = req.body.notes || '';
    await payment.save();
    if (payment.paymentType === 'full_payment') await Inventory.findByIdAndUpdate(payment.vehicleId, { status: 'Sold' });
    if (payment.reservationId) await Reservation.findByIdAndUpdate(payment.reservationId, { status: 'confirmed', paymentStatus: 'paid' });
    await sendPaymentNotificationEmail(payment.customerInfo.email, payment, 'approved');
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/payments/:paymentId/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    payment.status = 'rejected';
    payment.rejectedAt = new Date();
    payment.rejectionReason = reason || 'No reason provided';
    await payment.save();
    if (payment.reservationId) await Reservation.findByIdAndUpdate(payment.reservationId, { status: 'cancelled', notes: `Payment rejected. Reason: ${reason}` });
    await sendPaymentNotificationEmail(payment.customerInfo.email, payment, 'rejected', reason);
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// FINANCING REQUEST ROUTES
// ============================================================
app.post('/api/create-financing', async (req, res) => {
  try {
    const { vehicleId, vehicleInfo, customerInfo, financialInfo } = req.body;
    const requestId = `FIN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const financing = new Financing({ requestId, vehicleId, vehicleInfo, customerInfo, financialInfo, status: 'pending' });
    await financing.save();
    await sendFinancingNotificationEmail(customerInfo.email, financing, 'pending');
    await sendAdminFinancingNotification(financing);
    res.json({ success: true, requestId: financing.requestId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/financing', adminAuth, async (req, res) => {
  try {
    const requests = await Financing.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/financing/:id', adminAuth, async (req, res) => {
  try {
    const financing = await Financing.findById(req.params.id);
    if (!financing) return res.status(404).json({ error: 'Financing request not found' });
    res.json(financing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/financing/:id/approve', adminAuth, async (req, res) => {
  try {
    const financing = await Financing.findById(req.params.id);
    if (!financing) return res.status(404).json({ error: 'Financing request not found' });
    financing.status = 'approved';
    financing.approvedAt = new Date();
    financing.approvedAmount = req.body.approvedAmount || financing.vehicleInfo.price;
    financing.approvedTerms = req.body.approvedTerms || 'Standard financing terms apply';
    financing.adminNotes = req.body.notes || '';
    await financing.save();
    await sendFinancingNotificationEmail(financing.customerInfo.email, financing, 'approved', { approvedAmount: financing.approvedAmount, approvedTerms: financing.approvedTerms });
    res.json({ success: true, financing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/financing/:id/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const financing = await Financing.findById(req.params.id);
    if (!financing) return res.status(404).json({ error: 'Financing request not found' });
    financing.status = 'rejected';
    financing.rejectionReason = reason;
    await financing.save();
    await sendFinancingNotificationEmail(financing.customerInfo.email, financing, 'rejected', { reason });
    res.json({ success: true, financing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/financing/:id', adminAuth, async (req, res) => {
  try {
    const financing = await Financing.findByIdAndDelete(req.params.id);
    if (!financing) return res.status(404).json({ error: 'Financing request not found' });
    res.json({ success: true, message: `Financing request ${financing.requestId} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/payments/:id', adminAuth, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true, message: `Payment ${payment.paymentId} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DOCUMENT MANAGEMENT ROUTES
// ============================================================
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    const { shipmentId, customerEmail, documentType, notes } = req.body;
    const document = new Document({ shipmentId, customerEmail, documentType, fileName: req.file.originalname, fileUrl: `/uploads/${req.file.filename}`, fileSize: req.file.size, mimeType: req.file.mimetype, notes });
    await document.save();
    await Shipment.findByIdAndUpdate(shipmentId, { $push: { documents: { type: documentType, url: `/uploads/${req.file.filename}`, uploadedAt: new Date() } } });
    res.json({ success: true, document });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents/:shipmentId', async (req, res) => {
  try {
    const documents = await Document.find({ shipmentId: req.params.shipmentId });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/documents/:id/verify', adminAuth, async (req, res) => {
  try {
    const document = await Document.findByIdAndUpdate(req.params.id, { status: 'verified', verifiedAt: new Date(), verifiedBy: req.admin.id }, { new: true });
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ANALYTICS ROUTES
// ============================================================

app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  try {
      const totalVehicles = await Inventory.countDocuments();
      const soldVehicles = await Inventory.countDocuments({ status: 'Sold' });
      const availableVehicles = await Inventory.countDocuments({ status: 'Available' });
      
      const shipments = await Shipment.find();
      
      // Use legacyStatus for compatibility
      const activeShipments = shipments.filter(s => {
          const status = s.legacyStatus || s.shipmentStatus;
          return status !== 'delivered' && status !== 'Delivered' && status !== 'completed';
      }).length;
      
      const totalRevenue = shipments.reduce((sum, s) => sum + (s.shippingCost || 0), 0);
      
      // Calculate average delivery time
      const deliveredShipments = shipments.filter(s => s.actualDelivery && s.createdAt);
      let avgDeliveryTime = 0;
      if (deliveredShipments.length > 0) {
          const totalDays = deliveredShipments.reduce((sum, s) => {
              const days = (new Date(s.actualDelivery) - new Date(s.createdAt)) / (1000 * 60 * 60 * 24);
              return sum + days;
          }, 0);
          avgDeliveryTime = totalDays / deliveredShipments.length;
      }
      
      // Get recent shipments
      const recentShipments = shipments.slice(0, 10).map(s => ({
          trackingNumber: s.trackingNumber,
          customerInfo: s.customerInfo,
          status: s.legacyStatus || s.shipmentStatus || 'pending',
          shippingCost: s.shippingCost
      }));
      
      // Sample monthly data
      const monthlySales = [12, 19, 15, 17, 14, 23];
      const monthlyRevenue = [15000, 22000, 18000, 25000, 21000, 32000];
      
      res.json({
          overview: {
              totalVehicles,
              soldVehicles,
              availableVehicles,
              activeShipments,
              totalRevenue,
              averageDeliveryTime: avgDeliveryTime.toFixed(1)
          },
          monthlySales,
          monthlyRevenue,
          recentShipments
      });
      
  } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({ error: error.message });
  }
});

// ============================================================
// INITIAL ADMIN CREATION
// ============================================================
async function createInitialAdmin() {
  const existingAdmin = await Admin.findOne({ email: 'henryrobert1840@gmail.com' });
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('Admin2026', 10);
    const admin = new Admin({ email: 'henryrobert1840@gmail.com', password: hashedPassword, name: 'Super Administrator', role: 'super_admin' });
    await admin.save();
    console.log('✅ Initial admin created in database');
  }
}
createInitialAdmin();

// ============================================================
// SERVE HTML PAGES
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));
app.get('/inventory', (req, res) => res.sendFile(path.join(__dirname, '../client/inventory.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, '../client/about.html')));
app.get('/shipping', (req, res) => res.sendFile(path.join(__dirname, '../client/shipping.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, '../client/contact.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, '../client/track.html')));
app.get('/car-details', (req, res) => res.sendFile(path.join(__dirname, '../client/car-details.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, '../client/checkout.html')));
app.get('/reservation-success', (req, res) => res.sendFile(path.join(__dirname, '../client/reservation-success.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../admin/index.html')));




// ============================================================
// WEBSOCKET SERVER SETUP
// ============================================================

// Create HTTP server for WebSocket
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('🔌 WebSocket client connected:', socket.id);
    
    socket.on('track-shipment', async (data) => {
        const { trackingNumber } = data;
        console.log(`📍 Real-time tracking started for: ${trackingNumber}`);
        
        activeSessions.set(socket.id, { trackingNumber, socketId: socket.id });
        
        const shipment = await Shipment.findOne({ trackingNumber });
        if (shipment && shipment.tracking?.isActive) {
            sendRealtimeUpdate(socket, shipment);
        }
    });
    
    socket.on('disconnect', () => {
        activeSessions.delete(socket.id);
        console.log('🔌 WebSocket client disconnected:', socket.id);
    });
});

// ============================================================
// WEBSOCKET BROADCAST FUNCTION - WITH FALLBACK
// ============================================================
async function broadcastTrackingUpdate(trackingNumber, updateData) {
  let sentCount = 0;
  for (const [socketId, session] of activeSessions) {
      if (session.trackingNumber === trackingNumber) {
          io.to(socketId).emit('tracking-update', updateData);
          sentCount++;
      }
  }
  if (sentCount > 0) {
      const progressDisplay = updateData.progress !== undefined ? `${updateData.progress}%` : (updateData.type || 'update');
      console.log(`📡 Broadcast to ${sentCount} clients: ${progressDisplay}`);
  }
}

// Helper function to send real-time update to a specific socket
function sendRealtimeUpdate(socket, shipment) {
    if (!shipment || !shipment.tracking?.isActive) return;
    
    const now = Date.now();
    const startTime = new Date(shipment.tracking.startTime).getTime();
    const endTime = new Date(shipment.tracking.estimatedArrival).getTime();
    const totalDuration = endTime - startTime;
    const elapsed = now - startTime;
    let progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    
    // Calculate current position
    const startLat = shipment.pickupLocation.coordinates.lat;
    const startLng = shipment.pickupLocation.coordinates.lng;
    const endLat = shipment.deliveryLocation.coordinates.lat;
    const endLng = shipment.deliveryLocation.coordinates.lng;
    const fraction = progress / 100;
    const currentLat = startLat + (endLat - startLat) * fraction;
    const currentLng = startLng + (endLng - startLng) * fraction;
    
    const remainingMs = Math.max(0, endTime - now);
    
    socket.emit('tracking-update', {
        trackingNumber: shipment.trackingNumber,
        progress: Math.round(progress),
        currentPosition: { lat: currentLat, lng: currentLng },
        remainingTime: {
            days: Math.floor(remainingMs / (1000 * 60 * 60 * 24)),
            hours: Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            minutes: Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)),
            totalHours: remainingMs / (1000 * 60 * 60)
        },
        status: shipment.status,
        estimatedArrival: shipment.tracking.estimatedArrival
    });
}


// Start server
server.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 LONESTAR AUTOS SERVER RUNNING');
    console.log('========================================');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔧 Admin: http://localhost:${PORT}/admin`);
    console.log(`🔑 Login: henryrobert1840@gmail.com / Admin2026`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`🛰️ Tracking: http://localhost:${PORT}/track`);
    console.log('========================================\n');
});