// scripts/migrate-images.js
// Run this ONCE to migrate existing local images to Cloudinary

const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://evelyndantonio62:92939184@cluster0.tndfw.mongodb.net/lonestarautos?retryWrites=true&w=majority';

// Define Inventory schema (minimal version for migration)
const inventorySchema = new mongoose.Schema({
  images: [{ type: String }],
  title: String,
  make: String,
  model: String
});

const Inventory = mongoose.model('Inventory', inventorySchema);

// Local uploads directory
const uploadsDir = path.join(__dirname, '../uploads');

async function migrateImages() {
  console.log('🚀 Starting image migration to Cloudinary...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  
  // Get all vehicles with local images
  const vehicles = await Inventory.find({ images: { $exists: true, $not: { $size: 0 } } });
  console.log(`📦 Found ${vehicles.length} vehicles with images`);
  
  let totalMigrated = 0;
  let totalFailed = 0;
  
  for (const vehicle of vehicles) {
    console.log(`\n📸 Processing: ${vehicle.title || vehicle.make + ' ' + vehicle.model}`);
    
    const newImageUrls = [];
    const oldImages = vehicle.images;
    
    for (let i = 0; i < oldImages.length; i++) {
      const oldImagePath = oldImages[i];
      
      // Check if it's already a Cloudinary URL
      if (oldImagePath.includes('cloudinary.com')) {
        console.log(`   ⏭️  Image ${i + 1}: Already on Cloudinary, skipping`);
        newImageUrls.push(oldImagePath);
        continue;
      }
      
      // Extract filename from local path
      const filename = path.basename(oldImagePath);
      const localFilePath = path.join(uploadsDir, filename);
      
      // Check if file exists locally
      if (!fs.existsSync(localFilePath)) {
        console.log(`   ❌ Image ${i + 1}: File not found locally: ${filename}`);
        totalFailed++;
        continue;
      }
      
      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(localFilePath, {
          folder: 'lonestarautos/vehicles',
          public_id: `${vehicle._id}_${Date.now()}_${i}`,
          transformation: [{ width: 1200, height: 800, crop: 'limit' }]
        });
        
        newImageUrls.push(result.secure_url);
        console.log(`   ✅ Image ${i + 1}: Uploaded to Cloudinary`);
        totalMigrated++;
        
        // Optional: Delete local file after successful upload
        // fs.unlinkSync(localFilePath);
        
      } catch (uploadError) {
        console.log(`   ❌ Image ${i + 1}: Upload failed - ${uploadError.message}`);
        totalFailed++;
        newImageUrls.push(oldImagePath); // Keep old path as fallback
      }
    }
    
    // Update vehicle with new Cloudinary URLs
    if (newImageUrls.length > 0) {
      vehicle.images = newImageUrls;
      await vehicle.save();
      console.log(`   💾 Saved ${newImageUrls.length} images to database`);
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 MIGRATION SUMMARY');
  console.log(`   ✅ Successfully migrated: ${totalMigrated} images`);
  console.log(`   ❌ Failed: ${totalFailed} images`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await mongoose.disconnect();
  console.log('✅ Migration complete!');
}

// Run migration
migrateImages().catch(console.error);