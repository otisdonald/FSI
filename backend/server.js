// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors({
  origin: ['https://founderssupport.org', 'https://www.founderssupport.org', 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
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
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ Mongo Error:", err));

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

const Waitlist = mongoose.model("Waitlist", new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  source: { type: String, default: "landing-page" },
  createdAt: { type: Date, default: Date.now }
}));

// ================= EMAIL (ZOHO SMTP) =================
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendEmail(to, subject, htmlContent){
  try{
    await transporter.sendMail({
      from: `"Founders Support Initiative" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlContent
    });
    console.log("📧 Email sent to", to);
  }catch(err){
    console.log("❌ Email error:", err.message);
  }
}

// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
  res.json({ flutterwavePublicKey: process.env.FLW_PUBLIC_KEY });
});

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req,res)=>{
  try{
    const data = req.body;
    await Application.findOneAndDelete({ email: data.email });
    const appData = await Application.create(data);
    res.json({ success: true, id: appData._id });
  }catch(err){
    console.log(err);
    res.status(500).json({ success: false });
  }
});

// ================= WAITLIST (NEW) =================
app.post("/api/waitlist", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }

    const cleanEmail = email.toLowerCase().trim();
    
    await Waitlist.findOneAndUpdate(
      { email: cleanEmail },
      { email: cleanEmail, source: "landing-page-2026" },
      { upsert: true, new: true }
    );

    // Send confirmation to user
    await sendEmail(
      cleanEmail,
      "You're on the FSI Waitlist 🎉",
      `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#0a2540;margin:0 0 16px">Welcome to FSI</h2>
        <p style="color:#374151;line-height:1.6">Thanks for joining the waitlist for the 2026 cohort.</p>
        <p style="color:#374151;line-height:1.6">We'll email you the moment applications open, plus exclusive founder resources before then.</p>
        <div style="margin:24px 0;padding:16px;background:#f9fafb;border-radius:12px">
          <p style="margin:0;color:#6b7280;font-size:14px">You're in good company. Less than 10% will be selected.</p>
        </div>
        <p style="color:#6b7280;font-size:13px">— Founders Support Initiative<br><a href="https://founderssupport.org" style="color:#2563eb">founderssupport.org</a></p>
      </div>
      `
    );

    res.json({ success: true });
  } catch (err) {
    console.log("Waitlist error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= VERIFY PAYMENT (FALLBACK) =================
app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;
  try{
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.FLW_SECRET_KEY}` } }
    );

    const payment = response.data.data;
    if(payment.status !== "successful") return res.json({ success: false });

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.tx_ref },
      { upsert: true }
    );

    await sendEmail(email, "Application Received 🎉",
      `<p>Your FSI application has been submitted successfully.</p>`);

    res.json({ success: true });
  }catch(err){
    console.log(err.message);
    res.status(500).json({ success: false });
  }
});

// ================= CHECK STATUS =================
app.get("/api/check-status/:email", async (req,res)=>{
  const appData = await Application.findOne({ email: req.params.email });
  if(!appData) return res.json({ status: "not_found" });
  res.json({ status: appData.paymentStatus });
});

// ================= FLUTTERWAVE WEBHOOK =================
app.post("/api/flutterwave-webhook", (req, res) => {
  console.log("🔔 Webhook received");
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const signature = req.headers["verif-hash"];
      if (!signature || signature !== process.env.FLW_SECRET_HASH) {
        console.log("❌ Invalid webhook signature");
        return;
      }

      const payment = req.body.data;
      if (!payment || payment.status !== "successful") return;

      const email = payment.customer?.email;
      const tx_ref = payment.tx_ref;

      await Application.findOneAndUpdate(
        { email },
        { paymentStatus: "paid", tx_ref },
        { upsert: true }
      );

      await sendEmail(
        email,
        "Application Received — Founders Support Initiative",
        `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="color:#0a2540">Application Confirmed ✅</h2>
          <p>Your application and payment have been successfully received.</p>
          <p>Our review team will evaluate your submission and contact you with next steps.</p>
          <p style="margin-top:24px;color:#6b7280;font-size:14px">— Founders Support Initiative<br>https://founderssupport.org</p>
        </div>
        `
      );

      console.log("🎉 Payment saved + email sent");
    } catch (err) {
      console.log("Webhook error:", err.message);
    }
  });
});

app.get("/ip", async (req,res)=>{
  try {
    const response = await axios.get("https://api.ipify.org");
    res.send(response.data);
  } catch(e) {
    res.status(500).send("error");
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
