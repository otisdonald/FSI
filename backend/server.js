const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();


// ================= MIDDLEWARE =================

// ⭐ IMPORTANT — rawBody needed for Flutterwave webhook signature
app.use(cors());
app.use(express.json({
  verify: (req,res,buf)=>{ req.rawBody = buf.toString(); }
}));
app.use(cookieParser());

// serve static frontend files (pending.html lives here)
app.use(express.static(path.join(__dirname,"public")));


// ================= BASIC ROUTES =================
app.get("/", (req,res)=> res.send("FSI API running 🚀"));

app.get(["/pending","/pending.html"], (req,res)=>{
  res.sendFile(path.join(__dirname,"public","pending.html"));
});


// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));


// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name:String,
  email:String,
  phone:String,
  country:String,
  sex:String,
  dob:String,
  startup:String,
  problem:String,
  solution:String,
  business_model:String,
  usage:String,
  status:{ type:String, default:"pending" },
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String,
  createdAt:{ type:Date, default:Date.now }
}));

const Waitlist = mongoose.model("Waitlist", new mongoose.Schema({
  email:String,
  createdAt:{ type:Date, default:Date.now }
}));

const Admin = mongoose.model("Admin", new mongoose.Schema({
  email:String,
  password:String
}));


// ================= AUTH =================
function auth(req,res,next){
  const token = req.headers.authorization;
  if(!token) return res.status(401).send("Unauthorized");
  try{
    jwt.verify(token,process.env.JWT_SECRET);
    next();
  }catch{
    res.status(401).send("Invalid token");
  }
}


// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey:process.env.FLW_PUBLIC_KEY });
});


// ================= WAITLIST =================
app.post("/api/waitlist", async (req,res)=>{
  try{
    const { email } = req.body;
    const exists = await Waitlist.findOne({ email });
    if(exists) return res.json({ success:true });

    await Waitlist.create({ email });
    res.json({ success:true });

  }catch(err){
    res.status(500).json({ success:false });
  }
});


// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data = req.body;

    await Application.findOneAndDelete({ email:data.email });
    const appData = await Application.create(data);

    res.json({ success:true, id:appData._id });

  }catch(err){
    console.log(err);
    res.status(500).json({ success:false });
  }
});


// ================= PAYMENT STATUS POLLING =================
app.get("/api/check-status/:email", async (req,res)=>{
  try{
    const appData = await Application.findOne({ email:req.params.email });
    if(!appData) return res.json({ status:"not_found" });

    res.json({ status: appData.paymentStatus });

  }catch{
    res.json({ status:"error" });
  }
});


// ================= FLUTTERWAVE WEBHOOK (FINAL FIX) =================
app.post("/api/flutterwave-webhook", async (req,res)=>{
  try{
    console.log("🔔 Webhook received");

    const signature =
      req.headers["verif-hash"] ||
      req.headers["flutterwave-signature"];

    // If signature exists → verify it
    if(signature){
      if(signature !== process.env.FLW_WEBHOOK_SECRET){
        console.log("❌ Invalid webhook signature");
        return res.sendStatus(200);
      }
      console.log("✅ Webhook signature verified");
    }else{
      console.log("⚠️ No signature header — using fallback verification");
    }

    const payload = req.body;

    // Only care about successful charges
    if(payload.event !== "charge.completed"){
      return res.sendStatus(200);
    }

    const payment = payload.data;

    // 🔥 SECOND LEVEL VERIFICATION (MOST IMPORTANT)
    // We confirm the payment directly from Flutterwave API
    const verifyRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${payment.id}/verify`,
      {
        headers:{
          Authorization:`Bearer ${process.env.FLW_SECRET_KEY}`
        }
      }
    );

    const verified = verifyRes.data.data;

    if(verified.status !== "successful"){
      console.log("Payment not successful after verification");
      return res.sendStatus(200);
    }

    const email = verified.customer.email;
    console.log("💰 Payment verified for:", email);

    await Application.findOneAndUpdate(
      { email },
      {
        paymentStatus:"paid",
        tx_ref: verified.tx_ref
      }
    );

    await sendEmail(
      email,
      "Application Received",
      "Your FSI application and payment have been received successfully."
    );

    console.log("🎉 Application marked as PAID");

    res.sendStatus(200);

  }catch(err){
    console.log("Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// ================= ADMIN =================
app.post("/api/admin/login", async (req,res)=>{
  const { email,password } = req.body;
  const admin = await Admin.findOne({ email });
  if(!admin) return res.json({ success:false });

  const match = await bcrypt.compare(password, admin.password);
  if(!match) return res.json({ success:false });

  const token = jwt.sign({ id:admin._id },process.env.JWT_SECRET);
  res.json({ success:true, token });
});

app.get("/api/all-applications", auth, async (req,res)=>{
  const apps = await Application.find().sort({ createdAt:-1 });
  res.json(apps);
});

app.get("/api/analytics", auth, async (req,res)=>{
  const total = await Application.countDocuments();
  const paid = await Application.countDocuments({ paymentStatus:"paid" });
  res.json({ total, paid });
});


// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port",PORT));