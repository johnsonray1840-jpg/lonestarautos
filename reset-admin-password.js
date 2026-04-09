const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://evelyndantonio62:92939184@cluster0.tndfw.mongodb.net/lonestarautos?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Connection error:', err));

const adminSchema = new mongoose.Schema({
  email: String,
  password: String,
  name: String,
  role: String,
  isActive: Boolean,
  createdAt: Date
});

const Admin = mongoose.model('Admin', adminSchema);

async function resetPassword() {
  try {
    // Find the admin
    const admin = await Admin.findOne({ email: 'henryrobert1840@gmail.com' });
    
    if (!admin) {
      console.log('Admin not found. Creating new one...');
      const hashedPassword = await bcrypt.hash('Admin2026', 10);
      const newAdmin = new Admin({
        email: 'henryrobert1840@gmail.com',
        password: hashedPassword,
        name: 'Super Administrator',
        role: 'super_admin',
        isActive: true,
        createdAt: new Date()
      });
      await newAdmin.save();
      console.log('✅ New admin created!');
    } else {
      // Reset password
      const newHashedPassword = await bcrypt.hash('Admin2026', 10);
      admin.password = newHashedPassword;
      admin.isActive = true;
      await admin.save();
      console.log('✅ Admin password reset successfully!');
    }
    
    // Verify the password works
    const verifyAdmin = await Admin.findOne({ email: 'henryrobert1840@gmail.com' });
    const testHash = await bcrypt.compare('Admin2026', verifyAdmin.password);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email: henryrobert1840@gmail.com');
    console.log('🔑 Password: Admin2026');
    console.log(`✅ Password verification: ${testHash ? 'SUCCESS' : 'FAILED'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.disconnect();
  }
}

resetPassword();