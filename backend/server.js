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
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ verify: (req,res,buf)=>{ req.rawBody = buf.toString(); } }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ Mongo Error:", err));

// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name:String, email:String, phone:String,
  startup:String, problem:String, solution:String,
  business_model:String, usage:String,
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String, createdAt:{ type:Date, default:Date.now }
}));

const Subscription = mongoose.model("Subscription", new mongoose.Schema({
  email:String, status:{ type:String, default:"inactive" },
  tx_ref:String, createdAt:{ type:Date, default:Date.now }
}));

// ================= CONFIG =================
app.get("/api/config",(req,res)=>{
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
    console.log("❌ Save error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= INITIATE PAYMENT =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;

  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      {
        customer: {
          firstname: name.split(" ")[0] || name,
          lastname: name.split(" ")[1] || "",
          mobile: phone,
          country: "NG",
          email
        },
        order: {
          amount: 1000,
          reference: "FSI-" + Date.now(),
          description: "FSI Application Fee",
          currency: "NGN"
        },
        payment: {
          RedirectUrl: "https://fsi.onrender.com/pending.html"
        }
      },
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY, // ✅ use public key here
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Initiate response:", response.data);
    res.json({ checkout_url: response.data?.paymentLink || response.data?.checkout_url });
  } catch (err) {
    console.log("❌ Initiate error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// ================= VERIFY PAYMENT =================
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
    res.json({ success: true });
  }catch(err){
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= WEBHOOK =================
app.post("/api/transactpay-webhook", (req,res)=>{
  console.log("🔔 Webhook received");
  res.sendStatus(200);
  setImmediate(async ()=>{
    try{
      const signature = req.headers["x-transactpay-signature"];
      if(signature !== process.env.TPAY_WEBHOOK_SECRET){
        console.log("❌ Invalid signature");
        return;
      }
      const payment = req.body.data;
      if(!payment || payment.status !== "success") return;
      const email = payment.customer?.email;
      const tx_ref = payment.tx_ref;
      await Application.findOneAndUpdate({ email }, { paymentStatus:"paid", tx_ref }, { upsert:true });
      await Subscription.findOneAndUpdate({ email }, { status:"active", tx_ref }, { upsert:true });
      console.log("🎉 Payment saved via webhook");
    }catch(err){
      console.log("Webhook error:", err.message);
    }
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
