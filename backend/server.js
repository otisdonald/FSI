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
  origin: [
    'https://founderssupport.org',
    'https://www.founderssupport.org',
    'https://axtrivex.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json({
  verify: (req,res,buf)=>{ req.rawBody = buf.toString(); }
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));

// ================= BASIC ROUTES =================
app.get("/", (req,res)=> res.send("FSI + Axtrivex API running 🚀"));

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

const Subscription = mongoose.model("Subscription", new mongoose.Schema({
  email: { type: String, required: true, lowercase: true },
  status: { type: String, default: "inactive" }, // active/inactive
  tx_ref: String,
  createdAt: { type: Date, default: Date.now }
}));

const JobGrant = mongoose.model("JobGrant", new mongoose.Schema({
  title: String,
  type: { type: String, enum: ["job", "grant"], required: true },
  description: String,
  deadline: String,
  link: String,
  isActive: { type: Boolean, default: true },
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
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
});

app.get("/api/axtrivex/config",(req,res)=>{
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
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

// ================= INITIATE PAYMENT (Server-side) =================
app.post("/api/initiate-payment", async (req,res)=>{
  const { email, name, phone } = req.body;
  try{
    const response = await axios.post(
      "https://api.transactpay.com/v1/payments/initiate",
      {
        amount: 1000,
        currency: "NGN",
        customer: { email, name, phone_number: phone },
        callback_url: "https://fsi.onrender.com/pending.html",
        tx_ref: "FSI-" + Date.now()
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.TPAY_SECRET_KEY}`
        }
      }
    );
    res.json({ checkout_url: response.data.checkout_url });
  }catch(err){
    console.log("❌ Initiate error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= VERIFY PAYMENT (FSI with TransactPay) =================
app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;
  try{
    const response = await axios.get(
      `https://api.transactpay.com/v1/payments/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.TPAY_SECRET_KEY}` } }
    );
    const payment = response.data;
    if(payment.status !== "success") return res.json({ success: false });
    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.tx_ref },
      { upsert: true }
    );
    await sendEmail(email, "Application Received 🎉", `<p>Your FSI application has been submitted successfully via TransactPay.</p>`);
    res.json({ success: true });
  }catch(err){
    console.log("❌ TransactPay verify error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= VERIFY PAYMENT (Axtrivex Subscription) =================
app.post("/api/axtrivex/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;
  try{
    const response = await axios.get(
      `https://api.transactpay.com/v1/payments/${transaction_id}/verify`,
      { headers:{ Authorization:`Bearer ${process.env.TPAY_SECRET_KEY}` } }
    );
    const payment = response.data;
    if(payment.status !== "success") return res.json({ success: false });
    await Subscription.findOneAndUpdate(
      { email },
      { status: "active", tx_ref: payment.tx_ref },
      { upsert: true }
    );
    res.json({ success: true });
  }catch(err){
    console.log("❌ TransactPay subscription verify error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= TRANSACTPAY WEBHOOK =================
app.post("/api/transactpay-webhook", (req, res) => {
  console.log("🔔 TransactPay webhook received");
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const signature = req.headers["x-transactpay-signature"];
      if (!signature || signature !== process.env.TPAY_WEBHOOK_SECRET) {
        console.log("❌ Invalid TransactPay webhook signature");
        return;
      }

      const payment = req.body.data;
      if (!payment || payment.status !== "success") return;

      const email = payment.customer?.email;
      const tx_ref = payment.tx_ref;

      await Application.findOneAndUpdate(
        { email },
        { paymentStatus: "paid", tx_ref },
        { upsert: true }
      );

      await Subscription.findOneAndUpdate(
        { email },
        { status: "active", tx_ref },
        { upsert: true }
      );

      console.log("🎉 Payment saved for FSI/Axtrivex via TransactPay");
    } catch (err) {
      console.log("Webhook error:", err.message);
    }
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
