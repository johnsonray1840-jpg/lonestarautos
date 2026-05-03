// add-sample-vehicles.js - Run this to add sample vehicles to your inventory
const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://evelyndantonio62:92939184@cluster0.tndfw.mongodb.net/lonestarautos?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ Connection error:', err));

// Inventory Schema
const inventorySchema = new mongoose.Schema({
  title: String,
  price: Number,
  year: Number,
  mileage: String,
  engine: String,
  make: String,
  model: String,
  color: String,
  transmission: String,
  fuelType: String,
  condition: String,
  status: String,
  images: [String],
  featured: Boolean,
  description: String,
  features: [String],
  createdAt: Date,
  updatedAt: Date
});

const Inventory = mongoose.model('Inventory', inventorySchema);

// Sample vehicles data
const sampleVehicles = [
  {
    title: "2023 Porsche 911 Carrera",
    make: "Porsche",
    model: "911 Carrera",
    year: 2023,
    price: 159999,
    mileage: "8,234 mi",
    engine: "3.0L Twin-Turbo Flat-6",
    color: "White",
    transmission: "PDK Automatic",
    fuelType: "Premium Gasoline",
    condition: "Certified Pre-Owned",
    status: "Available",
    featured: true,
    description: "The Porsche 911 Carrera delivers an exhilarating driving experience with its powerful twin-turbo engine, precise handling, and iconic design. This example comes equipped with the Sport Chrono Package, Premium Package, and Bose Surround Sound System.",
    features: ["Sport Chrono Package", "Premium Package", "Bose Surround Sound", "Adaptive Cruise Control", "Heated & Ventilated Seats", "Apple CarPlay"],
    images: ["https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2024 Mercedes-Benz S-Class",
    make: "Mercedes-Benz",
    model: "S-Class",
    year: 2024,
    price: 129999,
    mileage: "2,145 mi",
    engine: "4.0L V8 Biturbo",
    color: "Black",
    transmission: "9G-TRONIC Automatic",
    fuelType: "Premium Gasoline",
    condition: "New",
    status: "Available",
    featured: true,
    description: "The epitome of luxury and technology. The 2024 Mercedes-Benz S-Class sets new standards with its opulent interior, cutting-edge technology, and silky smooth V8 power. Features the new MBUX system with augmented reality navigation.",
    features: ["MBUX Infotainment", "Burmester 3D Sound", "Executive Rear Seat Package", "Air Suspension", "Ambient Lighting", "Massage Seats"],
    images: ["https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2022 BMW M5 Competition",
    make: "BMW",
    model: "M5 Competition",
    year: 2022,
    price: 109999,
    mileage: "15,432 mi",
    engine: "4.4L V8 TwinPower Turbo",
    color: "Blue",
    transmission: "8-Speed M Steptronic",
    fuelType: "Premium Gasoline",
    condition: "Certified Pre-Owned",
    status: "Available",
    featured: false,
    description: "The ultimate sport sedan. The BMW M5 Competition combines luxury with race-inspired performance. 617 horsepower propels this executive rocket from 0-60 in just 3.1 seconds.",
    features: ["M Competition Package", "Carbon Fiber Roof", "Bowers & Wilkins Diamond Sound", "Executive Package", "Driving Assistance Plus"],
    images: ["https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2023 Range Rover Sport",
    make: "Range Rover",
    model: "Sport",
    year: 2023,
    price: 119999,
    mileage: "5,678 mi",
    engine: "3.0L I6 Mild Hybrid",
    color: "Silver",
    transmission: "8-Speed Automatic",
    fuelType: "Premium Gasoline",
    condition: "Certified Pre-Owned",
    status: "Available",
    featured: false,
    description: "Commanding presence meets modern luxury. The 2023 Range Rover Sport offers exceptional off-road capability with on-road refinement. Features the latest Pivi Pro infotainment and advanced driver assistance systems.",
    features: ["Air Suspension", "Panoramic Roof", "Meridian 3D Surround Sound", "Terrain Response 2", "Heated Steering Wheel", "Wireless Charging"],
    images: ["https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2021 Ferrari F8 Tributo",
    make: "Ferrari",
    model: "F8 Tributo",
    year: 2021,
    price: 329999,
    mileage: "3,200 mi",
    engine: "3.9L V8 Twin-Turbo",
    color: "Rosso Corsa Red",
    transmission: "7-Speed F1 Dual-Clutch",
    fuelType: "Premium Gasoline",
    condition: "Certified Pre-Owned",
    status: "Available",
    featured: true,
    description: "Exotic Italian engineering at its finest. The Ferrari F8 Tributo pays homage to the brand's most powerful V8 engine ever. 710 horsepower and a 0-60 time of 2.9 seconds make this a true supercar.",
    features: ["Carbon Fiber Racing Seats", "Apple CarPlay", "Surround View Camera", "Scuderia Ferrari Shields", "Carbon Fiber Steering Wheel", "Yellow Brake Calipers"],
    images: ["https://images.unsplash.com/photo-1592198084033-aade902d1aae?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2022 Lamborghini Huracan",
    make: "Lamborghini",
    model: "Huracan EVO",
    year: 2022,
    price: 289999,
    mileage: "4,500 mi",
    engine: "5.2L V10",
    color: "Verde Mantis Green",
    transmission: "7-Speed Dual-Clutch",
    fuelType: "Premium Gasoline",
    condition: "Certified Pre-Owned",
    status: "Reserved",
    featured: true,
    description: "The Lamborghini Huracan EVO delivers a thrilling 630 horsepower from its iconic V10 engine. With all-wheel drive and advanced aerodynamics, this Italian masterpiece offers an unforgettable driving experience.",
    features: ["Lamborghini Dynamic Steering", "Magneto-Rheological Suspension", "Sport Exhaust", "Carbon Fiber Interior", "Lifting System", "Smartphone Interface"],
    images: ["https://images.unsplash.com/photo-1566473965997-3de9c817e938?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "2024 Tesla Model S Plaid",
    make: "Tesla",
    model: "Model S Plaid",
    year: 2024,
    price: 89999,
    mileage: "1,200 mi",
    engine: "Tri-Motor Electric",
    color: "Midnight Silver",
    transmission: "Single Speed",
    fuelType: "Electric",
    condition: "New",
    status: "Available",
    featured: true,
    description: "The quickest production car in the world. The Tesla Model S Plaid features three motors for 1,020 horsepower and a 0-60 time of under 2 seconds. Experience the future of automotive technology today.",
    features: ["Autopilot", "Full Self-Driving Capability", "22-speaker Audio System", "Glass Roof", "Yoke Steering Wheel", "Track Mode"],
    images: ["https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800"],
    createdAt: new Date(),
    updatedAt: new Date()
  },
//   {
//     title: "2023 Chevrolet Corvette Z06",
//     make: "Chevrolet",
//     model: "Corvette Z06",
//     year: 2023,
//     price: 119999,
//     mileage: "2,800 mi",
//     engine: "5.5L V8 Flat-Plane Crank",
//     color: "Rapid Blue",
//     transmission: "8-Speed Dual-Clutch",
//     fuelType: "Premium Gasoline",
//     condition: "New",
//     status: "Available",
//     featured: false,
//     description: "America's supercar, reimagined. The 2023 Corvette Z06 features a naturally aspirated V8 that revs to 8,600 RPM, producing 670 horsepower. Mid-engine design delivers unparalleled performance.",
//     features: ["Z07 Performance Package", "Carbon Fiber Wheels", "Performance Traction Management", "Front Lift System", "Bose Premium Audio", "Heated & Ventilated Seats"],
//     images: ["https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800"],
//     createdAt: new Date(),
//     updatedAt: new Date()
//   }
];

async function addSampleVehicles() {
  try {
    // Check if we already have vehicles
    const existingCount = await Inventory.countDocuments();
    
    if (existingCount > 0) {
      console.log(`📊 Found ${existingCount} existing vehicles.`);
      console.log('Do you want to add sample vehicles anyway? (y/n)');
      
      // For auto-run, we'll just add them
      console.log('Adding sample vehicles to existing inventory...');
    }
    
    let addedCount = 0;
    
    for (const vehicle of sampleVehicles) {
      // Check if vehicle with same title exists
      const existing = await Inventory.findOne({ 
        make: vehicle.make, 
        model: vehicle.model, 
        year: vehicle.year 
      });
      
      if (!existing) {
        const newVehicle = new Inventory(vehicle);
        await newVehicle.save();
        addedCount++;
        console.log(`✅ Added: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      } else {
        console.log(`⏭️  Skipped: ${vehicle.year} ${vehicle.make} ${vehicle.model} (already exists)`);
      }
    }
    
    console.log(`\n🎉 Complete! Added ${addedCount} new vehicles to inventory.`);
    console.log(`📊 Total vehicles now: ${await Inventory.countDocuments()}`);
    
    // List all vehicles
    const allVehicles = await Inventory.find().sort({ createdAt: -1 });
    console.log('\n📋 Current Inventory:');
    allVehicles.forEach(v => {
      console.log(`   - ${v.year} ${v.make} ${v.model} - $${v.price.toLocaleString()} (${v.status})`);
    });
    
  } catch (error) {
    console.error('Error adding sample vehicles:', error);
  } finally {
    mongoose.disconnect();
  }
}

// Run the script
addSampleVehicles();