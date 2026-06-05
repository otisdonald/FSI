// ================= IMPORTS =================
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ Mongo Error:", err));

// ================= MODELS =================
const Application = mongoose.model("Application", new mongoose.Schema({
  name: String, email: String, phone: String,
  startup: String, problem: String, solution: String,
  business_model: String, usage: String,
  paymentStatus: { type: String, default: "unpaid" },
  tx_ref: String, createdAt: { type: Date, default: Date.now }
}));

// ================= CONFIG =================
app.get("/api/config", (req, res) => {
  res.json({ transactpayPublicKey: process.env.TPAY_PUBLIC_KEY });
});

// ================= SAVE APPLICATION =================
app.post("/api/save-application", async (req, res) => {
  try {
    const data = req.body;
    await Application.findOneAndDelete({ email: data.email });
    const appData = await Application.create(data);
    res.json({ success: true, id: appData._id });
  } catch (err) {
    console.log("❌ Save error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ================= ENCRYPTION FUNCTION (FIXED) =================
function encryptPayload(payload, secretKeyBase64) {
  try {
    const iv = crypto.randomBytes(16);
    
    // TransactPay gives you a base64-encoded 32-byte key
    const key = Buffer.from(secretKeyBase64, 'base64');
    
    if (key.length !== 32) {
      throw new Error(`Invalid key length: ${key.length} bytes. Expected 32 bytes. Check TPAY_SECRET_KEY in Render env.`);
    }
    
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), "utf8", "base64");
    encrypted += cipher.final("base64");
    
    return {
      iv: iv.toString("base64"),
      payload: encrypted
    };
  } catch (err) {
    console.log("❌ Encryption error:", err.message);
    throw err;
  }
}

// ================= INITIATE PAYMENT (FIXED) =================
app.post("/api/initiate-payment", async (req, res) => {
  const { email, name, phone } = req.body;
  try {
    if (!process.env.TPAY_PUBLIC_KEY || !process.env.TPAY_ENCRYPTION_KEY) {
      throw new Error("Missing keys");
    }

    const payload = { /* ... your payload ... */ };

    const encryptedPayload = encryptPayload(payload, process.env.TPAY_ENCRYPTION_KEY);

    const response = await axios.post(
      "https://payment-api-service.transactpay.ai/payment/order/create",
      encryptedPayload,
      {
        headers: {
          "api-key": process.env.TPAY_PUBLIC_KEY,  // PGW-PUBLICKEY-...
          "Content-Type": "application/json"
        }
      }
    );
    // ... rest same

// ================= VERIFY PAYMENT =================
app.post("/api/verify-payment", async (req, res) => {
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

    const payment = response.data?.data || response.data;
    if (payment.status !== "SUCCESS" && payment.status !== "successful") {
      return res.json({ success: false, status: payment.status });
    }

    await Application.findOneAndUpdate(
      { email },
      { paymentStatus: "paid", tx_ref: payment.reference || transaction_id },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.log("❌ Verify error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

// ================= HEALTH CHECK =================
app.get("/health", (req, res) => {
  const keyLength = process.env.TPAY_SECRET_KEY 
    ? Buffer.from(process.env.TPAY_SECRET_KEY, 'base64').length 
    : 0;
  res.json({ 
    status: "ok", 
    mongo: mongoose.connection.readyState === 1,
    transactpay_key_valid: keyLength === 32,
    key_bytes: keyLength
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));