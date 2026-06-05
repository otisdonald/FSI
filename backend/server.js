const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ Mongo Error:", err));

const Application = mongoose.model("Application", new mongoose.Schema({
  name:String, email:String, phone:String,
  startup:String, problem:String, solution:String,
  business_model:String, usage:String,
  paymentStatus:{ type:String, default:"unpaid" },
  tx_ref:String, createdAt:{ type:Date, default:Date.now }
}));

app.get("/api/config",(req,res)=>{
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
});

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

// ✅ Use TPAY_ENCRYPTION_KEY here
function encryptPayload(payload) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(process.env.TPAY_ENCRYPTION_KEY, "base64");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), "utf8", "base64");
  encrypted += cipher.final("base64");
  return {
    iv: iv.toString("base64"),
    payload: encrypted
  };
}

app.post("/api/initiate-payment", async (req,res)=>{
  const { email, name, phone } = req.body;

  try {
    const payload = {
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
    };

    const encryptedPayload = encryptPayload(payload);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      encryptedPayload,
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
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

app.post("/api/verify-payment", async (req,res)=>{
  const { transaction_id, email } = req.body;
  try {
    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/status",
      { transaction_id },
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const payment = response.data;
    if(payment.status !== "SUCCESS") return res.json({ success: false });

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.reference },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
