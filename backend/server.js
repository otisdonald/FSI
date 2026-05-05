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

// VERY IMPORTANT → keep raw body for webhook verification
app.use(cors());
app.use(express.json({
  verify: (req,res,buf)=>{ req.rawBody = buf.toString(); }
}));
app.use(cookieParser());
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
  sex:String,
  dob:String,
  startup:String,
  problem:String,
  solution:String,
  business_model:String,
  usage:String,
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String,
  createdAt:{ type:Date, default:Date.now }
}));

const Admin = mongoose.model("Admin", new mongoose.Schema({
  email:String,
  password:String
}));


// ================= EMAIL =================
const transporter = nodemailer.createTransport({
  service:"gmail",
  auth:{
    user:process.env.EMAIL_USER,
    pass:process.env.EMAIL_PASS
  }
});

async function sendEmail(to,subject,text){
  try{
    await transporter.sendMail({
      from:"FSI <no-reply@fsi.com>",
      to, subject, text
    });
  }catch(err){
    console.log("Email error:",err.message);
  }
}


// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey:process.env.FLW_PUBLIC_KEY });
});


// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data = req.body;

    await Application.findOneAndDelete({ email:data.email });
    const appData = await Application.create(data);

    res.json({ success:true, id:appData._id });

  }catch(err){
    res.status(500).json({ success:false });
  }
});


// ================= VERIFY PAYMENT (fallback polling) =================
app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;

  try{
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    const payment = response.data.data;

    if(payment.status !== "successful"){
      return res.json({ success:false });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref },
      { upsert:true }
    );

    await sendEmail(email,"Application Received",
      "Your FSI application has been submitted successfully.");

    res.json({ success:true });

  }catch(err){
    console.log(err.message);
    res.status(500).json({ success:false });
  }
});


// ================= CHECK PAYMENT STATUS =================
app.get("/api/check-status/:email", async (req,res)=>{
  const appData = await Application.findOne({ email:req.params.email });
  if(!appData) return res.json({ status:"not_found" });
  res.json({ status:appData.paymentStatus });
});


// =======================================================
// 🔥🔥 FLUTTERWAVE WEBHOOK — FINAL FIX 🔥🔥
// =======================================================
app.post("/api/flutterwave-webhook", async (req,res)=>{
  console.log("🔔 Webhook received");

  try{
    // Flutterwave V3 header
    const signature = req.headers["verif-hash"];

    if(!signature){
      console.log("❌ No signature header");
      return res.sendStatus(200);
    }

    if(signature !== process.env.FLW_SECRET_HASH){
      console.log("❌ Invalid webhook signature");
      return res.sendStatus(200);
    }

    console.log("✅ Webhook verified");

    const payload = req.body;

    if(payload.event !== "charge.completed")
      return res.sendStatus(200);

    const payment = payload.data;

    if(payment.status !== "successful")
      return res.sendStatus(200);

    const email = payment.customer.email;

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus:"paid", tx_ref:payment.tx_ref },
      { upsert:true }
    );

    await sendEmail(
      email,
      "Application Received",
      "Your FSI application and payment have been received successfully."
    );

    console.log("🎉 PAYMENT CONFIRMED:", email);

    res.sendStatus(200);

  }catch(err){
    console.log("Webhook error:",err.message);
    res.sendStatus(200);
  }
});


// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port",PORT));